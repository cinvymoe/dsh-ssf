// tests/lib/dsh-ssf-format.test.mjs
// Tests for packages/dsh-ssf/client/format.js — pure formatting helpers
// (mirrored inline inside the client bundle; this ESM copy is the node-testable
// canonical form).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatChangeList, formatChangeDetail } from '../../packages/dsh-ssf/client/format.js';

const CLOSED = { name: 'z-closed', state: 'closing', workflow: 'full' };
const ABANDONED = { name: 'a-abandoned', state: 'abandoned', workflow: 'full' };
const ACTIVE_A = { name: 'a-active', state: 'executing', workflow: 'full' };
const ACTIVE_B = { name: 'b-active', state: 'specifying', workflow: 'full' };

describe('formatChangeList', () => {
  it('sorts active changes by name, closing/abandoned last', () => {
    const out = formatChangeList([CLOSED, ABANDONED, ACTIVE_B, ACTIVE_A]);
    assert.deepEqual(out.map((c) => c.name), ['a-active', 'b-active', 'z-closed', 'a-abandoned']);
  });

  it('keeps closing before abandoned within the terminal group', () => {
    const out = formatChangeList([ABANDONED, CLOSED]);
    assert.deepEqual(out.map((c) => c.name), ['z-closed', 'a-abandoned']);
  });

  it('returns [] for non-array input and does not mutate the input', () => {
    assert.deepEqual(formatChangeList(undefined), []);
    assert.deepEqual(formatChangeList(null), []);
    const input = [ACTIVE_A, ACTIVE_B];
    formatChangeList(input);
    assert.deepEqual(input.map((c) => c.name), ['a-active', 'b-active']);
  });
});

describe('formatChangeDetail', () => {
  it('lists non-empty dp_* decisions and last_transition from raw, in key order', () => {
    const item = {
      raw: {
        dp_0_decisions: 'scope=示例',
        dp_0_result: 'confirmed',
        dp_0_confirmed: 'true',
        dp_1_result: '',
        dp_3_result: 'approved',
        dp_7_result: null,
        last_transition: '2026-08-01T00:00:00Z',
      },
    };
    const rows = formatChangeDetail(item);
    assert.deepEqual(rows, [
      ['dp_0_decisions', 'scope=示例'],
      ['dp_0_result', 'confirmed'],
      ['dp_3_result', 'approved'],
      ['last_transition', '2026-08-01T00:00:00Z'],
    ]);
  });

  it('shows stateFileMissing/parseError markers when raw is absent', () => {
    const rows = formatChangeDetail({ stateFileMissing: true, parseError: undefined });
    assert.deepEqual(rows, [['stateFileMissing', 'true']]);
    const withError = formatChangeDetail({ stateFileMissing: true, parseError: 'bad yaml' });
    assert.deepEqual(withError, [
      ['stateFileMissing', 'true'],
      ['parseError', 'bad yaml'],
    ]);
  });

  it('returns [] for null/undefined items', () => {
    assert.deepEqual(formatChangeDetail(undefined), []);
    assert.deepEqual(formatChangeDetail(null), []);
  });
});
