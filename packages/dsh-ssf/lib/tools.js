// packages/dsh-ssf/lib/tools.js — six structured ssf tools + registration
// Handlers: ssf_list / ssf_state / ssf_workflow (task 2.2); ssf_execution /
// ssf_validate / ssf_guard (task 2.3); ssf_run lands in task 2.4.
import { isAbsolute, join, basename } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { scanChanges, summarizeChange } from './change-scanner.js';
import { readState } from '../../../scripts/lib/state-loader.mjs';
import { readWorkflowSelection } from '../../../scripts/lib/workflow-recommendation.mjs';
import { Validator } from '../../../dist/index.js';
import { validateSpecPathLayout, relativeSpecPath } from '../../../scripts/lib/spec-paths.mjs';
import { readPlan, describeWaves } from '../../../scripts/lib/execution-plan.mjs';

const TOOL_IDS = [
  'ssf_list',
  'ssf_state',
  'ssf_workflow',
  'ssf_execution',
  'ssf_validate',
  'ssf_guard',
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
    stateFileMissing: { type: 'boolean' },
    parseError: { type: 'string' },
  }),
  ssf_workflow: envelopeSchema('workflow'),
  ssf_execution: envelopeSchema('execution'),
  ssf_validate: envelopeSchema('report'),
  ssf_guard: envelopeSchema('guard'),
};

const DESCRIPTIONS = {
  ssf_list: 'List all spec-superflow changes in the workspace with their state machine summary (name, state, workflow, status).',
  ssf_state: 'Read one change\'s persisted state machine fields (raw .spec-superflow.yaml top-level keys plus degradation markers).',
  ssf_workflow: 'Read one change\'s workflow receipt summary (workflow path, status, recommendation).',
  ssf_execution: 'Read one change\'s persisted execution plan summary (current flag and waves).',
  ssf_validate: 'Validate one change\'s planning artifacts against the spec-superflow schema rules (proposal + specs).',
  ssf_guard: 'Run the phase-transition guard check for one change (dp gates and artifact conditions).',
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
 * Register the six structured ssf tools on ctx.tools.
 * @param {object} ctx - cordis context with a tools registry.
 * @param {{ resolveRoot: () => string }} deps - workspace root resolver (injected by lib/index.js).
 */
export function registerTools(ctx, { resolveRoot }) {
  for (const id of TOOL_IDS) {
    const isList = id === 'ssf_list';
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
      async execute(args) {
        const root = resolveRoot();
        if (isList && args.changeDir !== undefined) {
          resolveChangePath(root, args.changeDir);
        }
        if (id === 'ssf_list') {
          return { ok: true, changes: scanChanges(root) };
        }
        const changePath = resolveChangePath(root, args.changeDir);
        if (id === 'ssf_state') {
          const summary = summarizeChange(changePath);
          return {
            ok: true,
            state: summary.raw,
            stateFileMissing: summary.stateFileMissing ?? undefined,
            parseError: summary.parseError ?? undefined,
          };
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
