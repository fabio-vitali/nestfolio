---
id: from-e2elb-remeasure-2026-07-18-dns-enotfound
type: bug
status: parking
done_when: "resolve: During the 2026-07-18 e2elb-c2 re-measurement live run
  (pnpm nx run e2e-feature-tests:test-e2e-features), DNS-resolution failures
  (getaddrinfo ENOTFOUND events.us-east-1.amazonaws.com and
  771924376645.ddb.us-east-1.amazonaws.com) failed advisory-contract-emission,
  execution-contract-emission, and ledger-contract-emission at fixture setup,
  before any Bedrock call. This is exactly the gap
  test-integration-parallel-dns-exhaustion (shipped 2026-06-23) flagged as
  explicitly out of scope: its DNS-layer retry (installDnsResilience) is wired
  into libs/integration-testing/src/jest.integration.setup.ts for
  test-integration only, and its out_of_scope note says 'a separate item if e2e
  ever shows DNS exhaustion' — apps/e2e-feature-tests (and nestfolio-e2e) have
  their own Jest setup and were never wired with the fix. Cause of this specific
  occurrence undetermined (local resolver exhaustion vs transient AWS-side
  issue), but the shipped fix's pattern (installDnsResilience) is a plausible
  cheapest-next-step. Evidence:
  continuity/dogfood/e2e-live-budget/remeasure-2026-07-18.md and
  continuity/evidence/sd-001/dogfooding-ledger.md Entry 13."
provenance:
  from_finding: e2elb-remeasure-2026-07-18-dns-enotfound
---

# from-e2elb-remeasure-2026-07-18-dns-enotfound

During the 2026-07-18 e2elb-c2 re-measurement live run (pnpm nx run e2e-feature-tests:test-e2e-features), DNS-resolution failures (getaddrinfo ENOTFOUND events.us-east-1.amazonaws.com and 771924376645.ddb.us-east-1.amazonaws.com) failed advisory-contract-emission, execution-contract-emission, and ledger-contract-emission at fixture setup, before any Bedrock call. This is exactly the gap test-integration-parallel-dns-exhaustion (shipped 2026-06-23) flagged as explicitly out of scope: its DNS-layer retry (installDnsResilience) is wired into libs/integration-testing/src/jest.integration.setup.ts for test-integration only, and its out_of_scope note says 'a separate item if e2e ever shows DNS exhaustion' — apps/e2e-feature-tests (and nestfolio-e2e) have their own Jest setup and were never wired with the fix. Cause of this specific occurrence undetermined (local resolver exhaustion vs transient AWS-side issue), but the shipped fix's pattern (installDnsResilience) is a plausible cheapest-next-step. Evidence: continuity/dogfood/e2e-live-budget/remeasure-2026-07-18.md and continuity/evidence/sd-001/dogfooding-ledger.md Entry 13.
