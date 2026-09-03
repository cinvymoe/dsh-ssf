// tests/lib/dsh-ssf-tools-run.test.mjs
// Tests for the ssf_run fallback tool (task 2.4)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { spawnSync } = require('node:child_process');

let tempRoot;

/** Minimal real subprocess provider shaped like ctx.subprocess (spawnSync-backed). */
function makeRealSubprocess() {
  return {
    spawn(spec) {
      const child = spawnSync(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd,
        encoding: 'utf8',
        env: process.env,
      });
      const read = (text) => ({ readFrom: () => ({ text: text ?? '', nextOffset: 0, lossy: false }) });
      return {
        pid: child.pid ?? -1,
        collected: { stdout: read(child.stdout), stderr: read(child.stderr) },
        done: Promise.resolve({ exitCode: child.status, signal: child.signal }),
        terminate: () => {},
        waitForExit: async () => true,
      };
    },
  };
}

/** Fake ctx.subprocess that records spawn specs and returns canned output. */
function makeFakeSubprocess(spawned, { exitCode = 0, stderrText = 'err' } = {}) {
  return {
    spawn: (spec) => {
      spawned.push(spec);
      const read = (text) => ({ readFrom: () => ({ text, nextOffset: 0, lossy: false }) });
      return {
        pid: 42,
        collected: { stdout: read('out'), stderr: read(stderrText) },
        done: Promise.resolve({ exitCode, signal: null }),
        terminate: () => {},
        waitForExit: async () => true,
      };
    },
  };
}

function makeRegistry(subprocess) {
  const registered = {};
  const spawned = [];
  const ctx = {
    tools: {
      register: (def) => {
        registered[def.name] = def;
        return () => {};
      },
    },
    subprocess: subprocess ?? makeFakeSubprocess(spawned),
  };
  return { ctx, registered, spawned };
}

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'ssf-tools-run-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('dsh-ssf ssf_run', () => {
  it('registers ssf_run with an arguments array parameter', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    assert.ok(registered.ssf_run, 'ssf_run must be registered');
    assert.equal(registered.ssf_run.parameters.properties.arguments.type, 'array');
  });

  it('spawns the ssf binary via ctx.subprocess with argv passthrough', async () => {
    const { ctx, registered, spawned } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_run.execute({ arguments: ['handoff', 'list', 'changes/x'] }, {});
    assert.equal(spawned.length, 1);
    const spec = spawned[0];
    assert.equal(spec.argv[0], 'ssf');
    assert.deepEqual(spec.argv.slice(1), ['handoff', 'list', 'changes/x']);
    assert.equal(spec.cwd, tempRoot);
    assert.equal(typeof spec.graceMs, 'number');
    assert.deepEqual(spec.stdio.stdin, 'ignore');
    assert.ok(spec.stdio.stdout.maxBytes > 0);
    assert.ok(spec.stdio.stderr.maxBytes > 0);
    assert.deepEqual(value, { ok: true, stdout: 'out', stderr: 'err', exitCode: 0 });
  });

  it('passes through a non-zero exit code', async () => {
    const { ctx, registered } = makeRegistry(makeFakeSubprocess([], { exitCode: 2, stderrText: 'boom' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_run.execute({ arguments: ['list'] }, {});
    assert.equal(value.exitCode, 2);
    assert.equal(value.stderr, 'boom');
  });

  it('refreshes the ssf service after execution', async () => {
    let refreshCalls = 0;
    const { ctx, registered } = makeRegistry();
    ctx.ssf = { refresh: async () => { refreshCalls += 1; } };
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_run.execute({ arguments: ['list'] }, {});
    assert.equal(value.exitCode, 0);
    assert.equal(refreshCalls, 1, 'ssf_run must refresh the ssf service after execution');
  });

  it('does not propagate a refresh failure', async () => {
    const { ctx, registered } = makeRegistry();
    ctx.ssf = { refresh: async () => { throw new Error('refresh boom'); } };
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_run.execute({ arguments: ['list'] }, {});
    assert.equal(value.exitCode, 0);
    assert.equal(value.ok, true);
  });

  it('throws on empty arguments, unknown subcommands, and traversal/absolute args', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const execute = registered.ssf_run.execute;
    await assert.rejects(() => execute({ arguments: [] }, {}), /arguments must be a non-empty/);
    await assert.rejects(() => execute({ arguments: ['no-such-subcommand'] }, {}), /unknown ssf subcommand/);
    await assert.rejects(() => execute({ arguments: ['list', '../escape'] }, {}), /not allowed/);
    await assert.rejects(() => execute({ arguments: ['list', '/etc/passwd'] }, {}), /not allowed/);
  });

  it('runs the real ssf binary end to end', async () => {
    const { ctx, registered } = makeRegistry(makeRealSubprocess());
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => process.cwd() });
    const value = await registered.ssf_run.execute({ arguments: ['list', '--json'] }, {});
    assert.equal(value.exitCode, 0, value.stderr);
    // Worktree contains dsh-ssf-native-tools, main contains dsh-ssf-plugin; accept either
    const hasExpected = value.stdout.includes('dsh-ssf-plugin') || value.stdout.includes('dsh-ssf-native-tools');
    assert.ok(hasExpected, 'ssf list --json output must include the expected change (dsh-ssf-plugin or dsh-ssf-native-tools)');
  });
});
