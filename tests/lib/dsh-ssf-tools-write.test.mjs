// tests/lib/dsh-ssf-tools-write.test.mjs
// Tests for the validate/guard/execution tool handlers (ssf_validate / ssf_guard / ssf_execution)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let repoRoot;
let tempRoot;

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

function makeChangeDir(root, name, { proposal = undefined, spec = undefined, state = undefined } = {}) {
  const dir = join(root, 'changes', name);
  mkdirSync(dir, { recursive: true });
  if (proposal !== undefined) writeFileSync(join(dir, 'proposal.md'), proposal);
  if (spec !== undefined) {
    mkdirSync(join(dir, 'specs', 'cap'), { recursive: true });
    writeFileSync(join(dir, 'specs', 'cap', 'spec.md'), spec);
  }
  if (state !== undefined) {
    const lines = Object.entries(state).map(([k, v]) => `${k}: ${v}`);
    writeFileSync(join(dir, '.spec-superflow.yaml'), lines.join('\n'));
  }
  return dir;
}

const GOOD_PROPOSAL = `# 示例

## 背景（Why）

这是一个足够长的背景描述，用来通过最小长度校验：至少五十个字符以上的实际内容才能满足提案校验规则的要求。

## 变更内容（What Changes）

- 增加一个示例能力。

## 范围（Scope）

### 范围内（In Scope）

- 示例。

### 范围外（Out of Scope）

- 反例。

## 影响与验证

- 完成证明：测试通过。
`;

const GOOD_SPEC = `## ADDED Requirements

### Requirement: 示例需求

The system SHALL 提供清晰且可测试的所需行为。

#### Scenario: 正常路径

- **WHEN** 触发动作发生
- **THEN** 系统产生预期结果
`;

const SHORT_PROPOSAL = `# 短提案

## 背景（Why）

太短。
`;

before(() => {
  repoRoot = process.cwd();
  tempRoot = mkdtempSync(join(tmpdir(), 'ssf-tools-write-'));
  makeChangeDir(tempRoot, 'good', { proposal: GOOD_PROPOSAL, spec: GOOD_SPEC, state: { state: 'executing', workflow: 'full' } });
  makeChangeDir(tempRoot, 'bad', { proposal: SHORT_PROPOSAL, state: { state: 'executing', workflow: 'full' } });
  // Hermetic copy of the repo's valid example change (tools only reach changes/).
  mkdirSync(join(tempRoot, 'changes'), { recursive: true });
  cpSync(join(repoRoot, 'docs/examples/add-dark-mode'), join(tempRoot, 'changes', 'add-dark-mode'), { recursive: true });
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('dsh-ssf ssf_validate', () => {
  it('returns a valid report for a copy of the repo example change (add-dark-mode)', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_validate.execute({ changeDir: 'add-dark-mode' }, {});
    assert.equal(value.ok, true);
    assert.equal(value.report.valid, true, JSON.stringify(value.report.issues));
    assert.ok(Array.isArray(value.report.issues));
    assert.equal(typeof value.report.summary.errors, 'number');
  });

  it('reports invalid for a change with a too-short proposal', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_validate.execute({ changeDir: 'bad' }, {});
    assert.equal(value.ok, true);
    assert.equal(value.report.valid, false);
    assert.ok(value.report.issues.length > 0);
  });

  it('rejects traversal changeDir', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(() => registered.ssf_validate.execute({ changeDir: '../escape' }, {}), /invalid changeDir/);
  });
});

describe('dsh-ssf ssf_guard', () => {
  it('returns a structured guard result for the real change (known false case)', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => repoRoot });
    // executing -> closing is blocked while tasks remain unchecked.
    const value = await registered.ssf_guard.execute(
      { changeDir: 'dsh-ssf-plugin', fromState: 'executing', toState: 'closing' },
      {},
    );
    assert.equal(value.ok, true);
    assert.equal(typeof value.guard.pass, 'boolean');
    assert.ok(Array.isArray(value.guard.checks));
    assert.ok(value.guard.checks.length > 0);
    const tasks = value.guard.checks.find((c) => c.dimension === 'tasks-complete');
    assert.ok(tasks, 'guard must report the tasks-complete dimension');
  });

  it('rejects traversal changeDir', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    await assert.rejects(
      () => registered.ssf_guard.execute({ changeDir: '../escape', fromState: 'a', toState: 'b' }, {}),
      /invalid changeDir/,
    );
  });
});

describe('dsh-ssf ssf_execution', () => {
  it('returns the current plan summary with waves for the real change', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => repoRoot });
    const value = await registered.ssf_execution.execute({ changeDir: 'dsh-ssf-plugin' }, {});
    assert.equal(value.ok, true);
    assert.equal(value.execution.current, true);
    assert.ok(Array.isArray(value.execution.waves));
    const w1 = value.execution.waves.find((w) => w.id === 'w1-host-core');
    assert.ok(w1, 'waves must include w1-host-core');
    assert.deepEqual(w1.strategy, 'serial');
    assert.ok(Array.isArray(w1.tasks));
    assert.equal(typeof w1.eligible, 'boolean');
  });

  it('reports no plan for a change without an execution plan', async () => {
    const { ctx, registered } = makeRegistry();
    const { registerTools } = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools(ctx, { resolveRoot: () => tempRoot });
    const value = await registered.ssf_execution.execute({ changeDir: 'good' }, {});
    assert.equal(value.ok, true);
    assert.equal(value.execution.current, false);
    assert.deepEqual(value.execution.waves, []);
  });
});
