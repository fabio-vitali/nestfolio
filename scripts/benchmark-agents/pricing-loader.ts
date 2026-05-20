import fs from 'node:fs';
import path from 'node:path';
import type { PricingCache } from './lib/types';

const PRICING_PATH = path.resolve('benchmarks/cache/pricing.json');

export function computeCostUSD(
  cache: PricingCache,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const entry = cache.models[modelId];
  if (!entry) {
    throw new Error(
      `no pricing entry for ${modelId}. Re-run refresh-pricing.ts after updating tiers.json / production configs.`,
    );
  }
  return (
    (inputTokens / 1_000_000) * entry.inputUSDPerMTok +
    (outputTokens / 1_000_000) * entry.outputUSDPerMTok
  );
}

export function loadPricingCache(): PricingCache {
  if (!fs.existsSync(PRICING_PATH)) {
    throw new Error(
      `pricing cache missing at ${PRICING_PATH} — run scripts/benchmark-agents/refresh-pricing.ts`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(PRICING_PATH, 'utf8')) as PricingCache;
  const ageMs = Date.now() - new Date(raw.fetchedAt).getTime();
  if (ageMs > 7 * 24 * 3600 * 1000) {
    console.warn(
      `[pricing-loader] cache is ${Math.floor(ageMs / 86400000)}d old — consider --refresh-pricing`,
    );
  }
  return raw;
}
