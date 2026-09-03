// Archived: non-DSH platform, DSH-only distribution — see docs/archive/non-dsh-platforms/cmd-install-cursor.mjs (original archived, placeholder retains path for test compatibility)
// Original archived to docs/archive/non-dsh-platforms/scripts/lib/cmd-install-cursor.mjs
// ssf install-cursor — deploy spec-superflow skills/rules/scripts for Cursor Agent
// Delegates to scripts/install-cursor.mjs
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const installScript = join(__dirname, '..', 'install-cursor.mjs');

export async function run(args) {
  execFileSync(process.execPath, [installScript, ...args], {
    stdio: 'inherit',
  });
}
