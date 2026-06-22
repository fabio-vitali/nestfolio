---
id: test-integration-parallel-dns-exhaustion
status: parking
type: tooling
notes: "run-many -t test-integration at full parallelism exhausts the macOS DNS resolver (getaddrinfo ENOTFOUND on DDB endpoints) → false reds; recovers fully at --parallel=1."
references: []
out_of_scope: []
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

## Evidence (2026-06-22, deploy-tooling-integrity epic E6 batched integration run)

- First run (full parallelism): 8 suites red, **27** `ENOTFOUND` occurrences across the run.
- Re-run of the same 8 suites at `--parallel=1`: **0** `ENOTFOUND`; every DNS-failing suite recovered
  to green (alpha-vantage 2/2, broker-alpaca 10/10, ledger-bff, dashboard-bff). The only persistent
  reds at `--parallel=1` were 4 advisory ctrls failing for an unrelated agent-availability reason
  (already tracked: `advisory-market-data-adapters-fetch-cdc-empty-buffer`,
  `advisory-narrative-memory-read-latency`, the `*-flake` items).

So this masks real signal in the `/backlog-next-epic` E6 batched gate and any `run-many`
integration sweep, and forces expensive full re-runs to disambiguate environmental from real reds.

## Cheapest next step

Cap the integration `run-many` parallelism (e.g. `--parallel=3-4`) for `test-integration` — in the
nx target default and/or the epic-orchestrator E6 invocation — and/or add a bounded DNS-retry /
HTTP keep-alive to the AWS SDK client setup in the `integration-testing` harness so a transient
`getaddrinfo` retries instead of failing the assertion. Needs a regression signal (a high-parallel
sweep that no longer ENOTFOUNDs).

Shares a loose "test/CI tooling reliability" root with `ci-pipeline` and the per-test `*-flake`
orphans — candidate for a test-infra-reliability theme on the next `/backlog-themes` sweep (distinct
root cause from the per-test races, so not force-clustered here).
