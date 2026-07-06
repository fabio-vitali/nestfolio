// scripts/parity-oracle/verdict.mjs — pure D2 dominance math. A failure CLASS is a normalized label
// from an aggregate row's diagnostics: 'terminal', 'golden:<field path>' (text before the first ':'),
// or 'invariant:<full failure string>'. Tokens are never part of the verdict (D2).
export function failureClasses(row) {
  const d = row?.diagnostics;
  const classes = new Set();
  if (!d) return classes;
  if (d.terminalOk === false) classes.add('terminal');
  for (const f of d.goldenFailures ?? []) classes.add(`golden:${String(f).split(':')[0].trim()}`);
  for (const f of d.invariantFailures ?? []) classes.add(`invariant:${String(f).trim()}`);
  return classes;
}

export function pairVerdict({ legacy, runtime }) {
  if (legacy?.error || runtime?.error) return { dominant: false, reasons: [`errored: ${legacy?.error ?? runtime?.error}`] };
  const reasons = [];
  if (runtime.gatePassRate < legacy.gatePassRate) reasons.push(`gatePassRate ${runtime.gatePassRate} < legacy ${legacy.gatePassRate}`);
  const legacyClasses = failureClasses(legacy);
  for (const c of failureClasses(runtime)) if (!legacyClasses.has(c)) reasons.push(`new failure class: ${c}`);
  return { dominant: reasons.length === 0, reasons };
}

export function overallParity({ pairs, differential }) {
  const nonDominant = pairs.filter((p) => !p.verdict.dominant).map((p) => p.id);
  const redRules = (differential?.rows ?? []).filter((r) => r.mapped && r.class === 'legacy-only').map((r) => r.rule);
  return { green: nonDominant.length === 0 && redRules.length === 0, nonDominant, redRules };
}
