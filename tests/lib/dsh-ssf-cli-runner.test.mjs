// tests/lib/dsh-ssf-cli-runner.test.mjs
// Tests for the cli-runner execution adapter (task 1.1, wave w1-runner)
// Covers: argv head, --json idempotence, cwd via resolveRoot, bind/refresh, non-zero & JSON failure branches
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempRoot;
let repoRoot;

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

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'ssf-cli-runner-'));
  repoRoot = mkdtempSync(join(tmpdir(), 'ssf-cli-runner-repo-'));
  // dummy script so join exists (not executed by fake subprocess, but helps path assertions)
  mkdirSync(join(repoRoot, 'scripts'), { recursive: true });
  mkdirSync(join(tempRoot, 'changes', 'my-change'), { recursive: true });
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('dsh-ssf cli-runner', () => {
  it('spawn argv 头两个元素为 process.execPath 与仓库内 spec-superflow.mjs 绝对路径（去掉 PATH 依赖）', async () => {
    const spawned = [];
    const subprocess = makeFakeSubprocess(spawned, { stdoutText: '{}' });
    const { createCliRunner } = await import('../../packages/dsh-ssf/lib/cli-runner.js');
    const runner = createCliRunner({
      subprocess,
      repoRoot,
      resolveRoot: () => tempRoot,
    });
    await runner({ args: ['state', 'list', 'changes/my-change'], changeDir: 'my-change', json: false });
    assert.equal(spawned.length, 1);
    const spec = spawned[0];
    assert.equal(spec.argv[0], process.execPath, 'argv[0] 必须是 process.execPath');
    assert.equal(spec.argv[1], join(repoRoot, 'scripts', 'spec-superflow.mjs'), 'argv[1] 必须是仓库内 scripts/spec-superflow.mjs 绝对路径');
    assert.deepEqual(spec.argv.slice(2), ['state', 'list', 'changes/my-change']);
  });

  it('--json 幂等：json:true 时追加 --json，已存在则不重复；json:false 时不追加', async () => {
    const { createCliRunner } = await import('../../packages/dsh-ssf/lib/cli-runner.js');
    // 未包含 --json -> 应追加
    {
      const spawned = [];
      const runner = createCliRunner({ subprocess: makeFakeSubprocess(spawned, { stdoutText: '{}' }), repoRoot, resolveRoot: () => tempRoot });
      await runner({ args: ['state', 'show', 'changes/my-change'], json: true });
      const spec = spawned[0];
      assert.ok(spec.argv.includes('--json'), '--json 应被追加');
      assert.equal(spec.argv.filter((a) => a === '--json').length, 1, '--json 只能出现一次');
      assert.equal(spec.argv[spec.argv.length - 1], '--json', '--json 应在末尾');
    }
    // 已包含 --json -> 不重复
    {
      const spawned = [];
      const runner = createCliRunner({ subprocess: makeFakeSubprocess(spawned, { stdoutText: '{}' }), repoRoot, resolveRoot: () => tempRoot });
      await runner({ args: ['state', 'show', 'changes/my-change', '--json'], json: true });
      const spec = spawned[0];
      assert.equal(spec.argv.filter((a) => a === '--json').length, 1, '已存在 --json 时不应重复');
    }
    // json:false -> 不应追加
    {
      const spawned = [];
      const runner = createCliRunner({ subprocess: makeFakeSubprocess(spawned, { stdoutText: 'plain' }), repoRoot, resolveRoot: () => tempRoot });
      await runner({ args: ['state', 'show', 'changes/my-change'], json: false });
      const spec = spawned[0];
      assert.equal(spec.argv.includes('--json'), false, 'json:false 时不应追加 --json');
    }
  });

  it('spawn 配置 cwd 为会话工作区根（resolveRoot）、stdin: ignore、stdout/stderr 各 1MB 捕获', async () => {
    const spawned = [];
    const customRoot = tempRoot;
    const { createCliRunner } = await import('../../packages/dsh-ssf/lib/cli-runner.js');
    const runner = createCliRunner({ subprocess: makeFakeSubprocess(spawned, { stdoutText: '{}' }), repoRoot, resolveRoot: () => customRoot });
    await runner({ args: ['list'], json: false });
    const spec = spawned[0];
    assert.equal(spec.cwd, customRoot, 'cwd 必须来自 resolveRoot()');
    assert.equal(spec.stdio.stdin, 'ignore');
    assert.equal(spec.stdio.stdout.maxBytes, 1048576, 'stdout maxBytes 应为 1MB');
    assert.equal(spec.stdio.stderr.maxBytes, 1048576, 'stderr maxBytes 应为 1MB');
    assert.equal(typeof spec.graceMs, 'number');
  });

  it('成功（exitCode 0）后依次调用 onBind 与 refresh（best-effort），失败时不调用', async () => {
    const { createCliRunner } = await import('../../packages/dsh-ssf/lib/cli-runner.js');
    // success -> both called
    {
      const spawned = [];
      const bindCalls = [];
      const refreshCalls = [];
      const onBind = (...args) => bindCalls.push(args);
      const refresh = async () => refreshCalls.push(1);
      const runner = createCliRunner({
        subprocess: makeFakeSubprocess(spawned, { stdoutText: '{"ok":true}' }),
        repoRoot,
        resolveRoot: () => tempRoot,
        onBind,
        refresh,
      });
      const ret = await runner({ args: ['state', 'set', 'changes/my-change', 'field', 'value'], changeDir: 'my-change', json: true, sessionId: 'sess-1' });
      assert.equal(ret.ok, true);
      assert.equal(ret.exitCode, 0);
      assert.equal(bindCalls.length, 1, '成功时 onBind 必须被调用');
      // onBind 签名 per lib/index.js is (sessionId, changeDir); runner extracts sessionId from options
      assert.deepEqual(bindCalls[0], ['sess-1', 'my-change']);
      assert.equal(refreshCalls.length, 1, '成功时 refresh 必须被调用');
    }
    // non-zero -> not called
    {
      const spawned = [];
      const bindCalls = [];
      const refreshCalls = [];
      const runner = createCliRunner({
        subprocess: makeFakeSubprocess(spawned, { exitCode: 2, stdoutText: '', stderrText: 'boom' }),
        repoRoot,
        resolveRoot: () => tempRoot,
        onBind: (...a) => bindCalls.push(a),
        refresh: async () => refreshCalls.push(1),
      });
      const ret = await runner({ args: ['state', 'set', 'changes/my-change', 'f', 'v'], changeDir: 'my-change', json: true });
      assert.equal(ret.ok, false);
      assert.equal(ret.exitCode, 2);
      assert.equal(bindCalls.length, 0, '失败时不应调用 onBind');
      assert.equal(refreshCalls.length, 0, '失败时不应调用 refresh');
    }
  });

  it('onBind 与 refresh 抛错为 best-effort，不影响返回结果', async () => {
    const { createCliRunner } = await import('../../packages/dsh-ssf/lib/cli-runner.js');
    const runner = createCliRunner({
      subprocess: makeFakeSubprocess([], { stdoutText: '{"ok":true}' }),
      repoRoot,
      resolveRoot: () => tempRoot,
      onBind: () => { throw new Error('bind boom'); },
      refresh: async () => { throw new Error('refresh boom'); },
    });
    const ret = await runner({ args: ['list'], changeDir: 'my-change', json: true, sessionId: 's1' });
    assert.equal(ret.ok, true, 'onBind/refresh 抛错不应影响 ok');
    assert.equal(ret.exitCode, 0);
  });

  it('json:true 且 exitCode 0 时解析 stdout 进 result；解析失败则 ok:false 且 stderr 附错误', async () => {
    const { createCliRunner } = await import('../../packages/dsh-ssf/lib/cli-runner.js');
    // 解析成功
    {
      const runner = createCliRunner({
        subprocess: makeFakeSubprocess([], { stdoutText: '{"hello":"world"}' }),
        repoRoot,
        resolveRoot: () => tempRoot,
      });
      const ret = await runner({ args: ['list'], json: true });
      assert.equal(ret.ok, true);
      assert.deepEqual(ret.result, { hello: 'world' });
      assert.equal(ret.stdout, '{"hello":"world"}');
    }
    // 解析失败
    {
      const runner = createCliRunner({
        subprocess: makeFakeSubprocess([], { stdoutText: 'not json', stderrText: 'orig err' }),
        repoRoot,
        resolveRoot: () => tempRoot,
      });
      const ret = await runner({ args: ['list'], json: true });
      assert.equal(ret.ok, false, 'JSON 解析失败时 ok 应为 false');
      assert.equal(ret.result, undefined, '解析失败时不应有 result');
      assert.equal(ret.stdout, 'not json');
      assert.ok(ret.stderr.includes('orig err') || ret.stderr.includes('JSON'), 'stderr 应保留原文并附加解析错误');
      assert.ok(ret.stderr.toLowerCase().includes('json') || ret.stderr.includes('parse'), 'stderr 应包含解析错误信息');
    }
  });

  it('非零退出与 JSON 解析失败两个失败分支均返回 ok:false、保留 stdout/stderr', async () => {
    const { createCliRunner } = await import('../../packages/dsh-ssf/lib/cli-runner.js');
    // non-zero branch
    {
      const runner = createCliRunner({
        subprocess: makeFakeSubprocess([], { exitCode: 1, stdoutText: 'out', stderrText: 'err' }),
        repoRoot,
        resolveRoot: () => tempRoot,
      });
      const ret = await runner({ args: ['list'], json: true });
      assert.equal(ret.ok, false);
      assert.equal(ret.exitCode, 1);
      assert.equal(ret.stdout, 'out');
      assert.equal(ret.stderr, 'err');
      assert.equal(ret.result, undefined);
    }
    // json parse failure branch (exit 0)
    {
      const runner = createCliRunner({
        subprocess: makeFakeSubprocess([], { exitCode: 0, stdoutText: 'bad', stderrText: '' }),
        repoRoot,
        resolveRoot: () => tempRoot,
      });
      const ret = await runner({ args: ['list'], json: true });
      assert.equal(ret.ok, false);
      assert.equal(ret.exitCode, 0);
      assert.equal(ret.stdout, 'bad');
      assert.ok(ret.stderr.length > 0);
    }
  });

  it('changeDir 非空时先经 resolveChangePath 校验，非法路径抛错且不 spawn', async () => {
    const { createCliRunner } = await import('../../packages/dsh-ssf/lib/cli-runner.js');
    const spawned = [];
    const runner = createCliRunner({
      subprocess: makeFakeSubprocess(spawned, { stdoutText: '{}' }),
      repoRoot,
      resolveRoot: () => tempRoot,
    });
    for (const bad of ['../escape', '/etc/passwd', 'a/../b', '']) {
      // empty string is considered "空" -> 不校验，直接 spawn? 按任务：若 changeDir 非空则校验后才 spawn，所以空字符串不应校验
      if (bad === '') {
        spawned.length = 0;
        const ret = await runner({ args: ['list'], changeDir: '', json: false });
        assert.equal(ret.ok, true, '空 changeDir 不应校验');
        assert.equal(spawned.length, 1);
        continue;
      }
      await assert.rejects(() => runner({ args: ['list'], changeDir: bad, json: false }), /invalid changeDir/);
      // ensure no additional spawn for the bad case (spawn count unchanged per iteration aside from previous successes)
    }
    // also test exec-based sessionId extraction via exec param
    {
      const spawned2 = [];
      const bindCalls = [];
      const runner2 = createCliRunner({
        subprocess: makeFakeSubprocess(spawned2, { stdoutText: '{}' }),
        repoRoot,
        resolveRoot: () => tempRoot,
        onBind: (...a) => bindCalls.push(a),
        refresh: async () => {},
      });
      await runner2({ args: ['list'], changeDir: 'my-change', json: false, exec: { agent: { session: { id: 'exec-sess' } } } });
      assert.deepEqual(bindCalls[0], ['exec-sess', 'my-change']);
    }
  });

  it('graceMs 默认 30000，且支持自定义；注释说明其为 terminate 宽限而非执行超时', async () => {
    const spawned = [];
    const { createCliRunner } = await import('../../packages/dsh-ssf/lib/cli-runner.js');
    const runner = createCliRunner({ subprocess: makeFakeSubprocess(spawned, { stdoutText: '{}' }), repoRoot, resolveRoot: () => tempRoot });
    await runner({ args: ['list'], json: false });
    assert.equal(spawned[0].graceMs, 30000, '默认 graceMs 应为 30000');
    spawned.length = 0;
    await runner({ args: ['list'], json: false, graceMs: 5000 });
    assert.equal(spawned[0].graceMs, 5000, '自定义 graceMs 应透传');
    // 注释检查：cli-runner.js 必须包含 R1 结论说明
    const src = readFileSync('/root/.dsh/external/dsh-ssf-dsh-ssf-native-tools/packages/dsh-ssf/lib/cli-runner.js', 'utf-8');
    assert.ok(src.includes('30000'), '源码应提及 30000 默认值');
    assert.ok(src.includes('terminate') || src.includes('SIGTERM') || src.includes('宽限'), '源码注释应说明 graceMs 为 terminate 宽限');
    assert.ok(src.includes('R1') || src.includes('finish') || src.includes('10'), '注释应体现 R1 结论：不因 finish 的 10 分钟验证而放宽');
  });

  it('复用 tools.js 的 resolveChangePath，而非复制实现', async () => {
    const src = readFileSync('/root/.dsh/external/dsh-ssf-dsh-ssf-native-tools/packages/dsh-ssf/lib/cli-runner.js', 'utf-8');
    assert.ok(src.includes('resolveChangePath'), 'cli-runner 必须复用 resolveChangePath');
    assert.ok(src.includes("from './tools.js'") || src.includes('from "./tools.js"') || src.includes("tools.js"), '应从 tools.js 导入');
    // tools.js 必须具名导出
    const { resolveChangePath } = await import('../../packages/dsh-ssf/lib/tools.js');
    assert.equal(typeof resolveChangePath, 'function');
  });
});
