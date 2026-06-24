export function flagBands(value, baseline, bandPct) {
  const delta = (value - baseline) / (baseline || 1);
  return { flagged: Math.abs(delta) > bandPct, deltaPct: delta };
}

export function renderEvaluation(rows) {
  const head = '| scenario | gatePassRate | cost$ | proseTok | turns |\n|---|---|---|---|---|';
  return [head, ...rows.map((r) => `| ${r.id} | ${r.gatePassRate} | ${r.costUsd} | ${r.firstTurnProseTokens} | ${r.numTurns} |`)].join('\n');
}

export function renderCompare(rows) {
  const head = '| scenario | gate A→B | cost$ A→B | proseTok A→B | verdict |\n|---|---|---|---|---|';
  const body = rows.map((r) => {
    const regressed = r.b.gatePassRate < r.a.gatePassRate;
    const verdict = regressed ? '**REGRESSION**' : (r.b.costUsd < r.a.costUsd ? 'value↑' : 'flat');
    return `| ${r.id} | ${r.a.gatePassRate}→${r.b.gatePassRate} | ${r.a.costUsd}→${r.b.costUsd} | ${r.a.firstTurnProseTokens}→${r.b.firstTurnProseTokens} | ${verdict} |`;
  });
  return [head, ...body].join('\n');
}
