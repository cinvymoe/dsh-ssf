<h1 align="center">dsh-ssf</h1>

<p align="center">
  <strong>An AI coding workflow that uses lightweight or full controls based on change risk</strong>
</p>

<p align="center">
  <a href="../LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://github.com/cinvymoe/dsh-ssf/stargazers"><img src="https://img.shields.io/github/stars/cinvymoe/dsh-ssf" alt="GitHub Stars"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> |
  <a href="#installation">Installation</a> |
  <a href="#why">Why</a> |
  <a href="#relationship-with-upstream">Relationship with Upstream</a> |
  <a href="#core-skills">Core Skills</a> |
  <a href="#workflow">Workflow</a> |
  <a href="#faq">FAQ</a> |
  <a href="../README.md">中文</a>
</p>

---

## Quick Start

Once installed, just tell your agent:

```
use workflow-start to begin
```

The agent inspects your current artifacts, performs **content-level detection** (comparing proposal scope vs. contract intent lock, not just file timestamps), determines your workflow stage, and routes to the correct next skill.

- New change → `use workflow-start to begin`
- Resume work → `continue the workflow`
- Unsure → `check what state we're in`

## Installation

This repository provides **only two installation paths**: the DSH plugin (recommended, full workflow experience) and the CLI toolchain (generic commands). Platform adapters for other IDEs/agents have been removed.

### DeepSeek Harness (dsh-ssf plugin)

This project plugs into DSH (DeepSeek Harness) web profiles as the `dsh-ssf` plugin. It is split into two halves that work together:

- **Host half** (`packages/dsh-ssf`): registers 19 structured tools on Cordis (`ctx.tools`) — 6 read + 12 write + `dsh-ssf_run` fallback — and runs a `dsh-ssf` service with a snapshot store. The service exposes `scan()` / `summary(changeDir)` / `refresh()` / `getSnapshot()` over `changes/`, persists `{ changes, workspaces, scannedAt }` to a standalone file (`$DSH_HOME/dsh-ssf.json` by default, overridable via `config.path` / `config.dshHome`, created with `0700`/`0600` and written atomically), and serves it via `GET /dsh-ssf/snapshot` (`Cache-Control: no-store`) through `ctx.webServer`. Skills prefer the native `dsh-ssf_*` tools and fall back to the `dsh-ssf` CLI.

- **Client half**: adds a read-only **Spec Workflow** conversation tab (id `dsh-ssf`, order 20) to the web profile. It polls `GET /dsh-ssf/snapshot` every 3s (plus `visibilitychange`), filters to the current session's workspace, lists changes (name / state / workflow, terminal changes last), and shows detail on click (DP decisions, last transition, degradation markers).

> Full install / enable / verify / uninstall steps are in [`packages/dsh-ssf/README.md`](../packages/dsh-ssf/README.md) — including `dsh plugin --profile web add`, the profile patch `cordis.patch.yml` (`- id: dsh-ssf / name: dsh-ssf`), `dsh --profile web` restart, and snapshot verification (`cat ~/.dsh/dsh-ssf.json` and `GET /dsh-ssf/snapshot`).

### CLI Toolchain

The CLI keeps the generic commands shared with the upstream, with no platform-specific `install-*` / `uninstall-*`:

```bash
npm install -g dsh-ssf    # global install
npx dsh-ssf list          # or via npx
```

| Command | Purpose |
|---------|---------|
| `dsh-ssf list` | List all changes and status |
| `dsh-ssf validate <dir>` | Validate artifact completeness |
| `dsh-ssf doctor` | Health check (versions, hooks, skills, docs) |
| `dsh-ssf version <semver>` | Sync version across all manifests |
| `dsh-ssf state <sub> <dir>` | Manage `.spec-superflow.yaml` state file |
| `dsh-ssf inject <dir>` | Generate phase-guard artifacts |
| `dsh-ssf audit <dir>` | Generate decision-point audit report |
| `dsh-ssf checkpoint save <dir> --task <id> --next <text>` | Save a task-level recovery checkpoint |
| `dsh-ssf checkpoint list <dir>` | List checkpoints and stale status |
| `dsh-ssf checkpoint show <dir> <id>` | Show one recovery checkpoint |
| `dsh-ssf resume [change]` | Read-only recovery summary; auto-selects the only active change |
| `dsh-ssf switch <change>` | Read-only recovery context for an explicit change |
| `dsh-ssf save <change> --task <id> --next <text>` | Manually reuses the existing checkpoint protocol; never commits/pushes/syncs |
| `dsh-ssf handoff create <dir> --type <type> ...` | Create a prototype/research/experiment handoff |
| `dsh-ssf handoff list <dir>` | List handoff lifecycle status |
| `dsh-ssf handoff finish <dir> <id>` | Validate a handoff result |
| `dsh-ssf handoff resolve <dir> <id> --decision <decision>` | Record an explicit handoff decision |
| `dsh-ssf isolate <dir>` | Enforce git isolation before implementation: worktree or branch on main/master |
| `dsh-ssf finish <dir> [--test-cmd <command>]` | One-command close-out: merge --no-ff, verify sync, run verification command, clean worktree |
| `dsh-ssf execution recommend <dir> ...` | List available execution modes and recommendation |
| `dsh-ssf execution plan <dir> ...` | Save a guarded execution plan |
| `dsh-ssf execution show <dir> [--json]` | Show and verify current execution plan and receipts |
| `dsh-ssf execution revise <dir> ...` | Retain/upgrade plan to SDD, new revision; downgrades rejected |
| `dsh-ssf execution review <dir> ...` | Record a review receipt for a wave |
| `dsh-ssf execution adjudicate <dir> ...` | Authorize one review for an `adjudication-required` wave |
| `dsh-ssf sync <dir>` | Publish delta specs to baseline specs |
| `dsh-ssf config --resolve-model <profile>` | Resolve a model profile (read-only, no API call) |

> Note: code-level bin/tool/snapshot names still keep ssf aliases for compatibility; docs use dsh-ssf uniformly.

### Version

- Current: `v1.2.0`
- Self-contained — no OpenSpec or Superpowers runtime required
- Upstream: [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec), [obra/superpowers](https://github.com/obra/superpowers)
- Changelog: [CHANGELOG.md](../CHANGELOG.md)

Canonical requirement heading is `### Requirement: name`. For existing Chinese artifacts the parser also accepts `### 需求：name` and `### REQ-<ID>: name`. Canonical delta specs live at `specs/<capability>/spec.md`; flat `specs/<capability>.md` and root `specs/spec.md` are not canonical. `dsh-ssf sync` validates every delta before publishing.

### Active specs and published baselines

An active workflow's single source of truth is `changes/<change>/` with auditable delta specs. Root `specs/` is the published baseline and never drives active transitions. `dsh-ssf sync changes/<change>` applies ADDED/MODIFIED/REMOVED/RENAMED to the baseline and writes a recomputable publication receipt. Closing verifies both; editing either after sync requires another sync.

### Plugin repository versus consuming project

This repository ships workflow, templates, scripts, tests, and docs — not the runtime output of a real change. It does not commit `changes/<change>/`, `.spec-superflow.yaml`, `.superpowers/`, or root `specs/` generated by `dsh-ssf sync` (ignored by default). Curated `docs/examples/` holds sanitized fixtures. In a consuming project, `changes/<change>/specs/` remains the active input and root `specs/` remains an optional baseline.

---

## Why

AI coding sessions commonly fail in two ways:

- **The AI starts coding before you've decided what to build.** You say "add authorization" and it touches 40 files before you realize — RBAC or ABAC?

- **The plan is solid, but execution drifts.** The proposal, specs, and design are written, but nobody enforces testing, nobody gates reviews, and by merge time the behavior doesn't match.

dsh-ssf handles these cases differently: it first assesses change risk; small changes stay within a clear boundary and verification step, while complex changes use intent, specs, an execution contract, implementation, and review.

| Principle | Meaning |
|---|---|
| Choose the path first | Select Quick, Hotfix, Tweak, or Full from scope and risk |
| Align complex work | Full uses specs and an execution contract to agree scope and acceptance |
| Verify implementation | Every path requires tests or checks proportionate to risk |
| Diagnose before changing | Reproduce and locate failures before attempting a fix |
| Self-contained | No OpenSpec or Superpowers runtime is required |

### When to Use

**Recommended:** Large features, multi-person collaboration, long-term maintenance, brownfield projects needing TDD + review gates.

**Skip:** One-off scripts, pure Q&A conversations.

> **Four workflow modes:** Quick (≤3 low-risk code files/tasks), direct Hotfix (incident, ≤2), and Tweak (≤4 config/docs files) execute with bounded verification; Full and legacy Hotfix retain planning, contracts, and reviews for complex work.

---

## Relationship with Upstream

This repository is not a competing fork of the original project, but its **DSH-native distribution** — same core, DSH-only carrier.

**1. Origin.** The original project is [MageByte-Zero/spec-superflow](https://github.com/MageByte-Zero/spec-superflow) (now migrated to [cinvymoe/dsh-ssf](https://github.com/cinvymoe/dsh-ssf)). It is a **source-level fusion** of [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) (planning engine: Schema validation, Delta Spec, artifact parsing) and [obra/superpowers](https://github.com/obra/superpowers) (execution discipline: TDD Iron Law, SDD subagent-driven development, systematic debugging and code review) — not a side-by-side install. It adds a unique `contract-builder` bridge that auto-extracts and compresses the four planning artifacts (`proposal / specs / design / tasks`) into `execution-contract.md`, and runs an **8-state router** (`exploring → specifying → bridging → approved-for-build → executing → closing`, plus `debugging` side-track and `abandoned` terminal) throughout the workflow. Self-contained with zero runtime dependencies — no upstream runtimes needed.

**2. What this distribution does.** This repo strips the original's adapter code for **19 platforms** (Claude Code, Cursor, OpenAI Codex, GitHub Copilot, Gemini, OpenCode, WorkBuddy, Trae, and others — hooks, plugin manifests, installers, platform-specific rules and marketplace configs) and **keeps and strengthens only the DSH (DeepSeek Harness) path**: host half via `packages/dsh-ssf` native tools `dsh-ssf_*` + change-status snapshot service on Cordis (`ctx.tools` / `ctx.webServer` / `snapshot-store` with `$DSH_HOME/dsh-ssf.json` and `GET /dsh-ssf/snapshot`), client half via the read-only Spec Workflow tab in the web profile. The DSH section above is the single source of truth and points to [`packages/dsh-ssf/README.md`](../packages/dsh-ssf/README.md); the multi-platform matrix and install commands are no longer maintained in README or INSTALL.

**3. What stays the same and sync strategy.** The core workflow is **unchanged** from upstream: 9 skills, 8-state machine, parsing/validation engine (`src/schema` / `src/parsing` / `src/validation`), templates (`templates/`), CLI core (`scripts/`), and the guard system are identical. The DSH plugin is only a **carrier difference** (structured tools and snapshot service replacing platform hooks). Upstream sync strategy: `core` / `skills` / `src` / `templates` / `docs` continue to sync with upstream; the platform adapter layer **remains DSH-only** and will not re-merge other platforms.

**4. Acknowledgement & rebrand.** Thanks to the original project MageByte-Zero/spec-superflow for the complete design and implementation, and to OpenSpec and Superpowers for the engine and discipline ideas. This repository has been rebranded at `v1.2.0`; `package.json` `name` remains `spec-superflow` for `dsh-ssf` / `spec-superflow` CLI compatibility, and the GitHub repository is [`cinvymoe/dsh-ssf`](https://github.com/cinvymoe/dsh-ssf).

---

## Core Skills

| # | Skill | Stage | Purpose |
|---|-------|-------|---------|
| 1 | `workflow-start` | Entry | Content-level state detection, 8-state routing, blocks illegal transitions |
| 2 | `need-explorer` | Exploring | One question at a time, approach comparison, recommendation |
| 3 | `spec-writer` | Specifying | Generate proposal/specs/design/tasks with Schema engine validation |
| 4 | `contract-builder` | Bridging | Parse 4 artifacts → compress into execution-contract.md |
| 5 | `build-executor` | Executing | TDD Iron Law + SDD subagent-driven + Review Gates |
| 6 | `bug-investigator` | Debugging | 4-phase root cause analysis; 3+ failures → escalate |
| 7 | `code-reviewer` | Review | Structured review with 3-level severity classification |
| 8 | `release-archivist` | Pre-closing within executing | Verification-before-completion + archive + risk summary |
| 9 | `spec-merger` | Pre-closing within executing | Delta spec → main spec merge with conflict detection |

---

## Workflow

```text
You: "add authorization to the API"
       │
       ▼
   workflow-start     ← Single entry. Content-level detection, routes to correct skill
       │
       ▼
   exploring          need-explorer: "RBAC or ABAC? What granularity?"
       ▼
   specifying         spec-writer generates 4 artifacts + Schema validation
       ▼
   bridging           contract-builder auto-extracts → execution-contract.md
       │
  ◇ User Approval ◇   ← The only human gate
       │
       ▼
   executing          build-executor: TDD → SDD → Review Gate
       │
       ├──[bug]──→ debugging  → bug-investigator
       │
       ▼
   pre-closing (a wrap-up step within executing, not a ninth state)
       │ release-archivist verifies → spec-merger sync → archive confirmation
       ▼
   closing            CLOSED successful terminal state (no next skill)
```

**Path selection:** Quick, direct Hotfix, and Tweak remain lightweight: record the boundary and verification only. Full and legacy Hotfix require an execution contract, execution plan, and review receipt. Risks are explained for the user to choose from; they do not silently upgrade a path.

**DP-5 debugging gate:** Record every failed fix with `dsh-ssf debug attempt record` and distinct, verifiable evidence. Every workflow path must have a current, valid execution plan before recording an attempt. Wave Review failures do not count as debugging attempts. DP-5 is persisted only after at least three failed attempts in that plan context and an explicit `dsh-ssf debug escalate ... --confirm`.

### Guarded execution plans

For Full/legacy Hotfix, DP-4 is a persisted, current execution plan at `<change>/.superpowers/sdd/execution-plan.json`. Run `dsh-ssf execution recommend` first — it lists `inline`, `batch-inline`, and `sdd` with auditable reasons and saves a receipt at `<change>/.superpowers/sdd/execution-recommendation.json`. The agent presents the recommendation and the user confirms with `--confirm`; `plan` and `revise` require a receipt matching current artifacts and waves. A non-recommended choice also requires `--acknowledge-recommendation`.

```bash
dsh-ssf execution recommend changes/my-change \
  --wave foundation:parallel:1.1,1.2 \
  --wave integration:serial:2.1:foundation --json
dsh-ssf execution plan changes/my-change --mode sdd --confirm --reason "independent work" \
  --wave foundation:parallel:1.1,1.2 \
  --wave integration:serial:2.1:foundation
dsh-ssf execution show changes/my-change --json
dsh-ssf execution review changes/my-change --wave foundation --base <sha> --head <sha> \
  --report .superpowers/sdd/reviews/foundation.md --verdict pass
```

The `--report` path is resolved relative to `<change>` and must remain under `<change>/.superpowers/sdd/reviews/`. Every planned wave needs a current `pass` receipt before dependents or closing may proceed; revising a plan invalidates earlier receipts.

### Fast Paths (Quick / Hotfix / Tweak)

- **Quick** — ≤3 single-module code files/tasks → direct acceptance when low risk; for PRD, Spec/Design, API, data/permission, or cross-module impact, show the risk and let the user choose Quick or Full.
- **direct Hotfix** — incident, ≤2 files/tasks → direct path plus original-symptom regression.
- **legacy Hotfix** — no direct receipt → minimal contract, DP-3, execution plan, and review remain required.
- **tweak** — ≤4 files, config/docs only → skip planning + bridging, direct edit

---

## FAQ

<details>
<summary><strong>How is this different from OpenSpec or Superpowers?</strong></summary>

dsh-ssf is a source-level fusion, not side-by-side installation. It absorbs OpenSpec's Schema/validation/parsing engine and Superpowers' TDD/SDD/debugging/review discipline, while adding a unique contract-builder bridge layer and 8-state routing. Self-contained — no upstream runtimes needed.

</details>

<details>
<summary><strong>How does dsh-ssf relate to the original spec-superflow?</strong></summary>

It is not a competing fork but a **DSH-native distribution** of the original. The original [MageByte-Zero/spec-superflow](https://github.com/MageByte-Zero/spec-superflow) (now [cinvymoe/dsh-ssf](https://github.com/cinvymoe/dsh-ssf)) targeted 19 platforms; this repo strips all non-DSH adapters and keeps only the DSH host (19 `dsh-ssf_*` tools + snapshot via Cordis, `$DSH_HOME/dsh-ssf.json` served at `GET /dsh-ssf/snapshot`) and the client Spec tab. Core workflow (9 skills, state machine, parsers, templates, CLI core) is unchanged and continues to sync with upstream; the platform layer stays DSH-only. `package.json` remains `dsh-ssf` for CLI compatibility, rebranded at `v1.2.0` to `cinvymoe/dsh-ssf`.

</details>

<details>
<summary><strong>Can I use this alongside existing OpenSpec or Superpowers?</strong></summary>

Not recommended in the same session. Projects with existing OpenSpec artifacts can be adopted directly — `contract-builder` reads your existing proposal/specs/design/tasks to generate the execution contract.

</details>

<details>
<summary><strong>How does the execution contract detect staleness?</strong></summary>

Content-level detection, not timestamps: proposal scope changed, approved spec behavior changed, design constraints changed, or task batches changed → contract marked stale → route back to `contract-builder`.

</details>

<details>
<summary><strong>How does SDD (Subagent-Driven Development) work?</strong></summary>

For Full/legacy Hotfix, `dsh-ssf execution recommend` first presents Inline, Batch Inline, and SDD with evidence from the change, then recommends one. The user confirms a selection with `--confirm`. The saved execution plan at `<change>/.superpowers/sdd/execution-plan.json` names waves, dependencies, and strategies before dispatching implementers. Each wave gets a review report and a `pass`/`fail` receipt. Batch Inline remains serial.

</details>

---

**Star the repo — find it when you need it.**
