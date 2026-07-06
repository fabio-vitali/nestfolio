// scripts/parity-oracle/parity-report.mjs — pure renderers for the parity oracle report. Every report
// ALWAYS carries the unmapped-rows table (the P5 migration checklist) — no silent caps.
import { MAPPING } from './mapping.mjs';

export function renderParity(rows) {
  const head = '| pair | legacy gate | rt gate | legacy totTok | rt totTok | verdict |\n|---|---|---|---|---|---|';
  const body = rows.map((r) => {
    if (r.error) return `| ${r.id} | — | — | — | — | **ERRORED** (${r.error}) |`;
    const v = r.verdict.dominant ? 'dominant' : `**NOT DOMINANT** (${r.verdict.reasons.join('; ')})`;
    return `| ${r.id} | ${r.legacy.gatePassRate} | ${r.runtime.gatePassRate} | ${r.legacy.tokens.total} | ${r.runtime.tokens.total} | ${v} |`;
  });
  return [head, ...body].join('\n');
}

export function renderDifferential(rows) {
  const head = '| rule | checks | mapped | class | legacy bad/good | runtime bad/good |\n|---|---|---|---|---|---|';
  const body = rows.map((r) =>
    `| ${r.rule} | ${r.checks.join(', ') || '—'} | ${r.mapped ? 'yes' : 'no'} | ${r.class} | ${r.legacy.bad}/${r.legacy.good} | ${r.runtime.bad}/${r.runtime.good} |`);
  return [head, ...body].join('\n');
}

export function renderUnmapped() {
  const head = '| legacy scenario | reason (P5 checklist) |\n|---|---|';
  const body = Object.entries(MAPPING).filter(([, m]) => m.unmapped).map(([id, m]) => `| ${id} | ${m.reason} |`);
  return [head, ...body].join('\n');
}

export function buildParityReport({ mode, rows = [], differential, parity, model, generatedAt, scope }) {
  const lines = [`# parity-oracle ${mode}`, ''];
  lines.push(`- **Generated:** ${generatedAt}`);
  lines.push(`- **Mode:** ${mode}`);
  if (scope) lines.push(`- **Scope:** ${scope}`);
  lines.push(`- **Model:** ${model ?? 'claude-opus-4-8'}`);
  lines.push('');
  if (parity) {
    lines.push(`## PARITY: ${parity.green ? '🟢 GREEN' : '🔴 RED'}`, '');
    if (!parity.green) {
      if (parity.nonDominant.length) lines.push(`- non-dominant pairs: ${parity.nonDominant.join(', ')}`);
      if (parity.redRules.length) lines.push(`- mapped rules caught by legacy only: ${parity.redRules.join(', ')}`);
      lines.push('');
    }
  }
  if (rows.length) lines.push('## Behavioral pairs', '', renderParity(rows), '');
  if (differential) lines.push('## Lint differential', '', renderDifferential(differential.rows), '');
  lines.push('## Unmapped scenarios (P5 checklist)', '', renderUnmapped(), '');
  return lines.join('\n');
}
