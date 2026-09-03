// Archived: non-DSH platform, DSH-only distribution — see docs/archive/non-dsh-platforms/platform-runtime-inventory.mjs (original archived, placeholder retains path for test compatibility)
// Original archived to docs/archive/non-dsh-platforms/scripts/lib/platform-runtime-inventory.mjs
// Runtime distribution contract for every platform claimed in the public docs.
// Modes are intentionally host-agnostic: tests validate the final artifact,
// rather than assuming that every loader injects a plugin-root environment.
export const PLATFORM_RUNTIME_INVENTORY = [
  { id: 'claude-code', modes: ['native-root', 'canonical-fallback'] },
  { id: 'cursor', modes: ['native-root', 'installer-rewrite'] },
  { id: 'codex-cli', modes: ['native-root', 'canonical-fallback'] },
  { id: 'codex-app', modes: ['native-root', 'canonical-fallback'] },
  { id: 'copilot-cli', modes: ['native-root', 'canonical-fallback'] },
  { id: 'gemini-cli', modes: ['native-root', 'canonical-fallback'] },
  { id: 'opencode', modes: ['canonical-fallback'] },
  { id: 'workbuddy', modes: ['native-root', 'installer-rewrite'] },
  { id: 'trae', modes: ['native-root', 'canonical-fallback'] },
  { id: 'cline', modes: ['installer-rewrite'] },
  { id: 'kiro', modes: ['installer-rewrite'] },
  { id: 'windsurf', modes: ['installer-rewrite'] },
  { id: 'qwen', modes: ['installer-rewrite'] },
  { id: 'amazon-q', modes: ['installer-rewrite'] },
  { id: 'roocode', modes: ['installer-rewrite'] },
  { id: 'continue', modes: ['installer-rewrite'] },
  { id: 'pi', modes: ['installer-rewrite'] },
];

export const ZCODE_COMPATIBILITY_PATH = {
  id: 'zcode',
  modes: ['installer-rewrite'],
};
