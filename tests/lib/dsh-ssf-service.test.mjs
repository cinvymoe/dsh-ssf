// tests/lib/dsh-ssf-service.test.mjs
// Tests for packages/dsh-ssf/lib/index.js — the host-side 'ssf' change-status
// service (scan/summary/refresh) plus its 'ssf' settings-namespace push.
//
// The fake ctx exercises the Service-provide and conditional settings-inject
// contract without cordis: `inject(['settings'], fn)` runs the registration,
// `provide(name, service)` records the service, `on` captures the ready
// listener. The negative case proves the rejected session-projection/event
// route (session.append cannot carry `ignorable: true`; the persistence read
// path refuses unknown event types) was never taken.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let plugin;

before(async () => {
  plugin = await import(join(process.cwd(), 'packages/dsh-ssf/lib/index.js'));
});

const createdRoots = [];

function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ssf-service-'));
  createdRoots.push(root);
  return root;
}

function writeStateFile(dir, state) {
  const lines = [];
  for (const [key, value] of Object.entries(state)) {
    lines.push(`${key}: ${value}`);
  }
  writeFileSync(join(dir, '.spec-superflow.yaml'), lines.join('\n'));
}

after(() => {
  for (const root of createdRoots) rmSync(root, { recursive: true, force: true });
});

/**
 * Minimal cordis-shaped ctx. `settings.register` records the namespace args
 * and returns the owner scope { get, watch, update, replace } (replace records
 * pushed snapshots); `inject` calls the callback with this ctx so the
 * conditional settings registration always runs; `provide` records the
 * registered service; `on` captures lifecycle listeners; `sessionProjections`
 * and `session` carry spies so the negative test can prove the rejected route
 * was never touched.
 */
function makeFakeCtx({ workspaces } = {}) {
  const calls = {
    register: [],
    replaced: [],
    provided: {},
    listeners: [],
    sessionProjectionRegisters: 0,
    sessionAppends: 0,
  };
  const ctx = {
    workspaceRegistry: {
      list: () => workspaces ?? [{ sessionIds: ['s1'], path: makeWorkspace() }],
    },
    settings: {
      register: (ns, schema, opts) => {
        calls.register.push({ ns, schema, opts });
        return {
          get: () => undefined,
          watch: () => () => {},
          update: () => {},
          replace: (ns2, section) => {
            calls.replaced.push({ ns: ns2, section });
          },
        };
      },
    },
    inject: (names, fn) => fn(ctx),
    provide: (name, service) => {
      calls.provided[name] = service;
    },
    on: (event, cb) => {
      calls.listeners.push({ event, cb });
    },
    sessionProjections: {
      register: () => {
        calls.sessionProjectionRegisters += 1;
      },
    },
    session: {
      append: () => {
        calls.sessionAppends += 1;
      },
    },
  };
  return { ctx, calls };
}

describe('dsh-ssf service registration', () => {
  it('registers an ssf service exposing scan/summary/refresh', () => {
    const root = makeWorkspace();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }] });
    plugin.apply(ctx);

    const service = calls.provided['ssf'];
    assert.ok(service, 'a service named ssf must be provided');
    assert.equal(typeof service.scan, 'function');
    assert.equal(typeof service.summary, 'function');
    assert.equal(typeof service.refresh, 'function');
  });

  it('registers the ssf settings namespace with a changes/scannedAt schema', () => {
    const root = makeWorkspace();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }] });
    plugin.apply(ctx);

    assert.equal(calls.register.length, 1);
    const { ns, schema } = calls.register[0];
    assert.equal(ns, 'ssf');

    // defaults: changes is an array, scannedAt nullable number (absent -> null)
    const defaults = schema();
    assert.ok(Array.isArray(defaults.changes));
    assert.equal(defaults.changes.length, 0);
    assert.ok(defaults.scannedAt === null || defaults.scannedAt === undefined);

    // a snapshot resolves through the schema unchanged
    const resolved = schema({ changes: [{ name: 'alpha', state: 'executing' }], scannedAt: 42 });
    assert.equal(resolved.changes.length, 1);
    assert.equal(resolved.changes[0].name, 'alpha');
    assert.equal(resolved.scannedAt, 42);
  });

  it('does not register session projections or append session events (route rejected)', () => {
    const root = makeWorkspace();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }] });
    plugin.apply(ctx);

    assert.equal(calls.sessionProjectionRegisters, 0);
    assert.equal(calls.sessionAppends, 0);
  });
});

describe('dsh-ssf service behavior', () => {
  it('refresh() re-scans the workspace and pushes { changes, scannedAt } via replace', async () => {
    const root = makeWorkspace();
    const alphaDir = join(root, 'changes', 'alpha');
    mkdirSync(alphaDir, { recursive: true });
    writeStateFile(alphaDir, { state: 'executing', workflow: 'full' });
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }] });
    plugin.apply(ctx);

    const service = calls.provided['ssf'];
    const snapshot = await service.refresh();

    assert.ok(Array.isArray(snapshot.changes));
    assert.equal(typeof snapshot.scannedAt, 'number');
    assert.equal(snapshot.changes.length, 1);
    const alpha = snapshot.changes[0];
    assert.equal(alpha.name, 'alpha');
    assert.equal(alpha.state, 'executing');
    assert.equal(alpha.workflow, 'full');

    assert.equal(calls.replaced.length, 1);
    assert.equal(calls.replaced[0].ns, 'ssf');
    assert.deepEqual(calls.replaced[0].section, snapshot);
  });

  it('scan() and summary(changeDir) resolve against the workspace root', () => {
    const root = makeWorkspace();
    const alphaDir = join(root, 'changes', 'alpha');
    mkdirSync(alphaDir, { recursive: true });
    writeStateFile(alphaDir, { state: 'executing', workflow: 'full' });
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }] });
    plugin.apply(ctx);

    const service = calls.provided['ssf'];

    const scanned = service.scan();
    assert.deepEqual(scanned.map((c) => c.name), ['alpha']);

    const summary = service.summary('alpha');
    assert.equal(summary.name, 'alpha');
    assert.equal(summary.state, 'executing');
    assert.equal(summary.workflow, 'full');
  });

  it('pushes the first snapshot when the plugin becomes ready', async () => {
    const root = makeWorkspace();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }] });
    plugin.apply(ctx);

    const ready = calls.listeners.find((l) => l.event === 'ready');
    assert.ok(ready, 'a ready listener must be registered');
    await ready.cb();

    assert.equal(calls.replaced.length, 1);
    assert.equal(calls.replaced[0].ns, 'ssf');
    assert.ok(Array.isArray(calls.replaced[0].section.changes));
    assert.equal(typeof calls.replaced[0].section.scannedAt, 'number');
  });
});

describe('dsh-ssf workspace root resolution', () => {
  it('falls back to process.cwd() when no workspace has sessions', async () => {
    const { ctx, calls } = makeFakeCtx({ workspaces: [] });
    plugin.apply(ctx);

    const snapshot = await calls.provided['ssf'].refresh();

    assert.ok(Array.isArray(snapshot.changes));
    // the repo's own changes/ directory is scanned from the cwd fallback
    assert.ok(snapshot.changes.some((c) => c.name === 'dsh-ssf-plugin'));
  });

  it('falls back to process.cwd() when the workspace registry is absent', async () => {
    const { ctx, calls } = makeFakeCtx();
    delete ctx.workspaceRegistry;
    plugin.apply(ctx);

    const snapshot = await calls.provided['ssf'].refresh();

    assert.ok(Array.isArray(snapshot.changes));
  });
});
