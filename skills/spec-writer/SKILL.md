---
name: spec-writer
description: Create or refine spec-superflow planning artifacts. Invoke when the change is understood well enough to write proposal.md, specs/, design.md, and tasks.md.
---

> **Tool-first rule (`dsh-ssf` plugin):** when this skill instructs running a
> CLI command through `ssf`, prefer the matching native `ssf_*` tool (e.g.
> `ssf_state`, `ssf_validate`, `ssf_run`) when the `dsh-ssf` plugin is loaded;
> fall back to executing the exact same command via the `ssf` CLI only when
> the native tools are unavailable. Commands, arguments, and output handling
> stay identical on both paths.

# Spec Writer

Create or refine planning artifacts when the change has moved beyond exploration.

## Required Inputs

Read `.spec-superflow.yaml` (especially `dp_0_decisions`, `dp_0_confirmed`) and any existing planning artifacts. If `dp_0_confirmed` is not `true`, stop and route back to `workflow-start` for DP-0.

## Config Check

Run: `ssf runtime config --get artifacts.order` — generate in configured order (default: proposal → specs → design → tasks). Run with `artifacts.skip` — skip any listed artifacts.

## Artifact Roles

- `proposal.md`: why and scope
- `specs/`: required behavior (testable)
- `design.md`: architecture decisions and trade-offs (not line-by-line)
- `tasks.md`: dependency-aware implementation steps

## Task Right-Sizing

A task is the smallest unit that carries its own test cycle and is worth a fresh reviewer's gate. When drawing task boundaries: fold setup, configuration, scaffolding, and documentation steps into the task whose deliverable needs them; split only where a reviewer could meaningfully reject one task while approving its neighbor. Each task ends with an independently testable deliverable.

## Working Rules

**Honor DP-0**: Read `dp_0_decisions`, respect confirmed constraints, don't silently expand scope. Pause on unconfirmed decisions.

### proposal.md
Must state: observed problem, what changes, in/out scope, impact areas, and proof of completion. Prefer concrete facts over empty adjectives such as “better”, “robust”, or “efficient”.

### specs/
Every requirement must be testable. Use SHALL or MUST. Every requirement must have at least one `#### Scenario:` with WHEN/THEN. Group under ADDED/MODIFIED/REMOVED Requirements headers.

### design.md
Must have: relevant facts and constraints, goals and non-goals, decisions (Choice + Rationale + Alternatives + Consequences), and risks with verification evidence. Do not invent stakeholders, migration steps, or open questions when they do not affect the decision.

### tasks.md
Must include a delivery/proof map and dependency-aware tasks. Each task names the affected path or bounded area, the observable outcome, and the evidence command. Keep RED/GREEN details, review receipts, and dispatch mechanics in the execution contract/task brief; do not inflate reader-facing tasks into five ritual substeps.

### No Placeholders

Every task step must contain the actual content an implementer needs. These are **plan failures** — never write them:
- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" (without actual test code)
- "Similar to Task N" (repeat the code — the implementer may be reading tasks out of order)
- Steps that describe what to do without showing how (code blocks required for code steps)
- References to types, functions, or methods not defined in any task

## Artifact Generation

When DP-0 has made the scope clear, generate the configured planning pack (proposal, delta specs from `templates/spec.md`, design, and tasks) in order without pausing between individual artifacts. Validate the pack, then request one DP-2 review. Pause earlier only when the missing decision can change user-visible behavior, compatibility, security, delivery scope, or the selected design; or when artifacts state incompatible scope.

## Validation Checklist

### proposal.md
- `## Why` > 50 chars, `## What Changes`, `## Scope` (In/Out), `## Impact`, no TBD/TODO; claims name an observed problem and a completion proof

### specs/
- SHALL/MUST for required behavior, `#### Scenario:` with WHEN/THEN per requirement, grouped under delta headers, no contradictions

### design.md
- facts/constraints, goals/non-goals, `## Decisions` (≥1, with Choice+Rationale+Alternatives+Consequences), risks and verification

### tasks.md
- delivery/proof map, numbered tasks, affected paths or bounded areas, observable outcomes, no placeholders, every requirement mapped, explicit dependencies
- Must use the template checkbox format (one `- [ ]` per task on its own line); the guard enforces this format when entering execution

### Self-Review Process

After writing all artifacts, look at them with fresh eyes and check the contract against the spec. This is a review you run yourself — not a subagent dispatch.

**1. Spec coverage:** Skim each requirement in specs/. Can you point to a task that implements it? List any gaps.

**2. Placeholder scan:** Search your artifacts for red flags — any TBD, TODO, "figure out", "add appropriate", "implement later", "fill in details", "handle edge cases", steps that describe what to do without showing how. Fix them.

**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.

**4. Interface integrity:** Do cross-batch Consumes/Produces match? If Task 2 Produces `getUser(id: string): User`, does Task 5 Consume the exact same signature?

If you find issues, fix them inline. No need to re-review — just fix and move on. If you find a spec requirement with no task, add the task.

**If any artifact fails validation, fix before handing off to contract-builder.**

## DP-2: Artifact Review Gate

Present a concise summary of all 4 artifacts, then ask one DP-2 question for material adjustments. For Full changes, run one independent five-question blind reader check (problem, command boundary, invalidation boundary, continuation boundary, and document flow) before recording approval; repair only answers the reader cannot derive. After approval:
```bash
ssf state set <change-dir> dp_2_result "approved: <summary>"
ssf state set <change-dir> dp_2_timestamp $(date -u +%Y-%m-%dT%H:%M:%SZ)
```

After the artifacts are done and DP-2 is recorded, advance the state:
```bash
ssf state transition <change-dir> specifying
```

## Handoff Rule

Do not start implementation after writing planning artifacts. Once stable, validated, and DP-2 is recorded, hand off to `contract-builder`.

## Exception Handling

- **Parse failures**: Report specific file/error; don't generate from corrupted templates
- **Missing templates**: Fall back to artifact structure defined in this skill
- **User interruption**: Artifacts on disk are the recovery checkpoint; resume from first missing/incomplete one
- **Validation failure**: Fix before handoff — do not hand off broken artifacts

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
