// tests/lib/dsh-ssf-tools-write-execution.test.mjs
// Tests for ssf_execution_write / ssf_checkpoint / ssf_handoff / ssf_debug (task 2.2, wave w3-collab)
// Covers: each action argv逐项、可选旗标、非法枚举/缺失字段 throw、返回信封结构、changeDir 安全校验
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
  tempRoot = mkdtempSync(join(tmpdir(), 'ssf-tools-write-execution-'));
  mkdirSync(join(tempRoot, 'changes', 'my-change'), { recursive: true });
  mkdirSync(join(tempRoot, 'changes', 'other'), { recursive: true });
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('dsh-ssf ssf_execution_write', () => {
  it('registers ssf_execution_write with correct parameters and output schema', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const tool = registered.ssf_execution_write;
    assert.ok(tool, 'ssf_execution_write must be registered');
    const cdRequired = tool.parameters.properties.changeDir.required === true || (tool.parameters.required ?? []).includes('changeDir');
    assert.equal(cdRequired, true, 'changeDir must be required');
    const actRequired = tool.parameters.properties.action.required === true || (tool.parameters.required ?? []).includes('action');
    assert.equal(actRequired, true, 'action must be required');
    assert.deepEqual(tool.parameters.properties.action.enum, ['recommend', 'plan', 'revise', 'resync', 'review']);
    assert.equal(tool.parameters.properties.mode.enum.join(','), 'sdd,inline,batch-inline');
    assert.equal(tool.parameters.properties.verdict.enum.join(','), 'pass,fail');
    assert.equal(tool.parameters.properties.waves.type, 'array');
    assert.equal(tool.parameters.properties.waves.items.type, 'string');
    assert.equal(tool.parameters.properties.acknowledgeRecommendation.type, 'boolean');
    assert.equal(tool.output.schema.type, 'object');
    assert.equal(tool.output.schema.properties.ok.type, 'boolean');
    assert.equal(tool.output.schema.properties.exitCode.type, 'integer');
    assert.equal(tool.output.schema.properties.stdout.type, 'string');
    assert.equal(tool.output.schema.properties.stderr.type, 'string');
    assert.equal(tool.output.schema.properties.result.type, 'object');
    assert.equal(typeof tool.output.render, 'function');
  });

  it('recommend -> argv execution recommend changes/<name> --json without waves', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const result = await registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'recommend' }, {});
    assert.equal(spawned.length, 1);
    const argv = spawned[0].argv;
    assert.equal(argv[0], process.execPath);
    assert.ok(argv[1].endsWith('scripts/spec-superflow.mjs'));
    assert.deepEqual(argv.slice(2, 5), ['execution', 'recommend', 'changes/my-change']);
    assert.ok(argv.includes('--json'));
    assert.ok(!argv.includes('--wave'));
    assert.equal(result.ok, true);
  });

  it('recommend with waves -> each --wave <w>', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'recommend', waves: ['wave-1:serial:1.1', 'wave-2:parallel:1.2,1.3:wave-1'] }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 5), ['execution', 'recommend', 'changes/my-change']);
    const waveIndexes = [];
    for (let i = 0; i < argv.length; i++) if (argv[i] === '--wave') waveIndexes.push(i);
    assert.equal(waveIndexes.length, 2);
    assert.equal(argv[waveIndexes[0] + 1], 'wave-1:serial:1.1');
    assert.equal(argv[waveIndexes[1] + 1], 'wave-2:parallel:1.2,1.3:wave-1');
    assert.ok(argv.includes('--json'));
  });

  it('plan -> argv execution plan changes/<name> --mode <mode> --confirm --reason <reason> + waves + optional acknowledge', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'plan', mode: 'sdd', reason: 'need sdd', waves: ['w1:serial:1.1'], acknowledgeRecommendation: true }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 5), ['execution', 'plan', 'changes/my-change']);
    assert.ok(argv.includes('--mode'));
    assert.equal(argv[argv.indexOf('--mode') + 1], 'sdd');
    assert.ok(argv.includes('--confirm'));
    assert.ok(argv.includes('--reason'));
    assert.equal(argv[argv.indexOf('--reason') + 1], 'need sdd');
    assert.ok(argv.includes('--wave'));
    assert.equal(argv[argv.indexOf('--wave') + 1], 'w1:serial:1.1');
    assert.ok(argv.includes('--acknowledge-recommendation'));
    assert.ok(argv.includes('--json'));
  });

  it('plan without acknowledgeRecommendation not attaching flag', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'plan', mode: 'inline', reason: 'r', waves: ['w1:serial:1.1'] }, {});
    const argv = spawned[0].argv;
    assert.ok(!argv.includes('--acknowledge-recommendation'));
  });

  it('plan multiple waves each --wave', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'plan', mode: 'batch-inline', reason: 'r', waves: ['w1:serial:1.1', 'w2:serial:1.2'] }, {});
    const argv = spawned[0].argv;
    const count = argv.filter((a) => a === '--wave').length;
    assert.equal(count, 2);
  });

  it('revise -> argv execution revise changes/<name> --mode ... --confirm --reason ... --wave ... (--acknowledge optional)', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'revise', mode: 'sdd', reason: 'up', waves: ['w1:parallel:1.1,1.2'] }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 5), ['execution', 'revise', 'changes/my-change']);
    assert.ok(argv.includes('--mode'));
    assert.ok(argv.includes('--confirm'));
    assert.ok(argv.includes('--reason'));
    assert.ok(argv.includes('--wave'));
    assert.ok(!argv.includes('--acknowledge-recommendation'));
    // with ack
    spawned.length = 0;
    await registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'revise', mode: 'sdd', reason: 'up', waves: ['w1:serial:1.1'], acknowledgeRecommendation: true }, {});
    assert.ok(spawned[0].argv.includes('--acknowledge-recommendation'));
  });

  it('resync -> argv execution resync changes/<name> --confirm --reason <reason> --json', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'resync', reason: 'format fix' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 5), ['execution', 'resync', 'changes/my-change']);
    assert.ok(argv.includes('--confirm'));
    assert.ok(argv.includes('--reason'));
    assert.equal(argv[argv.indexOf('--reason') + 1], 'format fix');
    assert.ok(argv.includes('--json'));
  });

  it('review -> argv execution review changes/<name> --wave <w> --base <b> --head <h> --report <r> --verdict <v>', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'review', wave: 'w-impl', base: 'abc123', head: 'def456', report: '.superpowers/sdd/reviews/w-impl.md', verdict: 'pass' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 5), ['execution', 'review', 'changes/my-change']);
    assert.ok(argv.includes('--wave'));
    assert.equal(argv[argv.indexOf('--wave') + 1], 'w-impl');
    assert.ok(argv.includes('--base'));
    assert.equal(argv[argv.indexOf('--base') + 1], 'abc123');
    assert.ok(argv.includes('--head'));
    assert.equal(argv[argv.indexOf('--head') + 1], 'def456');
    assert.ok(argv.includes('--report'));
    assert.equal(argv[argv.indexOf('--report') + 1], '.superpowers/sdd/reviews/w-impl.md');
    assert.ok(argv.includes('--verdict'));
    assert.equal(argv[argv.indexOf('--verdict') + 1], 'pass');
    assert.ok(argv.includes('--json'));
  });

  it('review with verdict fail', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'review', wave: 'w1', base: 'b', head: 'h', report: 'r', verdict: 'fail' }, {});
    const argv = spawned[0].argv;
    assert.equal(argv[argv.indexOf('--verdict') + 1], 'fail');
  });

  it('plan 缺 mode/reason/waves 时 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'plan', reason: 'r', waves: ['w1:serial:1.1'] }, {}), /mode/);
    await assert.rejects(() => registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'plan', mode: 'sdd', waves: ['w1:serial:1.1'] }, {}), /reason/);
    await assert.rejects(() => registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'plan', mode: 'sdd', reason: 'r' }, {}), /waves/);
    await assert.rejects(() => registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'plan', mode: 'sdd', reason: 'r', waves: [] }, {}), /waves/);
    assert.equal(spawned.length, 0);
  });

  it('revise 缺 mode/reason/waves 时 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'revise', reason: 'r', waves: ['w1:serial:1.1'] }, {}), /mode/);
    await assert.rejects(() => registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'revise', mode: 'sdd', waves: ['w1:serial:1.1'] }, {}), /reason/);
    await assert.rejects(() => registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'revise', mode: 'sdd', reason: 'r', waves: [] }, {}), /waves/);
    assert.equal(spawned.length, 0);
  });

  it('resync 缺 reason 时 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'resync' }, {}), /reason/);
    assert.equal(spawned.length, 0);
  });

  it('review 缺 wave/base/head/report/verdict 时 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const full = { changeDir: 'my-change', action: 'review', wave: 'w1', base: 'b', head: 'h', report: 'r', verdict: 'pass' };
    {
      const { wave, ...rest } = full;
      await assert.rejects(() => registered.ssf_execution_write.execute(rest, {}), /wave/);
    }
    {
      const { base: _b, ...rest } = full;
      await assert.rejects(() => registered.ssf_execution_write.execute(rest, {}), /base/);
    }
    {
      const { head, ...rest } = full;
      await assert.rejects(() => registered.ssf_execution_write.execute(rest, {}), /head/);
    }
    {
      const { report, ...rest } = full;
      await assert.rejects(() => registered.ssf_execution_write.execute(rest, {}), /report/);
    }
    {
      const { verdict, ...rest } = full;
      await assert.rejects(() => registered.ssf_execution_write.execute(rest, {}), /verdict/);
    }
    assert.equal(spawned.length, 0);
  });

  it('非法枚举 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'bad' }, {}), /invalid|must be one of/);
    await assert.rejects(() => registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'plan', mode: 'bad', reason: 'r', waves: ['w1:serial:1.1'] }, {}), /mode|invalid|must be one of/);
    await assert.rejects(() => registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'review', wave: 'w1', base: 'b', head: 'h', report: 'r', verdict: 'bad' }, {}), /verdict|invalid|must be one of/);
    assert.equal(spawned.length, 0);
  });

  it('非法 changeDir 抛 invalid changeDir 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    for (const bad of ['../escape', '/etc/passwd', 'a/../b', '']) {
      await assert.rejects(() => registered.ssf_execution_write.execute({ changeDir: bad, action: 'recommend' }, {}), /invalid changeDir/);
    }
    assert.equal(spawned.length, 0);
  });

  it('返回信封结构 ok/exitCode/stdout/stderr/result 且 output.schema 验证通过', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true,"plan":{"mode":"sdd"}}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'recommend' }, {});
    assert.equal(value.ok, true);
    assert.equal(typeof value.exitCode, 'number');
    assert.equal(typeof value.stdout, 'string');
    assert.equal(typeof value.stderr, 'string');
    assert.equal(typeof value.result, 'object');
    const { validateJsonSchemaValue } = await import('@deepseek-ai/dsh-tools');
    const violations = validateJsonSchemaValue(registered.ssf_execution_write.output.schema, value, 'result');
    assert.deepEqual(violations, [], `violations: ${JSON.stringify(violations)}`);
    const rendered = registered.ssf_execution_write.output.render({ changeDir: 'my-change', action: 'recommend' }, value);
    assert.ok(Array.isArray(rendered));
    assert.equal(rendered[0].type, 'text');
  });

  it('走 cli-runner：spawn argv 头为 process.execPath 与仓库内脚本绝对路径', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_execution_write.execute({ changeDir: 'my-change', action: 'recommend' }, {});
    const argv = spawned[0].argv;
    assert.equal(argv[0], process.execPath);
    assert.ok(argv[1].endsWith('scripts/spec-superflow.mjs'));
    assert.equal(spawned[0].cwd, tempRoot);
  });
});

describe('dsh-ssf ssf_checkpoint', () => {
  it('registers ssf_checkpoint with correct parameters and output schema', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const tool = registered.ssf_checkpoint;
    assert.ok(tool, 'ssf_checkpoint must be registered');
    const cdRequired = tool.parameters.properties.changeDir.required === true || (tool.parameters.required ?? []).includes('changeDir');
    assert.equal(cdRequired, true);
    const actRequired = tool.parameters.properties.action.required === true || (tool.parameters.required ?? []).includes('action');
    assert.equal(actRequired, true);
    assert.deepEqual(tool.parameters.properties.action.enum, ['save', 'list', 'show']);
    assert.equal(tool.parameters.properties.task.type, 'string');
    assert.equal(tool.parameters.properties.next.type, 'string');
    assert.equal(tool.parameters.properties.id.type, 'string');
    assert.equal(tool.output.schema.properties.result.additionalProperties, true);
  });

  it('save -> argv checkpoint save changes/<name> --task <task> --next <next> --json', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_checkpoint.execute({ changeDir: 'my-change', action: 'save', task: '1.1', next: 'Run tests' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 6), ['checkpoint', 'save', 'changes/my-change', '--task']);
    assert.equal(argv[argv.indexOf('--task') + 1], '1.1');
    assert.equal(argv[argv.indexOf('--next') + 1], 'Run tests');
    assert.ok(argv.includes('--json'));
  });

  it('list -> argv checkpoint list changes/<name> --json', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_checkpoint.execute({ changeDir: 'my-change', action: 'list' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 5), ['checkpoint', 'list', 'changes/my-change']);
    assert.ok(argv.includes('--json'));
  });

  it('show -> argv checkpoint show changes/<name> <id> --json', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_checkpoint.execute({ changeDir: 'my-change', action: 'show', id: '1.1' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 6), ['checkpoint', 'show', 'changes/my-change', '1.1']);
    assert.ok(argv.includes('--json'));
  });

  it('save 缺 task/next 时 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_checkpoint.execute({ changeDir: 'my-change', action: 'save', task: '1.1' }, {}), /task and next are required|next/);
    await assert.rejects(() => registered.ssf_checkpoint.execute({ changeDir: 'my-change', action: 'save', next: 'next' }, {}), /task and next are required|task/);
    await assert.rejects(() => registered.ssf_checkpoint.execute({ changeDir: 'my-change', action: 'save' }, {}), /task and next are required/);
    assert.equal(spawned.length, 0);
  });

  it('show 缺 id 时 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_checkpoint.execute({ changeDir: 'my-change', action: 'show' }, {}), /id is required/);
    assert.equal(spawned.length, 0);
  });

  it('非法 action 枚举 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_checkpoint.execute({ changeDir: 'my-change', action: 'bad' }, {}), /invalid|must be one of/);
    assert.equal(spawned.length, 0);
  });

  it('非法 changeDir 抛 invalid changeDir 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    for (const bad of ['../escape', '/etc/passwd', 'a/../b', '']) {
      await assert.rejects(() => registered.ssf_checkpoint.execute({ changeDir: bad, action: 'list' }, {}), /invalid changeDir/);
    }
    assert.equal(spawned.length, 0);
  });

  it('返回信封结构 ok/exitCode/stdout/stderr/result 且 output.schema 验证通过', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true,"checkpoint":{"task_id":"1.1"}}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_checkpoint.execute({ changeDir: 'my-change', action: 'list' }, {});
    assert.equal(value.ok, true);
    assert.equal(typeof value.exitCode, 'number');
    assert.equal(typeof value.stdout, 'string');
    assert.equal(typeof value.stderr, 'string');
    const { validateJsonSchemaValue } = await import('@deepseek-ai/dsh-tools');
    const violations = validateJsonSchemaValue(registered.ssf_checkpoint.output.schema, value, 'result');
    assert.deepEqual(violations, []);
  });
});

describe('dsh-ssf ssf_handoff', () => {
  it('registers ssf_handoff with correct parameters and output schema', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const tool = registered.ssf_handoff;
    assert.ok(tool);
    const cdRequired = tool.parameters.properties.changeDir.required === true || (tool.parameters.required ?? []).includes('changeDir');
    assert.equal(cdRequired, true);
    const actRequired = tool.parameters.properties.action.required === true || (tool.parameters.required ?? []).includes('action');
    assert.equal(actRequired, true);
    assert.deepEqual(tool.parameters.properties.action.enum, ['create', 'list', 'finish', 'resolve']);
    assert.deepEqual(tool.parameters.properties.type.enum, ['prototype', 'research', 'experiment']);
    assert.deepEqual(tool.parameters.properties.decision.enum, ['accept', 'reject', 'defer']);
    assert.equal(tool.parameters.properties.objective.type, 'string');
    assert.equal(tool.parameters.properties.expectedOutput.type, 'string');
    assert.equal(tool.parameters.properties.acceptance.type, 'string');
    assert.equal(tool.parameters.properties.id.type, 'string');
  });

  it('create -> argv handoff create changes/<name> --type <t> --objective <o> --expected-output <e> --acceptance <a> --json', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_handoff.execute({ changeDir: 'my-change', action: 'create', type: 'prototype', objective: 'Compare interactions', expectedOutput: 'Recommendation', acceptance: 'Evidence recorded' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 5), ['handoff', 'create', 'changes/my-change']);
    assert.equal(argv[argv.indexOf('--type') + 1], 'prototype');
    assert.equal(argv[argv.indexOf('--objective') + 1], 'Compare interactions');
    assert.equal(argv[argv.indexOf('--expected-output') + 1], 'Recommendation');
    assert.equal(argv[argv.indexOf('--acceptance') + 1], 'Evidence recorded');
    assert.ok(argv.includes('--json'));
  });

  it('create with research/experiment types', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_handoff.execute({ changeDir: 'my-change', action: 'create', type: 'research', objective: 'o', expectedOutput: 'e', acceptance: 'a' }, {});
    assert.equal(spawned[0].argv[spawned[0].argv.indexOf('--type') + 1], 'research');
    spawned.length = 0;
    await registered.ssf_handoff.execute({ changeDir: 'my-change', action: 'create', type: 'experiment', objective: 'o', expectedOutput: 'e', acceptance: 'a' }, {});
    assert.equal(spawned[0].argv[spawned[0].argv.indexOf('--type') + 1], 'experiment');
  });

  it('list -> argv handoff list changes/<name> --json', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_handoff.execute({ changeDir: 'my-change', action: 'list' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 5), ['handoff', 'list', 'changes/my-change']);
    assert.ok(argv.includes('--json'));
  });

  it('finish -> argv handoff finish changes/<name> <id> --json', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_handoff.execute({ changeDir: 'my-change', action: 'finish', id: 'h1' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 6), ['handoff', 'finish', 'changes/my-change', 'h1']);
    assert.ok(argv.includes('--json'));
  });

  it('resolve -> argv handoff resolve changes/<name> <id> --decision <d> --json', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_handoff.execute({ changeDir: 'my-change', action: 'resolve', id: 'h1', decision: 'accept' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 6), ['handoff', 'resolve', 'changes/my-change', 'h1']);
    assert.ok(argv.includes('--decision'));
    assert.equal(argv[argv.indexOf('--decision') + 1], 'accept');
    assert.ok(argv.includes('--json'));
  });

  it('create 缺 type/objective/expectedOutput/acceptance 时 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_handoff.execute({ changeDir: 'my-change', action: 'create', objective: 'o', expectedOutput: 'e', acceptance: 'a' }, {}), /type|objective|expectedOutput|acceptance/);
    await assert.rejects(() => registered.ssf_handoff.execute({ changeDir: 'my-change', action: 'create', type: 'prototype', expectedOutput: 'e', acceptance: 'a' }, {}), /objective/);
    await assert.rejects(() => registered.ssf_handoff.execute({ changeDir: 'my-change', action: 'create', type: 'prototype', objective: 'o', acceptance: 'a' }, {}), /expectedOutput/);
    await assert.rejects(() => registered.ssf_handoff.execute({ changeDir: 'my-change', action: 'create', type: 'prototype', objective: 'o', expectedOutput: 'e' }, {}), /acceptance/);
    assert.equal(spawned.length, 0);
  });

  it('finish 缺 id 时 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_handoff.execute({ changeDir: 'my-change', action: 'finish' }, {}), /id is required/);
    assert.equal(spawned.length, 0);
  });

  it('resolve 缺 id/decision 时 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_handoff.execute({ changeDir: 'my-change', action: 'resolve', decision: 'accept' }, {}), /id and decision are required|id/);
    await assert.rejects(() => registered.ssf_handoff.execute({ changeDir: 'my-change', action: 'resolve', id: 'h1' }, {}), /id and decision are required|decision/);
    assert.equal(spawned.length, 0);
  });

  it('非法枚举 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_handoff.execute({ changeDir: 'my-change', action: 'bad' }, {}), /invalid|must be one of/);
    await assert.rejects(() => registered.ssf_handoff.execute({ changeDir: 'my-change', action: 'create', type: 'bad', objective: 'o', expectedOutput: 'e', acceptance: 'a' }, {}), /type|invalid|must be one of/);
    await assert.rejects(() => registered.ssf_handoff.execute({ changeDir: 'my-change', action: 'resolve', id: 'h1', decision: 'bad' }, {}), /decision|invalid|must be one of/);
    assert.equal(spawned.length, 0);
  });

  it('非法 changeDir 抛 invalid changeDir 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    for (const bad of ['../escape', '/etc/passwd', 'a/../b', '']) {
      await assert.rejects(() => registered.ssf_handoff.execute({ changeDir: bad, action: 'list' }, {}), /invalid changeDir/);
    }
    assert.equal(spawned.length, 0);
  });

  it('返回信封结构 ok/exitCode/stdout/stderr/result 且 output.schema 验证通过', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true,"handoff":{"id":"h1"}}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_handoff.execute({ changeDir: 'my-change', action: 'list' }, {});
    assert.equal(value.ok, true);
    assert.equal(typeof value.exitCode, 'number');
    assert.equal(typeof value.stdout, 'string');
    assert.equal(typeof value.stderr, 'string');
    const { validateJsonSchemaValue } = await import('@deepseek-ai/dsh-tools');
    const violations = validateJsonSchemaValue(registered.ssf_handoff.output.schema, value, 'result');
    assert.deepEqual(violations, []);
  });
});

describe('dsh-ssf ssf_debug', () => {
  it('registers ssf_debug with correct parameters and output schema', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const tool = registered.ssf_debug;
    assert.ok(tool);
    const cdRequired = tool.parameters.properties.changeDir.required === true || (tool.parameters.required ?? []).includes('changeDir');
    assert.equal(cdRequired, true);
    const actRequired = tool.parameters.properties.action.required === true || (tool.parameters.required ?? []).includes('action');
    assert.equal(actRequired, true);
    assert.deepEqual(tool.parameters.properties.action.enum, ['record_attempt', 'show_attempts', 'escalate']);
    assert.deepEqual(tool.parameters.properties.decision.enum, ['continue', 'abandon']);
    assert.equal(tool.parameters.properties.id.type, 'string');
    assert.equal(tool.parameters.properties.summary.type, 'string');
    assert.equal(tool.parameters.properties.evidence.type, 'string');
    assert.equal(tool.parameters.properties.reason.type, 'string');
  });

  it('record_attempt -> argv debug attempt record changes/<name> --id <id> --summary <s> --evidence <e> --json', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_debug.execute({ changeDir: 'my-change', action: 'record_attempt', id: 'fix-1', summary: 'First fix failed', evidence: '/tmp/evidence.log' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 6), ['debug', 'attempt', 'record', 'changes/my-change']);
    assert.equal(argv[argv.indexOf('--id') + 1], 'fix-1');
    assert.equal(argv[argv.indexOf('--summary') + 1], 'First fix failed');
    assert.equal(argv[argv.indexOf('--evidence') + 1], '/tmp/evidence.log');
    assert.ok(argv.includes('--json'));
  });

  it('show_attempts -> argv debug attempt show changes/<name> --json', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_debug.execute({ changeDir: 'my-change', action: 'show_attempts' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 6), ['debug', 'attempt', 'show', 'changes/my-change']);
    assert.ok(argv.includes('--json'));
  });

  it('escalate -> argv debug escalate changes/<name> --decision <d> --reason <r> --confirm --json', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_debug.execute({ changeDir: 'my-change', action: 'escalate', decision: 'continue', reason: 'Three fixes failed' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 5), ['debug', 'escalate', 'changes/my-change']);
    assert.equal(argv[argv.indexOf('--decision') + 1], 'continue');
    assert.equal(argv[argv.indexOf('--reason') + 1], 'Three fixes failed');
    assert.ok(argv.includes('--confirm'));
    assert.ok(argv.includes('--json'));
  });

  it('escalate with decision abandon', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_debug.execute({ changeDir: 'my-change', action: 'escalate', decision: 'abandon', reason: 'Abandon reason' }, {});
    assert.equal(spawned[0].argv[spawned[0].argv.indexOf('--decision') + 1], 'abandon');
  });

  it('record_attempt 缺 id/summary/evidence 时 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_debug.execute({ changeDir: 'my-change', action: 'record_attempt', summary: 's', evidence: 'e' }, {}), /id, summary and evidence are required|id/);
    await assert.rejects(() => registered.ssf_debug.execute({ changeDir: 'my-change', action: 'record_attempt', id: 'id', evidence: 'e' }, {}), /id, summary and evidence are required|summary/);
    await assert.rejects(() => registered.ssf_debug.execute({ changeDir: 'my-change', action: 'record_attempt', id: 'id', summary: 's' }, {}), /id, summary and evidence are required|evidence/);
    assert.equal(spawned.length, 0);
  });

  it('escalate 缺 decision/reason 时 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_debug.execute({ changeDir: 'my-change', action: 'escalate', reason: 'r' }, {}), /decision and reason are required|decision/);
    await assert.rejects(() => registered.ssf_debug.execute({ changeDir: 'my-change', action: 'escalate', decision: 'continue' }, {}), /decision and reason are required|reason/);
    assert.equal(spawned.length, 0);
  });

  it('非法枚举 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_debug.execute({ changeDir: 'my-change', action: 'bad' }, {}), /invalid|must be one of/);
    await assert.rejects(() => registered.ssf_debug.execute({ changeDir: 'my-change', action: 'escalate', decision: 'bad', reason: 'r' }, {}), /decision|invalid|must be one of/);
    assert.equal(spawned.length, 0);
  });

  it('非法 changeDir 抛 invalid changeDir 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    for (const bad of ['../escape', '/etc/passwd', 'a/../b', '']) {
      await assert.rejects(() => registered.ssf_debug.execute({ changeDir: bad, action: 'show_attempts' }, {}), /invalid changeDir/);
    }
    assert.equal(spawned.length, 0);
  });

  it('返回信封结构 ok/exitCode/stdout/stderr/result 且 output.schema 验证通过', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true,"attempt":{"id":"fix-1"}}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_debug.execute({ changeDir: 'my-change', action: 'show_attempts' }, {});
    assert.equal(value.ok, true);
    assert.equal(typeof value.exitCode, 'number');
    assert.equal(typeof value.stdout, 'string');
    assert.equal(typeof value.stderr, 'string');
    const { validateJsonSchemaValue } = await import('@deepseek-ai/dsh-tools');
    const violations = validateJsonSchemaValue(registered.ssf_debug.output.schema, value, 'result');
    assert.deepEqual(violations, []);
  });

  it('走 cli-runner：spawn argv 头为 process.execPath 与仓库内脚本绝对路径', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_debug.execute({ changeDir: 'my-change', action: 'show_attempts' }, {});
    const argv = spawned[0].argv;
    assert.equal(argv[0], process.execPath);
    assert.ok(argv[1].endsWith('scripts/spec-superflow.mjs'));
    assert.equal(spawned[0].cwd, tempRoot);
  });
});

describe('dsh-ssf tools 共性 w3', () => {
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

  it('新增 4 工具与 cli-runner 导入在文件顶部', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const repoRoot = process.cwd();
    const src = readFileSync(join(repoRoot, 'packages/dsh-ssf/lib/tools.js'), 'utf-8');
    const top = src.slice(0, 1500);
    assert.ok(top.includes('createCliRunner'));
    assert.ok(top.includes('fileURLToPath'));
  });

  it('既有 9 工具契约不变：新增 4 工具后总数 13 且原有行为保持', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const ids = Object.keys(registered).sort();
    // w4 之后总数为 19（6 read + 12 write + ssf_run），保持原有 9 工具契约不变且新增 10 工具存在
    const expected = ['ssf_list','ssf_state','ssf_workflow','ssf_execution','ssf_validate','ssf_guard','ssf_run','ssf_state_write','ssf_workflow_write','ssf_execution_write','ssf_checkpoint','ssf_handoff','ssf_debug','ssf_isolate','ssf_finish','ssf_inject','ssf_sync','ssf_audit','ssf_runtime'].sort();
    assert.deepEqual(ids, expected);
    const listVal = await registered.ssf_list.execute({}, {});
    assert.equal(listVal.ok, true);
    // ensure new tools envelope schema验证
    for (const newId of ['ssf_execution_write','ssf_checkpoint','ssf_handoff','ssf_debug']) {
      const tool = registered[newId];
      assert.ok(tool);
      assert.equal(tool.output.schema.properties.ok.type, 'boolean');
      assert.equal(tool.output.schema.properties.exitCode.type, 'integer');
    }
  });

  it('w2 工具仍可用：ssf_state_write 与 ssf_workflow_write argv 不变', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_state_write.execute({ changeDir: 'my-change', action: 'init' }, {});
    assert.deepEqual(spawned[0].argv.slice(2, 5), ['state', 'init', 'changes/my-change']);
    spawned.length = 0;
    await registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'recommend', taskCount: 1 }, {});
    assert.deepEqual(spawned[0].argv.slice(2, 5), ['workflow', 'recommend', 'changes/my-change']);
  });
});
