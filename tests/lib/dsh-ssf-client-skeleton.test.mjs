// tests/lib/dsh-ssf-client-skeleton.test.mjs
// Structural checks for the hand-written client bundle (task 3.1/3.2)
// Now validates the polling snapshot implementation (no settingsScope).
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

  it('exports a cordis plugin module { apply, inject } without settingsScope', () => {
    assert.match(clientSource, /exports\.apply\s*=\s*apply/);
    assert.match(clientSource, /exports\.inject\s*=\s*\[/);
    assert.match(clientSource, /exports\.inject\s*=\s*\[[^\]]*["']slots["']/);
    assert.match(clientSource, /exports\.inject\s*=\s*\[[^\]]*["']locale["']/);
    assert.match(clientSource, /exports\.inject\s*=\s*\[[^\]]*["']sessions["']/);
    // inject must not contain settingsScope as a dependency (comments may mention it)
    // Strip comments before checking.
    const withoutComments = clientSource.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
    assert.equal(withoutComments.includes('settingsScope'), false, 'inject must not contain settingsScope (outside comments)');
    assert.match(withoutComments, /exports\.inject\s*=\s*\[\s*["']slots["']\s*,\s*["']locale["']\s*,\s*["']sessions["']\s*\]/);
  });

  it('does not bind the ssf settings namespace scope', () => {
    const withoutComments = clientSource.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
    assert.equal(withoutComments.includes('settingsScope.bind'), false, 'must not bind settingsScope');
    // The old pattern `settingsScope.bind({namespace:"ssf"})` must be absent outside comments
    assert.equal(/settingsScope\.bind\s*\(\s*\{[^}]*namespace:\s*["']ssf["']/.test(withoutComments), false);
  });

  it('fetches the snapshot from GET /dsh-ssf/snapshot with polling', () => {
    assert.match(clientSource, /const ENDPOINT\s*=\s*["']\/dsh-ssf\/snapshot["']/);
    assert.match(clientSource, /fetch\(ENDPOINT/);
    assert.match(clientSource, /async function fetchSnapshot\(\)/);
    // Must handle HTTP errors like dsh-plugin-omoslim's fetchModels
    assert.match(clientSource, /Cache-Control.*no-store/);
  });

  it('polls via setInterval and refreshes on visibilitychange', () => {
    assert.match(clientSource, /setInterval\(\s*load\s*,\s*3000\s*\)/);
    assert.match(clientSource, /visibilitychange/);
    assert.match(clientSource, /document\.visibilityState\s*===\s*["']visible["']/);
    assert.match(clientSource, /document\.addEventListener\(\s*["']visibilitychange["']/);
    assert.match(clientSource, /document\.removeEventListener\(\s*["']visibilitychange["']/);
  });

  it('registers the Spec 工作流 as a conversation.view chat tab (not a settings section)', () => {
    assert.match(clientSource, /ctx\.slots\.inject\(\s*["']conversation\.view["']/);
    assert.match(clientSource, /name:\s*["']conversation\.view["']/);
    assert.match(clientSource, /id:\s*["']ssf["']/);
    assert.match(clientSource, /order:\s*20/);
    assert.equal(clientSource.includes("settings.section"), false, 'settings-page section must be removed');
  });

  it('renders empty/list/detail branches with the snapshot data', () => {
    assert.match(clientSource, /未发现变更或投影不可用/);
    // New client polls a plain snapshot JSON (not SettingsScope wrapper).
    // It supports both bare workspaces array and { workspaces, changes } snapshot.
    // Accept either `payload.workspaces ?? payload` or legacy `payload && payload.workspaces`.
    assert.match(clientSource, /payload\.workspaces/);
    assert.match(clientSource, /formatWorkspaces\(/);
    assert.match(clientSource, /formatChangeList/);
    assert.match(clientSource, /\.map\(\(c\) =>/);
    assert.match(clientSource, /formatChangeDetail\(selectedWithWs\)/);
    assert.match(clientSource, /`\$\{c\.name\} — \$\{c\.state\}/);
    // current-workspace filter from the session list cwd.
    assert.match(clientSource, /sessionsList\?\.getSnapshot\?\.\(\)\.byId\?\.\[sessionId\]\?\.cwd/);
    assert.match(clientSource, /normalizePath\(w\.path\) === normalizePath\(cwd\)/);
  });

  it('keeps last snapshot on fetch failure and uses React state', () => {
    // The tab keeps last snapshot on failure: setError but not clearing snapshot
    assert.match(clientSource, /setError\(/);
    // Uses react.useState for snapshot
    assert.match(clientSource, /react\.useState\(\s*null\s*\)/);
  });

  it('uses React.createElement (no JSX) and requires react', () => {
    assert.match(clientSource, /require\(\s*["']react["']\s*\)/);
    assert.match(clientSource, /createElement/);
  });
});
