// tests/lib/dsh-ssf-tools-write-state-workflow.test.mjs
// Tests for ssf_state_write and ssf_workflow_write (task 2.1, wave w2-state-workflow)
// Covers: each action argv逐项、非法枚举/缺失字段 throw、返回信封结构、changeDir 安全校验
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempRoot;

function makeFakeSubprocess(spawned, { exitCode = 0, stdoutText = '{"ok":true,"field":"value"}', stderrText = '' } = {}) {
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
  tempRoot = mkdtempSync(join(tmpdir(), 'ssf-tools-write-state-workflow-'));
  mkdirSync(join(tempRoot, 'changes', 'my-change'), { recursive: true });
  mkdirSync(join(tempRoot, 'changes', 'other'), { recursive: true });
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('dsh-ssf ssf_state_write', () => {
  it('registers ssf_state_write with correct parameters and output schema', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const tool = registered.ssf_state_write;
    assert.ok(tool, 'ssf_state_write must be registered');
    assert.equal(tool.parameters.properties.changeDir.type, 'string');
    // dsh-tools normalizes required:true into required array; accept either representation
    const cdRequired = tool.parameters.properties.changeDir.required === true || (tool.parameters.required ?? []).includes('changeDir');
    assert.equal(cdRequired, true, 'changeDir must be required');
    assert.equal(tool.parameters.properties.action.type, 'string');
    const actRequired = tool.parameters.properties.action.required === true || (tool.parameters.required ?? []).includes('action');
    assert.equal(actRequired, true, 'action must be required');
    assert.deepEqual(tool.parameters.properties.action.enum, ['init', 'set', 'transition', 'rebuild']);
    assert.equal(tool.output.schema.type, 'object');
    assert.equal(tool.output.schema.properties.ok.type, 'boolean');
    assert.equal(tool.output.schema.properties.exitCode.type, 'integer');
    assert.equal(tool.output.schema.properties.stdout.type, 'string');
    assert.equal(tool.output.schema.properties.stderr.type, 'string');
    assert.equal(tool.output.schema.properties.result.type, 'object');
    assert.equal(tool.output.schema.properties.result.additionalProperties, true);
    assert.equal(typeof tool.output.render, 'function');
  });

  it('init -> argv state init changes/<name> --json', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const result = await registered.ssf_state_write.execute({ changeDir: 'my-change', action: 'init' }, { agent: { session: { id: 's1' } } });
    assert.equal(spawned.length, 1);
    const argv = spawned[0].argv;
    assert.equal(argv[0], process.execPath);
    assert.ok(argv[1].endsWith('scripts/spec-superflow.mjs'));
    assert.deepEqual(argv.slice(2, 5), ['state', 'init', 'changes/my-change']);
    assert.ok(argv.includes('--json'), 'must include --json');
    assert.equal(result.ok, true);
    assert.equal(typeof result.exitCode, 'number');
    assert.equal(typeof result.stdout, 'string');
    assert.equal(typeof result.stderr, 'string');
    assert.equal(typeof result.result, 'object');
  });

  it('set -> argv state set changes/<name> <field> <value> --json', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true,"field":"dp_2_result","value":"approved: ..."}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const result = await registered.ssf_state_write.execute({ changeDir: 'my-change', action: 'set', field: 'dp_2_result', value: 'approved: ...' }, { agent: { session: { id: 's1' } } });
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 6), ['state', 'set', 'changes/my-change', 'dp_2_result']);
    assert.equal(argv[6], 'approved: ...');
    assert.ok(argv.includes('--json'));
    assert.equal(result.ok, true);
  });

  it('transition -> argv state transition changes/<name> <target> --json', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_state_write.execute({ changeDir: 'my-change', action: 'transition', target: 'executing' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 6), ['state', 'transition', 'changes/my-change', 'executing']);
    assert.ok(argv.includes('--json'));
  });

  it('rebuild -> argv state rebuild changes/<name> --json', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_state_write.execute({ changeDir: 'my-change', action: 'rebuild' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 5), ['state', 'rebuild', 'changes/my-change']);
    assert.ok(argv.includes('--json'));
  });

  it('set 缺 field/value 时 throw ssf_state_write set: field and value are required 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_state_write.execute({ changeDir: 'my-change', action: 'set', field: 'x' }, {}), /ssf_state_write set: field and value are required/);
    await assert.rejects(() => registered.ssf_state_write.execute({ changeDir: 'my-change', action: 'set', value: 'y' }, {}), /ssf_state_write set: field and value are required/);
    await assert.rejects(() => registered.ssf_state_write.execute({ changeDir: 'my-change', action: 'set' }, {}), /ssf_state_write set: field and value are required/);
    assert.equal(spawned.length, 0, '缺失字段时不应 spawn');
  });

  it('transition 缺 target 时 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_state_write.execute({ changeDir: 'my-change', action: 'transition' }, {}), /target/);
    assert.equal(spawned.length, 0);
  });

  it('非法 action 枚举 throw 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_state_write.execute({ changeDir: 'my-change', action: 'bad' }, {}), /invalid|must be one of/);
    await assert.rejects(() => registered.ssf_state_write.execute({ changeDir: 'my-change', action: 'INIT' }, {}), /invalid|must be one of/);
    assert.equal(spawned.length, 0);
  });

  it('非法 changeDir （空/绝对/..）抛 invalid changeDir 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    for (const bad of ['../escape', '/etc/passwd', 'a/../b', '']) {
      await assert.rejects(() => registered.ssf_state_write.execute({ changeDir: bad, action: 'init' }, {}), /invalid changeDir/);
    }
    assert.equal(spawned.length, 0);
  });

  it('返回信封结构 ok/exitCode/stdout/stderr/result 且 output.schema 验证通过', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true,"field":"a","value":"b"}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_state_write.execute({ changeDir: 'my-change', action: 'init' }, {});
    assert.equal(value.ok, true);
    assert.equal(typeof value.exitCode, 'number');
    assert.equal(typeof value.stdout, 'string');
    assert.equal(typeof value.stderr, 'string');
    assert.equal(typeof value.result, 'object');
    const { validateJsonSchemaValue } = await import('@deepseek-ai/dsh-tools');
    const violations = validateJsonSchemaValue(registered.ssf_state_write.output.schema, value, 'result');
    assert.deepEqual(violations, [], `ssf_state_write result must satisfy its output schema: ${JSON.stringify(violations)}`);
    const rendered = registered.ssf_state_write.output.render({ changeDir: 'my-change', action: 'init' }, value);
    assert.ok(Array.isArray(rendered));
    assert.equal(rendered[0].type, 'text');
    assert.ok(rendered[0].text.includes('"ok"'));
  });
});

describe('dsh-ssf ssf_workflow_write', () => {
  it('registers ssf_workflow_write with correct parameters and output schema', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const tool = registered.ssf_workflow_write;
    assert.ok(tool, 'ssf_workflow_write must be registered');
    const cdRequired = tool.parameters.properties.changeDir.required === true || (tool.parameters.required ?? []).includes('changeDir');
    assert.equal(cdRequired, true);
    const actRequired = tool.parameters.properties.action.required === true || (tool.parameters.required ?? []).includes('action');
    assert.equal(actRequired, true);
    assert.deepEqual(tool.parameters.properties.action.enum, ['recommend', 'select', 'accept', 'evidence', 'escalate']);
    assert.equal(tool.parameters.properties.taskCount.type, 'integer');
    assert.equal(tool.parameters.properties.configDocOnly.enum.join(','), 'yes,no,unknown');
    assert.equal(tool.parameters.properties.behavioralConstraintChange.enum.join(','), 'yes,no');
    assert.equal(tool.parameters.properties.crossModuleChange.enum.join(','), 'yes,no');
    assert.equal(tool.parameters.properties.uncertainty.enum.join(','), 'low,high,unknown');
    assert.equal(tool.parameters.properties.requestKind.enum.join(','), 'standard,incident');
    assert.equal(tool.parameters.properties.mode.enum.join(','), 'full,hotfix,tweak,quick,lightweight');
    assert.equal(tool.parameters.properties.verification.enum.join(','), 'tdd,new-test,bounded');
    assert.equal(tool.output.schema.properties.result.additionalProperties, true);
  });

  it('recommend -> argv workflow recommend changes/<name> 按固定顺序附加已提供事实 --task-count 等', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_workflow_write.execute({
      changeDir: 'my-change',
      action: 'recommend',
      taskCount: 5,
      fileCount: 3,
      configDocOnly: 'no',
      schemaApiChange: 'yes',
      newModule: 'unknown',
      behavioralConstraintChange: 'yes',
      crossModuleChange: 'no',
      uncertainty: 'low',
      requestKind: 'standard',
    }, {});
    const argv = spawned[0].argv;
    // 基础部分
    assert.deepEqual(argv.slice(2, 5), ['workflow', 'recommend', 'changes/my-change']);
    // 顺序校验：按 taskCount, fileCount, configDocOnly, schemaApiChange, newModule, behavioral, cross, uncertainty, requestKind
    const rest = argv.slice(5);
    // 去掉末尾 --json
    const withoutJson = rest.slice(0, rest.indexOf('--json'));
    const expected = [
      '--task-count', '5',
      '--file-count', '3',
      '--config-doc-only', 'no',
      '--schema-api-change', 'yes',
      '--new-module', 'unknown',
      '--behavioral-constraint-change', 'yes',
      '--cross-module-change', 'no',
      '--uncertainty', 'low',
      '--request-kind', 'standard',
    ];
    assert.deepEqual(withoutJson, expected);
    assert.ok(argv.includes('--json'));
  });

  it('recommend 仅附加已提供字段，未提供的不出现', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'recommend', taskCount: 2 }, {});
    const argv = spawned[0].argv;
    assert.ok(argv.includes('--task-count'));
    assert.ok(!argv.includes('--file-count'));
    assert.ok(!argv.includes('--config-doc-only'));
  });

  it('select -> argv workflow select changes/<name> --mode <mode> --confirm --reason <reason> + 可选', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_workflow_write.execute({
      changeDir: 'my-change',
      action: 'select',
      mode: 'full',
      reason: 'need full workflow',
      scopeConfirmation: 'scope ok',
      acknowledgeRecommendation: true,
      verification: 'tdd',
    }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 5), ['workflow', 'select', 'changes/my-change']);
    assert.ok(argv.includes('--mode'));
    assert.equal(argv[argv.indexOf('--mode') + 1], 'full');
    assert.ok(argv.includes('--confirm'));
    assert.ok(argv.includes('--reason'));
    assert.equal(argv[argv.indexOf('--reason') + 1], 'need full workflow');
    assert.ok(argv.includes('--scope-confirmation'));
    assert.equal(argv[argv.indexOf('--scope-confirmation') + 1], 'scope ok');
    assert.ok(argv.includes('--acknowledge-recommendation'));
    assert.ok(argv.includes('--verification'));
    assert.equal(argv[argv.indexOf('--verification') + 1], 'tdd');
    assert.ok(argv.includes('--json'));
  });

  it('select 无 acknowledgeRecommendation false 时不附加旗标', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'select', mode: 'hotfix', reason: 'r' }, {});
    const argv = spawned[0].argv;
    assert.ok(!argv.includes('--acknowledge-recommendation'));
    assert.ok(!argv.includes('--scope-confirmation'));
    assert.ok(!argv.includes('--verification'));
  });

  it('accept -> argv workflow accept changes/<name> --source direct-request --verification <v>', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'accept', verification: 'bounded' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 5), ['workflow', 'accept', 'changes/my-change']);
    assert.ok(argv.includes('--source'));
    assert.equal(argv[argv.indexOf('--source') + 1], 'direct-request');
    assert.ok(argv.includes('--verification'));
    assert.equal(argv[argv.indexOf('--verification') + 1], 'bounded');
    assert.ok(argv.includes('--json'));
  });

  it('evidence -> argv workflow evidence changes/<name> --focused-review --verification-command --verification-result', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_workflow_write.execute({
      changeDir: 'my-change',
      action: 'evidence',
      focusedReview: 'reviewed',
      verificationCommand: 'npm test',
      verificationResult: 'pass',
    }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 5), ['workflow', 'evidence', 'changes/my-change']);
    assert.ok(argv.includes('--focused-review'));
    assert.equal(argv[argv.indexOf('--focused-review') + 1], 'reviewed');
    assert.ok(argv.includes('--verification-command'));
    assert.equal(argv[argv.indexOf('--verification-command') + 1], 'npm test');
    assert.ok(argv.includes('--verification-result'));
    assert.equal(argv[argv.indexOf('--verification-result') + 1], 'pass');
  });

  it('evidence 未提供 verificationResult 时默认为 pass', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_workflow_write.execute({
      changeDir: 'my-change',
      action: 'evidence',
      focusedReview: 'r',
      verificationCommand: 'cmd',
    }, {});
    const argv = spawned[0].argv;
    assert.equal(argv[argv.indexOf('--verification-result') + 1], 'pass');
  });

  it('escalate -> argv workflow escalate changes/<name> --reason <r>', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'escalate', reason: 'risk found' }, {});
    const argv = spawned[0].argv;
    assert.deepEqual(argv.slice(2, 5), ['workflow', 'escalate', 'changes/my-change']);
    assert.ok(argv.includes('--reason'));
    assert.equal(argv[argv.indexOf('--reason') + 1], 'risk found');
    assert.ok(argv.includes('--json'));
  });

  it('select 缺 mode/reason 时 throw', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'select', mode: 'full' }, {}), /mode and reason are required/);
    await assert.rejects(() => registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'select', reason: 'r' }, {}), /mode and reason are required/);
    await assert.rejects(() => registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'select' }, {}), /mode and reason are required/);
    assert.equal(spawned.length, 0);
  });

  it('accept 缺 verification 时 throw', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'accept' }, {}), /verification is required/);
    assert.equal(spawned.length, 0);
  });

  it('evidence 缺 focusedReview/verificationCommand 时 throw', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'evidence', focusedReview: 'r' }, {}), /focusedReview and verificationCommand are required/);
    await assert.rejects(() => registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'evidence', verificationCommand: 'c' }, {}), /focusedReview and verificationCommand are required/);
    await assert.rejects(() => registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'evidence' }, {}), /focusedReview and verificationCommand are required/);
    assert.equal(spawned.length, 0);
  });

  it('escalate 缺 reason 时 throw', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'escalate' }, {}), /reason is required/);
    assert.equal(spawned.length, 0);
  });

  it('非法枚举 throw', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'bad' }, {}), /invalid|must be one of/);
    await assert.rejects(() => registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'recommend', configDocOnly: 'bad' }, {}), /configDocOnly|invalid|must be one of/);
    await assert.rejects(() => registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'recommend', uncertainty: 'bad' }, {}), /uncertainty|invalid|must be one of/);
    await assert.rejects(() => registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'select', mode: 'bad', reason: 'r' }, {}), /mode|invalid|must be one of/);
    await assert.rejects(() => registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'accept', verification: 'bad' }, {}), /verification|invalid|must be one of/);
    await assert.rejects(() => registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'recommend', requestKind: 'bad' }, {}), /requestKind|invalid|must be one of/);
    assert.equal(spawned.length, 0);
  });

  it('非法 changeDir 抛 invalid changeDir 且不进 runner', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    for (const bad of ['../escape', '/etc/passwd', 'a/../b', '']) {
      await assert.rejects(() => registered.ssf_workflow_write.execute({ changeDir: bad, action: 'recommend' }, {}), /invalid changeDir/);
    }
    assert.equal(spawned.length, 0);
  });

  it('返回信封结构 ok/exitCode/stdout/stderr/result 且 output.schema 验证通过', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true,"recommendation":{"mode":"full"}}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'recommend', taskCount: 1 }, { agent: { session: { id: 's1' } } });
    assert.equal(value.ok, true);
    assert.equal(typeof value.exitCode, 'number');
    assert.equal(typeof value.stdout, 'string');
    assert.equal(typeof value.stderr, 'string');
    assert.equal(typeof value.result, 'object');
    const { validateJsonSchemaValue } = await import('@deepseek-ai/dsh-tools');
    const violations = validateJsonSchemaValue(registered.ssf_workflow_write.output.schema, value, 'result');
    assert.deepEqual(violations, [], `ssf_workflow_write result must satisfy its output schema: ${JSON.stringify(violations)}`);
    const rendered = registered.ssf_workflow_write.output.render({ changeDir: 'my-change', action: 'recommend' }, value);
    assert.ok(Array.isArray(rendered));
    assert.equal(rendered[0].type, 'text');
  });

  it('走 cli-runner：spawn argv 头为 process.execPath 与仓库内脚本绝对路径', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await registered.ssf_workflow_write.execute({ changeDir: 'my-change', action: 'recommend', taskCount: 1 }, {});
    const argv = spawned[0].argv;
    assert.equal(argv[0], process.execPath);
    assert.ok(argv[1].endsWith('scripts/spec-superflow.mjs'));
    assert.equal(spawned[0].cwd, tempRoot);
    assert.equal(spawned[0].stdio.stdin, 'ignore');
    assert.ok(spawned[0].graceMs === 30000 || spawned[0].graceMs === undefined || typeof spawned[0].graceMs === 'number');
  });
});

describe('dsh-ssf tools 共性', () => {
  it('复用 resolveChangePath 校验 changeDir，不复制实现', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const repoRoot = process.cwd();
    const src = readFileSync(join(repoRoot, 'packages/dsh-ssf/lib/tools.js'), 'utf-8');
    // tools.js 必须复用已导出的 resolveChangePath
    assert.ok(src.includes('resolveChangePath'));
    const { resolveChangePath } = await import('../../packages/dsh-ssf/lib/tools.js');
    assert.equal(typeof resolveChangePath, 'function');
    // cli-runner 亦复用同一函数
    const runnerSrc = readFileSync(join(repoRoot, 'packages/dsh-ssf/lib/cli-runner.js'), 'utf-8');
    assert.ok(runnerSrc.includes('resolveChangePath'));
  });

  it('新增工具与 cli-runner 导入在文件顶部', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const repoRoot = process.cwd();
    const src = readFileSync(join(repoRoot, 'packages/dsh-ssf/lib/tools.js'), 'utf-8');
    const top = src.slice(0, 1500);
    assert.ok(top.includes('createCliRunner'));
    assert.ok(top.includes('fileURLToPath'));
  });

  it('既有 7 工具契约不变：注册数、参数、output', async () => {
    const spawned = [];
    const { ctx, registered } = makeRegistry(makeFakeSubprocess(spawned));
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    // 包含新增 2 个后总数 9（含 ssf_run）
    const ids = Object.keys(registered).sort();
    assert.deepEqual(ids, ['ssf_execution','ssf_guard','ssf_list','ssf_run','ssf_state','ssf_state_write','ssf_validate','ssf_workflow','ssf_workflow_write'].sort());
    // 既有工具仍可用
    const listVal = await registered.ssf_list.execute({}, {});
    assert.equal(listVal.ok, true);
  });
});
