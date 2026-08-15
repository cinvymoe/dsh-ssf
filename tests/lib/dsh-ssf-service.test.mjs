// tests/lib/dsh-ssf-service.test.mjs
// Tests for packages/dsh-ssf/lib/index.js — the host-side 'ssf' change-status
// service (scan/summary/refresh), its 'ssf' settings-namespace push, and the
// session-driven first push + workspace-root resolution (dsh-ssf-tab-data-fix).
//
// The fake ctx exercises the Service-provide and conditional settings-inject
// contract without cordis: `inject(['settings'], fn)` runs the registration,
// `provide(name, service)` records the service, `on` captures lifecycle
// listeners (agent/session-start drives the root + first push). The negative
// cases prove the rejected session-projection/event route was never taken and
// that no dead `ready` listener is registered.
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

function makeChange(root, name) {
  const dir = join(root, 'changes', name);
  mkdirSync(dir, { recursive: true });
  writeStateFile(dir, { state: 'executing', workflow: 'full' });
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
 * and `session` carry spies for the negative route test.
 */
function makeFakeCtx({ workspaces } = {}) {
  const calls = {
    register: [],
    replaced: [],
    provided: {},
    listeners: [],
    toolsRegistered: [],
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
          // Real contract: the owner-scope replace is already bound to the ns —
          // it takes ONLY the section value (a second ns argument would make the
          // harness reject with "must be a plain object"). Locked by this stub.
          replace: (section) => {
            calls.replaced.push({ ns: 'ssf', section });
          },
        };
      },
    },
    inject: (names, fn) => fn(ctx),
    provide: (name, service) => {
      calls.provided[name] = service;
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

/** Invoke the captured agent/session-start listener and await its work. */
async function startSession(ctx, calls, sessionId) {
  const listener = calls.listeners.find((l) => l.event === 'agent/session-start');
  assert.ok(listener, 'an agent/session-start listener must be registered');
  await listener.cb({ agent: { session: { id: sessionId } } });
}

/** Flush microtasks so fire-and-forget refresh() calls from apply settle. */
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('dsh-ssf service registration', () => {
  it('declares every ctx.<service> it reads in the cordis inject list', () => {
    // The real harness throws "cannot get property X without inject" for any
    // un-injected service access (caught by wave-4 integration); this locks it.
    assert.deepEqual([...plugin.inject].sort(), ['settings', 'subprocess', 'tools', 'workspaceRegistry']);
  });

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

  it('does not register a dead ready listener (harness never fires ready)', () => {
    const root = makeWorkspace();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }] });
    plugin.apply(ctx);

    assert.equal(calls.listeners.some((l) => l.event === 'ready'), false);
  });
});

describe('dsh-ssf service behavior', () => {
  it('pushes an initial snapshot when the settings namespace registers', async () => {
    const root = makeWorkspace();
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }] });
    plugin.apply(ctx);
    await settle();

    assert.ok(calls.replaced.length >= 1, 'the registration callback must push an initial snapshot');
    assert.equal(calls.replaced[0].ns, 'ssf');
    assert.ok(Array.isArray(calls.replaced[0].section.changes));
    assert.equal(typeof calls.replaced[0].section.scannedAt, 'number');
  });

  it('pushes again on agent/session-start with the session workspace root', async () => {
    const rootA = makeWorkspace();
    const rootB = makeWorkspace();
    makeChange(rootB, 'beta');
    const { ctx, calls } = makeFakeCtx({
      workspaces: [
        { sessionIds: ['s1'], path: rootA },
        { sessionIds: ['s2'], path: rootB },
      ],
    });
    plugin.apply(ctx);
    await settle();
    const before = calls.replaced.length;

    await startSession(ctx, calls, 's2');

    assert.ok(calls.replaced.length > before, 'session-start must push a fresh snapshot');
    const last = calls.replaced[calls.replaced.length - 1].section;
    assert.deepEqual(last.changes.map((c) => c.name), ['beta']);
  });

  it('refresh() re-scans the workspace and pushes { changes, scannedAt } via replace', async () => {
    const root = makeWorkspace();
    makeChange(root, 'alpha');
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }] });
    plugin.apply(ctx);
    await startSession(ctx, calls, 's1');

    const service = calls.provided['ssf'];
    const snapshot = await service.refresh();

    assert.ok(Array.isArray(snapshot.changes));
    assert.equal(typeof snapshot.scannedAt, 'number');
    assert.deepEqual(snapshot.changes.map((c) => c.name), ['alpha']);
    const alpha = snapshot.changes[0];
    assert.equal(alpha.state, 'executing');
    assert.equal(alpha.workflow, 'full');

    const last = calls.replaced[calls.replaced.length - 1];
    assert.equal(last.ns, 'ssf');
    assert.deepEqual(last.section, snapshot);
  });

  it('scan() and summary(changeDir) resolve against the session workspace root', async () => {
    const root = makeWorkspace();
    makeChange(root, 'alpha');
    const { ctx, calls } = makeFakeCtx({ workspaces: [{ sessionIds: ['s1'], path: root }] });
    plugin.apply(ctx);
    await startSession(ctx, calls, 's1');

    const service = calls.provided['ssf'];

    const scanned = service.scan();
    assert.deepEqual(scanned.map((c) => c.name), ['alpha']);

    const summary = service.summary('alpha');
    assert.equal(summary.name, 'alpha');
    assert.equal(summary.state, 'executing');
    assert.equal(summary.workflow, 'full');
  });
});

describe('dsh-ssf workspace root resolution', () => {
  it('falls back to process.cwd() when no workspace matches the session id', async () => {
    const { ctx, calls } = makeFakeCtx({ workspaces: [] });
    plugin.apply(ctx);
    await startSession(ctx, calls, 's1');

    const snapshot = await calls.provided['ssf'].refresh();

    assert.ok(Array.isArray(snapshot.changes));
    // the repo's own changes/ directory is scanned from the cwd fallback
    assert.ok(snapshot.changes.some((c) => c.name === 'dsh-ssf-plugin'));
  });

  it('falls back to process.cwd() when the workspace registry is absent', async () => {
    const { ctx, calls } = makeFakeCtx();
    delete ctx.workspaceRegistry;
    plugin.apply(ctx);
    await startSession(ctx, calls, 's1');

    const snapshot = await calls.provided['ssf'].refresh();

    assert.ok(Array.isArray(snapshot.changes));
  });
});
