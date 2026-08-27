// tests/lib/ensure-branch.test.mjs
// Regression for #15: git isolation must be enforceable, not just advised.
// `ensure-branch.mjs` must refuse to proceed on a protected branch when it cannot
// isolate, must allow work on a non-protected branch (with a hint), and must honor
// `--isolate` on non-protected branches by creating (or reusing) an in-repo
// worktree instead of silently passing. Worktrees are the only isolation mode:
// a worktree left over from a previous run is reused by re-copying the active
// change artifacts.
//
// Security: every child process is spawned with execFileSync + literal argument
// arrays — no shell, no string interpolation.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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

  it('SHALL create an in-repo worktree and carry only the active change artifacts from main', () => {
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

  it('SHALL create an in-repo worktree with --isolate on a non-protected branch, carrying only active change artifacts, without switching the current branch', () => {
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

  it('SHALL reuse an existing in-repo worktree with exit 0 when --isolate is given and the worktree already exists', () => {
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

  it('SHALL create an in-repo worktree with --isolate and no change-name on a non-protected branch, defaulting the name to the repo name', () => {
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

// T2: pointer recording and reuse divergence protection
describe('T2: isolate-worktree-hardening pointer and reuse protection', () => {
  function makeRepo() {
    const dir = mkdtempSync(join(tmpdir(), 'ssf-t2-'));
    mkdirSync(join(dir, 'specs'), { recursive: true });
    writeFileSync(join(dir, 'README.md'), 'x');
    git(dir, 'init', '-q', '--initial-branch=main');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'init');
    return dir;
  }

  function writeStateYaml(dir, { last_transition, worktree }) {
    const w = worktree === null || worktree === undefined ? 'null' : worktree;
    const lt = last_transition === null || last_transition === undefined ? 'null' : last_transition;
    writeFileSync(join(dir, '.spec-superflow.yaml'), `state: executing\nworktree: ${w}\nlast_transition: ${lt}\n`);
  }

  function readWorktreeField(dir) {
    const raw = readFileSync(join(dir, '.spec-superflow.yaml'), 'utf-8');
    const m = raw.match(/^worktree:\s*(.*)\s*$/m);
    return m ? m[1].trim() : null;
  }

  function setLastTransition(dir, ts) {
    const p = join(dir, '.spec-superflow.yaml');
    let raw = readFileSync(p, 'utf-8');
    if (/^last_transition:/m.test(raw)) {
      raw = raw.replace(/^last_transition:\s*.*$/m, `last_transition: ${ts}`);
    } else {
      raw += `\nlast_transition: ${ts}\n`;
    }
    writeFileSync(p, raw);
  }

  it('SHALL record worktree pointer after creation: worktree: changes/worktrees/<name>', () => {
    const repo = makeRepo();
    try {
      const changeDir = join(repo, 'changes', 'my-change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'proposal.md'), 'hello');
      writeStateYaml(changeDir, { last_transition: '2026-01-01T00:00:00.000Z', worktree: null });

      const r = run([changeDir, 'my-change']);
      const worktree = join(repo, 'changes', 'worktrees', 'my-change');
      assert.equal(r.ok, true, `creation should succeed, got: ${r.out}`);
      const field = readWorktreeField(changeDir);
      assert.equal(field, 'changes/worktrees/my-change', `worktree field should be repo-relative, got: ${field}`);
      // clean worktree
      if (existsSync(worktree)) git(repo, 'worktree', 'remove', '--force', worktree);
    } finally {
      if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
    }
  });

  it('SHALL propagate worktree pointer into worktree copy after creation', () => {
    const repo = makeRepo();
    try {
      const changeDir = join(repo, 'changes', 'propagate-create');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'proposal.md'), 'hello');
      writeStateYaml(changeDir, { last_transition: '2026-01-01T00:00:00.000Z', worktree: null });

      const r = run([changeDir, 'propagate-create']);
      const worktree = join(repo, 'changes', 'worktrees', 'propagate-create');
      assert.equal(r.ok, true, `creation should succeed, got: ${r.out}`);
      const srcField = readWorktreeField(changeDir);
      assert.equal(srcField, 'changes/worktrees/propagate-create');
      // worktree copy must also carry the pointer so T3 inside-worktree warning is reachable
      const wtChangeDir = join(worktree, 'changes', 'propagate-create');
      const wtField = readWorktreeField(wtChangeDir);
      assert.equal(wtField, 'changes/worktrees/propagate-create', `worktree copy should carry pointer, got: ${wtField}`);
      if (existsSync(worktree)) git(repo, 'worktree', 'remove', '--force', worktree);
    } finally {
      if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
    }
  });

  it('SHALL NOT record worktree pointer for prototype- names', () => {
    const repo = makeRepo();
    try {
      const changeDir = join(repo, 'changes', 'my-change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'proposal.md'), 'hello');
      writeStateYaml(changeDir, { last_transition: '2026-01-01T00:00:00.000Z', worktree: null });

      const r = run([changeDir, 'prototype-abc123']);
      const worktree = join(repo, 'changes', 'worktrees', 'prototype-abc123');
      assert.equal(r.ok, true, `prototype creation should succeed, got: ${r.out}`);
      const field = readWorktreeField(changeDir);
      assert.equal(field, 'null', `prototype worktree should not overwrite pointer, got: ${field}`);
      if (existsSync(worktree)) git(repo, 'worktree', 'remove', '--force', worktree);
    } finally {
      if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
    }
  });

  it('SHALL refuse reuse when worktree copy last_transition newer (exit 1) and not modify worktree copy', () => {
    const repo = makeRepo();
    try {
      const changeDir = join(repo, 'changes', 'div-newer');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'proposal.md'), 'source-v1');
      writeStateYaml(changeDir, { last_transition: '2026-01-01T00:00:00.000Z', worktree: null });

      let r = run([changeDir, 'div-newer']);
      assert.equal(r.ok, true, `initial creation failed: ${r.out}`);
      const worktree = join(repo, 'changes', 'worktrees', 'div-newer');
      const wtChangeDir = join(worktree, 'changes', 'div-newer');
      // make worktree newer: edit wt proposal + bump timestamp
      writeFileSync(join(wtChangeDir, 'proposal.md'), 'worktree-newer-content');
      setLastTransition(wtChangeDir, '2026-01-02T00:00:00.000Z');
      // source stays older but with different content to detect overwrite
      writeFileSync(join(changeDir, 'proposal.md'), 'source-v2');
      // reuse without --sync should refuse
      r = run([changeDir, 'div-newer']);
      assert.equal(r.ok, false, `reuse with newer worktree should fail (exit 1), got: ${r.out}`);
      assert.match(r.out, /newer/i, `stderr should mention newer, got: ${r.out}`);
      assert.match(r.out, /--sync/, `stderr should hint --sync, got: ${r.out}`);
      const after = readFileSync(join(wtChangeDir, 'proposal.md'), 'utf-8');
      assert.equal(after, 'worktree-newer-content', 'worktree copy must not be modified on refusal');
      if (existsSync(worktree)) git(repo, 'worktree', 'remove', '--force', worktree);
    } finally {
      if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
    }
  });

  it('SHALL refuse reuse when freshness cannot be determined and hash diverged (exit 1)', () => {
    const repo = makeRepo();
    try {
      const changeDir = join(repo, 'changes', 'div-hash');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'proposal.md'), 'source-v1');
      writeStateYaml(changeDir, { last_transition: '2026-01-01T00:00:00.000Z', worktree: null });

      let r = run([changeDir, 'div-hash']);
      assert.equal(r.ok, true, `initial creation failed: ${r.out}`);
      const worktree = join(repo, 'changes', 'worktrees', 'div-hash');
      const wtChangeDir = join(worktree, 'changes', 'div-hash');
      // remove worktree state file to force hash fallback, then diverge content
      rmSync(join(wtChangeDir, '.spec-superflow.yaml'), { force: true });
      writeFileSync(join(wtChangeDir, 'proposal.md'), 'diverged-content');
      // also ensure source has proposal different
      writeFileSync(join(changeDir, 'proposal.md'), 'source-v2');
      r = run([changeDir, 'div-hash']);
      assert.equal(r.ok, false, `hash-diverged without freshness should fail, got: ${r.out}`);
      assert.match(r.out, /freshness|cannot be determined/i, `stderr should mention freshness, got: ${r.out}`);
      assert.match(r.out, /--sync/);
      const after = readFileSync(join(wtChangeDir, 'proposal.md'), 'utf-8');
      assert.equal(after, 'diverged-content', 'worktree copy must not be modified');
      if (existsSync(worktree)) git(repo, 'worktree', 'remove', '--force', worktree);
    } finally {
      if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
    }
  });

  it('SHALL allow reuse when worktree copy is older or consistent and re-copy (exit 0)', () => {
    const repo = makeRepo();
    try {
      const changeDir = join(repo, 'changes', 'div-older');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'proposal.md'), 'source-v1');
      writeStateYaml(changeDir, { last_transition: '2026-01-02T00:00:00.000Z', worktree: null });

      let r = run([changeDir, 'div-older']);
      assert.equal(r.ok, true, `initial creation failed: ${r.out}`);
      const worktree = join(repo, 'changes', 'worktrees', 'div-older');
      const wtChangeDir = join(worktree, 'changes', 'div-older');
      // make worktree older
      setLastTransition(wtChangeDir, '2026-01-01T00:00:00.000Z');
      writeFileSync(join(wtChangeDir, 'proposal.md'), 'old-worktree-content');
      // update source
      writeFileSync(join(changeDir, 'proposal.md'), 'source-v2');
      r = run([changeDir, 'div-older']);
      assert.equal(r.ok, true, `reuse with older worktree should succeed, got: ${r.out}`);
      assert.match(r.out, /reused/i);
      const after = readFileSync(join(wtChangeDir, 'proposal.md'), 'utf-8');
      assert.equal(after, 'source-v2', 'worktree copy should be overwritten when older');

      // consistent case: run again without changes, should also succeed
      r = run([changeDir, 'div-older']);
      assert.equal(r.ok, true, `reuse when consistent should succeed, got: ${r.out}`);

      if (existsSync(worktree)) git(repo, 'worktree', 'remove', '--force', worktree);
    } finally {
      if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
    }
  });

  it('SHALL force overwrite with --sync when worktree newer, exit 0 and log --sync forced', () => {
    const repo = makeRepo();
    try {
      const changeDir = join(repo, 'changes', 'div-sync');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'proposal.md'), 'source-v1');
      writeStateYaml(changeDir, { last_transition: '2026-01-01T00:00:00.000Z', worktree: null });

      let r = run([changeDir, 'div-sync']);
      assert.equal(r.ok, true, `initial creation failed: ${r.out}`);
      const worktree = join(repo, 'changes', 'worktrees', 'div-sync');
      const wtChangeDir = join(worktree, 'changes', 'div-sync');
      writeFileSync(join(wtChangeDir, 'proposal.md'), 'worktree-newer-content');
      setLastTransition(wtChangeDir, '2026-01-02T00:00:00.000Z');
      writeFileSync(join(changeDir, 'proposal.md'), 'source-v2');
      r = run([changeDir, 'div-sync', '--sync']);
      assert.equal(r.ok, true, `reuse with --sync should succeed, got: ${r.out}`);
      assert.match(r.out, /--sync forced/i, `output should contain --sync forced, got: ${r.out}`);
      const after = readFileSync(join(wtChangeDir, 'proposal.md'), 'utf-8');
      assert.equal(after, 'source-v2', 'worktree copy should be overwritten with --sync');
      if (existsSync(worktree)) git(repo, 'worktree', 'remove', '--force', worktree);
    } finally {
      if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
    }
  });

  it('SHALL force overwrite with --sync when freshness unknown and diverged', () => {
    const repo = makeRepo();
    try {
      const changeDir = join(repo, 'changes', 'div-sync-hash');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'proposal.md'), 'source-v1');
      writeStateYaml(changeDir, { last_transition: '2026-01-01T00:00:00.000Z', worktree: null });

      let r = run([changeDir, 'div-sync-hash']);
      assert.equal(r.ok, true, `initial creation failed: ${r.out}`);
      const worktree = join(repo, 'changes', 'worktrees', 'div-sync-hash');
      const wtChangeDir = join(worktree, 'changes', 'div-sync-hash');
      rmSync(join(wtChangeDir, '.spec-superflow.yaml'), { force: true });
      writeFileSync(join(wtChangeDir, 'proposal.md'), 'diverged-content');
      writeFileSync(join(changeDir, 'proposal.md'), 'source-v2');
      r = run([changeDir, 'div-sync-hash', '--sync']);
      assert.equal(r.ok, true, `sync should force overwrite hash-diverged, got: ${r.out}`);
      assert.match(r.out, /--sync forced/i);
      const after = readFileSync(join(wtChangeDir, 'proposal.md'), 'utf-8');
      assert.equal(after, 'source-v2');
      if (existsSync(worktree)) git(repo, 'worktree', 'remove', '--force', worktree);
    } finally {
      if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
    }
  });

  it('SHALL record worktree pointer on reuse as well', () => {
    const repo = makeRepo();
    try {
      const changeDir = join(repo, 'changes', 'reuse-pointer');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'proposal.md'), 'source-v1');
      writeStateYaml(changeDir, { last_transition: '2026-01-01T00:00:00.000Z', worktree: null });

      let r = run([changeDir, 'reuse-pointer']);
      assert.equal(r.ok, true, r.out);
      const worktree = join(repo, 'changes', 'worktrees', 'reuse-pointer');
      // tamper pointer to null, then reuse should re-record
      writeStateYaml(changeDir, { last_transition: '2026-01-01T00:00:00.000Z', worktree: null });
      // ensure worktree older so reuse allowed
      const wtChangeDir = join(worktree, 'changes', 'reuse-pointer');
      setLastTransition(wtChangeDir, '2026-01-01T00:00:00.000Z');
      r = run([changeDir, 'reuse-pointer']);
      assert.equal(r.ok, true, r.out);
      const field = readWorktreeField(changeDir);
      assert.equal(field, 'changes/worktrees/reuse-pointer');
      if (existsSync(worktree)) git(repo, 'worktree', 'remove', '--force', worktree);
    } finally {
      if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
    }
  });

  it('SHALL propagate worktree pointer into worktree copy after reuse', () => {
    const repo = makeRepo();
    try {
      const changeDir = join(repo, 'changes', 'propagate-reuse');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'proposal.md'), 'source-v1');
      writeStateYaml(changeDir, { last_transition: '2026-01-01T00:00:00.000Z', worktree: null });

      let r = run([changeDir, 'propagate-reuse']);
      assert.equal(r.ok, true, `initial creation failed: ${r.out}`);
      const worktree = join(repo, 'changes', 'worktrees', 'propagate-reuse');
      const wtChangeDir = join(worktree, 'changes', 'propagate-reuse');
      // tamper source pointer to null, ensure worktree copy also loses it via manual clear
      writeStateYaml(changeDir, { last_transition: '2026-01-01T00:00:00.000Z', worktree: null });
      writeStateYaml(wtChangeDir, { last_transition: '2026-01-01T00:00:00.000Z', worktree: null });
      // reuse should re-propagate pointer to both
      r = run([changeDir, 'propagate-reuse']);
      assert.equal(r.ok, true, `reuse should succeed, got: ${r.out}`);
      const srcField = readWorktreeField(changeDir);
      assert.equal(srcField, 'changes/worktrees/propagate-reuse');
      const wtField = readWorktreeField(wtChangeDir);
      assert.equal(wtField, 'changes/worktrees/propagate-reuse', `worktree copy should carry pointer after reuse, got: ${wtField}`);
      if (existsSync(worktree)) git(repo, 'worktree', 'remove', '--force', worktree);
    } finally {
      if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
    }
  });
});
