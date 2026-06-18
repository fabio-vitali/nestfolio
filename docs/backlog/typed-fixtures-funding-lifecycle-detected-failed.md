---
id: typed-fixtures-funding-lifecycle-detected-failed
status: parking
type: refactor
notes: "CORE follow-on: register + migrate the remaining broker-ctrl funding-lifecycle consumer fixtures (DEPOSIT_DETECTED ×4 files, DEPOSIT_FAILED ×1) — same FundingSnapshotSchema as DEPOSIT/WITHDRAWAL_SETTLED. Part of the epic's 'all ~290 sites migrated' done_when."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
epic: typed-test-fixtures
epic_role: core
---

# Migrate the remaining broker-ctrl funding-lifecycle consumer fixtures (DETECTED / FAILED)

Split-out follow-on from [[typed-test-fixtures-cross-domain-consumer-migration]] (which migrated only
the `*_SETTLED` pair). The broker-ctrl FundingEvent CDC emits the full lifecycle
(DEPOSIT_REQUESTED/DETECTED/SETTLED/FAILED, WITHDRAWAL_REQUESTED/SETTLED/FAILED) — all with the same
producer-owned `FundingSnapshotSchema` (`execution-adpt/src/domain/contracts.ts:17`). The SETTLED pair
is now registered + migrated; the still-legacy siblings with literal-`detailType` consumer putEvent
sites (verified 2026-06-19):

- `DEPOSIT_DETECTED` — 4 test files (incl. investor-bff integration `__version`-monotonic test)
- `DEPOSIT_FAILED` — 1 test file

(`DEPOSIT_REQUESTED` / `WITHDRAWAL_REQUESTED` / `WITHDRAWAL_FAILED` had 0 literal putEvent sites at
file time — register only if/when a consumer fixture appears.)

## Done when

`DEPOSIT_DETECTED` + `DEPOSIT_FAILED` (and any other lifecycle sibling with a consumer fixture) are
registered in `brokerCtrlEventSubjects` against `FundingSnapshotSchema` (+ the JSON allowlist +
`registry.test.ts` EXPECTED), and their consumer `putEvent({ detail })` sites are migrated to the
typed `subject:`/`context:` form. Same mechanism + co-wrong-fixture vigilance as the SETTLED pair —
NB the [[ledger-ctrl-funding-reducer-depositid-vs-transferid]] reducer bug applies to the whole
funding lifecycle, so honest DETECTED/FAILED fixtures may surface the same balance gap.

Promote when continuing the cross-domain consumer migration, or alongside the rank-4
[[check-typed-fixtures-dynamic-detailtype-gap]] work.
