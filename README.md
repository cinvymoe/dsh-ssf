<h1 align="center">dsh-ssf</h1>

<p align="center">
  <strong>按改动风险选择轻量或完整路径的 AI 编程工作流插件</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://github.com/cinvymoe/dsh-ssf/stargazers"><img src="https://img.shields.io/github/stars/cinvymoe/dsh-ssf" alt="GitHub Stars"></a>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> |
  <a href="#安装">安装</a> |
  <a href="#为什么需要它">为什么需要它</a> |
  <a href="#与原项目的关系">与原项目的关系</a> |
  <a href="#核心-skills">核心 Skills</a> |
  <a href="#工作流">工作流</a> |
  <a href="#常见问题">FAQ</a>
</p>

---

## 快速开始

安装后，告诉 Agent 一句话即可启动：

```
用 workflow-start 开始
```

Agent 会自动检查当前工件目录，**内容级判断**（不看文件时间戳，而是比较 proposal 范围 vs 契约意图锁）你处于哪个阶段，然后路由到正确的下一个 skill。

- 启动新的变更 → `用 workflow-start 开始`
- 恢复旧的变更 → `继续上次的工作流`
- 不确定当前状态 → `帮我看看现在该干什么`

## 安装

本仓库只提供 **两条安装路径**：DSH 插件（推荐，完整工作流体验）与 CLI 工具链（通用命令）。不再提供面向其他 IDE/Agent 平台的适配代码与安装器。

### DeepSeek Harness（dsh-ssf 插件）

本项目以 `dsh-ssf` 插件形式接入 DSH（DeepSeek Harness）web profile，分为两半协同：

- **host 半**：通过 `packages/dsh-ssf` 以原生工具 `dsh-ssf_*` 接入 Cordis，并通过 `dsh-ssf` 服务与 `snapshot-store` 持久化变更快照（默认 `$DSH_HOME/dsh-ssf.json`，可由 `config.path` / `config.dshHome` 覆盖，`0700`/`0600` 权限原子写入）。提供 `scan()` / `summary(changeDir)` / `refresh()` / `getSnapshot()` 等能力，注册 19 个结构化工具（6 读 + 12 写 + `dsh-ssf_run` 回退），优先走 `dsh-ssf_*` 原生工具、CLI 回退。
- **client 半**：在 web profile 中提供只读的 **Spec 工作流** conversation tab（`GET /dsh-ssf/snapshot` 轮询，`Cache-Control: no-store`），按当前 workspace 过滤变更、展示状态/工作流/DP 决策与降级标记。

> 完整安装、启用、验证与卸载步骤见 [`packages/dsh-ssf/README.md`](packages/dsh-ssf/README.md)（含 `dsh plugin --profile web add`、profile 补丁 `cordis.patch.yml`、`dsh --profile web` 重启与快照校验）。

### CLI 工具链

CLI 保持与原项目一致的通用命令，不含任何平台专属 `install-*` / `uninstall-*`：

```bash
npm install -g dsh-ssf    # 全局安装
npx dsh-ssf list          # 或通过 npx 使用
```

| 命令 | 功能 |
|------|------|
| `dsh-ssf list` | 列出所有 changes 及状态 |
| `dsh-ssf validate <dir>` | 验证工件完整性 |
| `dsh-ssf doctor` | 健康检查（版本、hooks、skills、文档一致性） |
| `dsh-ssf version <semver>` | 一键同步版本号到所有 manifest |
| `dsh-ssf state <sub> <dir>` | 管理 `.spec-superflow.yaml` 状态文件 |
| `dsh-ssf inject <dir>` | 生成 phase-guard 产物 |
| `dsh-ssf audit <dir>` | 生成决策点审计报告 |
| `dsh-ssf checkpoint save <dir> --task <id> --next <text>` | 保存任务级会话恢复点 |
| `dsh-ssf checkpoint list <dir>` | 列出 checkpoint 及 stale 状态 |
| `dsh-ssf checkpoint show <dir> <id>` | 查看单个恢复点 |
| `dsh-ssf resume [change]` | 只读恢复摘要；唯一活跃 change 可自动选择 |
| `dsh-ssf switch <change>` | 只读返回明确 change 的恢复上下文 |
| `dsh-ssf save <change> --task <id> --next <text>` | 手动写入兼容 checkpoint；不自动 commit/push/sync |
| `dsh-ssf handoff create <dir> --type <type> ...` | 创建 prototype/research/experiment handoff |
| `dsh-ssf handoff list <dir>` | 列出 handoff 生命周期状态 |
| `dsh-ssf handoff finish <dir> <id>` | 校验 handoff 结果 |
| `dsh-ssf handoff resolve <dir> <id> --decision <decision>` | 记录显式 handoff 决策 |
| `dsh-ssf isolate <dir>` | 实现前强制 git 隔离：在 main/master 时创建 worktree 或分支 |
| `dsh-ssf finish <dir> [--test-cmd <command>]` | 一键收尾：merge --no-ff 回主干、验证同步、执行验证命令，通过才删除 worktree 与分支 |
| `dsh-ssf execution recommend <dir> ...` | 基于任务量、wave 和工作流列出可用执行方式并给出推荐 |
| `dsh-ssf execution plan <dir> ...` | 保存受 guard 保护的执行计划 |
| `dsh-ssf execution show <dir> [--json]` | 查看并校验当前执行计划、wave 与 receipt |
| `dsh-ssf execution revise <dir> ...` | 将已有计划保留/升级为 SDD，并生成新 revision；不允许降级 |
| `dsh-ssf execution review <dir> ...` | 为一个计划 wave 记录 review receipt |
| `dsh-ssf execution adjudicate <dir> ...` | 为 `adjudication-required` wave 授权一次 review |
| `dsh-ssf sync <dir>` | 将 delta spec 发布为基线规范 |
| `dsh-ssf config --resolve-model <profile>` | 只读解析模型 profile |

### 版本

- 当前版本：`v1.2.0`
- 自包含插件，不需要运行时安装 OpenSpec 或 Superpowers
- 上游来源：[Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) 和 [obra/superpowers](https://github.com/obra/superpowers)
- 版本历史见 [CHANGELOG.md](CHANGELOG.md)

Requirement 标题的规范形式是 `### Requirement: 名称`。为兼容已存在的中文工件，解析器也接受 `### 需求：名称` 和 `### REQ-<ID>: 名称`；其它三级标题不会被当作需求。Delta spec 的规范路径是 `specs/<capability>/spec.md`，扁平的 `specs/<capability>.md` 和根级 `specs/spec.md` 不会被视为合法规范。`dsh-ssf sync` 会先校验全部 delta，再一次性发布，任一 delta 无效时不会写入基线或发布回执。

### 活动规格与发布基线

活动工作流只以 `changes/<change>/` 为事实来源：其中的 `specs/` 是可审计的 delta spec。项目根 `specs/` 是发布后的规范基线，不参与活动 change 的状态转换。运行 `dsh-ssf sync changes/<change>` 时，CLI 会把 ADDED/MODIFIED/REMOVED/RENAMED 操作应用到根基线的 `## Requirements`，并在 change 状态写入可重算的发布回执。closing 会同时核验 delta 与基线；任一侧同步后被修改，都必须重新同步。

### 插件仓库与使用项目的边界

本仓库发布的是 workflow、模板、脚本、测试和文档，不是某一次真实运行的工作目录。因此不会提交 `changes/<change>/`、`.spec-superflow.yaml`、`.superpowers/` 或 `dsh-ssf sync` 生成的根 `specs/`；它们默认由 `.gitignore` 排除。需要展示完整流程时，只维护脱敏、固定的 `docs/examples/` 示例。

在**使用此插件的项目**中，活动输入仍是 `changes/<change>/specs/`，根 `specs/` 仍是可选的发布基线。消费者可按自己的审计或发布要求决定是否将这些项目工件纳入版本控制。

### 受 guard 保护的执行计划

对 Full/legacy Hotfix，DP-4 不是一段任意文本：开始实现前必须保存并校验 current execution plan。它位于 `<change>/.superpowers/sdd/execution-plan.json`，不写入 `execution-contract.md`。先运行 `dsh-ssf execution recommend`，它会根据任务量和 wave 策略列出 `inline`、`batch-inline`、`sdd`，并给出可审计的推荐理由，同时把当前 wave 的推荐凭据保存为 `<change>/.superpowers/sdd/execution-recommendation.json`。

```bash
dsh-ssf execution recommend changes/my-change \
  --wave foundation:parallel:1.1,1.2 \
  --wave integration:serial:2.1:foundation --json
dsh-ssf execution plan changes/my-change --mode sdd --confirm --reason "independent work" \
  --wave foundation:parallel:1.1,1.2 \
  --wave integration:serial:2.1:foundation
dsh-ssf execution show changes/my-change --json
dsh-ssf execution revise changes/my-change --mode sdd --confirm --reason "need parallel work" \
  --wave foundation:parallel:1.1,1.2 \
  --wave integration:serial:2.1:foundation
dsh-ssf execution review changes/my-change --wave foundation --base <sha> --head <sha> \
  --report .superpowers/sdd/reviews/foundation.md --verdict pass
```

`--report` 相对于 `<change>` 解析，且必须位于 `<change>/.superpowers/sdd/reviews/` 之下。每个 wave 的 review receipt 必须是当前 revision 的 `pass`，依赖 wave 和 closing 才会放行；修订计划会使旧 receipt 失效。

会话恢复与 checkpoint：

```bash
dsh-ssf resume                         # 只在唯一活跃 change 时自动选择
dsh-ssf resume changes/my-change       # 只读恢复指定 change 的摘要
dsh-ssf switch changes/another-change  # 只读返回明确 change 的恢复上下文
dsh-ssf save changes/my-change --task 1.1 --next "Run focused tests"
dsh-ssf checkpoint save changes/my-change --task 1.1 --next "Run focused tests"
dsh-ssf checkpoint list changes/my-change
dsh-ssf handoff create changes/my-change --type research --objective "Compare approaches" --expected-output "Recommendation" --acceptance "Evidence recorded"
```

`resume` 与 `switch` 都是只读恢复操作，不修改 cwd 或隐藏指针；`save` 仅手动写入既有 checkpoint 协议，绝不自动 commit、push 或 sync。Prototype 只在用户明确确认后创建，handoff 结果不会自动修改 `design.md` 或 `tasks.md`。

注：代码层 bin/工具名/快照文件名仍保留 ssf 兼容别名，本系列文档统一以 dsh-ssf 表述。

---

## 为什么需要它

用 AI 写代码时，最常见的两个问题是：

- **还没想清楚要做什么，AI 就开始写代码。** 你说了句"帮我加个权限控制"，它就开始改几十个文件。改到一半才发现 —— 到底要 RBAC 还是 ABAC？

- **规划文档写得明明白白，但执行阶段还是会跑偏。** proposal 写了、design 画了，但实现过程中没人盯着测试、没人卡 review，等到合并才发现行为不对。

dsh-ssf 把这两类问题分开处理：先判断改动风险；小改动直接在明确边界内完成并验证，复杂改动再经过需求、规格、执行契约、实现和审查。这样既不让简单问题变成流程项目，也不让高风险改动跳过必要检查。

| 设计原则 | 说明 |
|---|---|
| 先选路径 | 根据文件数、边界和风险选择 Quick、Hotfix、Tweak 或 Full |
| 复杂改动先对齐 | Full 路径用规格与执行契约确认范围和验收方式 |
| 实现可验证 | 每条路径都要求与风险相称的测试或检查 |
| 有问题先定位 | 遇到失败先复现和找根因，不连续试错 |
| 自包含 | 不需要额外安装 OpenSpec 或 Superpowers |

### 适用场景

**✅ 推荐：** 大型功能开发、多人协作项目、长期维护项目、需要 TDD + Review Gate 的棕地项目。

**❌ 不推荐：** 一次性脚本/工具、纯咨询/问答。

> **四级模式**：Quick（≤3 文件/任务低风险代码）、direct Hotfix（incident 且≤2）、Tweak（≤4 配置/文档）直接执行并验证；Full 与 legacy Hotfix 保留规划、契约和审查

---

## 与原项目的关系

本仓库并非与原项目竞争的 fork，而是原项目的 **DSH 原生发行版**—— 核心完全一致，执行载体仅保留并强化 DSH。

**1. 原项目是什么。** 原项目为 [MageByte-Zero/spec-superflow](https://github.com/MageByte-Zero/spec-superflow)（现迁移至 [cinvymoe/dsh-ssf](https://github.com/cinvymoe/dsh-ssf)），本身是 [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec)（规划引擎：Schema 验证、Delta Spec、工件解析）与 [obra/superpowers](https://github.com/obra/superpowers)（执行纪律：TDD 铁律、SDD 子代理驱动、系统化调试与代码审查）的**源码级融合**，而非简单并列。独创 `contract-builder` 桥接层将 `proposal / specs / design / tasks` 四份规划工件自动提取压缩为 `execution-contract.md`，并以 **8 状态路由**（`exploring → specifying → bridging → approved-for-build → executing → closing`，另含 `debugging` 旁路与 `abandoned` 终态）贯穿全流程。自包含、零运行时依赖，不需要另行安装 OpenSpec 或 Superpowers。

**2. 本仓库做了什么。** 本仓库剥离了原项目面向 Claude Code / Cursor / OpenAI Codex / GitHub Copilot / Gemini / OpenCode / WorkBuddy / Trae 等 **19 个平台**的适配代码（hooks、插件清单、安装器、平台专属规则与 marketplace 配置），**仅保留并强化 DSH（DeepSeek Harness）路径**：host 半以 `packages/dsh-ssf` 原生工具 `dsh-ssf_*` + 变更状态快照服务接入 Cordis（`ctx.tools` / `ctx.webServer` / `snapshot-store`），client 半以 Spec 工作流 tab 接入 web profile（`GET /dsh-ssf/snapshot` 轮询）。DSH 小节统一指向 [`packages/dsh-ssf/README.md`](packages/dsh-ssf/README.md)，不再在 README 与 INSTALL 中维护多平台矩阵与安装命令。

**3. 有什么不变、后续如何同步。** 核心工作流与原项目**完全一致**：9 个 skills、8 状态机、解析/验证引擎（`src/schema` / `src/parsing` / `src/validation`）、模板（`templates/`）、CLI 核心（`scripts/`）与守卫体系均保持一致；DSH 插件只是**执行载体差异**（结构化工具与快照服务替代平台 hooks）。后续 upstream 同步策略：`core` / `skills` / `src` / `templates` / `docs` 等核心持续与上游同步，平台适配层**仅保留 DSH**，不再合回其他平台代码。

**4. 致谢与 rebrand 说明。** 感谢原项目 MageByte-Zero/spec-superflow 的完整设计与实现，以及 OpenSpec 与 Superpowers 两个上游项目提供的引擎与纪律思想。本仓库已完成 rebrand：当前版本 `v1.2.0`，`package.json` 的 `name` 仍为 `spec-superflow` 以保持 `dsh-ssf` / `spec-superflow` CLI 兼容，GitHub 仓库地址为 [`cinvymoe/dsh-ssf`](https://github.com/cinvymoe/dsh-ssf)。

---

## 核心 Skills

| # | Skill | 阶段 | 职责 |
|---|---|---|---|
| 1 | `workflow-start` | 入口 | 内容级状态检测、8 状态路由、阻止非法跳转 |
| 2 | `need-explorer` | 探索 | 一次一问 + 方案对比 + 推荐 |
| 3 | `spec-writer` | 规格 | 产出 proposal/specs/design/tasks，Schema 引擎实时验证 |
| 4 | `contract-builder` | 桥接 | 解析引擎自动提取 4 工件 → 压缩为 execution-contract.md |
| 5 | `build-executor` | 执行 | TDD 铁律 + SDD 子代理驱动 + Review Gate |
| 6 | `bug-investigator` | 调试 | 4 阶段根因分析，3+ 修复失败 → 质疑架构 |
| 7 | `code-reviewer` | 审查 | 结构化审查，三级问题分级 |
| 8 | `release-archivist` | 执行内收尾 | 验证前完成铁律 + 归档 + 风险总结 |
| 9 | `spec-merger` | 执行内收尾 | Delta Spec → 主规范智能合并 |

---

## 工作流

```text
你说"帮我加一个权限控制"
       │
       ▼
   workflow-start     ← 唯一入口。内容级状态检测、路由到正确 skill
       │
       ▼
   exploring          need-explorer："你要 RBAC 还是 ABAC？多大粒度？"
       ▼
   specifying         spec-writer 产出 4 份工件 + Schema 引擎验证
       ▼
   bridging           contract-builder 自动提取 → execution-contract.md
       │
  ◇ 用户批准 ◇         ← 唯一一次人工介入
       │
       ▼
   executing          build-executor: TDD → SDD → Review Gate
       │
       ├──[bug]──→ debugging  → bug-investigator
       │
       ▼
   pre-closing（仍属于 executing 的收尾步骤，不是新增状态）
       │ release-archivist 验证 → spec-merger 同步 → 归档确认
       ▼
   closing            CLOSED 成功终态（无 next skill）
```

**如何选择：** Quick、direct Hotfix、Tweak 默认保持轻量，只记录范围和验证；Full 与 legacy Hotfix 才要求执行契约、执行计划和 review receipt。风险会说明原因并交给用户选择，不会擅自升级路径。

**DP-5 调试门禁：** 每次失败修复使用 `dsh-ssf debug attempt record` 保存唯一且可验证的证据；无论工作流路径，记录前都必须有 current、有效的 execution plan。Wave Review failure 不会计入调试次数。只有当前 execution context 下至少 3 次不同失败尝试，并由用户执行 `dsh-ssf debug escalate ... --confirm` 后，才会记录 DP-5。通用 `state set` 不能写入 `dp_5_*`，且不能通过多行值注入这些字段。

### 快速路径（Quick / Hotfix / Tweak）

- **Quick** — ≤3 文件/任务、单模块代码：低风险时同轮推荐/接受；触及 PRD、Spec/Design、API、数据/权限或跨模块时，展示风险后由用户选择 Quick 或 Full。选择 Quick 会记录 `tdd`、`new-test` 或 `bounded` 验证策略。
- **direct Hotfix** — incident 且≤2 文件/任务：同一路径，必须验证原症状回归。
- **legacy Hotfix** — 既有或无 direct receipt：保留最小契约、DP-3、plan/review。
- **tweak** — ≤4 文件、纯配置/文档修改时，跳过规划+桥接，直接编辑

---

## 模型 Profile（可选配置）

可以在项目根目录的 `spec-superflow.config.json` 中，为不同执行角色配置模型 ID：

```json
{
  "models": {
    "mechanical": "vendor-small",
    "standard": "vendor-standard",
    "strong": "vendor-strong",
    "review": "vendor-review"
  }
}
```

| Profile | 角色 |
|---|---|
| `mechanical` | 低成本、机械性修改 |
| `standard` | 集成与判断任务 |
| `strong` | 架构、设计与最终审查 |
| `review` | 与 diff 匹配的代码审查 |

```bash
dsh-ssf config --resolve-model mechanical
```

该命令只解析本地配置，不调用平台 API，也不切换当前会话模型。若结果为 `configured: false`，则没有自动选择能力，不能臆造供应商模型。

---

## 常见问题

<details>
<summary><strong>dsh-ssf 和 OpenSpec / Superpowers 什么关系？</strong></summary>

源码级融合，不是简单并列。吸收了两者的引擎（Schema/验证/解析 + TDD/SDD/调试/审查），独创了 contract-builder 桥接层和 8 状态路由。自包含，不需要安装上游运行时。

</details>

<details>
<summary><strong>dsh-ssf 和原项目 spec-superflow 什么关系？</strong></summary>

不是竞争性 fork，而是 **DSH 专用发行版**。原项目 [MageByte-Zero/spec-superflow](https://github.com/MageByte-Zero/spec-superflow)（现 [cinvymoe/dsh-ssf](https://github.com/cinvymoe/dsh-ssf)）面向 19 个平台；本仓库仅保留并强化 DSH 路径（host 半 `dsh-ssf_*` 原生工具 + snapshot 服务接入 Cordis，client 半 Spec 工作流 tab 接入 web profile），剥离其他平台适配代码。核心工作流（9 skills、状态机、引擎、模板、CLI）与原项目完全一致，后续核心持续与上游同步，平台层仅保留 DSH。`package.json` 仍为 `spec-superflow` 以保持 CLI 兼容，GitHub 仓库已 rebrand 为 `cinvymoe/dsh-ssf`（v1.2.0）。

</details>

<details>
<summary><strong>能和我已有的 OpenSpec 或 Superpowers 共存吗？</strong></summary>

建议不要在同一会话混用。已有 OpenSpec 工件目录的项目可以直接用 dsh-ssf 接管 —— `contract-builder` 能读取现有文件生成 execution contract。

</details>

<details>
<summary><strong>execution contract 怎么知道该更新了？</strong></summary>

内容级检测（不是文件时间戳）：proposal 范围变了、specs 已批准需求改了、design 架构约束变了、tasks 批次变了 → 视为过时，回退到 `contract-builder`。

</details>

<details>
<summary><strong>SDD (Subagent-Driven Development) 怎么工作的？</strong></summary>

Full/legacy Hotfix 先由 `dsh-ssf execution recommend` 根据任务量和 wave 策略列出 Inline、Batch Inline、SDD 并推荐一种；Agent 展示候选项和理由，用户以 `--confirm` 确认后才保存 plan。Quick/direct Hotfix/Tweak 不创建 plan 或 review receipt，而是报告边界内的验证并写入 `test_result: pass`。Batch Inline 仍是串行。进度台账防止会话压缩后丢失进度。

</details>

---

**Star 一下，下次需要的时候能找到。**
