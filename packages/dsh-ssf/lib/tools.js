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

  function assertEnum(value, allowed, fieldName) {
    if (value !== undefined && value !== null && !allowed.includes(value)) {
      throw new Error(`invalid ${fieldName}: must be one of ${allowed.join(', ')}`);
    }
  }

  for (const id of TOOL_IDS) {
    const isList = id === 'ssf_list';
    const isStateWrite = id === 'ssf_state_write';
    const isWorkflowWrite = id === 'ssf_workflow_write';

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
