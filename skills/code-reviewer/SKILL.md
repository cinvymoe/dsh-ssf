---
name: code-reviewer
description: Review completed implementation batches for spec compliance and code quality. Invoke after execution batches complete, before merging, or when a review gate is reached in the workflow.
---

> **Tool-first rule (`dsh-ssf` plugin):** 所有 ssf 操作优先调用 `ssf_*` 原生工具（含写工具）；仅当工具不存在或调用失败时才回退到等价 `ssf` CLI（可经 `ssf_run`）。

# Code Reviewer

Two responsibilities: requesting review (dispatching a reviewer subagent) and receiving review (acting on feedback with technical rigor). **Review early, review often. Verify before implementing feedback.**

## Part 1: Requesting Review

**Mandatory after**: each task in SDD, each planned execution wave, each major feature, before merge.
**Optional**: when stuck, before refactoring, after fixing complex bugs.

### Procedure
1. Get SHAs: `BASE_SHA=$(git rev-parse HEAD~1)` and `HEAD_SHA=$(git rev-parse HEAD)`
2. Dispatch `general-purpose` subagent using template at `skills/code-reviewer/code-reviewer-prompt.md`
3. Fill placeholders: `[DESCRIPTION]` (what was built), `[PLAN_OR_REQUIREMENTS]` (contract/spec reference), `[BASE_SHA]`, `[HEAD_SHA]`, `[WAVE_ID]`, and a distinct `[REVIEW_REPORT_FILE]`.
4. Require the reviewer to write a non-empty persisted review report at `.superpowers/sdd/reviews/<wave-id>.md`, then record that exact in-overlay path in the wave receipt with 调用 `ssf_execution_write`（action: "review", changeDir: "<change-dir>", wave: "<wave-id>", base: "<base-sha>", head: "<head-sha>", report: ".superpowers/sdd/reviews/<wave-id>.md", verdict: "<pass|fail>"）（CLI 等价：`ssf execution review <change-dir> --wave <wave-id> --base <base-sha> --head <head-sha> --report .superpowers/sdd/reviews/<wave-id>.md --verdict <pass|fail> --json`）。 The execution plan initializes this directory; paths outside it are rejected for audit safety.
5. Act on feedback: Critical/Important findings require a `fail` receipt, focused repair, re-review, and replacement `pass` receipt before a dependent wave or closing can proceed. Note Minor for later, push back with reasoning if reviewer is wrong.

### Minimality And Scope

For unrequested complexity, cite the missing task requirement and diff line.
Use Important for merge-blocking complexity and Minor for safe,
behavior-neutral redundancy; never score by line count.

## Part 2: Receiving Review Feedback

### The Response Pattern
1. READ feedback without reacting
2. UNDERSTAND and restate requirement
3. VERIFY against codebase reality
4. EVALUATE: technically sound for THIS codebase?
5. RESPOND: technical acknowledgment or reasoned pushback
6. IMPLEMENT: one item at a time, test each

### Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| Critical | Bugs, security, data loss, broken functionality | Fix immediately |
| Important | Architecture problems, missing features, poor error handling, test gaps | Fix before next batch |
| Minor | Code style, optimization, documentation polish | Note for later |

### Forbidden Responses
Never: performative agreement ("You're right!", "Great point!"), blind implementation before verification, thanking the reviewer. Instead: restate the requirement, ask clarifying questions, push back with reasoning, or just fix it (actions > words).

### Handling Unclear Feedback
If any item is unclear → STOP. Do not implement anything yet. Ask for clarification on unclear items. Partial understanding = wrong implementation.

### Source-Specific Rules

**From user**: Trusted — implement after understanding. Still ask if scope unclear. No performative agreement.

**From external reviewer**: Before implementing, check: technically correct for this codebase? breaks existing functionality? reason for current implementation? works on all platforms? reviewer understands full context? If suggestion seems wrong, push back with technical reasoning.

### When to Push Back
Suggestion breaks existing functionality, reviewer lacks context, violates YAGNI, technically incorrect for this stack, legacy/compatibility reasons, conflicts with user's architectural decisions. Push back with technical reasoning, not defensiveness.

### YAGNI Check for "Professional" Features

If a reviewer suggests "implementing properly" or adding features not in the contract:
1. grep the codebase for actual usage of the suggested feature
2. If unused: "This isn't called. Remove it (YAGNI)?"
3. If used: Then implement properly

The contract's scope fence is the authority. The reviewer and you both report to the user — if the feature isn't needed, don't add it.

### Acknowledging Correct Feedback

When feedback IS correct:
```
✅ "Fixed. [Brief description of what changed]"
✅ "Good catch - [specific issue]. Fixed in [location]."
✅ [Just fix it and show in the code]

❌ "You're absolutely right!"
❌ "Great point!"
❌ "Thanks for catching that!"
❌ "Thanks for [anything]"
❌ ANY gratitude expression
```

Why no thanks: Actions speak. Just fix it. The code itself shows you heard the feedback.

If you catch yourself about to write "Thanks": DELETE IT. State the fix instead.

### Gracefully Correcting Your Pushback

If you pushed back and were wrong:
```
✅ "You were right - I checked [X] and it does [Y]. Implementing now."
✅ "Verified this and you're correct. My initial understanding was wrong because [reason]. Fixing."

❌ Long apology
❌ Defending why you pushed back
❌ Over-explaining
```

State the correction factually and move on.

## Real Examples

**Performative Agreement (Bad):**
```
Reviewer: "Remove legacy code"
❌ "You're absolutely right! Let me remove that..."
```

**Technical Verification (Good):**
```
Reviewer: "Remove legacy code"
✅ "Checking... build target is 10.15+, this API needs 13+. Need legacy for backward compat. Current impl has wrong bundle ID - fix it or drop pre-13 support?"
```

**YAGNI (Good):**
```
Reviewer: "Implement proper metrics tracking with database, date filters, CSV export"
✅ "Grepped codebase - nothing calls this endpoint. Remove it (YAGNI)? Or is there usage I'm missing?"
```

**Unclear Item (Good):**
```
User: "Fix items 1-6"
You understand 1,2,3,6. Unclear on 4,5.
✅ "Understand 1,2,3,6. Need clarification on 4 and 5 before implementing."
```

## GitHub Thread Replies

When replying to inline review comments on GitHub, reply in the comment thread (`gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies`), not as a top-level PR comment.

### Implementation Order
1. Clarify unclear items first
2. Fix blocking issues (breaks, security)
3. Fix simple issues (typos, imports)
4. Fix complex issues (refactoring, logic)
5. Test each fix individually, verify no regressions

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Performative agreement | State requirement or just act |
| Blind implementation | Verify against codebase first |
| Batch without testing | One at a time, test each |
| Proceeding without a wave receipt | Record `pass`/`fail` via 调用 `ssf_execution_write`（action: "review", changeDir: "<change-dir>", wave: "<wave-id>", base: "<base-sha>", head: "<head-sha>", report: "<report>", verdict: "<pass|fail>"）（CLI 等价：`ssf execution review <change-dir> --wave <wave-id> --base <base-sha> --head <head-sha> --report <report> --verdict <pass|fail> --json`） before the next dependent wave |
| Assuming reviewer is right | Check if breaks things |
| Avoiding pushback | Technical correctness > comfort |
| Partial implementation | Clarify all items first |
| Can't verify, proceed anyway | State limitation, ask for direction |

## Exception Handling

- **Parse failures**: Report specific file, request regenerated review package
- **Missing files**: Regenerate via `scripts/review-package`. Empty diff = nothing to review
- **User interruption**: Re-read review report on resume, continue from next unreviewed batch

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

### Successful terminal report

- Current stage: successfully persisted `closing` or `abandoned`.
- Completed / blocker: `<persisted terminal outcome>`.
- Next stage: `none`.
- Entry condition: no further transition exists.
