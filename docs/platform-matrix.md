# 平台支持矩阵

> dsh-ssf — DSH 专用发行版

本发行版仅支持 **DeepSeek Harness（dsh-ssf）**，通过 `packages/dsh-ssf` 接入 DSH web profile（host 半 `ssf_*` 原生工具 + 快照服务，client 半 Spec 工作流 tab）。原项目曾支持 19 个平台（Claude Code、Cursor、Codex、Copilot、Gemini、OpenCode、WorkBuddy、Trae 等），现已剥离，相关适配代码与安装器不再提供；如需查看历史实现，请回溯 git 历史 **v1.2.0 之前**的 `docs/platform-matrix.md` 与安装脚本。

核心工作流与原项目完全一致（9 skills、8 状态机、解析/验证引擎、模板、CLI 核心及守卫体系），差异仅在执行载体由多平台适配收敛为 DSH 原生插件。

## 当前支持矩阵

| 平台 | Skills | Rules | Hooks | 安装命令 |
|------|--------|-------|-------|----------|
| DeepSeek Harness | Skills (9) ✅ | Rules（phase-guard via DSH） | Hooks（— via `ssf_*` native tools） | `dsh plugin --profile web add <path>/packages/dsh-ssf` |

- **Skills**：9 个 skill 通过 DSH 插件以结构化工具形式提供，无需平台技能目录拷贝。
- **Rules**：phase-guard 守卫由 DSH 侧规则与 `ssf_guard` / `ssf_validate` 工具保证，不依赖平台自动加载的规则目录。
- **Hooks**：无 SessionStart 钩子注入，上下文与快照通过 `ssf_*` 原生工具与 `GET /dsh-ssf/snapshot` 提供。

> 上述三层均由 DSH 插件在 Cordis 侧统一实现，不再依赖各平台的规则目录或 marketplace 分发。

## 安装 / 升级 / 卸载 速查

| 操作 | 命令 / 步骤 |
|------|-------------|
| 安装 | `dsh plugin --profile web add <path>/packages/dsh-ssf`，并在 `$DSH_HOME/profiles/web/cordis.patch.yml` 追加 `- insert: [{ id: ssf, name: dsh-ssf }]` 后重启 `dsh --profile web` |
| 升级 | `git pull` 更新仓库后重启 profile（symlink 安装自动生效，无需重装） |
| 卸载 | 移除补丁行 + `dsh plugin --profile web remove dsh-ssf` |

> 旧的 `npx spec-superflow install-*` / marketplace 安装方式已移除，统一走 DSH 插件安装。

## 归档说明

原 19 平台的适配层（skills 目录映射、rules 目录/格式、hooks 配置及 `install-*` 安装器）已从本发行版移除，不再维护与发布。平台适配层后续仅保留 DSH，不再合回其他平台代码。

<details>
<summary>已归档：原 19 平台矩阵（仅作历史留存，不再提供安装器）</summary>

原矩阵覆盖 Claude Code、Cursor、OpenAI Codex CLI/App、GitHub Copilot CLI、Gemini CLI、OpenCode、WorkBuddy、CodeBuddy Code CLI、Trae、Cline、Kiro、Windsurf、Qwen Code、Amazon Q Developer、Roo Code、Continue、Pi、Qoder 共 19 个平台，按 Skills / Rules / Hooks 三层接入。完整表格与路径来源（与 comet `src/core/platforms.ts` 交叉核实）见 v1.2.0 前的 git 历史。

归档内容不再作为当前支持矩阵，不提供安装器与 marketplace 配置，仅供溯源。

</details>

> 本文档与 `README.md` / `INSTALL.md` 的 DSH-only 定位一致。详见 `packages/dsh-ssf/README.md`。
