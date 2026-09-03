# dsh-ssf — spec-superflow as a DeepSeek Harness plugin

`dsh-ssf` packages [spec-superflow](https://github.com/spec-superflow/spec-superflow) as a
DSH (Cordis) plugin: the host half exposes the workflow state machine through
native structured tools and persists change-status snapshots to a standalone
file (`$DSH_HOME/ssf.json` by default, configurable via `config.path`); the
browser half polls `GET /dsh-ssf/snapshot` and renders a read-only
**Spec 工作流** conversation tab. No data is written to `settings.yaml`.

## Capabilities

Host half (`lib/index.js`):

- `ssf` service: `scan()` / `summary(changeDir)` / `refresh()` / `getSnapshot()`
  over the workspace `changes/` directory.
- Standalone snapshot file: `snapshot-store.js` persists
  `{ changes, workspaces, scannedAt }` to `$DSH_HOME/ssf.json` (or
  `config.path`, with `config.dshHome` overriding the home), created with
  `0700`/`0600` and written atomically; `GET /dsh-ssf/snapshot` (via
  `ctx.webServer`) serves the in-memory snapshot with `Cache-Control: no-store`.

Structured tools (`lib/tools.js`, registered on `ctx.tools`): 19 `ssf_*` tools (6 read + 12 write + `ssf_run` fallback — 19 total; `ssf_run` retained for uncovered subcommands):

| Tool | Purpose |
|---|---|
| `ssf_list` | List all changes with state machine summary |
| `ssf_state` | Raw `.spec-superflow.yaml` fields for one change (with degradation markers) |
| `ssf_workflow` | Workflow receipt summary (path, status, recommendation) |
| `ssf_execution` | Persisted execution plan summary (waves + eligibility) |
| `ssf_validate` | Artifact validation report (proposal + delta specs) |
| `ssf_guard` | Phase-transition guard check (from/to states) |
| `ssf_state_write` | Write state machine fields for a change (init/set/transition/rebuild) |
| `ssf_workflow_write` | Write workflow selection for a change (recommend/select/accept/evidence/escalate) |
| `ssf_execution_write` | Write execution plan for a change (recommend/plan/revise/resync/review) |
| `ssf_checkpoint` | Manage checkpoints for a change (save/list/show) |
| `ssf_handoff` | Manage handoff contracts for a change (create/list/finish/resolve) |
| `ssf_debug` | Manage debugging attempts for a change (record_attempt/show_attempts/escalate) |
| `ssf_isolate` | Isolate a change into a git worktree (--force/--isolate) |
| `ssf_finish` | Finish a change (merge, verify, clean worktree) |
| `ssf_inject` | Generate phase-guard injection artifacts |
| `ssf_sync` | Publish delta as canonical baseline specs |
| `ssf_audit` | Generate decision-point audit report |
| `ssf_runtime` | Execute runtime operations (asset_read/config_get/resolve_model/check_update/infer) |
| `ssf_run` | Fallback: run any `ssf` subcommand, return stdout/stderr/exit code — retained for commands not covered by the 18 structured tools |

Browser half (`client.js`): the **Spec 工作流** conversation tab
(id `ssf`, order 20) — polls `GET /dsh-ssf/snapshot` every 3s (plus
`visibilitychange`), filters to the current session's workspace, lists
changes (name/state/workflow, terminal changes last), click for detail
(DP decisions, last transition, degradation markers), empty state when no
snapshot is available.

## Install

Prerequisites: a DSH web profile (this README uses `web`), Node ≥ 20.

```bash
# from the spec-superflow repository root
dsh plugin --profile web add /mnt/sdb1/opencode-plug/spec-superflow/packages/dsh-ssf
```

Enable the plugin in the profile patch layer. Append to
`$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: ssf
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
   shows its DP decisions. The snapshot is backed by `$DSH_HOME/ssf.json`
   (check `cat ~/.dsh/ssf.json` contains `changes/workspaces/scannedAt`) and
   served at `GET /dsh-ssf/snapshot` (not `settings.yaml`).
2. In a session, the agent tool list contains `ssf_*`; calling `ssf_state`
   returns the structured JSON state for a change.
3. `settings.yaml` no longer contains an `ssf:` section; the profile log shows
   no plugin load errors.

## Uninstall

1. Remove the `- id: ssf` row from `$DSH_HOME/profiles/web/cordis.patch.yml`.
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
