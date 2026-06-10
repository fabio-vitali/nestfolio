---
id: broker-alpaca-real-paper-leak
status: parking
type: bug
notes: "broker-alpaca integration/e2e can hit the REAL Alpaca paper API unintentionally via two vectors: (1) the Parameters-and-Secrets extension caches the baseUrl SSM param (~300s TTL), so a warm broker-alpaca Lambda can serve the real paper-api URL right after a test's SsmOverrideFixture sets the mock (and the fixture restoreTo is the real paper-api); (2) the long-lived Order/Transfer polling Step Functions outlive a test and poll the (restored) real paper-api. Root-caused the 2026-04-10 real-paper dashboard operation; corroborated by the 2026-04-11 'cold-start paper-only safety guard' commit. The typed-subject-contracts-execution e2e gate added a best-effort orphaned-poll-SF teardown as partial mitigation. Promote when hardening broker-alpaca test isolation / before relying on it in CI."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# broker-alpaca integration/e2e can leak real Alpaca paper calls

Root-caused 2026-06-10 while answering "what triggered the April-10 Alpaca paper operation"
during `typed-subject-contracts-execution`.

## What

The deployed broker-alpaca-adpt's default `baseUrl` SSM param is `https://paper-api.alpaca.markets`
(the REAL paper API). Two leak vectors against it:

1. **Warm-Lambda SSM cache.** The `AlpacaClient` reads `baseUrl` via the Parameters-and-Secrets
   Lambda extension, which caches SSM values (~300s TTL). The broker-alpaca integration test
   (`SsmOverrideFixture`, added ~2026-04-10) overrides `baseUrl` to a mock with
   `restoreTo: 'https://paper-api.alpaca.markets'`. A warm Lambda can serve the cached/real URL
   for the first request(s) after the override, or after the restore — hitting real paper.
2. **Orphaned polling Step Functions.** An order/transfer that reaches
   `ALPACA_ORDER_PLACED`/`ALPACA_TRANSFER_INITIATED` starts a long-lived polling SF (transfer
   backoff capped at 4h). The test ends, the fixture restores `baseUrl` to real paper, and the
   still-running SF's next poll cycle hits the real Alpaca paper API.

Corroborated by the 2026-04-11 `52614306 feat(broker-alpaca-adpt): cold-start paper-only
safety guard` (added right after the integration tests + PR-sandbox integration runs — the
guard refuses non-paper URLs but PERMITS paper, so it does not stop these paper operations).

## Partial mitigation already in place

The `typed-subject-contracts-execution` e2e gate
(`apps/e2e-feature-tests/src/execution/execution-contract-emission.e2e.test.ts`) runs
`alpacaPaperReset` in beforeAll+afterAll and a best-effort orphaned-poll-SF `StopExecution`
teardown. That covers the e2e gate; the **integration** test leak is unaddressed.

## Fix direction

- Flush/disable the Parameters-and-Secrets cache (or set a 0 TTL) in the test config, or have
  `SsmOverrideFixture` wait out the cache TTL before submitting.
- Stop orphaned polling SF executions in the integration test teardown (as the e2e gate does).
- Consider a deploy-time/test-time guard that points dev broker-alpaca at the mock by default
  rather than real paper, flipping to real only for explicit real-Alpaca scenarios.

See [[project_event_subject_contracts]].
