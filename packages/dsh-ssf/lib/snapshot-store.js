// packages/dsh-ssf/lib/snapshot-store.js — isolated snapshot persistence
//
// Stores the ssf change-status snapshot in a standalone JSON file instead of
// settings.yaml. The snapshot also carries `bindings` (sessionId →
// { workspace, change, boundAt }) — the conversation ↔ flow one-to-one
// bindings recorded by lib/index.js survive restarts through this file.
// The default location is `$DSH_HOME/ssf.json`; a plugin Config
// field `path` overrides it, and `dshHome` overrides the harness home used for
// the default. Mirrors `dsh-home-paths` resolution (resolveDshHome /
// expandHomePath) and `settings-file` resolveSpec validation so the path
// handling feels native to the harness.
//

import { homedir } from 'node:os';
import { join, resolve, dirname, extname } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import z from '@deepseek-ai/schemastery';

// ---- Config schema ---------------------------------------------------------

export const Config = z.object({
  path: z.string(),
  dshHome: z.string(),
});

// ---- home-path helpers (copied from @deepseek-ai/dsh-home-paths) ----------

const DSH_HOME_DIR_NAME = '.dsh';
const DSH_HOME_ENV = 'DSH_HOME';

/** Default harness home `~/.dsh`. */
function defaultDshHome() {
  return join(homedir(), DSH_HOME_DIR_NAME);
}

/**
 * Expand `~` / `~/` / `~\` against the OS home.
 * @param {string} path
 * @returns {string}
 */
export function expandHomePath(path) {
  if (path === '~') return homedir();
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Resolve the harness home. Precedence: explicit `configured` > non-empty
 * `$DSH_HOME` > `~/.dsh`.
 * @param {string|undefined} configured
 * @param {Record<string,string|undefined>} env
 * @returns {string}
 */
export function resolveDshHome(configured, env = process.env) {
  const fromEnv = env[DSH_HOME_ENV];
  const selected =
    configured ??
    (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : defaultDshHome());
  return resolve(expandHomePath(selected));
}

// ---- snapshot path resolution ----------------------------------------------

/**
 * Resolve the snapshot file path from plugin config.
 * An explicit `path` wins; otherwise `<harness home>/ssf.json`. The result is
 * always absolute and must end in `.json`.
 * @param {{path?:string,dshHome?:string}} config
 * @returns {string} absolute filename
 * @throws when the extension is not `.json`
 */
export function resolveSnapshotPath(config = {}) {
  const raw = config.path ?? join(resolveDshHome(config.dshHome), 'ssf.json');
  const expanded = expandHomePath(raw);
  const filename = resolve(expanded);
  const ext = extname(filename);
  if (ext !== '.json') {
    throw new Error(`ssf: extension "${ext}" is not supported (use .json)`);
  }
  return filename;
}

// ---- snapshot shape helpers ------------------------------------------------

/**
 * Normalize a parsed `bindings` field: a plain object is kept as-is, anything
 * else (array, null, primitive) falls back to an empty map.
 * @param {unknown} value
 * @returns {Record<string, {workspace:string,change:string,boundAt:number}>}
 */
export function normalizeBindings(value) {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) return value;
  return {};
}

/** @returns {{changes:object[],workspaces:object[],scannedAt:number|null,bindings:object}} */
export function emptySnapshot() {
  return { changes: [], workspaces: [], scannedAt: null, bindings: {} };
}

/**
 * Synchronously load the snapshot file. Returns an empty snapshot when missing,
 * unreadable, or unparsable. Never throws.
 * @param {string} filename absolute path
 * @returns {{changes:object[],workspaces:object[],scannedAt:number|null,bindings:object}}
 */
export function loadSnapshotSync(filename) {
  try {
    if (!existsSync(filename)) return emptySnapshot();
    const text = readFileSync(filename, 'utf8');
    if (text.trim().length === 0) return emptySnapshot();
    const data = JSON.parse(text);
    if (data == null || typeof data !== 'object' || Array.isArray(data)) return emptySnapshot();
    const changes = Array.isArray(data.changes) ? data.changes : [];
    const workspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
    const scannedAt = typeof data.scannedAt === 'number' ? data.scannedAt : null;
    const bindings = normalizeBindings(data.bindings);
    return { changes, workspaces, scannedAt, bindings };
  } catch {
    return emptySnapshot();
  }
}

/**
 * Asynchronously load the snapshot file. Same fallback as sync.
 * @param {string} filename
 * @returns {Promise<{changes:object[],workspaces:object[],scannedAt:number|null,bindings:object}>}
 */
export async function loadSnapshot(filename) {
  try {
    const text = await readFile(filename, 'utf8');
    if (text.trim().length === 0) return emptySnapshot();
    const data = JSON.parse(text);
    if (data == null || typeof data !== 'object' || Array.isArray(data)) return emptySnapshot();
    const changes = Array.isArray(data.changes) ? data.changes : [];
    const workspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
    const scannedAt = typeof data.scannedAt === 'number' ? data.scannedAt : null;
    const bindings = normalizeBindings(data.bindings);
    return { changes, workspaces, scannedAt, bindings };
  } catch (err) {
    if (/** @type {any} */ (err)?.code === 'ENOENT') return emptySnapshot();
    return emptySnapshot();
  }
}

// ---- atomic write ----------------------------------------------------------

let cachedWriteFileAtomic = undefined;

/**
 * Lazily resolve `writeFileAtomic` from `@deepseek-ai/dsh-atomic-write`.
 * Returns null when the package is not installed or the export is missing.
 * @returns {Promise<((f:string,c:string,o:{mode:number,dirMode?:number})=>Promise<void>)|null>}
 */
async function getWriteFileAtomic() {
  if (cachedWriteFileAtomic !== undefined) return cachedWriteFileAtomic;
  try {
    const mod = await import('@deepseek-ai/dsh-atomic-write');
    const fn = mod.writeFileAtomic ?? mod.default?.writeFileAtomic ?? null;
    cachedWriteFileAtomic = typeof fn === 'function' ? fn : null;
  } catch {
    cachedWriteFileAtomic = null;
  }
  return cachedWriteFileAtomic;
}

/**
 * Persist a snapshot to `filename` atomically when possible, creating parent
 * directories with `0o700`. Failures are swallowed (caller logs) and never
 * throw to the harness.
 * @param {{changes:object[],workspaces:object[],scannedAt:number|null,bindings?:object}} snapshot
 * @param {string} filename
 * @returns {Promise<void>}
 */
export async function persistSnapshot(snapshot, filename) {
  const content = JSON.stringify(snapshot, null, 2) + '\n';
  try {
    await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  } catch {
    // mkdir race — persist will surface a write error if the directory is still absent
  }
  const wfa = await getWriteFileAtomic();
  try {
    if (wfa) {
      await wfa(filename, content, { mode: 0o600, dirMode: 0o700 });
    } else {
      await writeFile(filename, content, { mode: 0o600 });
      // Ensure the file is world-invisible even if the pre-existing file had wider perms.
      // writeFile with mode only affects fresh inodes; on some platforms we still chmod.
      // Best-effort — ignore errors.
      try {
        const { chmod } = await import('node:fs/promises');
        await chmod(filename, 0o600);
      } catch {}
    }
  } catch (err) {
    // Swallow — caller decides whether to warn. Re-throw so caller can log the reason.
    throw err;
  }
}
