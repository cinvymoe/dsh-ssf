# 安装 — dsh-ssf（DSH 专用发行版）

`dsh-ssf` 是一个自包含插件，**不需要**在运行时安装 OpenSpec 或 Superpowers。

源码血缘：

- [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) — 规划引擎（Schema 验证、Delta Spec、工件解析）
- [obra/superpowers](https://github.com/obra/superpowers) — 执行纪律（TDD 铁律、SDD、系统化调试、代码审查）

当前发布版本：**v1.2.0**。

> **与原项目的关系（溯源）：** 原项目 [MageByte-Zero/spec-superflow](https://github.com/MageByte-Zero/spec-superflow)（已迁移至 [cinvymoe/dsh-ssf](https://github.com/cinvymoe/dsh-ssf)）是 OpenSpec 规划引擎与 Superpowers 执行纪律的**源码级融合**，独创 `contract-builder` 桥接层与 8 状态路由。本仓库为 **DSH 原生发行版**，剥离原项目面向 19 个平台（Claude Code / Cursor / Codex / Copilot / Gemini / OpenCode / WorkBuddy 等）的适配代码、安装器与 marketplace 配置，**仅保留并强化 DSH（DeepSeek Harness）路径**。核心工作流与验证引擎与原项目完全一致，详见文末 [与原项目的关系](#与原项目的关系)。

---

## DeepSeek Harness（dsh-ssf 插件）

`dsh-ssf` 以 DSH web profile 插件形式接入 dsh-ssf，分两半协同：

- **host 半**：通过 `packages/dsh-ssf` 以原生工具 `dsh-ssf_*` 接入 Cordis（`ctx.tools` / `ctx.webServer` / `snapshot-store`），提供变更扫描 `scan()` / `summary(changeDir)` / `refresh()` / `getSnapshot()`，并持久化快照到独立文件 `$DSH_HOME/dsh-ssf.json`（可由 `config.path` / `config.dshHome` 覆盖，`0700`/`0600` 权限原子写入）。注册 19 个结构化工具（6 读 + 12 写 + `dsh-ssf_run` 回退），优先走 `dsh-ssf_*` 原生工具，CLI 回退。
- **client 半**：在 web profile 中提供只读的 **Spec 工作流** conversation tab（`GET /dsh-ssf/snapshot` 轮询，`Cache-Control: no-store`，每 3s + `visibilitychange`），按当前 workspace 过滤变更，展示状态/工作流/决策点与降级标记。

> 详细实现与开发说明见 [`packages/dsh-ssf/README.md`](https://github.com/cinvymoe/dsh-ssf/blob/main/packages/dsh-ssf/README.md)。

### 前置条件

- 已安装并可运行的 DSH（`dsh --help` 可用），本文以 `web` profile 为例
- Node.js ≥ 20

### 1. 安装插件包

从本仓库根目录执行（将路径替换为你本地实际路径）：

```bash
dsh plugin --profile web add /absolute/path/to/dsh-ssf/packages/dsh-ssf
```

该命令会将 `dsh-ssf` 安装到指定 profile 的插件目录，并在 `node_modules` 建立解析链路。

### 2. 启用插件（profile 补丁）

在 `$DSH_HOME/profiles/web/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: dsh-ssf
      name: dsh-ssf
```

说明：

- `dsh-client-modules` 会自动从包的 `dsh.client` 声明与 `exports["./client"]` 发现 client 半，无需单独配置 browser 行。
- 若包无法从 profile 的 `node_modules` 解析，`name` 也可写为相对于 profile 目录的 `.` 相对路径（由 profile 目录解析）。

### 3. 重启 profile

```bash
dsh --profile web
```

重启后 host 半的 `dsh-ssf` 服务与 `dsh-ssf_*` 工具、client 半的 Spec 工作流 tab 会一并加载。若未生效，检查 profile 启动日志中是否有插件加载错误。

### 4. 验证

1. **Spec 工作流 tab**：打开 Web GUI（`http://127.0.0.1:8399` 或你配置的端口），在对话侧栏应出现 **Spec 工作流** tab（order 20），列出当前 workspace 下的 `changes/` 变更（名称/状态/工作流，终态靠后），点击可查看决策点与降级标记；无快照时显示空状态。
2. **结构化工具**：在任意会话中，Agent 的可用工具列表应包含 `dsh-ssf_*`（`dsh-ssf_list` / `dsh-ssf_state` / `dsh-ssf_validate` 等 19 个）。执行 `dsh-ssf_list` 或 `dsh-ssf_state` 应返回对应 change 的结构化 JSON。
3. **快照接口**：浏览器或 `curl` 访问 `GET /dsh-ssf/snapshot`，应返回含 `changes` / `workspaces` / `scannedAt` 的 JSON，且响应头含 `Cache-Control: no-store`。
4. **快照文件**：检查 `$DSH_HOME/dsh-ssf.json`（或 `config.path` 指定路径）存在且包含 `changes` / `workspaces` / `scannedAt`，权限为 `0700` 目录 / `0600` 文件；`settings.yaml` 中不应再有 `dsh-ssf:` 段。

```bash
cat ~/.dsh/dsh-ssf.json | head -n 50
curl -s http://127.0.0.1:8399/dsh-ssf/snapshot | head -n 50
```

### 5. 卸载

```bash
# 1) 从 profile 补丁中移除启用行
# 编辑 $DSH_HOME/profiles/web/cordis.patch.yml，删除：
# - insert:
#     - id: dsh-ssf
#       name: dsh-ssf

# 2) 移除插件包
dsh plugin --profile web remove dsh-ssf

# 3) 重启 profile 使卸载生效
dsh --profile web
```

卸载后 `dsh-ssf_*` 工具、`/dsh-ssf/snapshot` 路由与 Spec 工作流 tab 会一并消失；`$DSH_HOME/dsh-ssf.json` 可按需手动清理。

注：代码层 bin/工具名/快照文件名仍保留 ssf 兼容别名，本系列文档统一以 dsh-ssf 表述。

---

## CLI 工具链

CLI 保持与原项目一致的通用命令，**不含任何平台专属 `install-*` / `uninstall-*`**。适用于本地校验、CI 与 Agent 回退路径。

```bash
npm install -g dsh-ssf    # 全局安装
npx dsh-ssf list          # 或通过 npx 临时使用
dsh-ssf --help            # 安装后可用 dsh-ssf 简写
```

| 命令 | 功能 |
|------|------|
| `dsh-ssf list` | 列出所有 changes 及状态机摘要（名称/状态/工作流） |
| `dsh-ssf validate <dir>` | 验证工件完整性（proposal + `specs/*/spec.md`） |
| `dsh-ssf doctor` | 健康检查（版本、hooks、skills、文档一致性） |
| `dsh-ssf version <semver>` | 一键同步版本号到所有 manifest（`package.json` / 插件清单等） |
| `dsh-ssf state <sub> <dir>` | 管理 `.spec-superflow.yaml` 状态文件（`init` / `set` / `transition` / `rebuild`） |
| `dsh-ssf inject <dir>` | 生成 phase-guard 注入产物（供 Agent 会话自动注入上下文） |
| `dsh-ssf audit <dir>` | 生成决策点审计报告（DP-0~DP-7） |
| `dsh-ssf checkpoint save <dir> --task <id> --next <text>` | 保存任务级会话恢复点 |
| `dsh-ssf checkpoint list <dir>` | 列出 checkpoint 及 stale 状态 |
| `dsh-ssf checkpoint show <dir> <id>` | 查看单个恢复点详情 |
| `dsh-ssf resume [change]` | 只读恢复摘要；仅当唯一活跃 change 时自动选择 |
| `dsh-ssf switch <change>` | 只读返回明确 change 的恢复上下文，不修改 cwd/隐藏指针 |
| `dsh-ssf save <change> --task <id> --next <text>` | 手动写入兼容 checkpoint；不自动 commit/push/sync |
| `dsh-ssf handoff create <dir> --type <type> --objective ... --expected-output ... --acceptance ...` | 创建 prototype / research / experiment handoff |
| `dsh-ssf handoff list <dir>` | 列出 handoff 生命周期状态 |
| `dsh-ssf handoff finish <dir> <id>` | 校验 handoff 结果 |
| `dsh-ssf handoff resolve <dir> <id> --decision <decision>` | 记录显式 handoff 决策（accept / reject / defer） |
| `dsh-ssf isolate <dir>` | 实现前强制 git 隔离：在 main/master 时创建 worktree 或分支 |
| `dsh-ssf finish <dir> [--test-cmd <command>]` | 一键收尾：`merge --no-ff` 回主干、验证同步、执行验证命令，通过才删除 worktree 与分支 |
| `dsh-ssf execution recommend <dir> ...` | 基于任务量、wave 和工作流列出可用执行方式并给出推荐 |
| `dsh-ssf execution plan <dir> --mode <mode> --confirm ...` | 保存受 guard 保护的执行计划 |
| `dsh-ssf execution show <dir> [--json]` | 查看并校验当前执行计划、wave 与 receipt |
| `dsh-ssf execution revise <dir> ...` | 将已有计划保留/升级为 SDD，并生成新 revision；不允许降级 |
| `dsh-ssf execution review <dir> --wave <id> --base <sha> --head <sha> --report <path> --verdict <v>` | 为一个计划 wave 记录 review receipt |
| `dsh-ssf execution adjudicate <dir> ...` | 为 `adjudication-required` wave 授权一次 review |
| `dsh-ssf sync <dir>` | 将 delta spec 发布为基线规范（原子校验，任一 delta 无效则不写基线） |
| `dsh-ssf config --resolve-model <profile>` | 只读解析模型 profile（`mechanical` / `standard` / `strong` / `review`） |

> 通用说明：`--json` 可输出机器可读报告；`--dry-run`（若支持）用于预演；所有写操作均受状态机 guard 校验，非法跃迁会被阻止。

---

## 使用

安装完成后，告诉 Agent：

```
用 workflow-start 开始
```

`workflow-start` 会检查当前工件目录，判断你处于探索 / 规格 / 桥接 / 执行 / 收口的哪个阶段，然后自动路由到正确的下一个 skill。

- 启动新的变更 → `用 workflow-start 开始`
- 恢复旧的变更 → `继续上次的工作流`
- 不确定当前状态 → `帮我看看现在该干什么`

---

## 工作流目录约定

对于名为 `<change-name>` 的变更：

```text
changes/<change-name>/
├── proposal.md
├── design.md
├── tasks.md
├── specs/
│   └── <capability>/
│       └── spec.md
└── execution-contract.md
```

流程线：`proposal / specs / design / tasks -> execution-contract.md -> 用户批准 -> execution plan -> 开始实现`

规划本身不等于可以实现。如果 `execution-contract.md` 缺失、过时或未被用户批准，工作流会拒绝进入实现阶段。

Delta spec 的规范路径是 `specs/<capability>/spec.md`。扁平的 `specs/<capability>.md` 和根级 `specs/spec.md` 都不会被当作合法规范静默通过。

### 受 guard 保护的执行计划

Full / legacy Hotfix 在 DP-4 必须保存 current execution plan 到 `<change>/.superpowers/sdd/execution-plan.json`；它不属于 `execution-contract.md`。先运行 `dsh-ssf execution recommend`：它按任务量和 wave 策略列出 `inline`、`batch-inline`、`sdd` 并给出推荐，并保存当前 wave 的推荐凭据到 `<change>/.superpowers/sdd/execution-recommendation.json`。Agent 展示候选项和理由后，`plan` 与 `revise` 必须消费匹配当前 artifact、contract 和 wave 的凭据；用户用 `--confirm` 确认；若选择非推荐方式，必须用 `--acknowledge-recommendation` 记录风险确认。Batch Inline 始终串行，不会表示并行。Quick、direct Hotfix 与 `tweak` 免除 contract、execution plan、review receipt 和 DP gate；它们在边界内验证后持久化 `test_result: pass`。

```bash
dsh-ssf execution recommend changes/my-change \
  --wave foundation:parallel:1.1,1.2 \
  --wave integration:serial:2.1:foundation --json
dsh-ssf execution plan changes/my-change --mode sdd --confirm --reason "independent work" \
  --wave foundation:parallel:1.1,1.2 \
  --wave integration:serial:2.1:foundation
dsh-ssf execution show changes/my-change --json
# 可将已有 inline/batch-inline 计划升级为 sdd，或重规划已有 sdd 的 wave/依赖；不能降级。
dsh-ssf execution recommend changes/my-change \
  --wave foundation:parallel:1.1,1.2 \
  --wave integration:serial:2.1:foundation --json
dsh-ssf execution revise changes/my-change --mode sdd --confirm --reason "need parallel work" \
  --wave foundation:parallel:1.1,1.2 \
  --wave integration:serial:2.1:foundation
dsh-ssf execution review changes/my-change --wave foundation --base <sha> --head <sha> \
  --report .superpowers/sdd/reviews/foundation.md --verdict pass
dsh-ssf finish changes/my-change
```

`--report` 相对于 `<change>` 解析，且必须位于 `<change>/.superpowers/sdd/reviews/` 之下。`--base` 和 `--head` 必须是该 `<change>` Git 工作树中的真实 commit，且 `base` 必须是 `head` 的祖先。`<change>/.superpowers/sdd/reviews/` 的目录层级必须是物理、非符号链接目录；report 本身必须为普通、非空、非符号链接文件。

`dsh-ssf isolate <change-dir>` 创建隔离上下文后会自动递归初始化子模块（存在 `.gitmodules` 时），并向 `<change>/.superpowers/sdd/progress.md` 追加 cwd 不持续警告。`dsh-ssf execution review` 在记录 receipt 前校验 head 必须被至少一个非 `main`/`master` 分支包含——head 只落在主干上会被拒绝且不写 receipt。全部 wave 通过后，`dsh-ssf finish <change-dir>` 一条命令完成收尾：`merge --no-ff` 回主干、验证主干包含隔离分支全部提交、删除 worktree 与隔离分支；`finish` 与 `review` 在 cwd 位于 worktree 之外时会输出含 worktree 绝对路径的 WARN（不阻断执行）。

每一个 wave 均须有当前 `pass` review receipt，才可启动依赖 wave 或进入 closing；修订计划会废止旧 receipt。恢复、切换和手动保存属于 control-plane overlay，不增加第九个状态。

### `dsh-ssf inject` 用法

为当前变更生成 phase-guard 注入产物，供 Agent 会话自动加载上下文与阶段约束：

```bash
dsh-ssf inject changes/my-change
```

产物用于在会话启动时注入工作流上下文（类似原项目的 `hooks/session-start` 能力），由 DSH Agent 在会话初始化时消费。若项目中同时存在多个变更上下文，Agent 会按当前 workspace 自动选择；也可由 `dsh-ssf resume` / `dsh-ssf switch` 显式指定恢复目标。无需手动指定平台，DSH 路径会自动处理注入与去重。

### 会话恢复与可选 prototype

```bash
dsh-ssf resume                         # 恰好一个活跃 change 时才自动选择
dsh-ssf resume changes/my-change       # 只读恢复指定 change 摘要
dsh-ssf switch changes/another-change  # 只读返回明确 change 的恢复上下文
dsh-ssf save changes/my-change --task 1.1 --next "Run focused tests"
dsh-ssf checkpoint save changes/my-change --task 1.1 --next "Run focused tests"
dsh-ssf checkpoint list changes/my-change
dsh-ssf checkpoint show changes/my-change 1.1
dsh-ssf handoff create changes/my-change --type research --objective "Compare approaches" --expected-output "Recommendation" --acceptance "Evidence recorded"
dsh-ssf handoff list changes/my-change
dsh-ssf handoff finish changes/my-change <handoff-id>
dsh-ssf handoff resolve changes/my-change <handoff-id> --decision accept
```

`resume` 与 `switch` 是只读恢复操作；`resume` 只会在恰好一个活跃 change 时自动选择。`switch` 只返回明确目标的恢复上下文，不修改 cwd 或任何隐藏指针；是否切换当前对话关注对象由宿主 Agent 根据返回的上下文决定。`save` 只手动复用既有 checkpoint 协议，不自动 commit、push 或 sync。

Checkpoint 是任务级恢复上下文。`result-ready` handoff 在继续受影响的工作前必须显式审阅并 resolve。Prototype 只在用户明确确认后创建；后端、CLI、配置和内部重构不会自动进入 prototype 流程。handoff 结果不会自动修改 `design.md` 或 `tasks.md`。

---

## 验证

安装后验证：

- `workflow-start` skill 已可用（Agent 中输入 `用 workflow-start 开始` 可路由）
- 其余 8 个 skill 全部可见（`need-explorer` / `spec-writer` / `contract-builder` / `build-executor` / `bug-investigator` / `code-reviewer` / `release-archivist` / `spec-merger`）
- DSH 侧：Spec 工作流 tab 可见、`dsh-ssf_*` 工具可调用、`GET /dsh-ssf/snapshot` 与 `$DSH_HOME/dsh-ssf.json` 均有数据

---

## 故障排查

### Agent 找不到 skill

- 检查 skill 目录名是否与 skill 名一致
- 检查目录下是否存在 `SKILL.md`

### 工作流过早开始实现

从 `workflow-start` 入口开始，不要直接调用 `build-executor`。

Full / legacy 推荐流程：`exploring -> specifying -> bridging -> approved-for-build -> execution plan -> executing -> closing`

Quick（≤3 单模块代码文件/任务）与 direct Hotfix（incident，≤2）走 `exploring -> approved-for-build -> executing`。Quick 低风险时同轮推荐/接受；若涉及 PRD、Spec/Design、API、数据/权限或跨模块，必须展示风险并由用户选择 Quick 或 Full。选择 Quick 时记录 `tdd`、`new-test` 或 `bounded` 验证策略；direct Hotfix 必须复现原症状回归。legacy Hotfix 才走最小契约、DP-3、plan/review 路径。

### DSH 插件未加载

- 检查 `dsh plugin --profile web list` 是否包含 `dsh-ssf`
- 检查 `$DSH_HOME/profiles/web/cordis.patch.yml` 是否包含 `id: dsh-ssf`
- 检查 profile 启动日志是否有 `dsh-ssf` 加载错误
- 重启后再次访问 `GET /dsh-ssf/snapshot` 验证

---

## 与原项目的关系

本仓库并非与原项目竞争的 fork，而是原项目的 **DSH 原生发行版**—— 核心完全一致，执行载体仅保留并强化 DSH。

**1. 原项目是什么。** 原项目为 [MageByte-Zero/spec-superflow](https://github.com/MageByte-Zero/spec-superflow)（现迁移至 [cinvymoe/dsh-ssf](https://github.com/cinvymoe/dsh-ssf)），本身是 [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec)（规划引擎：Schema 验证、Delta Spec、工件解析）与 [obra/superpowers](https://github.com/obra/superpowers)（执行纪律：TDD 铁律、SDD 子代理驱动、系统化调试与代码审查）的**源码级融合**，而非简单并列。独创 `contract-builder` 桥接层将 `proposal / specs / design / tasks` 四份规划工件自动提取压缩为 `execution-contract.md`，并以 **8 状态路由**（`exploring → specifying → bridging → approved-for-build → executing → closing`，另含 `debugging` 旁路与 `abandoned` 终态）贯穿全流程。自包含、零运行时依赖，不需要另行安装 OpenSpec 或 Superpowers。

**2. 本仓库做了什么。** 本仓库剥离了原项目面向 Claude Code / Cursor / OpenAI Codex / GitHub Copilot / Gemini / OpenCode / WorkBuddy / Trae 等 **19 个平台**的适配代码（hooks、插件清单、安装器、平台专属规则与 marketplace 配置），**仅保留并强化 DSH（DeepSeek Harness）路径**：host 半以 `packages/dsh-ssf` 原生工具 `dsh-ssf_*` + 变更状态快照服务接入 Cordis（`ctx.tools` / `ctx.webServer` / `snapshot-store`），client 半以 Spec 工作流 tab 接入 web profile（`GET /dsh-ssf/snapshot` 轮询）。统一指向 [`packages/dsh-ssf/README.md`](https://github.com/cinvymoe/dsh-ssf/blob/main/packages/dsh-ssf/README.md)，不再在 README 与 INSTALL 中维护多平台矩阵与安装命令。

**3. 有什么不变、后续如何同步。** 核心工作流与原项目**完全一致**：9 个 skills、8 状态机、解析/验证引擎（`src/schema` / `src/parsing` / `src/validation`）、模板（`templates/`）、CLI 核心（`scripts/`）与守卫体系均保持一致；DSH 插件只是**执行载体差异**（结构化工具与快照服务替代平台 hooks）。后续 upstream 同步策略：`core` / `skills` / `src` / `templates` / `docs` 等核心持续与上游同步，平台适配层**仅保留 DSH**，不再合回其他平台代码。

**4. 致谢与 rebrand 说明。** 感谢原项目 MageByte-Zero/spec-superflow 的完整设计与实现，以及 OpenSpec 与 Superpowers 两个上游项目提供的引擎与纪律思想。本仓库已完成 rebrand：当前版本 `v1.2.0`，`package.json` 的 `name` 仍为 `spec-superflow` 以保持 `dsh-ssf` / `spec-superflow` CLI 兼容，GitHub 仓库地址为 [`cinvymoe/dsh-ssf`](https://github.com/cinvymoe/dsh-ssf)。
