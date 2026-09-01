// packages/dsh-ssf/lib/tools.js — eight structured ssf tools + registration
// Handlers: ssf_list / ssf_state / ssf_workflow (task 2.2); ssf_execution /
// ssf_validate / ssf_guard (task 2.3); ssf_state_write / ssf_workflow_write (task 2.1, wave w2-state-workflow);
// ssf_run lands in task 2.4.
//
// Conversation binding: every structured tool that targets a changeDir (all
// but ssf_list) and ssf_run with a `changes/<name>` argument report the call
// through the optional `onBind(sessionId, changeDir)` dep, so the host binds
// the executed flow to the calling conversation (see lib/index.js
// bindSession). Binding failures never affect the tool result.
import { isAbsolute, join, basename, dirname } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { scanChanges, summarizeChange } from './change-scanner.js';
import { readState } from '../../../scripts/lib/state-loader.mjs';
import { readWorkflowSelection } from '../../../scripts/lib/workflow-recommendation.mjs';
import { Validator } from '../../../dist/index.js';
import { validateSpecPathLayout } from '../../../scripts/lib/spec-paths.mjs';
import { readPlan, describeWaves } from '../../../scripts/lib/execution-plan.mjs';
import { SSF_COMMANDS } from '../../../scripts/spec-superflow.mjs';
import { createCliRunner } from './cli-runner.js';

const TOOL_IDS = [
  'ssf_list',
  'ssf_state',
  'ssf_workflow',
  'ssf_execution',
  'ssf_validate',
  'ssf_guard',
  'ssf_state_write',
  'ssf_workflow_write',
  'ssf_execution_write',
  'ssf_checkpoint',
  'ssf_handoff',
  'ssf_debug',
  'ssf_isolate',
  'ssf_finish',
  'ssf_inject',
  'ssf_sync',
  'ssf_audit',
  'ssf_runtime',
];

/** Envelope for the ssf_* structured outputs (ok + domain payload). */
// dsh-tools output.schema is the value-schema DSL: object nodes take
// type/properties/additionalProperties (explicit boolean) and mark each
// required property with a property-level `required: true` — no top-level
// `required` array.
function envelopeSchema(payloadField, extraProperties = {}) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      [payloadField]: { type: 'object', additionalProperties: true, required: true },
      ...extraProperties,
    },
  };
}

const WRITE_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    exitCode: { type: 'integer', required: true },
    result: { type: 'object', additionalProperties: true },
    stdout: { type: 'string', required: true },
    stderr: { type: 'string', required: true },
  },
};

const OUTPUTS = {
  ssf_list: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      changes: {
        type: 'array',
        required: true,
        items: { type: 'object', additionalProperties: true },
      },
    },
  },
  ssf_state: envelopeSchema('state', {
    // state is `raw` verbatim and is null when the state file is missing or
    // corrupt (degradation contract) — the schema must admit null or the
    // dsh-tools runtime rejects the result with ToolOutputError.
    state: {
      oneOf: [
        { type: 'object', additionalProperties: true },
        { type: 'null' },
      ],
      required: true,
    },
    stateFileMissing: { type: 'boolean' },
    parseError: { type: 'string' },
  }),
  ssf_workflow: envelopeSchema('workflow'),
  ssf_execution: envelopeSchema('execution'),
  ssf_validate: envelopeSchema('report'),
  ssf_guard: envelopeSchema('guard'),
  ssf_state_write: WRITE_OUTPUT,
  ssf_workflow_write: WRITE_OUTPUT,
  ssf_execution_write: WRITE_OUTPUT,
  ssf_checkpoint: WRITE_OUTPUT,
  ssf_handoff: WRITE_OUTPUT,
  ssf_debug: WRITE_OUTPUT,
  ssf_isolate: WRITE_OUTPUT,
  ssf_finish: WRITE_OUTPUT,
  ssf_inject: WRITE_OUTPUT,
  ssf_sync: WRITE_OUTPUT,
  ssf_audit: WRITE_OUTPUT,
  ssf_runtime: WRITE_OUTPUT,
};

const DESCRIPTIONS = {
  ssf_list: 'List all spec-superflow changes in the workspace with their state machine summary (name, state, workflow, status).',
  ssf_state: 'Read one change\'s persisted state machine fields (raw .spec-superflow.yaml top-level keys plus degradation markers).',
  ssf_workflow: 'Read one change\'s workflow receipt summary (workflow path, status, recommendation).',
  ssf_execution: 'Read one change\'s persisted execution plan summary (current flag and waves).',
  ssf_validate: 'Validate one change\'s planning artifacts against the spec-superflow schema rules (proposal + specs).',
  ssf_guard: 'Run the phase-transition guard check for one change (dp gates and artifact conditions).',
  ssf_state_write: 'Write state machine fields for a spec-superflow change (init/set/transition/rebuild) via the native CLI.',
  ssf_workflow_write: 'Write workflow selection for a spec-superflow change (recommend/select/accept/evidence/escalate) via the native CLI.',
  ssf_execution_write: 'Write execution plan for a spec-superflow change (recommend/plan/revise/resync/review) via the native CLI.',
  ssf_checkpoint: 'Manage checkpoints for a spec-superflow change (save/list/show) via the native CLI.',
  ssf_handoff: 'Manage handoff contracts for a spec-superflow change (create/list/finish/resolve) via the native CLI.',
  ssf_debug: 'Manage debugging attempts for a spec-superflow change (record_attempt/show_attempts/escalate) via the native CLI.',
  ssf_isolate: 'Isolate a spec-superflow change into a git worktree (supports --force/--isolate modes) via the native CLI.',
  ssf_finish: 'Finish a spec-superflow change (merge, verify, clean worktree) via the native CLI.',
  ssf_inject: 'Generate phase-guard injection artifacts for a spec-superflow change via the native CLI.',
  ssf_sync: 'Publish a spec-superflow change delta as canonical baseline specs via the native CLI.',
  ssf_audit: 'Generate a decision-point audit report for a spec-superflow change via the native CLI.',
  ssf_runtime: 'Execute runtime operations (asset_read/config_get/resolve_model/check_update/infer) via the native CLI.',
};

/**
 * Resolve a change directory argument to a path strictly inside
 * <workspaceRoot>/changes/. Rejects empty, traversal ('..'), absolute, and
 * non-normalized inputs; throws Error('invalid changeDir: ...').
 */
export function resolveChangePath(workspaceRoot, changeDir) {
  if (typeof changeDir !== 'string' || changeDir.length === 0) {
    throw new Error('invalid changeDir: must be a non-empty change directory name');
  }
  if (isAbsolute(changeDir)) {
    throw new Error(`invalid changeDir: absolute paths are not allowed (${changeDir})`);
  }
  // Reject any traversal segment in the raw input (also catches non-normalized
  // spellings like 'a/../b' even though they normalize to a safe location).
  if (changeDir.split('/').includes('..')) {
    throw new Error(`invalid changeDir: traversal is not allowed (${changeDir})`);
  }
  return join(workspaceRoot, 'changes', changeDir);
}

/**
 * Report a flow execution to the conversation-binding hook. Swallows every
 * failure: binding is a side effect and must never break the tool result.
 * @param {undefined|((sessionId: unknown, changeDir: string) => void)} onBind
 * @param {object|undefined} exec - dsh-tools execution context (may lack agent).
 * @param {string} changeDir
 */
function notifyBind(onBind, exec, changeDir) {
  try {
    onBind?.(exec?.agent?.session?.id, changeDir);
  } catch {
    // binding is best-effort — the tool result is already computed
  }
}

/**
 * Register the structured ssf tools on ctx.tools.
 * @param {object} ctx - cordis context with a tools registry.
 * @param {{ resolveRoot: () => string, onBind?: (sessionId: unknown, changeDir: string) => void }} deps
 *   - workspace root resolver plus the optional conversation-binding hook
 *     (injected by lib/index.js).
 */
export function registerTools(ctx, { resolveRoot, onBind }) {
  const runner = (() => {
    try {
      const raw = createCliRunner({ subprocess: ctx.subprocess, repoRoot: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), onBind, refresh: () => ctx.ssf?.refresh?.().catch(() => {}), resolveRoot });
      // createCliRunner returns a function (runSsf); expose as .runSsf for the runner.runSsf(...) call shape
      if (typeof raw === 'function') return { runSsf: raw };
      return raw;
    } catch {
      return { runSsf: async () => { throw new Error('subprocess is required for write tools'); } };
    }
  })();

  const STATE_WRITE_ACTIONS = ['init', 'set', 'transition', 'rebuild'];
  const WORKFLOW_WRITE_ACTIONS = ['recommend', 'select', 'accept', 'evidence', 'escalate'];
  const YES_NO_UNKNOWN = ['yes', 'no', 'unknown'];
  const YES_NO = ['yes', 'no'];
  const UNCERTAINTY_ENUM = ['low', 'high', 'unknown'];
  const REQUEST_KIND_ENUM = ['standard', 'incident'];
  const MODE_ENUM = ['full', 'hotfix', 'tweak', 'quick', 'lightweight'];
  const VERIFICATION_ENUM = ['tdd', 'new-test', 'bounded'];
  const EXECUTION_WRITE_ACTIONS = ['recommend', 'plan', 'revise', 'resync', 'review'];
  const EXECUTION_MODE_ENUM = ['sdd', 'inline', 'batch-inline'];
  const EXECUTION_VERDICT_ENUM = ['pass', 'fail'];
  const CHECKPOINT_ACTIONS = ['save', 'list', 'show'];
  const HANDOFF_ACTIONS = ['create', 'list', 'finish', 'resolve'];
  const HANDOFF_TYPE_ENUM = ['prototype', 'research', 'experiment'];
  const HANDOFF_DECISION_ENUM = ['accept', 'reject', 'defer'];
  const DEBUG_ACTIONS = ['record_attempt', 'show_attempts', 'escalate'];
  const DEBUG_DECISION_ENUM = ['continue', 'abandon'];
  const ISOLATE_MODE_ENUM = ['none', 'force', 'isolate'];
  const RUNTIME_ACTION_ENUM = ['asset_read', 'config_get', 'resolve_model', 'check_update', 'infer'];

  function assertEnum(value, allowed, fieldName) {
    if (value !== undefined && value !== null && !allowed.includes(value)) {
      throw new Error(`invalid ${fieldName}: must be one of ${allowed.join(', ')}`);
    }
  }

  for (const id of TOOL_IDS) {
    const isList = id === 'ssf_list';
    const isStateWrite = id === 'ssf_state_write';
    const isWorkflowWrite = id === 'ssf_workflow_write';
    const isExecutionWrite = id === 'ssf_execution_write';
    const isCheckpoint = id === 'ssf_checkpoint';
    const isHandoff = id === 'ssf_handoff';
    const isDebug = id === 'ssf_debug';
    const isIsolate = id === 'ssf_isolate';
    const isFinish = id === 'ssf_finish';
    const isInject = id === 'ssf_inject';
    const isSync = id === 'ssf_sync';
    const isAudit = id === 'ssf_audit';
    const isRuntime = id === 'ssf_runtime';

    if (isStateWrite) {
      ctx.tools.register(defineTool({
        name: id,
        description: DESCRIPTIONS[id],
        parameters: {
          changeDir: { type: 'string', required: true, description: 'Change directory name, relative to the workspace changes/ directory.' },
          action: { type: 'string', required: true, enum: STATE_WRITE_ACTIONS, description: 'State action to perform.' },
          field: { type: 'string', description: 'Field name for set action.' },
          value: { type: 'string', description: 'Field value for set action.' },
          target: { type: 'string', description: 'Target state for transition action.' },
        },
        output: {
          schema: OUTPUTS[id],
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args, exec) {
          const root = resolveRoot();
          // changeDir pre-validation via resolveChangePath (empty/absolute/.. throw, not entering runner)
          resolveChangePath(root, args.changeDir);
          const action = args.action;
          if (action === undefined || action === null) {
            throw new Error('ssf_state_write: action is required');
          }
          if (!STATE_WRITE_ACTIONS.includes(action)) {
            throw new Error(`ssf_state_write: invalid action "${action}"`);
          }
          if (action === 'set') {
            if (!args.field || !args.value) {
              throw new Error('ssf_state_write set: field and value are required');
            }
          }
          if (action === 'transition') {
            if (!args.target) {
              throw new Error('ssf_state_write transition: target is required');
            }
          }
          const dir = `changes/${args.changeDir}`;
          let cliArgs;
          if (action === 'init') {
            cliArgs = ['state', 'init', dir];
          } else if (action === 'set') {
            cliArgs = ['state', 'set', dir, args.field, args.value];
          } else if (action === 'transition') {
            cliArgs = ['state', 'transition', dir, args.target];
          } else if (action === 'rebuild') {
            cliArgs = ['state', 'rebuild', dir];
          } else {
            throw new Error(`ssf_state_write: invalid action "${action}"`);
          }
          return await runner.runSsf({ args: cliArgs, changeDir: args.changeDir, json: true, exec });
        },
      }));
      continue;
    }

    if (isWorkflowWrite) {
      ctx.tools.register(defineTool({
        name: id,
        description: DESCRIPTIONS[id],
        parameters: {
          changeDir: { type: 'string', required: true, description: 'Change directory name, relative to the workspace changes/ directory.' },
          action: { type: 'string', required: true, enum: WORKFLOW_WRITE_ACTIONS, description: 'Workflow action to perform.' },
          taskCount: { type: 'integer', description: 'Number of tasks for recommendation.' },
          fileCount: { type: 'integer', description: 'Number of files for recommendation.' },
          configDocOnly: { type: 'string', enum: YES_NO_UNKNOWN, description: 'Whether change is config/doc only.' },
          schemaApiChange: { type: 'string', enum: YES_NO_UNKNOWN, description: 'Whether change modifies schema/API.' },
          newModule: { type: 'string', enum: YES_NO_UNKNOWN, description: 'Whether change adds a new module.' },
          behavioralConstraintChange: { type: 'string', enum: YES_NO, description: 'Whether change modifies behavioral constraints.' },
          crossModuleChange: { type: 'string', enum: YES_NO, description: 'Whether change is cross-module.' },
          uncertainty: { type: 'string', enum: UNCERTAINTY_ENUM, description: 'Uncertainty level.' },
          requestKind: { type: 'string', enum: REQUEST_KIND_ENUM, description: 'Request kind.' },
          mode: { type: 'string', enum: MODE_ENUM, description: 'Workflow mode for select.' },
          reason: { type: 'string', description: 'Reason for select/escalate.' },
          scopeConfirmation: { type: 'string', description: 'Scope confirmation for select.' },
          acknowledgeRecommendation: { type: 'boolean', description: 'Whether to acknowledge recommendation for select.' },
          verification: { type: 'string', enum: VERIFICATION_ENUM, description: 'Verification strategy for select/accept.' },
          focusedReview: { type: 'string', description: 'Focused review summary for evidence.' },
          verificationCommand: { type: 'string', description: 'Verification command for evidence.' },
          verificationResult: { type: 'string', enum: ['pass'], default: 'pass', description: 'Verification result for evidence.' },
        },
        output: {
          schema: OUTPUTS[id],
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args, exec) {
          const root = resolveRoot();
          resolveChangePath(root, args.changeDir);
          const action = args.action;
          if (action === undefined || action === null) {
            throw new Error('ssf_workflow_write: action is required');
          }
          if (!WORKFLOW_WRITE_ACTIONS.includes(action)) {
            throw new Error(`ssf_workflow_write: invalid action "${action}"`);
          }
          // enum validation for provided fields
          assertEnum(args.configDocOnly, YES_NO_UNKNOWN, 'configDocOnly');
          assertEnum(args.schemaApiChange, YES_NO_UNKNOWN, 'schemaApiChange');
          assertEnum(args.newModule, YES_NO_UNKNOWN, 'newModule');
          assertEnum(args.behavioralConstraintChange, YES_NO, 'behavioralConstraintChange');
          assertEnum(args.crossModuleChange, YES_NO, 'crossModuleChange');
          assertEnum(args.uncertainty, UNCERTAINTY_ENUM, 'uncertainty');
          assertEnum(args.requestKind, REQUEST_KIND_ENUM, 'requestKind');
          assertEnum(args.mode, MODE_ENUM, 'mode');
          assertEnum(args.verification, VERIFICATION_ENUM, 'verification');
          assertEnum(args.verificationResult, ['pass'], 'verificationResult');
          if (args.taskCount !== undefined && args.taskCount !== null) {
            if (!Number.isInteger(args.taskCount) || args.taskCount < 0) {
              throw new Error('invalid taskCount: must be a non-negative integer');
            }
          }
          if (args.fileCount !== undefined && args.fileCount !== null) {
            if (!Number.isInteger(args.fileCount) || args.fileCount < 0) {
              throw new Error('invalid fileCount: must be a non-negative integer');
            }
          }
          // per-action required validation
          if (action === 'select') {
            if (!args.mode || !args.reason) {
              throw new Error('ssf_workflow_write select: mode and reason are required');
            }
          }
          if (action === 'accept') {
            if (!args.verification) {
              throw new Error('ssf_workflow_write accept: verification is required');
            }
          }
          if (action === 'evidence') {
            if (!args.focusedReview || !args.verificationCommand) {
              throw new Error('ssf_workflow_write evidence: focusedReview and verificationCommand are required');
            }
          }
          if (action === 'escalate') {
            if (!args.reason) {
              throw new Error('ssf_workflow_write escalate: reason is required');
            }
          }
          const dir = `changes/${args.changeDir}`;
          let cliArgs;
          if (action === 'recommend') {
            cliArgs = ['workflow', 'recommend', dir];
            if (args.taskCount !== undefined) cliArgs.push('--task-count', String(args.taskCount));
            if (args.fileCount !== undefined) cliArgs.push('--file-count', String(args.fileCount));
            if (args.configDocOnly !== undefined) cliArgs.push('--config-doc-only', args.configDocOnly);
            if (args.schemaApiChange !== undefined) cliArgs.push('--schema-api-change', args.schemaApiChange);
            if (args.newModule !== undefined) cliArgs.push('--new-module', args.newModule);
            if (args.behavioralConstraintChange !== undefined) cliArgs.push('--behavioral-constraint-change', args.behavioralConstraintChange);
            if (args.crossModuleChange !== undefined) cliArgs.push('--cross-module-change', args.crossModuleChange);
            if (args.uncertainty !== undefined) cliArgs.push('--uncertainty', args.uncertainty);
            if (args.requestKind !== undefined) cliArgs.push('--request-kind', args.requestKind);
          } else if (action === 'select') {
            cliArgs = ['workflow', 'select', dir, '--mode', args.mode, '--confirm', '--reason', args.reason];
            if (args.scopeConfirmation !== undefined) cliArgs.push('--scope-confirmation', args.scopeConfirmation);
            if (args.acknowledgeRecommendation === true) cliArgs.push('--acknowledge-recommendation');
            if (args.verification !== undefined) cliArgs.push('--verification', args.verification);
          } else if (action === 'accept') {
            cliArgs = ['workflow', 'accept', dir, '--source', 'direct-request', '--verification', args.verification];
          } else if (action === 'evidence') {
            cliArgs = ['workflow', 'evidence', dir, '--focused-review', args.focusedReview, '--verification-command', args.verificationCommand, '--verification-result', args.verificationResult || 'pass'];
          } else if (action === 'escalate') {
            cliArgs = ['workflow', 'escalate', dir, '--reason', args.reason];
          } else {
            throw new Error(`ssf_workflow_write: invalid action "${action}"`);
          }
          return await runner.runSsf({ args: cliArgs, changeDir: args.changeDir, json: true, exec });
        },
      }));
      continue;
    }

    if (isExecutionWrite) {
      ctx.tools.register(defineTool({
        name: id,
        description: DESCRIPTIONS[id],
        parameters: {
          changeDir: { type: 'string', required: true, description: 'Change directory name, relative to the workspace changes/ directory.' },
          action: { type: 'string', required: true, enum: EXECUTION_WRITE_ACTIONS, description: 'Execution action to perform.' },
          mode: { type: 'string', enum: EXECUTION_MODE_ENUM, description: 'Execution mode for plan/revise.' },
          reason: { type: 'string', description: 'Reason for plan/revise/resync.' },
          waves: { type: 'array', items: { type: 'string' }, description: 'Waves, each as id:strategy:tasks[:depends].' },
          acknowledgeRecommendation: { type: 'boolean', description: 'Whether to acknowledge non-recommended mode selection.' },
          wave: { type: 'string', description: 'Wave id for review.' },
          base: { type: 'string', description: 'Base commit sha for review.' },
          head: { type: 'string', description: 'Head commit sha for review.' },
          report: { type: 'string', description: 'Report path for review.' },
          verdict: { type: 'string', enum: EXECUTION_VERDICT_ENUM, description: 'Verdict for review.' },
        },
        output: {
          schema: OUTPUTS[id],
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args, exec) {
          const root = resolveRoot();
          resolveChangePath(root, args.changeDir);
          const action = args.action;
          if (action === undefined || action === null) {
            throw new Error('ssf_execution_write: action is required');
          }
          if (!EXECUTION_WRITE_ACTIONS.includes(action)) {
            throw new Error(`ssf_execution_write: invalid action "${action}"`);
          }
          assertEnum(args.mode, EXECUTION_MODE_ENUM, 'mode');
          assertEnum(args.verdict, EXECUTION_VERDICT_ENUM, 'verdict');
          if (action === 'plan') {
            if (!args.mode || !args.reason || !Array.isArray(args.waves) || args.waves.length === 0) {
              throw new Error('ssf_execution_write plan: mode, reason and waves are required');
            }
          }
          if (action === 'revise') {
            if (!args.mode || !args.reason || !Array.isArray(args.waves) || args.waves.length === 0) {
              throw new Error('ssf_execution_write revise: mode, reason and waves are required');
            }
          }
          if (action === 'resync') {
            if (!args.reason) {
              throw new Error('ssf_execution_write resync: reason is required');
            }
          }
          if (action === 'review') {
            if (!args.wave || !args.base || !args.head || !args.report || !args.verdict) {
              throw new Error('ssf_execution_write review: wave, base, head, report and verdict are required');
            }
          }
          const dir = `changes/${args.changeDir}`;
          let cliArgs;
          if (action === 'recommend') {
            cliArgs = ['execution', 'recommend', dir];
            if (Array.isArray(args.waves)) {
              for (const w of args.waves) {
                cliArgs.push('--wave', w);
              }
            }
          } else if (action === 'plan') {
            cliArgs = ['execution', 'plan', dir, '--mode', args.mode, '--confirm', '--reason', args.reason];
            for (const w of args.waves) {
              cliArgs.push('--wave', w);
            }
            if (args.acknowledgeRecommendation === true) cliArgs.push('--acknowledge-recommendation');
          } else if (action === 'revise') {
            cliArgs = ['execution', 'revise', dir, '--mode', args.mode, '--confirm', '--reason', args.reason];
            for (const w of args.waves) {
              cliArgs.push('--wave', w);
            }
            if (args.acknowledgeRecommendation === true) cliArgs.push('--acknowledge-recommendation');
          } else if (action === 'resync') {
            cliArgs = ['execution', 'resync', dir, '--confirm', '--reason', args.reason];
          } else if (action === 'review') {
            cliArgs = ['execution', 'review', dir, '--wave', args.wave, '--base', args.base, '--head', args.head, '--report', args.report, '--verdict', args.verdict];
          } else {
            throw new Error(`ssf_execution_write: invalid action "${action}"`);
          }
          return await runner.runSsf({ args: cliArgs, changeDir: args.changeDir, json: true, exec });
        },
      }));
      continue;
    }

    if (isCheckpoint) {
      ctx.tools.register(defineTool({
        name: id,
        description: DESCRIPTIONS[id],
        parameters: {
          changeDir: { type: 'string', required: true, description: 'Change directory name, relative to the workspace changes/ directory.' },
          action: { type: 'string', required: true, enum: CHECKPOINT_ACTIONS, description: 'Checkpoint action to perform.' },
          task: { type: 'string', description: 'Task id for save.' },
          next: { type: 'string', description: 'Next step for save.' },
          id: { type: 'string', description: 'Checkpoint id for show.' },
        },
        output: {
          schema: OUTPUTS[id],
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args, exec) {
          const root = resolveRoot();
          resolveChangePath(root, args.changeDir);
          const action = args.action;
          if (action === undefined || action === null) {
            throw new Error('ssf_checkpoint: action is required');
          }
          if (!CHECKPOINT_ACTIONS.includes(action)) {
            throw new Error(`ssf_checkpoint: invalid action "${action}"`);
          }
          if (action === 'save') {
            if (!args.task || !args.next) {
              throw new Error('ssf_checkpoint save: task and next are required');
            }
          }
          if (action === 'show') {
            if (!args.id) {
              throw new Error('ssf_checkpoint show: id is required');
            }
          }
          const dir = `changes/${args.changeDir}`;
          let cliArgs;
          if (action === 'save') {
            cliArgs = ['checkpoint', 'save', dir, '--task', args.task, '--next', args.next];
          } else if (action === 'list') {
            cliArgs = ['checkpoint', 'list', dir];
          } else if (action === 'show') {
            cliArgs = ['checkpoint', 'show', dir, args.id];
          } else {
            throw new Error(`ssf_checkpoint: invalid action "${action}"`);
          }
          return await runner.runSsf({ args: cliArgs, changeDir: args.changeDir, json: true, exec });
        },
      }));
      continue;
    }

    if (isHandoff) {
      ctx.tools.register(defineTool({
        name: id,
        description: DESCRIPTIONS[id],
        parameters: {
          changeDir: { type: 'string', required: true, description: 'Change directory name, relative to the workspace changes/ directory.' },
          action: { type: 'string', required: true, enum: HANDOFF_ACTIONS, description: 'Handoff action to perform.' },
          type: { type: 'string', enum: HANDOFF_TYPE_ENUM, description: 'Handoff type for create.' },
          objective: { type: 'string', description: 'Objective for create.' },
          expectedOutput: { type: 'string', description: 'Expected output for create.' },
          acceptance: { type: 'string', description: 'Acceptance for create.' },
          id: { type: 'string', description: 'Handoff id for finish/resolve.' },
          decision: { type: 'string', enum: HANDOFF_DECISION_ENUM, description: 'Decision for resolve.' },
        },
        output: {
          schema: OUTPUTS[id],
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args, exec) {
          const root = resolveRoot();
          resolveChangePath(root, args.changeDir);
          const action = args.action;
          if (action === undefined || action === null) {
            throw new Error('ssf_handoff: action is required');
          }
          if (!HANDOFF_ACTIONS.includes(action)) {
            throw new Error(`ssf_handoff: invalid action "${action}"`);
          }
          assertEnum(args.type, HANDOFF_TYPE_ENUM, 'type');
          assertEnum(args.decision, HANDOFF_DECISION_ENUM, 'decision');
          if (action === 'create') {
            if (!args.type || !args.objective || !args.expectedOutput || !args.acceptance) {
              throw new Error('ssf_handoff create: type, objective, expectedOutput and acceptance are required');
            }
          }
          if (action === 'finish') {
            if (!args.id) {
              throw new Error('ssf_handoff finish: id is required');
            }
          }
          if (action === 'resolve') {
            if (!args.id || !args.decision) {
              throw new Error('ssf_handoff resolve: id and decision are required');
            }
          }
          const dir = `changes/${args.changeDir}`;
          let cliArgs;
          if (action === 'create') {
            cliArgs = ['handoff', 'create', dir, '--type', args.type, '--objective', args.objective, '--expected-output', args.expectedOutput, '--acceptance', args.acceptance];
          } else if (action === 'list') {
            cliArgs = ['handoff', 'list', dir];
          } else if (action === 'finish') {
            cliArgs = ['handoff', 'finish', dir, args.id];
          } else if (action === 'resolve') {
            cliArgs = ['handoff', 'resolve', dir, args.id, '--decision', args.decision];
          } else {
            throw new Error(`ssf_handoff: invalid action "${action}"`);
          }
          return await runner.runSsf({ args: cliArgs, changeDir: args.changeDir, json: true, exec });
        },
      }));
      continue;
    }

    if (isDebug) {
      ctx.tools.register(defineTool({
        name: id,
        description: DESCRIPTIONS[id],
        parameters: {
          changeDir: { type: 'string', required: true, description: 'Change directory name, relative to the workspace changes/ directory.' },
          action: { type: 'string', required: true, enum: DEBUG_ACTIONS, description: 'Debug action to perform.' },
          id: { type: 'string', description: 'Attempt id for record_attempt.' },
          summary: { type: 'string', description: 'Summary for record_attempt.' },
          evidence: { type: 'string', description: 'Evidence path for record_attempt.' },
          decision: { type: 'string', enum: DEBUG_DECISION_ENUM, description: 'Decision for escalate.' },
          reason: { type: 'string', description: 'Reason for escalate.' },
        },
        output: {
          schema: OUTPUTS[id],
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args, exec) {
          const root = resolveRoot();
          resolveChangePath(root, args.changeDir);
          const action = args.action;
          if (action === undefined || action === null) {
            throw new Error('ssf_debug: action is required');
          }
          if (!DEBUG_ACTIONS.includes(action)) {
            throw new Error(`ssf_debug: invalid action "${action}"`);
          }
          assertEnum(args.decision, DEBUG_DECISION_ENUM, 'decision');
          if (action === 'record_attempt') {
            if (!args.id || !args.summary || !args.evidence) {
              throw new Error('ssf_debug record_attempt: id, summary and evidence are required');
            }
          }
          if (action === 'escalate') {
            if (!args.decision || !args.reason) {
              throw new Error('ssf_debug escalate: decision and reason are required');
            }
          }
          const dir = `changes/${args.changeDir}`;
          let cliArgs;
          if (action === 'record_attempt') {
            cliArgs = ['debug', 'attempt', 'record', dir, '--id', args.id, '--summary', args.summary, '--evidence', args.evidence];
          } else if (action === 'show_attempts') {
            cliArgs = ['debug', 'attempt', 'show', dir];
          } else if (action === 'escalate') {
            cliArgs = ['debug', 'escalate', dir, '--decision', args.decision, '--reason', args.reason, '--confirm'];
          } else {
            throw new Error(`ssf_debug: invalid action "${action}"`);
          }
          return await runner.runSsf({ args: cliArgs, changeDir: args.changeDir, json: true, exec });
        },
      }));
      continue;
    }

    if (isIsolate) {
      ctx.tools.register(defineTool({
        name: id,
        description: DESCRIPTIONS[id],
        parameters: {
          changeDir: { type: 'string', required: true, description: 'Change directory name, relative to the workspace changes/ directory.' },
          mode: { type: 'string', enum: ISOLATE_MODE_ENUM, default: 'none', description: 'Isolation mode (none/force/isolate).' },
          name: { type: 'string', description: 'Change name for isolate (optional).' },
        },
        output: {
          schema: OUTPUTS[id],
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args, exec) {
          const root = resolveRoot();
          resolveChangePath(root, args.changeDir);
          const mode = args.mode ?? 'none';
          if (!ISOLATE_MODE_ENUM.includes(mode)) {
            throw new Error(`invalid mode: must be one of ${ISOLATE_MODE_ENUM.join(', ')}`);
          }
          const dir = `changes/${args.changeDir}`;
          const cliArgs = ['isolate', dir];
          if (args.name) cliArgs.push(args.name);
          if (mode === 'force') cliArgs.push('--force');
          else if (mode === 'isolate') cliArgs.push('--isolate');
          return await runner.runSsf({ args: cliArgs, changeDir: args.changeDir, json: false, exec, graceMs: 30000 });
        },
      }));
      continue;
    }

    if (isFinish) {
      ctx.tools.register(defineTool({
        name: id,
        description: DESCRIPTIONS[id],
        parameters: {
          changeDir: { type: 'string', required: true, description: 'Change directory name, relative to the workspace changes/ directory.' },
          testCmd: { type: 'string', description: 'Test command override for finish verification.' },
        },
        output: {
          schema: OUTPUTS[id],
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args, exec) {
          const root = resolveRoot();
          resolveChangePath(root, args.changeDir);
          const dir = `changes/${args.changeDir}`;
          const cliArgs = ['finish', dir];
          if (args.testCmd) cliArgs.push('--test-cmd', args.testCmd);
          return await runner.runSsf({ args: cliArgs, changeDir: args.changeDir, json: false, exec, graceMs: 30000 });
        },
      }));
      continue;
    }

    if (isInject) {
      ctx.tools.register(defineTool({
        name: id,
        description: DESCRIPTIONS[id],
        parameters: {
          changeDir: { type: 'string', required: true, description: 'Change directory name, relative to the workspace changes/ directory.' },
          platforms: { type: 'string', description: 'Comma-separated platforms for inject (optional).' },
        },
        output: {
          schema: OUTPUTS[id],
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args, exec) {
          const root = resolveRoot();
          resolveChangePath(root, args.changeDir);
          const dir = `changes/${args.changeDir}`;
          const cliArgs = ['inject', dir];
          if (args.platforms) cliArgs.push('--platforms', args.platforms);
          return await runner.runSsf({ args: cliArgs, changeDir: args.changeDir, json: true, exec, graceMs: 30000 });
        },
      }));
      continue;
    }

    if (isSync) {
      ctx.tools.register(defineTool({
        name: id,
        description: DESCRIPTIONS[id],
        parameters: {
          changeDir: { type: 'string', required: true, description: 'Change directory name, relative to the workspace changes/ directory.' },
        },
        output: {
          schema: OUTPUTS[id],
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args, exec) {
          const root = resolveRoot();
          resolveChangePath(root, args.changeDir);
          const dir = `changes/${args.changeDir}`;
          const cliArgs = ['sync', dir];
          return await runner.runSsf({ args: cliArgs, changeDir: args.changeDir, json: false, exec, graceMs: 30000 });
        },
      }));
      continue;
    }

    if (isAudit) {
      ctx.tools.register(defineTool({
        name: id,
        description: DESCRIPTIONS[id],
        parameters: {
          changeDir: { type: 'string', required: true, description: 'Change directory name, relative to the workspace changes/ directory.' },
        },
        output: {
          schema: OUTPUTS[id],
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args, exec) {
          const root = resolveRoot();
          resolveChangePath(root, args.changeDir);
          const dir = `changes/${args.changeDir}`;
          const cliArgs = ['audit', dir];
          return await runner.runSsf({ args: cliArgs, changeDir: args.changeDir, json: true, exec, graceMs: 30000 });
        },
      }));
      continue;
    }

    if (isRuntime) {
      ctx.tools.register(defineTool({
        name: id,
        description: DESCRIPTIONS[id],
        parameters: {
          changeDir: { type: 'string', description: 'Change directory name, relative to the workspace changes/ directory (required for infer).' },
          action: { type: 'string', required: true, enum: RUNTIME_ACTION_ENUM, description: 'Runtime operation to perform.' },
          path: { type: 'string', description: 'Asset path for asset_read.' },
          key: { type: 'string', description: 'Config key for config_get.' },
          profile: { type: 'string', description: 'Profile name for resolve_model.' },
        },
        output: {
          schema: OUTPUTS[id],
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args, exec) {
          const root = resolveRoot();
          const action = args.action;
          if (action === undefined || action === null) {
            throw new Error('ssf_runtime: action is required');
          }
          if (!RUNTIME_ACTION_ENUM.includes(action)) {
            throw new Error(`invalid action: must be one of ${RUNTIME_ACTION_ENUM.join(', ')}`);
          }
          // changeDir pre-validation: non-empty then validate; infer requires it
          if (args.changeDir !== undefined && args.changeDir !== null && args.changeDir !== '') {
            resolveChangePath(root, args.changeDir);
          }
          if (action === 'asset_read') {
            if (!args.path) {
              throw new Error('ssf_runtime asset_read: path is required');
            }
            if (isAbsolute(args.path) || args.path.split('/').includes('..')) {
              throw new Error(`invalid path: traversal or absolute path not allowed (${args.path})`);
            }
            const cliArgs = ['runtime', 'asset', 'read', args.path];
            return await runner.runSsf({ args: cliArgs, changeDir: args.changeDir || undefined, json: false, exec, graceMs: 30000 });
          }
          if (action === 'config_get') {
            if (!args.key) {
              throw new Error('ssf_runtime config_get: key is required');
            }
            const cliArgs = ['runtime', 'config', '--get', args.key];
            return await runner.runSsf({ args: cliArgs, changeDir: args.changeDir || undefined, json: false, exec, graceMs: 30000 });
          }
          if (action === 'resolve_model') {
            if (!args.profile) {
              throw new Error('ssf_runtime resolve_model: profile is required');
            }
            const cliArgs = ['runtime', 'config', '--resolve-model', args.profile];
            return await runner.runSsf({ args: cliArgs, changeDir: args.changeDir || undefined, json: true, exec, graceMs: 30000 });
          }
          if (action === 'check_update') {
            const cliArgs = ['runtime', 'check-update'];
            const res = await runner.runSsf({ args: cliArgs, changeDir: args.changeDir || undefined, json: true, exec, graceMs: 30000 });
            if ([0, 1, 2].includes(res.exitCode)) {
              let outcome;
              if (res.result && typeof res.result.outcome === 'string') {
                outcome = res.result.outcome;
              } else {
                const map = { 0: 'continue', 1: 'upgrade-reminder', 2: 'skip' };
                outcome = map[res.exitCode];
              }
              let finalResult;
              if (res.result && typeof res.result === 'object' && 'outcome' in res.result) {
                finalResult = res.result;
              } else if (res.result && typeof res.result === 'object') {
                finalResult = { ...res.result, outcome };
              } else {
                finalResult = { outcome };
              }
              return { ok: true, exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr, result: finalResult };
            }
            return res;
          }
          if (action === 'infer') {
            if (!args.changeDir) {
              throw new Error('ssf_runtime infer: changeDir is required');
            }
            // already validated above, but ensure again for empty check
            resolveChangePath(root, args.changeDir);
            const dir = `changes/${args.changeDir}`;
            const cliArgs = ['runtime', 'infer', dir];
            return await runner.runSsf({ args: cliArgs, changeDir: args.changeDir, json: true, exec, graceMs: 30000 });
          }
          throw new Error(`ssf_runtime: invalid action "${action}"`);
        },
      }));
      continue;
    }

    const changeDir = {
      type: 'string',
      description: isList
        ? 'Optional change directory name to filter the listing (relative to changes/).'
        : 'Change directory name, relative to the workspace changes/ directory.',
    };
    // dsh-tools: parameters with a `required` key must be required; optional
    // parameters omit the key entirely (see dsh-tool-jobs' `wait` parameter).
    if (!isList) changeDir.required = true;
    const parameters = { changeDir };
    if (id === 'ssf_guard') {
      parameters.fromState = { type: 'string', required: true, description: 'Source state machine state for the transition guard check.' };
      parameters.toState = { type: 'string', required: true, description: 'Target state machine state for the transition guard check.' };
    }

    ctx.tools.register(defineTool({
      name: id,
      description: DESCRIPTIONS[id],
      parameters,
      output: {
        schema: OUTPUTS[id],
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args, exec) {
        const root = resolveRoot();
        if (isList && args.changeDir !== undefined) {
          resolveChangePath(root, args.changeDir);
        }
        if (id === 'ssf_list') {
          return { ok: true, changes: scanChanges(root) };
        }
        const changePath = resolveChangePath(root, args.changeDir);
        // Executing a flow binds it to the calling conversation.
        notifyBind(onBind, exec, args.changeDir);
        if (id === 'ssf_state') {
          const summary = summarizeChange(changePath);
          // Omit absent degradation markers — undefined values are not lossless JSON.
          const result = { ok: true, state: summary.raw };
          if (summary.stateFileMissing) result.stateFileMissing = true;
          if (summary.parseError !== undefined) result.parseError = summary.parseError;
          return result;
        }
        if (id === 'ssf_workflow') {
          const state = readState(changePath);
          const receipt = readWorkflowSelection(changePath);
          const workflow = state.workflow ?? 'auto';
          let status;
          if (receipt.exists && receipt.valid) {
            status = receipt.record?.selection?.mode === workflow
              ? 'selected'
              : (receipt.record?.status ?? 'recorded');
          } else {
            status = receipt.exists ? 'invalid' : 'missing-receipt';
          }
          return {
            ok: true,
            workflow: {
              workflow,
              receiptExists: receipt.exists,
              receiptValid: receipt.valid,
              status,
              recommendation: receipt.record?.recommendation?.mode ?? null,
            },
          };
        }
        if (id === 'ssf_validate') {
          return { ok: true, report: validateChange(changePath) };
        }
        if (id === 'ssf_guard') {
          const guardScript = join(root, 'scripts', 'guard', 'guard.mjs');
          const result = spawnSync(
            process.execPath,
            [guardScript, 'check', changePath, args.fromState, args.toState, '--json'],
            { encoding: 'utf8' },
          );
          let guard;
          try {
            guard = JSON.parse(result.stdout);
          } catch {
            throw new Error(`guard check failed: ${result.stderr || result.stdout}`);
          }
          return { ok: true, guard };
        }
        if (id === 'ssf_execution') {
          const plan = readPlan(changePath);
          return { ok: true, execution: { current: plan !== null, waves: describeWaves(changePath, plan) } };
        }
        throw new Error(`unreachable tool ${id}`);
      },
    }));
  }

  // ssf_run: generic fallback that forwards any ssf subcommand through the
  // ctx.subprocess seam (the ssf binary on PATH), returning stdout/stderr/exitCode.
  ctx.tools.register(defineTool({
    name: 'ssf_run',
    description: 'Run any ssf CLI subcommand not covered by the structured tools; returns stdout, stderr, and the exit code.',
    parameters: {
      arguments: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'ssf subcommand name followed by its arguments (e.g. ["handoff", "list", "changes/x"]).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
          exitCode: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.stderr ? `exit ${value.exitCode}\n${value.stderr}\n${value.stdout}` : `exit ${value.exitCode}\n${value.stdout}`,
      }],
    },
    async execute(args, exec) {
      const argv = args.arguments;
      if (!Array.isArray(argv) || argv.length === 0) {
        throw new Error('ssf_run: arguments must be a non-empty array of strings');
      }
      for (const arg of argv) {
        if (typeof arg !== 'string') throw new Error('ssf_run: every argument must be a string');
        if (arg.split('/').includes('..') || isAbsolute(arg)) {
          throw new Error(`ssf_run: traversal or absolute path arguments are not allowed (${arg})`);
        }
      }
      if (!Object.hasOwn(SSF_COMMANDS, argv[0])) {
        throw new Error(`ssf_run: unknown ssf subcommand "${argv[0]}"`);
      }
      // A `changes/<name>` argument means this run executes that flow — bind
      // it to the calling conversation like the structured tools do.
      const changeArg = argv.find((arg) => /^changes\/[^/]+$/.test(arg));
      if (changeArg) notifyBind(onBind, exec, changeArg.slice('changes/'.length));
      const root = resolveRoot();
      const handle = ctx.subprocess.spawn({
        argv: ['ssf', ...argv],
        cwd: root,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 65536 },
          stderr: { maxBytes: 65536 },
        },
        graceMs: 30000,
      });
      const outcome = await handle.done;
      const stdout = handle.collected.stdout?.readFrom(0).text ?? '';
      const stderr = handle.collected.stderr?.readFrom(0).text ?? '';
      // The CLI may have changed change state (state set / workflow select /
      // sync ...) — refresh the settings-namespace snapshot so the GUI tab
      // stays current; failures are best-effort and must not fail the tool.
      await ctx.ssf?.refresh()?.catch(() => {});
      return { ok: true, stdout, stderr, exitCode: outcome.exitCode ?? -1 };
    },
  }));
}

/**
 * Aggregate the CLI's artifact validation (proposal + delta specs) into one
 * report. Mirrors scripts/validate-artifacts: proposal via
 * Validator.validateChangeContent, specs via validateDeltaSpec, spec layout
 * via validateSpecPathLayout. Never throws on missing files (proposal absent
 * contributes no issues; spec layout failures become ERROR issues).
 */
function validateChange(changePath) {
  const validator = new Validator(false);
  const changeName = basename(changePath);
  const issues = [];

  const proposalPath = join(changePath, 'proposal.md');
  if (existsSync(proposalPath)) {
    const report = validator.validateChangeContent(changeName, readFileSync(proposalPath, 'utf-8'));
    issues.push(...report.issues);
  }

  const layout = validateSpecPathLayout(changePath, { requireSpecs: true });
  for (const failure of layout.failures) {
    issues.push({ level: 'ERROR', path: 'specs', message: failure });
  }
  for (const specFile of layout.specFiles) {
    const report = validator.validateDeltaSpec(readFileSync(specFile, 'utf-8'));
    issues.push(...report.issues);
  }

  const summary = { errors: 0, warnings: 0, info: 0 };
  for (const issue of issues) {
    if (issue.level === 'ERROR') summary.errors += 1;
    else if (issue.level === 'WARNING') summary.warnings += 1;
    else summary.info += 1;
  }
  return { valid: summary.errors === 0, issues, summary };
}
