// tests/lib/cmd-state.test.mjs
// Tests for scripts/lib/cmd-state.mjs
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, chmodSync, cpSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, execFileSync, spawnSync } from 'node:child_process';
import { readState, writeState } from '../../scripts/lib/state-loader.mjs';

const CLI_PATH = join(process.cwd(), 'scripts/spec-superflow.mjs');
let tempDir;

function ssf(args, options = {}) {
  const result = spawnSync(`${shellQuote(process.execPath)} ${shellQuote(CLI_PATH)} ${args}`, {
    shell: true,
    encoding: 'utf-8',
    ...options,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  };
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

describe('cmd-state: init', () => {
  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-state-cmd-'));
    // Create minimal artifacts for hash computation
    writeFileSync(join(tempDir, 'proposal.md'), '## Why\nTest proposal for state command testing, needs to be long enough for validation rules\n## What Changes\n- Add feature X');
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates .spec-superflow.yaml with hashes', () => {
    const result = ssf(`state init ${tempDir}`);
    assert.equal(result.exitCode, 0, `Expected exit 0 but got ${result.exitCode}: ${result.stderr}`);

    const stateFile = join(tempDir, '.spec-superflow.yaml');
    assert.ok(existsSync(stateFile));
  });

  it('reports artifacts_hash in init output', () => {
    const result = ssf(`state init ${tempDir}`);
    assert.ok(result.stdout.includes('artifacts_hash'));
  });

  it('--json flag outputs JSON with ok: true', () => {
    const result = ssf(`state init ${tempDir} --json`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.artifacts_hash.startsWith('sha256:'));
  });
});

describe('cmd-state: check', () => {
  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-state-check-'));
    writeFileSync(join(tempDir, 'proposal.md'), '## Why\nTest proposal for state checking with enough chars to pass validation rules.\n## What Changes\n- Feature X');
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports consistent after init', () => {
    ssf(`state init ${tempDir}`);
    const result = ssf(`state check ${tempDir}`);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('consistent'));
  });

  it('reports inconsistent after artifact change', () => {
    ssf(`state init ${tempDir}`);
    // Modify an artifact
    writeFileSync(join(tempDir, 'proposal.md'), '## Why\nModified proposal with different content for inconsistency testing.\n## What Changes\n- Modified feature');
    const result = ssf(`state check ${tempDir}`);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stdout.includes('INCONSISTENT'));
  });

  it('--json outputs structured data', () => {
    ssf(`state init ${tempDir}`);
    const result = ssf(`state check ${tempDir} --json`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.consistent, true);
    assert.ok(parsed.stored_hash);
    assert.ok(parsed.current_hash);
    assert.equal(parsed.state, 'exploring');
  });
});

describe('cmd-state: transition', () => {
  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-state-trans-'));
    writeFileSync(join(tempDir, 'proposal.md'), '## Why\nTest proposal for state transition validation, meeting the minimum length requirement.\n## What Changes\n- Add feature');
    writeFileSync(join(tempDir, 'design.md'), '# Design\n## Context\nTest.\n## Goals\nTest.\n## Decisions\n### D1\n- Choice: Test\n- Rationale: Test\n\n## Risks And Trade-Offs\nNone.');
    writeFileSync(join(tempDir, 'tasks.md'), '# Tasks\n- [x] Task 1');
    mkdirSync(join(tempDir, 'specs', 'test'), { recursive: true });
    writeFileSync(join(tempDir, 'specs', 'test', 'spec.md'), '## ADDED Requirements\n### Requirement: Test\nSHALL work.\n#### Scenario: Test\n- **WHEN** test\n- **THEN** test');
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('transitions from exploring to specifying', () => {
    ssf(`state init ${tempDir}`);
    ssf(`state set ${tempDir} dp_1_result "confirmed: transition test"`);
    const result = ssf(`state transition ${tempDir} specifying`);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('exploring -> specifying'));
    assert.equal(ssf(`state check ${tempDir}`).exitCode, 0, 'a successful transition must refresh artifact hashes');
  });

  it('allows a Full change to enter specifying before planning artifacts exist and refreshes hashes', () => {
    const emptyChange = mkdtempSync(join(tmpdir(), 'ssf-state-empty-specifying-'));
    try {
      assert.equal(ssf(`state init ${emptyChange}`).exitCode, 0);
      assert.equal(ssf(`state set ${emptyChange} workflow full`).exitCode, 0);
      assert.equal(ssf(`state set ${emptyChange} dp_1_result "confirmed: empty change"`).exitCode, 0);
      const transition = ssf(`state transition ${emptyChange} specifying`);
      assert.equal(transition.exitCode, 0, transition.stderr);
      assert.equal(ssf(`state check ${emptyChange}`).exitCode, 0);
    } finally {
      rmSync(emptyChange, { recursive: true, force: true });
    }
  });

  it('uses the caller project directory for a relative change path', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'ssf-state-relative-project-'));
    const changeDir = join(projectRoot, 'changes', 'relative-change');
    try {
      mkdirSync(join(changeDir, 'specs', 'test'), { recursive: true });
      writeFileSync(join(changeDir, 'proposal.md'), '## Why\nA relative path transition must inspect artifacts in the caller project, not the plugin directory.\n## What Changes\n- Add a transition fixture.');
      writeFileSync(join(changeDir, 'design.md'), '# Design\n## Context\nTest.\n## Goals\nTest.\n## Decisions\n### D1\n- Choice: Test\n- Rationale: Test\n\n## Risks And Trade-Offs\nNone.');
      writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n- [x] Task 1');
      writeFileSync(join(changeDir, 'specs', 'test', 'spec.md'), '## ADDED Requirements\n### Requirement: Relative transition\nThe system SHALL resolve relative change paths from the caller project.\n#### Scenario: Transition\n- **WHEN** a project invokes state transition with a relative path\n- **THEN** its artifacts are checked.');

      assert.equal(ssf('state init changes/relative-change', { cwd: projectRoot }).exitCode, 0);
      assert.equal(ssf('state set changes/relative-change dp_1_result "confirmed: relative transition"', { cwd: projectRoot }).exitCode, 0);
      const result = ssf('state transition changes/relative-change specifying', { cwd: projectRoot });

      assert.equal(result.exitCode, 0, result.stderr);
      assert.match(result.stdout, /exploring -> specifying/);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('--json outputs from/to', () => {
    // Re-init to ensure we start from exploring
    rmSync(join(tempDir, '.spec-superflow.yaml'), { force: true });
    ssf(`state init ${tempDir}`);
    ssf(`state set ${tempDir} dp_1_result "confirmed: json transition"`);
    // exploring→specifying is the next legal mainline transition
    const result = ssf(`state transition ${tempDir} specifying --json`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.from, 'exploring');
    assert.equal(parsed.to, 'specifying');
  });

  it('persists state across invocations', () => {
    ssf(`state init ${tempDir}`);
    ssf(`state set ${tempDir} dp_1_result "confirmed: persisted transition"`);
    // Legal transition: exploring → specifying
    ssf(`state transition ${tempDir} specifying`);

    // Check state persisted
    const result = ssf(`state check ${tempDir} --json`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.state, 'specifying');
  });

  it('uses the caller project directory for a relative change path', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'ssf-state-relative-project-'));
    const changeDir = join(projectRoot, 'changes', 'relative-change');
    try {
      mkdirSync(join(changeDir, 'specs', 'test'), { recursive: true });
      writeFileSync(join(changeDir, 'proposal.md'), '## Why\nA relative path transition must inspect artifacts in the caller project, not the plugin directory.\n## What Changes\n- Add a transition fixture.');
      writeFileSync(join(changeDir, 'design.md'), '# Design\n## Context\nTest.\n## Goals\nTest.\n## Decisions\n### D1\n- Choice: Test\n- Rationale: Test\n\n## Risks And Trade-Offs\nNone.');
      writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n- [x] Task 1');
      writeFileSync(join(changeDir, 'specs', 'test', 'spec.md'), '## ADDED Requirements\n### Requirement: Relative transition\nThe system SHALL resolve relative change paths from the caller project.\n#### Scenario: Transition\n- **WHEN** a project invokes state transition with a relative path\n- **THEN** its artifacts are checked.');

      assert.equal(ssf('state init changes/relative-change', { cwd: projectRoot }).exitCode, 0);
      assert.equal(ssf('state set changes/relative-change dp_1_result "confirmed: relative transition"', { cwd: projectRoot }).exitCode, 0);
      const result = ssf('state transition changes/relative-change specifying', { cwd: projectRoot });

      assert.equal(result.exitCode, 0, result.stderr);
      assert.match(result.stdout, /exploring -> specifying/);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('rejects exploring to approved-for-build when workflow is auto', () => {
    rmSync(join(tempDir, '.spec-superflow.yaml'), { force: true });
    ssf(`state init ${tempDir}`);

    const result = ssf(`state transition ${tempDir} approved-for-build`);
    assert.equal(result.exitCode, 1);
    const output = result.stderr || result.stdout;
    assert.match(output, /workflow-mode/i);
    assert.match(output, /fast-path/i);
    assert.match(output, /tweak/i);

    const check = ssf(`state get ${tempDir} state`);
    assert.equal(check.stdout.trim(), 'exploring');
  });

  it('rejects exploring to bridging when workflow is full', () => {
    rmSync(join(tempDir, '.spec-superflow.yaml'), { force: true });
    ssf(`state init ${tempDir}`);
    ssf(`state set ${tempDir} workflow full`);

    const result = ssf(`state transition ${tempDir} bridging`);
    assert.equal(result.exitCode, 1);
    const output = result.stderr || result.stdout;
    assert.match(output, /workflow-mode/i);
    assert.match(output, /fast-path/i);
    assert.match(output, /hotfix/i);

    const check = ssf(`state get ${tempDir} state`);
    assert.equal(check.stdout.trim(), 'exploring');
  });

  it('accepts a direct quick receipt through the no-contract transition path', () => {
    rmSync(join(tempDir, '.spec-superflow.yaml'), { force: true });
    ssf(`state init ${tempDir}`);
    const recommendation = ssf(`workflow recommend ${tempDir} --task-count 3 --file-count 3 --config-doc-only no --schema-api-change no --new-module no --behavioral-constraint-change no --cross-module-change no --uncertainty low`);
    assert.equal(recommendation.exitCode, 0, recommendation.stderr);
    const acceptance = ssf(`workflow accept ${tempDir} --source direct-request --verification bounded`);
    assert.equal(acceptance.exitCode, 0, acceptance.stderr);

    const approved = ssf(`state transition ${tempDir} approved-for-build`);
    assert.equal(approved.exitCode, 0, approved.stderr);
    const executing = ssf(`state transition ${tempDir} executing`);
    assert.equal(executing.exitCode, 0, executing.stderr);
  });

  it('rejects transition when guard output is not valid JSON', () => {
    rmSync(join(tempDir, '.spec-superflow.yaml'), { force: true });
    ssf(`state init ${tempDir}`);
    ssf(`state set ${tempDir} workflow invalid-mode`);

    const result = ssf(`state transition ${tempDir} specifying`);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr || result.stdout, /valid JSON|Invalid workflow|guard-error/i);

    const check = ssf(`state get ${tempDir} state`);
    assert.equal(check.stdout.trim(), 'exploring');
  });

  it('rejects transition when guard pass is a truthy non-boolean value', () => {
    rmSync(join(tempDir, '.spec-superflow.yaml'), { force: true });
    ssf(`state init ${tempDir}`);

    const shimDir = mkdtempSync(join(tmpdir(), 'ssf-node-shim-'));
    const nodeShim = join(shimDir, 'node');
    writeFileSync(nodeShim, [
      '#!/bin/sh',
      'case "$1" in',
      '  */scripts/guard/guard.mjs)',
      '    printf \'%s\\n\' \'{"pass":"false","checks":[]}\'',
      '    exit 0',
      '    ;;',
      'esac',
      `exec ${shellQuote(process.execPath)} "$@"`,
      '',
    ].join('\n'));
    chmodSync(nodeShim, 0o755);

    try {
      const result = ssf(`state transition ${tempDir} specifying`, {
        env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` },
      });
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr || result.stdout, /guard-error|Guard check failed/i);

      const check = ssf(`state get ${tempDir} state`);
      assert.equal(check.stdout.trim(), 'exploring');
    } finally {
      rmSync(shimDir, { recursive: true, force: true });
    }
  });

  it('reports guard spawn errors without changing state', () => {
    rmSync(join(tempDir, '.spec-superflow.yaml'), { force: true });
    ssf(`state init ${tempDir}`);

    const result = ssf(`state transition ${tempDir} specifying`, {
      env: { ...process.env, PATH: '' },
    });
    assert.equal(result.exitCode, 1);
    const output = result.stderr || result.stdout;
    assert.match(output, /guard-error|spawn|ENOENT/i);
    assert.doesNotMatch(output, /TypeError/i);

    const check = ssf(`state get ${tempDir} state`);
    assert.equal(check.stdout.trim(), 'exploring');
  });
});

describe('cmd-state: get', () => {
  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-state-get-'));
    writeFileSync(join(tempDir, 'proposal.md'), '## Why\nTest proposal for get command, needs to be long enough.\n## What Changes\n- Feature');
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('gets a field value', () => {
    ssf(`state init ${tempDir}`);
    const result = ssf(`state get ${tempDir} state`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), 'exploring');
  });

  it('returns null for unset fields', () => {
    ssf(`state init ${tempDir}`);
    const result = ssf(`state get ${tempDir} dp_5_result`);
    assert.ok(result.stdout.includes('null'));
  });

  it('--json returns structured output', () => {
    ssf(`state init ${tempDir}`);
    const result = ssf(`state get ${tempDir} state --json`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.field, 'state');
    assert.equal(parsed.value, 'exploring');
  });

  it('errors without field argument', () => {
    const result = ssf(`state get ${tempDir}`);
    assert.equal(result.exitCode, 2);
  });
});

describe('cmd-state: set', () => {
  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-state-set-'));
    writeFileSync(join(tempDir, 'proposal.md'), '## Why\nTest proposal for the set subcommand validation.\n## What Changes\n- Test feature');
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('sets a settable field', () => {
    ssf(`state init ${tempDir}`);
    const result = ssf(`state set ${tempDir} workflow hotfix`);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('hotfix'));
  });

  it('sets a DP field', () => {
    ssf(`state init ${tempDir}`);
    ssf(`state set ${tempDir} dp_1_result "confirmed: csv export"`);
    const get = ssf(`state get ${tempDir} dp_1_result`);
    assert.ok(get.stdout.includes('confirmed: csv export'));
  });

  it('rejects non-settable fields', () => {
    ssf(`state init ${tempDir}`);
    const result = ssf(`state set ${tempDir} state executing`);
    assert.equal(result.exitCode, 1);
    // Error goes to stderr for console.error
    assert.ok(result.stderr.includes('not settable') || result.stdout.includes('not settable'),
      `Expected 'not settable' in output but got stdout: "${result.stdout}" stderr: "${result.stderr}"`);
  });

  it('rejects manual edits to execution DP-4 fields', () => {
    ssf(`state init ${tempDir}`);
    const result = ssf(`state set ${tempDir} dp_4_result "forged execution approval"`);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr || result.stdout, /not settable/);
  });

  it('rejects unknown fields', () => {
    ssf(`state init ${tempDir}`);
    const result = ssf(`state set ${tempDir} nonexistent_field value`);
    assert.equal(result.exitCode, 1);
  });

  it('--json outputs structured result', () => {
    ssf(`state init ${tempDir}`);
    const result = ssf(`state set ${tempDir} test_result pass --json`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.field, 'test_result');
    assert.equal(parsed.value, 'pass');
  });
});

describe('cmd-state: rebuild', () => {
  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-state-rebuild-'));
    writeFileSync(join(tempDir, 'proposal.md'), '## Why\nRebuild test proposal with sufficient content length.\n## What Changes\n- Rebuild feature');
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('rebuilds state from artifacts', () => {
    ssf(`state init ${tempDir}`);
    const result = ssf(`state rebuild ${tempDir}`);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('rebuilt'));
  });

  it('--json returns ok with state', () => {
    ssf(`state init ${tempDir}`);
    const result = ssf(`state rebuild ${tempDir} --json`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.state, 'exploring');
  });
});

describe('cmd-state: error handling', () => {
  it('errors when no change-dir provided', () => {
    const result = ssf('state init');
    assert.equal(result.exitCode, 2);
  });

  it('errors on unknown subcommand', () => {
    const result = ssf('state invalid-subcommand /tmp');
    assert.equal(result.exitCode, 2);
  });
});

// T3: terminal worktree cleanup and divergence pre-check
describe('cmd-state: worktree terminal cleanup (T3)', () => {
  function git(cwd, ...args) {
    execFileSync('git', args, { cwd, stdio: 'pipe', timeout: 10000 });
  }

  function createRepo() {
    const repo = mkdtempSync(join(tmpdir(), 'ssf-t3-repo-'));
    git(repo, 'init', '-q', '--initial-branch=main');
    git(repo, 'config', 'user.name', 'test');
    git(repo, 'config', 'user.email', 't@t');
    writeFileSync(join(repo, 'README.md'), 'x');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    return repo;
  }

  function writeArtifacts(changeDir) {
    writeFileSync(join(changeDir, 'proposal.md'), '## Why\nTest proposal for T3 closing with sufficient length to pass validation.\n## What Changes\n- Test');
    writeFileSync(join(changeDir, 'design.md'), '# Design\n## Context\nTest.\n## Goals\nTest.\n## Decisions\n### D1\n- Choice: Test\n- Rationale: Test\n\n## Risks And Trade-Offs\nNone.');
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n- [x] Task 1');
    mkdirSync(join(changeDir, 'specs', 'test'), { recursive: true });
    writeFileSync(join(changeDir, 'specs', 'test', 'spec.md'), '## ADDED Requirements\n### Requirement: Test\nSHALL work.\n#### Scenario: Test\n- **WHEN** test\n- **THEN** test');
    writeFileSync(join(changeDir, 'execution-contract.md'), '# Execution Contract\n');
  }

  function initChangeAsExecuting(repo, changeName) {
    const changeDir = join(repo, 'changes', changeName);
    mkdirSync(changeDir, { recursive: true });
    writeArtifacts(changeDir);
    const init = ssf(`state init ${changeDir}`);
    assert.equal(init.exitCode, 0, `state init failed: ${init.stderr}`);
    // Set to executing, tweak, pass so closing guard passes via direct-test-result
    const s = readState(changeDir);
    s.state = 'executing';
    s.workflow = 'tweak';
    s.test_result = 'pass';
    s.last_transition = '2026-01-01T00:00:00.000Z';
    writeState(changeDir, s);
    return changeDir;
  }

  function createWorktreeAndSync(repo, changeName) {
    const changeDir = join(repo, 'changes', changeName);
    const worktreeAbs = join(repo, 'changes', 'worktrees', changeName);
    mkdirSync(join(repo, 'changes', 'worktrees'), { recursive: true });
    git(repo, 'worktree', 'add', '-q', worktreeAbs, '-b', changeName);
    const worktreeChangeDir = join(worktreeAbs, 'changes', changeName);
    // ensure copy
    if (existsSync(worktreeChangeDir)) rmSync(worktreeChangeDir, { recursive: true, force: true });
    mkdirSync(join(worktreeAbs, 'changes'), { recursive: true });
    cpSync(changeDir, worktreeChangeDir, { recursive: true, force: true });
    // after copy, set worktree pointer on main copy
    const mainState = readState(changeDir);
    mainState.worktree = `changes/worktrees/${changeName}`;
    writeState(changeDir, mainState);
    // ensure worktree copy also has same pointer and timestamp for consistency
    const wtState = readState(worktreeChangeDir);
    wtState.worktree = `changes/worktrees/${changeName}`;
    // keep last_transition equal for consistent case
    writeState(worktreeChangeDir, wtState);
    return { changeDir, worktreeAbs, worktreeChangeDir };
  }

  it('closing + consistent worktree → exit 0, worktree dir removed, pointer null', () => {
    const repo = createRepo();
    try {
      const changeName = 't3-closing-consistent';
      const changeDir = initChangeAsExecuting(repo, changeName);
      const { worktreeAbs, worktreeChangeDir } = createWorktreeAndSync(repo, changeName);
      assert.ok(existsSync(worktreeAbs), 'worktree should exist before transition');
      assert.ok(existsSync(worktreeChangeDir), 'worktree change dir should exist');

      const result = ssf(`state transition ${changeDir} closing`);
      assert.equal(result.exitCode, 0, `expected exit 0 but got ${result.exitCode}: stderr=${result.stderr} stdout=${result.stdout}`);
      assert.match(result.stdout, /closing/);
      assert.equal(existsSync(worktreeAbs), false, 'worktree dir should be removed after closing');
      const afterState = readState(changeDir);
      assert.equal(afterState.state, 'closing');
      assert.equal(afterState.worktree, null, 'worktree pointer should be null after cleanup');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('closing + diverged worktree → exit 1, worktree dir stays, state remains executing', () => {
    const repo = createRepo();
    try {
      const changeName = 't3-closing-diverged';
      const changeDir = initChangeAsExecuting(repo, changeName);
      const { worktreeAbs, worktreeChangeDir } = createWorktreeAndSync(repo, changeName);
      // make worktree newer => diverged
      const wtState = readState(worktreeChangeDir);
      wtState.last_transition = '2026-01-02T00:00:00.000Z';
      writeState(worktreeChangeDir, wtState);
      // also modify proposal to ensure diverged if fallback to hash, but timestamp suffices
      writeFileSync(join(worktreeChangeDir, 'proposal.md'), '## Why\nDiverged proposal content newer.\n## What Changes\n- diverged');

      const result = ssf(`state transition ${changeDir} closing`);
      assert.equal(result.exitCode, 1, `expected exit 1 but got ${result.exitCode}: ${result.stderr}`);
      assert.match(result.stderr, /diverged/i);
      assert.match(result.stderr, /Refusing/);
      assert.equal(existsSync(worktreeAbs), true, 'worktree dir should remain after diverged refusal');
      const afterState = readState(changeDir);
      assert.equal(afterState.state, 'executing', 'state should remain executing after diverged refusal');
      assert.equal(afterState.worktree, `changes/worktrees/${changeName}`);
    } finally {
      // clean worktree if still exists (unlock not needed)
      try { execFileSync('git', ['worktree', 'remove', '--force', join(repo, 'changes', 'worktrees', 't3-closing-diverged')], { cwd: repo, stdio: 'ignore' }); } catch {}
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('cleanup failure injection (locked worktree) → exit 0, stderr contains manual cleanup command', () => {
    const repo = createRepo();
    try {
      const changeName = 't3-cleanup-fail';
      const changeDir = initChangeAsExecuting(repo, changeName);
      const { worktreeAbs } = createWorktreeAndSync(repo, changeName);
      // lock worktree to make remove fail (needs cwd inside the temp repo)
      execFileSync('git', ['worktree', 'lock', worktreeAbs], { cwd: repo, stdio: 'pipe' });

      const result = ssf(`state transition ${changeDir} closing`);
      assert.equal(result.exitCode, 0, `expected exit 0 despite cleanup failure, got ${result.exitCode}: ${result.stderr}`);
      assert.match(result.stderr, /automatic worktree removal failed/i);
      assert.match(result.stderr, /git worktree remove --force/);
      assert.ok(result.stderr.includes(worktreeAbs) || result.stderr.includes(`changes/worktrees/${changeName}`));
      // state should be closing despite cleanup failure
      const afterState = readState(changeDir);
      assert.equal(afterState.state, 'closing');
      // worktree should still exist
      assert.equal(existsSync(worktreeAbs), true);
      // pointer should remain non-null because cleanup failed
      assert.equal(afterState.worktree, `changes/worktrees/${changeName}`);

      // cleanup for next test: unlock and remove
      execFileSync('git', ['worktree', 'unlock', worktreeAbs], { cwd: repo, stdio: 'pipe' });
      execFileSync('git', ['worktree', 'remove', '--force', worktreeAbs], { cwd: repo, stdio: 'pipe' });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('transition from inside worktree copy → state transition succeeds, dir remains, stderr contains skipping warning', () => {
    const repo = createRepo();
    try {
      const changeName = 't3-inside-worktree';
      const changeDir = initChangeAsExecuting(repo, changeName);
      const { worktreeAbs, worktreeChangeDir } = createWorktreeAndSync(repo, changeName);
      // run transition from inside worktree copy: changeDir is worktreeChangeDir, cwd is inside worktree
      const result = ssf(`state transition ${worktreeChangeDir} closing`, { cwd: worktreeAbs });
      assert.equal(result.exitCode, 0, `inside transition should succeed, got ${result.exitCode}: ${result.stderr}`);
      assert.match(result.stderr, /skipping automatic worktree removal/i);
      assert.match(result.stderr, /inside the worktree copy/i);
      // path assertion: warning must name the correct absolute worktree path (not nested)
      const worktreePathInWarning = result.stderr.match(/git worktree remove --force (\S+)/)?.[1];
      assert.equal(worktreePathInWarning, worktreeAbs, `warning should contain correct absolute worktree path ${worktreeAbs}, got ${worktreePathInWarning}`);
      const nestedWrong = join(worktreeAbs, `changes/worktrees/${changeName}`);
      assert.ok(!result.stderr.includes(nestedWrong), `warning should not contain nested incorrect path ${nestedWrong}`);
      // worktree dir should still exist (not removed to avoid stranding cwd)
      assert.equal(existsSync(worktreeAbs), true);
      // worktree copy state should be closing
      const wtAfter = readState(worktreeChangeDir);
      assert.equal(wtAfter.state, 'closing');
      // main copy state should remain executing (we transitioned the copy, not main)
      const mainAfter = readState(changeDir);
      assert.equal(mainAfter.state, 'executing');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('abandoned transition also triggers cleanup (consistent worktree → removed, pointer null)', () => {
    const repo = createRepo();
    try {
      const changeName = 't3-abandoned-cleanup';
      const changeDir = initChangeAsExecuting(repo, changeName);
      const { worktreeAbs } = createWorktreeAndSync(repo, changeName);
      const result = ssf(`state transition ${changeDir} abandoned`);
      assert.equal(result.exitCode, 0, `abandoned should succeed, got ${result.exitCode}: ${result.stderr}`);
      assert.equal(existsSync(worktreeAbs), false, 'worktree should be removed after abandoned');
      const afterState = readState(changeDir);
      assert.equal(afterState.state, 'abandoned');
      assert.equal(afterState.worktree, null);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
