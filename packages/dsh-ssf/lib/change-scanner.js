// packages/dsh-ssf/lib/change-scanner.js — pure change-status scanner (task 1.2)
// Zero runtime dependencies: reuses the CLI's own readers so the summary is
// byte-for-byte the same state/status the `ssf` CLI sees.
//
// Contract (shared across dsh-ssf batches 1→3):
//   summarizeChange(changeDir) -> {
//     name, state, workflow, status, detail,
//     raw,                        // readState result verbatim, or null when unreadable
//     stateFileMissing?,          // true only when .spec-superflow.yaml is absent
//     parseError?                 // reason string only when the yaml cannot be parsed
//   }
//   scanChanges(workspaceRoot) -> [summarizeChange(...)] for every direct
//     subdirectory of <workspaceRoot>/changes/; [] when changes/ is absent.
// Never throws on missing/malformed input.
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { readState } from '../../../scripts/lib/state-loader.mjs';
import { detectChangeStatus } from '../../../scripts/lib/cmd-list.mjs';

const STATE_FILE = '.spec-superflow.yaml';

/**
 * Summarize a single change directory.
 * @param {string} changeDir absolute path to a change directory
 * @returns {{ name: string, state: string, workflow: string, status: string,
 *   detail: string, raw: object|null, stateFileMissing?: boolean, parseError?: string }}
 */
export function summarizeChange(changeDir) {
  const summary = {
    name: basename(changeDir),
    status: '',
    detail: '',
  };

  // status/detail always come from the CLI's own detector — content-level
  // inference when no state file exists, state-file driven otherwise.
  const { status, detail } = detectChangeStatus(changeDir);
  summary.status = status;
  summary.detail = detail;

  const stateFile = join(changeDir, STATE_FILE);
  if (!existsSync(stateFile)) {
    // No state file: raw is null, defaults apply, status/detail inferred above.
    summary.state = 'exploring';
    summary.workflow = 'full';
    summary.raw = null;
    summary.stateFileMissing = true;
    return summary;
  }

  let content;
  try {
    content = readFileSync(stateFile, 'utf-8');
  } catch (err) {
    // Exists but unreadable — degrade like a parse failure, never throw.
    summary.state = 'exploring';
    summary.workflow = 'full';
    summary.raw = null;
    summary.parseError = `cannot read ${STATE_FILE}: ${err.message}`;
    return summary;
  }

  const parseError = findYamlParseError(content);
  if (parseError) {
    // Malformed yaml: the CLI's lenient reader would silently accept it, so the
    // scanner flags it instead of surfacing garbage. raw is null and defaults
    // apply; status/detail keep whatever detectChangeStatus produced.
    summary.state = 'exploring';
    summary.workflow = 'full';
    summary.raw = null;
    summary.parseError = parseError;
    return summary;
  }

  const state = readState(changeDir);
  summary.state = state.state || 'exploring';
  summary.workflow = normalizeWorkflow(state.workflow);
  summary.raw = state; // verbatim readState result — same object, no filtering
  return summary;
}

/**
 * Scan <workspaceRoot>/changes/ and summarize every direct subdirectory.
 * @param {string} workspaceRoot
 * @returns {ReturnType<typeof summarizeChange>[]}
 */
export function scanChanges(workspaceRoot) {
  const changesDir = join(workspaceRoot, 'changes');
  if (!existsSync(changesDir)) return [];

  let entries;
  try {
    entries = readdirSync(changesDir);
  } catch {
    return [];
  }

  return entries
    .filter((entry) => {
      try {
        return statSync(join(changesDir, entry)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((entry) => summarizeChange(join(changesDir, entry)));
}

/**
 * Normalize the workflow the same way the CLI does (scripts/lib/cmd-state.mjs):
 * `auto` is the persisted marker for "no explicit workflow" and is treated as
 * the default `full` workflow. Anything else passes through unchanged.
 */
function normalizeWorkflow(raw) {
  if (!raw || raw === 'auto') return 'full';
  return raw;
}

/**
 * Minimal structural check for the flat `key: value` YAML subset the CLI reads.
 * Unbalanced flow indicators ([ ] { }) make the file unparseable by a real YAML
 * parser while the CLI's lenient reader would silently accept them — return a
 * reason string instead so callers can degrade. Returns null when well-formed.
 */
function findYamlParseError(content) {
  let flow = 0; // [ ]
  let mapping = 0; // { }
  for (const ch of content) {
    if (ch === '[') flow += 1;
    else if (ch === ']') flow -= 1;
    else if (ch === '{') mapping += 1;
    else if (ch === '}') mapping -= 1;
    if (flow < 0) return `unbalanced ']' in ${STATE_FILE}`;
    if (mapping < 0) return `unbalanced '}' in ${STATE_FILE}`;
  }
  if (flow > 0) return `unclosed '[' in ${STATE_FILE}`;
  if (mapping > 0) return `unclosed '{' in ${STATE_FILE}`;
  return null;
}
