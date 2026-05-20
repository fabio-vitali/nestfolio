---
id: benchmark-agents-pricing-region-fallback
status: queued
rank: 1
type: bug
notes: "refresh-pricing fails when AWS publishes pricing only in us-west-2 (e.g. claude-opus-4-1-20250805)"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# benchmark-agents: Pricing API us-west-2 fallback

Surfaced during the 2026-05-20 manual gate of `/benchmark-agents` dynamic model discovery (Task 15 of `docs/superpowers/plans/2026-05-20-benchmark-agents-dynamic-model-discovery.md`).

`scripts/benchmark-agents/refresh-pricing.ts` filters `regionCode = us-east-1`. For `us.anthropic.claude-opus-4-1-20250805-v1:0` the AWS Pricing API only publishes records under `regionCode = us-west-2` — the script hits `PICKER ERROR: missing on-demand input record` and exits non-zero.

Verified via:
```
aws pricing get-products --service-code AmazonBedrockFoundationModels --region us-east-1 \
  --filters 'Type=TERM_MATCH,Field=servicename,Value=Claude Opus 4.1 (Amazon Bedrock Edition)'
# → returns PriceList with regionCode = us-west-2 only
```

**Cheapest next step:** when `getProducts(modelId, us-east-1)` returns zero records, retry with `regionCode = us-west-2` before declaring `unresolved`. Record the actual region in `PricingEntry` (extend `PricingEntry` with `regionCode`) so the consumer can flag cross-region pricing in evaluation reports.

Not blocking the dynamic-discovery ship — the manual gate validated discovery for 9/10 modelIds. The narrative tier just loses Opus 4.1 (an older model, not a candidate for production swap anyway).
