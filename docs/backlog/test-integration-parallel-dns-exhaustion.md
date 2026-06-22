---
id: test-integration-parallel-dns-exhaustion
status: shipped
closed: 2026-06-23
type: tooling
notes: "run-many -t test-integration at full parallelism exhausts the macOS DNS resolver (getaddrinfo ENOTFOUND) → false reds; recovers at --parallel=1. Fix: a process-wide dns.lookup retry (installDnsResilience) installed once per worker from the integration Jest setup — covers AWS SDK + fetch uniformly at the DNS layer."
references:
  - libs/test-support/src/dns-resilience.ts
  - libs/integration-testing/src/jest.integration.setup.ts
out_of_scope:
  - "Capping run-many --parallel (nx target default `parallelism` and/or the /backlog-next-epic E6 invocation). Symptom suppression, not the root cause; the DNS-layer retry made it unnecessary (0 ENOTFOUND at --parallel=16)."
  - "The per-test `*-flake` races and advisory agent-availability reds (advisory-market-data-adapters-fetch-cdc-empty-buffer, advisory-narrative-memory-read-latency). Distinct root cause from DNS-resolver exhaustion; separately tracked."
  - "Product (non-test) AWS SDK client configuration in service Lambda handlers. installDnsResilience patches dns.lookup ONLY inside the integration Jest worker (via jest.integration.setup.ts); product runtime is untouched."
  - "Wiring DNS resilience into the e2e suites (apps/e2e-feature-tests, nestfolio-e2e). They have their own setup and were not part of this gate; a separate item if e2e ever shows DNS exhaustion."
  - "ci-pipeline work (the CI integration-test stage). Shares a loose test-infra-reliability root but is a separate workstream."
spec: null
plan: null
topic_memory: []
validation_gate: "Shipped on worktree-test-integration-dns-exhaustion (commits 77bc7422→308dae3f, single PR). Fix: process-wide dns.lookup + dns.promises.lookup retry (installDnsResilience in libs/test-support/src/dns-resilience.ts; 5 attempts, jittered backoff on getaddrinfo ENOTFOUND/EAI_AGAIN) installed once per worker via libs/integration-testing/src/jest.integration.setup.ts. Evidence: (1) unit tests dns-resilience.test.ts — retries transient, ignores non-transient, restores; (2) propagation probe — patching dns.lookup fires for BOTH https (AWS SDK) and global fetch/undici; (3) gated e2e fault-injection probe dns-resilience.e2e-probe.test.ts (DNS_E2E_PROBE=1) drives a REAL https request through the actual lib past 2 injected getaddrinfo ENOTFOUNDs and connects; (4) install banner confirmed firing in a live broker-sim-adpt integration run; (5) full nx run-many -t test-integration across 23 services = 0 getaddrinfo ENOTFOUND at BOTH nx-default AND --parallel=16 (vs 272 at --parallel=16 pre-fix), with prior DNS victims decision-workflow-ctrl 20/20 and ledger-bff 11/11 now green; (6) 6.2 affected test+lint green across 32 projects. Only remaining reds are the pre-existing/tracked 4 advisory agent-availability ctrls + dashboard-bff blockReason drift — 0 ENOTFOUND, not DNS."
---

# test-integration: false reds from DNS-resolver exhaustion under full parallelism

`nx run-many -t test-integration` at the default (high) parallelism intermittently fails with
`getaddrinfo ENOTFOUND <host>.us-east-1.amazonaws.com` — the macOS DNS resolver is exhausted when
~20 integration suites (each a separate Jest worker process) fire their first AWS requests at once.
These are **false reds in the test runner's own AWS access**, not product code.

## Promotion (2026-06-22)

Promoted out of parking and worked directly (not deferred to a `/backlog-themes` cluster): it is
**actively masking real signal** in the `/backlog-next-epic` E6 batched gate and every `run-many`
integration sweep. The DNS-exhaustion root cause is distinct from the per-test races, so clustering
would only have filed paperwork — it would not have stopped the false reds.

## Evidence (2026-06-22, deploy-tooling-integrity epic E6 batched integration run)

- First run (full parallelism): 8 suites red, **27** `ENOTFOUND` occurrences across the run.
- Re-run at `--parallel=1`: **0** `ENOTFOUND`; every DNS-failing suite recovered to green. The only
  persistent reds were 4 advisory ctrls + dashboard-bff for unrelated, already-tracked reasons.

## Root cause

Under high parallelism, ~20 worker processes flood the macOS resolver with concurrent `getaddrinfo`
lookups; the resolver transiently returns `ENOTFOUND` / `EAI_AGAIN`. The AWS SDK's retry strategy
does **not** classify `getaddrinfo` failures as retryable, so a transient blip fails the assertion
instead of retrying. (Connection keep-alive is already the SDK default, so pooling was not the gap.)

## Approach (DNS-layer retry) — and the path to it

The fix retries transient name-resolution failures with jittered backoff. A `getaddrinfo` failure
means the request never left the machine, so retrying is always safe.

Two intermediate approaches were measured and rejected before landing on the DNS layer:

1. **Shared keep-alive SDK client config** — measurement showed `@smithy/node-http-handler` already
   defaults to `keepAlive: true`, and a shared agent both helps little (Jest runs each suite in a
   separate process) and introduces a `client.destroy()` lifecycle hazard. Dropped.
2. **Per-SDK-client retry middleware** (`createTestAwsClient`) — worked for fixture SDK clients, but
   is **incomplete by construction**: it cannot cover the `AppSyncClient`'s raw SigV4 `fetch` (not an
   SDK client) nor SDK clients constructed directly in service test files (e.g. `SFNClient` in
   decision-workflow-ctrl). A high-parallel sweep still red on `states.*` (SFN) and `appsync-api.*`.
   It also surfaced that under Jest's VM realms `@smithy/middleware-retry` re-wraps the error so
   `.code`/`.syscall` are lost. Dropped.

**Final, shipped:** a process-wide `dns.lookup` / `dns.promises.lookup` retry — `installDnsResilience()`
in `libs/test-support/src/dns-resilience.ts`, installed once per worker from
`libs/integration-testing/src/jest.integration.setup.ts`. `node:net`'s `connect` resolves `dns.lookup`
at call time, so the patch transparently covers **every** AWS access path — SDK clients
(`https → net.connect`), global `fetch`/undici, and any directly-constructed or future client — with
no per-client wiring and no regression risk. This is the reusable, liftable pattern (any AWS-SDK test
harness can `installDnsResilience()`).

## Validation gate

A high-parallelism `nx run-many -t test-integration` sweep that no longer emits any
`getaddrinfo ENOTFOUND`. **Met** — see `validation_gate` frontmatter for the full evidence chain.
