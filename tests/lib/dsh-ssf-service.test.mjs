// tests/lib/dsh-ssf-service.test.mjs
// Tests for packages/dsh-ssf/lib/index.js — the host-side 'ssf' change-status
// service (scan/summary/refresh/getSnapshot), its standalone snapshot file
// persistence, and the HTTP snapshot endpoint. The session-driven root
// resolution (dsh-ssf-tab-data-fix) is retained.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { tmpdir, homedir } from 'node:os';

let plugin;
let snapshotStore;

before(async () => {
  plugin = await import(join(process.cwd(), 'packages/dsh-ssf/lib/index.js'));
  snapshotStore = await import(join(process.cwd(), 'packages/dsh-ssf/lib/snapshot-store.js'));
});

const createdRoots = [];

function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ssf-service-'));
  createdRoots.push(root);
  return root;
}

function makeTempSnapshotPath() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ssf-snap-'));
  createdRoots.push(dir);
  return join(dir, 'ssf.json');
}

function writeStateFile(dir, state) {
  const lines = [];
  for (const [key, value] of Object.entries(state)) {
    lines.push(`${key}: ${value}`);
  }
  writeFileSync(join(dir, '.spec-superflow.yaml'), lines.join('\n'));
}

function makeChange(root, name) {
  const dir = join(root, 'changes', name);
  mkdirSync(dir, { recursive: true });
  writeStateFile(dir, { state: 'executing', workflow: 'full' });
}

after(() => {
  for (const root of createdRoots) rmSync(root, { recursive: true, force: true });
});

/**
 * Minimal cordis-shaped ctx for the new file-based implementation.
 * `workspaceRegistry.list` is the source for all-workspaces scan.
 * `webServer` is optional — when present, `ctx.inject(['webServer'], ...)`
 * should fire and register GET /dsh-ssf/snapshot. When absent, the plugin
 * must still boot.
 * `snapshotPath` is passed as plugin config `{ path: snapshotPath }`.
 */
function makeFakeCtx({ workspaces, snapshotPath, withWebServer = true } = {}) {
  const calls = {
    provided: {},
    listeners: [],
    toolsRegistered: [],
    sessionProjectionRegisters: 0,
    sessionAppends: 0,
    webServerRegisters: [],
    effectLabels: [],
    injectCalls: [],
  };
  const ctx = {
    workspaceRegistry: {
      list: () => workspaces ?? [{ sessionIds: ['s1'], path: makeWorkspace() }],
    },
    tools: {
      register: (def) => {
        calls.toolsRegistered.push(def);
        return () => {};
      },
    },
    on: (event, cb) => {
      calls.listeners.push({ event, cb });
    },
    provide: (name, service) => {
      calls.provided[name] = service;
    },
    logger: {
      warn: () => {},
      info: () => {},
    },
    subprocess: {
      spawn: () => ({ done: Promise.resolve({ exitCode: 0 }), collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: '' }) } } }),
    },
    setTimeout: setTimeout,
    effect: (fn, label) => {
      calls.effectLabels.push(label);
      try {
        const ret = fn();
        return ret ?? (() => {});
      } catch {
        return () => {};
      }
    },
  };
  if (withWebServer) {
    ctx.webServer = {
      register: (opts) => {
        calls.webServerRegisters.push(opts);
        return () => {};
      },
    };
  }
  ctx.inject = (names, fn) => {
    calls.injectCalls.push([...names]);
    const missing = names.find((n) => ctx[n] === undefined);
    if (missing) {
      return () => {};
    }
    // Cordis inject runs `fn` with the host ctx and typically expects the
    // callback to call `hostCtx.effect(...)` internally. Our `effect` above
    // captures that. Just invoke fn(ctx).
    const result = fn(ctx);
    return result ?? (() => {});
  };
  return { ctx, calls };
}

/** Invoke the captured agent/session-start listener and await its work. */
async function startSession(ctx, calls, sessionId, cwd) {
  const listener = calls.listeners.find((l) => l.event === 'agent/session-start');
  assert.ok(listener, 'an agent/session-start listener must be registered');
  const agent = { session: { id: sessionId } };
  if (cwd !== undefined) agent.session.header = { cwd };
  await listener.cb({ agent });
}

/** Flush microtasks and a short timer so fire-and-forget refresh() settles. */
async function settle(ms = 50) {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, ms));
}

describe('dsh-ssf service registration', () => {
  it('declares every ctx.<service> it reads in the cordis inject list (without settings)', () => {
    // Host previously used `settings`; after refactor it must not appear.
    const sorted = [...plugin.inject].sort();
    assert.deepEqual(sorted, ['subprocess', 'tools', 'workspaceRegistry']);
    assert.equal(sorted.includes('settings'), false);
  });

  it('registers an ssf service exposing scan/summary/refresh/getSnapshot/bind/getBinding', () => {
    const root = makeWorkspace();
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }], snapshotPath: snapPath });
    plugin.apply(ctx, { path: snapPath });

    const service = calls.provided['ssf'];
    assert.ok(service, 'a service named ssf must be provided');
    assert.equal(typeof service.scan, 'function');
    assert.equal(typeof service.summary, 'function');
    assert.equal(typeof service.refresh, 'function');
    assert.equal(typeof service.getSnapshot, 'function');
    assert.equal(typeof service.bind, 'function');
    assert.equal(typeof service.getBinding, 'function');
  });

  it('does not register session projections or append session events (route rejected)', () => {
    const root = makeWorkspace();
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }], snapshotPath: snapPath });
    plugin.apply(ctx, { path: snapPath });

    assert.equal(calls.sessionProjectionRegisters, 0);
    assert.equal(calls.sessionAppends, 0);
  });

  it('does not register a dead ready listener (harness never fires ready)', () => {
    const root = makeWorkspace();
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }], snapshotPath: snapPath });
    plugin.apply(ctx, { path: snapPath });

    assert.equal(calls.listeners.some((l) => l.event === 'ready'), false);
  });

  it('Config schema accepts path and dshHome overrides', () => {
    const { Config } = snapshotStore;
    assert.ok(Config, 'Config must be exported from snapshot-store');
    // Schemastery schemas are callable: Config(value) returns normalized value.
    const empty = Config({});
    assert.deepEqual(empty, {});
    const withPath = Config({ path: '/tmp/a.json' });
    assert.equal(withPath.path, '/tmp/a.json');
    const withHome = Config({ dshHome: '/tmp/home' });
    assert.equal(withHome.dshHome, '/tmp/home');
    const both = Config({ path: '/tmp/b.json', dshHome: '/tmp/home2' });
    assert.equal(both.path, '/tmp/b.json');
  });
});

describe('dsh-ssf snapshot path resolution', () => {
  it('defaults to join(resolveDshHome(), ssf.json)', () => {
    const expected = join(snapshotStore.resolveDshHome(), 'ssf.json');
    const actual = snapshotStore.resolveSnapshotPath({});
    assert.equal(actual, expected);
    const actual2 = snapshotStore.resolveSnapshotPath();
    assert.equal(actual2, expected);
  });

  it('supports path override (absolute)', () => {
    const custom = join(tmpdir(), `custom-${Date.now()}.json`);
    const resolved = snapshotStore.resolveSnapshotPath({ path: custom });
    assert.equal(resolved, resolve(custom));
  });

  it('supports dshHome override', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    createdRoots.push(home);
    const resolved = snapshotStore.resolveSnapshotPath({ dshHome: home });
    assert.equal(resolved, join(resolve(home), 'ssf.json'));
  });

  it('expands ~ in path and dshHome', () => {
    const home = homedir();
    const viaTilde = snapshotStore.resolveSnapshotPath({ path: '~/my-ssf.json' });
    assert.equal(viaTilde, resolve(join(home, 'my-ssf.json')));
    const viaTilde2 = snapshotStore.resolveSnapshotPath({ path: '~' + '/a/b.json' });
    assert.equal(viaTilde2, resolve(join(home, 'a/b.json')));

    // dshHome with ~
    const viaHomeTilde = snapshotStore.resolveSnapshotPath({ dshHome: '~/my-home', path: undefined });
    // When path not provided, dshHome tilde should affect default
    const expectedHome = resolve(join(home, 'my-home'));
    assert.equal(viaHomeTilde, join(expectedHome, 'ssf.json'));
  });

  it('throws for non-.json extensions', () => {
    assert.throws(() => snapshotStore.resolveSnapshotPath({ path: '/tmp/a.yaml' }), /not supported/);
    assert.throws(() => snapshotStore.resolveSnapshotPath({ path: '/tmp/a.txt' }), /not supported/);
    assert.throws(() => snapshotStore.resolveSnapshotPath({ path: '/tmp/a' }), /not supported/);
  });

  it('emptySnapshot has the expected shape', () => {
    const empty = snapshotStore.emptySnapshot();
    assert.deepEqual(empty, { changes: [], workspaces: [], scannedAt: null, bindings: {} });
  });

  it('resolveSnapshotPath with explicit path wins over dshHome', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-prio-'));
    createdRoots.push(home);
    const custom = join(tmpdir(), `prio-${Date.now()}.json`);
    const resolved = snapshotStore.resolveSnapshotPath({ path: custom, dshHome: home });
    assert.equal(resolved, resolve(custom));
  });
});

describe('dsh-ssf service behavior (snapshot file & HTTP)', () => {
  it('refresh() re-scans workspaces and persists { changes, workspaces, scannedAt } to file', async () => {
    const root = makeWorkspace();
    makeChange(root, 'alpha');
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }], snapshotPath: snapPath });
    plugin.apply(ctx, { path: snapPath });

    const service = calls.provided['ssf'];
    const snapshot = await service.refresh();

    assert.ok(Array.isArray(snapshot.changes));
    assert.ok(Array.isArray(snapshot.workspaces));
    assert.equal(typeof snapshot.scannedAt, 'number');
    assert.deepEqual(snapshot.changes.map((c) => c.name), ['alpha']);
    const alpha = snapshot.changes[0];
    assert.equal(alpha.state, 'executing');
    assert.equal(alpha.workflow, 'full');

    // File content must match the in-memory snapshot (including workspaces)
    const persisted = JSON.parse(readFileSync(snapPath, 'utf8'));
    assert.deepEqual(persisted, snapshot);
    // getSnapshot must return the same object
    assert.deepEqual(service.getSnapshot(), snapshot);
  });

  it('HTTP route is registered as exact GET /dsh-ssf/snapshot and serves currentSnapshot', async () => {
    const root = makeWorkspace();
    makeChange(root, 'route-alpha');
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }], snapshotPath: snapPath, withWebServer: true });
    plugin.apply(ctx, { path: snapPath });

    // Ensure a snapshot is available
    const service = calls.provided['ssf'];
    const snapshot = await service.refresh();

    assert.equal(calls.webServerRegisters.length, 1, 'webServer.register must be called once');
    const reg = calls.webServerRegisters[0];
    assert.equal(reg.path, '/dsh-ssf/snapshot');
    assert.equal(reg.kind, 'exact');
    assert.equal(typeof reg.handler, 'function');

    // Simulate GET
    let status, headers, body;
    const resGet = {
      writeHead: (code, h) => { status = code; headers = h; },
      end: (b) => { body = b; },
    };
    reg.handler({ method: 'GET' }, resGet);
    assert.equal(status, 200);
    assert.equal(headers['Content-Type'], 'application/json; charset=utf-8');
    assert.equal(headers['Cache-Control'], 'no-store');
    const parsed = JSON.parse(body);
    assert.deepEqual(parsed, snapshot);
    // Content-Length should match body length
    assert.equal(headers['Content-Length'], Buffer.byteLength(body));

    // Simulate non-GET → 405
    let status2, headers2, body2;
    const resPost = {
      writeHead: (code, h) => { status2 = code; headers2 = h; },
      end: (b) => { body2 = b; },
    };
    reg.handler({ method: 'POST' }, resPost);
    assert.equal(status2, 405);
    assert.equal(headers2.Allow, 'GET');
    assert.match(body2, /method not allowed/);

    // Also PUT
    let status3;
    const resPut = {
      writeHead: (code) => { status3 = code; },
      end: () => {},
    };
    reg.handler({ method: 'PUT' }, resPut);
    assert.equal(status3, 405);
  });

  it('does not fail when webServer is absent (non-web profile)', () => {
    const snapPath = makeTempSnapshotPath();
    const root = makeWorkspace();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }], snapshotPath: snapPath, withWebServer: false });
    // Should not throw
    plugin.apply(ctx, { path: snapPath });
    assert.ok(calls.provided['ssf'], 'service must still be provided without webServer');
    assert.equal(calls.webServerRegisters.length, 0);
  });

  it('scan() and summary(changeDir) resolve against the session workspace root', async () => {
    const root = makeWorkspace();
    makeChange(root, 'alpha');
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }], snapshotPath: snapPath });
    plugin.apply(ctx, { path: snapPath });
    await startSession(ctx, calls, 's1');

    const service = calls.provided['ssf'];

    const scanned = service.scan();
    assert.deepEqual(scanned.map((c) => c.name), ['alpha']);

    const summary = service.summary('alpha');
    assert.equal(summary.name, 'alpha');
    assert.equal(summary.state, 'executing');
    assert.equal(summary.workflow, 'full');
  });

  it('getSnapshot returns file-backed snapshot after refresh', async () => {
    const root = makeWorkspace();
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }], snapshotPath: snapPath });
    plugin.apply(ctx, { path: snapPath });
    const service = calls.provided['ssf'];
    // Initially empty (no changes)
    await service.refresh();
    const snap1 = service.getSnapshot();
    assert.deepEqual(snap1.changes, []);
    // Add a change and refresh
    makeChange(root, 'beta');
    const snap2 = await service.refresh();
    assert.deepEqual(snap2.changes.map((c) => c.name), ['beta']);
    assert.deepEqual(service.getSnapshot(), snap2);
    const fileSnap = snapshotStore.loadSnapshotSync(snapPath);
    assert.deepEqual(fileSnap, snap2);
  });
});

describe('dsh-ssf workspace root resolution', () => {
  it('falls back to process.cwd() when no workspace matches the session id', async () => {
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({ workspaces: [], snapshotPath: snapPath });
    plugin.apply(ctx, { path: snapPath });
    await startSession(ctx, calls, 's1');

    const scanned = calls.provided['ssf'].scan();

    assert.ok(Array.isArray(scanned));
    // the repo's own changes/ directory is scanned from the cwd fallback
    assert.ok(scanned.some((c) => c.name === 'dsh-ssf-plugin'));
  });

  it('falls back to process.cwd() when the workspace registry is absent', async () => {
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({ snapshotPath: snapPath });
    delete ctx.workspaceRegistry;
    plugin.apply(ctx, { path: snapPath });
    await startSession(ctx, calls, 's1');

    const scanned = calls.provided['ssf'].scan();

    assert.ok(Array.isArray(scanned));
  });

  it('uses the session header cwd when the registry misses the session (registry race)', async () => {
    const root = makeWorkspace();
    makeChange(root, 'gamma');
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({ workspaces: [], snapshotPath: snapPath }); // registry does NOT know this session yet
    plugin.apply(ctx, { path: snapPath });
    await settle(10);

    await startSession(ctx, calls, 's1', root);

    const service = calls.provided['ssf'];
    const scanned = service.scan();
    assert.deepEqual(scanned.map((c) => c.name), ['gamma'], 'scan must resolve against the session header cwd');
  });

  it('prefers a registry match over the session header cwd when both are present', async () => {
    const registryRoot = makeWorkspace();
    const sessionCwd = makeWorkspace();
    makeChange(registryRoot, 'from-registry');
    makeChange(sessionCwd, 'from-cwd');
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({
      workspaces: [{ sessionIds: ['s1'], path: registryRoot }],
      snapshotPath: snapPath,
    });
    plugin.apply(ctx, { path: snapPath });
    await settle(10);

    await startSession(ctx, calls, 's1', sessionCwd);

    const service = calls.provided['ssf'];
    assert.deepEqual(
      service.scan().map((c) => c.name),
      ['from-registry'],
      'the registry is authoritative once it has attached the session',
    );
  });

  it('ignores a non-existent session header cwd and falls back to process.cwd()', async () => {
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({ workspaces: [], snapshotPath: snapPath });
    plugin.apply(ctx, { path: snapPath });
    await settle(10);

    await startSession(ctx, calls, 's1', '/nonexistent/dsh-ssf-test-cwd');

    const scanned = calls.provided['ssf'].scan();
    assert.ok(Array.isArray(scanned));
    // process.cwd() is the repo during tests → the repo's own changes scan in.
    assert.ok(scanned.some((c) => c.name === 'dsh-ssf-plugin'));
  });

  it('never publishes an empty snapshot while any spec workspace exists (all-workspaces panel)', async () => {
    const specRoot = makeWorkspace();
    makeChange(specRoot, 'alpha');
    const foreignRoot = makeWorkspace(); // no changes/ dir
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({
      workspaces: [
        { sessionIds: ['spec'], path: specRoot, title: 'specRoot' },
        { sessionIds: ['foreign'], path: foreignRoot, title: 'foreign' },
      ],
      snapshotPath: snapPath,
    });
    plugin.apply(ctx, { path: snapPath });
    await settle(10);

    await startSession(ctx, calls, 'spec');
    // Force a refresh to ensure file is written after spec session's root update
    await calls.provided['ssf'].refresh();
    let snapshot = calls.provided['ssf'].getSnapshot();
    assert.ok(snapshot.changes.length > 0, 'a spec workspace session must publish');
    assert.deepEqual(
      snapshot.changes.map((c) => c.name),
      ['alpha'],
    );
    // Also verify file persisted
    let fileSnap = snapshotStore.loadSnapshotSync(snapPath);
    assert.deepEqual(fileSnap.changes.map((c) => c.name), ['alpha']);

    await startSession(ctx, calls, 'foreign');
    await calls.provided['ssf'].refresh();

    // The foreign session's OWN single-root scan is empty, but the shared snapshot
    // must keep (and re-publish) the spec workspace data via all-workspaces scan.
    assert.deepEqual(calls.provided['ssf'].scan().map((c) => c.name), []);
    const last = calls.provided['ssf'].getSnapshot();
    assert.deepEqual(last.changes.map((c) => c.name), ['alpha']);
    assert.equal(last.workspaces.length, 1);
    assert.equal(last.workspaces[0].workspace, 'specRoot');
    fileSnap = snapshotStore.loadSnapshotSync(snapPath);
    assert.deepEqual(fileSnap.changes.map((c) => c.name), ['alpha']);
  });

  it('groups all spec workspaces and flattens every flow for the panel', async () => {
    const rootA = makeWorkspace();
    const rootB = makeWorkspace();
    const nonSpec = makeWorkspace();
    makeChange(rootA, 'alpha');
    makeChange(rootB, 'beta');
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({
      workspaces: [
        { sessionIds: ['s1'], path: rootA, title: 'A-workspace' },
        { sessionIds: ['s2'], path: rootB, title: 'B-workspace' },
        { sessionIds: ['s3'], path: nonSpec, title: 'not-spec' },
      ],
      snapshotPath: snapPath,
    });
    plugin.apply(ctx, { path: snapPath });
    await settle(10);

    await startSession(ctx, calls, 's1');
    const last = await calls.provided['ssf'].refresh();
    assert.equal(last.workspaces.length, 2, 'non-spec workspaces are excluded');
    assert.deepEqual(last.workspaces.map((w) => w.workspace).sort(), ['A-workspace', 'B-workspace']);
    const byName = Object.fromEntries(last.workspaces.map((w) => [w.workspace, w]));
    assert.deepEqual(byName['A-workspace'].changes.map((c) => c.name), ['alpha']);
    assert.deepEqual(byName['B-workspace'].changes.map((c) => c.name), ['beta']);
    assert.deepEqual(last.changes.map((c) => c.name).sort(), ['alpha', 'beta']);
    assert.equal(last.changes[0].workspace, 'A-workspace');
    assert.equal(last.changes[0].workspacePath, rootA);
  });

  it('still publishes an empty scan for a spec workspace whose changes/ exists but has no changes yet', async () => {
    const specRoot = makeWorkspace();
    mkdirSync(join(specRoot, 'changes'), { recursive: true }); // spec workspace, zero changes
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: specRoot }], snapshotPath: snapPath });
    plugin.apply(ctx, { path: snapPath });
    await settle(10);
    const beforeSnap = await calls.provided['ssf'].refresh();
    // before already has empty changes but with workspaces length 1? Let's capture.
    await startSession(ctx, calls, 's1');
    const last = await calls.provided['ssf'].refresh();
    // must still have workspaces entry even though changes empty
    assert.equal(last.workspaces.length, 1);
    assert.deepEqual(last.changes, []);
    assert.deepEqual(last.workspaces[0].changes, []);
  });

  it('refresh after session-start updates root and snapshot file', async () => {
    const rootA = makeWorkspace();
    const rootB = makeWorkspace();
    makeChange(rootB, 'beta');
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({
      workspaces: [
        { sessionIds: ['s1'], path: rootA },
        { sessionIds: ['s2'], path: rootB },
      ],
      snapshotPath: snapPath,
    });
    plugin.apply(ctx, { path: snapPath });
    // initial workspace without changes
    await startSession(ctx, calls, 's1');
    let snap = await calls.provided['ssf'].refresh();
    // Since all-workspaces scanning includes both, beta should already be visible even before s2 start.
    // But scan() should be empty for s1 root.
    assert.deepEqual(calls.provided['ssf'].scan().map((c) => c.name), []);
    // Now switch to s2 workspace which has beta
    await startSession(ctx, calls, 's2');
    snap = await calls.provided['ssf'].refresh();
    // scan() now reflects s2's root
    assert.deepEqual(calls.provided['ssf'].scan().map((c) => c.name), ['beta']);
    // snapshot file still contains beta via all-workspaces
    const fileSnap = snapshotStore.loadSnapshotSync(snapPath);
    assert.deepEqual(fileSnap.changes.map((c) => c.name), ['beta']);
  });
});

describe('dsh-ssf snapshots are not written to settings', () => {
  it('does not expose settings.register and inject does not contain settings', async () => {
    const snapPath = makeTempSnapshotPath();
    const root = makeWorkspace();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }], snapshotPath: snapPath });
    plugin.apply(ctx, { path: snapPath });
    // Verify no settings service was accessed
    assert.equal(ctx.settings, undefined);
    // The plugin's static inject must not contain settings
    assert.equal(plugin.inject.includes('settings'), false);
    // Calls should not have any settings register
    assert.equal(calls.sessionProjectionRegisters, 0);
    // Refresh should write to file, not to settings
    await calls.provided['ssf'].refresh();
    assert.ok(existsSync(snapPath));
    const content = JSON.parse(readFileSync(snapPath, 'utf8'));
    assert.ok(Array.isArray(content.changes));
  });
});

describe('dsh-ssf conversation bindings', () => {
  it('bind + getBinding round-trip', async () => {
    const root = makeWorkspace();
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }], snapshotPath: snapPath });
    plugin.apply(ctx, { path: snapPath });
    await startSession(ctx, calls, 's1');
    const service = calls.provided['ssf'];
    service.bind('s1', 'alpha');
    const binding = service.getBinding('s1');
    assert.ok(binding, 'binding must exist after bind');
    assert.equal(binding.workspace, root);
    assert.equal(binding.change, 'alpha');
    assert.equal(typeof binding.boundAt, 'number');
    assert.ok(binding.boundAt > 0);
    assert.equal(service.getBinding('nobody'), null);
  });

  it('one-to-one抢占：相同 workspace+change 的旧绑定被新绑定抢占', async () => {
    const root = makeWorkspace();
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }], snapshotPath: snapPath });
    plugin.apply(ctx, { path: snapPath });
    await startSession(ctx, calls, 's1');
    const service = calls.provided['ssf'];
    service.bind('s1', 'alpha');
    assert.ok(service.getBinding('s1'));
    service.bind('s2', 'alpha');
    assert.equal(service.getBinding('s1'), null, 's1 的绑定应被 s2 抢占后清空');
    const b2 = service.getBinding('s2');
    assert.ok(b2, 's2 应持有抢占后的绑定');
    assert.equal(b2.workspace, root);
    assert.equal(b2.change, 'alpha');
    assert.equal(typeof b2.boundAt, 'number');
  });

  it('refresh 携带 bindings 并同步持久化到文件', async () => {
    const root = makeWorkspace();
    makeChange(root, 'alpha');
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }], snapshotPath: snapPath });
    plugin.apply(ctx, { path: snapPath });
    await startSession(ctx, calls, 's1');
    const service = calls.provided['ssf'];
    service.bind('s1', 'alpha');
    const snapshot = await service.refresh();
    assert.ok(snapshot.bindings, 'refresh 返回的 snapshot 必须包含 bindings');
    assert.ok(snapshot.bindings['s1'], 'bindings 应包含 s1');
    assert.equal(snapshot.bindings['s1'].change, 'alpha');
    assert.equal(snapshot.bindings['s1'].workspace, root);
    // 同步持久化：文件中的 bindings 与内存一致
    await settle(80);
    const persisted = snapshotStore.loadSnapshotSync(snapPath);
    assert.ok(persisted.bindings, 'persisted snapshot must have bindings');
    assert.deepEqual(persisted.bindings['s1'], snapshot.bindings['s1']);
  });

  it('工具调用触发绑定：ssf_state 绑定到调用会话', async () => {
    const root = makeWorkspace();
    makeChange(root, 'alpha');
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }], snapshotPath: snapPath });
    plugin.apply(ctx, { path: snapPath });
    await startSession(ctx, calls, 's1');
    const service = calls.provided['ssf'];
    const tool = calls.toolsRegistered.find((t) => t.name === 'ssf_state');
    assert.ok(tool, 'ssf_state must be registered');
    const result = await tool.execute({ changeDir: 'alpha' }, { agent: { session: { id: 's1' } } });
    assert.equal(result.ok, true);
    assert.equal(service.getBinding('s1')?.change, 'alpha');
    assert.equal(service.getBinding('s1')?.workspace, root);
  });

  it('无效 sessionId no-op：undefined / 空字符串不产生绑定', async () => {
    const root = makeWorkspace();
    const snapPath = makeTempSnapshotPath();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }], snapshotPath: snapPath });
    plugin.apply(ctx, { path: snapPath });
    await startSession(ctx, calls, 's1');
    const service = calls.provided['ssf'];
    service.bind(undefined, 'alpha');
    service.bind('', 'alpha');
    const snap = service.getSnapshot();
    assert.deepEqual(snap.bindings, {}, '无效 sessionId 的 bind 必须 no-op，bindings 保持空对象');
    assert.equal(service.getBinding(undefined), null);
    assert.equal(service.getBinding(''), null);
  });
});
