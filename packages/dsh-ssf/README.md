# dsh-ssf — dsh-ssf as a DeepSeek Harness plugin

`dsh-ssf` packages dsh-ssf as a
DSH (Cordis) plugin: the host half exposes the workflow state machine through
native structured tools and persists change-status snapshots to a standalone
file (`$DSH_HOME/dsh-ssf.json` by default, configurable via `config.path`); the
browser half polls `GET /dsh-ssf/snapshot` and renders a read-only
**Spec 工作流** conversation tab. No data is written to `settings.yaml`.

Upstream acknowledgement: forked from [spec-superflow](https://github.com/spec-superflow/spec-superflow).

## Capabilities

Host half (`lib/index.js`):

- `dsh-ssf` service: `scan()` / `summary(changeDir)` / `refresh()` / `getSnapshot()`
  over the workspace `changes/` directory.
- Standalone snapshot file: `snapshot-store.js` persists
  `{ changes, workspaces, scannedAt }` to `$DSH_HOME/dsh-ssf.json` (or
  `config.path`, with `config.dshHome` overriding the home), created with
  `0700`/`0600` and written atomically; `GET /dsh-ssf/snapshot` (via
  `ctx.webServer`) serves the in-memory snapshot with `Cache-Control: no-store`.

Structured tools (`lib/tools.js`, registered on `ctx.tools`): 19 `dsh-ssf_*` tools (6 read + 12 write + `dsh-ssf_run` fallback — 19 total; `dsh-ssf_run` retained for uncovered subcommands):

| Tool | Purpose |
|---|---|
| `dsh-ssf_list` | List all changes with state machine summary |
| `dsh-ssf_state` | Raw `.spec-superflow.yaml` fields for one change (with degradation markers) |
| `dsh-ssf_workflow` | Workflow receipt summary (path, status, recommendation) |
| `dsh-ssf_execution` | Persisted execution plan summary (waves + eligibility) |
| `dsh-ssf_validate` | Artifact validation report (proposal + delta specs) |
| `dsh-ssf_guard` | Phase-transition guard check (from/to states) |
| `dsh-ssf_state_write` | Write state machine fields for a change (init/set/transition/rebuild) |
| `dsh-ssf_workflow_write` | Write workflow selection for a change (recommend/select/accept/evidence/escalate) |
| `dsh-ssf_execution_write` | Write execution plan for a change (recommend/plan/revise/resync/review) |
| `dsh-ssf_checkpoint` | Manage checkpoints for a change (save/list/show) |
| `dsh-ssf_handoff` | Manage handoff contracts for a change (create/list/finish/resolve) |
| `dsh-ssf_debug` | Manage debugging attempts for a change (record_attempt/show_attempts/escalate) |
| `dsh-ssf_isolate` | Isolate a change into a git worktree (--force/--isolate) |
| `dsh-ssf_finish` | Finish a change (merge, verify, clean worktree) |
| `dsh-ssf_inject` | Generate phase-guard injection artifacts |
| `dsh-ssf_sync` | Publish delta as canonical baseline specs |
| `dsh-ssf_audit` | Generate decision-point audit report |
| `dsh-ssf_runtime` | Execute runtime operations (asset_read/config_get/resolve_model/check_update/infer) |
| `dsh-ssf_run` | Fallback: run any `dsh-ssf` subcommand, return stdout/stderr/exit code — retained for commands not covered by the 18 structured tools |

Browser half (`client.js`): the **Spec 工作流** conversation tab
(id `dsh-ssf`, order 20) — polls `GET /dsh-ssf/snapshot` every 3s (plus
`visibilitychange`), filters to the current session's workspace, lists
changes (name/state/workflow, terminal changes last), click for detail
(DP decisions, last transition, degradation markers), empty state when no
snapshot is available.

## Install

Prerequisites: a DSH web profile (this README uses `web`), Node ≥ 20.

```bash
# from the dsh-ssf repository root
dsh plugin --profile web add /mnt/sdb1/opencode-plug/dsh-ssf/packages/dsh-ssf
```

Enable the plugin in the profile patch layer. Append to
`$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-ssf
      name: dsh-ssf
```

The browser half needs no separate row: `dsh-client-modules` picks it up
automatically from the package's `dsh.client` declaration and
`exports["./client"]`. If the package is not resolvable from the profile
`node_modules`, `name` may be a `.`-relative path to the package directory
(resolved against the profile directory).

Restart the profile:

```bash
dsh --profile web
```

## Verify

1. Open the Web GUI — the **Spec 工作流** conversation tab (next to Chat)
   lists the current workspace's changes with state/workflow; selecting one
   shows its DP decisions. The snapshot is backed by `$DSH_HOME/dsh-ssf.json`
   (check `cat ~/.dsh/dsh-ssf.json` contains `changes/workspaces/scannedAt`) and
   served at `GET /dsh-ssf/snapshot` (not `settings.yaml`).
2. In a session, the agent tool list contains `dsh-ssf_*`; calling `dsh-ssf_state`
   returns the structured JSON state for a change.
3. `settings.yaml` no longer contains an `dsh-ssf:` section; the profile log shows
   no plugin load errors.

Note: code-level bin/tool/snapshot names still keep ssf aliases for compatibility; docs use dsh-ssf uniformly.

## Uninstall

1. Remove the `- id: dsh-ssf` row from `$DSH_HOME/profiles/web/cordis.patch.yml`.
2. `dsh plugin --profile web remove dsh-ssf`

## Development notes

- The browser bundle is hand-written in the DSH self-registering factory format
  (`window.__ModuleLoader__.load({ id, factory })`) — no build step. Pure
  formatting helpers live in `client/format.js` (node-testable ESM) and are
  mirrored inline in `client.js` (the browser module table does not resolve
  relative requires).
- Tests live in the repository under `tests/lib/dsh-ssf-*.test.mjs` and run
  with `node --test tests/lib/dsh-ssf-*.test.mjs`.
- Peer packages are resolved at development time via symlinks under
  `packages/dsh-ssf/node_modules/@deepseek-ai/` pointing at the DSH profile
  install (git-ignored).
