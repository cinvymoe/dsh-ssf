# Workflow Path Recommendation 规格

## ADDED Requirements

### Requirement: 基于完整入口事实生成路径推荐

系统 SHALL 根据任务数、文件数、是否仅配置或文档、是否涉及 schema/API/公共接口、是否新增模块和不确定性等级，返回 `full`、`hotfix`、`tweak` 全部可选路径、一个推荐路径及可核对理由；推荐本身不得修改 `state.workflow`。

#### Scenario: 小型代码修复推荐 hotfix

- **WHEN** 入口事实为不超过 2 个任务、不超过 2 个文件、非纯配置或文档、不涉及 schema/API/公共接口、不新增模块且不确定性低
- **THEN** 系统推荐 `hotfix`，同时返回三种可选路径，并保持 `state.workflow` 为 `auto`

#### Scenario: 小型配置或文档调整推荐 tweak

- **WHEN** 入口事实为不超过 4 个任务、不超过 4 个文件、仅配置或文档、不涉及 schema/API/公共接口、不新增模块且不确定性低
- **THEN** 系统推荐 `tweak`，并说明该事实位于 tweak 阈值内

#### Scenario: 风险或规模要求完整路径

- **WHEN** 入口事实包含 schema/API/公共接口变化、新模块、高不确定性，或超过 fast-path 阈值
- **THEN** 系统推荐 `full`，并在理由中指出触发的风险或规模事实

### Requirement: 信息不足时继续探索

系统 MUST 将缺失计数或 `unknown` 分类事实返回为 `needs-input` 和稳定排序的 `missing_facts`，不得在信息不足时默认推荐或选择 `full`。

#### Scenario: 缺少文件数和接口风险事实

- **WHEN** 用户已提供任务数，但文件数缺失且 schema/API/公共接口事实为 `unknown`
- **THEN** 系统返回 `needs-input`、列出 `file_count` 与 `schema_api_change`，不产生 recommendation，也不修改 workflow

### Requirement: 推荐阈值保持兼容

系统 SHALL 保持既有 hotfix 与 tweak 阈值语义，不修改 guard 的 workflow 转换矩阵。

#### Scenario: 现有边界值保持不变

- **WHEN** 输入分别位于 hotfix 的 2 tasks/2 files 边界或 tweak 的 4 tasks/4 files 边界
- **THEN** 推荐结果继续接受对应 fast path，现有状态转换测试保持通过
