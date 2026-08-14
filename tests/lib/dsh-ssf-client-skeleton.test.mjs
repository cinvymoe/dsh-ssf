// tests/lib/dsh-ssf-client-skeleton.test.mjs
// Structural checks for the hand-written client bundle (task 3.1/3.2)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CLIENT_PATH = new URL('../../packages/dsh-ssf/client.js', import.meta.url);
const clientSource = readFileSync(CLIENT_PATH, 'utf8');

describe('dsh-ssf client bundle structure', () => {
  it('is a self-registering ModuleLoader factory with id dsh-ssf', () => {
    assert.match(clientSource, /window\.__ModuleLoader__\.load\(\s*\{/);
    assert.match(clientSource, /id:\s*["']dsh-ssf["']/);
    assert.match(clientSource, /factory:\s*\(require\)\s*=>/);
    assert.match(clientSource, /return module\.exports/);
  });

  it('exports a cordis plugin module { apply, inject }', () => {
    assert.match(clientSource, /exports\.apply\s*=\s*apply/);
    assert.match(clientSource, /exports\.inject\s*=\s*\[/);
    assert.match(clientSource, /exports\.inject\s*=\s*\[[^\]]*["']slots["']/);
    assert.match(clientSource, /exports\.inject\s*=\s*\[[^\]]*["']settingsScope["']/);
  });

  it('binds the ssf settings namespace scope', () => {
    assert.match(clientSource, /settingsScope\.bind\(\s*\{[^}]*namespace:\s*["']ssf["']/);
  });

  it('registers the Spec 工作流 section into the settings.section slot', () => {
    assert.match(clientSource, /ctx\.slots\.inject\(\s*["']settings\.section["']/);
    assert.match(clientSource, /name:\s*["']settings\.section["']/);
    assert.match(clientSource, /id:\s*["']ssf["']/);
    assert.match(clientSource, /order:\s*30/);
  });

  it('uses React.createElement (no JSX) and requires react', () => {
    assert.match(clientSource, /require\(\s*["']react["']\s*\)/);
    assert.match(clientSource, /createElement/);
  });
});
