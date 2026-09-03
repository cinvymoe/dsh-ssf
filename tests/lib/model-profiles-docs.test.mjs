import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const PROFILES = ['mechanical', 'standard', 'strong', 'review'];
const FILES = [
  'skills/build-executor/SKILL.md',
  'README.md',
  'docs/README_en.md',
  'CHANGELOG.md',
];

describe('model profile documentation', () => {
  it('names every supported profile in all affected documentation', () => {
    for (const file of FILES) {
      const content = readFileSync(join(ROOT, file), 'utf8');
      for (const profile of PROFILES) {
        assert.match(content, new RegExp(`\\b${profile}\\b`), `${file} must name ${profile}`);
      }
    }
  });

  it('documents read-only resolution without automatic switching', () => {
    const zh = readFileSync(join(ROOT, 'README.md'), 'utf8');
    const en = readFileSync(join(ROOT, 'docs/README_en.md'), 'utf8');
    assert.match(zh, /--resolve-model/);
    assert.match(zh, /不切换当前会话模型/);
    assert.match(en, /--resolve-model/);
    assert.match(en, /does not switch models/);
  });
});
