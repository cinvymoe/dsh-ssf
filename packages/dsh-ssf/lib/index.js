// packages/dsh-ssf/lib/index.js — host-side change-status service
//
// Provides the 'ssf' service ({ scan, summary, refresh, getSnapshot }) and
// persists change-status snapshots to a standalone file (default
// `$DSH_HOME/ssf.json`) instead of the global `settings.yaml`. Snapshots are
// also exposed via `GET /dsh-ssf/snapshot` for the browser tab to poll.
// First snapshot is written on plugin startup and refreshed on every
// agent/session-start with the session's workspace root (dsh-ssf-tab-data-fix:
// the harness never fires a cordis `ready` event, and process-cwd-based root
// resolution picked an unrelated directory). The session-projection route
// stays rejected: session.append cannot carry `ignorable: true`
// (dsh-session only forwards sourceEventSeqs/surfaceOp) and
// dsh-session-persistence's assertEventsSupported refuses unknown event types,
// so no projections and no custom session events are registered here.
// Model-visible guidance: tool descriptions only say what each tool returns,
// the prompt section (spec-superflow, order 100) says when and in what order
// to call them (model-visible 引导：工具描述只说明返回什么，section 说明何时/按什么顺序调用).
// The repo's skills are registered as runtime skills (lib/skill-registrar.js)
// with no file copies — fiber disposal unregisters them; the section text is a
// function so phase awareness (state → suggested skill) lives in the prompt
// rather than catalog gating, because state is per-change while the catalog
// is per-agent.
//
// Conversation ↔ flow binding: when a conversation executes a spec-superflow
// flow (any ssf_* tool call that targets a changeDir, or ssf_run with a
// `changes/<name>` argument), the flow binds to the calling session
// (bindSession). Bindings are one-to-one in both directions — one flow per
// conversation, and a flow bound by another conversation is stolen from its
// previous owner. They ride the snapshot (`bindings` field) so the HTTP
// endpoint and the restart-persisted file share one source of truth, and the
// browser tab renders only the flow bound to its conversation.
//

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { scanChanges, scanWorkspaceChanges, flattenWorkspaceChanges, summarizeChange } from './change-scanner.js';
import { registerTools } from './tools.js';
import { registerSkills } from './skill-registrar.js';
import { Config, resolveSnapshotPath, emptySnapshot, loadSnapshotSync, persistSnapshot } from './snapshot-store.js';

const SECTION_TEXT = `# spec-superflow — state-machine workflow cheat sheet

spec-superflow is a state-machine workflow; the workspace root \`changes/<changeDir>/\` holds all planning artifacts for one change.

States:
- Linear: \`exploring → specifying → bridging → approved-for-build → executing → closing\`
- Side track: \`debugging\` (off \`executing\`, returns)
- Terminal: \`abandoned\`; \`closing\` is the success terminal (no further work is routed)

Scope:
- Only use when spec-superflow context exists: \`changes/\`, \`.spec-superflow.yaml\`, \`proposal.md\`, \`specs/\`, \`execution-contract.md\`, etc.
- Do NOT apply to ordinary coding tasks without that context.

Tool-first:
- Prefer structured \`ssf_*\` tools over running \`ssf\` CLI in shell.
- Use \`ssf_run\` only for subcommands not covered by the structured tools.

Recommended tool order:
1. \`ssf_list\` — list all changes with state-machine summary
   (name / state / workflow / status) to locate the target change.
2. \`ssf_state\` — read one change's persisted state-machine fields
   (raw \`.spec-superflow.yaml\` top-level keys + degradation markers).
3. \`ssf_workflow\` — read workflow receipt for one change
   (mode receipt: Full / Quick / Hotfix / Tweak; existence / validity / status / recommendation).
4. \`ssf_execution\` — read persisted execution-plan summary
   (current flag and waves) for one change.
5. \`ssf_validate\` — validate planning artifacts (proposal + delta specs)
   against schema rules for one change.
6. \`ssf_guard\` — run phase-transition guard (DP gates + artifact conditions)
   for \`fromState → toState\`; MUST pass before any state transition —
   never mutate state manually when guard fails.

Keep artifacts under \`changes/<changeDir>/\` and drive every transition through the guarded tool sequence above.

Skills: the spec-superflow skills are registered in the skill catalog; \`workflow-start\` is the entry router — load it with the \`skill\` tool when entering an ssf context, and it routes each state to its phase skill.
`;

// State → phase-skill routing for the dynamic prompt section. Terminal states
// (closing, abandoned) route no further work and are intentionally absent.
const STATE_SKILL_MAP = {
  exploring: 'need-explorer',
  specifying: 'spec-writer',
  bridging: 'contract-builder',
  'approved-for-build': 'build-executor',
  executing: 'build-executor',
  debugging: 'bug-investigator',
};

/**
 * Render the spec-superflow prompt section: the static cheat sheet plus, when
 * the snapshot has non-terminal changes, a per-change "state → suggested
 * skill" block. Phase awareness lives in the prompt rather than in catalog
 * gating because state is per-change while the skill catalog is per-agent.
 * @param {{ changes?: Array<{ name?: string, state?: string }> } | undefined} snapshot
 *   - the in-memory change-status snapshot (may be undefined before the first scan).
 * @returns {string} the section text for this assembly.
 */
export function renderSectionText(snapshot) {
  const changes = Array.isArray(snapshot?.changes) ? snapshot.changes : [];
  const lines = [];
  for (const change of changes) {
    const skill = STATE_SKILL_MAP[change?.state ?? ''];
    if (skill) lines.push(`- ${change.name}: ${change.state} → ${skill}`);
  }
  if (lines.length === 0) return SECTION_TEXT;
  return `${SECTION_TEXT}\nActive changes (current state → suggested skill):\n${lines.join('\n')}\n`;
}

export { Config };

export const name = 'ssf';

// Cordis fiber injection: every ctx.<service> the plugin reads must be
// declared here or the loader throws "cannot get property X without inject".
// tools: registerTools; workspaceRegistry: root resolution; subprocess:
// ssf_run handler. `webServer` is intentionally NOT listed here so the plugin
// boots on non-web profiles; the snapshot route wires conditionally via
// ctx.inject(['webServer'], ...) below.
export const inject = ['tools', 'workspaceRegistry', 'subprocess'];

export function apply(ctx, config) {
  let root = process.cwd();

  // Resolve the standalone snapshot file location.
  let snapshotPath;
  try {
    snapshotPath = resolveSnapshotPath(config ?? {});
  } catch (err) {
    // Invalid config (e.g. unsupported extension) — warn and fall back to the
    // default location so the plugin still boots rather than crashing the host.
    try {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        ctx.logger?.warn?.(`ssf: invalid snapshot path config (${msg}); using default`);
      } catch {}
      console.warn(`[ssf] invalid snapshot path config (${msg}); using default`);
    } catch {}
    snapshotPath = resolveSnapshotPath({});
  }

  // In-memory snapshot, pre-loaded from disk when available.
  let currentSnapshot;
  try {
    currentSnapshot = loadSnapshotSync(snapshotPath);
  } catch {
    currentSnapshot = emptySnapshot();
  }

  // Conversation ↔ flow bindings (sessionId → { workspace, change, boundAt }),
  // restored from the persisted snapshot so they survive host restarts.
  const bindings = { ...(currentSnapshot.bindings ?? {}) };

  /**
   * Bind a change flow to a conversation, one-to-one in both directions: any
   * other session holding the same workspace+change loses it (the newest bind
   * steals), and the session's previous binding is replaced. The snapshot's
   * `bindings` field is updated in place and persisted best-effort.
   * @param {unknown} sessionId - calling session id; non-string/empty is a no-op.
   * @param {string} changeDir - change directory name relative to changes/.
   * @returns {void}
   */
  function bindSession(sessionId, changeDir) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return;
    if (typeof changeDir !== 'string' || changeDir.length === 0) return;
    for (const [sid, binding] of Object.entries(bindings)) {
      if (sid !== sessionId && binding?.workspace === root && binding?.change === changeDir) {
        delete bindings[sid];
      }
    }
    bindings[sessionId] = { workspace: root, change: changeDir, boundAt: Date.now() };
    if (currentSnapshot) {
      currentSnapshot.bindings = { ...bindings };
      persistQueued(currentSnapshot).catch(() => {});
    }
  }

  function logWarn(message) {
    try {
      ctx.logger?.warn?.(message);
    } catch {}
    try {
      console.warn(`[ssf] ${message}`);
    } catch {}
  }

  // Snapshot writes are serialized through this chain so a slow write (the
  // lazy `@deepseek-ai/dsh-atomic-write` import on the first persist) can
  // never finish after a newer snapshot and overwrite it with stale data
  // (observed: the startup refresh's write landed after a later refresh's,
  // wiping fresh bindings/scannedAt from the file).
  let persistChain = Promise.resolve();

  /**
   * Enqueue an atomic snapshot persist. Writes run in call order; a failed
   * write logs and does not break the chain.
   * @param {object} snapshot - the snapshot to serialize when the write runs.
   * @returns {Promise<void>} settles when THIS write has landed.
   */
  function persistQueued(snapshot) {
    const write = persistChain.then(() =>
      persistSnapshot(snapshot, snapshotPath).catch((err) => {
        const reason = err instanceof Error ? err.message : String(err);
        logWarn(`failed to persist snapshot to ${snapshotPath}: ${reason}`);
      }),
    );
    persistChain = write;
    return write;
  }

  // Scan EVERY registered spec-superflow workspace and persist a grouped
  // snapshot to the standalone file, so the browser tab shows all flows
  // across all workspaces (not just the last session's root). Returns the
  // snapshot. Also updates the in-memory cache that the HTTP endpoint serves.
  async function refresh() {
    const workspaces = scanWorkspaceChanges(ctx.workspaceRegistry?.list?.() ?? []);
    const snapshot = {
      changes: flattenWorkspaceChanges(workspaces),
      workspaces,
      scannedAt: Date.now(),
      // Conversation bindings live outside the scan — refresh must carry them
      // forward or every rescan would wipe the binding map.
      bindings: { ...bindings },
    };
    currentSnapshot = snapshot;
    await persistQueued(snapshot);
    return snapshot;
  }

  // Eagerly populate the file + memory cache on startup (no `ready` event).
  refresh().catch(() => {});

  ctx.provide('ssf', {
    scan: () => scanChanges(root),
    summary: (changeDir) => summarizeChange(join(root, 'changes', changeDir)),
    refresh,
    getSnapshot: () => currentSnapshot,
    bind: bindSession,
    getBinding: (sessionId) => bindings[sessionId] ?? null,
  });

  // Six structured tools (registered in lib/tools.js). onBind wires the
  // conversation ↔ flow binding: every tool call that targets a change binds
  // that change to the calling session.
  registerTools(ctx, { resolveRoot: () => root, onBind: bindSession });

  // The session event carries the agent; resolve the session's workspace root
  // and push a fresh snapshot for it (dsh-goal uses the same event).
  // The workspace registry may attach/index the session a few ticks AFTER
  // session-start (observed ~+20ms on a cold boot), so the immediate lookup
  // can miss and would fall back to the host's process cwd (`/` under the
  // systemd unit) — scanning `/<changes>` yields the empty state. The session's
  // own header cwd is the authoritative workspace root and is available
  // synchronously, so it is consulted as the registry-race fallback. A delayed
  // re-resolution catches sessions whose cwd is absent at the first tick.
  ctx.on('agent/session-start', ({ agent }) => {
    root = resolveWorkspaceRoot(ctx, agent);
    refresh().catch(() => {});
    // Prefer the fiber-scoped timer (auto-cleared on dispose); fall back to the
    // global one outside cordis/fake contexts.
    const schedule = (ctx.setTimeout?.bind ? ctx.setTimeout.bind(ctx) : undefined) ?? setTimeout;
    schedule(() => {
      const next = resolveWorkspaceRoot(ctx, agent);
      if (next !== root) {
        root = next;
        refresh().catch(() => {});
      }
    }, 200);
  });

  // Snapshot HTTP route — only wired when the webServer host is present (web
  // profile). Outside that profile the inject simply never fires and the rest
  // of the plugin boots unchanged.
  try {
    ctx.inject(['webServer'], (hostCtx) =>
      hostCtx.effect(
        () =>
          hostCtx.webServer.register({
            kind: 'exact',
            path: '/dsh-ssf/snapshot',
            handler: (req, res) => {
              if (req.method !== 'GET') {
                res.writeHead(405, { Allow: 'GET' });
                res.end('method not allowed');
                return;
              }
              const body = JSON.stringify(currentSnapshot ?? emptySnapshot());
              res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
                'Content-Length': Buffer.byteLength(body),
              });
              res.end(body);
            },
          }),
        'dsh-ssf: snapshot route',
      ),
    );
  } catch (err) {
    // Route registration failure must never break boot.
    const reason = err instanceof Error ? err.message : String(err);
    logWarn(`snapshot route: failed to register: ${reason}`);
  }

  // System-prompt section — only wired when the systemPrompt host is
  // present. Outside that host the inject simply never fires and the rest
  // of the plugin boots unchanged (mirrors the webServer conditional pattern).
  try {
    ctx.inject(['systemPrompt'], (promptCtx) =>
      promptCtx.effect(
        () => promptCtx.systemPrompt.section({ name: 'spec-superflow', order: 100, text: () => renderSectionText(currentSnapshot) }),
        'dsh-ssf: prompt section',
      ),
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logWarn(`prompt section: failed to register: ${reason}`);
  }

  // Runtime skill registration — the repo's skills/*/SKILL.md entries join
  // the DSH skill catalog without file copies (see lib/skill-registrar.js).
  registerSkills(ctx, { logWarn });
}

/**
 * Resolve the workspace root for one session, in order:
 *  1. the first registered workspace whose `sessionIds` contains the session
 *     id (authoritative when the registry has settled);
 *  2. the session's own header `cwd` — the actual directory the session runs
 *     in, immune to the registry's post-session-start attachment timing
 *     (dsh-ssf-tab-data-fix-2: the immediate registry lookup raced the ~20ms
 *     session attach and the previous `process.cwd()` fallback scanned `/`);
 *  3. the process cwd, as a last resort.
 * Never throws.
 */
function resolveWorkspaceRoot(ctx, agent) {
  const sessionId = agent?.session?.id;
  try {
    const workspaces = ctx.workspaceRegistry?.list?.() ?? [];
    const workspace = workspaces.find(
      (entry) => Array.isArray(entry?.sessionIds) && entry.sessionIds.includes(sessionId),
    );
    if (workspace?.path) return workspace.path;
  } catch {
    // registry unavailable or broken — fall through to the session cwd
  }
  const sessionCwd = agent?.session?.header?.cwd;
  if (typeof sessionCwd === 'string' && sessionCwd.length > 0 && existsSync(sessionCwd)) {
    return sessionCwd;
  }
  return process.cwd();
}
