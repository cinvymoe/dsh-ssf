# 需求入口工作流路径推荐设计

## 背景与目标

Issue #70 要解决的是需求入口阶段的错误默认：当 `proposal.md` 和
`tasks.md` 尚未生成时，现有 `ssf runtime infer <change-dir>` 看不到任务和
文件证据，只能安全地返回 `full`。这会在用户尚未选择前，把“信息缺失”
误当成“需求复杂”。

本设计在 DP-0 附近增加一个独立的需求路径推荐控制面。系统先收集分类所需
的最少事实，再展示 `full`、`hotfix`、`tweak` 三种可选路径、推荐结果和
理由，最后由用户明确选择。推荐不会自动成为最终 workflow。

该控制面与 DP-4 的 Inline、Batch Inline、SDD 执行模式推荐完全分离，也
不改变三种 workflow 的现有阈值或状态转换门禁。

## 方案选择

采用独立的 `ssf workflow recommend/select/show` 命令组。

没有采用扩展 `runtime infer` 的方案，因为 `runtime infer` 的职责是根据已
存在的规划工件做兼容性推断，而新功能处理的是工件生成前的用户决策。把
推荐、确认和持久化塞进 infer 会混淆“观察”与“决定”。

没有采用纯 skill 提示词方案，因为它无法提供稳定的 receipt、恢复校验和
CLI 行为测试，也不能可靠证明用户选择没有被自动覆盖。

## 用户流程

1. `workflow-start` 读取 state。若 workflow 已显式为 `full`、`hotfix` 或
   `tweak`，直接尊重该值，不再推荐。
2. workflow 为 `auto`、空或未设置时，skill 只询问当前缺失的分类事实。
3. skill 调用 `ssf workflow recommend` 保存观察事实和推荐 receipt。
4. 命令返回全部可选路径、推荐路径、事实、理由和缺失事实。
5. 信息不足时返回 `needs-input`，保持 workflow 为 `auto`，skill 继续询问
   缺失项。
6. 信息充分时，用户选择一个路径。skill 调用 `ssf workflow select --confirm`。
7. 非推荐选择还必须传入 `--acknowledge-recommendation`，并保存用户理由。
8. select 在完成全部验证后保存选择，把 state.workflow 设置为所选路径，并
   把可审计摘要追加到 `dp_0_decisions`，不覆盖已有的范围和语言决定。

示例：

```text
Observed: 2 tasks, 2 files, config/doc only: no,
          schema/API/public interface: no, new module: no,
          uncertainty: low
Available: full | hotfix | tweak
Recommended: hotfix
Why: bounded code change within hotfix thresholds
Choose a workflow:
```

## CLI 接口

### `ssf workflow recommend`

```bash
ssf workflow recommend <change-dir> \
  --task-count <non-negative-integer> \
  --file-count <non-negative-integer> \
  --config-doc-only <yes|no|unknown> \
  --schema-api-change <yes|no|unknown> \
  --new-module <yes|no|unknown> \
  --uncertainty <low|high|unknown> \
  [--json]
```

每次调用都以提供的完整事实快照替换上一份 observation，避免不同轮次的
残缺输入被意外拼接。skill 可先用 `workflow show` 读取上一份 observation，
再补齐用户刚回答的字段后重新 recommend。

计数缺失或标志为 `unknown` 时，返回 `status: needs-input` 和
`missing_facts`。此结果可以持久化，但不得产生可选择的 recommendation。

### `ssf workflow select`

```bash
ssf workflow select <change-dir> \
  --mode <full|hotfix|tweak> \
  --confirm \
  --reason <single-line-text> \
  [--acknowledge-recommendation] \
  [--json]
```

select 必须验证：

- state.workflow 仍为 `auto`、空或未设置；
- 当前 receipt 信息充分且 hash 有效；
- mode 是三个可选路径之一；
- `--confirm` 已提供；
- 非推荐选择已显式确认；
- reason 非空，且不含换行或控制字符。

任一验证失败时，不得修改 receipt、state 或 DP-0。

### `ssf workflow show`

输出当前 observation、推荐、选择、hash 有效性及 state 中的最终 workflow。
如果用户此前已显式设置 workflow 且没有 receipt，输出
`source: explicit-state`，而不是要求重新推荐。

## 事实模型与推荐算法

事实快照包含：

- `task_count`
- `file_count`
- `config_doc_only`
- `schema_api_change`，同时代表 schema、API 或公共接口变化
- `new_module`
- `uncertainty`

推荐顺序为：

1. 任一关键事实未知：`needs-input`，不推荐路径。
2. `schema_api_change=yes`、`new_module=yes` 或 `uncertainty=high`：推荐
   `full`。
3. `config_doc_only=yes`、任务数不超过 4、文件数不超过 4：推荐 `tweak`。
4. `config_doc_only=no`、任务数不超过 2、文件数不超过 2：推荐 `hotfix`。
5. 其余充分信息：推荐 `full`。

所有成功推荐都返回可核对的 reasons。算法复用现有阈值的常量语义，不修改
guard 的 workflow 转换矩阵。

## 持久化与审计

详细记录保存到 change overlay：

```text
<change-dir>/.superpowers/sdd/workflow-selection.json
```

记录包含：

- schema version；
- 完整 facts；
- available modes；
- status、recommendation、reasons、missing facts；
- created_at；
- receipt hash；
- 用户选择、理由、是否遵循推荐、是否确认非推荐选择；
- selected_at。

写入采用临时文件加 rename，避免部分写入。hash 使用稳定 JSON 和 SHA-256，
读取时重新计算；损坏或被篡改的 receipt 不得用于 select。

成功选择后，在保留原内容的前提下向 `dp_0_decisions` 追加单行摘要：

```text
workflow_path=hotfix; recommended=hotfix; followed_recommendation=true
```

因此现有 `ssf audit` 能通过 DP-0 展示选择摘要，而 `workflow show` 提供完整
事实和 receipt。恢复时 `workflow-start` 先调用 show：未完成的推荐继续收集
事实，已完成的选择直接复用。

## 代码边界

- `scripts/lib/workflow-recommendation.mjs`：纯推荐函数、receipt 读写、hash 和
  select 验证。
- `scripts/lib/cmd-workflow.mjs`：CLI 参数解析、错误码、选择 receipt 与
  state/DP-0 的有序写入和失败恢复。
- `scripts/spec-superflow.mjs`：注册 workflow 命令及 help。
- `skills/workflow-start/SKILL.md`：改为先 show/recommend/select，再执行现有
  路由；`runtime infer` 继续作为已有工件调用方的兼容接口，但不再承担需求
  入口的用户选择。
- `tests/lib/workflow-recommendation.test.mjs`：纯算法和 receipt 测试。
- `tests/lib/cmd-workflow.test.mjs`：CLI、持久化、失败不变异和显式 workflow
  优先测试。
- `tests/lib/infer-workflow.test.mjs`：锁定旧 infer 的向后兼容行为。

不新增 runtime dependency，不新增状态机阶段，不修改 DP-3/DP-4 的批准语义。

## 错误处理

- change state 文件缺失：用法错误并提示先 `state init`，不创建幽灵 state。
- 输入枚举或计数非法：exit 2，不写文件。
- 信息不足：正常业务结果，exit 0，返回 `needs-input`。
- receipt 缺失、过期、hash 不符：select exit 1，不写 state。
- workflow 已显式设置：recommend/show 返回显式来源；select 不覆盖。
- 文件写入失败：使用原子单文件写入；验证失败不产生任何写入。如果 receipt
  已记录选择但 state 写入失败，show 将其报告为 `selection-pending`，允许同一
  选择安全重试，不把未完成选择当作最终 workflow。

## 测试与验收

必须覆盖：

1. 2 tasks / 2 files 的小型代码修复推荐 hotfix；
2. 4 tasks / 4 files 内的纯配置或文档调整推荐 tweak；
3. schema/API/公共接口、新模块、高不确定性或超过阈值推荐 full；
4. 事实未知返回 needs-input，workflow 仍为 auto；
5. 用户选择非推荐路径时，无确认则拒绝，有确认则可审计；
6. 已显式设置 workflow 时不重复推荐或覆盖；
7. receipt hash 损坏、非法参数和失败写入不会改变 state；
8. 现有 `runtime infer` 和三种 workflow guard 行为保持不变；
9. Node 20/22 构建、完整测试、doctor、raw-mode 和发布 smoke 全部通过。

## 发布安排

Issue #70 功能实现和聚焦评审完成后、最终 `executing -> closing` 转换前，执行
`ssf version 0.11.0`，将 Unreleased 内容整理为 `0.11.0` 发布项，同步 README、
英文 README、安装文档、全部 manifests 和九个 canonical skills。随后完成
全分支评审、spec merge 和 closing；发布 PR 使用 `Closes #70`。

发布准备不包含创建 tag、npm publish、GitHub Release 或外部 marketplace
写操作；这些动作继续等待维护者单独授权。
