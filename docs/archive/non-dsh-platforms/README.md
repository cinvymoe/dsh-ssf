# Archived Non-DSH Platform Adapters

This directory archives platform-specific adapter code removed for **DSH-only distribution**.

Original repository supported 19 platforms (Claude Code, Cursor, OpenAI Codex, GitHub Copilot, Gemini, OpenCode, WorkBuddy, Trae, Cline, Kiro, Windsurf, Qwen, Amazon Q, Roo Code, Continue, Pi, Qoder, ZCODE, etc). DSH-only distribution retains only:

- `skills/` (9 core skills)
- `src/` / `dist/` (parsing/validation engine)
- `templates/` (artifact templates)
- `docs/` core (state-machine, artifact-contract, decision-points, platform-matrix精简)
- `packages/dsh-ssf/` (DSH plugin complete)
- `scripts/spec-superflow.mjs` + `scripts/lib/` non-install CLI core (`cmd-validate`, `doctor`, `state`, `guard`, `audit`, `checkpoint`, `handoff`, `debug`, `isolate`, `finish`, `sync`, etc.)
- `hooks/session-start` (DSH generic)
- `package.json` (keywords updated to DSH-only)

## Archived Paths

| Original | Archive |
|----------|---------|
| `.claude-plugin/plugin.json` | `.claude-plugin/plugin.json` |
| `.claude-plugin/marketplace.json` | `.claude-plugin/marketplace.json` |
| `.cursor-plugin/*` | `.cursor-plugin/` |
| `.codex-plugin/plugin.json` | `.codex-plugin/plugin.json` |
| `.github/plugin/marketplace.json` | `.github/plugin/marketplace.json` |
| `.opencode/plugins/spec-superflow.js` | `.opencode/plugins/spec-superflow.js` |
| `.opencode/INSTALL.md` | `.opencode/INSTALL.md` |
| `.agents/plugins/marketplace.json` | `.agents/plugins/marketplace.json` |
| `.agents/skills` (symlink) | `.agents/skills` |
| `gemini-extension.json` | `gemini-extension.json` |
| `GEMINI.md` | `GEMINI.md` |
| `hooks/hooks.json` | `hooks/hooks.json` |
| `hooks/hooks-cursor.json` | `hooks/hooks-cursor.json` |
| `hooks/session-start` (original) | `hooks/session-start` |
| `scripts/install-*.mjs` (10+ wrappers) | `scripts/install-*.mjs` |
| `scripts/lib/cmd-install-*.mjs` | `scripts/lib/cmd-install-*.mjs` |
| `scripts/lib/cmd-uninstall-codebuddy.mjs` | `scripts/lib/cmd-uninstall-codebuddy.mjs` |
| `scripts/lib/platforms.mjs` | `scripts/lib/platforms.mjs` |
| `scripts/lib/platform-runtime-inventory.mjs` | `scripts/lib/platform-runtime-inventory.mjs` |
| `scripts/lib/install.mjs` | `scripts/lib/install.mjs` |
| `commands/ssf/resume.md` | `commands/ssf/resume.md` |
| `commands/ssf/switch.md` | `commands/ssf/switch.md` |
| `commands/ssf/save.md` | `commands/ssf/save.md` |

## Placeholder Policy

- **If a file was strongly asserted by tests** (e.g., `scripts/install-cursor.mjs` is asserted by `platform-runtime-distribution.test.mjs`), the original path retains a placeholder with header `// Archived: non-DSH platform, DSH-only distribution` plus original logic for test compatibility. The original is also copied to this archive for history.
- **If a file had no strong test dependency**, it was moved via `git mv` to this archive and a minimal placeholder remains at the original path explaining the archive (or no placeholder if entirely removed). This preserves git history and avoids large-scale test breakage.

## DSH-Only Notes

- `.gitignore` updated: ` .cursor/` entry now notes DSH-only.
- `package.json` keywords: removed `claude-code`, `cursor`, `trae`, `codex`, `gemini-cli`, `copilot-cli`, `opencode`, `workbuddy`; retained `dsh`, `dsh-plugin`, `deepseek-harness`, `spec-driven-development`, `tdd`, `workflow`, `skills`, `contract-driven`.
- `hooks/session-start`: stripped Claude/Cursor/WorkBuddy branching, now DSH generic.
- `scripts/spec-superflow.mjs`: removed 9 weak platform installers from `COMMANDS` and `HELP`; retained 4 archived stubs (`install-cursor`, `install-workbuddy`, `install-zcode`, `install-codebuddy` + `uninstall-codebuddy`) for backward compatibility, see archive.

See git history for full original content: `git log --follow -- docs/archive/non-dsh-platforms/<path>` or browse `git show HEAD:<path>`.

