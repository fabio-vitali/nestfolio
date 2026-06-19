---
id: live-push-broadcast-coverage
status: parking
type: epic
notes: "AppSync @aws_subscribe broadcast delivery has no integration/e2e coverage and no reusable harness; live-push paths stay unit-only. Theme epic, 2 members."
done_when: "A reusable test-support harness asserts @aws_subscribe broadcast delivery AND the dashboard live-push path has an end-to-end assertion; both members shipped or dropped."
scope: "Test coverage of AppSync @aws_subscribe broadcast / live-push delivery — the missing test-support harness and the live-push paths currently only unit-covered."
out_of_scope:
  - "Fixture-shape bugs that incidentally zero out live-push coverage (advisory-bff-decision-publisher-proposedtrade-shape-mismatch, homed under untyped-fixture-contract-drift)"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Live-push broadcast coverage

Root cause: the AppSync @aws_subscribe broadcast (Broadcaster construct) delivery path has no integration- or e2e-level assertion — there is no reusable test-support harness to assert a broadcast actually delivers, so live-push paths (e.g. dashboard KPI cards updating without refresh after a deposit/fill) stay unit-only. Fix pattern: build a wss/@aws_subscribe assertion harness in test-support, then add the dashboard live-push e2e scenario on top.

Members (derived from `epic:` pointers):
- `wss-subscription-test-harness-test-support` (the enabling harness)
- `dashboard-portfolio-summary-live-push-e2e-scenario` (coverage gap on top of it)
