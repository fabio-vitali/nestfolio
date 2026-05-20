---
id: benchmark-agents-anthropic-version-gate
status: queued
rank: 3
type: refactor
notes: "tiers.json gates Meta by version (llama3-3+, llama4+) but accepts ANY anthropic.* — Opus 4.1 from Aug 2025 still passes the narrative tier filter"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# benchmark-agents: add anthropic version gate to tiers.json

Surfaced 2026-05-20 follow-up to `benchmark-agents-pricing-region-fallback`. The Pricing API failure on `us.anthropic.claude-opus-4-1-20250805-v1:0` was symptomatic — the deeper question is why the benchmark was trying to price an August 2025 Opus at all.

`scripts/benchmark-agents/tiers.json` currently lists family allowlists like:
```json
"narrative": ["anthropic", "amazon.nova-pro", "amazon.nova-premier", "meta.llama3-3+", "meta.llama4+"]
```

Meta gets explicit version gates (`llama3-3+`, `llama4+`). Anthropic gets no gate — every `anthropic.*` modelId in the dev account inference profiles passes (Opus 4.1, Sonnet 4.5, etc.). Asymmetric and inconsistent.

The benchmark exists to evaluate models for production swap. Production AgentConfigs all run Claude 4.5/4.6. Sweeping Opus 4.1 from Aug 2025 produces noise rows in `cross-task-report.md` that the human reviewer always discards.

**Cheapest next step:** widen each tier's anthropic entry to a version gate. Suggested:
```json
"narrative":                   [..., "anthropic.claude-4-5+", ...]
"structured-output-frontier":  [..., "anthropic.claude-4-5+", ...]
"structured-output-light":     [..., "anthropic.claude-4-5+", ...]
```

This requires `lib/tier-filter.ts::parseFamilyMatcher` to handle a `family-N-M+` form where the prefix already contains a dot (`anthropic.claude-`). Verify the existing regex `^(.+?)(\d+)(?:-(\d+))?\+$` parses `anthropic.claude-4-5+` correctly (it should: lazy `.+?` captures `anthropic.claude-`, then `4-5+` is the version gate). Add a unit test in `lib/tier-filter.test.ts`.

Once shipped, `benchmark-agents-pricing-region-fallback` (rank 1) becomes lower priority — Opus 4.1 falls out of the tier and the us-west-2-only Pricing API quirk stops biting. The us-west-2 fallback is still worth implementing as a generic robustness fix, but no longer urgent.
