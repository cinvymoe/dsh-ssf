// tests/lib/ensure-branch.test.mjs
// Regression for #15: git isolation must be enforceable, not just advised.
// `ensure-branch.mjs` must refuse to proceed on a protected branch when it cannot
// isolate, must allow work on a non-protected branch (with a hint), and must honor
// `--isolate` on non-protected branches by creating (or reusing) a sibling
// worktree instead of silently passing. Worktrees are the only isolation mode:
// a worktree left over from a previous run is reused by re-copying the active
// change artifacts.
//
// Security: every child process is spawned with execFileSync + literal argument
// arrays — no shell, no string interpolation.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const ENSURE = join(ROOT, 'scripts', 'ensure-branch.mjs');

function run(args) {
  try {
    const out = execFileSync('node', [ENSURE, ...args], { encoding: 'utf-8', stdio: 'pipe', timeout: 10000 });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}\n${e.stderr || ''}` || e.message };
  }
}

function git(dir, ...args) {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=test', ...args], { cwd: dir, stdio: 'pipe', timeout: 10000 });
}

function currentBranch(dir) {
  return execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf-8' }).trim();
}

describe('BUG/#15: ensure-branch enforces isolation', () => {
  let plainDir, repoDir;
  before(() => {
    plainDir = mkdtempSync(join(tmpdir(), 'ssf-ensure-plain-'));
    repoDir = mkdtempSync(join(tmpdir(), 'ssf-ensure-repo-'));
    mkdirSync(join(repoDir, 'specs'), { recursive: true });
    writeFileSync(join(repoDir, 'README.md'), 'x');
    // The fixture checks out the protected `main` branch below. Pin it here
    // instead of inheriting Git's host-specific init.defaultBranch (CI may
    // otherwise create `master`).
    git(repoDir, 'init', '-q', '--initial-branch=main');
    git(repoDir, 'add', '-A');
    git(repoDir, 'commit', '-q', '-m', 'init');
    git(repoDir, 'checkout', '-q', '-b', 'feature/work');
  });
  after(() => {
    if (existsSync(plainDir)) rmSync(plainDir, { recursive: true, force: true });
    if (existsSync(repoDir)) rmSync(repoDir, { recursive: true, force: true });
  });

  it('SHALL refuse (non-zero) when not inside a git repository', () => {
    const r = run([plainDir]);
    assert.equal(r.ok, false, 'ensure-branch must fail outside a git repo');
  });

  it('SHALL allow (zero) work on a non-protected branch and hint at --isolate', () => {
    const r = run([repoDir]);
    assert.equal(r.ok, true, `ensure-branch should pass on feature branch, got: ${r.out}`);
    assert.match(r.out, /already isolated/i);
    assert.match(r.out, /--isolate/, `output should hint at --isolate, got: ${r.out}`);
  });

  it('SHALL create a sibling worktree and carry only the active change artifacts from main', () => {
    const changeDir = join(repoDir, 'changes', 'planned-change');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'proposal.md'), 'Uncommitted planning artifact.');
    git(repoDir, 'checkout', '-q', 'main');

    const r = run([changeDir, 'planned-change']);
    const worktree = join(repoDir, 'changes', 'worktrees', 'planned-change');

    try {
      assert.equal(r.ok, true, r.out);
      assert.equal(existsSync(join(worktree, 'changes', 'planned-change', 'proposal.md')), true);
      assert.equal(existsSync(join(worktree, 'changes', 'planned-change', 'README.md')), false);
    } finally {
      if (existsSync(worktree)) git(repoDir, 'worktree', 'remove', '--force', worktree);
    }
  });

  it('SHALL reject a change name that is not one safe path segment', () => {
    const changeDir = join(repoDir, 'changes', 'safe-change');
    mkdirSync(changeDir, { recursive: true });
    git(repoDir, 'checkout', '-q', 'main');

    const r = run([changeDir, '../../outside']);

    assert.equal(r.ok, false, r.out);
    assert.match(r.out, /single safe path segment/i);
  });

  it('SHALL create a sibling worktree with --isolate on a non-protected branch, carrying only active change artifacts, without switching the current branch', () => {
    const changeDir = join(repoDir, 'changes', 'iso-change');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'proposal.md'), 'Uncommitted planning artifact.');
    git(repoDir, 'checkout', '-q', 'feature/work');

    const r = run([changeDir, 'iso-change', '--isolate']);
    const worktree = join(repoDir, 'changes', 'worktrees', 'iso-change');

    try {
      assert.equal(r.ok, true, r.out);
      assert.equal(existsSync(join(worktree, 'changes', 'iso-change', 'proposal.md')), true);
      assert.equal(existsSync(join(worktree, 'changes', 'iso-change', 'README.md')), false);
      assert.equal(currentBranch(repoDir), 'feature/work', 'creating a worktree must not switch the current branch');
    } finally {
      if (existsSync(worktree)) git(repoDir, 'worktree', 'remove', '--force', worktree);
    }
  });

  it('SHALL reuse an existing sibling worktree with exit 0 when --isolate is given and the worktree already exists', () => {
    const changeDir = join(repoDir, 'changes', 'iso-existing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'proposal.md'), 'Uncommitted planning artifact.');
    git(repoDir, 'checkout', '-q', 'feature/work');
    // Pre-create the worktree as if a previous run left it behind.
    const worktree = join(repoDir, 'changes', 'worktrees', 'iso-existing');
    mkdirSync(join(repoDir, 'changes', 'worktrees'), { recursive: true });
    git(repoDir, 'worktree', 'add', '-q', worktree, '-b', 'iso-existing');

    try {
      const r = run([changeDir, 'iso-existing', '--isolate']);

      assert.equal(r.ok, true, r.out);
      assert.match(r.out, /reused/i, `should reuse the existing worktree, got: ${r.out}`);
      assert.equal(existsSync(join(worktree, 'changes', 'iso-existing', 'proposal.md')), true, 'active change artifacts should be re-copied into the reused worktree');
      assert.equal(currentBranch(repoDir), 'feature/work', 'reusing a worktree must not switch the current branch');
    } finally {
      if (existsSync(worktree)) git(repoDir, 'worktree', 'remove', '--force', worktree);
    }
  });

  it('SHALL create a sibling worktree with --isolate and no change-name on a non-protected branch, defaulting the name to the repo name', () => {
    const changeDir = join(repoDir, 'changes', 'no-name-change');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'proposal.md'), 'Uncommitted planning artifact.');
    git(repoDir, 'checkout', '-q', 'feature/work');

    const repoName = basename(repoDir);
    const r = run([changeDir, '--isolate']);
    const worktree = join(repoDir, 'changes', 'worktrees', repoName);

    try {
      assert.equal(r.ok, true, r.out);
      assert.equal(existsSync(join(worktree, 'changes', 'no-name-change', 'proposal.md')), true);
      assert.equal(existsSync(join(worktree, 'changes', 'no-name-change', 'README.md')), false);
    } finally {
      if (existsSync(worktree)) git(repoDir, 'worktree', 'remove', '--force', worktree);
    }
  });
});
