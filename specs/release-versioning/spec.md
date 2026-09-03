# Release Versioning 规格

## MODIFIED Requirements

### Requirement: 功能完成后统一准备 v0.11.0

发布准备 SHALL 在 Issue #70 功能实现、测试和聚焦评审完成后、最终 `executing -> closing` 转换前，把所有受版本同步工具管理的 manifests、文档、hooks、phase guards、prompts 与九个 canonical skills 统一更新为 `0.11.0`，并将自 v0.10.0 起的变更整理进 CHANGELOG。

#### Scenario: 执行统一版本同步

- **WHEN** Issue #70 功能已通过完整验证并执行 `ssf version 0.11.0`
- **THEN** version consistency 与 doctor 通过，版本 dry-run 不再报告待更新文件

#### Scenario: CHANGELOG 汇总发布内容

- **WHEN** 生成 v0.11.0 release candidate
- **THEN** CHANGELOG 包含 #47、#64、#65、#71 和 #70，并保留新的空 Unreleased 区段

### Requirement: 发布准备不自动发布

发布准备 MUST 不创建 git tag、不执行 npm publish、GitHub Release 或外部 marketplace 写操作，除非维护者另行明确授权。

#### Scenario: release candidate 验证完成

- **WHEN** 本地与 GitHub CI 发布检查全部通过
- **THEN** 系统只提交 ready-for-review PR，并等待维护者授权实际发布动作
