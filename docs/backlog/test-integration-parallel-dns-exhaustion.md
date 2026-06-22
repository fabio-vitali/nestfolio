---
id: test-integration-parallel-dns-exhaustion
status: active
type: tooling
notes: "run-many -t test-integration at full parallelism exhausts the macOS DNS resolver (getaddrinfo ENOTFOUND on DDB endpoints) → false reds; recovers fully at --parallel=1. Root cause: test SDK clients open fresh sockets/DNS per request (no connection pooling). Fix: shared keep-alive request handler + bounded getaddrinfo retry in the test-support client config."
references:
  - libs/test-support/src/fixtures/cognito.fixture.ts
  - libs/integration-testing/src/fixtures/table-assertions.ts
out_of_scope:
  - "Capping run-many --parallel (nx target default `parallelism` and/or the /backlog-next-epic E6 invocation). Symptom suppression, not the root cause; only revisit if the high-parallel regression sweep STILL ENOTFOUNDs after the harness fix."
  - "The per-test `*-flake` races and advisory agent-availability reds (advisory-market-data-adapters-fetch-cdc-empty-buffer, advisory-narrative-memory-read-latency). Distinct root cause from DNS-resolver exhaustion; separately tracked."
  - "Product (non-test) AWS SDK client configuration in service Lambda handlers. This workstream touches the integration/e2e test harness clients only."
  - "ci-pipeline work (the CI integration-test stage). Shares a loose test-infra-reliability root but is a separate workstream."
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# test-integration: false reds from DNS-resolver exhaustion under full parallelism

`nx run-many -t test-integration` at the default (high) parallelism intermittently fails with
`getaddrinfo ENOTFOUND <account-id>.ddb.us-east-1.amazonaws.com` — the macOS DNS resolver is
exhausted when ~20 integration suites each open many concurrent DDB / SQS / EventBridge clients
against deployed dev. These are **false reds in the test runner's own AWS clients** (the error is at
`libs/integration-testing/src/fixtures/table-assertions.ts:64 waitForItem`, not in product code).

## Promotion (2026-06-22)

Promoted out of parking and worked directly (not deferred to a `/backlog-themes` cluster): it is
**actively masking real signal** in the `/backlog-next-epic` E6 batched gate and every `run-many`
integration sweep, and the fix is cheap and self-contained. The earlier "candidate for a
test-infra-reliability theme" framing was a defer-to-clustering note; the DNS-exhaustion root cause
is distinct from the per-test races, so clustering would only have filed paperwork — it would not
have stopped the false reds.

## Evidence (2026-06-22, deploy-tooling-integrity epic E6 batched integration run)

- First run (full parallelism): 8 suites red, **27** `ENOTFOUND` occurrences across the run.
- Re-run of the same 8 suites at `--parallel=1`: **0** `ENOTFOUND`; every DNS-failing suite recovered
  to green (alpha-vantage 2/2, broker-alpaca 10/10, ledger-bff, dashboard-bff). The only persistent
  reds at `--parallel=1` were 4 advisory ctrls failing for an unrelated agent-availability reason
  (already tracked: `advisory-market-data-adapters-fetch-cdc-empty-buffer`,
  `advisory-narrative-memory-read-latency`, the `*-flake` items).

So this masks real signal in the `/backlog-next-epic` E6 batched gate and any `run-many`
integration sweep, and forces expensive full re-runs to disambiguate environmental from real reds.

## Root cause

Every test fixture constructs its AWS SDK client as `new XClient({ region })` with **no shared
request handler** — so there is no connection/DNS pooling across the ~12 client sites in
`libs/integration-testing` + `libs/test-support`. Under high parallelism each suite × client ×
request opens fresh sockets → fresh `getaddrinfo` lookups → the macOS resolver is exhausted. The
clients also use the SDK-default retry, which does not reliably retry transient
`getaddrinfo ENOTFOUND`.

## Chosen approach (root-cause harness fix)

A shared, keep-alive-enabled AWS-client config helper in `libs/test-support` (the lower-level lib;
`integration-testing` already depends on it one-way), consumed by every fixture in both libs:

- one process-level keep-alive `https.Agent` (bounded `maxSockets`) injected via a
  `NodeHttpHandler` `requestHandler`, so sockets and resolved DNS are pooled/reused across all test
  SDK clients;
- a bounded retry (`maxAttempts` + a retry strategy that treats transient `getaddrinfo ENOTFOUND`
  as retryable) so a momentary resolver blip retries instead of failing an assertion.

This is the reusable, liftable pattern (any AWS-SDK test harness can adopt it) and keeps full
parallelism fast. Capping `--parallel` is the symptom-suppression alternative and is **out of scope**
unless the regression sweep below still reds.

## Validation gate

A high-parallelism `nx run-many -t test-integration` sweep that no longer emits any
`getaddrinfo ENOTFOUND` (the persistent advisory agent-availability reds, tracked separately, are
expected to remain).
