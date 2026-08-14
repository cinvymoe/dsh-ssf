// packages/dsh-ssf/client/format.js — pure formatting helpers for the
// "Spec 工作流" settings tab (task 3.3).
//
// Canonical ESM copy for node tests; the client bundle (client.js) carries the
// SAME functions inline because the browser module table does not resolve
// relative requires. Keep both copies in sync — the tests here lock the
// behavior.

/**
 * Sort the change scan for display: closing/abandoned sink to the bottom,
 * everything else ordered by name.
 * @param {Array<object>|undefined} scan - scanChanges output.
 * @returns {Array<object>} sorted copy (input never mutated).
 */
export function formatChangeList(scan) {
  if (!Array.isArray(scan)) return [];
  const rank = { closing: 2, abandoned: 2 };
  return [...scan].sort((a, b) => {
    const ra = rank[a.state] ?? 1;
    const rb = rank[b.state] ?? 1;
    if (ra !== rb) return ra - rb;
    return String(a.name).localeCompare(String(b.name));
  });
}

/**
 * Build the detail rows for one change: non-empty dp_* results and
 * last_transition read from `raw` (verbatim .spec-superflow.yaml top-level
 * keys), or the stateFileMissing/parseError markers when raw is absent.
 * @param {object|undefined} item - one summarizeChange result.
 * @returns {Array<[string, string]>} display rows in key order.
 */
export function formatChangeDetail(item) {
  if (!item) return [];
  const rows = [];
  const raw = item.raw;
  if (raw) {
    for (const key of [
      'dp_0_decisions', 'dp_0_result', 'dp_1_result', 'dp_2_result',
      'dp_3_result', 'dp_4_result', 'dp_5_result', 'dp_6_result', 'dp_7_result',
    ]) {
      const value = raw[key];
      if (value !== undefined && value !== null && value !== '') {
        rows.push([key, String(value)]);
      }
    }
    const last = raw.last_transition;
    if (last !== undefined && last !== null && last !== '') {
      rows.push(['last_transition', String(last)]);
    }
  } else {
    rows.push(['stateFileMissing', item.stateFileMissing ? 'true' : 'false']);
    if (item.parseError) rows.push(['parseError', item.parseError]);
  }
  return rows;
}
