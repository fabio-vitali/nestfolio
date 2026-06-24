import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCostUSD, firstTurnProseTokens, PRICES } from '../cost.mjs';

const M = 'claude-haiku-4-5-20251001';
test('computeCostUSD sums per-turn tokens × price with cache multipliers', () => {
  const perTurn = [{ input_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000, output_tokens: 200 }];
  const p = PRICES[M];
  const expected = 100 * p.input + 1000 * p.cacheWrite + 5000 * p.cacheRead + 200 * p.output;
  assert.equal(computeCostUSD(perTurn, M), expected);
});
test('firstTurnProseTokens = cache-inclusive sum at skill-load turn minus floor', () => {
  const perTurn = [ { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 9000, output_tokens: 5 },
                    { input_tokens: 20, cache_creation_input_tokens: 8000, cache_read_input_tokens: 1000, output_tokens: 50 } ];
  // skill loads on turn index 1; floor = 5000
  assert.equal(firstTurnProseTokens(perTurn, 1, 5000), 20 + 8000 + 1000 - 5000);
});
