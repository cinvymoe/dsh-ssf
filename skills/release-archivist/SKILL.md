---
name: release-archivist
description: Close out a spec-superflow change with verification, summary, and archive readiness. Invoke when implementation is complete, verification is underway, or the user asks for a final wrap-up.
---

> **Tool-first rule (`dsh-ssf` plugin):** 所有 ssf_* 操作优先调用 `ssf_*` 原生工具（含写工具）；仅当工具不存在或调用失败时才回退到等价 `ssf` CLI（可经 `ssf_run`）。

# Release Archivist

Finish a spec-superflow change cleanly with verification evidence. This skill
operates while the change state is `executing`; it is not an active skill after
the final transition to `closing`.

## Execution-State Guard

Before verification, 调用 `ssf_audit`（changeDir: "<change-dir>"）（CLI 等价：`ssf audit <change-dir>`）, any DP state write, or delta-spec merge, run 调用 `ssf_state`（changeDir: "<change-dir>"）（CLI 等价：`ssf state get <change-dir> state`）。
Continue only when the persisted state is exactly `executing`. If it is `closing` → STOP: "Closing is terminal; release, audit, and archival work were completed before this transition." For any other state, or if the state cannot be read → STOP and route through `workflow-start`; do not perform side effects.

## Direct Short-Path Closure (run before the Full checklist)

For Quick, Tweak, or a valid direct incident Hotfix receipt, skip the Full verification, audit, delta merge, DP-6, and DP-7 sections below. Record changed files, the focused verification command and result, then persist `test_result: pass` and transition to closing. Quick requires a targeted test or syntax/static check; direct Hotfix requires an original-symptom regression. A legacy Hotfix stays on the Full checklist.

## Full/Legacy Verification Before Completion

The Full checklist below applies only to Full and legacy Hotfix. Direct Short-Path Closure above takes precedence for Quick, Tweak, and valid direct Hotfix.

Claiming work is complete without verification is dishonesty, not efficiency. Before claiming any status:
1. IDENTIFY the command that proves the claim
2. RUN the full command fresh
3. READ output, check exit code
4. VERIFY output confirms the claim
5. Only THEN make the claim

**Forbidden before evidence**: "should", "probably", "seems to", expressions of satisfaction without output.

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Test output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check |
| Build succeeds | Build exit 0 | Linter passing |
| Bug fixed | Original symptom passes | Code changed |
| Requirements met | Line-by-line checklist | Tests passing |

## Full/Legacy Verification Steps

### Step 1: Test Suite
Run full test suite. Record total/passed/failed/skipped. Zero failures = PASS.

### Step 2: Completeness
Compare contract batches against actual diff. Every SHALL/MUST must have implementation evidence. Missing = Critical severity.

### Step 3: Coherence
Compare design decisions against code. Check naming consistency. Inconsistencies = IMPORTANT.

### Step 4: Unintended Scope
Check for files modified outside scope fence, new dependencies not in design. Unplanned = WARN.

### Step 5: Report

| Dimension | Status | Findings |
|-----------|--------|----------|
| Completeness | PASS/FAIL/WARN | [list] |
| Correctness | PASS/FAIL/WARN | [list] |
| Coherence | PASS/FAIL/WARN | [list] |

**Verdict**: PASS (all PASS) / CONDITIONAL (WARN only) / FAIL (any FAIL).
- FAIL → fix issues or route back to build-executor
- CONDITIONAL → present WARNs, proceed only with user acceptance
- PASS → proceed to final checks

## Full/Legacy Final Checks

- Tests passing? (cite command and output)
- All batches complete? (cite batch status)
- Scope added without artifact updates?
- Unresolved blockers or known risks?
- Delta specs exist that need merging?
- Run 调用 `ssf_audit`（changeDir: "<change-dir>"）（CLI 等价：`ssf audit <change-dir> --json`） — include `decision-point-audit.md` in archive

### DP-6 (Verification Outcome, Full/legacy Hotfix)
当 Verdict 为 FAIL 时，**必须**调用 `ask_user_question` 结构化提问，禁止使用自然语言 "Route back or ask about abandonment" 或隐式处置。示例：
```
调用 ask_user_question({questions:[{id:"dp-6-verification", header:"DP-6 验证处置", question:"验证结果：FAIL，证据：<evidence>。请选择处置方式", options:[{label:"返修复 (Recommended)", description:"返回 executing 修复后重验"}, {label:"放弃关闭", description:"放弃归档，标记 abandoned"}], multi_select:false}]})
```
只有当 `answers` 选中后，才写入 调用 `ssf_state_write`（action: "set", changeDir: "<change-dir>", field: "dp_6_result", value: "<pass|conditional|fail>: <summary>"）（CLI 等价：`ssf state set <change-dir> dp_6_result "<pass|conditional|fail>: <summary>" --json`）和 调用 `ssf_state_write`（action: "set", changeDir: "<change-dir>", field: "dp_6_timestamp", value: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"）（CLI 等价：`ssf state set <change-dir> dp_6_timestamp $(date -u +%Y-%m-%dT%H:%M:%SZ) --json`），并根据选择决定是返回 executing 修复（选中“返修复”）还是标记 `abandoned`（选中“放弃关闭”）；If FAIL, do NOT proceed to DP-7 直到用户通过 `ask_user_question` 明确选择。

After recording a PASS outcome, also record it as the verification gate so the `executing → closing` transition is allowed (the guard accepts either `test_result: pass` or a `dp_6_result` starting with `pass`): 调用 `ssf_state_write`（action: "set", changeDir: "<change-dir>", field: "test_result", value: "pass"）（CLI 等价：`ssf state set <change-dir> test_result pass --json`）。

### DP-7 (Archive Confirmation, Full/legacy Hotfix)
**必须**通过 `ask_user_question` 结构化确认归档，禁止隐式确认。Verify DP-0 through DP-6 are recorded before DP-7。示例：
```
调用 ask_user_question({questions:[{id:"dp-7-archive", header:"DP-7 归档确认", question:"已完成验证与审计，归档摘要：<archive summary>，是否确认归档并合并 delta specs？", options:[{label:"确认归档 (Recommended)", description:"确认关闭并归档"}, {label:"调整范围", description:"需要调整归档范围"}], multi_select:false}]})
```
只有当 `answers` 选中“确认归档”后，才写入 调用 `ssf_state_write`（action: "set", changeDir: "<change-dir>", field: "dp_7_result", value: "confirmed: <archive summary>"）（CLI 等价：`ssf state set <change-dir> dp_7_result "confirmed: <archive summary>" --json`）和 调用 `ssf_state_write`（action: "set", changeDir: "<change-dir>", field: "dp_7_timestamp", value: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"）（CLI 等价：`ssf state set <change-dir> dp_7_timestamp $(date -u +%Y-%m-%dT%H:%M:%SZ) --json`）并执行 transition to closing 和 ssf_finish。若选中“调整范围”，则暂停归档，返回调整范围后再重验。

## Archive Rule (Full/legacy Hotfix)

If implementation diverged from the contract, return to `bridging` before closure.

## Finalize While Executing (Full/legacy Hotfix)

Complete every release, delta-spec synchronization, and audit action while the state remains `executing`. If delta specs exist, invoke `spec-merger` and resolve its outcome before the final `executing → closing` transition. Then run 调用 `ssf_state_write`（action: "transition", changeDir: "<change-dir>", target: "closing"）（CLI 等价：`ssf state transition <change-dir> closing --json`）。
`executing → closing` is the final action: once it succeeds, select no next skill and run no recovery scans.

## Physical Archive (Full/legacy Hotfix only)

After the `executing → closing` transition succeeds, complete the physical archive with:

调用 `ssf_finish`（changeDir: "<change-dir>", testCmd: "<command>"）（CLI 等价：`ssf finish <change-dir> --test-cmd <command>`）。

`ssf finish` merges the isolation branch back to the trunk (`--no-ff`), verifies the trunk (default `npm test`, `--test-cmd` override, 10-minute timeout), then removes the worktree and the isolation branch. For submodule projects it auto-falls-back to `--force` worktree removal; if that also fails it prints the merge commit and manual cleanup commands. Quick / direct Hotfix / tweak / lightweight skip this step — their `closing` is already the physical terminal.

## Lightweight Closure (Quick/direct Hotfix/tweak)

Quick and direct Hotfix use a concise verification summary: changed files, focused command, result, and persisted `test_result: pass`. Quick runs targeted tests or syntax/static checks; direct Hotfix proves the original symptom regression. Do not require a contract, execution plan, review receipt, DP-6, or DP-7. A legacy Hotfix remains on the full contract/DP/review closure path. Tweak verifies file integrity and also persists `test_result: pass`. Closing is the physical terminal for lightweight paths — no `ssf finish` step is needed.

## Exception Handling

- **Parse failures**: Report exact file and section
- **Missing files**: If audit can't generate, run 调用 `ssf_audit`（changeDir: "<change-dir>"）（CLI 等价：`ssf audit <change-dir> --json`） manually
- **User interruption**: Re-run verification from the beginning on resume
- **DP gaps**: Flag missing DPs during DP-6; ask user whether to proceed or return

## Standard User-Facing Handoff

End every user-facing phase report with this concise handoff. Only a successfully
persisted `closing` state and `abandoned` are terminal.

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

### Closing-in-progress report

- Current stage: `executing`; release verification or archive work is still running.
- Completed / blocker: `<completed release work or remaining release blocker>`.
- Next stage: complete the remaining release or archive step, then transition to `closing` (not `none`).
- Entry condition: all release and archive work is complete and the transition succeeds.

### Successful terminal report

- Current stage: successfully persisted `closing` or `abandoned`.
- Completed / blocker: `<persisted terminal outcome>`.
- Next stage: for Full/legacy Hotfix, the physical archive via 调用 `ssf_finish`（changeDir: "<change-dir>"）（CLI 等价：`ssf finish <change-dir>`） (worktree merge + cleanup); once it succeeds, next = none. For Quick / direct Hotfix / tweak / lightweight, `none` — closing is the physical terminal.
- Entry condition: no further state transition exists.
