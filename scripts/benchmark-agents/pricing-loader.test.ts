import { computeCostUSD } from './pricing-loader';
import type { PricingCache } from './lib/types';

const cache: PricingCache = {
  fetchedAt: '2026-05-20T00:00:00Z',
  models: {
    'us.anthropic.claude-sonnet-4-6': {
      inputUSDPerMTok: 3.0,
      outputUSDPerMTok: 15.0,
      source: 'aws-pricing-api',
      serviceCode: 'AmazonBedrockFoundationModels',
      inputUsagetype: 'USE1-MP:USE1_InputTokenCount_Global-Units',
      outputUsagetype: 'USE1-MP:USE1_OutputTokenCount_Global-Units',
      regionCode: 'us-east-1',
    },
    'us.amazon.nova-pro-v1:0': {
      inputUSDPerMTok: 0.8,
      outputUSDPerMTok: 3.2,
      source: 'aws-pricing-api',
      serviceCode: 'AmazonBedrock',
      inputUsagetype: 'USE1-NovaPro-input-tokens',
      outputUsagetype: 'USE1-NovaPro-output-tokens',
      regionCode: 'us-east-1',
    },
  },
};

describe('computeCostUSD', () => {
  it('computes cost for an exact-key match (Sonnet 4.6, 1000 in + 500 out)', () => {
    const cost = computeCostUSD(cache, 'us.anthropic.claude-sonnet-4-6', 1000, 500);
    // 1000/1M * 3.0 + 500/1M * 15.0 = 0.003 + 0.0075 = 0.0105
    expect(cost).toBeCloseTo(0.0105);
  });

  it('throws when modelId has no entry — caller must rerun refresh-pricing', () => {
    expect(() => computeCostUSD(cache, 'us.anthropic.claude-haiku-4-5-20251001', 100, 50)).toThrow(
      /no pricing entry/,
    );
  });

  it('Nova Pro cost reflects per-MTok rates', () => {
    const cost = computeCostUSD(cache, 'us.amazon.nova-pro-v1:0', 1_000_000, 1_000_000);
    // 1.0 * 0.8 + 1.0 * 3.2 = 4.0
    expect(cost).toBeCloseTo(4.0);
  });
});
