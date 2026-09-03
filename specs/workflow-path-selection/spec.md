# Workflow Path Selection 规格

## ADDED Requirements

### Requirement: 用户确认后才选择 workflow

系统 MUST 在存在有效且信息充分的 recommendation receipt、用户传入 `--confirm` 和非空单行理由后，才把所选路径写入 `state.workflow`；推荐命令不得代替该确认。

#### Scenario: 确认推荐路径

- **WHEN** 当前 receipt 推荐 `hotfix`，用户选择 `hotfix` 并显式确认
- **THEN** 系统把 workflow 设置为 `hotfix`，记录用户理由和 `followed_recommendation=true`

#### Scenario: 缺少确认

- **WHEN** 用户选择路径但未传入 `--confirm`
- **THEN** 系统拒绝选择，receipt、state 和 DP-0 保持不变

### Requirement: 非推荐选择需要额外确认

系统 MUST 允许用户选择任意可用的非推荐路径，但必须要求 `--acknowledge-recommendation`，并记录选择理由与风险确认。

#### Scenario: 未确认非推荐选择

- **WHEN** receipt 推荐 `hotfix`，用户选择 `full` 但未确认偏离推荐
- **THEN** 系统拒绝选择且不修改任何持久化状态

#### Scenario: 已确认非推荐选择

- **WHEN** receipt 推荐 `hotfix`，用户选择 `full`、显式确认并确认偏离推荐
- **THEN** 系统选择 `full`，记录 `followed_recommendation=false` 和 `acknowledged_non_recommendation=true`

### Requirement: 选择证据可验证、可恢复、可审计

系统 SHALL 将 observation、recommendation、selection、时间戳和稳定 SHA-256 hash 保存到 change overlay，并将不覆盖既有范围与语言决定的 workflow 摘要追加到 DP-0。

#### Scenario: receipt 被篡改

- **WHEN** 已保存 receipt 的事实或选择在未重算 hash 的情况下被修改
- **THEN** `workflow show` 报告 hash 无效，`workflow select` 拒绝使用该证据

#### Scenario: state 写入前中断

- **WHEN** receipt 已记录选择但 `state.workflow` 仍为 `auto`
- **THEN** `workflow show` 返回 `selection-pending`，允许相同选择安全重试，不把它当作已完成选择

#### Scenario: DP-0 已包含范围和语言决定

- **WHEN** workflow 选择成功且 `dp_0_decisions` 已包含 scope 与 `artifact_language=zh-CN`
- **THEN** 系统保留原决定并追加唯一的 `workflow_path`、recommended 和 followed_recommendation 摘要

### Requirement: 显式 workflow 优先

系统 MUST 尊重 state 中已显式设置的 `full`、`hotfix` 或 `tweak`，不得重复推荐或覆盖。

#### Scenario: 已显式选择 full

- **WHEN** `state.workflow` 已为 `full` 且调用 recommend 或 show
- **THEN** 系统返回 `source=explicit-state` 与 `workflow=full`，不创建新的 recommendation receipt
