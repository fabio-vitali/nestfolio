// us-east-1 on-demand, USD per token. cacheWrite=5m write (~1.25× input), cacheRead (~0.1× input).
export const PRICES = {
  'claude-haiku-4-5-20251001': { input: 1.0e-6, output: 5.0e-6, cacheWrite: 1.25e-6, cacheRead: 0.1e-6 },
  // backlog skills normally run on Opus; pin the measured model in run.mjs and add its row here from cost.mjs PRICES.
  'claude-opus-4-8': { input: 15e-6, output: 75e-6, cacheWrite: 18.75e-6, cacheRead: 1.5e-6 },
};
export function computeCostUSD(perTurn, modelId) {
  const p = PRICES[modelId];
  if (!p) throw new Error(`no price row for ${modelId} — add it to cost.mjs PRICES`);
  return perTurn.reduce((s, u) =>
    s + (u.input_tokens ?? 0) * p.input + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite
      + (u.cache_read_input_tokens ?? 0) * p.cacheRead + (u.output_tokens ?? 0) * p.output, 0);
}
export function firstTurnProseTokens(perTurn, skillLoadTurnIndex, floorTokens) {
  const u = perTurn[skillLoadTurnIndex];
  if (!u) throw new Error(`no turn at index ${skillLoadTurnIndex}`);
  return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) - floorTokens;
}
