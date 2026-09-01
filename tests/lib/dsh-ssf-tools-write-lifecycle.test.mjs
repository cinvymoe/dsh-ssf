// tests/lib/dsh-ssf-tools-write-lifecycle.test.mjs
// Tests for lifecycle & runtime tools (task 2.3, wave w4-lifecycle)
// Covers: ssf_isolate / ssf_finish / ssf_inject / ssf_sync / ssf_audit / ssf_runtime
// - each action argv逐项、可选旗标、非法枚举/缺失字段 throw、返回信封结构、changeDir 安全校验、json flag 正确性、check_update outcome 映射、asset_read 路径安全
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempRoot;

function makeFakeSubprocess(spawned, { exitCode = 0, stdoutText = '{"ok":true}', stderrText = '' } = {}) {
  return {
    spawn: (spec) => {
      spawned.push(spec);
      const read = (text) => ({ readFrom: () => ({ text: text ?? '', nextOffset: 0, lossy: false }) });
      return {
        pid: 42,
        collected: { stdout: read(stdoutText), stderr: read(stderrText) },
        done: Promise.resolve({ exitCode, signal: null }),
        terminate: () => {},
        waitForExit: async () => true,
      };
    },
  };
}

function makeRegistry(subprocess) {
  const registered = {};
  const ctx = {
    tools: {
      register: (def) => {
        registered[def.name] = def;
        return () => {};
      },
    },
    subprocess,
    ssf: { refresh: async () => {} },
  };
  return { ctx, registered };
}

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'ssf-tools-write-lifecycle-'));
  mkdirSync(join(tempRoot, 'changes', 'my-change'), { recursive: true });
  mkdirSync(join(tempRoot, 'changes', 'other'), { recursive: true });
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('dsh-ssf ssf_isolate', () => {
  it('registers ssf_isolate with correct parameters and output schema', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const tool = registered.ssf_isolate;
    assert.ok(tool, 'ssf_isolate must be registered');
    const cdRequired = tool.parameters.properties.changeDir.required === true || (tool.parameters.required ?? []).includes('changeDir');
    assert.equal(cdRequired, true, 'changeDir must be required');
    assert.deepEqual(tool.parameters.properties.mode.enum, ['none', 'force', 'isolate']);
    assert.equal(tool.parameters.properties.mode.default, 'none');
    assert.equal(tool.parameters.properties.name.type, 'string');
    assert.equal(tool.output.schema.properties.ok.type, 'boolean');
    assert.equal(tool.output.schema.properties.exitCode.type, 'integer');
    assert.equal(tool.output.schema.properties.stdout.type, 'string');
    assert.equal(tool.output.schema.properties.stderr.type, 'string');
  });

  it('default mode none -> argv isolate changes/<name> no flag, json false', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: 'isolated', stderrText: '' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const result = await registered.ssf_isolate.execute({ changeDir: 'my-change' }, {});
    const argv = spawned[0].argv;
    assert.equal(argv[0], process.execPath);
    assert.ok(argv[1].endsWith('scripts/spec-superflow.mjs'));
    assert.deepEqual(argv.slice(2, 4), ['isolate', 'changes/my-change']);
    assert.ok(!argv.includes('--force'));
    assert.ok(!argv.includes('--isolate'));
    assert.ok(!argv.includes('--json'), 'json:false should not add --json');
    assert.equal(spawned[0].graceMs, 30000);
    assert.equal(typeof result.ok, 'boolean');
    assert.equal(typeof result.stdout, 'string');
  });

  it('mode force -> adds --force', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_isolate.execute({ changeDir: 'my-change', mode: 'force' }, {});
    const argv = spawned[0].argv;
    assert.ok(argv.includes('--force'));
    assert.ok(!argv.includes('--isolate'));
  });

  it('mode isolate -> adds --isolate', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_isolate.execute({ changeDir: 'my-change', mode: 'isolate' }, {});
    const argv = spawned[0].argv;
    assert.ok(argv.includes('--isolate'));
    assert.ok(!argv.includes('--force'));
  });

  it('with name -> argv isolate changes/<dir> <name> [mode flag]', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_isolate.execute({ changeDir: 'my-change', mode: 'force', name: 'my-change-alias' }, {});
    const argv = spawned[0].argv;
    // positionals: isolate, changes/my-change, name
    assert.deepEqual(argv.slice(2, 5), ['isolate', 'changes/my-change', 'my-change-alias']);
    assert.ok(argv.includes('--force'));
  });

  it('mode explicit none -> no flag', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_isolate.execute({ changeDir: 'my-change', mode: 'none' }, {});
    const argv = spawned[0].argv;
    assert.ok(!argv.includes('--force') && !argv.includes('--isolate'));
  });

  it('非法 mode 枚举 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_isolate.execute({ changeDir: 'my-change', mode: 'bad' }, {}), /invalid|must be one of/);
    assert.equal(spawned.length, 0);
  });

  it('非法 changeDir 抛 invalid changeDir 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    for (const bad of ['../escape', '/etc/passwd', 'a/../b', '']) {
      await assert.rejects(() => registered.ssf_isolate.execute({ changeDir: bad }, {}), /invalid changeDir/);
    }
    assert.equal(spawned.length, 0);
  });

  it('返回信封结构 ok/exitCode/stdout/stderr 且 output.schema 验证通过', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: 'done', stderrText: '' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_isolate.execute({ changeDir: 'my-change' }, {});
    assert.equal(typeof value.ok, 'boolean');
    assert.equal(typeof value.exitCode, 'number');
    assert.equal(typeof value.stdout, 'string');
    assert.equal(typeof value.stderr, 'string');
    const { validateJsonSchemaValue } = await import('@deepseek-ai/dsh-tools');
    const violations = validateJsonSchemaValue(registered.ssf_isolate.output.schema, value, 'result');
    assert.deepEqual(violations, []);
  });

  it('走 cli-runner：spawn argv 头为 process.execPath 与仓库内脚本绝对路径', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_isolate.execute({ changeDir: 'my-change' }, {});
    const argv = spawned[0].argv;
    assert.equal(argv[0], process.execPath);
    assert.ok(argv[1].endsWith('scripts/spec-superflow.mjs'));
    assert.equal(spawned[0].cwd, tempRoot);
  });
});

describe('dsh-ssf ssf_finish', () => {
  it('registers ssf_finish with correct parameters and output schema', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const tool = registered.ssf_finish;
    assert.ok(tool);
    const cdRequired = tool.parameters.properties.changeDir.required === true || (tool.parameters.required ?? []).includes('changeDir');
    assert.equal(cdRequired, true);
    assert.equal(tool.parameters.properties.testCmd.type, 'string');
    assert.equal(tool.output.schema.properties.result.additionalProperties, true);
  });

  it('finish without testCmd -> argv finish changes/<name> --json false', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: 'finished' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_finish.execute({ changeDir: 'my-change' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 4), ['finish', 'changes/my-change']);
    assert.ok(!argv.includes('--test-cmd'));
    assert.ok(!argv.includes('--json'));
    assert.equal(spawned[0].graceMs, 30000);
  });

  it('finish with testCmd -> adds --test-cmd <cmd>', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_finish.execute({ changeDir: 'my-change', testCmd: 'npm run test2' }, {});
    const argv = spawned[0].argv;
    assert.ok(argv.includes('--test-cmd'));
    assert.equal(argv[argv.indexOf('--test-cmd') + 1], 'npm run test2');
  });

  it('非法 changeDir 抛 invalid changeDir 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    for (const bad of ['../escape', '/etc/passwd', 'a/../b', '']) {
      await assert.rejects(() => registered.ssf_finish.execute({ changeDir: bad }, {}), /invalid changeDir/);
    }
    assert.equal(spawned.length, 0);
  });

  it('返回信封结构且 graceMs 为 30000 (R1 terminate 宽限非超时)', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: 'ok' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_finish.execute({ changeDir: 'my-change' }, {});
    assert.equal(typeof value.ok, 'boolean');
    assert.equal(typeof value.exitCode, 'number');
    assert.equal(spawned[0].graceMs, 30000);
    // ensure not 900000
    assert.notEqual(spawned[0].graceMs, 900000);
  });
});

describe('dsh-ssf ssf_inject', () => {
  it('registers ssf_inject with correct parameters and output schema', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const tool = registered.ssf_inject;
    assert.ok(tool);
    const cdRequired = tool.parameters.properties.changeDir.required === true || (tool.parameters.required ?? []).includes('changeDir');
    assert.equal(cdRequired, true);
    assert.equal(tool.parameters.properties.platforms.type, 'string');
    assert.equal(tool.output.schema.properties.result.additionalProperties, true);
  });

  it('inject without platforms -> argv inject changes/<name> --json true', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_inject.execute({ changeDir: 'my-change' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 4), ['inject', 'changes/my-change']);
    assert.ok(argv.includes('--json'));
    assert.ok(!argv.includes('--platforms'));
  });

  it('inject with platforms -> adds --platforms <v>', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_inject.execute({ changeDir: 'my-change', platforms: 'claude,codex' }, {});
    const argv = spawned[0].argv;
    assert.ok(argv.includes('--platforms'));
    assert.equal(argv[argv.indexOf('--platforms') + 1], 'claude,codex');
    assert.ok(argv.includes('--json'));
  });

  it('非法 changeDir 抛 invalid changeDir 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    for (const bad of ['../escape', '/etc/passwd', 'a/../b', '']) {
      await assert.rejects(() => registered.ssf_inject.execute({ changeDir: bad }, {}), /invalid changeDir/);
    }
    assert.equal(spawned.length, 0);
  });

  it('返回信封结构 json:true', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_inject.execute({ changeDir: 'my-change' }, {});
    assert.equal(value.ok, true);
    assert.equal(typeof value.result, 'object');
  });
});

describe('dsh-ssf ssf_sync', () => {
  it('registers ssf_sync with correct parameters and output schema', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const tool = registered.ssf_sync;
    assert.ok(tool);
    const cdRequired = tool.parameters.properties.changeDir.required === true || (tool.parameters.required ?? []).includes('changeDir');
    assert.equal(cdRequired, true);
    assert.equal(tool.output.schema.properties.ok.type, 'boolean');
  });

  it('sync -> argv sync changes/<name> json false', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: 'synced' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_sync.execute({ changeDir: 'my-change' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 4), ['sync', 'changes/my-change']);
    assert.ok(!argv.includes('--json'));
    assert.equal(spawned[0].graceMs, 30000);
  });

  it('非法 changeDir 抛 invalid changeDir 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    for (const bad of ['../escape', '/etc/passwd', 'a/../b', '']) {
      await assert.rejects(() => registered.ssf_sync.execute({ changeDir: bad }, {}), /invalid changeDir/);
    }
    assert.equal(spawned.length, 0);
  });

  it('返回信封结构', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: 'synced' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_sync.execute({ changeDir: 'my-change' }, {});
    assert.equal(typeof value.ok, 'boolean');
    assert.equal(typeof value.stdout, 'string');
  });
});

describe('dsh-ssf ssf_audit', () => {
  it('registers ssf_audit with correct parameters and output schema', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const tool = registered.ssf_audit;
    assert.ok(tool);
    const cdRequired = tool.parameters.properties.changeDir.required === true || (tool.parameters.required ?? []).includes('changeDir');
    assert.equal(cdRequired, true);
    assert.equal(tool.output.schema.properties.result.additionalProperties, true);
  });

  it('audit -> argv audit changes/<name> json true', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_audit.execute({ changeDir: 'my-change' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 4), ['audit', 'changes/my-change']);
    assert.ok(argv.includes('--json'));
  });

  it('非法 changeDir 抛 invalid changeDir 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    for (const bad of ['../escape', '/etc/passwd', 'a/../b', '']) {
      await assert.rejects(() => registered.ssf_audit.execute({ changeDir: bad }, {}), /invalid changeDir/);
    }
    assert.equal(spawned.length, 0);
  });

  it('返回信封结构 json:true', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"audit":"ok"}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_audit.execute({ changeDir: 'my-change' }, {});
    assert.equal(value.ok, true);
    assert.equal(typeof value.result, 'object');
  });
});

describe('dsh-ssf ssf_runtime', () => {
  it('registers ssf_runtime with correct parameters and output schema', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const tool = registered.ssf_runtime;
    assert.ok(tool);
    // changeDir optional (not required)
    const cdRequired = tool.parameters.properties.changeDir.required === true || (tool.parameters.required ?? []).includes('changeDir');
    assert.equal(cdRequired, false, 'changeDir should be optional for runtime');
    assert.deepEqual(tool.parameters.properties.action.enum, ['asset_read', 'config_get', 'resolve_model', 'check_update', 'infer']);
    const actRequired = tool.parameters.properties.action.required === true || (tool.parameters.required ?? []).includes('action');
    assert.equal(actRequired, true);
    assert.equal(tool.parameters.properties.path.type, 'string');
    assert.equal(tool.parameters.properties.key.type, 'string');
    assert.equal(tool.parameters.properties.profile.type, 'string');
    assert.equal(tool.output.schema.properties.ok.type, 'boolean');
    assert.equal(tool.output.schema.properties.exitCode.type, 'integer');
  });

  it('asset_read -> argv runtime asset read <path> json:false', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: 'content' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_runtime.execute({ action: 'asset_read', path: 'skills/build-executor/implementer-prompt.md' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 6), ['runtime', 'asset', 'read', 'skills/build-executor/implementer-prompt.md']);
    assert.ok(!argv.includes('--json'));
  });

  it('asset_read 缺 path 时 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_runtime.execute({ action: 'asset_read' }, {}), /path is required/);
    assert.equal(spawned.length, 0);
  });

  it('asset_read path 含 .. 或绝对路径时 throw invalid path 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_runtime.execute({ action: 'asset_read', path: '../escape' }, {}), /invalid path/);
    await assert.rejects(() => registered.ssf_runtime.execute({ action: 'asset_read', path: '/etc/passwd' }, {}), /invalid path/);
    await assert.rejects(() => registered.ssf_runtime.execute({ action: 'asset_read', path: 'a/../b' }, {}), /invalid path/);
    assert.equal(spawned.length, 0);
  });

  it('asset_read 允许相对技能路径如 skills/...', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: 'ok' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_runtime.execute({ action: 'asset_read', path: 'skills/build-executor/implementer-prompt.md' }, {});
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].argv[5], 'skills/build-executor/implementer-prompt.md');
  });

  it('config_get -> argv runtime config --get <key> json:false', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: 'value' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_runtime.execute({ action: 'config_get', key: 'model.profiles' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 6), ['runtime', 'config', '--get', 'model.profiles']);
    assert.ok(!argv.includes('--json'));
  });

  it('config_get 缺 key 时 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_runtime.execute({ action: 'config_get' }, {}), /key is required/);
    assert.equal(spawned.length, 0);
  });

  it('resolve_model -> argv runtime config --resolve-model <profile> json:true', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"profile":"default"}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_runtime.execute({ action: 'resolve_model', profile: 'default' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 6), ['runtime', 'config', '--resolve-model', 'default']);
    assert.ok(argv.includes('--json'));
  });

  it('resolve_model 缺 profile 时 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_runtime.execute({ action: 'resolve_model' }, {}), /profile is required/);
    assert.equal(spawned.length, 0);
  });

  it('check_update -> argv runtime check-update json:true, exitCode 0 => outcome continue ok:true', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { exitCode: 0, stdoutText: '{"outcome":"continue"}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_runtime.execute({ action: 'check_update' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 4), ['runtime', 'check-update']);
    assert.ok(argv.includes('--json'));
    assert.equal(value.ok, true);
    assert.equal(value.exitCode, 0);
    assert.equal(value.result.outcome, 'continue');
  });

  it('check_update exitCode 1 => outcome upgrade-reminder ok:true', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { exitCode: 1, stdoutText: 'upgrade' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_runtime.execute({ action: 'check_update' }, {});
    assert.equal(value.ok, true);
    assert.equal(value.exitCode, 1);
    assert.equal(value.result.outcome, 'upgrade-reminder');
  });

  it('check_update exitCode 2 => outcome skip ok:true', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { exitCode: 2, stdoutText: 'skip' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_runtime.execute({ action: 'check_update' }, {});
    assert.equal(value.ok, true);
    assert.equal(value.exitCode, 2);
    assert.equal(value.result.outcome, 'skip');
  });

  it('check_update 非预期退出码(如 3) 按 runner ok:false 信封', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { exitCode: 3, stdoutText: 'err', stderrText: 'fail' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_runtime.execute({ action: 'check_update' }, {});
    assert.equal(value.ok, false);
    assert.equal(value.exitCode, 3);
  });

  it('check_update 解析 JSON 的 outcome 字段优先于映射', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { exitCode: 0, stdoutText: '{"outcome":"continue","extra":1}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_runtime.execute({ action: 'check_update' }, {});
    assert.equal(value.result.outcome, 'continue');
  });

  it('infer -> argv runtime infer changes/<name> json:true', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"workflow":"full"}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_runtime.execute({ action: 'infer', changeDir: 'my-change' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 5), ['runtime', 'infer', 'changes/my-change']);
    assert.ok(argv.includes('--json'));
  });

  it('infer 缺 changeDir 时 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_runtime.execute({ action: 'infer' }, {}), /changeDir is required/);
    await assert.rejects(() => registered.ssf_runtime.execute({ action: 'infer', changeDir: '' }, {}), /changeDir|invalid changeDir/);
    assert.equal(spawned.length, 0);
  });

  it('非法 action 枚举 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_runtime.execute({ action: 'bad' }, {}), /invalid|must be one of/);
    assert.equal(spawned.length, 0);
  });

  it('非法 changeDir 抛 invalid changeDir 且不进 runner (infer 场景)', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    for (const bad of ['../escape', '/etc/passwd', 'a/../b']) {
      await assert.rejects(() => registered.ssf_runtime.execute({ action: 'infer', changeDir: bad }, {}), /invalid changeDir/);
    }
    assert.equal(spawned.length, 0);
  });

  it('返回信封结构 ok/exitCode/stdout/stderr/result 且 output.schema 验证通过', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: 'content' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_runtime.execute({ action: 'asset_read', path: 'docs/artifact-contract.md' }, {});
    assert.equal(typeof value.ok, 'boolean');
    assert.equal(typeof value.exitCode, 'number');
    assert.equal(typeof value.stdout, 'string');
    assert.equal(typeof value.stderr, 'string');
    const { validateJsonSchemaValue } = await import('@deepseek-ai/dsh-tools');
    const violations = validateJsonSchemaValue(registered.ssf_runtime.output.schema, value, 'result');
    assert.deepEqual(violations, []);
  });

  it('走 cli-runner：spawn argv 头为 process.execPath 与仓库内脚本绝对路径', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: 'ok' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_runtime.execute({ action: 'asset_read', path: 'docs/artifact-contract.md' }, {});
    const argv = spawned[0].argv;
    assert.equal(argv[0], process.execPath);
    assert.ok(argv[1].endsWith('scripts/spec-superflow.mjs'));
    assert.equal(spawned[0].cwd, tempRoot);
  });
});

describe('dsh-ssf tools 共性 w4-lifecycle', () => {
  it('复用 resolveChangePath 校验 changeDir，不复制实现', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const repoRoot = process.cwd();
    const src = readFileSync(join(repoRoot, 'packages/dsh-ssf/lib/tools.js'), 'utf-8');
    assert.ok(src.includes('resolveChangePath'));
    const { resolveChangePath } = await import('../../packages/dsh-ssf/lib/tools.js');
    assert.equal(typeof resolveChangePath, 'function');
    const runnerSrc = readFileSync(join(repoRoot, 'packages/dsh-ssf/lib/cli-runner.js'), 'utf-8');
    assert.ok(runnerSrc.includes('resolveChangePath'));
  });

  it('新增 6 工具与 cli-runner 导入在文件顶部', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const repoRoot = process.cwd();
    const src = readFileSync(join(repoRoot, 'packages/dsh-ssf/lib/tools.js'), 'utf-8');
    const top = src.slice(0, 1500);
    assert.ok(top.includes('createCliRunner'));
    assert.ok(top.includes('fileURLToPath'));
    // ensure TOOL_IDS contains 6 new ids
    assert.ok(src.includes('ssf_isolate'));
    assert.ok(src.includes('ssf_finish'));
    assert.ok(src.includes('ssf_inject'));
    assert.ok(src.includes('ssf_sync'));
    assert.ok(src.includes('ssf_audit'));
    assert.ok(src.includes('ssf_runtime'));
  });

  it('既有工具契约不变：新增 6 工具后总数 19 且原有行为保持', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const ids = Object.keys(registered).sort();
    const expected = ['ssf_list','ssf_state','ssf_workflow','ssf_execution','ssf_validate','ssf_guard','ssf_run','ssf_state_write','ssf_workflow_write','ssf_execution_write','ssf_checkpoint','ssf_handoff','ssf_debug','ssf_isolate','ssf_finish','ssf_inject','ssf_sync','ssf_audit','ssf_runtime'].sort();
    assert.deepEqual(ids, expected);
    const listVal = await registered.ssf_list.execute({}, {});
    assert.equal(listVal.ok, true);
    for (const newId of ['ssf_isolate','ssf_finish','ssf_inject','ssf_sync','ssf_audit','ssf_runtime']) {
      const tool = registered[newId];
      assert.ok(tool);
      assert.equal(tool.output.schema.properties.ok.type, 'boolean');
      assert.equal(tool.output.schema.properties.exitCode.type, 'integer');
    }
  });

  it('w2&w3 工具仍可用：argv 不变', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_state_write.execute({ changeDir: 'my-change', action: 'init' }, {});
    assert.deepEqual(spawned[0].argv.slice(2, 5), ['state', 'init', 'changes/my-change']);
    spawned.length = 0;
    await registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'recommend' }, {});
    assert.deepEqual(spawned[0].argv.slice(2, 5), ['execution', 'recommend', 'changes/my-change']);
    spawned.length = 0;
    await registered.ssf_checkpoint.execute({ changeDir: 'my-change', action: 'list' }, {});
    assert.deepEqual(spawned[0].argv.slice(2, 5), ['checkpoint', 'list', 'changes/my-change']);
  });
});
