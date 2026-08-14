// tests/lib/dsh-ssf-tools-registry.test.mjs
// Tests for packages/dsh-ssf/lib/tools.js — six structured tool registration
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

describe('dsh-ssf: registerTools()', () => {
  let registerTools;
  let registered;
  let ctx;

  before(async () => {
    const mod = await import('../../packages/dsh-ssf/lib/tools.js');
    registerTools = mod.registerTools;
    registered = [];
    ctx = {
      tools: {
        register: (def) => {
          registered.push(def);
          return () => {};
        },
      },
    };
    registerTools(ctx, { resolveRoot: () => '/tmp' });
  });

  it('registers the six structured tools plus the ssf_run fallback', () => {
    const ids = registered.map((t) => t.name).sort();
    assert.deepEqual(ids, [
      'ssf_execution',
      'ssf_guard',
      'ssf_list',
      'ssf_run',
      'ssf_state',
      'ssf_validate',
      'ssf_workflow',
    ]);
  });

  it('declares changeDir required on all structured tools except ssf_list', () => {
    for (const tool of registered) {
      if (tool.name === 'ssf_run') continue; // ssf_run uses the arguments array instead
      const param = tool.parameters?.properties?.changeDir;
      assert.ok(param, `${tool.name} must declare parameters.properties.changeDir`);
      assert.equal(typeof param.type, 'string');
      const required = (tool.parameters.required ?? []).includes('changeDir');
      if (tool.name === 'ssf_list') {
        assert.equal(required, false, 'ssf_list changeDir must not be required');
      } else {
        assert.equal(required, true, `${tool.name} changeDir must be required`);
      }
    }
  });

  it('declares output schema and render on every tool', () => {
    for (const tool of registered) {
      assert.ok(tool.output, `${tool.name} must declare output`);
      assert.equal(typeof tool.output.schema, 'object', `${tool.name} output.schema must be an object`);
      assert.equal(typeof tool.output.render, 'function', `${tool.name} output.render must be a function`);
    }
  });

  it('declares an executable execute handler', () => {
    for (const tool of registered) {
      assert.equal(typeof tool.execute, 'function', `${tool.name} must declare execute`);
    }
  });

  it('uses only the supported JSON Schema keywords in output.schema', () => {
    const SUPPORTED = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'oneOf', 'description', 'title', 'default', 'examples']);
    const visit = (node, path) => {
      if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
      for (const key of Object.keys(node)) {
        if (key === 'properties') {
          // properties is a map of schemas, not a keyword node
          for (const [name, schema] of Object.entries(node.properties)) {
            visit(schema, `${path}.properties.${name}`);
          }
          continue;
        }
        assert.ok(SUPPORTED.has(key), `unsupported schema keyword "${key}" at ${path}`);
        if (key === 'items' || key === 'oneOf') {
          if (Array.isArray(node.oneOf)) for (const branch of node.oneOf) visit(branch, `${path}.oneOf`);
          else visit(node.items, `${path}.items`);
        }
      }
    };
    for (const tool of registered) visit(tool.output.schema, tool.name);
  });
});
