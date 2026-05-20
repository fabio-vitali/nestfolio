# benchmark-agents — dynamic Bedrock model discovery

Status: design (spec)
Date: 2026-05-20
Owner: fabio

---

## 1 · Background

`/benchmark-agents` ([`.claude/skills/benchmark-agents/SKILL.md`](../../../.claude/skills/benchmark-agents/SKILL.md)) sweeps multiple Bedrock models against each of 6 production AgentConfigs and produces evaluation reports. Today, each task in [`scripts/benchmark-agents/tasks/<task>.bench.ts`](../../../scripts/benchmark-agents/tasks/) hardcodes a `models: readonly string[]` array. The same hardcoded list shape is repeated across all 6 task files.

This is the rot vector. Three concrete failures already observed:

1. **Nova Premier (`us.amazon.nova-premier-v1:0`)** was proposed as a candidate in three of the six tasks (`portfolio-construction`, `market-research`, `risk-assessment`). The model is **not granted on the dev account** and AWS no longer treats it as a frontier-current choice. The 2026-05-19 sweep emitted `ValidationException` rows for it.
2. The 2026-05-19 sweep also surfaced four other broken modelIds (`us.anthropic.claude-sonnet-4-7`, `us.anthropic.claude-opus-4-7`, `meta.llama3-3-70b-instruct-v1:0`, `mistral.mistral-large-2407-v1:0`) — filed and audited under [`bedrock-dev-model-access-audit`](../../backlog/bedrock-dev-model-access-audit.md). That fix was per-row manual; the underlying source of drift remains.
3. The current Bedrock catalog visible to this account contains ~76 active models (Pricing API enumeration, 2026-05-20). Hand-curated lists cannot keep up with launches and deprecations on that catalog's cadence.

Separately, [`scripts/benchmark-agents/pricing.manifest.json`](../../../scripts/benchmark-agents/pricing.manifest.json) was hand-maintained because an earlier investigation concluded the AWS Pricing API lacked Claude 4.x coverage. **That conclusion is stale.** Re-verified against `aws pricing get-products` on 2026-05-20:

| Model (production-current) | Pricing API status |
| --- | --- |
| Claude Sonnet 4.6 | covered (`AmazonBedrockFoundationModels` / `servicename`) — input $3.00 / output verified |
| Claude Haiku 4.5 | covered — input $1.00 |
| Claude Opus 4.6 / 4.7 | covered |
| Nova Pro / Lite / Premier | covered (`AmazonBedrock` / `model`) |
| Llama 3.3 70B, Llama 4 Maverick / Scout | covered |
| 50+ other Bedrock models | covered |

The missing-Claude-4.x finding was a service-code/attribute-schema gotcha: Anthropic pricing lives under `AmazonBedrockFoundationModels` with the model identity in `servicename`, not under `AmazonBedrock` with `model`. The manifest is now duplicate work.

## 2 · Goal

Replace per-task hardcoded `models[]` arrays and the hand-maintained pricing manifest with a discovery layer that produces:

- **Scenario-coherent** candidate lists per task (a portfolio-construction sweep contains models comparable in capability/price-band to portfolio-construction's needs — not narrative-class generalists).
- **Account-accessible** modelIds only (the discovery layer probes the dev account at refresh time; ungranted models are excluded with a recorded reason).
- **Currently-active** modelIds only (LEGACY / deprecated catalog entries are excluded).
- **Pricing sourced from AWS** for every modelId surfaced — no parallel manifest of numbers to maintain.

The drift fix is structural: when AWS deprecates a model, the next refresh-models invocation drops it from the discovery cache; the next /benchmark-agents run never proposes it. No human edit required.

## 3 · Out of scope

- AWS MCP server install. (`aws pricing` / `aws bedrock` via CLI + SDK is sufficient.)
- Auto-categorising newly-launched models into tiers. (New models that match no tier predicate are recorded under `uncategorized:` in the cache and logged at refresh time; updating `tiers.json` is a deliberate human edit.)
- Multi-region pricing (us-east-1 only — matches Nestfolio's dev region invariant from `MEMORY.md`).
- Auto-scheduled refresh. (Refresh runs at `/benchmark-agents` invocation when the cache is stale — same trigger model as `pricing.json` today. No cron, no background process.)
- Replacing the `pricing.overrides.json` file by *keeping* a fallback. The decision is to **drop the overrides file entirely** — if the AWS Pricing API misses a modelId, `refresh-pricing` hard-errors with an explicit message naming the modelId. The user resolves by either dropping the modelId or waiting for AWS to publish.
- Editing past benchmark reports under `benchmarks/_summary/<ISO>/` to reflect the new candidate model. The reports remain frozen historical artifacts.
- Production runtime model selection logic (the `agent-orchestrator` model knob, escalation tiers, etc.) — orthogonal workstream covered by [`simplify-agent-orchestrator-model-knob`](../../backlog/simplify-agent-orchestrator-model-knob.md).

## 4 · Architecture

### 4.1 File layout (after)

```
scripts/benchmark-agents/
├── tiers.json                      # NEW — 3 tier definitions
├── refresh-models.ts               # NEW — discover, tier-filter, access-probe
├── refresh-pricing.ts              # REWRITTEN — AWS Pricing API sole source
├── pricing-loader.ts               # UPDATED — consumes new cache shape
├── pricing.manifest.json           # DELETED
├── tasks/
│   ├── explainability.bench.ts            # UPDATED — declares `tier`, drops `models[]`
│   ├── market-research.bench.ts           # UPDATED
│   ├── portfolio-construction.bench.ts    # UPDATED
│   ├── rebalance-planner.bench.ts         # UPDATED
│   ├── risk-assessment.bench.ts           # UPDATED
│   └── user-goals.bench.ts                # UPDATED
├── run.ts                          # UPDATED — resolves sweep from cache + production anchor
├── capture-fixture.ts              # UNCHANGED
└── lib/
    ├── catalog-loader.ts           # NEW — bedrock:ListFoundationModels + ListInferenceProfiles + access probe
    ├── tier-filter.ts              # NEW — per-tier predicate against catalog metadata
    ├── pricing-display-name.ts     # NEW — Bedrock modelId ↔ (serviceCode, identityValue) mapping
    ├── types.ts                    # UPDATED — new types for models cache + tier definitions
    ├── timings.ts                  # UNCHANGED
    └── invoke-model.ts             # UNCHANGED

benchmarks/cache/                   # gitignored, unchanged location
├── pricing.json                    # existing — now sole-sourced from Pricing API
└── models.json                     # NEW — { fetchedAt, tiersHash, tiers, excluded }
```

### 4.2 Data flow per `/benchmark-agents` invocation

```
Preflight (SKILL §1)
   │
   ├── if benchmarks/cache/models.json missing
   │   OR fetchedAt > 30d ago
   │   OR sha256(tiers.json) ≠ cached tiersHash
   │   OR tiers.json mtime > cache mtime
   │   → run refresh-models.ts
   │
   └── if benchmarks/cache/pricing.json missing
       OR fetchedAt > 7d ago
       → run refresh-pricing.ts (depends on cache.models for universe)

Sweep loop (SKILL §4, per task)
   │
   ├── read scripts/benchmark-agents/tasks/<task>.bench.ts
   ├── tier = bench.tier
   ├── candidates = cache.tiers[tier]
   ├── candidates = candidates.slice(0, 5)            (deterministic rank, see §7)
   ├── productionModelId = resolveProductionModel(bench.configFilePath)
   ├── if productionModelId ∈ cache.excluded → log WARN + skip
   ├── else if productionModelId ∉ candidates → candidates.push(productionModelId)
   └── invokeStructured() loop over candidates × iterations
```

## 5 · Tier definitions (`tiers.json`)

Three tiers cover the six existing tasks cleanly. Per-tier predicate fields are evaluated against `bedrock:ListFoundationModels` metadata + a small hand-maintained vendor classification (which models are "frontier" vs "mid" vs "cheap" — Bedrock doesn't tag this).

```jsonc
// scripts/benchmark-agents/tiers.json
{
  "narrative": {
    "description": "Long-form prose generation (explainability, market outlook narrative).",
    "families": ["anthropic", "amazon.nova-pro", "amazon.nova-premier", "meta.llama3-3+", "meta.llama4+"],
    "sizeClass": ["frontier", "mid"],
    "minContextWindow": 32000
  },
  "structured-output-frontier": {
    "description": "High-stakes JSON outputs where quality > cost (portfolio construction, rebalance planning, risk assessment). Structured-output reliability is measured by the benchmark itself via schemaPass / validationPass — no separate predicate needed.",
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

### 5.1 Per-task tier assignment

| Task | Service | Tier |
| --- | --- | --- |
| `explainability` | `advisory-narrative-ctrl` | `narrative` |
| `market-research` | `market-intelligence-ctrl` | `narrative` |
| `portfolio-construction` | `portfolio-engine-ctrl` | `structured-output-frontier` |
| `rebalance-planner` | `portfolio-engine-ctrl` | `structured-output-frontier` |
| `risk-assessment` | `portfolio-engine-ctrl` | `structured-output-frontier` |
| `user-goals` | `investor-profile-ctrl` | `structured-output-light` |

### 5.2 Family / size-class taxonomy

The `families` field uses prefix-match against the Bedrock modelId (e.g. `anthropic` matches `us.anthropic.claude-*`, `amazon.nova-pro` matches `us.amazon.nova-pro-v1:0` but NOT `us.amazon.nova-lite-v1:0`). The `+` suffix denotes "this version or newer" (e.g. `meta.llama3-3+` matches Llama 3.3, 3.4, 4.x; not 3.0–3.2).

The `sizeClass` is a per-vendor manual classification carried in `lib/catalog-loader.ts`. Because Bedrock modelIds embed family + version + size in patterns that vary by vendor (`anthropic.claude-sonnet-4-6` vs `meta.llama3-3-70b-instruct-v1:0`), classification uses a predicate list, not a flat prefix table:

```ts
// lib/catalog-loader.ts (excerpt)
type SizeClass = 'frontier' | 'mid' | 'cheap';

interface SizeClassRule {
  match: (modelId: string) => boolean;
  sizeClass: SizeClass;
}

const SIZE_CLASS_RULES: readonly SizeClassRule[] = [
  // Anthropic
  { match: (id) => /anthropic\.claude-opus/.test(id),   sizeClass: 'frontier' },
  { match: (id) => /anthropic\.claude-sonnet/.test(id), sizeClass: 'frontier' },
  { match: (id) => /anthropic\.claude-haiku/.test(id),  sizeClass: 'mid' },
  // Amazon Nova
  { match: (id) => /amazon\.nova-premier/.test(id),     sizeClass: 'frontier' },
  { match: (id) => /amazon\.nova-pro/.test(id),         sizeClass: 'frontier' },
  { match: (id) => /amazon\.nova-lite/.test(id),        sizeClass: 'mid' },
  { match: (id) => /amazon\.nova-micro/.test(id),       sizeClass: 'cheap' },
  // Meta Llama — match on size token in the modelId
  { match: (id) => /meta\.llama.*-(70b|405b)-/.test(id),    sizeClass: 'frontier' },
  { match: (id) => /meta\.llama.*-(maverick|scout|17b)-/i.test(id), sizeClass: 'mid' },
  { match: (id) => /meta\.llama.*-(8b|1b|3b|11b)-/.test(id),       sizeClass: 'cheap' },
  // Mistral
  { match: (id) => /mistral\.mistral-large/.test(id),   sizeClass: 'frontier' },
  // ...etc
];

function sizeClassFor(modelId: string): SizeClass | 'unknown' {
  return SIZE_CLASS_RULES.find((r) => r.match(modelId))?.sizeClass ?? 'unknown';
}
```

The rule list is the only place where vendor-specific judgment lives. New vendors / model families surfacing in `ListFoundationModels` that don't match any rule are flagged `sizeClass: 'unknown'` and excluded from all tiers (tier predicates require an explicit sizeClass). The `uncategorized:` field in `models.json` (§7.1 step 6) surfaces them so the rule list can be extended deliberately.

## 6 · Per-task `bench.ts` shape

Each `<task>.bench.ts` exports `benchConfig`. After this change:

```ts
// scripts/benchmark-agents/tasks/portfolio-construction.bench.ts
export const benchConfig = {
  taskName: 'portfolio-construction',
  service: 'portfolio-engine-ctrl',
  configFilePath: 'services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config.ts',
  tier: 'structured-output-frontier',  // NEW — replaces `models: [...]`
  fixturePath: 'benchmarks/fixtures/portfolio-construction.captured.json',
  productionConfig: { /* maxTokens, temperature, schema — unchanged */ },
  validationRule: /* unchanged */,
};
```

The `models` field is removed. The `tier` field is the single source of truth for "what to sweep". TypeScript types in `lib/types.ts` enforce `tier` is one of the keys of `tiers.json` (compile-time check via a generated union, see §10.3).

## 7 · `refresh-models.ts`

Cadence: 30-day TTL, or stale when `tiers.json` changes.

### 7.1 Algorithm

```
1.  catalog = await bedrock.listFoundationModels({ byOutputModality: 'TEXT' })
    filter modelLifecycle.status === 'ACTIVE'

2.  inferenceProfiles = await bedrock.listInferenceProfiles({ typeEquals: 'SYSTEM_DEFINED' })
    these surface us.* cross-region IDs

3.  Build candidate pool: union(catalog.modelArn-derived modelIds, inferenceProfiles.inferenceProfileId)
    Deduplicate: when both `<vendor>.<model>` and `us.<vendor>.<model>` are present,
    KEEP us.* and DROP the base ID. Per CLAUDE.md memory:
    "Bedrock model IDs: use inference profile IDs (`us.anthropic.claude-sonnet-4-6`),
     not base model IDs".

4.  For each candidate modelId:
    a. Look up sizeClass via prefix-match against SIZE_CLASS table.
       If no match → record `excluded[modelId] = 'sizeClass-unknown: no vendor classification'`
    b. Send a 1-token probe via bedrock-runtime:Converse
       (system='ping', messages=[{role:'user', content:[{text:'1'}]}], maxTokens=1)
    c. Catch errors:
       - AccessDeniedException        → excluded[modelId] = 'no model access grant'
       - ValidationException          → excluded[modelId] = 'invalid modelId form (region/profile suffix shift)'
       - ResourceNotFoundException    → excluded[modelId] = 'not available in region'
       - ThrottlingException          → retry once after 2s backoff;
                                        on second failure → excluded[modelId] = 'probe-failed: throttling'
       - other                        → excluded[modelId] = `probe-failed: ${err.name}`

5.  For each tier in tiers.json:
    candidates = filter(catalog, tierPredicate(tier))
    candidates = sortDeterministic(candidates)
      // rank: sizeClass(frontier > mid > cheap), then modelId asc
    tiers[tierName] = candidates.map(m => m.modelId)

6.  uncategorized = catalog.filter(m => no tier accepts AND not in excluded)
    log INFO: 'uncategorized: <list>' — informational only, not an error

7.  Write benchmarks/cache/models.json:
    {
      "fetchedAt": ISO string,
      "tiersHash": sha256(file contents of tiers.json),
      "tiers": { "narrative": [...], "structured-output-frontier": [...], "structured-output-light": [...] },
      "excluded": { "<modelId>": "<reason>", ... },
      "uncategorized": ["<modelId>", ...]
    }
```

### 7.2 Probe cost

Catalog size today: ~76 active text-output models. Even probing all 76 at 1 input + 1 output token using the cheapest model rate (~$0.07/MTok input + ~$0.07/MTok output for Llama 3.3) costs <$0.001 per refresh. Frontier-model probes (Sonnet 4.6 at $3/$15) cost ~$0.018 per 1K token at refresh — at 1 token per probe that's ~$0.000018 per Sonnet probe. Total per-refresh cost: ~$0.005 ceiling.

### 7.3 Refresh triggers

Recompute models.json when ANY of:

- `benchmarks/cache/models.json` does not exist.
- `models.json.fetchedAt < now - 30 days`.
- `sha256(tiers.json) ≠ models.json.tiersHash`.
- `tiers.json` mtime > `models.json` mtime (cheap fast-path before hashing).

## 8 · `refresh-pricing.ts`

Cadence: 7-day TTL (unchanged from today).

### 8.1 Algorithm

```
1.  modelIds = union(
      cache.models.tiers values,            // all candidates discovery surfaced
      productionModelIds (read from each <task>.bench.ts → configFilePath)
    )

2.  For each modelId:
    a. (serviceCode, identityField, identityValue) = resolvePricingIdentity(modelId)
       see pricing-display-name.ts mapping below.
    b. records = aws.pricing.get-products({
         serviceCode,
         filters: [
           { field: identityField, value: identityValue },
           { field: 'regionCode', value: 'us-east-1' },
         ],
       })
    c. Pick on-demand input + output token records. Picker is vendor-aware via serviceCode:

       Branch A — serviceCode = AmazonBedrockFoundationModels (Anthropic, Cohere, Jamba, etc.):
         - For us.* modelIds: pick usagetype matching `*_InputTokenCount_Global-Units`
           (cross-region inference profile pricing).
         - For base modelIds: pick usagetype matching `*_InputTokenCount-Units` (no `_Global`).
         - EXCLUDE usagetypes containing: `_Batch`, `Cache`, `Reserved_`, `LongContext`,
           `CrossGeo`.

       Branch B — serviceCode = AmazonBedrock (Nova, Llama, Mistral, DeepSeek, Qwen, etc.):
         - For both us.* and base modelIds: pick usagetype matching `*-input-tokens` exactly
           (the vendor naming scheme here uses kebab-case and has no _Global suffix; us.* and
           base share the same price record).
         - EXCLUDE usagetypes containing: `-priority`, `-flex`, `-batch`, `-cache-`.

       (`Latency_Optimized` is a separate `model` value in the Pricing API — the model filter
       already segregates it; no usagetype exclusion needed.)

    d. Same picker logic for OutputTokenCount (substitute `Output` for `Input`).
    e. If either record missing → record modelId in `unresolved` list.

3.  If unresolved is non-empty:
    print "AWS Pricing API missing entries for:" + list
    print "Either remove these models from sweep (tiers.json) or wait for AWS to publish."
    process.exit(1)

4.  Write benchmarks/cache/pricing.json:
    {
      "fetchedAt": ISO string,
      "models": {
        "<modelId>": {
          "inputUSDPerMTok": number,
          "outputUSDPerMTok": number,
          "source": "aws-pricing-api",
          "serviceCode": "<svc>",
          "usagetype": "<the input usagetype>"
        }
      }
    }
```

### 8.2 `pricing-display-name.ts` resolver

This is the only manual mapping table that survives. It maps Bedrock modelId → AWS Pricing API identity. Three service codes carry the records we care about:

| Bedrock vendor prefix | Pricing API service code | Identity field | Identity format |
| --- | --- | --- | --- |
| `anthropic.claude-*` and `us.anthropic.claude-*` | `AmazonBedrockFoundationModels` | `servicename` | `Claude <Family> <Version> (Amazon Bedrock Edition)` |
| `cohere.*` | `AmazonBedrockFoundationModels` | `servicename` | `Cohere <Name> (Amazon Bedrock Edition)` |
| `amazon.nova-*` and `us.amazon.nova-*` | `AmazonBedrock` | `model` | `Nova <Variant>` |
| `amazon.titan-*` | `AmazonBedrock` | `model` | `Titan <Variant>` |
| `meta.llama*` | `AmazonBedrock` | `model` | `Llama <Version> <Size>` |
| `mistral.*` | `AmazonBedrock` | `model` | `<Mistral / Pixtral / Ministral / Magistral> <Name>` |
| `ai21.*` (Jamba) | `AmazonBedrockFoundationModels` | `servicename` | `Jamba <Variant> (Amazon Bedrock Edition)` |
| `deepseek.*`, `qwen.*`, `nvidia.*`, etc. | `AmazonBedrock` | `model` | per Pricing API enumeration |

Most of the formatting is derivable from `bedrock:ListFoundationModels` `modelName` field — for example `modelName: 'Claude Sonnet 4.6'` directly yields the Pricing API `servicename` minus the `(Amazon Bedrock Edition)` suffix. The mapping table is therefore a **per-vendor rule set** (~8 rules), not a per-model table. New vendor prefixes that don't match any rule cause `refresh-pricing` to error.

### 8.3 Refresh triggers

- `benchmarks/cache/pricing.json` does not exist.
- `pricing.json.fetchedAt < now - 7 days`.
- `tiers.json` changed (because the modelId universe to price depends on tier membership) — collapsed into "if models.json was refreshed this invocation, also refresh pricing".

## 9 · Per-sweep resolution in `run.ts`

`run.ts --task <name> --iterations N` already exists and loops over `bench.models`. After this change:

```ts
// after parsing args + loading bench + loading cache:
const tierCandidates = cache.tiers[bench.tier];
if (!tierCandidates) {
  throw new Error(`Tier ${bench.tier} not in cache. Re-run refresh-models.ts.`);
}

const top5 = tierCandidates.slice(0, 5);

const productionModelId = resolveProductionModel(bench.configFilePath);
// reads the .config.ts file, picks the `modelId` field at the top of the exported object

const sweepSet = new Set<string>(top5);
if (cache.excluded[productionModelId]) {
  console.warn(
    `[run] WARNING: production modelId ${productionModelId} is excluded ` +
    `(${cache.excluded[productionModelId]}). Sweep continues without anchor.`,
  );
} else if (!sweepSet.has(productionModelId)) {
  sweepSet.add(productionModelId);
}

const modelsToSweep = [...sweepSet];  // 5–6 entries
```

The rest of `run.ts` (the invocation loop, aggregation, raw-results.json writer) is unchanged.

`resolveProductionModel(configFilePath)` reads the production AgentConfig file and extracts the top-level `modelId` field via static import (the file is a regular ESM module exporting an object). All 6 production AgentConfigs already export this shape — verified.

## 10 · SKILL.md updates

### 10.1 Procedure §1 (Preflight) — add

> If `benchmarks/cache/models.json` is missing, older than 30 days, or its `tiersHash` differs from `sha256(scripts/benchmark-agents/tiers.json)`, run:
>
> ```bash
> node -r ./tools/register-paths.js --import tsx scripts/benchmark-agents/refresh-models.ts
> ```
>
> This calls `bedrock:ListFoundationModels` + `bedrock:ListInferenceProfiles` + a 1-token probe per candidate. Total cost <$0.01. The script writes `benchmarks/cache/models.json` with per-tier candidate lists and an `excluded` map of inaccessible/deprecated models.

### 10.2 Procedure §3 (Pricing) — reword

> If `benchmarks/cache/pricing.json` is missing or older than 7 days (or if `refresh-models.ts` just regenerated `models.json` this invocation), run:
>
> ```bash
> node -r ./tools/register-paths.js --import tsx scripts/benchmark-agents/refresh-pricing.ts
> ```
>
> The script queries the AWS Pricing API (`AmazonBedrockFoundationModels` for Anthropic / Cohere / Jamba; `AmazonBedrock` for everything else) and writes us-east-1 on-demand token prices to `pricing.json`. If any modelId in `models.json.tiers` (or any current production modelId) has no Pricing API record, the script exits non-zero with the list of unresolved modelIds — the user resolves by removing them from the tier or waiting for AWS to publish.

### 10.3 Procedure §4 (Sweep) — reword

> For each requested task, `run.ts` reads the task's `bench.tier` field, resolves the top 5 candidates from `cache.tiers[tier]`, and unions the current production modelId from `configFilePath`. Net sweep set: 5–6 modelIds per task per invocation. If the production modelId is in `cache.excluded`, the sweep emits a WARN line and proceeds without the anchor — the cross-task report will note this.

### 10.4 Type-level guarantees

`lib/types.ts` exports a `Tier` union type derived from `tiers.json` keys via TypeScript's `resolveJsonModule` + `as const` JSON import (the workspace already has `resolveJsonModule: true` in `tsconfig.base.json`). Each `bench.ts` is typed `benchConfig: TaskBenchConfig<Tier>` so a typo in `tier:` fails `tsc`:

```ts
// scripts/benchmark-agents/lib/types.ts
import tiersJson from '../tiers.json' with { type: 'json' };
export type Tier = keyof typeof tiersJson;  // 'narrative' | 'structured-output-frontier' | 'structured-output-light'
```

## 11 · Testing

New tests live next to the new source files (per repo convention — tests in `test/` directory… but `scripts/benchmark-agents/` is a script bundle, not a service, and uses colocated `*.test.ts` per the existing `pricing-loader.test.ts` precedent — see [`scripts/benchmark-agents/pricing-loader.test.ts`](../../../scripts/benchmark-agents/pricing-loader.test.ts)).

### 11.1 New test files

- `scripts/benchmark-agents/lib/tier-filter.test.ts`
  - Given a synthetic catalog (8 hand-built `FoundationModelSummary` records spanning all vendors + size classes), assert each tier predicate selects the expected subset.
  - Cover: family prefix matching, `+` suffix versioning rule, `sizeClass` filter, `minContextWindow` filter.

- `scripts/benchmark-agents/lib/pricing-display-name.test.ts`
  - For every modelId in the current 6 task configs + 5 dev-account-granted models, assert `resolvePricingIdentity()` returns `(serviceCode, identityField, identityValue)` that matches a real Pricing API record (test uses a checked-in fixture of Pricing API responses to avoid live AWS calls in unit tests).

- `scripts/benchmark-agents/lib/models-cache.test.ts`
  - Cache invalidation: missing file → refresh; old fetchedAt → refresh; tiersHash mismatch → refresh; tiers.json mtime > cache mtime → refresh; fresh + matching → no refresh.

- `scripts/benchmark-agents/refresh-models.test.ts`
  - Integration-ish: invoke `refresh-models.ts` against a mocked `bedrock` SDK client; assert output `models.json` shape; assert `excluded` map populated correctly for the `AccessDeniedException` / `ValidationException` paths.

- `scripts/benchmark-agents/refresh-pricing.test.ts`
  - Same shape: mock `pricing` SDK; assert usagetype picker selects the `_Global-Units` variant for `us.*` IDs; assert hard-error when a modelId has no record.

### 11.2 Adapted existing test

- [`scripts/benchmark-agents/pricing-loader.test.ts`](../../../scripts/benchmark-agents/pricing-loader.test.ts) — adapted to consume the new `pricing.json` shape (the `source` + `serviceCode` + `usagetype` fields).

### 11.3 Removed test

- The current `lib/types.test.ts` `models[]`-shape assertions are removed.

### 11.4 Live AWS calls in tests

The unit tests never hit AWS. The integration-ish refresh tests use mocked SDK clients with hand-built response fixtures. A separate one-shot manual gate (NOT in the test suite, run as a make-target or just invoked by the user before merge):

```bash
AWS_PROFILE=nestfolio-dev pnpm tsx scripts/benchmark-agents/refresh-models.ts
AWS_PROFILE=nestfolio-dev pnpm tsx scripts/benchmark-agents/refresh-pricing.ts
```

…followed by inspecting `benchmarks/cache/{models,pricing}.json` for the expected entries.

## 12 · Migration / cutover

This is a single-PR change. The migration steps:

1. Add `tiers.json`, the new `lib/` modules, `refresh-models.ts`, and the rewritten `refresh-pricing.ts`.
2. Update all 6 `tasks/<task>.bench.ts` files (replace `models[]` with `tier`).
3. Update `run.ts` to resolve from cache.
4. Delete `pricing.manifest.json`.
5. Update `SKILL.md` per §10.
6. Add tests per §11.
7. Run the manual gate (§11.4) once to populate `benchmarks/cache/models.json` + refreshed `pricing.json`.
8. Run `/benchmark-agents user-goals --iterations 1` as a smoke test of the end-to-end discovery + sweep + report pipeline.

The `benchmarks/cache/` directory is gitignored — caches regenerate on first invocation post-merge.

No production code changes. No service deploys. The 6 production AgentConfigs are read-only from this workstream.

## 13 · Risks

### 13.1 Tier predicate over-restrictive

If a tier predicate is too narrow, a sweep could end up with only 1–2 candidates (no useful comparison). Mitigation: the manual gate in §11.4 surfaces this immediately — eyeball `models.json` and verify every tier has ≥3 candidates after access-filtering. The cross-task report's "no change recommended" branch (§6 in SKILL.md) handles single-candidate sweeps gracefully.

### 13.2 SIZE_CLASS table goes stale

New Anthropic / Amazon Nova generations need a SIZE_CLASS entry. Mitigation: the `uncategorized:` list in `models.json` is printed at refresh time — easy signal that a new family needs classification.

### 13.3 Pricing API publication lag

If AWS launches a model that `bedrock:ListFoundationModels` reports as ACTIVE but `aws pricing get-products` doesn't yet index, `refresh-pricing` hard-errors. The user must either wait or drop the model. Recovery cost: a one-line edit to a `tiers.json` family filter (e.g., temporarily tighten `meta.llama4+` → `meta.llama4-maverick`). Mitigation accepted per §3 out-of-scope (overrides file dropped intentionally).

### 13.4 Probe rate-limiting

Catalog probe (~76 InvokeModel calls in sequence) could hit Bedrock account-level rate limits if a sweep is running concurrently. Mitigation: refresh-models is gated by the 30-day TTL — won't run on a hot path. If a refresh trip throttles, the script retries once with backoff per §7.1 step 4.

### 13.5 Cross-region inference profile ID format shifts

AWS has shifted `us.anthropic.claude-*` suffixes historically (e.g., the 2026-05-19 audit found `us.anthropic.claude-sonnet-4-7` returning `ValidationException` even though `us.anthropic.claude-sonnet-4-6` worked). Mitigation: `refresh-models` re-derives the IDs from `bedrock:ListInferenceProfiles` every 30 days — the discovery layer surfaces whatever AWS currently advertises.

## 14 · References

- [`.claude/skills/benchmark-agents/SKILL.md`](../../../.claude/skills/benchmark-agents/SKILL.md) — current skill procedure
- [`scripts/benchmark-agents/`](../../../scripts/benchmark-agents/) — current implementation
- [`scripts/benchmark-agents/pricing.manifest.json`](../../../scripts/benchmark-agents/pricing.manifest.json) — current pricing source (to be deleted)
- [`docs/backlog/bedrock-dev-model-access-audit.md`](../../backlog/bedrock-dev-model-access-audit.md) — 2026-05-19 access audit (point-fix, shipped 2026-05-20)
- [`docs/backlog/benchmark-agents-quality-and-apply-step.md`](../../backlog/benchmark-agents-quality-and-apply-step.md) — preceding benchmark-agents work, shipped 2026-05-20
- [`docs/backlog/simplify-agent-orchestrator-model-knob.md`](../../backlog/simplify-agent-orchestrator-model-knob.md) — orthogonal runtime model-selection workstream (do not entangle)
- [Bedrock API: ListFoundationModels](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_ListFoundationModels.html)
- [Bedrock API: ListInferenceProfiles](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_ListInferenceProfiles.html)
- [AWS Pricing API: get-products](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html)
