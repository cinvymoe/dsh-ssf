// tests/lib/dsh-ssf-snapshot-store.test.mjs
// Tests for packages/dsh-ssf/lib/snapshot-store.js — isolated snapshot
// persistence helpers. Mirrors the task's coverage checklist.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';

let store;

before(async () => {
  store = await import(join(process.cwd(), 'packages/dsh-ssf/lib/snapshot-store.js'));
});

const created = [];

function mkTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ssf-store-'));
  created.push(dir);
  return dir;
}

after(() => {
  for (const p of created) rmSync(p, { recursive: true, force: true });
});

describe('resolveSnapshotPath', () => {
  it('defaults to join(resolveDshHome(), ssf.json)', () => {
    const expected = join(store.resolveDshHome(), 'ssf.json');
    assert.equal(store.resolveSnapshotPath({}), expected);
    assert.equal(store.resolveSnapshotPath(), expected);
    assert.equal(store.resolveSnapshotPath({ path: undefined, dshHome: undefined }), expected);
  });

  it('supports explicit path override (wins over dshHome)', () => {
    const custom = join(tmpdir(), `custom-${Date.now()}.json`);
    assert.equal(store.resolveSnapshotPath({ path: custom }), resolve(custom));
    const home = mkTmpDir();
    assert.equal(store.resolveSnapshotPath({ path: custom, dshHome: home }), resolve(custom));
  });

  it('supports dshHome override when path absent', () => {
    const home = mkTmpDir();
    const expected = join(resolve(home), 'ssf.json');
    assert.equal(store.resolveSnapshotPath({ dshHome: home }), expected);
  });

  it('expands ~ in path', () => {
    const home = homedir();
    assert.equal(store.resolveSnapshotPath({ path: '~/a.json' }), resolve(join(home, 'a.json')));
    assert.equal(store.resolveSnapshotPath({ path: '~/b/c.json' }), resolve(join(home, 'b/c.json')));
    assert.equal(store.resolveSnapshotPath({ path: '~' + '/x.json' }), resolve(join(home, 'x.json')));
    // bare ~ alone is not a valid .json path and should throw (unless suffixed)
    assert.throws(() => store.resolveSnapshotPath({ path: '~' }), /not supported/);
  });

  it('expands ~ in dshHome (default path)', () => {
    const home = homedir();
    const expectedHome = resolve(join(home, 'my-home'));
    assert.equal(store.resolveSnapshotPath({ dshHome: '~/my-home' }), join(expectedHome, 'ssf.json'));
  });

  it('throws for non-.json extensions', () => {
    assert.throws(() => store.resolveSnapshotPath({ path: '/tmp/a.yaml' }), /not supported/);
    assert.throws(() => store.resolveSnapshotPath({ path: '/tmp/a.txt' }), /not supported/);
    assert.throws(() => store.resolveSnapshotPath({ path: '/tmp/a' }), /not supported/);
    assert.throws(() => store.resolveSnapshotPath({ path: '/tmp/a.json.bak' }), /not supported/);
  });

  it('always returns an absolute path', () => {
    const rel = 'relative.json';
    const resolved = store.resolveSnapshotPath({ path: rel });
    assert.ok(resolved.startsWith('/'), 'must be absolute');
    assert.equal(resolved, resolve(rel));
  });
});

describe('emptySnapshot', () => {
  it('has the shape { changes: [], workspaces: [], scannedAt: null, bindings: {} }', () => {
    assert.deepEqual(store.emptySnapshot(), { changes: [], workspaces: [], scannedAt: null, bindings: {} });
    // returns a fresh object each time
    const a = store.emptySnapshot();
    const b = store.emptySnapshot();
    assert.notEqual(a, b);
    a.changes.push({ name: 'x' });
    assert.deepEqual(b.changes, []);
    a.bindings.s1 = { workspace: '/w', change: 'c', boundAt: 1 };
    assert.deepEqual(b.bindings, {});
  });
});

describe('loadSnapshotSync', () => {
  it('returns emptySnapshot when file does not exist', () => {
    const missing = join(mkTmpDir(), 'missing.json');
    assert.deepEqual(store.loadSnapshotSync(missing), store.emptySnapshot());
  });

  it('returns emptySnapshot for empty file or whitespace', async () => {
    const dir = mkTmpDir();
    const file = join(dir, 'empty.json');
    writeFileSync(file, '');
    assert.deepEqual(store.loadSnapshotSync(file), store.emptySnapshot());
    writeFileSync(file, '   \n  ');
    assert.deepEqual(store.loadSnapshotSync(file), store.emptySnapshot());
  });

  it('returns emptySnapshot for invalid JSON', () => {
    const dir = mkTmpDir();
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{ not: json');
    assert.deepEqual(store.loadSnapshotSync(file), store.emptySnapshot());
    writeFileSync(file, 'null');
    // JSON null is null -> treated as empty
    assert.deepEqual(store.loadSnapshotSync(file), store.emptySnapshot());
  });

  it('parses valid snapshot and normalizes fields', () => {
    const dir = mkTmpDir();
    const file = join(dir, 'valid.json');
    const data = { changes: [{ name: 'a' }], workspaces: [{ workspace: 'w' }], scannedAt: 123 };
    writeFileSync(file, JSON.stringify(data));
    assert.deepEqual(store.loadSnapshotSync(file), { ...data, bindings: {} });
  });

  it('preserves bindings and falls back to {} for non-object bindings', () => {
    const dir = mkTmpDir();
    const file = join(dir, 'bindings.json');
    const bindings = { s1: { workspace: '/w', change: 'alpha', boundAt: 1 } };
    writeFileSync(file, JSON.stringify({ changes: [], workspaces: [], scannedAt: 1, bindings }));
    assert.deepEqual(store.loadSnapshotSync(file).bindings, bindings);

    for (const bad of [[], 42, 'x', null]) {
      writeFileSync(file, JSON.stringify({ changes: [], workspaces: [], scannedAt: 1, bindings: bad }));
      assert.deepEqual(store.loadSnapshotSync(file).bindings, {}, `bindings=${JSON.stringify(bad)} must normalize to {}`);
    }
  });

  it('defaults missing/invalid fields to empty array or null', () => {
    const dir = mkTmpDir();
    const file = join(dir, 'partial.json');
    writeFileSync(file, JSON.stringify({ changes: 'not-array', scannedAt: '123' }));
    const loaded = store.loadSnapshotSync(file);
    assert.deepEqual(loaded.changes, []);
    assert.deepEqual(loaded.workspaces, []);
    assert.equal(loaded.scannedAt, null);

    writeFileSync(file, JSON.stringify({ workspaces: 'not-array', scannedAt: 456 }));
    const loaded2 = store.loadSnapshotSync(file);
    assert.deepEqual(loaded2.changes, []);
    assert.deepEqual(loaded2.workspaces, []);
    assert.equal(loaded2.scannedAt, 456);

    writeFileSync(file, JSON.stringify({ changes: [{ name: 'a' }], workspaces: [{ path: '/a' }] }));
    const loaded3 = store.loadSnapshotSync(file);
    assert.equal(loaded3.scannedAt, null);
  });

  it('returns emptySnapshot for array or non-object JSON', () => {
    const dir = mkTmpDir();
    const file = join(dir, 'array.json');
    writeFileSync(file, JSON.stringify([{ name: 'a' }]));
    assert.deepEqual(store.loadSnapshotSync(file), store.emptySnapshot());
    writeFileSync(file, JSON.stringify(123));
    assert.deepEqual(store.loadSnapshotSync(file), store.emptySnapshot());
  });
});

describe('persistSnapshot', () => {
  it('writes JSON and can be read back via loadSnapshotSync', async () => {
    const dir = mkTmpDir();
    const file = join(dir, 'nested', 'ssf.json');
    const snapshot = { changes: [{ name: 'alpha', state: 'executing' }], workspaces: [{ path: '/tmp', workspace: 'tmp', changes: [] }], scannedAt: Date.now(), bindings: { s1: { workspace: '/tmp', change: 'alpha', boundAt: 1 } } };
    await store.persistSnapshot(snapshot, file);
    assert.ok(existsSync(file));
    const loaded = store.loadSnapshotSync(file);
    assert.deepEqual(loaded, snapshot);
    // also async load
    const loadedAsync = await store.loadSnapshot(file);
    assert.deepEqual(loadedAsync, snapshot);
  });

  it('creates parent directories with 0700 and file with 0600 (when possible)', async () => {
    const dir = mkTmpDir();
    const file = join(dir, 'a', 'b', 'ssf.json');
    const snapshot = { changes: [], workspaces: [], scannedAt: 1, bindings: {} };
    await store.persistSnapshot(snapshot, file);
    assert.ok(existsSync(file));
    const content = readFileSync(file, 'utf8');
    assert.match(content, /"scannedAt": 1/);
  });

  it('overwrites existing file and remains readable', async () => {
    const dir = mkTmpDir();
    const file = join(dir, 'ssf.json');
    const snap1 = { changes: [{ name: 'first' }], workspaces: [], scannedAt: 1, bindings: {} };
    const snap2 = { changes: [{ name: 'second' }], workspaces: [], scannedAt: 2, bindings: {} };
    await store.persistSnapshot(snap1, file);
    assert.deepEqual(store.loadSnapshotSync(file), snap1);
    await store.persistSnapshot(snap2, file);
    assert.deepEqual(store.loadSnapshotSync(file), snap2);
  });
});

describe('resolveDshHome & expandHomePath', () => {
  it('resolveDshHome respects explicit configured path', () => {
    assert.equal(store.resolveDshHome('/tmp/custom'), resolve('/tmp/custom'));
    assert.equal(store.resolveDshHome('/tmp/custom', {}), resolve('/tmp/custom'));
  });

  it('resolveDshHome uses DSH_HOME env when configured absent', () => {
    const fakeEnv = { DSH_HOME: '/tmp/from-env' };
    assert.equal(store.resolveDshHome(undefined, fakeEnv), resolve('/tmp/from-env'));
  });

  it('resolveDshHome falls back to ~/.dsh when env empty', () => {
    assert.equal(store.resolveDshHome(undefined, {}), resolve(join(homedir(), '.dsh')));
    assert.equal(store.resolveDshHome(undefined, { DSH_HOME: '' }), resolve(join(homedir(), '.dsh')));
    assert.equal(store.resolveDshHome(undefined, { DSH_HOME: '   ' }), resolve(join(homedir(), '.dsh')));
  });

  it('expandHomePath expands ~ correctly', () => {
    const home = homedir();
    assert.equal(store.expandHomePath('~'), home);
    assert.equal(store.expandHomePath('~/a/b'), join(home, 'a/b'));
    assert.equal(store.expandHomePath('~\\a\\b'), join(home, 'a\\b'));
    assert.equal(store.expandHomePath('/absolute'), '/absolute');
    assert.equal(store.expandHomePath('relative'), 'relative');
  });
});
