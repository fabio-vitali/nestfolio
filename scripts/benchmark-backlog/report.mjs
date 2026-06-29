import { writeFileSync, mkdirSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';

export function flagBands(value, baseline, bandPct) {
  const delta = (value - baseline) / (baseline || 1);
  return { flagged: Math.abs(delta) > bandPct, deltaPct: delta };
}

// `totTok` is `tokens.total` — the amortized whole-run token consumption, the headline value signal
// (it captures the cache-re-read cost of skill prose). It replaces the removed, mis-calibrated
// `firstTurnProseTokens` one-time-load proxy. See cost.mjs.
export function renderEvaluation(rows) {
  const head = '| scenario | gatePassRate | cost$ | totTok | turns |\n|---|---|---|---|---|';
  return [head, ...rows.map((r) => `| ${r.id} | ${r.gatePassRate} | ${r.costUsd} | ${r.tokens.total} | ${r.numTurns} |`)].join('\n');
}

export function renderCompare(rows) {
  const head = '| scenario | gate A→B | cost$ A→B | totTok A→B | verdict |\n|---|---|---|---|---|';
  const body = rows.map((r) => {
    const regressed = r.b.gatePassRate < r.a.gatePassRate;
    // Value verdict keys off tokens.total (the proven amortized signal), not the $-weighted costUsd.
    const verdict = regressed ? '**REGRESSION**' : (r.b.tokens.total < r.a.tokens.total ? 'value↑' : 'flat');
    return `| ${r.id} | ${r.a.gatePassRate}→${r.b.gatePassRate} | ${r.a.costUsd}→${r.b.costUsd} | ${r.a.tokens.total}→${r.b.tokens.total} | ${verdict} |`;
  });
  return [head, ...body].join('\n');
}

// PURE: assemble the full markdown report (header + rendered table + a findings summary) for a run.
// `compare` uses renderCompare and flags REGRESSION rows; other modes use renderEvaluation.
export function buildReport({ mode, rows, refA, refB, scope, model, generatedAt }) {
  const title = mode === 'compare' ? `benchmark-backlog compare ${refA} → ${refB}` : `benchmark-backlog ${mode}`;
  const lines = [`# ${title}`, ''];
  lines.push(`- **Generated:** ${generatedAt}`);
  lines.push(`- **Mode:** ${mode}${mode === 'compare' ? ` (A=${refA}, B=${refB})` : ''}`);
  if (scope) lines.push(`- **Scope:** ${scope}`);
  lines.push(`- **Model:** ${model ?? 'claude-opus-4-8'}`);
  lines.push(`- **Scenarios:** ${rows.length}`, '');
  if (mode === 'compare') {
    const regressions = rows.filter((r) => r.b?.gatePassRate < r.a?.gatePassRate).map((r) => r.id);
    lines.push('## Findings', '');
    lines.push(regressions.length ? `- ⚠ **${regressions.length} REGRESSION row(s):** ${regressions.join(', ')}` : '- ✓ no REGRESSION rows');
    lines.push('', '## Comparison', '', renderCompare(rows));
  } else {
    lines.push('## Evaluation', '', renderEvaluation(rows));
  }
  lines.push('');
  return lines.join('\n');
}

// Thin I/O: write `markdown` under `dir` as `<mode>-<sanitized-generatedAt>.md`; return the absolute path.
// `dir` is the gitignored benchmarks/backlog directory; `generatedAt` (ISO) is sanitized into the name.
export function writeReport({ markdown, dir, mode, generatedAt }) {
  mkdirSync(dir, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const path = join(dir, `${mode}-${stamp}.md`);
  writeFileSync(path, markdown);
  return isAbsolute(path) ? path : resolve(path);
}
