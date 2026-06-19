---
id: typed-fixtures-funding-lifecycle-detected-failed
status: active
type: refactor
notes: "CORE follow-on: register + migrate the remaining broker-ctrl funding-lifecycle consumer fixtures. Re-verified 2026-06-19 with the gate scanner: DEPOSIT_DETECTED has 5 literal-detailType putEvent sites across 4 files; DEPOSIT_FAILED has 0 consumer fixtures (the earlier 'DEPOSIT_FAILED ×1' was a CDC-emission trap-assertion + a subscription-list assertion, not a putEvent fixture) → DEPOSIT_FAILED deferred under the same register-when-a-fixture-appears rule as the other 0-site funding siblings. Part of the epic's 'all ~290 sites migrated' done_when."
references: []
out_of_scope:
  - "DEPOSIT_FAILED / DEPOSIT_REQUESTED / WITHDRAWAL_REQUESTED / WITHDRAWAL_FAILED registration — 0 consumer putEvent fixtures exist (gate-verified), so they stay unregistered per the workstream's register-only-when-a-fixture-appears rule."
  - "The [[ledger-ctrl-funding-reducer-depositid-vs-transferid]] funding-reducer money bug — a real production bug tracked as its own QUEUED item; this workstream only types fixtures, it does not fix the reducer."
  - "Any production behavior change, deploy, or e2e — static test-fixture migration only (the check-typed-fixtures gate + registry.test are the verification)."
  - "apps/*-mfe component specs + apps/nestfolio-e2e DEPOSIT_DETECTED references — outside the gate's scan roots (services/**, libs/**, apps/e2e-feature-tests/src/**)."
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
epic: typed-test-fixtures
epic_role: core
---

# Migrate the remaining broker-ctrl funding-lifecycle consumer fixtures (DEPOSIT_DETECTED; FAILED deferred — 0 sites)

Split-out follow-on from [[typed-test-fixtures-cross-domain-consumer-migration]] (which migrated only
the `*_SETTLED` pair). The broker-ctrl FundingEvent CDC emits the full lifecycle
(DEPOSIT_REQUESTED/DETECTED/SETTLED/FAILED, WITHDRAWAL_REQUESTED/SETTLED/FAILED) — all with the same
producer-owned `FundingSnapshotSchema` (`execution-adpt/src/domain/contracts.ts:17`). The SETTLED pair
is already registered + migrated.

**Re-verified 2026-06-19** by running the gate scanner (`tools/check-typed-fixtures.mjs`
`scanTree`) with `DEPOSIT_DETECTED`/`DEPOSIT_FAILED` hypothetically registered. The only still-legacy
consumer `putEvent({ detail })` sites are for `DEPOSIT_DETECTED` — **5 sites across 4 files**:

- `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts` (×2)
- `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts` (×1)
- `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts` (×2, incl. the `__version`-monotonic test)

`DEPOSIT_FAILED` has **0** consumer fixtures (its remaining references are a broker-ctrl CDC-emission
`trap.waitForEvent` assertion and a subscription-list assertion — neither is a `putEvent`). So
`DEPOSIT_FAILED` joins `DEPOSIT_REQUESTED` / `WITHDRAWAL_REQUESTED` / `WITHDRAWAL_FAILED` in the
register-only-when-a-fixture-appears bucket. The earlier "DEPOSIT_FAILED — 1 test file" was a
mis-count, reconciled here.

## Done when

`DEPOSIT_DETECTED` is registered in `brokerCtrlEventSubjects` against `FundingSnapshotSchema` (+
`tools/typed-fixture-registered-events.json` + `registry.test.ts` EXPECTED), and its 5 consumer
`putEvent({ detail })` sites are migrated to the typed `subject:`/`context:` form (gate green: 0
violations). Same mechanism + co-wrong-fixture vigilance as the SETTLED pair — NB the
[[ledger-ctrl-funding-reducer-depositid-vs-transferid]] reducer bug applies to the whole funding
lifecycle, so honest DETECTED fixtures may surface the same balance gap (out of scope to *fix* here;
that reducer bug is its own QUEUED item). Any other lifecycle sibling is registered only if/when a
consumer fixture for it appears.
