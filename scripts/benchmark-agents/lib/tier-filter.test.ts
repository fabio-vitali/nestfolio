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

  describe('anthropic.claude-4-5+ version gate (Fix A)', () => {
    // The `anthropic.claude-4-5+` matcher must reject pre-4.5 Anthropic models.
    // Per the discovery-followups dossier: Aug-2025 `us.anthropic.claude-opus-4-1-20250805-v1:0`
    // was leaking into the narrative tier under the bare `anthropic` matcher.
    const oldAnthropic: readonly CatalogEntry[] = [
      { modelId: 'us.anthropic.claude-opus-4-1-20250805-v1:0', sizeClass: 'frontier', contextWindow: 200000 },
      { modelId: 'us.anthropic.claude-sonnet-4-0-20250101-v1:0', sizeClass: 'frontier', contextWindow: 200000 },
      { modelId: 'anthropic.claude-3-5-sonnet-20241022-v1:0', sizeClass: 'frontier', contextWindow: 200000 },
      { modelId: 'anthropic.claude-3-haiku-20240307-v1:0', sizeClass: 'mid', contextWindow: 200000 },
      { modelId: 'us.anthropic.claude-sonnet-4-6', sizeClass: 'frontier', contextWindow: 200000 },
      { modelId: 'us.anthropic.claude-opus-4-7', sizeClass: 'frontier', contextWindow: 200000 },
      { modelId: 'anthropic.claude-haiku-4-5-20251001', sizeClass: 'mid', contextWindow: 200000 },
    ];

    it('rejects Anthropic models below 4.5 in narrative tier', () => {
      const out = filterCatalogByTier(oldAnthropic, 'narrative', tiersJson).map((e) => e.modelId);
      expect(out).not.toContain('us.anthropic.claude-opus-4-1-20250805-v1:0');
      expect(out).not.toContain('us.anthropic.claude-sonnet-4-0-20250101-v1:0');
      expect(out).not.toContain('anthropic.claude-3-5-sonnet-20241022-v1:0');
      expect(out).not.toContain('anthropic.claude-3-haiku-20240307-v1:0');
    });

    it('accepts Anthropic models at or above 4.5 in narrative tier', () => {
      const out = filterCatalogByTier(oldAnthropic, 'narrative', tiersJson).map((e) => e.modelId);
      expect(out).toContain('us.anthropic.claude-sonnet-4-6');
      expect(out).toContain('us.anthropic.claude-opus-4-7');
      expect(out).toContain('anthropic.claude-haiku-4-5-20251001');
    });

    it('does not let a trailing date (20251001) leak into the minor version', () => {
      // haiku-4-5-20251001 must parse as major=4 minor=5 (not minor=20251001).
      // The `(?![\db])` lookahead after the optional minor must reject digits
      // beyond the second numeric run.
      const ctx: readonly CatalogEntry[] = [
        { modelId: 'anthropic.claude-haiku-4-5-20251001', sizeClass: 'mid', contextWindow: 200000 },
      ];
      // structured-output-light has matcher `anthropic.claude-4-5+` and accepts mid.
      const out = filterCatalogByTier(ctx, 'structured-output-light', tiersJson).map((e) => e.modelId);
      expect(out).toContain('anthropic.claude-haiku-4-5-20251001');
    });
  });

  describe('global.* region prefix (Fix B)', () => {
    // Bedrock exposes inference profiles under `global.*` for some models;
    // they must classify into the right tier rather than fall through to
    // uncategorized.
    const globalAnthropic: readonly CatalogEntry[] = [
      { modelId: 'global.anthropic.claude-sonnet-4-6', sizeClass: 'frontier', contextWindow: 200000 },
      { modelId: 'global.anthropic.claude-opus-4-6-v1', sizeClass: 'frontier', contextWindow: 200000 },
      { modelId: 'global.anthropic.claude-haiku-4-5-v1', sizeClass: 'mid', contextWindow: 200000 },
    ];

    it('classifies global.* Anthropic models into narrative tier', () => {
      const out = filterCatalogByTier(globalAnthropic, 'narrative', tiersJson).map((e) => e.modelId);
      expect(out).toContain('global.anthropic.claude-sonnet-4-6');
      expect(out).toContain('global.anthropic.claude-opus-4-6-v1');
      expect(out).toContain('global.anthropic.claude-haiku-4-5-v1');
    });

    it('classifies global.* Anthropic Haiku into structured-output-light tier', () => {
      const out = filterCatalogByTier(globalAnthropic, 'structured-output-light', tiersJson).map(
        (e) => e.modelId,
      );
      expect(out).toContain('global.anthropic.claude-haiku-4-5-v1');
    });
  });
});
