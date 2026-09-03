// tests/lib/cmd-state-missing.test.mjs
// Regression for BUG-B: `ssf state` subcommands must error (not silently drift)
// when the .spec-superflow.yaml does not exist. Previously `set` would create a
// phantom state file in the wrong directory.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CLI = join(ROOT, 'scripts', 'spec-superflow.mjs');

function makeEmptyDir() {
  // A directory with NO .spec-superflow.yaml on purpose.
  return mkdtempSync(join(tmpdir(), 'ssf-state-missing-'));
}

function cleanup(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

function run(args) {
  try {
    execSync(`node ${CLI} ${args}`, { stdio: 'pipe', timeout: 5000 });
    return { ok: true, out: '' };
  } catch (e) {
    const out = `${e.stdout?.toString() || ''}\n${e.stderr?.toString() || ''}`;
    return { ok: false, out: out || e.message };
  }
}

describe('BUG-B: ssf state errors on missing state file (no phantom drift)', () => {
  let dir;
  before(() => { dir = makeEmptyDir(); });
  after(() => { cleanup(dir); });

  it('SHALL error on `state transition` when no state file', () => {
    const r = run(`state transition "${dir}" closing`);
    assert.equal(r.ok, false, 'transition must fail without a state file');
    assert.match(r.out, /No state file/i);
  });

  it('SHALL error on `state get` when no state file', () => {
    const r = run(`state get "${dir}" workflow`);
    assert.equal(r.ok, false, 'get must fail without a state file');
    assert.match(r.out, /No state file/i);
  });

  it('SHALL error on `state set` and NOT create a phantom state file', () => {
    const r = run(`state set "${dir}" dp_0_confirmed true`);
    assert.equal(r.ok, false, 'set must fail without a state file');
    assert.match(r.out, /No state file/i);
    assert.equal(
      existsSync(join(dir, '.spec-superflow.yaml')),
      false,
      'set must NOT create a phantom .spec-superflow.yaml in a missing-state directory',
    );
  });
});
