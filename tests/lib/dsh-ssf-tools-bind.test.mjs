// tests/lib/dsh-ssf-tools-bind.test.mjs
// Tests for conversation ↔ flow binding via lib/tools.js (notifyBind / onBind)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempRoot;

function writeStateFile(dir, fields) {
  const lines = [];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${value}`);
  }
  writeFileSync(join(dir, '.spec-superflow.yaml'), lines.join('\n'));
}

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
  tempRoot = mkdtempSync(join(tmpdir(), 'ssf-tools-bind-'));
  const changesDir = join(tempRoot, 'changes');
  mkdirSync(join(changesDir, 'changeA'), { recursive: true });
  writeStateFile(join(changesDir, 'changeA'), {
    state: 'executing',
    workflow: 'full',
    last_transition: '2026-08-01T00:00:00Z',
  });
  // also create a generic change for ssf_run target (not needed on fs, but harmless)
  mkdirSync(join(changesDir, 'x'), { recursive: true });
  writeStateFile(join(changesDir, 'x'), { state: 'executing', workflow: 'full' });
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('dsh-ssf tools conversation binding', () => {
  it('结构化工具绑定：ssf_state 触发 onBind(sessionId, changeDir)', async () => {
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    const calls = [];
    const onBind = (...args) => calls.push(args);
    const { ctx, registered } = makeRegistry();
    registerTools(ctx, { resolveRoot: () => tempRoot, onBind });
    const value = await registered.ssf_state.execute({ changeDir: 'changeA' }, { agent: { session: { id: 's1' } } });
    assert.equal(value.ok, true);
    assert.equal(calls.length, 1, 'onBind 必须被调用一次');
    assert.deepEqual(calls[0], ['s1', 'changeA']);
  });

  it('exec 缺 agent/session 时不抛错且工具结果 ok（onBind 若被调用首参为 undefined）', async () => {
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    // 测试 exec = {} 的情况
    {
      const calls = [];
      const onBind = (...args) => calls.push(args);
      const { ctx, registered } = makeRegistry();
      registerTools(ctx, { resolveRoot: () => tempRoot, onBind });
      const value = await registered.ssf_state.execute({ changeDir: 'changeA' }, {});
      assert.equal(value.ok, true, '工具在 exec 为 {} 时仍应正常返回 ok');
      // notifyBind 实现为 onBind?.(exec?.agent?.session?.id, changeDir)，缺失时为 undefined；
      // onBind 若被调用则首参必为 undefined，宿主侧 bindSession 对 undefined 会 no-op。
      // 兼容两种断言：未调用或以 undefined 调用均视为符合预期。
      if (calls.length > 0) {
        assert.equal(calls[0][0], undefined, '缺失 session 时 onBind 若被调用，首参应为 undefined（宿主 no-op）');
        assert.equal(calls[0][1], 'changeA');
      } else {
        assert.equal(calls.length, 0);
      }
    }
    // 测试 exec = { agent: {} } 的情况
    {
      const calls = [];
      const onBind = (...args) => calls.push(args);
      const { ctx, registered } = makeRegistry();
      registerTools(ctx, { resolveRoot: () => tempRoot, onBind });
      const value = await registered.ssf_state.execute({ changeDir: 'changeA' }, { agent: {} });
      assert.equal(value.ok, true, '工具在 exec.agent 缺 session 时仍应正常返回 ok');
      if (calls.length > 0) {
        assert.equal(calls[0][0], undefined, '缺失 session 时 onBind 若被调用，首参应为 undefined（宿主 no-op）');
        assert.equal(calls[0][1], 'changeA');
      } else {
        assert.equal(calls.length, 0);
      }
    }
  });

  it('ssf_list 不触发绑定', async () => {
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    const calls = [];
    const onBind = (...args) => calls.push(args);
    const { ctx, registered } = makeRegistry();
    registerTools(ctx, { resolveRoot: () => tempRoot, onBind });
    const value = await registered.ssf_list.execute({}, { agent: { session: { id: 's1' } } });
    assert.equal(value.ok, true);
    assert.equal(calls.length, 0, 'ssf_list 不应触发 onBind');
    // 带 session 且带 filter 的形式也不应绑定（resolveChangePath 仅校验）
    const value2 = await registered.ssf_list.execute({ changeDir: 'changeA' }, { agent: { session: { id: 's1' } } });
    assert.equal(value2.ok, true);
    assert.equal(calls.length, 0, 'ssf_list 即使带 changeDir 过滤也不应触发绑定');
  });

  it('ssf_run 绑定：argv 中 changes/<name> 触发 onBind 并去掉前缀', async () => {
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    const calls = [];
    const onBind = (...args) => calls.push(args);
    const spawned = [];
    const subprocess = makeFakeSubprocess(spawned);
    const { ctx, registered } = makeRegistry(subprocess);
    registerTools(ctx, { resolveRoot: () => tempRoot, onBind });
    // 使用 SSF_COMMANDS 中已存在的合法子命令组合：handoff + changes/x
    const value = await registered.ssf_run.execute(
      { arguments: ['handoff', 'list', 'changes/x'] },
      { agent: { session: { id: 's1' } } },
    );
    assert.equal(value.ok, true);
    assert.equal(calls.length, 1, 'ssf_run 命中 changes/x 时应触发一次 onBind');
    assert.deepEqual(calls[0], ['s1', 'x'], 'onBind 的 change 名应去掉 changes/ 前缀');
    assert.equal(spawned.length, 1);
    assert.deepEqual(spawned[0].argv, ['ssf', 'handoff', 'list', 'changes/x']);
  });

  it('onBind 抛错不影响工具结果', async () => {
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    const onBind = () => { throw new Error('bind boom'); };
    const { ctx, registered } = makeRegistry();
    registerTools(ctx, { resolveRoot: () => tempRoot, onBind });
    const value = await registered.ssf_state.execute({ changeDir: 'changeA' }, { agent: { session: { id: 's1' } } });
    assert.equal(value.ok, true, 'onBind 抛错时工具仍应正常返回 ok');
    assert.equal(value.state.state, 'executing');
  });

  it('不传 onBind 时所有工具正常工作', async () => {
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    const { ctx, registered } = makeRegistry();
    // 仅提供 resolveRoot，不提供 onBind
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const vList = await registered.ssf_list.execute({}, { agent: { session: { id: 's1' } } });
    assert.equal(vList.ok, true);
    const vState = await registered.ssf_state.execute({ changeDir: 'changeA' }, { agent: { session: { id: 's1' } } });
    assert.equal(vState.ok, true);
    const vWorkflow = await registered.ssf_workflow.execute({ changeDir: 'changeA' }, { agent: { session: { id: 's1' } } });
    assert.equal(vWorkflow.ok, true);
    // ssf_run 也不需要 onBind
    const spawned = [];
    const subprocess = makeFakeSubprocess(spawned);
    const { ctx: ctx2, registered: reg2 } = makeRegistry(subprocess);
    registerTools(ctx2, { resolveRoot: () => tempRoot });
    const vRun = await reg2.ssf_run.execute({ arguments: ['handoff', 'list', 'changes/x'] }, { agent: { session: { id: 's1' } } });
    assert.equal(vRun.ok, true);
    assert.equal(vRun.exitCode, 0);
  });

  it('ssf_run 未命中 changes/ 前缀时不触发绑定', async () => {
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    const calls = [];
    const onBind = (...args) => calls.push(args);
    const { ctx, registered } = makeRegistry();
    registerTools(ctx, { resolveRoot: () => tempRoot, onBind });
    const value = await registered.ssf_run.execute({ arguments: ['list'] }, { agent: { session: { id: 's1' } } });
    assert.equal(value.ok, true);
    assert.equal(calls.length, 0, '无 changes/<name> 参数的 ssf_run 不应触发绑定');
  });
});
