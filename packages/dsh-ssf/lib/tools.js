// packages/dsh-ssf/lib/tools.js — six structured ssf tools + registration
// Handlers: ssf_list / ssf_state / ssf_workflow implemented (task 2.2);
// ssf_execution / ssf_validate / ssf_guard land in task 2.3; ssf_run in 2.4.
import { isAbsolute, join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { scanChanges, summarizeChange } from './change-scanner.js';
import { readState } from '../../../scripts/lib/state-loader.mjs';
import { readWorkflowSelection } from '../../../scripts/lib/workflow-recommendation.mjs';

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
        // Stub — full handler logic lands in task 2.3.
        throw new Error(`implemented in task 2.3 (${id})`);
      },
    }));
  }
}
