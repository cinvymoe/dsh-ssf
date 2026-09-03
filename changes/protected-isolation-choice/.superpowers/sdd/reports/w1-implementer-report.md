# Wave 1 Implementer Report — w1-ensure-branch-gate

## Wave Info
- **Wave ID**: `w1-ensure-branch-gate`
- **Strategy**: `serial`
- **Tasks**: 1.1 (`scripts/ensure-branch.mjs` 门禁 + --confirm/--force 语义) + 1.2 (`tests/lib/ensure-branch.test.mjs` 两阶段重写与扩展)
- **Base SHA**: `54d8fb64cffd0e41c4706c1f52b12f5e75cdfccb` (short `54d8fb6`)
- **Head SHA**: `7d9b93a35eb7593e20f79d469061b87f573dc03d` (short `7d9b93a`)
- **Worktree**: `/mnt/sdb1/opencode-plug/spec-superflow/changes/worktrees/protected-isolation-choice` (branch `protected-isolation-choice`)
- **Date**: 2026-08-30

## What Was Implemented

### 1.1 `scripts/ensure-branch.mjs`
- 解析 `const confirm = process.argv.includes('--confirm');`
- usage 更新为 `Usage: node ensure-branch.mjs <change-dir> [change-name] [--isolate] [--force] [--confirm] [--sync]`，头部注释同步新增 `--confirm` 行
- 矛盾标志检查（changeDir 校验之后、任何 git 调用之前）：`confirm && force` 时输出 `ensure-branch: --confirm and --force are mutually exclusive. Choose one: --confirm to create/reuse the isolated worktree, or --force to approve editing the protected branch in place.` 并 `process.exit(2)`
- 门禁判定（worktreePath 计算完成后、复用/创建前）：`PROTECTED.includes(branch) && !confirm && !force && !isolate && !sync` 时向 stderr 打印 `ensure-branch: on protected branch '<branch>'. Confirmation required before creating/reusing the isolated worktree at <worktreePath> (branch '<name>'). Ask the user: re-run with --confirm to create/reuse the worktree, or with --force to edit '<branch>' in place.` 并 `process.exit(1)`，零副作用
- `--force` 短路（门禁之后、复用/创建前）：`PROTECTED.includes(branch) && force` 时输出 `ensure-branch: WARNING — editing protected branch '<branch>' in place with --force. This modifies the current branch directly.` (stdout) 并 `process.exit(0)`，不创建 worktree、不调用 recordWorktree/copyActiveChange；保留既有“创建失败后 --force 放行”路径
- 其余逻辑（复用分叉保护、--sync、recordWorktree、copyActiveChange、创建失败 exit 1）逐字不变，全部 git 调用保持 `execFileSync` 字面量参数数组

### 1.2 `tests/lib/ensure-branch.test.mjs`
- BUG/#15 用例 3（保护分支创建）改为两阶段：第一次不带标志断言 `ok===false`、`/Confirmation required/i`、包含 worktree 路径与 `--confirm`/`--force`、worktree 不存在；第二次带 `--confirm` 断言创建成功且仅携带活动变更工件
- 新增用例：保护分支 `--force` 短路——main 上 `run([changeDir, 'force-short', '--force'])` 断言 `ok===true`、`/in place/i`、worktree 未创建
- 新增用例：`--confirm --force` 矛盾——`run([changeDir, 'mutual-change', '--confirm', '--force'])` 断言 `ok===false`、`/mutually exclusive/i` (exit 2 归一为 ok false)
- 新增用例：复用路径门禁——预建 worktree (git worktree add)，main 上不带标志 `run([changeDir, 'reuse-gate'])` 断言 `ok===false`、`/Confirmation required/i`、worktree 副本未被修改
- T2 全部 10 个用例：所有在 main 上的创建/复用调用统一追加 `'--confirm'`（含每个用例内第二次 reuse 调用），共 18 处；`--sync` 用例变为 `['--confirm','--sync']` 组合；断言意图不变
- 全部调用保持 `execFileSync('node', [...])` 参数数组形式，无字符串插值

## TDD Evidence

### RED — 未修改脚本时运行扩展后测试（预期 4 失败）
**Command**: `bun run build && node --test tests/lib/ensure-branch.test.mjs`

**Result**: 20 tests, 16 pass, 4 fail (T2 10 全 pass，BUG/#15 4 失败)

**Failing output excerpt**:
```
not ok 3 - SHALL create an in-repo worktree and carry only the active change artifacts from main
  error: true !== false  (gate should refuse without --confirm, but script created worktree)

not ok 8 - SHALL allow --force to edit protected branch in place without creating a worktree
  error: output should mention in place, got: HEAD ... created worktree ... (force not short-circuited)

not ok 9 - SHALL refuse when --confirm and --force are both given (mutually exclusive)
  error: true !== false  (mutual exclusion not implemented, script created worktree)

not ok 10 - SHALL require confirmation before reusing an existing worktree on a protected branch
  error: true !== false  (reuse gate not implemented, script reused worktree)
1..10
not ok 1 - BUG/#15: ensure-branch enforces isolation (4 subtests failed)
ok 2 - T2: isolate-worktree-hardening pointer and reuse protection (10 pass)
# tests 20 # pass 16 # fail 4
```

**Why expected**: 门禁逻辑尚未实现，保护分支裸调用仍自动创建 worktree，因此两阶段 gate、--force 短路、矛盾检测、复用 gate 四个新用例必然失败；T2 追加的 `--confirm` 因脚本忽略未知标志仍能创建成功，故保持 pass，符合 RED 预期（gate 缺失导致的失败 + 已有逻辑被 `--confirm` 兼容）。

### GREEN — 实现门禁后再次运行
**Command**: `bun run build && node --test tests/lib/ensure-branch.test.mjs`

**Result**: 20 tests, 20 pass, 0 fail

**Passing output excerpt**:
```
ok 1 - BUG/#15: ensure-branch enforces isolation (10/10 pass)
  ok 3 - SHALL create an in-repo worktree and carry only... (two-phase: gate refused then --confirm created)
  ok 8 - SHALL allow --force to edit protected branch in place without creating a worktree
  ok 9 - SHALL refuse when --confirm and --force are both given (mutually exclusive)
  ok 10 - SHALL require confirmation before reusing an existing worktree on a protected branch
ok 2 - T2: isolate-worktree-hardening pointer and reuse protection (10/10 pass, all with --confirm)
# tests 20 # suites 2 # pass 20 # fail 0
```

**Full suite**: `bun run build && bun run test` → 761 tests, 747 pass, 3 fail (pre-existing), 11 cancelled (hookFailed due to missing @deepseek-ai/schemastery)
- Pre-existing failures verified on base commit (54d8fb6) with `git stash` → same 758 tests, 744 pass, 3 fail, 11 cancelled (dsh-ssf service registration hookFailed + dsh-ssf ssf_workflow/ssf_run/ssf_execution). No new failures introduced by this wave.

## Files Changed
- `scripts/ensure-branch.mjs`: 新增 confirm 解析、usage 更新、矛盾检查、门禁、--force 短路、头部注释同步；其余 byte-identical
- `tests/lib/ensure-branch.test.mjs`: 重写 BUG/#15 用例 3 为两阶段、新增 3 门禁用例、T2 10 用例全部追加 '--confirm'（18 处 run 调用）

## Self-Review Findings

### Completeness
- [x] 1.1.1 解析 confirm + usage/header 更新 — done
- [x] 1.1.2 矛盾检查 confirm&&force exit 2 在 changeDir 校验后、任何 git 调用前 — done (lines 47-50)
- [x] 1.1.3 门禁判定在 worktreePath 后、复用/创建前，检查 PROTECTED && !confirm&&!force&&!isolate&&!sync，stderr 打印计划并 exit 1 — done (122-125)
- [x] 1.1.4 --force 短路在门禁后、复用/创建前，PROTECTED&&force 时 WARNING 并 exit 0，不创建 worktree，保留创建失败后 --force 路径 — done (127-131, 165-168)
- [x] 1.1.5 其余逻辑逐字不变，execFileSync 字面量数组 — verified
- [x] 1.2.1 BUG/#15 用例 3 两阶段 — done
- [x] 1.2.2 新增 --force 短路用例 — done
- [x] 1.2.3 新增 --confirm --force 矛盾用例 — done
- [x] 1.2.4 新增复用门禁用例（预建 worktree，gate 拦截，副本未修改）— done
- [x] 1.2.5 T2 全部 10 用例追加 '--confirm'（含第二次 reuse）— done (18 sites)
- [x] 1.2.6 全部 execFileSync literal array — done

### Behavior
- [x] 门禁仅在保护分支且四标志均缺时触发 — verified (PROTECTED.includes && !confirm&&!force&&!isolate&&!sync)
- [x] 门禁零副作用 — gate 在 worktreePath 后但在 divergence/recordWorktree/cpSync 之前，测试断言 worktree 不存在且副本未修改
- [x] --force 短路在保护分支上直接 exit 0，不创建 worktree，不调 recordWorktree/copyActiveChange — verified, placement before reuse block
- [x] 矛盾 exit 2 在任何 git 调用前 — verified, before branch detection
- [x] 文案匹配 /Confirmation required/i, /mutually exclusive/i, /in place/i — tested

### Tests
- [x] 每个新/改测试断言可观察行为 — ok, worktree existence, output regex, file content unchanged
- [x] 测试输出 pristine — no extra logs
- [x] 全部 invocations 使用 execFileSync literal arg arrays — via run([ENSURE, ...]) => execFileSync('node', [ENSURE, ...args], {stdio:'pipe'})

## Concerns
- `--force` 短路当前仅输出到 stdout (console.log) 以适配现有 run() helper 仅捕获 stdout 的成功路径；gate (exit 1) 与矛盾 (exit 2) 均走失败路径可捕获 stderr，故不受影响。若后续要求 warning 必须走 stderr，需将 run() 改为 spawnSync 合并 stdout/stderr，但会偏离 execFileSync 字面量约束。当前方案满足测试契约且与 brief 的“输出”要求一致。
- T2 的 `--confirm` 在非保护分支无效果但在保护分支是必需的，已按 brief 全部追加；若未来新增 T2 用例需继续追加。
- Full suite 的 3 fail + 11 cancelled 为 pre-existing (dsh-ssf missing schemastery + ssf_workflow auto vs full)，已在 base commit 复现，非本 wave 引入。

## Verification
- Focused: `bun run build && node --test tests/lib/ensure-branch.test.mjs` — 20/20 pass
- Full: `bun run build && bun run test` — 761 tests, 747 pass, 3 fail (pre-existing), 11 cancelled
- Gate message contains worktree path and both --confirm/--force hints — verified
- Mutual exclusion exits 2 before any git call — verified
- Force short-circuit creates no worktree — verified

## Commits
- Base: 54d8fb6 (54d8fb64cffd0e41c4706c1f52b12f5e75cdfccb)
- Head: 7d9b93a (7d9b93a35eb7593e20f79d469061b87f573dc03d)
- Commit: `7d9b93a feat(isolate): gate protected branch with --confirm/--force (w1-ensure-branch-gate)`
