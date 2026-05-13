---
id: advisory-adpt-from-investor-mandate-issued-sequential-flake
status: shipped
type: bug
notes: "SHIPPED 2026-05-13. Root cause: EventBridge rule-propagation eventual consistency. Trap's canary warmup confirms activation on one EB rule-evaluation partition, but cross-bus forwarded events get evaluated on other partitions that haven't yet seen the new rule — drop silently. CloudWatch per-rule metrics confirmed the failing trap's MatchedEvents=0 for the original event window but matched 55s later when the retry's event fired (same trap, same pattern). Resolution: deleted all 9 integration test files for the 4 pure-forwarder domain adapters (advisory-adpt, investor-adpt, execution-adpt, ledger-adpt) — they verified only deploy-state of an EB rule, which is already covered by CDK snapshot tests + downstream e2e flows. Eliminates the entire flake class permanently."
references:
  - "services/advisory/advisory-adpt/test/service.stack.test.ts"
  - "services/investor/investor-adpt/test/unit/service.stack.test.ts"
  - "services/execution/execution-adpt/test/service.stack.test.ts"
  - "services/ledger/ledger-adpt/test/service.stack.test.ts"
out_of_scope:
  - "Trap fixture EB-rule-propagation hardening — race still affects 3rd-party adapter resilience tests; broker-alpaca-adpt sibling filed in parking."
  - "broker-alpaca-adpt 2-trap pattern — separate concern, 3rd-party adapter, filed under broker-alpaca-adpt-resilience-trap-collapse (parking)."
  - "investor-ctrl-circuit-breaker-notification-flake — same shape but different service class (stateful Lambda), separate dossier."
  - "Production CDK forwarding rules — verified correct, untouched."
spec: null
plan: null
topic_memory: []
validation_gate: "Unit suite (CDK snapshot tests) passes for the 4 domain adapters. `pnpm nx run-many -t test --projects=advisory-adpt,investor-adpt,execution-adpt,ledger-adpt` green. Integration target no longer exists on these 4 services."
---

# advisory-adpt from-investor MANDATE_ISSUED forwarding: cross-file Jest-session flake

## Original symptom (pre-ship)

`advisory-adpt: Investor → Advisory forwarding › should forward MANDATE_ISSUED from InvestorBus to AdvisoryBus` timed out at `EventBusTrap.waitForEvent` with `Captured-but-unmatched buffer: []` — the trap saw zero events. `OPERATING_MODE_CHANGED` exhibited the same pattern intermittently. Same family flake also observed on `investor-adpt: Ledger → Investor forwarding › PORTFOLIO_DRIFT_DETECTED`.

## Root cause (2026-05-13 investigation)

**EventBridge rule-propagation eventual consistency.** When `EventBusTrap.deploy()` creates a fresh trap rule, its canary warmup loop sends `__INTEG_CANARY` events directly to the trap's bus and confirms at least one matches the new rule. This proves the rule is active on **at least one** EB rule-evaluation partition. It does NOT prove the rule is visible on all partitions.

When the real test event is published on the *source* bus and forwarded cross-bus, that forwarded event is evaluated on whichever EB partition the forwarding hits — which may not yet have visibility of the freshly-created destination-side trap rule. Result: forwarded event matches the production forwarding rule (counted in `MatchedEvents`/`Invocations` on the source-bus rule, no `FailedInvocations`), lands on the destination bus, finds no matching rule, drops silently.

### Confirming evidence

| Source | Datum |
|---|---|
| Instrumented repro on dev | OPERATING_MODE_CHANGED in `from-investor.integration.test.ts` reliably fails when `from-execution` runs first in the same Jest session — same flake the dossier described. Retry succeeds because by then the rule has fully propagated. |
| CloudWatch `AWS/Events:MatchedEvents` per RuleName | Failed trap rule `integ-trap-1778662371019-j5k0yp`: MatchedEvents = 1 in the 08:52 minute (the warmup canary), 2 in 08:53 (stray late canary + retry's event). **The original failing event matched zero times.** |
| CloudWatch `AWS/Events:Invocations` on source-bus FromInvestor rule | 4 in 08:52, 1 in 08:53 = 5 matches, 0 FailedInvocations. All 5 PutEvents forwarded successfully — including the failing one. |
| Stray canary observation | A `__INTEG_CANARY` event arrived at the original failed trap's SQS 55 seconds after it was sent during warmup. Confirms the rule eventually became visible on the partition that received that canary — just too late for the 60s test deadline. |

### What WAS NOT the cause

- Stale dev rule pattern — `aws events describe-rule` showed all 4 detail-types correctly deployed
- Forwarding-rule failure — `FailedInvocations=0` on FromInvestor rule, DLQ depth 0
- Cross-file Jest-session state leak (the dossier's original hypothesis) — propagation race holds across files because each file creates its own trap rule
- AWS SDK connection pool leakage
- The `$or` source-filter pattern

## Resolution: delete the 9 domain-adapter integration test files

The 4 domain `{domain}-adpt` services are pure EB rule forwarders — no Lambda handlers, no DDB, no business logic. Their integration tests verified "the deployed EB rule actually forwards." That responsibility is now covered by:

1. **CDK snapshot test** (`test/service.stack.test.ts` per adapter) — verifies the rule pattern, target wiring, DLQ shape, source filter at code level
2. **Deploy success** — CloudFormation refuses to deploy a malformed rule
3. **E2E feature tests** — exercise the full cross-domain flow; downstream consumer arrival is the de-facto verification of forwarding

The integration tests added test-time EB rule churn (creating ephemeral rules then deleting them per test/file) which exposed the propagation race they then complained about. Removing them eliminates both the flake source and the redundant verification.

Deleted:
- 9 `*.integration.test.ts` files across the 4 domain adapters
- 4 `jest.integration.config.js` files
- 4 `test-integration` targets in `project.json`
- 4 empty `test/integration/` directories
- CLAUDE.md cards updated to reflect new test structure

3rd-party `*-adpt` services (broker-alpaca-adpt, broker-sim-adpt, yahoo-finance-adpt, alpha-vantage-adpt, sec-edgar-adpt, fred-adpt, marketwatch-adpt) KEEP their integration tests — they exercise real Lambda handlers and 3rd-party API behavior, not just EB rule shape.

## Validation gate

- `pnpm nx run-many -t test --projects=advisory-adpt,investor-adpt,execution-adpt,ledger-adpt` green (CDK snapshot tests still pass)
- Integration target no longer exists on these 4 services (`nx run advisory-adpt:test-integration` → "task not found")
- `nx run-many -t test-integration --parallel=8` (full CI integration suite) skips the 4 domain adapters cleanly

## Related backlog items

- `broker-alpaca-adpt-resilience-trap-collapse` (parking) — same EB-rule-propagation race could affect 3rd-party adapter resilience tests; promote if observed.
- `integration-trap-empty-family-hardening` (shipped 2026-05-12) — different remedy (jest.retryTimes(1)) that absorbed some of these flakes prior to this fix.
