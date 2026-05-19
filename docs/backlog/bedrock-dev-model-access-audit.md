---
id: bedrock-dev-model-access-audit
status: shipped
rank: null
type: infra
notes: "5 modelIds returned ValidationException/AccessDeniedException on dev — verify Bedrock model access for sonnet-4-7, opus-4-7, nova-premier, llama3-3, mistral."
references: []
out_of_scope:
  - "Re-running the per-task benchmark sweeps with the corrected IDs (user-triggered via /benchmark-agents — has real Bedrock $ cost)"
  - "Requesting model access for sonnet-4-7 / opus-4-7 (user opted to drop these from sweep coverage rather than request)"
spec: null
plan: null
topic_memory: []
validation_gate: "Canonical IDs verified via `aws bedrock list-inference-profiles --region us-east-1` against account 771924376645 (all 5 replacements ACTIVE). sonnet-4-7 + opus-4-7 dropped (not granted; user-confirmed 2026-05-20). nova-premier / llama3-3 missing `us.` cross-region prefix → fixed. mistral-large-2407 nonexistent → swapped for `us.mistral.pixtral-large-2502-v1:0` (only Mistral large in inference profiles). Pricing manifest aligned; node sanity script confirms all 8 unique bench modelIds resolve to a pricing entry."
---

# Bedrock dev account model access audit

Surfaced 2026-05-19 during `agent-benchmark-skill` full sweep. 5 sweep modelIds returned errors on the dev account (`771924376645`, `us-east-1`):

| modelId | error |
|---|---|
| `us.anthropic.claude-sonnet-4-7` | ValidationException |
| `us.anthropic.claude-opus-4-7` | AccessDeniedException |
| `amazon.nova-premier-v1:0` | ValidationException |
| `meta.llama3-3-70b-instruct-v1:0` | ValidationException |
| `mistral.mistral-large-2407-v1:0` | ValidationException |

`ValidationException` typically means the inference-profile id form is wrong (e.g. AWS shifted the suffix); `AccessDeniedException` means the model access isn't granted on this account. Both block the benchmark sweep from including these models.

## Cheapest next step

1. `AWS_PROFILE=nestfolio-dev aws bedrock list-foundation-models --region us-east-1 --query 'modelSummaries[].[modelId,modelName,providerName,inferenceTypesSupported]' --output table` — pin the canonical id forms.
2. For each of the 5 above, identify whether (a) the id form changed or (b) access not granted.
3. In Bedrock console → Model access → request access for any still-locked models.
4. Update `scripts/benchmark-agents/tasks/*.bench.ts` modelIds to the canonical forms.
5. Re-run the affected sweeps and re-write the per-task evaluations.

Promoted 2026-05-20: user opted to expand benchmark coverage to multi-vendor as part of the agent-benchmark follow-up wave.

## 2026-05-20 — Shipped

Replacement map (verified ACTIVE via `aws bedrock list-inference-profiles` on dev account `771924376645`):

| Original failing | Cause | Replacement |
|---|---|---|
| `us.anthropic.claude-sonnet-4-7` | not granted | `us.anthropic.claude-sonnet-4-6` |
| `us.anthropic.claude-opus-4-7` | not granted | `us.anthropic.claude-opus-4-6-v1` |
| `amazon.nova-premier-v1:0` | missing `us.` prefix | `us.amazon.nova-premier-v1:0` |
| `meta.llama3-3-70b-instruct-v1:0` | missing `us.` prefix | `us.meta.llama3-3-70b-instruct-v1:0` |
| `mistral.mistral-large-2407-v1:0` | nonexistent | `us.mistral.pixtral-large-2502-v1:0` |

User opted not to request access for sonnet-4-7 / opus-4-7 — they're substituted with 4-6 in all sweep coverage. Sonnet-4-7 entries previously duplicated 4-6 (same pricing class, no real comparison value); the 4-7 row is simply removed from each task's model list rather than requesting access.

Files touched:

- `scripts/benchmark-agents/pricing.manifest.json` — dropped 4-7 rows, replaced `mistral-large-2407` with `pixtral-large-2502`.
- `scripts/benchmark-agents/tasks/{user-goals,risk-assessment,portfolio-construction,rebalance-planner,explainability,market-research}.bench.ts` — all 6 model lists updated.

Re-running the sweeps with the corrected IDs is a separate user-triggered action via `/benchmark-agents` — it has real Bedrock cost and the 2026-05-19 cross-task-report.md is still valid for the models that did sweep successfully.

## Cross-reference

- The 2026-05-19 cross-task-report.md flags these as "unavailable on dev" rows.
- Related: `agent-benchmark-market-research-sweep` (the OTHER 2026-05-19 sweep gap, different cause).
