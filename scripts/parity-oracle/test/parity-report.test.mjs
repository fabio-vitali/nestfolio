// scripts/parity-oracle/test/parity-report.test.mjs — the report always carries the three tables and
// the unmapped P5 checklist (no silent caps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildParityReport } from '../parity-report.mjs';
import { MAPPING } from '../mapping.mjs';

const agg = (rate) => ({ gatePassRate: rate, tokens: { total: 100 } });

test('report carries headline, pairs, differential, and the FULL unmapped table', () => {
  const md = buildParityReport({
    mode: 'parity', generatedAt: '2026-07-06T00:00:00Z', model: 'claude-opus-4-8',
    rows: [
      { id: 'add-orphan', legacy: agg(1), runtime: agg(1), verdict: { dominant: true, reasons: [] } },
      { id: 'add-fold-core', error: 'boom', verdict: { dominant: false, reasons: ['errored: boom'] } },
    ],
    differential: { rows: [{ rule: 'r1-id-matches-filename', checks: ['backlog-id-matches-filename'], mapped: true, class: 'both-catch', legacy: { bad: 1, good: 0 }, runtime: { bad: 1, good: 0 } }] },
    parity: { green: false, nonDominant: ['add-fold-core'], redRules: [] },
  });
  assert.ok(md.includes('🔴 RED'));
  assert.ok(md.includes('**ERRORED** (boom)'));
  assert.ok(md.includes('both-catch'));
  for (const [id, m] of Object.entries(MAPPING)) if (m.unmapped) assert.ok(md.includes(id), `unmapped ${id} must be listed`);
});

test('green headline when parity holds', () => {
  const md = buildParityReport({ mode: 'parity', generatedAt: 'x', rows: [], differential: { rows: [] }, parity: { green: true, nonDominant: [], redRules: [] } });
  assert.ok(md.includes('🟢 GREEN'));
});
