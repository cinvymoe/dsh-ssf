import { runRecoveryCommand } from './recovery-command.mjs';

export async function run(args) {
  await runRecoveryCommand('resume', args);
}
