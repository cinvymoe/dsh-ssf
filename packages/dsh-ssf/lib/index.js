// packages/dsh-ssf/lib/index.js — host-side change-status service (task 1.3)
//
// Registers the 'ssf' service ({ scan, summary, refresh }) and pushes
// change-status snapshots through the 'ssf' settings namespace. The
// session-projection route was rejected: session.append cannot carry
// `ignorable: true` (dsh-session only forwards sourceEventSeqs/surfaceOp) and
// dsh-session-persistence's assertEventsSupported refuses unknown event types,
// so no projections and no custom session events are registered here.
//
// Settings schema note: schemastery (vendored as @deepseek-ai/schemastery,
// v3.18.1) spells string-keyed arbitrary-value maps `z.dict(z.any())` (no
// `record`) and nullable values `z.union([z.number(), z.const(null)])` (no
// `nullable()`); the design's `z.record`/`z.number().nullable()` map to these.
import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { scanChanges, summarizeChange } from './change-scanner.js';
import { registerTools } from './tools.js';

export const name = 'ssf';

// Cordis fiber injection: every ctx.<service> the plugin reads must be
// declared here or the loader throws "cannot get property X without inject".
// tools: registerTools; settings: ssf namespace; workspaceRegistry: root
// resolution; subprocess: ssf_run handler.
export const inject = ['tools', 'settings', 'workspaceRegistry', 'subprocess'];

const SETTINGS_SCHEMA = z.object({
  changes: z.array(z.dict(z.any())).default([]),
  scannedAt: z.union([z.number(), z.const(null)]).default(null),
});

export function apply(ctx) {
  const root = resolveWorkspaceRoot(ctx);

  // Conditional injection: the settings service may be absent; when present,
  // the namespace scope lives for the plugin's lifetime.
  let scope = null;
  ctx.inject(['settings'], (s) => {
    scope = s.settings.register('ssf', SETTINGS_SCHEMA, {});
  });

  // Re-scan the workspace and push a snapshot through the settings namespace.
  // Returns the pushed snapshot (push is skipped when settings is absent).
  async function refresh() {
    const snapshot = { changes: scanChanges(root), scannedAt: Date.now() };
    if (scope) await scope.replace('ssf', snapshot);
    return snapshot;
  }

  ctx.provide('ssf', {
    scan: () => scanChanges(root),
    summary: (changeDir) => summarizeChange(join(root, 'changes', changeDir)),
    refresh,
  });

  // Six structured tools (stubs in 2.1; handlers in 2.2/2.3/2.4).
  registerTools(ctx, { resolveRoot: () => root });

  // First snapshot on plugin ready.
  ctx.on('ready', () => refresh());
}

/**
 * Resolve the workspace root the scanner operates on. The plugin's apply has
 * no direct session id, so pick the first registered workspace that has any
 * live session; when the registry is absent, empty, or throws, fall back to
 * the process cwd. Never throws.
 */
function resolveWorkspaceRoot(ctx) {
  try {
    const workspaces = ctx.workspaceRegistry?.list?.() ?? [];
    const workspace = workspaces.find(
      (entry) => Array.isArray(entry.sessionIds) && entry.sessionIds.length > 0,
    );
    if (workspace?.path) return workspace.path;
  } catch {
    // registry unavailable or broken — fall back to the cwd
  }
  return process.cwd();
}
