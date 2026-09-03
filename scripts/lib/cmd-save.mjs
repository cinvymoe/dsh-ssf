// Checkpoint-compatible shortcut for recording a task recovery note.
import { parseArgs } from 'node:util';
import { basename, resolve } from 'node:path';
import {
  CHECKPOINT_SAVE_OPTIONS, CheckpointUsageError, saveFromValues,
} from './cmd-checkpoint.mjs';

const USAGE = 'Usage: ssf save <change-dir> --task <id> --next <text>';

export async function run(args) {
  let values = { json: args.includes('--json') };

  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: CHECKPOINT_SAVE_OPTIONS,
    });
  } catch {
    printError(values.json, new CheckpointUsageError(USAGE));
    return;
  }

  values = parsed.values;
  try {

    if (parsed.positionals.length !== 1) {
      throw new CheckpointUsageError(USAGE);
    }

    const changeDir = parsed.positionals[0];
    const checkpoint = saveFromValues(changeDir, values);
    output(values.json, {
      ok: true,
      command: 'save',
      change: { name: basename(changeDir), path: resolve(changeDir) },
      checkpoint,
    }, `Checkpoint saved: ${checkpoint.task_id}`);
  } catch (error) {
    printError(values.json, error);
  }
}

function output(json, payload, message) {
  console.log(json ? JSON.stringify(payload) : message);
}

function printError(json, error) {
  const usage = error instanceof CheckpointUsageError;
  const message = error instanceof Error ? error.message : String(error);
  const payload = {
    ok: false,
    command: 'save',
    error: {
      code: usage ? 'INVALID_ARGUMENTS' : 'CHECKPOINT_SAVE_FAILED',
      message,
      details: {},
    },
  };

  if (json) console.log(JSON.stringify(payload));
  else console.error(usage ? USAGE : `${payload.error.code}: ${message}`);
  process.exitCode = usage ? 2 : 1;
}
