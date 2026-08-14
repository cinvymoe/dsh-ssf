// tests/lib/dsh-ssf-change-scanner.test.mjs
// Tests for packages/dsh-ssf/lib/change-scanner.js — scanChanges/summarizeChange
// Fixture style follows tests/lib/cmd-list.test.mjs: mkdtempSync + hand-written
// .spec-superflow.yaml (writeFileSync of "key: value" lines).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readState } from '../../scripts/lib/state-loader.mjs';

let scanner;

before(async () => {
  const modulePath = join(process.cwd(), 'packages/dsh-ssf/lib/change-scanner.js');
  const mod = await import(modulePath);
  scanner = mod;
});

const createdRoots = [];

function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ssf-scanner-'));
  createdRoots.push(root);
  return root;
}

function writeStateFile(dir, state) {
  const lines = [];
  for (const [key, value] of Object.entries(state)) {
    lines.push(`${key}: ${value}`);
  }
  writeFileSync(join(dir, '.spec-superflow.yaml'), lines.join('\n'));
}

after(() => {
  for (const root of createdRoots) rmSync(root, { recursive: true, force: true });
});

describe('dsh-ssf change-scanner: summarizeChange()', () => {
  it('summarizes a change with a valid state file, raw matching readState verbatim', () => {
    const root = makeWorkspace();
    const changeDir = join(root, 'my-change');
    mkdirSync(changeDir);
    writeStateFile(changeDir, {
      state: 'executing',
      workflow: 'hotfix',
      last_transition: '2026-08-14T14:57:56.364Z',
      dp_0_decisions: 'scope=把 spec-superflow 封装为正式 DSH 插件；constraints=无特别约束',
      dp_0_confirmed: 'true',
      dp_0_result: 'confirmed',
      dp_3_result: 'bridged',
      dp_4_result: 'approved',
      dp_7_result: 'null',
      artifacts_hash: 'sha256:abc123',
      contract_hash: 'sha256:def456',
    });

    const summary = scanner.summarizeChange(changeDir);

    assert.equal(summary.name, 'my-change');
    assert.equal(summary.state, 'executing');
    assert.equal(summary.workflow, 'hotfix');
    assert.equal(summary.status, 'EXECUTING');
    assert.equal(summary.detail, 'executing (hotfix)');
    assert.equal(summary.stateFileMissing, undefined);
    assert.equal(summary.parseError, undefined);

    // raw is the exact readState result — same top-level keys and values the CLI reads
    assert.deepEqual(summary.raw, readState(changeDir));
    assert.equal(summary.raw.state, 'executing');
    assert.equal(summary.raw.workflow, 'hotfix');
    assert.equal(summary.raw.last_transition, '2026-08-14T14:57:56.364Z');
    assert.equal(
      summary.raw.dp_0_decisions,
      'scope=把 spec-superflow 封装为正式 DSH 插件；constraints=无特别约束',
    );
    assert.equal(summary.raw.dp_0_confirmed, 'true');
    assert.equal(summary.raw.dp_0_result, 'confirmed');
    assert.equal(summary.raw.dp_3_result, 'bridged');
    assert.equal(summary.raw.dp_4_result, 'approved');
    assert.equal(summary.raw.artifacts_hash, 'sha256:abc123');
    assert.equal(summary.raw.contract_hash, 'sha256:def456');
    // null-valued keys are kept, not filtered
    assert.ok(Object.prototype.hasOwnProperty.call(summary.raw, 'dp_7_result'));
    assert.equal(summary.raw.dp_7_result, null);
  });

  it('treats persisted workflow auto as the default full (CLI normalization)', () => {
    const root = makeWorkspace();
    const changeDir = join(root, 'auto-wf');
    mkdirSync(changeDir);
    writeStateFile(changeDir, { state: 'executing', workflow: 'auto' });

    const summary = scanner.summarizeChange(changeDir);

    assert.equal(summary.workflow, 'full');
    // raw still carries the verbatim value as the CLI reads it
    assert.equal(summary.raw.workflow, 'auto');
    assert.equal(summary.raw.state, 'executing');
  });

  it('marks a missing state file and infers status from content', () => {
    const root = makeWorkspace();
    const changeDir = join(root, 'no-state');
    mkdirSync(changeDir);

    const summary = scanner.summarizeChange(changeDir);

    assert.equal(summary.name, 'no-state');
    assert.equal(summary.stateFileMissing, true);
    assert.equal(summary.raw, null);
    assert.equal(summary.state, 'exploring');
    assert.equal(summary.workflow, 'full');
    assert.equal(summary.status, 'INCOMPLETE');
    assert.ok(summary.detail.includes('Missing proposal.md'));
  });

  it('reports a parse error for malformed yaml without throwing', () => {
    const root = makeWorkspace();
    const changeDir = join(root, 'corrupt');
    mkdirSync(changeDir);
    writeFileSync(join(changeDir, '.spec-superflow.yaml'), 'state: [unclosed\n');

    let summary;
    assert.doesNotThrow(() => {
      summary = scanner.summarizeChange(changeDir);
    });

    assert.equal(summary.name, 'corrupt');
    assert.ok(summary.parseError && summary.parseError.length > 0);
    assert.equal(summary.raw, null);
    assert.equal(summary.stateFileMissing, undefined);
    assert.equal(typeof summary.status, 'string');
    assert.equal(typeof summary.detail, 'string');
  });
});

describe('dsh-ssf change-scanner: scanChanges()', () => {
  it('scans every direct subdirectory of changes/', () => {
    const root = makeWorkspace();
    const changesDir = join(root, 'changes');
    const alphaDir = join(changesDir, 'alpha');
    const betaDir = join(changesDir, 'beta');
    mkdirSync(alphaDir, { recursive: true });
    mkdirSync(betaDir, { recursive: true });
    writeStateFile(alphaDir, { state: 'executing', workflow: 'full' });
    // beta intentionally has no state file and no proposal

    const results = scanner.scanChanges(root);

    assert.ok(Array.isArray(results));
    assert.equal(results.length, 2);
    assert.deepEqual(results.map((r) => r.name).sort(), ['alpha', 'beta']);

    const alpha = results.find((r) => r.name === 'alpha');
    assert.equal(alpha.state, 'executing');
    assert.equal(alpha.workflow, 'full');
    assert.equal(alpha.raw.state, 'executing');
    assert.equal(alpha.stateFileMissing, undefined);

    const beta = results.find((r) => r.name === 'beta');
    assert.equal(beta.stateFileMissing, true);
    assert.equal(beta.raw, null);
    assert.equal(beta.status, 'INCOMPLETE');
  });

  it('returns an empty array when changes/ does not exist', () => {
    const root = makeWorkspace();
    assert.deepEqual(scanner.scanChanges(root), []);
  });

  it('returns an empty array for a nonexistent workspace root (never throws)', () => {
    const root = join(tmpdir(), `dsh-ssf-scanner-missing-${Date.now()}`);
    assert.deepEqual(scanner.scanChanges(root), []);
  });
});
