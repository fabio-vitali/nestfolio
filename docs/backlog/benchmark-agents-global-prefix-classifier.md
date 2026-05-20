---
id: benchmark-agents-global-prefix-classifier
status: parking
type: bug
notes: "tier-filter does not strip global.* prefix; global.* IDs go to uncategorized"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# benchmark-agents: handle `global.*` inference-profile prefix

Surfaced during the 2026-05-20 manual gate of dynamic model discovery.

`scripts/benchmark-agents/lib/tier-filter.ts::stripRegionPrefix` and `lib/pricing-display-name.ts::stripRegion` only strip `(us|eu|apac)\.`. AWS dev account exposes inference profiles with the `global.` prefix (e.g. `global.anthropic.claude-sonnet-4-6`, `global.anthropic.claude-opus-4-6-v1`) — these end up in `models.json.uncategorized` because the family matcher never strips the prefix.

```
[refresh-models] INFO uncategorized: …, global.anthropic.claude-haiku-4-5-…, global.anthropic.claude-opus-4-6-v1, global.anthropic.claude-sonnet-4-6, …
```

Net effect: `structured-output-light` tier currently has 2 candidates (haiku + nova-lite) when it could have 3-4 if the `global.` Anthropic variants classified correctly.

**Cheapest next step:** widen `stripRegionPrefix` / `stripRegion` to `^(us|eu|apac|global)\.`. Update `lib/catalog-loader.ts::dedupeUsStarPreference` to also dedup `global.<base>` pairs.

Also evaluate whether `global.*` should be PREFERRED over `us.*` (it might be a newer cross-region routing variant — investigate via `bedrock:ListInferenceProfiles` metadata).
