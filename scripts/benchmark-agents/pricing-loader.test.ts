import { baseModelIdFor, computeCostUSD } from './pricing-loader';
import type { PricingCache } from './lib/types';

const cache: PricingCache = {
  fetchedAt: '2026-05-19T00:00:00Z',
  models: {
    'anthropic.claude-sonnet-4-6': { inputUSDPerMTok: 3.0, outputUSDPerMTok: 15.0 },
    'us.anthropic.claude-opus-4-6-v1': { inputUSDPerMTok: 15.0, outputUSDPerMTok: 75.0 },
    'amazon.nova-pro': { inputUSDPerMTok: 0.8, outputUSDPerMTok: 3.2 },
  },
};

describe('baseModelIdFor', () => {
  it('strips us. inference-profile prefix', () => {
    expect(baseModelIdFor('us.anthropic.claude-sonnet-4-6')).toBe('anthropic.claude-sonnet-4-6');
  });
  it('strips -v1:0 suffix on Nova-style ids', () => {
    expect(baseModelIdFor('amazon.nova-pro-v1:0')).toBe('amazon.nova-pro');
    expect(baseModelIdFor('amazon.nova-lite-v1:0')).toBe('amazon.nova-lite');
  });
  it('leaves already-bare ids untouched', () => {
    expect(baseModelIdFor('meta.llama3-3-70b-instruct')).toBe('meta.llama3-3-70b-instruct');
  });
});

describe('computeCostUSD', () => {
  it('uses literal modelId when present in cache', () => {
    const usd = computeCostUSD(cache, 'us.anthropic.claude-opus-4-6-v1', 1_000_000, 500_000);
    expect(usd).toBeCloseTo(52.5, 4);
  });
  it('falls back to base modelId when literal misses', () => {
    const usd = computeCostUSD(cache, 'us.anthropic.claude-sonnet-4-6', 1_000_000, 1_000_000);
    expect(usd).toBeCloseTo(18.0, 4);
  });
  it('strips both prefix and -v1:0 to find Nova base', () => {
    const usd = computeCostUSD(cache, 'amazon.nova-pro-v1:0', 500_000, 500_000);
    expect(usd).toBeCloseTo(2.0, 4);
  });
  it('throws when both literal and base miss', () => {
    expect(() => computeCostUSD(cache, 'us.anthropic.claude-mystery-99', 1, 1)).toThrow(/no pricing/);
  });
});
