# Focused Re-review Prompt Template

Use this template after a wave has a current failed receipt. It narrows review
to the declared repair and preserves the normal review receipt gate.

```
Subagent (general-purpose):
  description: "Focused re-review of wave [WAVE_ID], repair round [REPAIR_ROUND]"
  model: [MODEL — REQUIRED: resolve the review profile]
  prompt: |
    You are re-reviewing a focused repair for wave [WAVE_ID].

    ## CLI repair evidence

    The controller read `ssf_execution`（changeDir: "<change-dir>"）（CLI 等价：`ssf execution show <change-dir> --json`） before this
    dispatch. The current repair status is [REPAIR_STATUS], round is
    [REPAIR_ROUND], and the prior review head is [PREVIOUS_HEAD]. Read the
    previous review report at [PREVIOUS_REVIEW_REPORT] first.

    ## Scoped diff under review

    **Base:** [PREVIOUS_HEAD]
    **Head:** [HEAD_SHA]
    **Diff file:** [SCOPED_DIFF_FILE]

    Review only this scoped diff and the prior finding. Confirm whether the
    repair resolves that finding, creates a regression, or expands beyond the
    declared repair scope. Do not re-run a broad review, modify the worktree,
    or edit receipt and repair-state files.

    Rounds 1–2 are recovery rounds. The third unresolved failure opens the
    circuit breaker. If the CLI status is `adjudication-required`, do not
    request a fourth repair;
    document the unresolved issue for human adjudication.

    ## Output

    Write a distinct non-empty review report to `[CHANGE_DIR]/.superpowers/sdd/reviews/[WAVE_ID]-rereview.md`, with the
    prior finding, scoped-diff evidence, verdict, and file:line references.
    Then provide exactly this receipt command to the controller:

    ```bash
    # 优先调用 `ssf_execution_write`（action: "review", changeDir: "<change-dir>", wave: "[WAVE_ID]", base: "[PREVIOUS_HEAD]", head: "[HEAD_SHA]", report: "[REVIEW_REPORT_FILE]", verdict: "<pass|fail>"）（CLI 等价：`ssf execution review <change-dir> --wave [WAVE_ID] --base [PREVIOUS_HEAD] --head [HEAD_SHA] --report [REVIEW_REPORT_FILE] --verdict <pass|fail>`）
    ```

    Use `fail` for any unresolved Critical or Important finding. The controller
    records receipts through the CLI; you must not directly change state files.
```

**Required placeholders:** `[MODEL]`, `[WAVE_ID]`, `[REPAIR_STATUS]`,
`[REPAIR_ROUND]`, `[PREVIOUS_HEAD]`, `[PREVIOUS_REVIEW_REPORT]`, `[HEAD_SHA]`,
`[SCOPED_DIFF_FILE]`, `[REVIEW_REPORT_FILE]`.

> 若上述 ssf_* 工具在你的环境不可用，回退到括号内备注的等价 ssf CLI（可经 ssf_run）。
