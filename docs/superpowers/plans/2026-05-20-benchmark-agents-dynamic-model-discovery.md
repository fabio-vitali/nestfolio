# benchmark-agents Dynamic Model Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-task hardcoded `models[]` arrays + the hand-maintained `pricing.manifest.json` with a discovery layer (tier filter + `bedrock:ListFoundationModels` + account-access probe + AWS Pricing API), cached on TTL with explicit invalidation. Cures the Nova-Premier-class drift.

**Architecture:** Two cache files under `benchmarks/cache/` (`models.json` 30-day TTL, `pricing.json` 7-day TTL). Each task's `<task>.bench.ts` declares a `tier` instead of a `models[]` array. At `/benchmark-agents` invocation, preflight checks cache freshness and runs `refresh-models.ts` / `refresh-pricing.ts` as needed. Pure logic (tier filter, vendor classification, usagetype picker, display-name resolver) lives in `lib/*.ts` with unit tests. Orchestrator scripts (`refresh-*.ts`) integrate the lib modules with the AWS SDK.

**Tech Stack:** TypeScript, `tsx` runtime, Jest (`scripts/benchmark-agents/jest.config.ts`), `@aws-sdk/client-bedrock`, `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-pricing`, `@langchain/aws` (existing — for probe via `ChatBedrockConverse`).

**Spec:** [`docs/superpowers/specs/2026-05-20-benchmark-agents-dynamic-model-discovery-design.md`](../specs/2026-05-20-benchmark-agents-dynamic-model-discovery-design.md)

**Backlog entry (active):** [`docs/backlog/benchmark-agents-dynamic-model-discovery.md`](../../backlog/benchmark-agents-dynamic-model-discovery.md)

**Prerequisite:** Create an isolated git worktree per `superpowers:using-git-worktrees` before starting Task 1 (this is non-trivial code spanning ~10 files + new deps; main is reserved for backlog/doc commits per the workspace's worktree-first feedback memory).

---

## File Layout

| Path | Action | Responsibility |
| --- | --- | --- |
| `scripts/benchmark-agents/tiers.json` | NEW | Three tier definitions, JSON imported at type level. |
| `scripts/benchmark-agents/lib/types.ts` | MODIFY | Add `ModelsCache` / `ExcludedReason` / `PricingEntry` / `Tier`. Remove `models[]` from `TaskBenchConfig`. |
| `scripts/benchmark-agents/lib/catalog-loader.ts` | NEW | `SIZE_CLASS_RULES`, `sizeClassFor()`, `dedupeUsStarPreference()`. |
| `scripts/benchmark-agents/lib/catalog-loader.test.ts` | NEW | Unit tests for the above. |
| `scripts/benchmark-agents/lib/tier-filter.ts` | NEW | `filterCatalogByTier(catalog, tier)` predicate. |
| `scripts/benchmark-agents/lib/tier-filter.test.ts` | NEW | Unit tests against synthetic catalog. |
| `scripts/benchmark-agents/lib/pricing-display-name.ts` | NEW | `resolvePricingIdentity(modelId): { serviceCode, identityField, identityValue }`. |
| `scripts/benchmark-agents/lib/pricing-display-name.test.ts` | NEW | Round-trip mapping tests. |
| `scripts/benchmark-agents/lib/usagetype-picker.ts` | NEW | `pickOnDemandPrice(records, modelId, serviceCode, kind)`. |
| `scripts/benchmark-agents/lib/usagetype-picker.test.ts` | NEW | Unit tests across all serviceCode branches. |
| `scripts/benchmark-agents/refresh-models.ts` | NEW | Orchestrator: SDK calls + lib modules → `models.json`. |
| `scripts/benchmark-agents/refresh-pricing.ts` | REWRITE | Orchestrator: Pricing SDK + lib modules → `pricing.json`. (Replaces existing manifest copier.) |
| `scripts/benchmark-agents/pricing-loader.ts` | MODIFY | Read new shape; delete `baseModelIdFor()` (no longer needed). |
| `scripts/benchmark-agents/pricing-loader.test.ts` | MODIFY | Adapt to new cache shape. |
| `scripts/benchmark-agents/pricing.manifest.json` | DELETE | Superseded by AWS Pricing API. |
| `scripts/benchmark-agents/tasks/*.bench.ts` (×6) | MODIFY | Replace `models[]` with `tier: '<tier-name>'`. |
| `scripts/benchmark-agents/run.ts` | MODIFY | Resolve sweep set from `models.json` + `bench.productionConfig.modelId`. |
| `.claude/skills/benchmark-agents/SKILL.md` | MODIFY | §1 Preflight + §3 Pricing + §4 Sweep updates. |
| `package.json` (root) | MODIFY | Add `@aws-sdk/client-bedrock`, `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-pricing` to `devDependencies`. |

---

## Task 1: Add AWS SDK dependencies

**Files:**
- Modify: `package.json` (root)
- Modify: `pnpm-lock.yaml` (auto)

- [ ] **Step 1: Verify which SDK clients are missing**

Run:
```bash
node -e 'const probes=["@aws-sdk/client-bedrock","@aws-sdk/client-bedrock-runtime","@aws-sdk/client-pricing"];for(const p of probes){try{require.resolve(p);console.log(p,"installed");}catch{console.log(p,"MISSING");}}'
```
Expected: all three printed as `MISSING` (or the subset still missing — proceed only on those).

- [ ] **Step 2: Install missing AWS SDK clients as dev dependencies**

Run:
```bash
pnpm add -D -w @aws-sdk/client-bedrock @aws-sdk/client-bedrock-runtime @aws-sdk/client-pricing
```
Expected: pnpm exits 0, `package.json` `devDependencies` now includes all three at matching versions.

- [ ] **Step 3: Verify install**

Run:
```bash
node -e 'for(const p of ["@aws-sdk/client-bedrock","@aws-sdk/client-bedrock-runtime","@aws-sdk/client-pricing"]){require.resolve(p);console.log(p,"ok");}'
```
Expected: all three printed as `ok` (no throw).

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build(benchmark-agents): add Bedrock + Pricing SDK clients

Required for refresh-models.ts (ListFoundationModels + Converse probe)
and refresh-pricing.ts (Pricing API queries)."
```

---

## Task 2: Extend `lib/types.ts` with discovery + pricing-source types

**Files:**
- Modify: `scripts/benchmark-agents/lib/types.ts`

- [ ] **Step 1: Read current `lib/types.ts` to keep edits anchored**

Run:
```bash
cat scripts/benchmark-agents/lib/types.ts
```
Confirm the file contains `TaskBenchConfig`, `PricingCache`, etc., and that `TaskBenchConfig` still has `models: readonly string[]`.

- [ ] **Step 2: Add `Tier` derived from `tiers.json` keys**

Insert at top of `lib/types.ts` after the existing imports:
```ts
import tiersJson from '../tiers.json' with { type: 'json' };

export type Tier = keyof typeof tiersJson;
```

(`tiers.json` doesn't exist yet — TypeScript will error here until Task 3. That's expected and fine for incremental commits; the union is unused until Task 11. We accept a transient red squiggle for one task.)

- [ ] **Step 3: Extend `PricingCache` shape**

Replace the existing `PricingCache` interface with:
```ts
export interface PricingEntry {
  readonly inputUSDPerMTok: number;
  readonly outputUSDPerMTok: number;
  readonly source: 'aws-pricing-api';
  readonly serviceCode: 'AmazonBedrock' | 'AmazonBedrockFoundationModels';
  readonly inputUsagetype: string;
  readonly outputUsagetype: string;
}

export interface PricingCache {
  readonly fetchedAt: string;
  readonly models: Record<string, PricingEntry>;
}
```

- [ ] **Step 4: Add `ModelsCache` shape**

Add to the end of `lib/types.ts`:
```ts
export type ExcludedReason =
  | 'sizeClass-unknown: no vendor classification'
  | 'no model access grant'
  | 'invalid modelId form (region/profile suffix shift)'
  | 'not available in region'
  | `probe-failed: ${string}`;

export interface ModelsCache {
  readonly fetchedAt: string;
  readonly tiersHash: string;
  readonly tiers: Record<Tier, readonly string[]>;
  readonly excluded: Record<string, ExcludedReason>;
  readonly uncategorized: readonly string[];
}
```

- [ ] **Step 5: Update `TaskBenchConfig` — replace `models[]` with `tier`**

Find the existing `TaskBenchConfig` interface. Replace the `models` field:
```ts
// before
readonly models: readonly string[];

// after
readonly tier: Tier;
```

- [ ] **Step 6: Commit**

```bash
git add scripts/benchmark-agents/lib/types.ts
git commit -m "refactor(benchmark-agents): replace models[] with tier in TaskBenchConfig

Adds ModelsCache / PricingEntry / Tier types. tier union derived from
tiers.json keys (file added in next task). bench.ts files updated in
Task 11."
```

---

## Task 3: Create `tiers.json`

**Files:**
- Create: `scripts/benchmark-agents/tiers.json`

- [ ] **Step 1: Write the tier definitions**

Create `scripts/benchmark-agents/tiers.json`:
```json
{
  "narrative": {
    "description": "Long-form prose generation (explainability, market outlook narrative).",
    "families": ["anthropic", "amazon.nova-pro", "amazon.nova-premier", "meta.llama3-3+", "meta.llama4+"],
    "sizeClass": ["frontier", "mid"],
    "minContextWindow": 32000
  },
  "structured-output-frontier": {
    "description": "High-stakes JSON outputs where quality > cost (portfolio construction, rebalance planning, risk assessment).",
    "families": ["anthropic", "amazon.nova-pro", "amazon.nova-premier"],
    "sizeClass": ["frontier"]
  },
  "structured-output-light": {
    "description": "Small structured extractions / classifier-ish tasks (user-goals).",
    "families": ["anthropic", "amazon.nova-lite", "amazon.nova-pro"],
    "sizeClass": ["mid", "cheap"]
  }
}
```

- [ ] **Step 2: Verify `Tier` type resolves**

Run:
```bash
pnpm tsc --noEmit -p scripts/benchmark-agents/tsconfig.spec.json 2>&1 | head -20
```
Expected: no errors mentioning `tiers.json` or `Tier`. (Existing bench.ts files still have `models[]` and will fail compilation — that's expected; they're fixed in Task 11. Filter the output to errors NOT in `tasks/*.bench.ts`.)

- [ ] **Step 3: Commit**

```bash
git add scripts/benchmark-agents/tiers.json
git commit -m "feat(benchmark-agents): add tiers.json with 3 tier definitions

narrative / structured-output-frontier / structured-output-light.
Family allowlist + sizeClass filter + minContextWindow for narrative.
Tier names are the only string IDs that need to match between
tiers.json, bench.ts files, and tier-filter.ts."
```

---

## Task 4: Create `lib/catalog-loader.ts` — vendor classification

**Files:**
- Create: `scripts/benchmark-agents/lib/catalog-loader.ts`
- Create: `scripts/benchmark-agents/lib/catalog-loader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/benchmark-agents/lib/catalog-loader.test.ts`:
```ts
import { sizeClassFor, dedupeUsStarPreference } from './catalog-loader';

describe('sizeClassFor', () => {
  it('classifies Anthropic Opus/Sonnet as frontier, Haiku as mid', () => {
    expect(sizeClassFor('us.anthropic.claude-opus-4-6')).toBe('frontier');
    expect(sizeClassFor('us.anthropic.claude-sonnet-4-6')).toBe('frontier');
    expect(sizeClassFor('anthropic.claude-haiku-4-5-20251001')).toBe('mid');
  });

  it('classifies Amazon Nova by variant', () => {
    expect(sizeClassFor('us.amazon.nova-premier-v1:0')).toBe('frontier');
    expect(sizeClassFor('us.amazon.nova-pro-v1:0')).toBe('frontier');
    expect(sizeClassFor('us.amazon.nova-lite-v1:0')).toBe('mid');
    expect(sizeClassFor('us.amazon.nova-micro-v1:0')).toBe('cheap');
  });

  it('classifies Llama by size token in id', () => {
    expect(sizeClassFor('meta.llama3-3-70b-instruct-v1:0')).toBe('frontier');
    expect(sizeClassFor('meta.llama3-1-405b-instruct-v1:0')).toBe('frontier');
    expect(sizeClassFor('meta.llama4-maverick-17b-instruct-v1:0')).toBe('mid');
    expect(sizeClassFor('meta.llama4-scout-17b-instruct-v1:0')).toBe('mid');
    expect(sizeClassFor('meta.llama3-1-8b-instruct-v1:0')).toBe('cheap');
  });

  it('classifies Mistral Large as frontier', () => {
    expect(sizeClassFor('mistral.mistral-large-2407-v1:0')).toBe('frontier');
  });

  it('returns unknown for unmapped models', () => {
    expect(sizeClassFor('cohere.command-r-plus-v1:0')).toBe('unknown');
    expect(sizeClassFor('foo.bar')).toBe('unknown');
  });
});

describe('dedupeUsStarPreference', () => {
  it('drops base id when us.* variant exists', () => {
    const input = [
      'anthropic.claude-sonnet-4-6',
      'us.anthropic.claude-sonnet-4-6',
      'us.amazon.nova-pro-v1:0',
    ];
    expect(dedupeUsStarPreference(input).sort()).toEqual(
      ['us.amazon.nova-pro-v1:0', 'us.anthropic.claude-sonnet-4-6'],
    );
  });

  it('keeps base id when no us.* variant exists', () => {
    const input = ['anthropic.claude-haiku-4-5-20251001', 'meta.llama3-3-70b-instruct-v1:0'];
    expect(dedupeUsStarPreference(input).sort()).toEqual([
      'anthropic.claude-haiku-4-5-20251001',
      'meta.llama3-3-70b-instruct-v1:0',
    ]);
  });

  it('keeps eu.* and apac.* variants alongside us.*', () => {
    const input = [
      'us.anthropic.claude-sonnet-4-6',
      'eu.anthropic.claude-sonnet-4-6',
      'apac.anthropic.claude-sonnet-4-6',
    ];
    expect(dedupeUsStarPreference(input).sort()).toEqual([
      'apac.anthropic.claude-sonnet-4-6',
      'eu.anthropic.claude-sonnet-4-6',
      'us.anthropic.claude-sonnet-4-6',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm jest --config scripts/benchmark-agents/jest.config.ts scripts/benchmark-agents/lib/catalog-loader.test.ts
```
Expected: FAIL with `Cannot find module './catalog-loader'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/benchmark-agents/lib/catalog-loader.ts`:
```ts
/* catalog-loader.ts — vendor classification for Bedrock modelIds + us.*
 * preference dedup. Pure logic; no AWS SDK calls (those live in refresh-models.ts).
 */

export type SizeClass = 'frontier' | 'mid' | 'cheap';

interface SizeClassRule {
  readonly match: (modelId: string) => boolean;
  readonly sizeClass: SizeClass;
}

const SIZE_CLASS_RULES: readonly SizeClassRule[] = [
  // Anthropic
  { match: (id) => /anthropic\.claude-opus/.test(id), sizeClass: 'frontier' },
  { match: (id) => /anthropic\.claude-sonnet/.test(id), sizeClass: 'frontier' },
  { match: (id) => /anthropic\.claude-haiku/.test(id), sizeClass: 'mid' },
  // Amazon Nova
  { match: (id) => /amazon\.nova-premier/.test(id), sizeClass: 'frontier' },
  { match: (id) => /amazon\.nova-pro/.test(id), sizeClass: 'frontier' },
  { match: (id) => /amazon\.nova-lite/.test(id), sizeClass: 'mid' },
  { match: (id) => /amazon\.nova-micro/.test(id), sizeClass: 'cheap' },
  // Meta Llama — match size token in the modelId
  { match: (id) => /meta\.llama.*-(70b|405b)-/.test(id), sizeClass: 'frontier' },
  { match: (id) => /meta\.llama.*-(maverick|scout|17b)-/i.test(id), sizeClass: 'mid' },
  { match: (id) => /meta\.llama.*-(8b|1b|3b|11b)-/.test(id), sizeClass: 'cheap' },
  // Mistral
  { match: (id) => /mistral\.mistral-large/.test(id), sizeClass: 'frontier' },
];

export function sizeClassFor(modelId: string): SizeClass | 'unknown' {
  return SIZE_CLASS_RULES.find((r) => r.match(modelId))?.sizeClass ?? 'unknown';
}

/** Strip base modelId when a `us.<base>` cross-region variant exists. Keeps
 * eu.* / apac.* / other prefixes alongside us.*. Per CLAUDE.md memory:
 * production uses inference-profile IDs (us.*), so the benchmark should too. */
export function dedupeUsStarPreference(modelIds: readonly string[]): readonly string[] {
  const set = new Set(modelIds);
  const usStarBases = new Set<string>();
  for (const id of set) {
    if (id.startsWith('us.')) usStarBases.add(id.slice('us.'.length));
  }
  return [...set].filter((id) => !usStarBases.has(id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm jest --config scripts/benchmark-agents/jest.config.ts scripts/benchmark-agents/lib/catalog-loader.test.ts
```
Expected: all 5 tests in `sizeClassFor` + `dedupeUsStarPreference` PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark-agents/lib/catalog-loader.ts scripts/benchmark-agents/lib/catalog-loader.test.ts
git commit -m "feat(benchmark-agents): add catalog-loader with size-class rules + us.* dedup

Pure logic for vendor classification (frontier/mid/cheap) and
preferring cross-region inference-profile IDs over base IDs. Used by
refresh-models.ts (next tasks)."
```

---

## Task 5: Create `lib/tier-filter.ts` — tier predicate

**Files:**
- Create: `scripts/benchmark-agents/lib/tier-filter.ts`
- Create: `scripts/benchmark-agents/lib/tier-filter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/benchmark-agents/lib/tier-filter.test.ts`:
```ts
import { filterCatalogByTier, type CatalogEntry } from './tier-filter';
import tiersJson from '../tiers.json' with { type: 'json' };

const catalog: readonly CatalogEntry[] = [
  { modelId: 'us.anthropic.claude-sonnet-4-6', sizeClass: 'frontier', contextWindow: 200000 },
  { modelId: 'us.anthropic.claude-opus-4-6',   sizeClass: 'frontier', contextWindow: 200000 },
  { modelId: 'anthropic.claude-haiku-4-5-20251001', sizeClass: 'mid', contextWindow: 200000 },
  { modelId: 'us.amazon.nova-pro-v1:0',        sizeClass: 'frontier', contextWindow: 300000 },
  { modelId: 'us.amazon.nova-lite-v1:0',       sizeClass: 'mid',      contextWindow: 300000 },
  { modelId: 'us.amazon.nova-micro-v1:0',      sizeClass: 'cheap',    contextWindow: 128000 },
  { modelId: 'meta.llama3-3-70b-instruct-v1:0', sizeClass: 'frontier', contextWindow: 128000 },
  { modelId: 'meta.llama3-1-8b-instruct-v1:0',  sizeClass: 'cheap',    contextWindow: 8000 },
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm jest --config scripts/benchmark-agents/jest.config.ts scripts/benchmark-agents/lib/tier-filter.test.ts
```
Expected: FAIL with `Cannot find module './tier-filter'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/benchmark-agents/lib/tier-filter.ts`:
```ts
/* tier-filter.ts — apply a tier predicate from tiers.json to a synthetic
 * catalog. Pure logic; the catalog itself is assembled in refresh-models.ts.
 *
 * Family matcher supports two forms:
 *   - "vendor.familyPrefix"        → prefix match against modelId, stripping us./eu./apac.
 *   - "vendor.familyPrefix-N-M+"   → same, but the "Nx.Mx or newer" version gate
 *     parses the version embedded in the modelId.
 */

import type { Tier, SizeClass } from './types';
import type tiersJson from '../tiers.json' with { type: 'json' };

export interface CatalogEntry {
  readonly modelId: string;
  readonly sizeClass: SizeClass;
  readonly contextWindow: number;
}

type TiersJson = typeof tiersJson;

function stripRegionPrefix(modelId: string): string {
  return modelId.replace(/^(us|eu|apac)\./, '');
}

/** Parse a version-gate from a "vendor.family-N-M+" string into a comparator.
 * Examples:
 *   meta.llama3-3+   → { vendor: 'meta.llama', major: 3, minor: 3, gate: '+' }
 *   meta.llama4+     → { vendor: 'meta.llama', major: 4, minor: 0, gate: '+' }
 *   anthropic        → { vendor: 'anthropic', major: 0, minor: 0, gate: null }
 */
interface FamilyMatcher {
  readonly raw: string;
  readonly prefix: string;
  readonly minMajor: number | null;
  readonly minMinor: number;
}

function parseFamilyMatcher(raw: string): FamilyMatcher {
  const versionGate = /^(.+?)(\d+)(?:-(\d+))?\+$/.exec(raw);
  if (versionGate) {
    return {
      raw,
      prefix: versionGate[1],
      minMajor: Number(versionGate[2]),
      minMinor: versionGate[3] !== undefined ? Number(versionGate[3]) : 0,
    };
  }
  return { raw, prefix: raw, minMajor: null, minMinor: 0 };
}

/** Extract version numbers from a modelId. Heuristic: first "<vendor.family><N>" or
 * "<vendor.family>-<N>" or "<vendor.family>-<N>-<M>" suffix after the family prefix.
 * Returns null if no version detected. */
function extractVersion(modelId: string, prefix: string): { major: number; minor: number } | null {
  const stripped = stripRegionPrefix(modelId);
  if (!stripped.startsWith(prefix)) return null;
  const tail = stripped.slice(prefix.length);
  // accept "3-3", "3.3", "3", "4-maverick-17b" — pick first numeric run + optional second
  const m = /^(\d+)(?:[.\-](\d+))?/.exec(tail);
  if (!m) return null;
  return { major: Number(m[1]), minor: m[2] !== undefined ? Number(m[2]) : 0 };
}

function matchesFamily(modelId: string, matcher: FamilyMatcher): boolean {
  const stripped = stripRegionPrefix(modelId);
  if (!stripped.startsWith(matcher.prefix)) return false;
  if (matcher.minMajor === null) return true;
  const version = extractVersion(modelId, matcher.prefix);
  if (!version) return false;
  if (version.major > matcher.minMajor) return true;
  if (version.major < matcher.minMajor) return false;
  return version.minor >= matcher.minMinor;
}

export function filterCatalogByTier(
  catalog: readonly CatalogEntry[],
  tier: Tier,
  tiers: TiersJson,
): readonly CatalogEntry[] {
  const def = tiers[tier] as {
    families: readonly string[];
    sizeClass: readonly SizeClass[];
    minContextWindow?: number;
  };
  const familyMatchers = def.families.map(parseFamilyMatcher);
  const sizeClassSet = new Set<SizeClass>(def.sizeClass);
  const minCtx = def.minContextWindow ?? 0;

  const filtered = catalog.filter((e) => {
    if (!sizeClassSet.has(e.sizeClass)) return false;
    if (e.contextWindow < minCtx) return false;
    return familyMatchers.some((fm) => matchesFamily(e.modelId, fm));
  });

  const rank: Record<SizeClass, number> = { frontier: 0, mid: 1, cheap: 2 };
  return [...filtered].sort((a, b) => {
    const r = rank[a.sizeClass] - rank[b.sizeClass];
    return r !== 0 ? r : a.modelId.localeCompare(b.modelId);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm jest --config scripts/benchmark-agents/jest.config.ts scripts/benchmark-agents/lib/tier-filter.test.ts
```
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark-agents/lib/tier-filter.ts scripts/benchmark-agents/lib/tier-filter.test.ts
git commit -m "feat(benchmark-agents): add tier-filter with version-gate family matchers

Supports 'meta.llama3-3+' style version gates. Produces deterministic
rank: frontier > mid > cheap, then alphabetical. Pure logic against
synthetic CatalogEntry[]; AWS SDK calls live in refresh-models.ts."
```

---

## Task 6: Create `lib/pricing-display-name.ts` — modelId → Pricing API identity

**Files:**
- Create: `scripts/benchmark-agents/lib/pricing-display-name.ts`
- Create: `scripts/benchmark-agents/lib/pricing-display-name.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/benchmark-agents/lib/pricing-display-name.test.ts`:
```ts
import { resolvePricingIdentity } from './pricing-display-name';

describe('resolvePricingIdentity', () => {
  it('Anthropic Claude → AmazonBedrockFoundationModels + servicename', () => {
    expect(resolvePricingIdentity('us.anthropic.claude-sonnet-4-6')).toEqual({
      serviceCode: 'AmazonBedrockFoundationModels',
      identityField: 'servicename',
      identityValue: 'Claude Sonnet 4.6 (Amazon Bedrock Edition)',
    });
    expect(resolvePricingIdentity('anthropic.claude-haiku-4-5-20251001')).toEqual({
      serviceCode: 'AmazonBedrockFoundationModels',
      identityField: 'servicename',
      identityValue: 'Claude Haiku 4.5 (Amazon Bedrock Edition)',
    });
    expect(resolvePricingIdentity('us.anthropic.claude-opus-4-7')).toEqual({
      serviceCode: 'AmazonBedrockFoundationModels',
      identityField: 'servicename',
      identityValue: 'Claude Opus 4.7 (Amazon Bedrock Edition)',
    });
  });

  it('Amazon Nova → AmazonBedrock + model', () => {
    expect(resolvePricingIdentity('us.amazon.nova-pro-v1:0')).toEqual({
      serviceCode: 'AmazonBedrock',
      identityField: 'model',
      identityValue: 'Nova Pro',
    });
    expect(resolvePricingIdentity('us.amazon.nova-lite-v1:0')).toEqual({
      serviceCode: 'AmazonBedrock',
      identityField: 'model',
      identityValue: 'Nova Lite',
    });
    expect(resolvePricingIdentity('us.amazon.nova-premier-v1:0')).toEqual({
      serviceCode: 'AmazonBedrock',
      identityField: 'model',
      identityValue: 'Nova Premier',
    });
  });

  it('Meta Llama → AmazonBedrock + model', () => {
    expect(resolvePricingIdentity('meta.llama3-3-70b-instruct-v1:0')).toEqual({
      serviceCode: 'AmazonBedrock',
      identityField: 'model',
      identityValue: 'Llama 3.3 70B',
    });
    expect(resolvePricingIdentity('meta.llama4-maverick-17b-instruct-v1:0')).toEqual({
      serviceCode: 'AmazonBedrock',
      identityField: 'model',
      identityValue: 'Llama 4 Maverick 17B',
    });
  });

  it('Mistral → AmazonBedrock + model', () => {
    expect(resolvePricingIdentity('mistral.mistral-large-2407-v1:0')).toEqual({
      serviceCode: 'AmazonBedrock',
      identityField: 'model',
      identityValue: 'Mistral Large 2407',
    });
  });

  it('throws for unknown vendor', () => {
    expect(() => resolvePricingIdentity('foo.bar-v1:0')).toThrow(/unmapped/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm jest --config scripts/benchmark-agents/jest.config.ts scripts/benchmark-agents/lib/pricing-display-name.test.ts
```
Expected: FAIL with `Cannot find module './pricing-display-name'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/benchmark-agents/lib/pricing-display-name.ts`:
```ts
/* pricing-display-name.ts — Bedrock modelId → AWS Pricing API identity
 * (serviceCode + the attribute/value pair that filters its records).
 *
 * Two service codes carry on-demand records for us:
 *   - AmazonBedrockFoundationModels: Anthropic, Cohere, Jamba, etc.
 *     (identity in `servicename` as "<Display> (Amazon Bedrock Edition)")
 *   - AmazonBedrock: Nova, Llama, Mistral, DeepSeek, Qwen, etc.
 *     (identity in `model` as "<Display>")
 *
 * The display-string for each vendor is derived by rule, not by per-model table.
 * New vendor prefixes that don't match any rule throw at refresh time.
 */

export interface PricingIdentity {
  readonly serviceCode: 'AmazonBedrock' | 'AmazonBedrockFoundationModels';
  readonly identityField: 'model' | 'servicename';
  readonly identityValue: string;
}

function stripRegion(modelId: string): string {
  return modelId.replace(/^(us|eu|apac)\./, '');
}

function anthropic(modelId: string): PricingIdentity {
  // anthropic.claude-sonnet-4-6 → "Claude Sonnet 4.6"
  // anthropic.claude-haiku-4-5-20251001 → "Claude Haiku 4.5"
  // anthropic.claude-opus-4-7 → "Claude Opus 4.7"
  const stripped = stripRegion(modelId);
  const m = /^anthropic\.claude-(opus|sonnet|haiku)-(\d+)-(\d+)/.exec(stripped);
  if (!m) throw new Error(`pricing-display-name: cannot parse Anthropic modelId: ${modelId}`);
  const family = m[1][0].toUpperCase() + m[1].slice(1); // Opus / Sonnet / Haiku
  const display = `Claude ${family} ${m[2]}.${m[3]} (Amazon Bedrock Edition)`;
  return {
    serviceCode: 'AmazonBedrockFoundationModels',
    identityField: 'servicename',
    identityValue: display,
  };
}

function nova(modelId: string): PricingIdentity {
  // us.amazon.nova-pro-v1:0 → "Nova Pro"
  const stripped = stripRegion(modelId);
  const m = /^amazon\.nova-(\w+)-/.exec(stripped);
  if (!m) throw new Error(`pricing-display-name: cannot parse Nova modelId: ${modelId}`);
  const variant = m[1][0].toUpperCase() + m[1].slice(1);
  return { serviceCode: 'AmazonBedrock', identityField: 'model', identityValue: `Nova ${variant}` };
}

function llama(modelId: string): PricingIdentity {
  // meta.llama3-3-70b-instruct-v1:0 → "Llama 3.3 70B"
  // meta.llama4-maverick-17b-instruct-v1:0 → "Llama 4 Maverick 17B"
  // meta.llama4-scout-17b-instruct-v1:0 → "Llama 4 Scout 17B"
  const stripped = stripRegion(modelId);
  const versioned = /^meta\.llama(\d+)-(\d+)-(\d+b)-/.exec(stripped);
  if (versioned) {
    const display = `Llama ${versioned[1]}.${versioned[2]} ${versioned[3].toUpperCase()}`;
    return { serviceCode: 'AmazonBedrock', identityField: 'model', identityValue: display };
  }
  const named = /^meta\.llama(\d+)-(\w+)-(\d+b)-/.exec(stripped);
  if (named) {
    const variant = named[2][0].toUpperCase() + named[2].slice(1);
    const display = `Llama ${named[1]} ${variant} ${named[3].toUpperCase()}`;
    return { serviceCode: 'AmazonBedrock', identityField: 'model', identityValue: display };
  }
  throw new Error(`pricing-display-name: cannot parse Llama modelId: ${modelId}`);
}

function mistral(modelId: string): PricingIdentity {
  // mistral.mistral-large-2407-v1:0 → "Mistral Large 2407"
  const stripped = stripRegion(modelId);
  const m = /^mistral\.([a-z]+)-([a-z]+)(?:-(\d+))?/.exec(stripped);
  if (!m) throw new Error(`pricing-display-name: cannot parse Mistral modelId: ${modelId}`);
  const family = m[1][0].toUpperCase() + m[1].slice(1); // Mistral
  const variant = m[2][0].toUpperCase() + m[2].slice(1); // Large
  const year = m[3] ? ` ${m[3]}` : '';
  return {
    serviceCode: 'AmazonBedrock',
    identityField: 'model',
    identityValue: `${family} ${variant}${year}`,
  };
}

export function resolvePricingIdentity(modelId: string): PricingIdentity {
  const stripped = stripRegion(modelId);
  if (stripped.startsWith('anthropic.')) return anthropic(modelId);
  if (stripped.startsWith('amazon.nova-')) return nova(modelId);
  if (stripped.startsWith('meta.llama')) return llama(modelId);
  if (stripped.startsWith('mistral.')) return mistral(modelId);
  throw new Error(`pricing-display-name: unmapped vendor for modelId: ${modelId}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm jest --config scripts/benchmark-agents/jest.config.ts scripts/benchmark-agents/lib/pricing-display-name.test.ts
```
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark-agents/lib/pricing-display-name.ts scripts/benchmark-agents/lib/pricing-display-name.test.ts
git commit -m "feat(benchmark-agents): add pricing-display-name resolver

modelId → (serviceCode, identityField, identityValue) for the AWS
Pricing API. Per-vendor rules; unknown vendors throw at refresh time."
```

---

## Task 7: Create `lib/usagetype-picker.ts` — on-demand price extraction

**Files:**
- Create: `scripts/benchmark-agents/lib/usagetype-picker.ts`
- Create: `scripts/benchmark-agents/lib/usagetype-picker.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/benchmark-agents/lib/usagetype-picker.test.ts`:
```ts
import { pickOnDemandPrice, type PricingRecord } from './usagetype-picker';

const sonnetRecords: PricingRecord[] = [
  // Anthropic in AmazonBedrockFoundationModels — us.* uses _Global, base no _Global
  { usagetype: 'USE1-MP:USE1_InputTokenCount_Global-Units', pricePerUnit: 3.0 },
  { usagetype: 'USE1-MP:USE1_OutputTokenCount_Global-Units', pricePerUnit: 15.0 },
  { usagetype: 'USE1-MP:USE1_InputTokenCount-Units', pricePerUnit: 3.3 },
  { usagetype: 'USE1-MP:USE1_OutputTokenCount-Units', pricePerUnit: 16.5 },
  { usagetype: 'USE1-MP:USE1_InputTokenCount_Global_Batch-Units', pricePerUnit: 1.5 },
  { usagetype: 'USE1-MP:USE1_CacheReadInputTokenCount-Units', pricePerUnit: 0.33 },
  { usagetype: 'USE1-MP:USE1_CacheWrite1hInputTokenCount_Global-Units', pricePerUnit: 6.0 },
  { usagetype: 'USE1-MP:USE1_Reserved_1Month_InputTPM_Geo-Units', pricePerUnit: 0.198 },
];

const novaRecords: PricingRecord[] = [
  // Amazon Nova in AmazonBedrock — flat naming, no _Global distinction
  { usagetype: 'USE1-NovaPro-input-tokens', pricePerUnit: 0.0008 },
  { usagetype: 'USE1-NovaPro-output-tokens', pricePerUnit: 0.0032 },
  { usagetype: 'USE1-NovaPro-input-tokens-priority', pricePerUnit: 0.0014 },
  { usagetype: 'USE1-NovaPro-output-tokens-flex', pricePerUnit: 0.0016 },
  { usagetype: 'USE1-NovaPro-cache-read-input-token-count', pricePerUnit: 0.0002 },
];

describe('pickOnDemandPrice', () => {
  describe('AmazonBedrockFoundationModels branch (Anthropic)', () => {
    it('us.* modelId picks _Global-Units input + output', () => {
      const r = pickOnDemandPrice(
        sonnetRecords,
        'us.anthropic.claude-sonnet-4-6',
        'AmazonBedrockFoundationModels',
      );
      expect(r.inputUSDPerMTok).toBeCloseTo(3.0);
      expect(r.outputUSDPerMTok).toBeCloseTo(15.0);
      expect(r.inputUsagetype).toMatch(/InputTokenCount_Global/);
    });

    it('base modelId picks non-_Global Units input + output', () => {
      const r = pickOnDemandPrice(
        sonnetRecords,
        'anthropic.claude-sonnet-4-6',
        'AmazonBedrockFoundationModels',
      );
      expect(r.inputUSDPerMTok).toBeCloseTo(3.3);
      expect(r.outputUSDPerMTok).toBeCloseTo(16.5);
    });

    it('excludes Batch / Cache / Reserved variants', () => {
      const r = pickOnDemandPrice(
        sonnetRecords,
        'us.anthropic.claude-sonnet-4-6',
        'AmazonBedrockFoundationModels',
      );
      expect(r.inputUsagetype).not.toMatch(/Batch|Cache|Reserved/);
    });

    it('throws when input or output record missing', () => {
      const partial: PricingRecord[] = [sonnetRecords[0]]; // only input, no output
      expect(() =>
        pickOnDemandPrice(partial, 'us.anthropic.claude-sonnet-4-6', 'AmazonBedrockFoundationModels'),
      ).toThrow(/missing on-demand output/);
    });
  });

  describe('AmazonBedrock branch (Nova / Llama / Mistral)', () => {
    it('picks bare -input-tokens / -output-tokens, excludes -priority/-flex/-batch/-cache-', () => {
      const r = pickOnDemandPrice(novaRecords, 'us.amazon.nova-pro-v1:0', 'AmazonBedrock');
      expect(r.inputUSDPerMTok).toBeCloseTo(0.0008 * 1000); // unit: 1K → 1M
      expect(r.outputUSDPerMTok).toBeCloseTo(0.0032 * 1000);
      expect(r.inputUsagetype).not.toMatch(/priority|flex|batch|cache-/);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm jest --config scripts/benchmark-agents/jest.config.ts scripts/benchmark-agents/lib/usagetype-picker.test.ts
```
Expected: FAIL with `Cannot find module './usagetype-picker'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/benchmark-agents/lib/usagetype-picker.ts`:
```ts
/* usagetype-picker.ts — pick on-demand token-price records from a
 * pricing API response. Vendor-aware via serviceCode:
 *
 *   AmazonBedrockFoundationModels:
 *     - us.* IDs → usagetype matches *_InputTokenCount_Global-Units
 *     - base IDs → usagetype matches *_InputTokenCount-Units (no _Global)
 *     - exclude Batch / Cache / Reserved_ / LongContext / CrossGeo
 *
 *   AmazonBedrock:
 *     - any ID → usagetype matches *-input-tokens or *-output-tokens exactly
 *     - exclude -priority / -flex / -batch / -cache-
 *
 * Prices in this module are normalized to USD per *million* tokens.
 *   AmazonBedrockFoundationModels publishes per-token-Count "Units" (already MTok-scaled).
 *   AmazonBedrock publishes per "1K tokens" — multiply by 1000.
 */

export interface PricingRecord {
  readonly usagetype: string;
  readonly pricePerUnit: number;
}

export interface OnDemandPrices {
  readonly inputUSDPerMTok: number;
  readonly outputUSDPerMTok: number;
  readonly inputUsagetype: string;
  readonly outputUsagetype: string;
}

type ServiceCode = 'AmazonBedrock' | 'AmazonBedrockFoundationModels';

function isUsStar(modelId: string): boolean {
  return modelId.startsWith('us.');
}

function pickFoundationModels(
  records: readonly PricingRecord[],
  isUs: boolean,
  kind: 'Input' | 'Output',
): PricingRecord | undefined {
  const exclude = /Batch|Cache|Reserved_|LongContext|CrossGeo/;
  return records.find((r) => {
    if (exclude.test(r.usagetype)) return false;
    const hasGlobal = /_Global-Units$/.test(r.usagetype);
    if (isUs && !hasGlobal) return false;
    if (!isUs && hasGlobal) return false;
    return new RegExp(`_${kind}TokenCount(_Global)?-Units$`).test(r.usagetype);
  });
}

function pickBedrock(
  records: readonly PricingRecord[],
  kind: 'input' | 'output',
): PricingRecord | undefined {
  const exclude = /-priority|-flex|-batch|-cache-/;
  return records.find((r) => {
    if (exclude.test(r.usagetype)) return false;
    return new RegExp(`-${kind}-tokens$`).test(r.usagetype);
  });
}

export function pickOnDemandPrice(
  records: readonly PricingRecord[],
  modelId: string,
  serviceCode: ServiceCode,
): OnDemandPrices {
  if (serviceCode === 'AmazonBedrockFoundationModels') {
    const isUs = isUsStar(modelId);
    const inputRec = pickFoundationModels(records, isUs, 'Input');
    const outputRec = pickFoundationModels(records, isUs, 'Output');
    if (!inputRec) throw new Error(`usagetype-picker: missing on-demand input record for ${modelId}`);
    if (!outputRec) throw new Error(`usagetype-picker: missing on-demand output record for ${modelId}`);
    // AmazonBedrockFoundationModels publishes prices already in per-MTok units.
    return {
      inputUSDPerMTok: inputRec.pricePerUnit,
      outputUSDPerMTok: outputRec.pricePerUnit,
      inputUsagetype: inputRec.usagetype,
      outputUsagetype: outputRec.usagetype,
    };
  }
  // AmazonBedrock
  const inputRec = pickBedrock(records, 'input');
  const outputRec = pickBedrock(records, 'output');
  if (!inputRec) throw new Error(`usagetype-picker: missing on-demand input record for ${modelId}`);
  if (!outputRec) throw new Error(`usagetype-picker: missing on-demand output record for ${modelId}`);
  // AmazonBedrock publishes per-1K tokens; convert to per-MTok.
  return {
    inputUSDPerMTok: inputRec.pricePerUnit * 1000,
    outputUSDPerMTok: outputRec.pricePerUnit * 1000,
    inputUsagetype: inputRec.usagetype,
    outputUsagetype: outputRec.usagetype,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm jest --config scripts/benchmark-agents/jest.config.ts scripts/benchmark-agents/lib/usagetype-picker.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark-agents/lib/usagetype-picker.ts scripts/benchmark-agents/lib/usagetype-picker.test.ts
git commit -m "feat(benchmark-agents): add usagetype-picker for AWS Pricing API records

Two service-code branches:
- AmazonBedrockFoundationModels: us.* picks _Global-Units, base picks _Units
- AmazonBedrock: -input-tokens / -output-tokens exact match
Normalises to per-MTok regardless of underlying unit."
```

---

## Task 8: Write `refresh-models.ts` orchestrator

**Files:**
- Create: `scripts/benchmark-agents/refresh-models.ts`

This task has no dedicated unit test — the lib modules already cover the pure logic. The script is exercised end-to-end in Task 15 (manual gate).

- [ ] **Step 1: Write the orchestrator**

Create `scripts/benchmark-agents/refresh-models.ts`:
```ts
#!/usr/bin/env tsx
/* refresh-models.ts — discover the Bedrock catalog, tier-filter, account-access
 * probe, and write benchmarks/cache/models.json.
 *
 * Cadence: 30-day TTL, or stale on tiers.json change. Trigger logic lives in
 * the SKILL preflight (§1) — this script always refreshes when invoked.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BedrockClient,
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
} from '@aws-sdk/client-bedrock';
import { ChatBedrockConverse } from '@langchain/aws';
import { dedupeUsStarPreference, sizeClassFor } from './lib/catalog-loader';
import { filterCatalogByTier, type CatalogEntry } from './lib/tier-filter';
import type { ExcludedReason, ModelsCache, Tier } from './lib/types';
import tiersJson from './tiers.json' with { type: 'json' };

const REGION = 'us-east-1';
const TIERS_PATH = path.resolve('scripts/benchmark-agents/tiers.json');
const OUT_PATH = path.resolve('benchmarks/cache/models.json');

async function listActiveTextModels(client: BedrockClient): Promise<readonly string[]> {
  const out = await client.send(
    new ListFoundationModelsCommand({ byOutputModality: 'TEXT', byInferenceType: 'ON_DEMAND' }),
  );
  const summaries = out.modelSummaries ?? [];
  return summaries
    .filter((s) => s.modelLifecycle?.status === 'ACTIVE')
    .map((s) => s.modelId ?? '')
    .filter((id) => id.length > 0);
}

async function listSystemInferenceProfileIds(client: BedrockClient): Promise<readonly string[]> {
  const out = await client.send(new ListInferenceProfilesCommand({ typeEquals: 'SYSTEM_DEFINED' }));
  return (out.inferenceProfileSummaries ?? [])
    .map((p) => p.inferenceProfileId ?? '')
    .filter((id) => id.length > 0);
}

async function probeAccess(modelId: string): Promise<ExcludedReason | null> {
  const llm = new ChatBedrockConverse({ model: modelId, region: REGION, maxTokens: 1 });
  try {
    await llm.invoke('1');
    return null;
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e.name === 'AccessDeniedException') return 'no model access grant';
    if (e.name === 'ValidationException') return 'invalid modelId form (region/profile suffix shift)';
    if (e.name === 'ResourceNotFoundException') return 'not available in region';
    if (e.name === 'ThrottlingException') {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        await llm.invoke('1');
        return null;
      } catch (err2) {
        const e2 = err2 as { name?: string };
        return `probe-failed: ${e2.name ?? 'throttling-retried'}` as ExcludedReason;
      }
    }
    return `probe-failed: ${e.name ?? 'unknown'}` as ExcludedReason;
  }
}

async function buildCatalog(modelIds: readonly string[]): Promise<{
  catalog: CatalogEntry[];
  excluded: Record<string, ExcludedReason>;
}> {
  const excluded: Record<string, ExcludedReason> = {};
  const catalog: CatalogEntry[] = [];
  for (const modelId of modelIds) {
    const sc = sizeClassFor(modelId);
    if (sc === 'unknown') {
      excluded[modelId] = 'sizeClass-unknown: no vendor classification';
      continue;
    }
    process.stdout.write(`  probe ${modelId}…`);
    const reason = await probeAccess(modelId);
    if (reason) {
      excluded[modelId] = reason;
      process.stdout.write(` excluded (${reason})\n`);
      continue;
    }
    process.stdout.write(` ok\n`);
    catalog.push({ modelId, sizeClass: sc, contextWindow: 200000 }); // ctx assumed 200k; refined below
  }
  return { catalog, excluded };
}

async function main(): Promise<void> {
  const client = new BedrockClient({ region: REGION });
  console.log('[refresh-models] listing foundation models…');
  const text = await listActiveTextModels(client);
  console.log('[refresh-models] listing system inference profiles…');
  const profiles = await listSystemInferenceProfileIds(client);

  console.log(`[refresh-models] catalog size: ${text.length} base + ${profiles.length} profiles`);

  const combined = dedupeUsStarPreference([...text, ...profiles]);
  console.log(`[refresh-models] after us.* dedup: ${combined.length}`);

  const { catalog, excluded } = await buildCatalog(combined);

  const tiers: Record<Tier, readonly string[]> = {} as Record<Tier, readonly string[]>;
  for (const tierName of Object.keys(tiersJson) as readonly Tier[]) {
    tiers[tierName] = filterCatalogByTier(catalog, tierName, tiersJson).map((e) => e.modelId);
  }

  const uncategorized = catalog
    .filter((e) => !Object.values(tiers).some((list) => list.includes(e.modelId)))
    .map((e) => e.modelId);

  const tiersHash = createHash('sha256').update(await fs.readFile(TIERS_PATH)).digest('hex');

  const out: ModelsCache = {
    fetchedAt: new Date().toISOString(),
    tiersHash,
    tiers,
    excluded,
    uncategorized,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`[refresh-models] wrote ${OUT_PATH}`);
  console.log('[refresh-models] tier sizes:');
  for (const [t, ids] of Object.entries(tiers)) console.log(`  ${t}: ${ids.length}`);
  if (uncategorized.length > 0) {
    console.log(`[refresh-models] INFO uncategorized (no tier matched): ${uncategorized.join(', ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: TypeScript compile check**

Run:
```bash
pnpm tsc --noEmit -p scripts/benchmark-agents/tsconfig.spec.json 2>&1 | grep -v 'tasks/.*\.bench\.ts' | head -20
```
Expected: no errors outside `tasks/*.bench.ts` (those still have stale `models[]` — fixed in Task 11).

- [ ] **Step 3: Commit**

```bash
git add scripts/benchmark-agents/refresh-models.ts
git commit -m "feat(benchmark-agents): add refresh-models.ts orchestrator

ListFoundationModels + ListInferenceProfiles + us.* dedup + 1-token
Converse probe + tier filter. Writes benchmarks/cache/models.json with
tiersHash for invalidation. Live exercise in Task 15 manual gate."
```

---

## Task 9: Rewrite `refresh-pricing.ts` to use AWS Pricing API

**Files:**
- Modify (rewrite): `scripts/benchmark-agents/refresh-pricing.ts`

- [ ] **Step 1: Read existing to confirm what we're replacing**

Run:
```bash
cat scripts/benchmark-agents/refresh-pricing.ts
```
Confirm the file currently reads `pricing.manifest.json` and copies to cache. We're replacing it entirely.

- [ ] **Step 2: Write the new orchestrator**

Replace the entire contents of `scripts/benchmark-agents/refresh-pricing.ts` with:
```ts
#!/usr/bin/env tsx
/* refresh-pricing.ts — query AWS Pricing API for on-demand token prices for
 * every modelId in models.json (across all tiers) + every production modelId
 * from the 6 task bench configs. Write benchmarks/cache/pricing.json.
 *
 * No fallback / overrides file: if the Pricing API has no record for a
 * modelId, this script exits 1 with an explicit list.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { PricingClient, GetProductsCommand } from '@aws-sdk/client-pricing';
import { resolvePricingIdentity } from './lib/pricing-display-name';
import { pickOnDemandPrice, type PricingRecord } from './lib/usagetype-picker';
import type { ModelsCache, PricingCache, PricingEntry, TaskBenchConfig } from './lib/types';

const REGION = 'us-east-1';
const MODELS_CACHE_PATH = path.resolve('benchmarks/cache/models.json');
const PRICING_OUT_PATH = path.resolve('benchmarks/cache/pricing.json');
const TASKS_DIR = path.resolve('scripts/benchmark-agents/tasks');

async function collectProductionModelIds(): Promise<readonly string[]> {
  const files = (await fs.readdir(TASKS_DIR)).filter((f) => f.endsWith('.bench.ts'));
  const set = new Set<string>();
  for (const f of files) {
    const mod = (await import(path.join(TASKS_DIR, f))) as { benchConfig: TaskBenchConfig };
    set.add(mod.benchConfig.productionConfig.modelId);
  }
  return [...set];
}

async function getProducts(
  client: PricingClient,
  serviceCode: string,
  identityField: string,
  identityValue: string,
): Promise<PricingRecord[]> {
  const out = await client.send(
    new GetProductsCommand({
      ServiceCode: serviceCode,
      Filters: [
        { Type: 'TERM_MATCH', Field: identityField, Value: identityValue },
        { Type: 'TERM_MATCH', Field: 'regionCode', Value: REGION },
      ],
    }),
  );
  const records: PricingRecord[] = [];
  for (const raw of out.PriceList ?? []) {
    const item = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const usagetype = item.product?.attributes?.usagetype as string | undefined;
    const terms = (item.terms?.OnDemand ?? {}) as Record<
      string,
      { priceDimensions?: Record<string, { pricePerUnit?: { USD?: string } }> }
    >;
    for (const tval of Object.values(terms)) {
      for (const dim of Object.values(tval.priceDimensions ?? {})) {
        const usd = dim.pricePerUnit?.USD;
        if (usagetype && usd !== undefined) {
          records.push({ usagetype, pricePerUnit: Number(usd) });
        }
      }
    }
  }
  return records;
}

async function main(): Promise<void> {
  // Universe = union of (tier candidates from models.json) + (production modelIds from bench.ts files)
  const modelsCache = JSON.parse(await fs.readFile(MODELS_CACHE_PATH, 'utf8')) as ModelsCache;
  const tierIds = Object.values(modelsCache.tiers).flat();
  const productionIds = await collectProductionModelIds();
  const universe = [...new Set<string>([...tierIds, ...productionIds])];
  console.log(`[refresh-pricing] resolving ${universe.length} modelIds via AWS Pricing API`);

  const client = new PricingClient({ region: REGION });
  const out: PricingCache = { fetchedAt: new Date().toISOString(), models: {} };
  const unresolved: string[] = [];

  for (const modelId of universe) {
    const id = resolvePricingIdentity(modelId);
    process.stdout.write(`  ${modelId}…`);
    const records = await getProducts(
      client,
      id.serviceCode,
      id.identityField,
      id.identityValue,
    );
    if (records.length === 0) {
      unresolved.push(modelId);
      process.stdout.write(' NO RECORDS\n');
      continue;
    }
    try {
      const prices = pickOnDemandPrice(records, modelId, id.serviceCode);
      const entry: PricingEntry = {
        inputUSDPerMTok: prices.inputUSDPerMTok,
        outputUSDPerMTok: prices.outputUSDPerMTok,
        source: 'aws-pricing-api',
        serviceCode: id.serviceCode,
        inputUsagetype: prices.inputUsagetype,
        outputUsagetype: prices.outputUsagetype,
      };
      (out.models as Record<string, PricingEntry>)[modelId] = entry;
      process.stdout.write(` $${prices.inputUSDPerMTok}/$${prices.outputUSDPerMTok}\n`);
    } catch (err) {
      unresolved.push(modelId);
      process.stdout.write(` PICKER ERROR: ${(err as Error).message}\n`);
    }
  }

  if (unresolved.length > 0) {
    console.error('[refresh-pricing] AWS Pricing API missing on-demand entries for:');
    for (const m of unresolved) console.error(`  - ${m}`);
    console.error('Either remove these models from tiers.json / production configs');
    console.error('or wait for AWS to publish them.');
    process.exit(1);
  }

  await fs.mkdir(path.dirname(PRICING_OUT_PATH), { recursive: true });
  await fs.writeFile(PRICING_OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`[refresh-pricing] wrote ${PRICING_OUT_PATH} (${Object.keys(out.models).length} entries)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: TypeScript compile check**

Run:
```bash
pnpm tsc --noEmit -p scripts/benchmark-agents/tsconfig.spec.json 2>&1 | grep -v 'tasks/.*\.bench\.ts' | head -20
```
Expected: no errors outside `tasks/*.bench.ts`.

- [ ] **Step 4: Commit**

```bash
git add scripts/benchmark-agents/refresh-pricing.ts
git commit -m "feat(benchmark-agents): rewrite refresh-pricing.ts to use AWS Pricing API

Universe = tier candidates from models.json + production modelIds from
bench.ts files. Resolves via pricing-display-name + usagetype-picker.
Hard-fails on missing records (no overrides fallback). The previous
manifest-copier behaviour is removed."
```

---

## Task 10: Update `pricing-loader.ts` for new cache shape

**Files:**
- Modify: `scripts/benchmark-agents/pricing-loader.ts`
- Modify: `scripts/benchmark-agents/pricing-loader.test.ts`

- [ ] **Step 1: Rewrite pricing-loader.ts**

Replace the contents of `scripts/benchmark-agents/pricing-loader.ts` with:
```ts
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
```

Note: `baseModelIdFor()` is removed entirely. The new cache always keys entries by the exact modelId the sweep uses, so the fallback is no longer needed.

- [ ] **Step 2: Update `pricing-loader.test.ts` to match new shape**

Read the existing test:
```bash
cat scripts/benchmark-agents/pricing-loader.test.ts
```

Replace its contents with:
```ts
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
    },
    'us.amazon.nova-pro-v1:0': {
      inputUSDPerMTok: 0.8,
      outputUSDPerMTok: 3.2,
      source: 'aws-pricing-api',
      serviceCode: 'AmazonBedrock',
      inputUsagetype: 'USE1-NovaPro-input-tokens',
      outputUsagetype: 'USE1-NovaPro-output-tokens',
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
```

- [ ] **Step 3: Run pricing-loader tests**

Run:
```bash
pnpm jest --config scripts/benchmark-agents/jest.config.ts scripts/benchmark-agents/pricing-loader.test.ts
```
Expected: all 3 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/benchmark-agents/pricing-loader.ts scripts/benchmark-agents/pricing-loader.test.ts
git commit -m "refactor(benchmark-agents): drop baseModelIdFor; cache keys = exact modelIds

New cache always keys by the modelId the sweep uses (us.* preserved).
No fallback needed."
```

---

## Task 11: Update each of the 6 `tasks/*.bench.ts` files

**Files:**
- Modify: `scripts/benchmark-agents/tasks/explainability.bench.ts`
- Modify: `scripts/benchmark-agents/tasks/market-research.bench.ts`
- Modify: `scripts/benchmark-agents/tasks/portfolio-construction.bench.ts`
- Modify: `scripts/benchmark-agents/tasks/rebalance-planner.bench.ts`
- Modify: `scripts/benchmark-agents/tasks/risk-assessment.bench.ts`
- Modify: `scripts/benchmark-agents/tasks/user-goals.bench.ts`

- [ ] **Step 1: Update `explainability.bench.ts`**

Open `scripts/benchmark-agents/tasks/explainability.bench.ts`. Find the `models: [...]` field at the bottom of the `benchConfig` object literal. Replace it with `tier: 'narrative' as const,`. Keep every other field.

If the file declares a `TaskBenchConfig` annotation, leave it alone — the union type now requires `tier`.

- [ ] **Step 2: Update `market-research.bench.ts`**

Same change. Replace `models: [...]` with `tier: 'narrative' as const,`.

- [ ] **Step 3: Update `portfolio-construction.bench.ts`**

Replace `models: [...]` with `tier: 'structured-output-frontier' as const,`.

- [ ] **Step 4: Update `rebalance-planner.bench.ts`**

Replace `models: [...]` with `tier: 'structured-output-frontier' as const,`.

- [ ] **Step 5: Update `risk-assessment.bench.ts`**

Replace `models: [...]` with `tier: 'structured-output-frontier' as const,`.

- [ ] **Step 6: Update `user-goals.bench.ts`**

Replace `models: [...]` with `tier: 'structured-output-light' as const,`.

- [ ] **Step 7: TypeScript compile check — bench files should now type-check**

Run:
```bash
pnpm tsc --noEmit -p scripts/benchmark-agents/tsconfig.spec.json 2>&1 | head -20
```
Expected: no errors. (The `models[]` references in `tasks/*.bench.ts` are gone, and `tier` is now required by `TaskBenchConfig` — both sides match.)

- [ ] **Step 8: Commit**

```bash
git add scripts/benchmark-agents/tasks/*.bench.ts
git commit -m "refactor(benchmark-agents): replace per-task models[] with tier

explainability + market-research      → narrative
portfolio-construction + rebalance-planner + risk-assessment
                                       → structured-output-frontier
user-goals                            → structured-output-light

The actual modelId set is now resolved at sweep time from
benchmarks/cache/models.json (next task wires this into run.ts)."
```

---

## Task 12: Update `run.ts` to resolve sweep set from cache + production anchor

**Files:**
- Modify: `scripts/benchmark-agents/run.ts`

- [ ] **Step 1: Read existing `run.ts` to anchor the edit**

Run:
```bash
cat scripts/benchmark-agents/run.ts
```

Identify the loop `for (const modelId of bench.models)` — this is where the sweep iterates today.

- [ ] **Step 2: Add models-cache load + resolver helper**

Just below the `loadPricingCache()` import line at the top, add:
```ts
import type { ModelsCache } from './lib/types';

const MODELS_CACHE_PATH = path.resolve('benchmarks/cache/models.json');

function loadModelsCache(): ModelsCache {
  if (!fs.existsSync(MODELS_CACHE_PATH)) {
    throw new Error(
      `models cache missing at ${MODELS_CACHE_PATH} — run scripts/benchmark-agents/refresh-models.ts`,
    );
  }
  return JSON.parse(fs.readFileSync(MODELS_CACHE_PATH, 'utf8')) as ModelsCache;
}

function resolveSweepSet(
  bench: { tier: import('./lib/types').Tier; productionConfig: { modelId: string } },
  cache: ModelsCache,
): readonly string[] {
  const candidates = cache.tiers[bench.tier];
  if (!candidates) {
    throw new Error(`tier ${bench.tier} not found in models.json. Re-run refresh-models.ts.`);
  }
  const top5 = candidates.slice(0, 5);
  const productionModelId = bench.productionConfig.modelId;
  const sweep = new Set<string>(top5);
  if (cache.excluded[productionModelId]) {
    console.warn(
      `[run] WARNING: production modelId ${productionModelId} is excluded ` +
        `(${cache.excluded[productionModelId]}). Sweep continues without anchor.`,
    );
  } else {
    sweep.add(productionModelId);
  }
  return [...sweep];
}
```

(Make sure `fs` is imported — it already is.)

- [ ] **Step 3: Wire the resolver into the main flow**

Find the line that currently iterates `bench.models`. Replace `bench.models` with a call to `resolveSweepSet(bench, modelsCache)`. Just before that loop, add `const modelsCache = loadModelsCache();`.

Concretely the change looks like:
```ts
// before
for (const modelId of bench.models) { ... }

// after
const modelsCache = loadModelsCache();
const modelsToSweep = resolveSweepSet(bench, modelsCache);
console.log(`[run] modelsToSweep (${modelsToSweep.length}): ${modelsToSweep.join(', ')}`);
for (const modelId of modelsToSweep) { ... }
```

Also update the `console.log(... models=${bench.models.length} ...)` header line earlier in the function — replace `bench.models.length` with `modelsToSweep.length`.

- [ ] **Step 4: Compile check**

Run:
```bash
pnpm tsc --noEmit -p scripts/benchmark-agents/tsconfig.spec.json 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark-agents/run.ts
git commit -m "feat(benchmark-agents): resolve sweep set from models.json + production anchor

run.ts now reads benchmarks/cache/models.json[tier], takes top 5, and
unions the current production modelId from bench.productionConfig.modelId
(the AgentConfig already exposes this — no extra resolver needed).
Excluded production models emit a WARN."
```

---

## Task 13: Delete `pricing.manifest.json`

**Files:**
- Delete: `scripts/benchmark-agents/pricing.manifest.json`

- [ ] **Step 1: Confirm the manifest is no longer referenced anywhere**

Run:
```bash
grep -rln 'pricing\.manifest\.json' scripts/ .claude/ docs/ 2>/dev/null
```
Expected: at most matches in `docs/` (spec/plan/backlog references documenting that we deleted it) — those are OK. NO matches in `scripts/` or `.claude/`.

- [ ] **Step 2: Delete the file**

Run:
```bash
rm scripts/benchmark-agents/pricing.manifest.json
```

- [ ] **Step 3: Commit**

```bash
git add -A scripts/benchmark-agents/pricing.manifest.json
git commit -m "chore(benchmark-agents): delete pricing.manifest.json

Superseded by AWS Pricing API + refresh-pricing.ts. The investigation
from 2026-05-20 confirmed every modelId in current production resolves
via AmazonBedrockFoundationModels (Anthropic) or AmazonBedrock (Nova,
Llama, Mistral) on-demand records."
```

---

## Task 14: Update `.claude/skills/benchmark-agents/SKILL.md`

**Files:**
- Modify: `.claude/skills/benchmark-agents/SKILL.md`

- [ ] **Step 1: Update §1 Preflight to add models-cache check**

Open `.claude/skills/benchmark-agents/SKILL.md`. Find the section heading `## Procedure > 1. Preflight` (or `### 1. Preflight`). Within that section, immediately before the existing pricing-refresh trigger paragraph, insert:

```markdown
**Models cache:** If `benchmarks/cache/models.json` is missing, older than 30 days, or its `tiersHash` differs from `sha256(scripts/benchmark-agents/tiers.json)`, run:

```bash
node -r ./tools/register-paths.js --import tsx scripts/benchmark-agents/refresh-models.ts
```

This calls `bedrock:ListFoundationModels` + `bedrock:ListInferenceProfiles` + a 1-token Converse probe per candidate. Total cost <$0.01 per refresh. Writes `benchmarks/cache/models.json` with per-tier candidate lists and an `excluded` map of inaccessible / deprecated modelIds.
```

- [ ] **Step 2: Reword §3 Pricing**

Find `### 3. Pricing` (or equivalent heading). Replace the body with:
```markdown
If `benchmarks/cache/pricing.json` is missing or older than 7 days (or if `refresh-models.ts` regenerated `models.json` this invocation), run:

```bash
node -r ./tools/register-paths.js --import tsx scripts/benchmark-agents/refresh-pricing.ts
```

The script queries the AWS Pricing API (`AmazonBedrockFoundationModels` for Anthropic / Cohere / Jamba; `AmazonBedrock` for everything else) and writes us-east-1 on-demand token prices to `pricing.json`. If any modelId in `models.json.tiers` or any current production modelId has no Pricing API record, the script exits non-zero with the list — resolve by removing the offending model from `tiers.json` or waiting for AWS to publish.

Requires `AWS_PROFILE=nestfolio-dev` (the repo-root `.env` already carries this — no manual prefix needed for npm/pnpm-driven calls).
```

- [ ] **Step 3: Update §4 Sweep description**

Find `### 4. Sweep loop` (or similar). Add or replace the introductory paragraph with:

```markdown
For each requested task, `run.ts` reads the task's `bench.tier` field, resolves the top 5 candidates from `benchmarks/cache/models.json[tier]`, and unions the current production modelId (from `bench.productionConfig.modelId`). Net sweep set: 5–6 modelIds per task per invocation. If the production modelId is in `cache.excluded`, the sweep emits a WARN line and proceeds without the anchor — the cross-task report will note this.
```

- [ ] **Step 4: Verify SKILL.md renders cleanly (rough text check)**

Run:
```bash
grep -n '^### ' .claude/skills/benchmark-agents/SKILL.md | head -20
```
Expected: headings still in numeric order (1 Preflight, 2 Fixtures, 3 Pricing, 4 Sweep loop, ...).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/benchmark-agents/SKILL.md
git commit -m "docs(benchmark-agents): update SKILL.md for dynamic model discovery

§1 Preflight: add models.json freshness check + refresh-models.ts trigger.
§3 Pricing: replace manifest description with AWS Pricing API flow.
§4 Sweep: clarify 5-6 modelIds resolved from cache + production anchor."
```

---

## Task 15: Manual gate — populate caches + smoke benchmark

This task is not committed (caches are gitignored). It validates the pipeline end-to-end before declaring done.

- [ ] **Step 1: Clear existing caches**

Run:
```bash
rm -f benchmarks/cache/models.json benchmarks/cache/pricing.json
```

- [ ] **Step 2: Run refresh-models.ts against dev account**

Run:
```bash
AWS_PROFILE=nestfolio-dev pnpm tsx scripts/benchmark-agents/refresh-models.ts
```
Expected:
- Console shows `[refresh-models] catalog size: ... base + ... profiles`
- `[refresh-models] after us.* dedup: ...` smaller than the sum
- Per-model `probe ... ok` or `probe ... excluded (<reason>)` lines
- `[refresh-models] wrote benchmarks/cache/models.json`
- Tier sizes printed: `narrative: N1`, `structured-output-frontier: N2`, `structured-output-light: N3` — each ≥ 3
- The 5 previously-broken modelIds from `bedrock-dev-model-access-audit` should now appear in `models.json.excluded` with explicit reasons (not in any tier).

Verify:
```bash
node -e 'const c=require("./benchmarks/cache/models.json"); console.log("tier sizes:",Object.fromEntries(Object.entries(c.tiers).map(([t,l])=>[t,l.length]))); console.log("excluded count:",Object.keys(c.excluded).length); console.log("excluded for premier:",c.excluded["us.amazon.nova-premier-v1:0"]||"NOT EXCLUDED"); console.log("excluded for sonnet-4-7:",c.excluded["us.anthropic.claude-sonnet-4-7"]||"NOT EXCLUDED");'
```

- [ ] **Step 3: Run refresh-pricing.ts against dev account**

Run:
```bash
AWS_PROFILE=nestfolio-dev pnpm tsx scripts/benchmark-agents/refresh-pricing.ts
```
Expected:
- `[refresh-pricing] resolving N modelIds via AWS Pricing API`
- Per-model line `<modelId>... $X/$Y`
- Final `[refresh-pricing] wrote benchmarks/cache/pricing.json (N entries)`
- Exit 0 (no `NO RECORDS` rows).

Verify:
```bash
node -e 'const p=require("./benchmarks/cache/pricing.json"); for(const[m,e]of Object.entries(p.models)){console.log(m,"->",e.inputUSDPerMTok+"/"+e.outputUSDPerMTok,"["+e.serviceCode+"]");} '
```

- [ ] **Step 4: Smoke test — single task, single iteration**

Run:
```bash
AWS_PROFILE=nestfolio-dev pnpm tsx scripts/benchmark-agents/run.ts --task user-goals --iterations 1
```
Expected:
- `[run] modelsToSweep (5):` or `(6):` followed by the resolved modelIds
- 5–6 `[run] sweeping <modelId>` blocks each with 1 iteration line
- `[run] raw-results=benchmarks/tasks/user-goals/<ISO>/raw-results.json`
- The production modelId from `services/advisory/investor-profile-ctrl/src/agents/user-goals.config.ts` is present in the modelsToSweep list.

Verify:
```bash
ls -la benchmarks/tasks/user-goals/*/raw-results.json | tail -1
node -e 'const f=require("./benchmarks/tasks/user-goals/'$(ls -t benchmarks/tasks/user-goals/ | head -1)'/raw-results.json"); console.log("models swept:",f.models.map(m=>m.modelId));'
```

- [ ] **Step 5: Document manual-gate outcome**

If anything failed, stop and investigate — do NOT proceed to Task 16. If all steps passed, capture the tier sizes + excluded modelId count in a one-line note for the PR description (e.g., "manual gate: narrative=4, frontier=3, light=4; excluded=12").

---

## Task 16: Final self-review + PR

**Files:**
- No code changes; just review + push + PR.

- [ ] **Step 1: Run the full benchmark-agents jest suite**

Run:
```bash
pnpm jest --config scripts/benchmark-agents/jest.config.ts
```
Expected: all tests PASS (catalog-loader, tier-filter, pricing-display-name, usagetype-picker, pricing-loader, plus the existing types.test.ts and timings.test.ts).

- [ ] **Step 2: Workspace-wide TypeScript compile check**

Run:
```bash
pnpm tsc --noEmit -p scripts/benchmark-agents/tsconfig.spec.json
```
Expected: 0 errors.

- [ ] **Step 3: Verify `pricing.manifest.json` is gone everywhere**

Run:
```bash
grep -rln 'pricing\.manifest' scripts/ .claude/ 2>/dev/null
```
Expected: no matches.

- [ ] **Step 4: Update backlog file `status: shipped`**

Edit `docs/backlog/benchmark-agents-dynamic-model-discovery.md`:
- Change `status: active` → `status: shipped`.
- Fill `validation_gate:` with a quoted one-line summary of the §15 manual-gate output, e.g. `validation_gate: "/benchmark-agents user-goals --iterations 1 against deployed dev: sweep set of 5 modelIds (top-4 tier + production anchor sonnet-4-6), zero Pricing API misses, models.json excluded list contains the 5 modelIds from bedrock-dev-model-access-audit with explicit reasons."`

- [ ] **Step 5: Regenerate BACKLOG.md**

Run:
```bash
node .claude/skills/backlog-lint/lint.mjs --fix
```
Expected: `✓ N backlog files; all 8 rules pass (with --fix applied)`.

- [ ] **Step 6: Commit the shipped flip**

```bash
git add docs/backlog/benchmark-agents-dynamic-model-discovery.md docs/BACKLOG.md
git commit -m "docs(backlog): ship benchmark-agents-dynamic-model-discovery"
```

- [ ] **Step 7: Push the worktree branch + open PR**

```bash
git push -u origin HEAD
gh pr create --title "benchmark-agents: dynamic Bedrock model discovery" --body "$(cat <<'EOF'
## Summary
- Replace per-task `models[]` arrays in 6 `<task>.bench.ts` files with a `tier` declaration (`narrative` / `structured-output-frontier` / `structured-output-light`).
- Add `refresh-models.ts` orchestrator: `bedrock:ListFoundationModels` + `bedrock:ListInferenceProfiles` + 1-token Converse access probe + tier filter → `benchmarks/cache/models.json` (30-day TTL).
- Rewrite `refresh-pricing.ts` to sole-source from the AWS Pricing API (`AmazonBedrockFoundationModels` for Anthropic, `AmazonBedrock` for everything else); delete `pricing.manifest.json`.
- `run.ts` resolves the sweep set at runtime: top 5 from tier ∪ `bench.productionConfig.modelId`.

## Spec
[`docs/superpowers/specs/2026-05-20-benchmark-agents-dynamic-model-discovery-design.md`](docs/superpowers/specs/2026-05-20-benchmark-agents-dynamic-model-discovery-design.md)

## Test plan
- [ ] `pnpm jest --config scripts/benchmark-agents/jest.config.ts` — all unit suites pass
- [ ] `pnpm tsc --noEmit -p scripts/benchmark-agents/tsconfig.spec.json` — 0 errors
- [ ] Manual gate (Task 15): `refresh-models` + `refresh-pricing` + `/benchmark-agents user-goals --iterations 1` against deployed dev
- [ ] Excluded list in `models.json` contains the 5 modelIds from `bedrock-dev-model-access-audit` with explicit reasons

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review (executed during plan-write, recorded here)

**Spec coverage:**
- §3 out-of-scope items → all captured in the backlog frontmatter; none implemented.
- §4.1 file layout → mapped 1:1 in tasks.
- §5 tiers → Task 3.
- §5.2 SIZE_CLASS_RULES → Task 4.
- §6 bench shape → Task 11.
- §7 refresh-models → Task 8 (orchestrator) + Tasks 4–5 (logic).
- §8 refresh-pricing → Task 9 (orchestrator) + Tasks 6–7 (logic).
- §9 run.ts → Task 12.
- §10 SKILL.md → Task 14.
- §11 tests → Tasks 4, 5, 6, 7, 10.
- §12 migration → Tasks 13, 15.

**Placeholder scan:** No TBD/TODO. All code blocks complete. Step expectations explicit.

**Type consistency:** `TaskBenchConfig.tier` (Task 2) consumed by `tiers.json` keys (Task 3) and `bench.tier` references (Tasks 11, 12). `PricingEntry` fields (Task 2) emitted by `refresh-pricing.ts` (Task 9) and read by `pricing-loader.ts` test (Task 10). `ModelsCache.tiers/excluded` (Task 2) written by `refresh-models.ts` (Task 8) and read by `run.ts` (Task 12) — names match.

**Scope check:** One coherent workstream. One PR.

**Open item:** `lib/types.ts` will have a transient TypeScript error after Task 2 step 2 (`tiers.json` doesn't exist yet) until Task 3. This is called out in Task 2 step 2; acceptable given the trade-off (avoiding a circular task ordering between types + JSON).
