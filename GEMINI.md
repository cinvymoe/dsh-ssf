# spec-superflow

Use the bundled agent skills in `skills/` to run the spec-superflow workflow.

Start from `workflow-start` when a user wants to start, continue, resume, plan, implement, review, debug, close, or inspect a spec-superflow change.

The workflow is self-contained and does not require OpenSpec or Superpowers at runtime. It uses OpenSpec-style planning artifacts and Superpowers-style execution discipline through the `execution-contract.md` handoff.


<!-- spec-superflow-phase-guard-start -->
# Phase Guard

**当前阶段**: executing | **工作流**: full

## ✅ 允许操作
- 按 execution-contract.md 和 current execution plan 的 wave 执行任务
- 运行测试
- 提交代码（按 batch 提交）
- full/hotfix 每个完成 wave 后记录 wave review 的 review receipt（pass 或 fail）；tweak 免除此 plan/receipt gate

## ⛔ 禁止操作
- 修改 proposal.md, specs/, design.md（需先回退到 specifying）
- 修改 execution-contract.md（需先回退到 bridging）
- 跳过测试步骤
- full/hotfix 不得跳过 wave review；没有所有 pass review receipts 不得进入 closing；tweak 免除此 plan/receipt gate

## 🔔 决策点
- DP-5: 调试升级 — 3+ 修复失败后需用户决定
<!-- spec-superflow-phase-guard-end -->
