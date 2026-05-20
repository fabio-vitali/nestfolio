---
id: benchmark-agents-discovery-followups
status: queued
rank: 1
type: refactor
notes: "Three polish fixes surfaced during the 2026-05-20 manual gate of dynamic model discovery — anthropic version gate, global.* classifier, optional us-west-2 pricing fallback"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# benchmark-agents: discovery follow-ups

Consolidated polish workstream following the 2026-05-20 ship of `benchmark-agents-dynamic-model-discovery`. Three small fixes surfaced during the manual gate against deployed dev. Ship as a single PR, in the order below — later items become cheaper or unnecessary as earlier ones land.

## Fix A — Anthropic version gate in `tiers.json` (REQUIRED)

`scripts/benchmark-agents/tiers.json` gates Meta by version (`meta.llama3-3+`, `meta.llama4+`) but accepts ANY `anthropic.*` model. Result: Aug-2025 `us.anthropic.claude-opus-4-1-20250805-v1:0` still passes the narrative tier filter despite being well below production-relevant version. Asymmetric and produces noise rows in cross-task reports the human always discards.

Change every tier's `anthropic` entry from bare `"anthropic"` to a version gate, e.g. `"anthropic.claude-4-5+"`. Verify `lib/tier-filter.ts::parseFamilyMatcher` parses `anthropic.claude-4-5+` correctly (the lazy `^(.+?)(\d+)(?:-(\d+))?\+$` regex should: prefix = `anthropic.claude-`, minMajor=4, minMinor=5). Add unit test in `lib/tier-filter.test.ts`.

## Fix B — Strip `global.*` prefix in classifier (REQUIRED)

`lib/tier-filter.ts::stripRegionPrefix` and `lib/pricing-display-name.ts::stripRegion` only strip `(us|eu|apac)\.`. AWS dev account exposes inference profiles with the `global.` prefix (e.g. `global.anthropic.claude-sonnet-4-6`, `global.anthropic.claude-opus-4-6-v1`). Today they fall into `models.json.uncategorized` because the family matcher never strips the prefix:

```
[refresh-models] INFO uncategorized: …, global.anthropic.claude-haiku-4-5-…,
  global.anthropic.claude-opus-4-6-v1, global.anthropic.claude-sonnet-4-6, …
```

Net effect: `structured-output-light` currently has 2 candidates (haiku + nova-lite) when it could have 3-4 if the `global.` Anthropic variants classified correctly.

Widen both strip regexes to `^(us|eu|apac|global)\.`. Update `lib/catalog-loader.ts::dedupeUsStarPreference` to also dedup `(us.<base>, global.<base>)` pairs. Investigate via `bedrock:ListInferenceProfiles` metadata whether `global.*` should be PREFERRED over `us.*` (it may be a newer cross-region routing variant — that would flip the dedup precedence).

## Fix C — us-west-2 fallback in `refresh-pricing.ts` (OPTIONAL)

`refresh-pricing.ts` filters `regionCode = us-east-1`. For some models AWS publishes pricing only in us-west-2 (verified: Opus 4.1's `servicename` returns `regionCode = us-west-2` records only). The script today exits 1 with `PICKER ERROR: missing on-demand input record`.

**Skip this fix if Fixes A + B remove every currently-failing modelId from the sweep universe.** Re-evaluate after A + B land: if no sweep candidate fails on us-east-1 pricing, file as parking. If a real production-candidate fails, implement the fallback.

If implementing: when `getProducts(modelId, us-east-1)` returns zero records, retry with `regionCode = us-west-2` before declaring `unresolved`. Extend `PricingEntry` with `regionCode` so cross-region pricing surfaces in evaluation reports.

## Validation gate

Manual gate against deployed dev:
1. `refresh-models.ts` writes `models.json` with NO Anthropic model older than 4.5 in any tier.
2. `refresh-models.ts` produces NO `global.*` Anthropic entries in `uncategorized`; they appear in the correct tier (or are dedup'd against the matching `us.*` variant).
3. `refresh-pricing.ts` exits 0 — no `NO RECORDS` / `PICKER ERROR` rows for any modelId in any tier.
4. `structured-output-light` tier has ≥ 3 candidates.
