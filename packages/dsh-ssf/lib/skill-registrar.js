// packages/dsh-ssf/lib/skill-registrar.js — spec-superflow skills → DSH runtime skill catalog
//
// Registers the repo's skills/*/SKILL.md entries as runtime skills via
// ctx.skills.register() — no file copies: bodies are read from the repo at
// apply time, `base` points at each skill directory so relative resources
// still resolve, and fiber disposal unregisters everything (uninstall = clean).
// `skills` is conditionally injected like `webServer`/`systemPrompt` so the
// plugin still boots where no skill registry exists. Runtime entries are
// first-wins on duplicate names, so user/project skills keep precedence.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// lib/skill-registrar.js → packages/dsh-ssf/lib → packages/dsh-ssf → packages → repo root → skills/
const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'skills');

/**
 * Parse one SKILL.md into a runtime skill definition. Minimal frontmatter
 * handling (no YAML dependency): the leading `---` block contributes the
 * single-line `name` and `description` fields; everything after the closing
 * `---` is the markdown body. Returns null when any required part is absent.
 * @param {string} fileContent - raw SKILL.md text.
 * @param {string} filePath - the SKILL.md absolute path (recorded on the definition).
 * @returns {{ name: string, description: string, content: string, path: string } | null}
 */
export function parseSkillFile(fileContent, filePath) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(fileContent);
  if (!match) return null;
  let name;
  let description;
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!field) continue;
    if (field[1] === 'name') name = field[2].trim();
    if (field[1] === 'description') description = field[2].trim();
  }
  const content = match[2].trim();
  if (!name || !description || !content) return null;
  return { name, description, content, path: filePath };
}

/**
 * Load every skill definition under the repo skills/ directory. Never throws:
 * a missing/unreadable directory or an unparseable SKILL.md only warns.
 * @param {(message: string) => void} [logWarn] - warning sink.
 * @returns {Array<{ name: string, description: string, content: string, path: string }>}
 */
export function loadSkillDefinitions(logWarn) {
  let entries;
  try {
    if (!existsSync(SKILLS_DIR)) {
      logWarn?.(`skills dir not found: ${SKILLS_DIR}`);
      return [];
    }
    entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch (err) {
    logWarn?.(`skills dir unreadable: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
  const defs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(SKILLS_DIR, entry.name);
    const file = join(dir, 'SKILL.md');
    if (!existsSync(file)) continue;
    let def = null;
    try {
      def = parseSkillFile(readFileSync(file, 'utf8'), file);
    } catch (err) {
      logWarn?.(`skill "${entry.name}": unreadable SKILL.md (${err instanceof Error ? err.message : String(err)}) — skipped`);
      continue;
    }
    if (def) defs.push({ ...def, dir });
    else logWarn?.(`skill "${entry.name}": SKILL.md missing name/description/body — skipped`);
  }
  return defs;
}

/**
 * Register all spec-superflow skills into the DSH skill catalog, when a
 * `skills` registry host is present. Registration failure never breaks boot.
 * @param {object} ctx - cordis context.
 * @param {{ logWarn: (message: string) => void }} deps - warning sink.
 */
export function registerSkills(ctx, { logWarn }) {
  const defs = loadSkillDefinitions(logWarn);
  if (defs.length === 0) return;
  try {
    ctx.inject(['skills'], (skillsCtx) =>
      skillsCtx.effect(() => {
        // SkillRegistration shape (dsh-skill types): `content` (not `body`),
        // `source` is required prompt-visible metadata, `resourceBase` carries
        // the directory for relative resources.
        const disposers = defs.map((def) => skillsCtx.skills.register({
          name: def.name,
          description: def.description,
          content: def.content,
          source: 'runtime',
          path: def.path,
          resourceBase: { kind: 'directory', path: def.dir },
        }));
        return () => {
          for (const dispose of disposers) dispose();
        };
      }, 'dsh-ssf: spec-superflow skills'),
    );
  } catch (err) {
    logWarn(`skill registration failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
