---
id: benchmark-agents-dynamic-model-discovery
status: active
type: tooling
notes: "Replace hardcoded per-task models[] arrays + pricing.manifest.json with discovery layer (tier filter + Bedrock ListFoundationModels + account-access probe + AWS Pricing API). Cures Nova-Premier-class drift."
references:
  - docs/superpowers/specs/2026-05-20-benchmark-agents-dynamic-model-discovery-design.md
out_of_scope:
  - "AWS MCP server install (aws CLI + SDK sufficient)."
  - "Auto-categorising new model families into tiers — tiers.json edits stay human-driven."
  - "Multi-region pricing (us-east-1 only)."
  - "Auto-scheduled refresh — only on /benchmark-agents invocation, gated by TTL."
  - "Restoring pricing.overrides.json as a fallback — the file is dropped intentionally; missing Pricing API entries hard-error."
  - "Editing past benchmark reports under benchmarks/_summary/<ISO>/ — frozen historical artifacts."
  - "Production runtime model selection (agent-orchestrator model knob, escalation tiers) — orthogonal workstream."
spec: docs/superpowers/specs/2026-05-20-benchmark-agents-dynamic-model-discovery-design.md
plan: null
topic_memory: []
validation_gate: null
---

# benchmark-agents — dynamic Bedrock model discovery

The 2026-05-19 sweep surfaced 5 broken modelIds (filed in [`bedrock-dev-model-access-audit`](bedrock-dev-model-access-audit.md), shipped 2026-05-20 as a point-fix). The systemic cause — hand-curated `models[]` arrays in 6 `<task>.bench.ts` files plus a hand-maintained `pricing.manifest.json` — remains. Same pattern of drift will recur whenever AWS deprecates a model, shifts an inference-profile suffix, or revokes account access.

Re-verified on 2026-05-20: the original "AWS Pricing API has no Claude 4.x coverage" finding (that justified `pricing.manifest.json` in the first place) is stale. Anthropic Claude 4.x pricing IS in the API — it lives in service code `AmazonBedrockFoundationModels` with the model identity in `servicename` (not `model`). Sonnet 4.6, Haiku 4.5, Opus 4.6, Opus 4.7 all present with on-demand records matching our current manifest exactly.

Design spec: [`docs/superpowers/specs/2026-05-20-benchmark-agents-dynamic-model-discovery-design.md`](../superpowers/specs/2026-05-20-benchmark-agents-dynamic-model-discovery-design.md).

Next step: writing-plans skill produces the implementation plan.

## Validation gate (to fill at ship)

`/benchmark-agents user-goals --iterations 1` on a clean working tree (no `benchmarks/cache/`):

1. Triggers `refresh-models.ts` — writes `benchmarks/cache/models.json` with three tiers populated, `excluded:` map listing any inaccessible models with reasons, and zero entries for the previously-broken `us.anthropic.claude-sonnet-4-7` / `us.anthropic.claude-opus-4-7` / `amazon.nova-premier-v1:0` / `meta.llama3-3-70b-instruct-v1:0` / `mistral.mistral-large-2407-v1:0` in any tier (those 5 should appear in `excluded`).
2. Triggers `refresh-pricing.ts` — writes `benchmarks/cache/pricing.json` sole-sourced from AWS Pricing API; numbers within ±$0.01/MTok of the deleted `pricing.manifest.json`.
3. `pricing.manifest.json` is gone from the repo.
4. The 6 `tasks/<task>.bench.ts` files contain `tier: '<tier-name>'` and no `models: [...]` field.
5. The sweep itself succeeds and writes a `raw-results.json` containing 5–6 model entries (top-5 from tier + production anchor), with the production modelId from `services/advisory/investor-profile-ctrl/src/agents/user-goals.config.ts` (or current production path) present.
