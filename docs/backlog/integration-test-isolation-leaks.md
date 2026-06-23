---
id: integration-test-isolation-leaks
status: parking
type: epic
notes: "Integration runs aren't cleanly isolated — an incomplete test/prod (or cross-test) discriminator lets test events/identity bleed. Theme epic, 2 members. Caveat: the ip-ctrl userid-mismatch mechanism is unresolved; clustered on its leading contamination hypothesis."
done_when: "Each in-scope test-isolation leak is closed — SYSTEM-tenant test events no longer emit the production source (a test/prod discriminator that covers non-`integ-` tenants), and the IP-ctrl snapshot foreign-userId contamination is root-caused and eliminated; both members shipped or dropped."
scope: "Integration runs whose test/prod (or cross-test) isolation discriminator is incomplete, so test events or identity bleed: the CDC source-tag heuristic misses SYSTEM-tenant test events (they emit the production source and leak to prod consumers), and a foreign `ctx.userId` row contaminates an exact-pk IP-ctrl snapshot read."
out_of_scope:
  - "Warm-cache SSM override isolation (ssm-override-warm-cache-test-isolation) — a distinct isolation mechanism (Parameters-and-Secrets cache TTL), already its own theme"
  - "Async-timing flakes (integration-test-timing-fragility) — slow/racy reads of eventually-consistent state, not wrong-data bleed"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Integration-test isolation leaks

Root cause: an integration run's test/prod (or cross-test) isolation discriminator is incomplete, so test-originated events or identity bleed past the boundary they should be confined to. Honest caveat — the two members have different mechanisms (a CDC source-tag heuristic vs an unresolved foreign-userId contamination), and the userid-mismatch is clustered on its *leading* hypothesis (test-isolation contamination) rather than a proven cause; what binds them is the "test data/identity escapes its isolation boundary" trigger. Distinct from the warm-cache SSM theme (a different isolation mechanism).

Members (derived from `epic:` pointers):
- `cdc-system-tenant-source-tag-test-leak` (changeDataCapture tags source by `tenantId.startsWith('integ-')`, so SYSTEM-tenant test events emit the PRODUCTION source → prod consumers fire their agents on test data)
- `ip-ctrl-integration-snapshot-userid-mismatch` (deterministic: an exact-pk InvestorProfileSnapshot read returns a row carrying the run's `ctx.userId` instead of the test's local userId — mechanism unresolved; contamination is the leading candidate)
