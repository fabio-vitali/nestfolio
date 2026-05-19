---
id: bedrock-dev-model-access-audit
status: parking
type: infra
notes: "5 modelIds returned ValidationException/AccessDeniedException on dev — verify Bedrock model access for sonnet-4-7, opus-4-7, nova-premier, llama3-3, mistral."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
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

Promote when there's appetite to complete the multi-vendor benchmark or when a follow-on workstream depends on one of these models (e.g. Llama 3.3 for explainability, sonnet-4-7 as an opus-4-6 alternative for portfolio-construction).

## Cross-reference

- The 2026-05-19 cross-task-report.md flags these as "unavailable on dev" rows.
- Related: `agent-benchmark-market-research-sweep` (the OTHER 2026-05-19 sweep gap, different cause).
