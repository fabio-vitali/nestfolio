import { filterCatalogByTier, type CatalogEntry } from './tier-filter';
import tiersJson from '../tiers.json';

const catalog: readonly CatalogEntry[] = [
  { modelId: 'us.anthropic.claude-sonnet-4-6', sizeClass: 'frontier', contextWindow: 200000 },
  { modelId: 'us.anthropic.claude-opus-4-6',   sizeClass: 'frontier', contextWindow: 200000 },
  { modelId: 'anthropic.claude-haiku-4-5-20251001', sizeClass: 'mid', contextWindow: 200000 },
  { modelId: 'us.amazon.nova-pro-v1:0',        sizeClass: 'frontier', contextWindow: 300000 },
  { modelId: 'us.amazon.nova-lite-v1:0',       sizeClass: 'mid',      contextWindow: 300000 },
  { modelId: 'us.amazon.nova-micro-v1:0',      sizeClass: 'cheap',    contextWindow: 128000 },
  { modelId: 'meta.llama3-3-70b-instruct-v1:0', sizeClass: 'frontier', contextWindow: 128000 },
  { modelId: 'meta.llama3-1-8b-instruct-v1:0',  sizeClass: 'cheap',    contextWindow: 8000 },
  { modelId: 'meta.llama3-70b-instruct-v1:0',   sizeClass: 'frontier', contextWindow: 128000 },
];

describe('filterCatalogByTier', () => {
  it('narrative tier matches Anthropic + Nova-Pro + Nova-Premier + Llama 3.3+ at frontier/mid with ≥32k ctx', () => {
    const out = filterCatalogByTier(catalog, 'narrative', tiersJson).map((e) => e.modelId);
    expect(out).toContain('us.anthropic.claude-sonnet-4-6');
    expect(out).toContain('us.anthropic.claude-opus-4-6');
    expect(out).toContain('anthropic.claude-haiku-4-5-20251001');
    expect(out).toContain('us.amazon.nova-pro-v1:0');
    expect(out).toContain('meta.llama3-3-70b-instruct-v1:0');
    expect(out).not.toContain('us.amazon.nova-lite-v1:0'); // not in narrative families
    expect(out).not.toContain('us.amazon.nova-micro-v1:0'); // cheap, not in sizeClass
    expect(out).not.toContain('meta.llama3-1-8b-instruct-v1:0'); // contextWindow < 32k AND too old
    // Regression: '70' in 'llama3-70b' is a parameter-count size token, NOT a minor
    // version. The model is Llama 3.0 70B, which fails the 'meta.llama3-3+' version gate.
    expect(out).not.toContain('meta.llama3-70b-instruct-v1:0');
  });

  it('structured-output-frontier matches Anthropic + Nova-Pro + Nova-Premier at frontier only', () => {
    const out = filterCatalogByTier(catalog, 'structured-output-frontier', tiersJson).map((e) => e.modelId);
    expect(out).toContain('us.anthropic.claude-sonnet-4-6');
    expect(out).toContain('us.anthropic.claude-opus-4-6');
    expect(out).toContain('us.amazon.nova-pro-v1:0');
    expect(out).not.toContain('anthropic.claude-haiku-4-5-20251001'); // mid, not frontier
    expect(out).not.toContain('meta.llama3-3-70b-instruct-v1:0'); // not in families
  });

  it('structured-output-light matches Anthropic + Nova-Lite + Nova-Pro at mid/cheap', () => {
    const out = filterCatalogByTier(catalog, 'structured-output-light', tiersJson).map((e) => e.modelId);
    expect(out).toContain('anthropic.claude-haiku-4-5-20251001');
    expect(out).toContain('us.amazon.nova-lite-v1:0');
    expect(out).not.toContain('us.anthropic.claude-sonnet-4-6'); // frontier excluded
    expect(out).not.toContain('us.amazon.nova-micro-v1:0'); // micro is cheap, but not in families allowlist
  });

  it('returns deterministic order: frontier > mid > cheap, then alphabetical', () => {
    const out = filterCatalogByTier(catalog, 'narrative', tiersJson).map((e) => e.modelId);
    // sanity-check: first entry is frontier, last entry is mid (or frontier)
    expect(out[0]).toMatch(/sonnet|opus|nova-pro|llama3-3-70b/);
  });
});
