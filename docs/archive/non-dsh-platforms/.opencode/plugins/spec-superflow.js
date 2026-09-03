/**
 * spec-superflow plugin for OpenCode.ai
 *
 * Registers skills directory and injects workflow-start bootstrap context
 * at session start, following the same pattern as Superpowers' OpenCode plugin.
 */
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.resolve(__dirname, '../../skills');

// Module-level caches
let _bootstrapCache = undefined;
let _recoveryCache = { value: null, timestamp: 0 };

const RECOVERY_TTL = 5 * 60 * 1000; // 5 minutes
const CLI_PATH = path.resolve(__dirname, '../../scripts/spec-superflow.mjs');
const RECOGNIZABLE_ARTIFACTS = [
  '.spec-superflow.yaml',
  'proposal.md',
  'tasks.md',
  'execution-contract.md',
];

const getBootstrapContent = () => {
  if (_bootstrapCache !== undefined) return _bootstrapCache;

  // Read GEMINI.md as the bootstrap context (shared across platforms)
  const geminiMd = path.resolve(__dirname, '../../GEMINI.md');
  if (!fs.existsSync(geminiMd)) {
    _bootstrapCache = null;
    return null;
  }

  const content = fs.readFileSync(geminiMd, 'utf8');

  _bootstrapCache = `<EXTREMELY_IMPORTANT>
You have spec-superflow installed.

${content}

**Tool Mapping for OpenCode:**
When skill instructions reference tools, substitute OpenCode equivalents:
- Read files → \`read\`
- Create, edit, or delete files → \`apply_patch\`
- Run shell commands → \`bash\`
- Search files → \`grep\`, \`glob\`
- Fetch a URL → \`webfetch\`
- Create or update todos → \`todowrite\`
</EXTREMELY_IMPORTANT>`;

  return _bootstrapCache;
};

/**
 * Find an active spec-superflow change in the given working directory.
 * Checks CWD directly and the changes/ subdirectory.
 * Returns the change directory path or null.
 */
const findActiveChange = (cwd) => {
  try {
    // Check CWD directly for recognizable artifacts
    if (RECOGNIZABLE_ARTIFACTS.some(artifact => fs.existsSync(path.join(cwd, artifact)))) {
      return cwd;
    }

    // Check changes/ subdirectory for recognizable change directories
    const changesDir = path.join(cwd, 'changes');
    if (fs.existsSync(changesDir) && fs.statSync(changesDir).isDirectory()) {
      const candidates = fs.readdirSync(changesDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(changesDir, entry.name))
        .filter(changeDir => RECOGNIZABLE_ARTIFACTS.some(artifact => fs.existsSync(path.join(changeDir, artifact))));

      if (candidates.length === 1) return candidates[0];

      // Multiple candidates — prefer non-terminal ones
      const active = candidates.filter(changeDir => {
        try {
          const statePath = path.join(changeDir, '.spec-superflow.yaml');
          if (!fs.existsSync(statePath)) return true;
          const content = fs.readFileSync(statePath, 'utf-8');
          return !content.includes('state: closing') && !content.includes('state: abandoned');
        } catch {
          return true;
        }
      });
      if (active.length >= 1) return active[0];
    }

    return null;
  } catch {
    return null;
  }
};

/**
 * Run ssf resume --compact --json to get recovery context text.
 * Caches the result per session with a 5-minute TTL.
 * Returns the compact_text string or null on failure.
 */
const getRecoveryContext = (changeDir) => {
  const now = Date.now();
  if (_recoveryCache.value !== null && (now - _recoveryCache.timestamp) < RECOVERY_TTL) {
    return _recoveryCache.value;
  }

  try {
    const result = execSync(`node "${CLI_PATH}" resume "${changeDir}" --compact --json`, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(result.trim());
    const compactText = parsed.compact_text || null;
    _recoveryCache = { value: compactText, timestamp: now };
    return compactText;
  } catch {
    _recoveryCache = { value: null, timestamp: now };
    return null;
  }
};

export const SpecSuperflowPlugin = async (_opts) => {
  return {
    // Register skills directory so OpenCode discovers spec-superflow skills
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }
    },

    // Inject recovery context and/or bootstrap into user messages after compaction
    'experimental.chat.messages.transform': async (_input, output) => {
      if (!output.messages.length) return;
      const firstUser = output.messages.find(m => m.info.role === 'user');
      if (!firstUser || !firstUser.parts.length) return;
      const firstTextPart = firstUser.parts[0];

      // 1. Inject bootstrap context if not already present (idempotency via EXTREMELY_IMPORTANT)
      const hasBootstrap = firstUser.parts.some(
        p => p.type === 'text' && p.text.includes('EXTREMELY_IMPORTANT'),
      );
      if (!hasBootstrap) {
        const bootstrap = getBootstrapContent();
        if (bootstrap) {
          firstUser.parts.unshift({ ...firstTextPart, type: 'text', text: bootstrap });
        }
      }

      // 2. Inject recovery context if an active change is detected and no recovery context exists yet
      const hasRecovery = firstUser.parts.some(
        p => p.type === 'text' && p.text.includes('SPEC_SUPERFLOW_RECOVERY'),
      );
      if (!hasRecovery) {
        try {
          const cwd = process.cwd();
          const activeChange = findActiveChange(cwd);
          if (activeChange) {
            const recoveryText = getRecoveryContext(activeChange);
            if (recoveryText) {
              // Insert after bootstrap (which is now at index 0 if we just injected it, or already at 0)
              const bootstrapPresent = firstUser.parts.some(
                p => p.type === 'text' && p.text.includes('EXTREMELY_IMPORTANT'),
              );
              const insertAt = bootstrapPresent ? 1 : 0;
              firstUser.parts.splice(insertAt, 0, {
                ...firstTextPart,
                type: 'text',
                text: recoveryText,
              });
            }
          }
        } catch {
          // Recovery injection is best-effort — never break the main flow
        }
      }
    },

    // Inject preservation context before compaction runs
    'experimental.session.compacting': async (_input, output) => {
      try {
        const cwd = process.cwd();
        const activeChange = findActiveChange(cwd);
        if (!activeChange) return;

        output.context = output.context || [];
        output.context.push(
          `IMPORTANT: This conversation involves a spec-superflow change. When summarizing, preserve:
- The change name and directory path
- The current workflow state (exploring/specifying/bridging/executing/debugging/closing)
- The current workflow mode (full/hotfix/tweak)
- Which artifacts exist and their completion status
- Current execution progress (batch/wave/task being worked on)
- Any unresolved decision points
Do NOT discard this context — it is critical for the agent to resume work correctly after compaction.`,
        );
      } catch {
        // Compacting hook is best-effort — never break compaction
      }
    },
  };
};
