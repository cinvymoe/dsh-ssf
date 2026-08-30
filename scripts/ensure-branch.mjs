#!/usr/bin/env node
// scripts/ensure-branch.mjs — enforce git isolation before editing main/master
// Used by build-executor as a mandatory preflight. Exits non-zero when it
// cannot create an isolated context and no --force approval was given, so the
// agent MUST stop and ask the user instead of silently editing main/master.
//
// Protected branches (main/master) always require an isolated context.
// Non-protected branches are already isolated and pass by default, with a hint
// that re-running with --isolate forces an in-repo worktree.
// With --isolate on a non-protected branch the same isolation path as a
// protected branch is taken: an in-repo worktree at <repoRoot>/changes/worktrees/<name>
// is created with the active change artifacts copied in. A worktree left over
// from a previous run is reused (the active change artifacts are re-copied)
// instead of failing. Worktrees are the only isolation mode — there is no
// branch fallback.
//
// Usage: node ensure-branch.mjs <change-dir> [change-name] [--isolate] [--force] [--confirm] [--sync]
//   --isolate  create an isolated environment on any branch via an in-repo
//              worktree (default: pass through on non-protected branches)
//   --confirm  confirm creating/reusing the isolated worktree on a protected branch
//   --sync     force main -> worktree overwrite when reusing an existing worktree
//
// Security: every git invocation uses execFileSync with a LITERAL command
// ('git') and a LITERAL argument array (no shell, no variable args array) —
// the same form proven safe by install-cursor.mjs / install.mjs. There is no
// string-form shell command, no variable command, and no dynamic args array.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { recordWorktree, divergence } from './lib/worktree-authority.mjs';

const changeDir = process.argv[2];
// change-name is the first positional argument after the change directory that
// is not a flag (e.g. `--isolate` / `--force`). Bare-flag invocations such as
// `ssf isolate <dir> --isolate` must not treat the flag itself as the name.
const changeName = process.argv.slice(3).find((arg) => !arg.startsWith('--'));
const isolate = process.argv.includes('--isolate');
const force = process.argv.includes('--force');
const confirm = process.argv.includes('--confirm');
const sync = process.argv.includes('--sync');

if (!changeDir) {
  console.error('Usage: node ensure-branch.mjs <change-dir> [change-name] [--isolate] [--force] [--confirm] [--sync]');
  process.exit(2);
}

if (confirm && force) {
  console.error('ensure-branch: --confirm and --force are mutually exclusive. Choose one: --confirm to create/reuse the isolated worktree, or --force to approve editing the protected branch in place.');
  process.exit(2);
}

const PROTECTED = ['main', 'master'];
const GIT_OPTS = { encoding: 'utf-8', cwd: changeDir, stdio: ['ignore', 'pipe', 'pipe'] };

function insideRepository(repoRoot, candidate) {
  const relativePath = relative(repoRoot, candidate);
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${sep}`);
}

function isSafePathSegment(value) {
  return typeof value === 'string'
    && value.length > 0
    && value !== '.'
    && value !== '..'
    && !value.startsWith('-')
    && !/[\\/\u0000-\u001f]/.test(value);
}

// Determine current branch (literal arg array).
let branch = '';
try {
  branch = (execFileSync('git', ['branch', '--show-current'], GIT_OPTS) || '').trim();
} catch {
  console.error('ensure-branch: could not determine current git branch. Is <change-dir> inside a git repository?');
  process.exit(1);
}

if (!PROTECTED.includes(branch)) {
  if (!isolate) {
    console.log(`ensure-branch: already isolated on branch '${branch}'. Proceed with implementation edits.`);
    console.log('To create an isolated context, re-run with --isolate.');
    process.exit(0);
  }
  console.error(`ensure-branch: on non-protected branch '${branch}' with --isolate. Creating an isolated implementation context...`);
} else {
  console.error(`ensure-branch: on protected branch '${branch}'. Creating an isolated implementation context...`);
}

let repoRoot;
try {
  repoRoot = realpathSync((execFileSync('git', ['rev-parse', '--show-toplevel'], GIT_OPTS) || '').trim());
} catch {
  console.error('ensure-branch: could not determine the Git repository root.');
  process.exit(1);
}

const sourceChangeDir = realpathSync(resolve(changeDir));
if (!insideRepository(repoRoot, sourceChangeDir)) {
  console.error('ensure-branch: change directory must be inside the Git repository.');
  process.exit(1);
}
const changeRelativePath = relative(repoRoot, sourceChangeDir);
const repoName = basename(repoRoot) || 'repo';
const name = changeName || repoName;
if (!isSafePathSegment(name)) {
  console.error('ensure-branch: change name must be a single safe path segment.');
  process.exit(1);
}
const worktreePath = join(repoRoot, 'changes', 'worktrees', name);

function copyActiveChange(worktreeRoot) {
  if (!existsSync(sourceChangeDir)) return;
  const targetChangeDir = join(worktreeRoot, changeRelativePath);
  mkdirSync(dirname(targetChangeDir), { recursive: true });
  cpSync(sourceChangeDir, targetChangeDir, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
  });
}

if (PROTECTED.includes(branch) && !confirm && !force && !isolate && !sync) {
  console.error(`ensure-branch: on protected branch '${branch}'. Confirmation required before creating/reusing the isolated worktree at ${worktreePath} (branch '${name}'). Ask the user: re-run with --confirm to create/reuse the worktree, or with --force to edit '${branch}' in place.`);
  process.exit(1);
}

if (PROTECTED.includes(branch) && force) {
  console.log(`ensure-branch: WARNING — editing protected branch '${branch}' in place with --force. This modifies the current branch directly.`);
  process.exit(0);
}

// Isolation via an in-repo worktree (literal arg array) — the only isolation
// mode. A worktree left over from a previous run is reused by re-copying the
// active change artifacts, guarded by divergence protection.
if (existsSync(worktreePath)) {
  const d = divergence(sourceChangeDir);
  if (!sync && d.diverged && d.worktreeNewer) {
    console.error(`ensure-branch: worktree copy at ${worktreePath} is newer than the source change directory. Refusing to overwrite. Re-run with --sync to force source -> worktree copy, or sync the worktree copy back first.`);
    process.exit(1);
  }
  if (!sync && d.diverged && !d.freshnessKnown) {
    console.error(`ensure-branch: worktree copy at ${worktreePath} diverged from the source and freshness cannot be determined. Refusing to overwrite. Re-run with --sync to force source -> worktree copy.`);
    process.exit(1);
  }
  // diverged but worktreeNewer=false and freshnessKnown=true (worktree older) -> allow overwrite
  recordWorktree(sourceChangeDir, repoRoot, worktreePath);
  copyActiveChange(worktreePath);
  if (sync) console.log(`ensure-branch: --sync forced source -> worktree copy at ${worktreePath}.`);
  console.log(`ensure-branch: reused existing git worktree at ${worktreePath}. Make implementation edits there.`);
  process.exit(0);
}

try {
  execFileSync('git', ['worktree', 'add', worktreePath, '-b', name], { ...GIT_OPTS, stdio: 'inherit' });
  recordWorktree(sourceChangeDir, repoRoot, worktreePath);
  copyActiveChange(worktreePath);
  console.log(`ensure-branch: created git worktree at ${worktreePath} on branch '${name}' with active change artifacts. Make all implementation edits there.`);
  process.exit(0);
} catch (e) {
  console.error(`ensure-branch: worktree creation failed: ${(e.stderr || e.stdout || e.message || 'unknown').toString().trim()}`);
}

// Creation failed → require explicit approval to edit in place.
if (force) {
  console.error('ensure-branch: WARNING — editing the current branch in place with --force after worktree creation failed. This modifies the current branch directly.');
  process.exit(0);
}
console.error('ensure-branch: could not create an isolated context and no --force given. STOP and ask the user for explicit approval before editing main/master.');
process.exit(1);
