// ssf install-qoder — deploy spec-superflow for Qoder. Delegates to scripts/install-qoder.mjs
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const installScript = join(__dirname, '..', 'install-qoder.mjs');

export async function run(args) {
  execFileSync(process.execPath, [installScript, ...args], { stdio: 'inherit' });
}
