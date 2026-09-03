// tests/lib/worktree-authority.test.mjs
// Worktree authority pointer + divergence detection (T1)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { tmpdir } from 'node:os';

function git(dir, ...args) {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=test', ...args], { cwd: dir, stdio: 'pipe', timeout: 10000 });
}

function repoRootForHelper(dir) {
  // helper to get repo root via git directly
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf-8' }).trim();
}

describe('worktree-authority: recordWorktree', () => {
  let tmpRoot;
  let mod;
  let stateLoader;

  before(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'ssf-wt-record-'));
    git(tmpRoot, 'init', '-q', '--initial-branch=main');
    // need at least one commit for git rev-parse to work
    writeFileSync(join(tmpRoot, 'README.md'), 'x');
    git(tmpRoot, 'add', '-A');
    git(tmpRoot, 'commit', '-q', '-m', 'init');
    const modPath = join(process.cwd(), 'scripts/lib/worktree-authority.mjs');
    mod = await import(modPath);
    const slPath = join(process.cwd(), 'scripts/lib/state-loader.mjs');
    stateLoader = await import(slPath);
  });

  after(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('writes repo-relative path when name equals change dir basename', () => {
    const changeDir = join(tmpRoot, 'changes', 'my-change');
    mkdirSync(changeDir, { recursive: true });
    // need state file
    stateLoader.writeState(changeDir, { state: 'executing', change_name: 'my-change' });
    const repoRoot = repoRootForHelper(changeDir);
    const worktreePath = join(repoRoot, 'changes', 'worktrees', 'my-change');
    mkdirSync(worktreePath, { recursive: true });
    mod.recordWorktree(changeDir, repoRoot, worktreePath);
    const state = stateLoader.readState(changeDir);
    assert.equal(state.worktree, 'changes/worktrees/my-change');
    // also check persisted file contains worktree line
    const content = readFileSync(join(changeDir, '.spec-superflow.yaml'), 'utf-8');
    assert.match(content, /worktree: changes\/worktrees\/my-change/);
  });

  it('skips when worktree basename is prototype-x', () => {
    const changeDir = join(tmpRoot, 'changes', 'proto-change');
    mkdirSync(changeDir, { recursive: true });
    stateLoader.writeState(changeDir, { state: 'executing', change_name: 'proto-change', worktree: null });
    const repoRoot = repoRootForHelper(changeDir);
    const worktreePath = join(repoRoot, 'changes', 'worktrees', 'prototype-123');
    mkdirSync(worktreePath, { recursive: true });
    mod.recordWorktree(changeDir, repoRoot, worktreePath);
    const state = stateLoader.readState(changeDir);
    // should remain null (no write)
    assert.equal(state.worktree, null);
  });

  it('skips when no state file exists', () => {
    const changeDir = join(tmpRoot, 'changes', 'no-state-change');
    mkdirSync(changeDir, { recursive: true });
    // ensure no state file
    const statePath = join(changeDir, '.spec-superflow.yaml');
    if (existsSync(statePath)) rmSync(statePath);
    const repoRoot = repoRootForHelper(tmpRoot);
    const worktreePath = join(repoRoot, 'changes', 'worktrees', 'no-state-change');
    // should not throw
    mod.recordWorktree(changeDir, repoRoot, worktreePath);
    assert.equal(existsSync(statePath), false);
  });
});

describe('worktree-authority: divergence', () => {
  let tmpRoot;
  let mod;
  let stateLoader;

  before(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'ssf-wt-div-'));
    git(tmpRoot, 'init', '-q', '--initial-branch=main');
    writeFileSync(join(tmpRoot, 'README.md'), 'x');
    git(tmpRoot, 'add', '-A');
    git(tmpRoot, 'commit', '-q', '-m', 'init');
    const modPath = join(process.cwd(), 'scripts/lib/worktree-authority.mjs');
    mod = await import(modPath);
    const slPath = join(process.cwd(), 'scripts/lib/state-loader.mjs');
    stateLoader = await import(slPath);
  });

  after(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns not diverged when worktree pointer is null', () => {
    const changeDir = join(tmpRoot, 'changes', 'div-null');
    mkdirSync(changeDir, { recursive: true });
    stateLoader.writeState(changeDir, { state: 'executing', change_name: 'div-null', worktree: null, last_transition: '2026-07-01T00:00:00Z' });
    const res = mod.divergence(changeDir);
    assert.equal(res.diverged, false);
    assert.equal(res.worktreePath, null);
    assert.equal(res.freshnessKnown, true);
  });

  it('returns not diverged when both last_transition equal', () => {
    const changeDir = join(tmpRoot, 'changes', 'div-equal');
    mkdirSync(changeDir, { recursive: true });
    const ts = '2026-07-01T10:00:00Z';
    stateLoader.writeState(changeDir, { state: 'executing', change_name: 'div-equal', worktree: 'changes/worktrees/div-equal', last_transition: ts });
    // create worktree copy
    const worktreeChangeDir = join(tmpRoot, 'changes', 'worktrees', 'div-equal', 'changes', 'div-equal');
    mkdirSync(worktreeChangeDir, { recursive: true });
    stateLoader.writeState(worktreeChangeDir, { state: 'executing', change_name: 'div-equal', worktree: 'changes/worktrees/div-equal', last_transition: ts });
    const res = mod.divergence(changeDir);
    assert.equal(res.diverged, false);
    assert.equal(res.worktreeNewer, false);
    assert.equal(res.freshnessKnown, true);
    assert.ok(res.worktreePath.includes('changes/worktrees/div-equal'));
  });

  it('diverged when both last_transition equal but artifact hash differs (equal-ts hash fallback)', () => {
    const changeDir = join(tmpRoot, 'changes', 'div-equal-hash-diff');
    mkdirSync(changeDir, { recursive: true });
    const ts = '2026-07-01T10:00:00Z';
    // differing artifact content: proposal.md differs between copies
    writeFileSync(join(changeDir, 'proposal.md'), 'source proposal v1');
    stateLoader.writeState(changeDir, { state: 'executing', change_name: 'div-equal-hash-diff', worktree: 'changes/worktrees/div-equal-hash-diff', last_transition: ts });
    const worktreeChangeDir = join(tmpRoot, 'changes', 'worktrees', 'div-equal-hash-diff', 'changes', 'div-equal-hash-diff');
    mkdirSync(worktreeChangeDir, { recursive: true });
    writeFileSync(join(worktreeChangeDir, 'proposal.md'), 'worktree proposal v2 DIFFERS');
    stateLoader.writeState(worktreeChangeDir, { state: 'executing', change_name: 'div-equal-hash-diff', worktree: 'changes/worktrees/div-equal-hash-diff', last_transition: ts });
    const res = mod.divergence(changeDir);
    assert.equal(res.diverged, true, 'equal ts but differing hash must be diverged');
    assert.equal(res.freshnessKnown, true, 'freshness stays known when both state files exist');
    assert.equal(res.worktreeNewer, false, 'worktreeNewer false when ts equal');
  });

  it('diverged+worktreeNewer when worktree last_transition is later', () => {
    const changeDir = join(tmpRoot, 'changes', 'div-newer');
    mkdirSync(changeDir, { recursive: true });
    stateLoader.writeState(changeDir, { state: 'executing', change_name: 'div-newer', worktree: 'changes/worktrees/div-newer', last_transition: '2026-07-01T08:00:00Z' });
    const worktreeChangeDir = join(tmpRoot, 'changes', 'worktrees', 'div-newer', 'changes', 'div-newer');
    mkdirSync(worktreeChangeDir, { recursive: true });
    stateLoader.writeState(worktreeChangeDir, { state: 'executing', change_name: 'div-newer', worktree: 'changes/worktrees/div-newer', last_transition: '2026-07-02T08:00:00Z' });
    const res = mod.divergence(changeDir);
    assert.equal(res.diverged, true);
    assert.equal(res.worktreeNewer, true);
    assert.equal(res.freshnessKnown, true);
  });

  it('diverged worktreeNewer=false when worktree older (freshnessKnown=true)', () => {
    const changeDir = join(tmpRoot, 'changes', 'div-older');
    mkdirSync(changeDir, { recursive: true });
    stateLoader.writeState(changeDir, { state: 'executing', change_name: 'div-older', worktree: 'changes/worktrees/div-older', last_transition: '2026-07-02T08:00:00Z' });
    const worktreeChangeDir = join(tmpRoot, 'changes', 'worktrees', 'div-older', 'changes', 'div-older');
    mkdirSync(worktreeChangeDir, { recursive: true });
    stateLoader.writeState(worktreeChangeDir, { state: 'executing', change_name: 'div-older', worktree: 'changes/worktrees/div-older', last_transition: '2026-07-01T08:00:00Z' });
    const res = mod.divergence(changeDir);
    assert.equal(res.diverged, true);
    assert.equal(res.worktreeNewer, false);
    assert.equal(res.freshnessKnown, true);
  });

  it('diverged freshnessKnown=false when worktree copy missing state file and hash differs', () => {
    const changeDir = join(tmpRoot, 'changes', 'div-hash');
    mkdirSync(changeDir, { recursive: true });
    // create differing artifacts
    writeFileSync(join(changeDir, 'proposal.md'), 'original content A');
    stateLoader.writeState(changeDir, { state: 'executing', change_name: 'div-hash', worktree: 'changes/worktrees/div-hash', last_transition: '2026-07-01T08:00:00Z' });
    const worktreeChangeDir = join(tmpRoot, 'changes', 'worktrees', 'div-hash', 'changes', 'div-hash');
    mkdirSync(worktreeChangeDir, { recursive: true });
    // worktree copy has no .spec-superflow.yaml, but has different proposal
    writeFileSync(join(worktreeChangeDir, 'proposal.md'), 'different content B');
    // ensure no state file in worktree copy
    const wtStatePath = join(worktreeChangeDir, '.spec-superflow.yaml');
    if (existsSync(wtStatePath)) rmSync(wtStatePath);
    const res = mod.divergence(changeDir);
    assert.equal(res.diverged, true);
    assert.equal(res.freshnessKnown, false);
    assert.equal(res.worktreeNewer, false);
  });

  it('not diverged when worktree copy missing state file but hash equal (freshnessKnown=false)', () => {
    const changeDir = join(tmpRoot, 'changes', 'div-hash-equal');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'proposal.md'), 'same content');
    stateLoader.writeState(changeDir, { state: 'executing', change_name: 'div-hash-equal', worktree: 'changes/worktrees/div-hash-equal', last_transition: '2026-07-01T08:00:00Z' });
    const worktreeChangeDir = join(tmpRoot, 'changes', 'worktrees', 'div-hash-equal', 'changes', 'div-hash-equal');
    mkdirSync(worktreeChangeDir, { recursive: true });
    writeFileSync(join(worktreeChangeDir, 'proposal.md'), 'same content');
    const res = mod.divergence(changeDir);
    assert.equal(res.diverged, false);
    assert.equal(res.freshnessKnown, false);
  });

  it('returns not diverged when worktree copy directory does not exist', () => {
    const changeDir = join(tmpRoot, 'changes', 'div-no-wt-dir');
    mkdirSync(changeDir, { recursive: true });
    stateLoader.writeState(changeDir, { state: 'executing', change_name: 'div-no-wt-dir', worktree: 'changes/worktrees/div-no-wt-dir', last_transition: '2026-07-01T08:00:00Z' });
    const res = mod.divergence(changeDir);
    assert.equal(res.diverged, false);
    assert.equal(res.freshnessKnown, true);
    assert.ok(res.worktreePath.includes('div-no-wt-dir'));
  });
});

describe('worktree-authority: warnIfDiverged', () => {
  let tmpRoot;
  let mod;
  let stateLoader;

  before(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'ssf-wt-warn-'));
    git(tmpRoot, 'init', '-q', '--initial-branch=main');
    writeFileSync(join(tmpRoot, 'README.md'), 'x');
    git(tmpRoot, 'add', '-A');
    git(tmpRoot, 'commit', '-q', '-m', 'init');
    const modPath = join(process.cwd(), 'scripts/lib/worktree-authority.mjs');
    mod = await import(modPath);
    const slPath = join(process.cwd(), 'scripts/lib/state-loader.mjs');
    stateLoader = await import(slPath);
  });

  after(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('warns to stderr containing worktree path when diverged', () => {
    const changeDir = join(tmpRoot, 'changes', 'warn-div');
    mkdirSync(changeDir, { recursive: true });
    stateLoader.writeState(changeDir, { state: 'executing', change_name: 'warn-div', worktree: 'changes/worktrees/warn-div', last_transition: '2026-07-01T08:00:00Z' });
    const worktreeChangeDir = join(tmpRoot, 'changes', 'worktrees', 'warn-div', 'changes', 'warn-div');
    mkdirSync(worktreeChangeDir, { recursive: true });
    stateLoader.writeState(worktreeChangeDir, { state: 'executing', change_name: 'warn-div', worktree: 'changes/worktrees/warn-div', last_transition: '2026-07-02T08:00:00Z' });
    const captured = [];
    const orig = console.error;
    console.error = (...args) => captured.push(args.join(' '));
    try {
      mod.warnIfDiverged(changeDir);
    } finally {
      console.error = orig;
    }
    assert.equal(captured.length, 1);
    assert.match(captured[0], /worktree/);
    assert.match(captured[0], /warn-div/);
  });

  it('silent when consistent', () => {
    const changeDir = join(tmpRoot, 'changes', 'warn-consistent');
    mkdirSync(changeDir, { recursive: true });
    const ts = '2026-07-01T10:00:00Z';
    stateLoader.writeState(changeDir, { state: 'executing', change_name: 'warn-consistent', worktree: 'changes/worktrees/warn-consistent', last_transition: ts });
    const worktreeChangeDir = join(tmpRoot, 'changes', 'worktrees', 'warn-consistent', 'changes', 'warn-consistent');
    mkdirSync(worktreeChangeDir, { recursive: true });
    stateLoader.writeState(worktreeChangeDir, { state: 'executing', change_name: 'warn-consistent', worktree: 'changes/worktrees/warn-consistent', last_transition: ts });
    const captured = [];
    const orig = console.error;
    console.error = (...args) => captured.push(args.join(' '));
    try {
      mod.warnIfDiverged(changeDir);
    } finally {
      console.error = orig;
    }
    assert.equal(captured.length, 0);
  });

  it('silent when no worktree pointer', () => {
    const changeDir = join(tmpRoot, 'changes', 'warn-null');
    mkdirSync(changeDir, { recursive: true });
    stateLoader.writeState(changeDir, { state: 'executing', change_name: 'warn-null', worktree: null, last_transition: '2026-07-01T08:00:00Z' });
    const captured = [];
    const orig = console.error;
    console.error = (...args) => captured.push(args.join(' '));
    try {
      mod.warnIfDiverged(changeDir);
    } finally {
      console.error = orig;
    }
    assert.equal(captured.length, 0);
  });
});

describe('worktree-authority: repoRootFor', () => {
  let tmpRoot;
  let mod;
  before(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'ssf-wt-root-'));
    git(tmpRoot, 'init', '-q', '--initial-branch=main');
    writeFileSync(join(tmpRoot, 'README.md'), 'x');
    git(tmpRoot, 'add', '-A');
    git(tmpRoot, 'commit', '-q', '-m', 'init');
    const modPath = join(process.cwd(), 'scripts/lib/worktree-authority.mjs');
    mod = await import(modPath);
  });
  after(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });
  it('returns git toplevel realpath', () => {
    const changeDir = join(tmpRoot, 'changes', 'some-change');
    mkdirSync(changeDir, { recursive: true });
    const root = mod.repoRootFor(changeDir);
    // should be tmpRoot (realpath)
    assert.equal(root, realpathSync(tmpRoot));
  });
});
