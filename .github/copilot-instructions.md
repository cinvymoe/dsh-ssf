# Phase Guard

**当前阶段**: approved-for-build | **工作流**: full

## ✅ 允许操作
- 运行 ssf execution recommend <change-dir> [--wave ...]，完成 DP-4 执行模式选择，列出可用模式与推荐并写入当前推荐凭据
- 向用户展示候选项、项目事实与推荐，取得明确选择
- 运行 ssf execution plan <change-dir> --mode <mode> --confirm ... 生成 execution plan；它必须使用匹配当前 artifact、contract 和 wave 的推荐凭据，非推荐选择需 --acknowledge-recommendation
- 运行 ssf execution show <change-dir> --json 核对 current、revision、mode、waves[].eligible 和 receipts
- 准备执行环境

## ⛔ 禁止操作
- full/hotfix 没有 current execution plan 时不得开始实现或转换到 executing；tweak 免除此 plan/receipt gate
- 修改 execution-contract.md（需回退到 bridging）
- 修改 proposal.md, specs/, design.md, tasks.md

## 🔔 决策点
- DP-4 执行模式选择：先运行 execution recommend 并展示可用模式和推荐；用户用 --confirm 确认，非推荐选择额外使用 --acknowledge-recommendation。plan/revise 需要当前匹配的推荐凭据。仅当 execution show 报告 current: true 后才可转换到 executing；tweak 免除此 plan/receipt gate