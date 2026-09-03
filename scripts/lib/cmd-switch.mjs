import { runRecoveryCommand } from './recovery-command.mjs';

export async function run(args) {
  await runRecoveryCommand('switch', args, { requireTarget: true });
}
