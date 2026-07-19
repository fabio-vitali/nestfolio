---
id: claude-md-service-cards-stale-test-enumerations
status: parking
type: tooling
notes: "17 service CLAUDE.md cards have stale test-file enumerations / omitted DDB entities — a shared card-generator gap, not 17 independent edits."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Service CLAUDE.md cards have stale test-file enumerations across 17 services

A cross-cutting staleness pattern found across 17 service `CLAUDE.md` cards (warning severity, not
wiring/contract errors — see the separate hard-fail items
[[service-inventory-fabricated-event-names]],
[[market-intelligence-ctrl-kbingestion-unwired-claude-md]],
[[investor-bff-claude-md-fabricated-deposit-withdrawal-events]],
[[onboarding-bff-claude-md-drift]] for those): `advisory-bff/CLAUDE.md:94-104` (4 missing test
files) and `:111-116` (omits `UserInteraction` DDB entity); `decision-workflow-ctrl/CLAUDE.md:108-118`
(5 missing test files); `compliance-ctrl/CLAUDE.md:~62-69` (4 missing test files);
`advisory-narrative-ctrl/CLAUDE.md:77-85` (undercounts test files); `broker-ctrl/CLAUDE.md:74-84`
(3 missing test files) and `:97-100` (omits `BrokerOrder` DDB entity);
`broker-alpaca-adpt/CLAUDE.md:87-98` (2 missing test files) and `:104-110` (omits `CircuitBreaker`
DDB entity); `broker-sim-adpt/CLAUDE.md:44-48` (omits 2 unit tests + a whole integration-test
entry) and `:56-60` (omits `VirtualCashBalance`, `VirtualPosition`, `VirtualSnapshot`);
`dashboard-bff/CLAUDE.md:52-64` (3 missing test files); `investor-ctrl/CLAUDE.md:71-78` (3 missing
tests + a self-contradictory stale description of a removed diff-detect handler);
`ledger-ctrl/CLAUDE.md:59-77` (2 missing test files) and `:28-37` (omits `ShadowFillService` from
Handlers section); `ledger-bff/CLAUDE.md:53-63` (2 missing test files);
`reconciliation-ctrl/CLAUDE.md:44-50` (1 missing test file). Nearly every sampled service (except
`execution-ctrl` and `ledger-adpt`, which are clean) shows the same stale-test-enumeration shape,
most commonly missing `domain/contracts.test.ts` and `publisher-schemas.test.ts` — suggesting a
shared CLAUDE.md card-generator gap rather than independent drift. Cheapest next step: fix the
generator (or its invocation cadence) rather than hand-patching each card.
