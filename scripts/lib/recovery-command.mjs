import { parseArgs } from 'node:util';
import { RecoveryError, createRecoverySummary, resolveChangeTarget } from './change-recovery.mjs';

const USAGE = {
  resume: 'Usage: ssf resume [change-dir] [--json] [--compact]',
  switch: 'Usage: ssf switch <change-dir> [--json]',
};

export async function runRecoveryCommand(command, args, { requireTarget = false } = {}) {
  let values = { json: args.includes('--json'), compact: args.includes('--compact') };

  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        json: { type: 'boolean', default: false },
        compact: { type: 'boolean', default: false },
      },
    });
  } catch {
    printRecoveryError(
      command,
      new RecoveryError('INVALID_ARGUMENTS', USAGE[command], {}, 2),
      values.json,
      { usage: true },
    );
    return;
  }

  values = parsed.values;
  const { json, compact } = values;
  try {

    if (parsed.positionals.length > 1) {
      throw new RecoveryError(
        'INVALID_ARGUMENTS',
        `${command} accepts at most one change target`,
        { positionals: parsed.positionals },
        2,
      );
    }

    if (requireTarget && !hasExplicitTarget(parsed.positionals[0])) {
      throw new RecoveryError(
        'TARGET_REQUIRED',
        'switch requires an explicit change target',
        {},
        2,
      );
    }

    const selection = resolveChangeTarget(parsed.positionals[0], process.cwd());
    const summary = createRecoverySummary(selection.path);
    const enriched = {
      ok: summary.ok,
      command,
      change: { ...summary.change, ...selection },
      state: summary.state,
      workflow: summary.workflow,
      terminal: summary.terminal,
      checkpoint: summary.checkpoint,
      handoffs: summary.handoffs,
      execution: summary.execution,
      blockers: summary.blockers,
      next_action: summary.next_action,
      continuation: summary.continuation,
    };

    if (compact) {
      const compactText = buildCompactRecoveryText(enriched);
      if (json) {
        console.log(JSON.stringify({ ...enriched, compact_text: compactText }));
      } else {
        console.log(compactText);
      }
    } else {
      printRecoverySummary(json, enriched);
    }
  } catch (error) {
    if (compact && error instanceof RecoveryError && error.code === 'NO_ACTIVE_CHANGE') {
      console.log('<SPEC_SUPERFLOW_RECOVERY>\nNo active spec-superflow change detected.\n</SPEC_SUPERFLOW_RECOVERY>');
      return;
    }
    printRecoveryError(command, error, json);
  }
}

function printRecoverySummary(json, summary) {
  if (json) {
    console.log(JSON.stringify(summary));
    return;
  }

  const checkpoint = summary.checkpoint
    ? `${summary.checkpoint.status} (${summary.checkpoint.record.task_id})`
    : 'none';
  const executionCurrent = summary.execution.required
    ? (summary.execution.current ? 'yes' : 'no')
    : 'not required';
  const executionFailures = summary.execution.required
    ? (summary.execution.failures.length > 0 ? summary.execution.failures.join('; ') : 'none')
    : 'not required';
  const handoffs = summary.handoffs;
  const nextAction = summary.next_action.command
    ?? `${summary.next_action.skill}: ${summary.next_action.reason}`;
  const continuation = `${summary.continuation.kind}${summary.continuation.wave ? ` (wave: ${summary.continuation.wave})` : ''}: ${summary.continuation.reason}${summary.continuation.command ? `; command: ${summary.continuation.command}` : ''}`;

  console.log([
    `Change: ${summary.change.name}`,
    `Path: ${summary.change.path}`,
    `Selection: ${summary.change.selection}`,
    `State: ${summary.state}`,
    `Workflow: ${summary.workflow ?? 'none'}`,
    `Checkpoint: ${checkpoint}`,
    `Handoffs: active ${handoffs.active.length}, result-ready ${handoffs.result_ready.length}, resolved ${handoffs.resolved.length}`,
    `Execution current: ${executionCurrent}`,
    `Execution revision: ${summary.execution.revision ?? 'none'}`,
    `Next eligible wave: ${summary.execution.next_eligible_wave ?? 'none'}`,
    `Execution failures: ${executionFailures}`,
    summary.blockers.length === 0
      ? 'Blockers: none'
      : `Blockers: ${summary.blockers.map(blocker => blocker.message).join('; ')}`,
    `Continuation: ${continuation}`,
    `Next action: ${nextAction}`,
  ].join('\n'));
}

function buildCompactRecoveryText(summary) {
  const checkpoint = summary.checkpoint
    ? `${summary.checkpoint.status}${summary.checkpoint.record.task_id ? ` (${summary.checkpoint.record.task_id})` : ''}`
    : 'none';
  const executionStatus = !summary.execution.required
    ? 'not required'
    : summary.execution.current
      ? 'current'
      : summary.execution.present ? 'stale' : 'missing';
  const blockers = summary.blockers.length === 0
    ? 'none'
    : summary.blockers.map(b => b.message).join('; ');
  const nextAction = summary.next_action.command
    ?? `${summary.next_action.skill} — ${summary.next_action.reason}`;

  return [
    '<SPEC_SUPERFLOW_RECOVERY>',
    `spec-superflow change: ${summary.change.name} (${summary.change.path})`,
    `state: ${summary.state} | workflow: ${summary.workflow ?? 'none'}`,
    `checkpoint: ${checkpoint}`,
    `handoffs: active ${summary.handoffs.active.length}, result-ready ${summary.handoffs.result_ready.length}`,
    `execution: ${executionStatus}, revision ${summary.execution.revision ?? 'none'}, next wave ${summary.execution.next_eligible_wave ?? 'none'}`,
    `blockers: ${blockers}`,
    `next: route to ${nextAction}`,
    '</SPEC_SUPERFLOW_RECOVERY>',
  ].join('\n');
}

function printRecoveryError(command, error, json, { usage = false } = {}) {
  const recoveryError = toRecoveryError(error);
  const payload = {
    ok: false,
    command,
    error: {
      code: recoveryError.code,
      message: recoveryError.message,
      details: recoveryError.details,
    },
  };

  if (json) console.log(JSON.stringify(payload));
  else console.error(usage ? recoveryError.message : `${recoveryError.code}: ${recoveryError.message}`);
  process.exitCode = recoveryError.exitCode;
}

function toRecoveryError(error) {
  if (error instanceof RecoveryError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof Error
    ? {
      message,
      ...(typeof error.code === 'string' ? { code: error.code } : {}),
      ...(typeof error.path === 'string' ? { path: error.path } : {}),
    }
    : { message };
  return new RecoveryError('RECOVERY_FAILED', message, details, 1);
}

function hasExplicitTarget(target) {
  return typeof target === 'string' && target.trim().length > 0;
}
