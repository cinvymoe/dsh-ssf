---
name: workflow-start
description: Spec-superflow 状态机工作流主入口（entry router：ssf）。用户说开始/启动/继续/恢复/推进工作流、用 workflow 开始、下一步做什么，或显式提到 spec-superflow（ssf）时调用；工作区有 changes/<name>/、.spec-superflow.yaml、proposal.md、specs/、tasks.md、execution-contract.md 即为 ssf（状态机）上下文。按当前 state 路由到阶段 skill（exploring→need-explorer、executing→build-executor 等）。注意：此 workflow 指 spec-superflow 状态机，不是 JS 编排的 workflow 工具。Entry router for the spec-superflow state machine: start/continue/resume/plan a change. Not for unrelated coding tasks.
---

> **Tool-first rule (`dsh-ssf` plugin):** 所有 ssf 操作优先调用 `ssf_*` 原生工具（含写工具）；仅当工具不存在或调用失败时才回退到等价 `ssf` CLI（可经 `ssf_run`）。

# Workflow Start

Primary entry point for `spec-superflow`. Jobs: inspect change context, check for updates, confirm DP-0, determine state, route to correct skill, block invalid transitions.

## Use This Skill When

Only invoke when spec-superflow context is present: `.spec-superflow.yaml` exists, artifacts like `proposal.md`/`specs/`/`design.md`/`tasks.md`/`execution-contract.md` are present, or user explicitly invokes spec-superflow by name. When in doubt, check for `.spec-superflow.yaml` first.

Do NOT invoke for: general coding tasks outside spec-superflow changes, casual questions, unrelated work.

## States

`exploring` → `specifying` → `bridging` → `approved-for-build` → `executing` → `closing`, with `debugging` side-path from `executing`, and `abandoned` as terminal. After `closing`, Full/legacy Hotfix changes complete the physical archive with `ssf finish` (owned by release-archivist); lightweight paths end at `closing` itself. If a transition is ambiguous, run 调用 `ssf_runtime`（action: "asset_read", path: "docs/state-machine.md"）（CLI 等价：`ssf runtime asset read docs/state-machine.md`）。

## Terminal-State Short Circuit

Before update checks or recovery overlays, inspect the persisted state. If it is `closing`, stop immediately: `closing` is a successful terminal state and the next skill is `none`. Report the terminal state and its persisted evidence. Do not run `handoff list`, `checkpoint list`, the execution-control recovery scan, or `release-archivist`; do not resume, hand off, or route any more work.

Note: `closing` is the logical terminal; the physical archive (merge + worktree cleanup) for Full/legacy Hotfix is performed by `ssf finish` in release-archivist. Lightweight paths have no physical archive step.

## Initialization

1. **Update check**: 调用 `ssf_runtime`（action: "check_update"）（CLI 等价：`ssf runtime check-update`）。 Exit 0 → continue. Exit 1 → non-blocking upgrade reminder. Exit 2 → skip.
2. **Inspect change folder**: Check for `proposal.md`, `specs/`, `design.md`, `tasks.md`, `execution-contract.md`. Answer: Is the change fuzzy? Artifacts missing/unstable? Contract exist? User approved contract? Execution in progress or blocked? In verification/wrap-up?

## Overlay Recovery Scan

3. **Overlay recovery scan**: 调用 `ssf_handoff`（action: "list", changeDir: "<change-dir>"）（CLI 等价：`ssf handoff list <change-dir> --json`） and 调用 `ssf_checkpoint`（action: "list", changeDir: "<change-dir>"）（CLI 等价：`ssf checkpoint list <change-dir> --json`）。 A `result-ready` handoff requires explicit review and 调用 `ssf_handoff`（action: "resolve", changeDir: "<change-dir>", id: "<id>", decision: "<accept|reject|defer>"）（CLI 等价：`ssf handoff resolve <change-dir> <id> --decision <accept|reject|defer> --json`） before resuming the affected work. An `active` handoff is non-blocking side work. Show a non-stale checkpoint as recovery context; show a stale checkpoint only as historical evidence.

## Execution-Control Recovery Scan

4. **Execution-control recovery scan**: For Full or legacy Hotfix in `approved-for-build`, `executing`, or `debugging`, run 调用 `ssf_execution`（changeDir: "<change-dir>"）（CLI 等价：`ssf execution show <change-dir> --json`）。 Treat only `current: true` plus `waves[].eligible: true` as permission to start a wave. Do not require this scan for Quick, Tweak, or a valid direct Hotfix receipt.

## Direct Short-Path Intake

For a clearly bounded Quick or incident Hotfix request, recommend and accept in the same turn. Do not collect the eight intake facts as a questionnaire: infer them from the request and repository, show the observed facts, recommendation, and qualification reason, then ask the user to choose `tdd`, `new-test`, or `bounded` verification before running: 调用 `ssf_state_write`（action: "init", changeDir: "<change-dir>"）（CLI 等价：`ssf state init <change-dir> --json`）、调用 `ssf_workflow_write`（action: "recommend", changeDir: "<change-dir>", taskCount: <n>, fileCount: <n>, configDocOnly: "no", schemaApiChange: "no", newModule: "no", behavioralConstraintChange: "<yes|no>", crossModuleChange: "<yes|no>", uncertainty: "low", requestKind: "<standard|incident>"）（CLI 等价：`ssf workflow recommend <change-dir> --task-count <n> --file-count <n> --config-doc-only no --schema-api-change no --new-module no --behavioral-constraint-change <yes|no> --cross-module-change <yes|no> --uncertainty low --request-kind <standard|incident> --json`）、调用 `ssf_workflow_write`（action: "accept", changeDir: "<change-dir>", verification: "<tdd|new-test|bounded>"）（CLI 等价：`ssf workflow accept <change-dir> --source direct-request --verification <tdd|new-test|bounded> --json`）。

Quick is ≤3 tasks/files of low-risk code. Hotfix is an incident with a reproducible symptom and ≤2 tasks/files. Display `Observed`, `Recommended`, `Why`, and any risk reasons; acceptance is the user's direct request to proceed and their explicit verification choice. Do not create planning artifacts, a contract, an execution plan, wave receipts, or DP approvals. Transition through the receipt-aware guard, execute bounded work, and require `test_result: pass` before closing. A fourth code file, behavioral-constraint change (PRD/spec/design/API/data/permission), cross-module work, a new module, high uncertainty, or failed verification does not auto-escalate: show Quick and Full, then wait for the user's choice. A user selecting Quick must acknowledge the recommendation and choose `tdd`, `new-test`, or `bounded` verification in the receipt. Tweak is only ≤4 config/doc-only tasks/files with no risk signals; it cannot be selected as an override. A legacy Hotfix without a valid direct receipt remains on the Full contract/DP-3/plan/review path.

## DP-0: User Confirmation Gate

After Direct Short-Path Intake does not apply, run DP-0 when: change folder doesn't exist, planning artifacts are missing/empty, `dp_0_confirmed` is not `true`, or a legacy change still has an `auto`/empty workflow. Resolve the artifact language first, then complete the workflow path intake. Do not set `dp_0_confirmed=true` while path facts or the user's path choice are still missing.

### Artifact Language Resolution

Before the first planning artifact is generated, resolve one concrete artifact language in this priority order:
1. explicit user language
2. the conversation's primary language
3. an explicit non-`auto` `execution.defaultLanguage`
4. the primary language of existing planning artifacts in the current change
5. the primary language of the project templates

Treat `execution.defaultLanguage: auto` as a request to continue resolving, not as a language. Append `artifact_language=<concrete-language>` to `dp_0_decisions`, preserving its existing scope and constraint summary. Never persist `auto` as the resolved artifact language. If DP-0 was already confirmed but this field is absent, resolve and append it before routing to `spec-writer`. All later planning skills reuse this field so one change does not switch languages without an explicit user request.

### Workflow Path Intake (Mode Detection, Full/Legacy)

Workflow path selection is a DP-0 intake decision. It selects the planning path (`full`, `hotfix`, `tweak`, or `quick`); it is separate from DP-4, which later selects the execution mode (`Inline`, `Batch Inline`, or `SDD`). It does not add a state or cause a phase transition.

1. Obtain the change name and one-sentence intent before any state-dependent command. Validate the change name as one non-empty relative path segment (not `.` or `..`, with no `/` or `\\`), resolve the change dir as `<project-root>/changes/<change-name>`, and reject any normalized path that escapes the project's `changes/` directory.
2. If the state file is absent or `dp_0_confirmed` is `false`/null, run 调用 `ssf_state_write`（action: "init", changeDir: "<change-dir>"）（CLI 等价：`ssf state init <change-dir> --json`） before `show`; initialization must leave DP-0 unconfirmed.
3. Read `state.workflow`. An explicit `full` workflow wins and skips automatic recommendation. For an explicit `hotfix`/`tweak`/`quick`, report the active path; if scope, risk, or verification now exceeds its boundary, refresh the recommendation with observed facts and route it to Full instead of continuing.
4. For `auto`/`null`/unset, run 调用 `ssf_workflow`（changeDir: "<change-dir>"）（CLI 等价：`ssf workflow show <change-dir> --json`） before collecting or changing any facts. A missing receipt is represented as `needs-input` with all eight fixed facts in `missing_facts`.
5. If the response is `needs-input`, ask only for `missing_facts`; do not ask for any fact not listed by the receipt. Do not invent facts from missing artifacts and do not default the path to `full`.
6. Run 调用 `ssf_workflow_write`（action: "recommend", changeDir: "<change-dir>", taskCount: <n>, fileCount: <n>, configDocOnly: "...", schemaApiChange: "...", newModule: "...", behavioralConstraintChange: "...", crossModuleChange: "...", uncertainty: "...", requestKind: "..."）（CLI 等价：`ssf workflow recommend <change-dir> --task-count <n> --file-count <n> ... --json`） once with one complete fact snapshot.
7. Show the user `Observed`, `Available`, `Recommended`, and `Why`. A recommendation is advice only: never persist it as the workflow selection.
8. A recommended low-risk Quick or incident Hotfix is accepted only with 调用 `ssf_workflow_write`（action: "accept", changeDir: "<change-dir>", verification: "<tdd|new-test|bounded>"）（CLI 等价：`ssf workflow accept <change-dir> --source direct-request --verification <tdd|new-test|bounded> --json`）。 For Full, legacy Hotfix, or Tweak, obtain the user's explicit choice and run 调用 `ssf_workflow_write`（action: "select", changeDir: "<change-dir>", mode: "<full|hotfix|tweak>", reason: "<user choice>"）（CLI 等价：`ssf workflow select <change-dir> --mode <full|hotfix|tweak> --confirm --reason "<user choice>" --json`）。 For a risk-signalled Quick choice, run 调用 `ssf_workflow_write`（action: "select", changeDir: "<change-dir>", mode: "quick", reason: "<reason>", acknowledgeRecommendation: true, verification: "<tdd|new-test|bounded>"）（CLI 等价：`ssf workflow select <change-dir> --mode quick --confirm --acknowledge-recommendation --verification <tdd|new-test|bounded> --json`）。
9. Add `acknowledgeRecommendation` only after the user chooses a non-recommended selectable path. Report the persisted receipt and DP-0 audit summary.
10. To escalate a selected Quick, direct Hotfix, or Tweak, refresh `workflow recommend` with observed risk facts, then select `full` with `--confirm` (and `acknowledgeRecommendation` only if required). Do not overwrite an explicit mode without this persisted recommendation.
11. Keep 调用 `ssf_runtime`（action: "infer", changeDir: "<change-dir>"）（CLI 等价：`ssf runtime infer <change-dir> --json`） only for legacy artifact inference and validation compatibility; it cannot replace user selection at intake.

### Confirm DP-0

Only after an explicit workflow path is available, ask for the remaining DP-0 decisions: change name and one-sentence intent, known constraints, related optimizations (include or stay focused?), and communication preference (ask per decision or draft for review). Confirm one combined summary containing those decisions, the resolved `artifact_language`, and the persisted workflow path plus recommendation-alignment summary. Preserve existing scope, constraints, and language entries; never replace them with the path summary alone.

After that combined confirmation: 调用 `ssf_state_write`（action: "set", changeDir: "<change-dir>", field: "dp_0_decisions", value: "<combined summary>"）（CLI 等价：`ssf state set <change-dir> dp_0_decisions "<combined summary>" --json`）、调用 `ssf_state_write`（action: "set", changeDir: "<change-dir>", field: "dp_0_result", value: "confirmed"）（CLI 等价：`ssf state set <change-dir> dp_0_result confirmed --json`）、调用 `ssf_state_write`（action: "set", changeDir: "<change-dir>", field: "dp_0_confirmed", value: "true"）（CLI 等价：`ssf state set <change-dir> dp_0_confirmed true --json`）、调用 `ssf_state_write`（action: "set", changeDir: "<change-dir>", field: "dp_0_timestamp", value: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"）（CLI 等价：`ssf state set <change-dir> dp_0_timestamp $(date -u +%Y-%m-%dT%H:%M:%SZ) --json`）。

At this point the change sits in `exploring`; all later state advancement is owned by downstream skills — do not run `state transition` here.

Config-aware routing: check `artifacts.order`, `artifacts.skip`, and `execution.defaultLanguage` from project config.

## Routing Rules

### Route to need-explorer
Change is fuzzy, scope unclear, comparing options, no stable change name.

For the Full path this is the **default route**: whenever `dp_1_result` is null, route to need-explorer even if the request already looks clear — a short exploration still applies. The guard blocks `exploring → specifying` for full workflow without a recorded `dp_1_result`.

Skip only when: (a) the active path is Quick, Tweak, direct Hotfix, or legacy Hotfix (fast paths skip exploration); or (b) the user explicitly waives exploration after being told the request looks clear. Record an explicit waiver as the DP-1 decision before routing to spec-writer: 调用 `ssf_state_write`（action: "set", changeDir: "<change-dir>", field: "dp_1_result", value: "waived: <user's reason>"）（CLI 等价：`ssf state set <change-dir> dp_1_result "waived: <user's reason>" --json`）和 调用 `ssf_state_write`（action: "set", changeDir: "<change-dir>", field: "dp_1_timestamp", value: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"）（CLI 等价：`ssf state set <change-dir> dp_1_timestamp $(date -u +%Y-%m-%dT%H:%M:%SZ) --json`）。 Never leave `dp_1_result` null on the Full path.

### Route to spec-writer (Full only)
Guard: 调用 `ssf_guard`（changeDir: "<change-dir>", fromState: "exploring", toState: "specifying"）（CLI 等价：`ssf guard check <dir> exploring specifying --json`） → fail = BLOCK. User knows what they want, artifacts missing/incomplete.

### Route to contract-builder
Only for Full or legacy Hotfix. Guard: 调用 `ssf_guard`（changeDir: "<change-dir>", fromState: "specifying", toState: "bridging"）（CLI 等价：`ssf guard check <dir> specifying bridging --json`） → fail = BLOCK. Artifacts exist, implementation requested, contract missing/stale. Include `DP-3: 契约批准`.

### Route to build-executor
For Full or legacy Hotfix: contract exists and approved, contract matches artifacts. Include `DP-4: 执行模式选择`: propose waves, run 调用 `ssf_execution_write`（action: "recommend", changeDir: "<change-dir>"）（CLI 等价：`ssf execution recommend <change-dir> --json`）, then run 调用 `ssf_execution_write`（action: "plan", changeDir: "<change-dir>", mode: "<selected>", reason: "<reason>", waves: ["<wave>"]）（CLI 等价：`ssf execution plan <change-dir> --mode <selected> --confirm --reason <reason> --wave <wave> --json`） and 调用 `ssf_execution`（changeDir: "<change-dir>"）（CLI 等价：`ssf execution show <change-dir> --json`）。 For Quick, Tweak, or direct Hotfix: use the receipt-aware guard and bounded verification; do not require DP-4, a contract, plan, or review receipt.

### Route to bug-investigator
Execution hit blockage: test failure, unexpected behavior, build error, task cannot proceed. After debugging, route back to build-executor.

### Route to code-reviewer (Full/legacy Hotfix only)
The current planned wave is implemented and ready for verification. A reviewer must write 调用 `ssf_execution_write`（action: "review", changeDir: "<change-dir>", wave: "<id>", base: "<sha>", head: "<sha>", report: "<path>", verdict: "<pass|fail>"）（CLI 等价：`ssf execution review <change-dir> --wave <id> --base <sha> --head <sha> --report <path> --verdict <pass|fail> --json`） receipt before any dependent wave or closing transition. Quick, Tweak, and direct Hotfix use their verification summary instead.

### Route to release-archivist
Only while the current state is `executing`: implementation is complete and verification is ready. For Full/legacy Hotfix, run the guard and complete verification, audit, delta merge, and DP-7. For Quick, Tweak, and direct Hotfix, run the receipt-aware guard, persist 调用 `ssf_state_write`（action: "set", changeDir: "<change-dir>", field: "test_result", value: "pass: <verification summary>"）（CLI 等价：`ssf state set <change-dir> test_result "pass: <verification summary>" --json`） — required by the guard's direct-test-result check before `executing closing`; lightweight also records completion evidence via 调用 `ssf_workflow_write`（action: "evidence", changeDir: "<change-dir>", focusedReview: "<review>", verificationCommand: "<cmd>"）（CLI 等价：`ssf workflow evidence <change-dir> --focused-review <review> --verification-command <cmd> --json`）, then `executing closing`.

### Route to spec-merger
Only while the current state is `executing`, before the final `executing → closing` transition: delta specs need merging with ADDED/MODIFIED/REMOVED/RENAMED specs. Never route a change already in `closing` to `spec-merger`.

### Route to abandoned
User explicitly requests, bug-investigator escalates after 3+ failures AND user chooses, scope change makes change no longer worthwhile AND user confirms. Block from `closing` or `abandoned`.

### Optional Prototype Handoff

When the user's brief explicitly contains UI, screen, interaction, layout, UX, or product-experience uncertainty, ask once whether a prototype would reduce uncertainty. Do not create a prototype handoff or enter a prototype worktree until the user confirms. After confirmation: 调用 `ssf_handoff`（action: "create", changeDir: "<change-dir>", type: "prototype", objective: "<confirmed objective>", expectedOutput: "<expected evidence>", acceptance: "<completion criterion>"）（CLI 等价：`ssf handoff create <change-dir> --type prototype --objective "<confirmed objective>" --expected-output "<expected evidence>" --acceptance "<completion criterion>" --json`）和 调用 `ssf_isolate`（changeDir: "<change-dir>", name: "prototype-<handoff-id>", mode: "isolate"）（CLI 等价：`ssf isolate <change-dir> prototype-<handoff-id> --isolate`）。 Never suggest or enter this route automatically for backend, CLI, configuration, or internal-refactor work. Never pass `--force` to `ssf isolate` for prototype work — pass `--isolate` instead.

### Fast-Path Routing
- **Legacy Hotfix**: Route to contract-builder (minimal), skip need-explorer + spec-writer, guard check `exploring bridging --workflow hotfix`, then `bridging -> approved-for-build`, after DP-3 → build-executor (recommend, show, and confirm an execution mode), after → release-archivist (lightweight). It may skip planning artifacts but still requires a minimal contract, DP-3, and a current execution plan. A direct Hotfix instead follows Direct Short-Path Intake.
- **Tweak**: Route to build-executor (direct edit), skip need-explorer + spec-writer + contract-builder, guard check `exploring approved-for-build --workflow tweak`, after → release-archivist (lightweight)
- **Quick / direct Hotfix / lightweight**: Route to build-executor (direct edit on trunk), skip isolate + contract + plan + wave receipts; guard check `exploring approved-for-build` (receipt-aware), then edit, persist 调用 `ssf_state_write`（action: "set", changeDir: "<change-dir>", field: "test_result", value: "pass: <verification summary>"）（CLI 等价：`ssf state set <change-dir> test_result "pass: <verification summary>" --json`） — required by the guard's direct-test-result check before `executing closing`; lightweight also records completion evidence via `ssf workflow evidence`, then `executing closing`.

Post-transition: 调用 `ssf_inject`（changeDir: "<change-dir>"）（CLI 等价：`ssf inject <change-dir> --json`） to update phase-guard artifacts.

## Staleness Detection

Use content inspection, not timestamps.

**Stale contract**: proposal scope expanded beyond contract scope fence, or contract references capabilities no longer in proposal → route back to `contract-builder`.

**Stale planning artifacts**: capability in proposal has no spec file, or spec exists for capability not in proposal → drift detected.

**Stale tasks**: requirement in specs has no corresponding task → stale tasks.

## Guardrails

- Full/legacy Hotfix: no implementation before planning artifacts or contract exist
- No implementation for Full or legacy Hotfix without a current `ssf_execution_write` plan; no state transition based on an unverified DP-4 string
- No "continue" without state inspection
- Full/legacy Hotfix: no implementation past stale contract
- No implementation past bug without investigation
- Full/legacy Hotfix: no closure without all planned wave review receipts recorded as `pass` or with unsynced delta specs
- `closing` is a successful terminal state: next skill is none and recovery overlays do not run
- No transitions from `abandoned` (terminal)
- No transition to `abandoned` from `closing` or `abandoned`
- No auto-abandon without user confirmation
- No merging delta specs from abandoned change

## Output Standard

Always state: (1) current detected state, (2) why (cite file/content/condition), (3) which skill should run next. If blocking, explain missing artifact/approval.

Decision point references when routing:
- contract-builder → DP-3, build-executor → DP-4, bug-investigator (escalation) → DP-5, release-archivist (verification failure) → DP-6, release-archivist → DP-7

## Exception Handling

- **Parse failures**: Fall back to content-level detection if `.spec-superflow.yaml` is malformed
- **Missing files**: Route to the skill that generates the missing files
- **User interruption**: Re-inspect change directory content (not cached state) on resume

## Standard User-Facing Handoff

End every user-facing phase report with this concise handoff. Only a successfully persisted `closing` state and `abandoned` are terminal.

### Normal report

- Current stage: `<detected workflow stage>`.
- Completed / blocker: `<completed work>`.
- Next stage: `<next workflow stage or skill>`.
- Entry condition: `<what must be true to enter it>`.

### Blocked report

- Current stage: `<detected workflow stage>`.
- Completed / blocker: `<blocking fact or missing evidence>`.
- Next stage: `<stage that resumes after the blocker>`.
- Entry condition: `<the approval, artifact, validation, or fix required>`.

### Approval-wait report

- Current stage: `<detected workflow stage>`.
- Completed / blocker: `<work ready for the named decision>`.
- Next stage: `<stage that follows approval>`.
- Entry condition: `<explicit user approval or recorded decision>`.

### Successful terminal report

- Current stage: successfully persisted `closing` or `abandoned`.
- Completed / blocker: `<persisted terminal outcome>`.
- Next stage: `none`.
- Entry condition: no further transition exists.
