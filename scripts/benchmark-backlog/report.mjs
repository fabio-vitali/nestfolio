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
