---
id: ssm-override-warm-cache-test-isolation
status: parking
type: epic
notes: "Warm-Lambda Parameters-and-Secrets SSM cache (+ override/restore state) defeats SsmOverrideFixture → real-API leak + resilience-trap misses. Theme epic, 2 members."
done_when: "A warm Lambda can no longer serve restored/real SSM param values mid-test (cache-bust or fixture-aware invalidation), so SsmOverrideFixture isolation holds; both members shipped or dropped."
scope: "Test-isolation failures rooted in the Parameters-and-Secrets extension's SSM cache TTL (~300s) / override-restore state surviving across a test boundary on a warm Lambda."
out_of_scope:
  - "Long-lived polling Step Functions outliving a test (a separate teardown concern, even where co-filed in the same member)"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# SSM-override warm-cache test isolation

Root cause: the Parameters-and-Secrets Lambda extension caches SSM params (~300s TTL), so a warm Lambda keeps serving the pre-override (or restored real) value right after a test's SsmOverrideFixture sets the mock — causing a real-API leak (broker-alpaca real paper) and resilience-trap misses (advisory-narrative EXPLANATION_GENERATED trap times out). Fix pattern: cache-bust / fixture-aware invalidation so override+restore actually take effect on a warm Lambda.

Members (derived from `epic:` pointers):
- `broker-alpaca-real-paper-leak` (SSM-cache vector; the co-filed polling-SF vector is out of scope here)
- `advisory-narrative-resilience-cdc-trap-miss`
