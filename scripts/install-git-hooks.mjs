#!/usr/bin/env node
// install-git-hooks.mjs — install git hooks for spec-superflow repo
// Run with: npm run setup-hooks  (or node scripts/install-git-hooks.mjs)
//
// Installs a pre-commit hook that checks version consistency.
// Automatically run post-install so every contributor gets the guard.

import { writeFileSync, existsSync, chmodSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
// Ask Git for the common hooks directory so linked worktrees install correctly.
// `git rev-parse --git-path hooks` may be relative in a normal checkout.
const HOOKS_DIR = resolve(ROOT, execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
  cwd: ROOT,
  encoding: 'utf8',
}).trim());
const HOOK_PATH = join(HOOKS_DIR, 'pre-commit');

const HOOK_SCRIPT = `#!/usr/bin/env bash
# spec-superflow pre-commit hook — blocks commit if version files are out of sync
# Installed by: npm run setup-hooks
# To bypass: git commit --no-verify

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

echo "🔍 spec-superflow: checking version consistency..."

if ! node "$REPO_ROOT/scripts/check-version-consistency.mjs"; then
  echo ""
  echo "❌ Commit blocked: version mismatch detected."
  echo "   Fix: ssf version <new-version>"
  echo "   Bypass: git commit --no-verify"
  exit 1
fi

echo "✅ Version consistency OK"
`;

if (!existsSync(HOOKS_DIR)) {
  console.error('❌ Not inside a git repository (no .git/hooks/).');
  process.exit(1);
}

// Preserve an unrelated hook, but upgrade an older spec-superflow hook.
const MARKER = '# spec-superflow pre-commit hook';
if (existsSync(HOOK_PATH)) {
  const existing = readFileSync(HOOK_PATH, 'utf-8');
  if (existing.includes(MARKER)) {
    if (existing === HOOK_SCRIPT) {
      console.log('✅ Pre-commit hook already installed (spec-superflow).');
      process.exit(0);
    }
    console.log('♻️  Updating existing pre-commit hook (spec-superflow).');
  } else {
    console.log('⚠️  Existing pre-commit hook found. Backing up to pre-commit.backup ...');
    writeFileSync(`${HOOK_PATH}.backup`, existing);
  }
}

writeFileSync(HOOK_PATH, HOOK_SCRIPT);
chmodSync(HOOK_PATH, 0o755);
console.log('✅ Pre-commit hook installed — version consistency checked before every commit.');
console.log('   To bypass: git commit --no-verify');
