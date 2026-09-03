# Workflow Entry Routing 规格

## MODIFIED Requirements

### Requirement: 入口路由先完成需求路径选择

`workflow-start` SHALL 在 workflow 为 `auto`、空或未设置时，先读取已有 workflow selection receipt，只询问 `missing_facts` 对应的最少问题，展示 Observed、Available、Recommended 与 Why，并在用户明确选择后调用受保护的 select；不得把 recommendation 自动持久化为最终 workflow。

#### Scenario: 新需求尚无规划工件

- **WHEN** 用户提出新需求且 proposal/tasks 尚不存在，workflow 仍为 `auto`
- **THEN** 入口路由收集分类事实并请求用户选择，而不是调用无工件推断后默认进入 full

#### Scenario: 恢复未完成的事实收集

- **WHEN** overlay 中存在 `needs-input` receipt
- **THEN** 入口路由复用已观察事实，只询问 receipt 列出的缺失项并重新生成完整事实快照

#### Scenario: 用户选择非推荐路径

- **WHEN** 用户明确选择与 recommendation 不同的 workflow
- **THEN** 入口路由说明偏离并在用户确认后传入 `--acknowledge-recommendation`

### Requirement: 需求路径与执行模式保持分离

`workflow-start` MUST 将 full/hotfix/tweak 作为 DP-0 需求路径决定，将 Inline/Batch Inline/SDD 继续作为 DP-4 执行模式决定，不得互相替代批准或 receipt。

#### Scenario: 已选择 full 后进入执行规划

- **WHEN** 用户在入口选择 `full`，规划工件和执行契约随后获批
- **THEN** DP-4 仍单独运行 execution recommend/plan 并要求用户选择执行模式

### Requirement: runtime infer 保持向后兼容

系统 SHALL 保持 `ssf runtime infer <change-dir>` 的既有 artifact-based 推断结果，供现有调用方兼容使用，但入口用户选择不得由该命令替代。

#### Scenario: 旧调用方推断空目录

- **WHEN** 旧调用方直接对无规划工件的 change 运行 `runtime infer`
- **THEN** 命令继续返回既有 safe-default full 结果，而新版 workflow-start 不将该结果视为用户选择
