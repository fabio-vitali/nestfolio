---
id: integration-test-timing-fragility
status: parking
type: epic
notes: "Integration tests race AWS eventual-consistency / cold-start without robust synchronization → flakes; the polling audit is the systemic poll→subscribe direction. Theme epic, 4 members."
done_when: "Each in-scope integration-test timing fragility is removed — cold-start-tail / EB-rule-propagation / cross-test-seed races are eliminated by robust wait/synchronization (warm-up, subscription-based waits, or explicit per-test guards) rather than longer timeouts, and the OrphanReaper VM-teardown race is fixed; all members shipped or dropped."
scope: "Integration tests that assert on eventually-consistent async state (Lambda cold-start tail, EventBridge rule-propagation, cross-test CDC seed lag) through fragile polling/wait mechanisms, so timing variance flakes them; plus the systemic poll→subscribe direction for the test-infra wait primitives."
out_of_scope:
  - "Test-isolation / contamination leaks (integration-test-isolation-leaks) — wrong DATA bleeding across the test/prod or cross-test boundary, not a timing flake"
  - "Warm-cache SSM override isolation (ssm-override-warm-cache-test-isolation) — a distinct isolation cause (Parameters-and-Secrets cache TTL)"
  - "Unit-suite CDK bundling slowness (integration-suite-lever-5-cdk-bundling) — suite wall-clock performance, not async-timing flake"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Integration-test timing fragility

Root cause: integration tests assert on eventually-consistent async state — a Lambda cold-start tail under high parallelism, EventBridge rule-propagation eventual consistency, or a cross-test CDC seed that hasn't settled — and they synchronize via fragile polling / fixed timeouts rather than robust wait or subscription primitives, so ordinary timing variance flakes them. The honest caveat: the per-case fixes differ (collapse traps; warm-up + budget; add an explicit wait guard; replace a poll with a subscription), but they share the cause "racing AWS eventual consistency without robust synchronization," and the polling audit is the systemic direction whose harness work (robust waits / `@aws_subscribe`-based test subscriptions) would drain several at once.

Members (derived from `epic:` pointers):
- `integration-deep-coldstart-flakes-post-trap-hardening` (umbrella: residual cold-start-tail flakes A/B/C after trap-empty hardening + the OrphanReaper Jest VM-teardown race D)
- `investor-bff-updateoperatingmode-integration-seed-flake` (fires updateOperatingMode with no wait for the prior test's eventually-consistent Mandate seed → InvalidState; body explicitly asks to cluster here)
- `broker-alpaca-adpt-resilience-trap-collapse` (2 EventBusTrap rules in beforeAll → EB-rule-propagation anti-pattern; pre-emptive collapse to 1 trap / 2 detailTypes)
- `test-infrastructure-polling-audit` (systemic audit: app code clean; 12 polls should become subscriptions + a WSS test harness — the poll→subscribe direction for the wait primitives)
