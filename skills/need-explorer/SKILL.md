---
name: need-explorer
description: Clarify intent, scope, constraints, and success criteria before artifact creation. Invoke when the request is fuzzy, the user is comparing options, or the workflow needs a stable change definition before writing artifacts.
---

# Need Explorer

Turn a rough idea into a stable change definition before writing artifacts.

## Primary Goal

Agree on: problem, scope, non-goals, success criteria, whether to split before specification.

## Process

### 1. Inspect Context First

Before asking questions, understand what exists and what constraints are in place. This is the initial pass; fact-finding that emerges during questioning (§2.5) is equally your job.

### 2. Questioning Strategy: Single Question vs Frontier Rounds

Default: ask a single clear question, wait for the answer, digest, then ask the next. Each answer informs the next question. Use this while the change is still fuzzy and every answer reshapes what to ask next.

When you have identified 3+ independent open decisions whose answers do not depend on each other, switch to **frontier rounds**: map the open decisions as a tree, identify the frontier — every decision whose prerequisites are already settled — and ask the whole frontier in one round. Number each question and give your recommended answer. A question whose answer depends on another still-open question belongs to a later round, never the current one. Recompute the frontier after each round of answers.

Never batch questions with hidden dependencies, and never batch while the problem itself is still undefined.

### 2.5. Fact-Finding: Your Job, Never the User's

Finding facts is your job, never the user's. When a question needs a fact from the environment (codebase, config, docs, tools), look it up yourself or dispatch a read-only subagent (no code changes, no implementation actions — the HARD-GATE below still applies). Do not ask the user for anything you could find out yourself. Only decisions belong to the user.

A fact not yet gathered is an unsettled prerequisite: only the questions downstream of it wait. Ask the rest of the frontier now, gather the missing fact before the next round, and incorporate gathered facts into the next round's questions.

### 3. Prefer Multiple-Choice Questions

Present 2-3 options when reasonable answers are finite. This reduces cognitive load and surfaces unconsidered choices.

### 4. Propose 2-3 Approaches with Trade-Offs

For each approach: what it is, upside, downside, best-for. Then **recommend one** and explain why. Never present a single path — always name at least one alternative.

### 5. Validate Before Concluding

Restate what you heard: "Here's what I'm hearing: [problem, scope, non-goals, success criteria, and any specific decisions made during exploration]. Does this match?" Incorporate corrections and re-validate.

### 5.5. Scope Decomposition

Before concluding, assess scope: if the request describes multiple independent subsystems (e.g., "build a platform with chat, file storage, billing, and analytics"), flag this immediately. Don't spend questions refining details of a project that needs to be decomposed first.

If the change is too large for a single spec, help the user decompose into sub-changes: what are the independent pieces, how do they relate, what order should they be built? Then explore the first sub-change through the normal flow. Each sub-change gets its own spec → contract → execution cycle.

For appropriately-scoped changes, proceed to DP-1.

### 6. DP-1: Requirement Confirmation Gate

After user confirms the summary:
```bash
ssf state set <change-dir> dp_1_result "confirmed: <one-line summary>"
ssf state set <change-dir> dp_1_timestamp $(date -u +%Y-%m-%dT%H:%M:%SZ)
```
DP-1 confirms scope, non-goals, and success criteria before artifact creation.

### 7. Hand Off

Once DP-1 is recorded, hand off to `spec-writer`.

## Anti-Patterns

- **"This is too simple to need exploration"**: Every change goes through this process. A config change, a single-function fix, a label rename — all of them. "Simple" changes are where unexamined assumptions cause the most wasted work. The exploration can be short (a few sentences for truly simple changes), but you MUST go through it and get DP-1 recorded.
- **Skipping exploration**: "Simple" changes have scope too. Five minutes of exploration prevents two hours of rework.
- **Proposing solutions before clarifying**: If the user says "add caching," first ask what problem caching solves.
- **Asking the user for facts**: If a question can be answered by reading the codebase, running a tool, or dispatching a read-only subagent, do it yourself instead of asking the user. Ask the user only for decisions.
- **Batching dependent questions**: Frontier rounds batch only independent questions. A question that depends on an unsettled answer waits for a later round.
- **Exploring indefinitely**: Stop when change name, problem statement, scope, non-goals, success criteria, and decomposition decision are all clear.

## Design for Isolation and Clarity

Break the system into smaller units that each have one clear purpose, communicate through well-defined interfaces, and can be understood and tested independently.

For each unit, you should be able to answer: what does it do, how do you use it, and what does it depend on?

Can someone understand what a unit does without reading its internals? Can you change the internals without breaking consumers? If not, the boundaries need work.

Smaller, well-bounded units are also easier for implementation — an implementer reasons better about code it can hold in context at once, and edits are more reliable when files are focused. When a file grows large, that's often a signal that it's doing too much.

## Working in Existing Codebases

Explore the current structure before proposing changes. Follow existing patterns.

Where existing code has problems that affect the work (e.g., a file that's grown too large, unclear boundaries, tangled responsibilities), include targeted improvements as part of the scope — the way a good developer improves code they're working in.

Don't propose unrelated refactoring. Stay focused on what serves the current goal.

## Exploration Standard

You must leave exploration with: a usable change name, a crisp problem statement, scope boundaries, non-goals, success criteria, and a decomposition decision (one change or split).

## Strong Rule

<HARD-GATE>
Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until DP-1 is recorded and the design has been approved. This applies to EVERY change regardless of perceived simplicity.
</HARD-GATE>

Do not produce implementation code. This skill stabilizes intent, not builds.

## Self-Review Before Handoff

1. **Placeholder scan**: No "probably", "maybe", "TBD", or "we'll figure it out later"
2. **Contradiction check**: No scope items conflicting with non-goals or constraints
3. **Scope check**: Can a developer draw a bright line between in and out?
4. **Ambiguity check**: Could any requirement be interpreted two different ways? If so, pick one and make it explicit.
5. **Fact check**: No open question could have been answered by inspecting the environment instead of asking the user.

## Exception Handling

- **Parse failures**: Report the specific file, proceed with available information
- **Missing files**: Note absent essential files as constraints, continue
- **User interruption**: Exploration is stateless — on resume, re-ask the current question

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
