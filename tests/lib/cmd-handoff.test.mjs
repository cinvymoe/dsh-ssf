// Dispatcher-level tests for ssf handoff.
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'scripts/spec-superflow.mjs');
let changeDir;

function runSsf(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      exitCode: error.status || 1,
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || error.message,
    };
  }
}

beforeEach(() => {
  changeDir = mkdtempSync(join(tmpdir(), 'ssf-handoff-'));
  writeFileSync(join(changeDir, 'proposal.md'), '# Proposal\n\nA valid proposal.\n');
  writeFileSync(join(changeDir, 'design.md'), '# Design\n\nA valid design.\n');
  writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Original task text\n');
  writeFileSync(join(changeDir, '.spec-superflow.yaml'), 'state: executing\nworkflow: auto\n');
});

afterEach(() => {
  rmSync(changeDir, { recursive: true, force: true });
});

describe('ssf handoff', () => {
  it('creates, finishes, and resolves a prototype contract without mutating planning files', () => {
    const designBefore = readFileSync(join(changeDir, 'design.md'));
    const tasksBefore = readFileSync(join(changeDir, 'tasks.md'));
    const create = runSsf([
      'handoff', 'create', changeDir, '--type', 'prototype',
      '--objective', 'Compare two filter interactions',
      '--expected-output', 'A short recommendation with evidence',
      '--acceptance', 'Document one recommended interaction',
      '--boundary', 'Do not alter planning artifacts', '--boundary', 'Use only fixture data',
    ]);
    assert.equal(create.exitCode, 0, create.stderr);

    const listed = runSsf(['handoff', 'list', changeDir, '--json']);
    assert.equal(listed.exitCode, 0, listed.stderr);
    const handoff = JSON.parse(listed.stdout).handoffs[0];
    assert.equal(handoff.type, 'prototype');
    assert.match(handoff.source, /- Do not alter planning artifacts/);
    assert.match(handoff.source, /- Use only fixture data/);

    writeFileSync(join(handoff.directory, 'HANDOFF_RESULT.md'), validResult());
    assert.equal(runSsf(['handoff', 'finish', changeDir, handoff.id]).exitCode, 0);
    assert.equal(runSsf(['handoff', 'resolve', changeDir, handoff.id, '--decision', 'accept']).exitCode, 0);
    assert.deepEqual(readFileSync(join(changeDir, 'design.md')), designBefore);
    assert.deepEqual(readFileSync(join(changeDir, 'tasks.md')), tasksBefore);
  });

  it('rejects an unknown handoff type', () => {
    const result = runSsf([
      'handoff', 'create', changeDir, '--type', 'unknown', '--objective', 'Objective',
      '--expected-output', 'Expected output', '--acceptance', 'Acceptance',
    ]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Unsupported handoff type 'unknown'/);
  });

  it('rejects a result without evidence and leaves the handoff active', () => {
    const handoff = createHandoff();
    writeFileSync(join(handoff.directory, 'HANDOFF_RESULT.md'), validResult().replace('Prototype screenshots and task notes.', ''));

    const result = runSsf(['handoff', 'finish', changeDir, handoff.id]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Evidence must contain non-empty content/);
    assert.equal(getHandoff(handoff.id).status, 'active');
  });

  it('rejects an active handoff resolution', () => {
    const handoff = createHandoff();
    const result = runSsf(['handoff', 'resolve', changeDir, handoff.id, '--decision', 'accept']);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /is not result-ready/);
  });

  it('rejects an unknown resolution decision', () => {
    const handoff = createHandoff();
    const result = runSsf(['handoff', 'resolve', changeDir, handoff.id, '--decision', 'ignore']);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Unsupported handoff decision 'ignore'/);
  });

  it('requires acknowledgement when source artifacts drift', () => {
    const handoff = createHandoff();
    writeFileSync(join(handoff.directory, 'HANDOFF_RESULT.md'), validResult());
    assert.equal(runSsf(['handoff', 'finish', changeDir, handoff.id]).exitCode, 0);
    writeFileSync(join(changeDir, 'proposal.md'), '# Proposal\n\nChanged after handoff creation.\n');

    const unresolved = runSsf(['handoff', 'resolve', changeDir, handoff.id, '--decision', 'accept']);
    assert.equal(unresolved.exitCode, 1);
    assert.match(unresolved.stderr, /acknowledge-source-drift/);
    assert.equal(runSsf([
      'handoff', 'resolve', changeDir, handoff.id, '--decision', 'accept', '--acknowledge-source-drift',
    ]).exitCode, 0);
  });
});

function createHandoff() {
  const result = runSsf([
    'handoff', 'create', changeDir, '--type', 'research', '--objective', 'Inspect behavior',
    '--expected-output', 'Document findings', '--acceptance', 'List evidence',
  ]);
  assert.equal(result.exitCode, 0, result.stderr);
  return JSON.parse(runSsf(['handoff', 'list', changeDir, '--json']).stdout).handoffs[0];
}

function getHandoff(id) {
  return JSON.parse(runSsf(['handoff', 'list', changeDir, '--json']).stdout)
    .handoffs.find(handoff => handoff.id === id);
}

function validResult() {
  return [
    '## Conclusion\n\nKeep the compact filter interaction.',
    '## Evidence\n\nPrototype screenshots and task notes.',
    '## Produced Artifacts\n\nprototype/filter.md',
    '## Risks\n\nKeyboard flow needs a follow-up.',
    '## Suggested Changes\n\n- Add keyboard behavior to tasks.md.',
    '',
  ].join('\n');
}
