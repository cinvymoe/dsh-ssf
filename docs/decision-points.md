# Decision Points Protocol

本文档集中定义了 spec-superflow 工作流中所有需要用户明确确认的决策点。每个决策点（Decision Point）都是工作流中的关键门禁，确保用户在自动化流程中始终保持最终决策权。工作流中的 skill 在到达决策点时必须暂停执行、向用户呈现所需信息，并等待明确指令后方可继续。

## 总则

**所有 DP-0~DP-7 的用户决策必须通过结构化 ask_user_question 完成，禁止自由文本 ask。**
- 所有 DP-0~DP-7 的用户决策必须通过 ask_user_question 结构化提问完成，禁止自由文本 ask。禁止使用自由文本提问、口头确认或通用 state set 直写来替代结构化提问。
- 每个 question 必须包含 id（dp-N-*）、header（DP-N xxx）、question、options（推荐项置首加 (Recommended)）、multi_select:false。示例：`{id:"dp-N-xxx", header:"DP-N xxx", question:"...", options:[{label:"... (Recommended)", description:"..."}, {label:"...", description:"..."}], multi_select:false}`，推荐项必须置首并加 ` (Recommended)` 后缀，其余项不加。
- answers 的 selected 原样写入对应 dp_*_result 字段，guard 校验非空。`answers["dp-N-xxx"]` 的选中值原样写入 `dp_N_result`（如 `dp_0_result`/`dp_1_result`/.../`dp_7_result`），`ssf_guard` 与状态流转前置校验该字段非空，未记录则阻断流转。
- 即使 DP-0 豁免路径（Quick、direct Hotfix、Tweak）也需经 ask_user_question 确认，禁止跳过提问直接写入结果或以 receipt 替代确认。

## DP-0: 设计前确认（User Confirmation Gate）

- **编号**：DP-0
- **名称**：设计前确认
- **触发条件**：Full 或 legacy change 在 planning 前触发；Quick、direct Hotfix、Tweak 不等待 DP-0，先记录可验证 recommendation/direct receipt 后执行。即使豁免也需经 ask_user_question 确认，禁止自由文本确认或跳过确认直接执行。
- **所需输入**：变更名称与意图、已知约束（命名风格、兼容性、受影响平台）、是否包含相关优化、用户沟通偏好；以及最少路径事实（任务数、文件数、是否仅配置/文档、是否涉及 schema/API、新模块和不确定性）
- **路径选择协议**：低风险 Quick 与 incident Hotfix 同轮展示 recommendation 后，由用户选择 `tdd`、`new-test` 或 `bounded`，再运行 `ssf workflow accept --source direct-request --verification <strategy>`；其余路径使用 `show`、补齐 missing facts、`recommend` 和 `select --confirm`。direct receipt 代替短路径 DP。
- **短路径收口**：Quick、direct Hotfix、Tweak 以边界内验证摘要和 `test_result: pass` 收口，不写 DP-6 或 DP-7。
- **确认顺序**：可先解析 `artifact_language`，随后必须完成路径 receipt 读取、最少事实补全、建议展示和用户选择；路径摘要与其他 DP-0 决定合并确认后，才可设置 `dp_0_confirmed=true`。
- **预期输出**：完整、防篡改的路径选择 receipt 固定保存在 change overlay 的 `.superpowers/sdd/workflow-selection.json`，用于恢复和审计；`.spec-superflow.yaml` 的 `dp_0_*` 只保存确认结果与幂等的 `workflow_path`/推荐对齐摘要，并保留既有 `scope` 和 `artifact_language`。空目录的 legacy artifact inference 可以返回 `full` 以兼容旧 API，但绝不能替代入口的用户选择。
- **关联 skill**：`spec-superflow:workflow-start`
- **提问规范**：调用 ask_user_question({questions:[{id:"dp-0-change-confirm", header:"DP-0 变更确认", question:"请确认变更名与一句话意图：<name>: <intent>，是否正确？", options:[{label:"确认 (Recommended)", description:"信息正确，进入下一步"}, {label:"需调整", description:"需要修改名称或意图"}], multi_select:false}, {id:"dp-0-workflow", header:"DP-0 工作流选择", question:"请选择工作流路径：观测事实 <facts>，推荐 <recommended>，是否按推荐执行？", options:[{label:"full (Recommended)", description:"完整流程，需完整规划与契约"}, {label:"quick", description:"快速路径，≤3 文件低风险"}, {label:"hotfix", description:"热修复，≤2 文件线上问题"}, {label:"tweak", description:"微调，仅配置/文档 ≤4 文件"}], multi_select:false}]})

## DP-1: 需求确认

- **编号**：DP-1
- **名称**：需求确认
- **触发条件**：need-explorer 完成需求澄清与范围界定之前，用户需要确认最终的 scope 和 capabilities
- **所需输入**：need-explorer 整理的需求摘要、变更范围（scope）、能力清单（capabilities）、约束条件与成功标准
- **预期输出**：用户明确确认需求范围和关键能力，或提出修改意见供 need-explorer 迭代
- **记录值语义**：`dp_1_result` 以 `confirmed:` 开头表示 need-explorer 探索后用户确认；以 `waived:` 开头表示用户明确豁免探索（请求已足够清晰）。
- **门禁**：Full 路径下 guard 对 `exploring → specifying` 强制要求 `dp_1_result` 已记录；快速路径（quick/tweak/hotfix/lightweight）豁免。
- **关联 skill**：`spec-superflow:need-explorer`
- **提问规范**：调用 ask_user_question({questions:[{id:"dp-1-requirement", header:"DP-1 需求确认", question:"请确认以下范围是否正确：问题：<problem>，范围：<scope>，非目标：<non-goals>，验收标准：<criteria>，是否确认进入规格编写？", options:[{label:"确认 (Recommended)", description:"范围正确进入下一阶段"}, {label:"需调整", description:"需要修改范围或目标"}], multi_select:false}]})

## DP-2: 工件审查

- **编号**：DP-2
- **名称**：工件审查
- **触发条件**：spec-writer 完成全部规划工件的创建或更新后，用户需要审查产出的完整性和质量
- **所需输入**：spec-writer 产出的 `proposal.md`、`specs/` 目录下的规格文档、`design.md` 设计文档、`tasks.md` 任务清单
- **预期输出**：用户审查通过并批准全部工件，或指出需要修改的具体内容和方向
- **关联 skill**：`spec-superflow:spec-writer`
- **提问规范**：调用 ask_user_question({questions:[{id:"dp-2-artifacts", header:"DP-2 工件审查", question:"已生成 proposal/specs/design/tasks 四件套，摘要：<summary>。是否批准进入下一阶段？如需修改请选‘需修改’并说明", options:[{label:"批准 (Recommended)", description:"工件完整可进入契约"}, {label:"需修改", description:"需要调整工件内容"}], multi_select:false}]})

## DP-3: 契约批准

- **编号**：DP-3
- **名称**：契约批准
- **触发条件**：仅 Full 或 legacy Hotfix 的 contract-builder 生成契约后触发；Quick/direct Hotfix/Tweak 不适用。
- **所需输入**：`execution-contract.md` 全文，包含执行批次、任务依赖、验收标准、回滚策略
- **预期输出**：用户明确批准（approve）执行契约，或提出修改要求；未获批准前 build-executor 不得启动
- **关联 skill**：`spec-superflow:contract-builder`
- **提问规范**：调用 ask_user_question({questions:[{id:"dp-3-contract", header:"DP-3 契约批准", question:"契约已生成，移交规则：<handoff rules>，未映射需求：<unmapped>，是否存在歧义？是否批准契约进入执行？", options:[{label:"批准 (Recommended)", description:"契约准确可执行"}, {label:"需修改", description:"契约需要调整"}], multi_select:false}]})

## DP-4: 执行模式选择

- **编号**：DP-4
- **名称**：执行模式选择
- **触发条件**：仅 Full 或 legacy Hotfix 在 build-executor 启动前选择执行模式；Quick/direct Hotfix/Tweak 不适用。
- **所需输入**：已批准的 `execution-contract.md`、项目测试基础设施现状，以及 `ssf execution recommend` 提供的执行模式证据与建议
- **预期输出**：用户明确选择 `Inline`、`Batch Inline` 或 `SDD` 执行模式，build-executor 据此创建受确认的执行计划。DP-4 不重新选择 DP-0 已确认的 `full`、`hotfix` 或 `tweak` 路径。
- **关联 skill**：`spec-superflow:build-executor`
- **提问规范**：调用 ask_user_question({questions:[{id:"dp-4-mode", header:"DP-4 执行模式选择", question:"已生成波次建议：<waves>，观测事实：<facts>，推荐模式：<recommended>。请选择执行模式", options:[{label:"SDD (Recommended)", description:"子代理驱动分批，适合多波次/并行"}, {label:"Inline", description:"单代理线性，适合单任务顺序"}, {label:"Batch Inline", description:"批量线性，适合有界顺序批次"}], multi_select:false}]})

## DP-5: 调试升级

- **编号**：DP-5
- **名称**：调试升级
- **触发条件**：bug-investigator 连续 3 次或更多修复尝试失败后，无法自动解决当前问题
- **所需输入**：失败日志、每次修复尝试的具体方案与结果、错误根因分析、剩余可行方案（如有）
- **证据门禁**：每次失败修复必须通过 `ssf debug attempt record` 写入结构化 ledger，包含唯一 attempt id、摘要和 change 目录内的物理证据文件。所有路径都必须先有 current、有效的 execution plan；缺失、陈旧或不匹配的 plan 会被拒绝。Wave Review 的 repair failure 不计入 debugging attempt；重复证据也会被拒绝。
- **预期输出**：至少 3 次不同且证据完整的失败尝试后，用户决定继续调试或放弃；仅 `ssf debug escalate ... --confirm` 可以持久化 DP-5，通用 `state set` 不可写入 `dp_5_*`。
- **关联 skill**：`spec-superflow:bug-investigator`
- **提问规范**：调用 ask_user_question({questions:[{id:"dp-5-escalate", header:"DP-5 调试升级", question:"已连续3次修复失败，尝试记录：<attempts>，证据：<evidence>。请选择后续策略", options:[{label:"继续 (Recommended)", description:"继续尝试修复，调整方案"}, {label:"放弃", description:"放弃当前变更，标记为 abandoned"}], multi_select:false}]})

## DP-6: 验证失败

- **编号**：DP-6
- **名称**：验证失败
- **触发条件**：release-archivist 在执行收尾验证时发现验证项未通过
- **所需输入**：验证报告（包含通过项与失败项）、失败项的具体差异说明、原始规格要求与实际实现的对比
- **预期输出**：用户决定返回修复失败项（重新进入执行阶段）或放弃验证直接关闭变更
- **关联 skill**：`spec-superflow:release-archivist`
- **提问规范**：调用 ask_user_question({questions:[{id:"dp-6-verification", header:"DP-6 验证处置", question:"验证结果：FAIL，证据：<evidence>。请选择处置方式", options:[{label:"返修复 (Recommended)", description:"返回 executing 修复后重验"}, {label:"放弃关闭", description:"放弃归档，标记 abandoned"}], multi_select:false}]})

## DP-7: 归档确认

- **编号**：DP-7
- **名称**：归档确认
- **触发条件**：release-archivist 完成归档准备和 delta spec 合并方案后，用户确认最终归档操作
- **所需输入**：变更总结报告、delta spec 合并方案（哪些增量规格将合并到主规格基线）、归档文件清单
- **预期输出**：用户确认归档并批准 delta spec 合并，或要求调整合并范围后再执行
- **关联 skill**：`spec-superflow:release-archivist`
- **提问规范**：调用 ask_user_question({questions:[{id:"dp-7-archive", header:"DP-7 归档确认", question:"已完成验证与审计，归档摘要：<archive summary>，是否确认归档并合并 delta specs？", options:[{label:"确认归档 (Recommended)", description:"确认关闭并归档"}, {label:"调整范围", description:"需要调整归档范围"}], multi_select:false}]})

## 决策点与 Skill 映射总览

| 编号 | 名称 | 关联 Skill | 阶段 |
|------|------|------------|------|
| DP-0 | 设计前确认 | `spec-superflow:workflow-start` | 入口 |
| DP-1 | 需求确认 | `spec-superflow:need-explorer` | 探索 |
| DP-2 | 工件审查 | `spec-superflow:spec-writer` | 规划 |
| DP-3 | 契约批准 | `spec-superflow:contract-builder` | 桥接 |
| DP-4 | 执行模式选择 | `spec-superflow:build-executor` | 执行 |
| DP-5 | 调试升级 | `spec-superflow:bug-investigator` | 执行 |
| DP-6 | 验证失败 | `spec-superflow:release-archivist` | 收尾 |
| DP-7 | 归档确认 | `spec-superflow:release-archivist` | 收尾 |
