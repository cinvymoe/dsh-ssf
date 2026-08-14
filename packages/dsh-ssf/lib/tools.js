// packages/dsh-ssf/lib/tools.js — six structured ssf tools + registration
// Handler bodies are stubs in task 2.1; full logic lands in tasks 2.2/2.3/2.4.
import { defineTool } from '@deepseek-ai/dsh-tools';

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
function envelopeSchema(payloadField) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      [payloadField]: { type: 'object', additionalProperties: true, required: true },
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
  ssf_state: envelopeSchema('state'),
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
      async execute() {
        // Stub — full handler logic lands in tasks 2.2/2.3/2.4.
        throw new Error(`implemented in task 2.2/2.3 (${id})`);
      },
    }));
  }
}
