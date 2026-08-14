// tests/lib/dsh-ssf-tools-read.test.mjs
// Tests for the read-type tool handlers (ssf_list / ssf_state / ssf_workflow)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

let tempRoot;
let repoRoot;

const TOOL_IDS = ['ssf_list', 'ssf_state', 'ssf_workflow'];

function makeRegistry() {
  const registered = {};
  const ctx = {
    tools: {
      register: (def) => {
        registered[def.name] = def;
        return () => {};
      },
    },
  };
  return { ctx, registered };
}

function writeStateFile(dir, fields) {
  const lines = [];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${value}`);
  }
  writeFileSync(join(dir, '.spec-superflow.yaml'), lines.join('\n'));
}

before(() => {
  repoRoot = process.cwd();
  tempRoot = mkdtempSync(join(tmpdir(), 'ssf-tools-read-'));
  // changeA: valid state file; changeB: no state file (content inference)
  const changesDir = join(tempRoot, 'changes');
  mkdirSync(join(changesDir, 'changeA'), { recursive: true });
  mkdirSync(join(changesDir, 'changeB'), { recursive: true });
  writeStateFile(join(changesDir, 'changeA'), {
    state: 'executing',
    workflow: 'full',
    last_transition: '2026-08-01T00:00:00Z',
    dp_0_confirmed: 'true',
  });
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('dsh-ssf read tools: registration wiring', () => {
  it('keeps the six tools registered with working handlers for the read trio', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    for (const id of TOOL_IDS) {
      assert.equal(typeof registered[id]?.execute, 'function', `${id} must have execute`);
    }
  });
});

describe('dsh-ssf ssf_list', () => {
  it('returns { ok, changes } with the scanned change summaries', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_list.execute({}, {});
    assert.equal(value.ok, true);
    assert.ok(Array.isArray(value.changes));
    assert.equal(value.changes.length, 2);
    const a = value.changes.find((c) => c.name === 'changeA');
    assert.equal(a.state, 'executing');
    assert.equal(a.workflow, 'full');
    const b = value.changes.find((c) => c.name === 'changeB');
    assert.equal(b.stateFileMissing, true);
  });

  it('rejects a traversal changeDir even on the list tool', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_list.execute({ changeDir: '../escape' }, {}));
  });
});

describe('dsh-ssf ssf_state', () => {
  it('returns raw state verbatim for a valid change', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_state.execute({ changeDir: 'changeA' }, {});
    assert.equal(value.ok, true);
    assert.equal(value.state.state, 'executing');
    assert.equal(value.state.last_transition, '2026-08-01T00:00:00Z');
    assert.equal(value.stateFileMissing, undefined);
  });

  it('degrades with stateFileMissing when the state file is absent', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_state.execute({ changeDir: 'changeB' }, {});
    assert.equal(value.ok, true);
    assert.equal(value.state, null);
    assert.equal(value.stateFileMissing, true);
  });

  it('degrades with parseError on a malformed state file', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const badDir = join(tempRoot, 'changes', 'changeBad');
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, '.spec-superflow.yaml'), 'state: [unclosed\n');
    const value = await registered.ssf_state.execute({ changeDir: 'changeBad' }, {});
    assert.equal(value.ok, true);
    assert.equal(value.state, null);
    assert.equal(typeof value.parseError, 'string');
  });

  it('results satisfy the registered output schema (valid and degraded)', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const { validateJsonSchemaValue } = await import('@deepseek-ai/dsh-tools');
    for (const changeDir of ['changeA', 'changeB']) {
      const value = await registered.ssf_state.execute({ changeDir }, {});
      const violations = validateJsonSchemaValue(registered.ssf_state.output.schema, value, 'result');
      assert.deepEqual(violations, [], `ssf_state result for ${changeDir} must satisfy its output schema`);
    }
  });

  it('throws on traversal, absolute, and empty changeDir paths', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const execute = registered.ssf_state.execute;
    await assert.rejects(() => execute({ changeDir: '../escape' }, {}), /invalid changeDir/);
    await assert.rejects(() => execute({ changeDir: '/etc/passwd' }, {}), /invalid changeDir/);
    await assert.rejects(() => execute({ changeDir: 'a/../../b' }, {}), /invalid changeDir/);
    await assert.rejects(() => execute({ changeDir: '' }, {}), /invalid changeDir/);
  });
});

describe('dsh-ssf ssf_workflow', () => {
  it('returns the receipt summary for the real change (selected full)', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    // Real repo root: changes/dsh-ssf-plugin has a persisted workflow-selection.json
    registerTools(ctx, { resolveRoot: () => repoRoot });
    const value = await registered.ssf_workflow.execute({ changeDir: 'dsh-ssf-plugin' }, {});
    assert.equal(value.ok, true);
    assert.equal(value.workflow.workflow, 'full');
    assert.equal(value.workflow.receiptExists, true);
    assert.equal(value.workflow.receiptValid, true);
    assert.equal(value.workflow.status, 'selected');
    assert.equal(value.workflow.recommendation, 'full');
  });

  it('reports missing-receipt for a change without a receipt', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_workflow.execute({ changeDir: 'changeA' }, {});
    assert.equal(value.ok, true);
    assert.equal(value.workflow.receiptExists, false);
    assert.equal(value.workflow.status, 'missing-receipt');
  });
});

describe('dsh-ssf resolveChangePath', () => {
  it('rejects traversal, absolute, and empty paths', async () => {
    const { resolveChangePath } = await import('../../packages/dsh-ssf/lib/tools.js');
    for (const bad of ['../x', 'a/../b', '/etc', 'a/../../b', '', undefined, null]) {
      assert.throws(() => resolveChangePath(tempRoot, bad), /invalid changeDir/);
    }
  });

  it('accepts a plain relative change name and resolves under changes/', async () => {
    const { resolveChangePath } = await import('../../packages/dsh-ssf/lib/tools.js');
    const resolved = resolveChangePath(tempRoot, 'changeA');
    assert.equal(resolved, join(tempRoot, 'changes', 'changeA'));
    assert.ok(existsSync(resolved));
  });
});
