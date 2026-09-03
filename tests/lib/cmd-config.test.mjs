import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'scripts/spec-superflow.mjs');
let tempDir;

before(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'ssf-cmd-config-test-'));
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeConfig(config) {
  writeFileSync(join(tempDir, 'spec-superflow.config.json'), JSON.stringify(config));
}

function runSsf(args) {
  try {
    return {
      exitCode: 0,
      stdout: execFileSync(process.execPath, [CLI, ...args], {
        cwd: tempDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      }), stderr: '',
    };
  } catch (error) {
    return {
      exitCode: error.status ?? 1,
      stdout: error.stdout?.toString() ?? '',
      stderr: error.stderr?.toString() ?? error.message,
    };
  }
}

describe('ssf config --resolve-model', () => {
  it('documents model profile resolution in CLI help', () => {
    const result = runSsf(['--help']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /config --resolve-model <profile>/);
    assert.match(result.stdout, /without switching models/);
  });

  it('prints configured standard model profile JSON through the dispatcher', () => {
    writeConfig({ models: { standard: 'vendor-standard', strong: 'vendor-strong' } });
    const result = runSsf(['config', '--resolve-model', 'standard']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      profile: 'standard', model: 'vendor-standard', configured: true,
    });
  });

  it('prints configured strong model profile JSON through the dispatcher', () => {
    writeConfig({ models: { standard: 'vendor-standard', strong: 'vendor-strong' } });
    const result = runSsf(['config', '--resolve-model', 'strong']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      profile: 'strong', model: 'vendor-strong', configured: true,
    });
  });

  it('prints a valid unmapped result', () => {
    writeConfig({ models: {} });
    const unmapped = runSsf(['config', '--resolve-model', 'review']);
    assert.equal(unmapped.exitCode, 0, unmapped.stderr);
    assert.deepStrictEqual(JSON.parse(unmapped.stdout), {
      profile: 'review', model: null, configured: false,
    });
  });

  it('rejects an unknown profile with supported names in stderr', () => {
    const unknown = runSsf(['config', '--resolve-model', 'fast']);
    assert.equal(unknown.exitCode, 1);
    assert.match(unknown.stderr,
      /Unknown model profile 'fast'.*mechanical.*standard.*strong.*review/);
  });

  it('rejects a blank mapped profile with an actionable config path in stderr', () => {
    writeConfig({ models: { review: '' } });
    const blank = runSsf(['config', '--resolve-model', 'review']);
    assert.equal(blank.exitCode, 1);
    assert.match(blank.stderr, /models\.review must be a non-empty string/);
  });

  it('rejects a non-string mapped profile with an actionable config path in stderr', () => {
    writeConfig({ models: { strong: 42 } });
    const nonString = runSsf(['config', '--resolve-model', 'strong']);
    assert.equal(nonString.exitCode, 1);
    assert.match(nonString.stderr, /models\.strong must be a non-empty string/);
  });

  it('rejects a missing profile argument and preserves normal config lookup', () => {
    assert.equal(runSsf(['config', '--resolve-model']).exitCode, 2);
    writeConfig({ models: {} });
    assert.equal(runSsf(['config', '--get', 'execution.inlineThreshold']).stdout.trim(), '3');
  });
});
