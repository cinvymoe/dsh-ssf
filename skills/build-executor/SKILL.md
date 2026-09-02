---
name: build-executor
description: Govern implementation from an approved execution contract. Invoke when execution-contract.md is approved and the user wants disciplined build work, TDD execution, or guarded batch-by-batch implementation.
---

> **Tool-first rule (`dsh-ssf` plugin):** 所有 ssf_* 操作优先调用 `ssf_*` 原生工具（含写工具）；仅当工具不存在或调用失败时才回退到等价 `ssf` CLI（可经 `ssf_run`）。

# Build Executor

Controls the implementation phase. Uses `execution-contract.md` as the workflow authority.

## Required Inputs

For Full or legacy Hotfix, read `execution-contract.md`, `tasks.md`, relevant `specs/`, and relevant `design.md`. Quick, direct incident Hotfix, and Tweak require only their receipt, request boundary, changed files, and verification command.

Check workflow mode and receipt first. Tweak → direct edit mode. Quick or a valid direct incident Hotfix → Direct Quick and Hotfix. Full or legacy Hotfix → standard contract-first discipline.

Branch/worktree preflight before ANY implementation edit — **workflow-aware**:

**Full / legacy Hotfix — isolation requires user confirmation (ask via ask_user_question, do not auto-isolate):**
1. 必须先调用 `ask_user_question` 结构化询问是否隔离，禁止直接调用 ssf_isolate 或自由文本追问。示例：
   ```
   调用 ask_user_question({questions:[{id:"worktree-isolate", header:"隔离确认", question:"当前 workflow 为 Full/legacy Hotfix，当前分支：<branch>（main/master 为保护分支）。是否创建隔离 worktree/分支以避免污染主干？隔离后所有编辑在 worktree 内进行，主干通过 ssf_finish 合并。", options:[{label:"创建隔离 worktree (Recommended)", description:"在 changes/worktrees/<name> 创建 worktree，安全隔离"}, {label:"在当前分支直接编辑", description:"不创建隔离，直接在当前分支编辑（风险自负）"}, {label:"取消", description:"暂不执行"}], multi_select:false}]})
   ```
   即使当前分支为 main/master，也必须先经此提问，由用户决定，不得自动创建。
2. 根据 answers 决定：
   - 若选中“创建隔离 worktree” → 调用 `ssf_isolate`（changeDir:"<change-dir>", mode:"isolate" 或 mode:"none" 均可，推荐 mode:"isolate"）创建隔离；若创建失败（非零或半初始化），STOP 并报告失败原因，不得在半初始化 worktree 上继续实现，需用户重选
   - 若选中“在当前分支直接编辑” → 调用 `ssf_isolate`（changeDir:"<change-dir>", mode:"force"）显式标记原地编辑，并警告用户主干污染风险，需用户二次确认已体现在 answers 中
   - 若选中“取消” → STOP，不执行任何隔离或编辑
3. 若隔离成功，报告 chosen branch/worktree 并使后续编辑在隔离上下文内（绝对路径或 cd <worktree> && 前缀），并记录 worktree 指针；若原地编辑，则报告将直接编辑 <branch>。`ssf_isolate` 也会递归初始化子模块并追加 cwd 警告到 progress.md — 该说明归属隔离成功分支：当隔离创建成功且存在 `.gitmodules` 时，其会在新隔离上下文中递归初始化子模块，并在 `<change-dir>/.superpowers/sdd/progress.md` 追加 cwd 持久化警告（隔离路径 + 强制 `cd` 前缀规则），避免后续 Bash 调用误改主干。
4. Closure (including 调用 `ssf_finish`（changeDir: "<change-dir>"）（CLI 等价：`ssf finish <change-dir>`） for Full/legacy Hotfix) is owned by release-archivist — route there after review passes.

**Quick / direct Hotfix / Tweak / lightweight — skip isolation, edit directly on the current branch.** Rationale: no recordReview (R4 never fires), no `ssf_finish` merge, no wave receipts — a worktree would be dead weight. For sensitive scenarios requiring manual isolation, run 调用 `ssf_isolate`（changeDir: "<change-dir>", mode: "force"）（CLI 等价：`ssf isolate <change-dir> --force`） explicitly. 如用户在 Full/legacy Hotfix 中经上述提问选择了“在当前分支直接编辑”，则等同于此原地路径，后续不再另行隔离。

## Core Laws

### Law 1: Contract First (Full and legacy Hotfix)
For Full and legacy Hotfix, the execution contract is the approved handoff artifact, not chat history. Direct Quick and incident Hotfix use their valid direct receipt plus bounded verification instead; they must not create or require a contract.

### Law 2: TDD Iron Law — Full and legacy Hotfix
RED (write test, see it fail) → GREEN (write minimal code, see it pass) → REFACTOR (clean up, suite stays green).

Quick follows the verification strategy persisted in its receipt: `tdd`, `new-test`, or `bounded` (targeted test, syntax/static check, or other stated evidence). A direct Hotfix must still demonstrate that the original symptom is gone.

**Red Flags**: ignoring the selected verification strategy, reporting a manual check as if it were automated evidence, or silently expanding a bounded Quick change. Full and legacy Hotfix still require RED → GREEN → REFACTOR.

### Test Quality Reference

Before selecting or reviewing test evidence, read `skills/build-executor/writing-good-tests.md`. Apply its behavior-falsifiability rules to Full and legacy Hotfix work without changing the persisted Quick strategy or the Tweak boundary. Documentation-only work uses appropriate format, link, lint, or build evidence; do not require invented unit tests.

### Law 3: Review Before Drift
Block on: logic defects, spec violations, missing required tests, unintended scope expansion.

### Law 4: Rewind on Contract Break — Full and legacy Hotfix
Return to `specifying` or `bridging` if: new behavior appears, interfaces change materially, design assumptions fail, artifacts no longer define intended implementation.

For Quick/direct Hotfix, stop instead of creating or rewinding a contract; refresh `ssf_workflow_write` recommendation with observed risk, then select `full --confirm`.

## Controller Continuity Protocol

This protocol is a host controller responsibility. The skill does not create autonomous background execution, retain control after a host turn ends, or guarantee that a dispatched subtask continues without the host.

- While an active subtask exists or a planned wave has a pending wave receipt, the controller remains in execution. Send only concise commentary progress; do not send a final response or end the control turn as though the change were waiting for the user.
- On a user interruption or resume, first read 调用 `ssf_execution`（changeDir: "<change-dir>"）（CLI 等价：`ssf execution show <change-dir> --json`） and the progress ledger at `.superpowers/sdd/progress.md`. Reconcile those records before dispatching anything, then continue the current eligible repair or eligible task according to the persisted plan. Do not restart a completed task, skip a retryable repair, or infer completion from chat text.
- A controller may end its control turn or request user input only when the change is completed, an external blocker prevents meaningful progress, or user authorization is genuinely required. A dispatched task, pending review, or routine internal transition is not a terminal condition.
- Commentary must state the current wave/task, evidence or receipt status, and the automatic next gate. It must not imply that the skill itself will run in the background after the host has ended the turn.

## Planning-document boundary

Treat proposal, design, and tasks as reader-facing decision records. Do not add per-test RED/GREEN ritual, receipt paths, or dispatch scripts to them during implementation; keep that evidence in the execution contract, task brief, and review report. For a Full change, confirm that the one DP-2 blind-reader result is recorded before treating the contract as the implementation authority.

## Execution Mode Selection

For Full or legacy Hotfix, generate proposed waves from the approved contract, then use the recommendation as a decision aid rather than silently defaulting a mode:

调用 `ssf_execution_write`（action: "recommend", changeDir: "<change-dir>", waves: ["<wave-id>:<parallel|serial>:<task,...>[:<depends-on,...>]"]）（CLI 等价：`ssf execution recommend <change-dir> --wave <wave-id>:<parallel|serial>:<task,...>[:<depends-on,...>] --json`）— 生成波次建议并写入与 artifacts、contract、waves 关联的 receipt，产出观测事实（facts）与推荐模式（recommended），但不自动进入 plan。The command writes a receipt tied to the artifacts, contract, and waves and surfaces observed facts and the recommendation for the subsequent structured question。`recommend` 仅作为决策辅助，不自动选择模式。

**DP-4 必须通过 `ask_user_question` 结构化提问完成，禁止自由文本** — 将上一步 `recommend` 产出的 `<waves>`、`<facts>`、`<recommended>` 填入问题，推荐项必须置首并加 ` (Recommended)` 后缀，`multi_select:false`：

```
调用 ask_user_question({questions:[{id:"dp-4-mode", header:"DP-4 执行模式选择", question:"已生成波次建议：<waves>，观测事实：<facts>，推荐模式：<recommended>。请选择执行模式", options:[{label:"SDD (Recommended)", description:"子代理驱动分批"}, {label:"Inline", description:"单代理线性"}, {label:"Batch Inline", description:"批量线性"}], multi_select:false}]})
```

若推荐项非 SDD，则将推荐项重排至首位并加 ` (Recommended)`，其余按原序；仅首项带 ` (Recommended)`（如推荐 `Inline` 时 `options` 为 `[{label:"Inline (Recommended)"}, {label:"SDD"}, {label:"Batch Inline"}]`，而非 `SDD` 仍在首位），`description` 按上例保留。禁止以自然语言 `Show every available mode...` 自由文本替代此结构化提问。

只有当 `ask_user_question` 返回 `answers` 且用户已选中某一 `mode` 后，才以用户选择的 `mode` 执行后续 — 按序执行 `ssf_execution_write` recommend → `ssf_execution_write` plan → `ssf_execution` show → transition to executing：

1. 已完成 `ssf_execution_write` `recommend` 作为决策辅助依据（不自动选择）；
2. 依据 `answers["dp-4-mode"]` 选中的 `mode` 作为 `selected-mode`，调用 `ssf_execution_write`（action: "plan", changeDir: "<change-dir>", mode: "<selected-mode>", reason: "user-selected execution mode", waves: ["<wave-id>:<parallel|serial>:<task,...>[:<depends-on,...>]"]）（CLI 等价：`ssf execution plan <change-dir> --mode <selected-mode> --confirm --reason "user-selected execution mode" --wave <wave-id>:<parallel|serial>:<task,...>[:<depends-on,...>] --json`）；当用户选择非推荐项时追加 `--acknowledge-recommendation` 以记录知情风险决策；
3. 调用 `ssf_execution`（changeDir: "<change-dir>"）（CLI 等价：`ssf execution show <change-dir> --json`）校验 `current: true`；
4. 校验通过后再执行 `ssf_state_write` transition to `executing`（若已在该状态则跳过）；

The optional fourth `--wave` segment names prerequisite wave IDs. `execution show --json` reports `current`, plus each wave's `depends_on`, `receipt`, `blockers`, `retryable`, and `eligible` status. A wave with `retryable: true` has a current `fail` receipt and is eligible only for its focused repair and re-review; its dependents remain blocked until its replacement `pass` receipt. Report the saved plan revision, selected mode, ordered waves, dependencies, and whether every `parallel` wave can actually be dispatched concurrently on the current platform. If concurrency is unavailable, state the capability and reason plainly; retain the planned `parallel` strategy and do not silently execute it as a serial or Batch Inline plan.

The recommendation uses task count, configured `execution.inlineThreshold`, and declared wave strategy. It never auto-selects: present every available mode and the recommendation to the user **via the mandatory `ask_user_question` (DP-4)**. `recommend` 仅作为决策辅助，不自动选择模式。`--confirm` 记录用户显式选择的 `mode`；当选择非推荐项时必须追加 `--acknowledge-recommendation` 以记录知情风险决策。

| Mode | Criteria |
|------|----------|
| **SDD** | Recommended for parallel waves, multiple waves, or work beyond the inline threshold |
| **Inline** | Recommended for a single sequential task; always available for a user-confirmed choice |
| **Batch Inline** | Recommended for a bounded sequential batch; it remains serial and is never presented as parallel |

Do not transition to `executing` until `execution show` reports `current: true` and the phase guard passes. Once `current: true` is confirmed, run 调用 `ssf_state_write`（action: "transition", changeDir: "<change-dir>", target: "executing"）（CLI 等价：`ssf state transition <change-dir> executing --json`） (skip if already in that state). A revised plan must repeat `ssf_execution_write` recommend and use 调用 `ssf_execution_write`（action: "revise", changeDir: "<change-dir>", mode: "<mode>", reason: "<reason>", waves: ["<wave>"]）（CLI 等价：`ssf execution revise <change-dir> --mode <mode> --confirm --reason <reason> --wave <wave> --json`）； it creates a new revision and invalidates receipts from the prior revision.

When the plan becomes stale only because planning documents received a non-semantic correction (e.g. formatting fixes) and no fail receipt awaits repair, use 调用 `ssf_execution_write`（action: "resync", changeDir: "<change-dir>", reason: "<text>"）（CLI 等价：`ssf execution resync <change-dir> --confirm --reason <text> --json`） instead of revising. Resync refreshes the plan's artifacts_hash reference while keeping every existing receipt intact — unlike `revise`, which re-plans scope into a new revision and invalidates old receipts; resync never changes plan content. The operation writes an audit record to the progress ledger.

## Batch Inline Execution

Only when the user explicitly confirms `batch-inline` after seeing the recommendation. Current agent executes directly and serially. TDD Iron Law still applies.

Procedure: announce mode → write failing test → confirm failure → implement → run suite → refactor → lightweight checkpoint (files exist, no placeholders, test passed, no unintended changes) → report.

Boundaries: if any task touches >1 module, involves schema/API/config changes, or has open questions → downgrade to Inline or SDD.

## SDD Workflow

For Full/legacy Hotfix by default. Dispatch according to the persisted plan, review each planned wave, and run a final broad review after all waves.

### Planned-Wave Loop
1. Read the current plan with 调用 `ssf_execution`（changeDir: "<change-dir>"）（CLI 等价：`ssf execution show <change-dir> --json`）； only waves shown with `current: true` and `eligible: true` may start. A `retryable: true` wave may only be repaired and re-reviewed; do not dispatch its dependents until its replacement receipt is `pass`. The CLI encodes dependencies in `--wave <id>:<strategy>:<tasks>[:<depends-on,...>]` and rejects a review receipt for a wave whose prerequisites lack current `pass` receipts.
2. A `parallel` wave may dispatch independent tasks simultaneously only when the platform supports concurrent dispatch. If it does not, disclose the unavailable capability and execute the same wave one task at a time without changing its stored strategy.
3. A `serial` wave dispatches one task at a time in listed order.
4. After every wave, write a non-empty persisted regular-file review report (separate from the implementer's report), then record exactly one receipt that names that review report: 调用 `ssf_execution_write`（action: "review", changeDir: "<change-dir>", wave: "<wave-id>", base: "<sha>", head: "<sha>", report: ".superpowers/sdd/reviews/<wave-id>.md", verdict: "<pass|fail>"）（CLI 等价：`ssf execution review <change-dir> --wave <wave-id> --base <sha> --head <sha> --report .superpowers/sdd/reviews/<wave-id>.md --verdict <pass|fail> --json`）。 `ssf execution plan` creates this review overlay. Store report evidence in it; paths outside the overlay are rejected for audit safety. Do not begin a dependent wave until its predecessor receipt is `pass`.
5. Critical/Important findings require a `fail` receipt, a focused repair, re-review, then a replacement `pass` receipt. Never advance or close with a missing or failed receipt.

### Repair and focused re-review protocol

Before dispatching any repair, read 调用 `ssf_execution`（changeDir: "<change-dir>"）（CLI 等价：`ssf execution show <change-dir> --json`） and use the CLI-provided `waves[].repair` state together with `eligible` and `retryable`. The controller does not infer a repair round from filenames or history, and must not write, edit, or modify a repair-state file directly.

- **Rounds 1–2 — recovery:** dispatch only the focused repair for the current wave. Give the implementer the CLI repair round, previous review report, and the prior review head. Generate a scoped diff from that head, then dispatch the `re-review-prompt.md` reviewer against the prior finding and that scoped diff. Do not redispatch dependent waves.
- **Third unresolved failure — stop:** the third unresolved receipt yields CLI status `adjudication-required`. Stop automatic dispatch and request a human adjudication rather than attempting a fourth repair.
- Every focused re-review still writes its separate persisted report and is recorded only through 调用 `ssf_execution_write`（action: "review", changeDir: "<change-dir>", wave: "<id>", base: "<sha>", head: "<sha>", report: ".superpowers/sdd/reviews/<wave-id>-rereview.md", verdict: "<pass|fail>"）（CLI 等价：`ssf execution review <change-dir> --wave <id> --base <sha> --head <sha> --report .superpowers/sdd/reviews/<wave-id>-rereview.md --verdict <pass|fail> --json`）。 A replacement `pass` receipt is the only evidence that resolves the wave.

### Per-Task Loop
1. **Dispatch implementer**: Load the template with 调用 `ssf_runtime`（action: "asset_read", path: "skills/build-executor/implementer-prompt.md"）（CLI 等价：`ssf runtime asset read skills/build-executor/implementer-prompt.md`）。 Extract task brief with `scripts/task-brief PLAN_FILE N`. Include: where task fits, brief path, interfaces from prior tasks, report file path.
2. **Handle response**: DONE → generate review package + dispatch reviewer. DONE_WITH_CONCERNS → assess. For NEEDS_CONTEXT, BLOCKED, or another unresolved failure, append `Task N: failed attempt X/3 — <reason>` to the existing progress ledger. Retry only when the controller can name new evidence, new context, or a specific strategy change. The retry brief contains the prior failure reason, the single objective, and the necessary file paths; do not repeat the planning pack or conversation history. After the third unresolved failure, stop automatic dispatch, enter DP-5, and ask the user for a decision.
3. **Review**: Load 调用 `ssf_runtime`（action: "asset_read", path: "skills/build-executor/task-reviewer-prompt.md"）（CLI 等价：`ssf runtime asset read skills/build-executor/task-reviewer-prompt.md`）。 Reviewer returns spec compliance + code quality verdicts with the wave ID, git range, report path, and `pass`/`fail` receipt command.
4. **Fix**: If Critical or Important issues, write the `fail` receipt, read the CLI repair state, then dispatch only the focused repair and re-review path permitted by the repair protocol above. Write the replacement `pass` receipt only after that re-review passes.
5. **Mark complete**: Append to `.superpowers/sdd/progress.md`: `Task N: complete (commits <base7>..<head7>, review clean)`

### Model Selection
Use the configured profile that matches the task role. Resolve it before dispatch:

调用 `ssf_runtime`（action: "resolve_model", profile: "<profile>"）（CLI 等价：`ssf runtime config --resolve-model <profile> --json`）。

| Profile | Role |
|---|---|
| `mechanical` | Cheap, routine edits |
| `standard` | Integration and judgment work |
| `strong` | Architecture, design, and final review |
| `review` | Review that matches the diff |

For platforms whose dispatch supports a `model` field, explicitly pass the resolved `model` value. If the result is `configured: false`, automatic selection is unavailable: do not invent a provider model and do not bypass the existing requirement to specify `model` explicitly. Resolution only reads configuration; it does not switch models.

### Progress Ledger
Track in `.superpowers/sdd/progress.md`. Check for existing ledger — completed tasks are done. After each batch: 调用 `ssf_state_write`（action: "set", changeDir: "<change-dir>", field: "batches_completed", value: "<N>"）（CLI 等价：`ssf state set <change-dir> batches_completed <N> --json`）。

## Inline Execution Mode

Only after a user-confirmed `inline` selection is recorded by `ssf_execution_write` `--confirm`; a non-recommended selection also records `--acknowledge-recommendation`. Executes in the current session and still writes one review receipt per planned wave.

Per-task: extract brief → write failing test → confirm failure → implement → confirm green → checkpoint review (done-when criteria, SHALL/MUST verification) → commit → save a task-level recovery checkpoint when another task remains → append to progress ledger.

After a task is committed and reviewed, when another task remains, save the recovery context with real evidence:

调用 `ssf_checkpoint`（action: "save", changeDir: "<change-dir>", task: "<completed-task-id>", next: "<next task>"）（CLI 等价：`ssf checkpoint save <change-dir> --task <completed-task-id> --next "<next task>" --json`）。

This augments `.superpowers/sdd/progress.md`; it does not replace the progress ledger or add a new core workflow state. Do not claim a checkpoint is current when `ssf_checkpoint` list reports it as stale.

If a task reaches three unresolved failures, stop at DP-5 and request a human decision. If work moves outside the declared scope, replan instead of retrying.

## Tweak Mode

Skip TDD. Apply changes directly. Verify file integrity (exists, non-empty, valid syntax). No batch execution — sequential changes.

## Direct Quick and Hotfix

Quick direct execution requires the valid receipt, a bounded diff, the receipt's selected verification strategy, and a persisted `test_result: pass`; do not create a contract, execution plan, wave review, DP-6, or DP-7. Direct Hotfix follows the same route only for an incident-backed receipt and must run a regression that demonstrates the original symptom is fixed. If scope grows or risk appears, refresh `workflow recommend`, show the revised risk, and wait for the user to choose Quick or Full before resuming. A legacy Hotfix without a direct receipt remains subject to the contract, DP-3, execution plan, and review receipts.

## DP Records

DP-4 is written by `ssf_execution_write` plan; do not write it with raw `state set`.
DP-5 (debug escalation): bug-investigator records each failed fix through `ssf_debug`; after at least three distinct attempts and explicit user confirmation, use 调用 `ssf_debug`（action: "escalate", changeDir: "<change-dir>", decision: "<continue|abandon>", reason: "<resolution>"）（CLI 等价：`ssf debug escalate <change-dir> --decision <continue|abandon> --reason "<resolution>" --confirm --json`）。 Raw `state set dp_5_*` is blocked.

## Completion Standard

For Full or legacy Hotfix, do not report completion until tests pass, contract obligations are satisfied, review blockers resolved, every planned wave has a current `pass` receipt, and final review is complete. For Quick/direct Hotfix/Tweak, report completion only after bounded verification and persisted `test_result: pass`; do not require contract or review receipts.

## Exception Handling

- **Parse failures**: Stop and report exact line/format issue. Route back to `contract-builder`.
- **Missing artifacts**: Route back to appropriate upstream skill. Don't guess.
- **User interruption**: Progress ledger enables recovery. Check ledger on resume.

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
