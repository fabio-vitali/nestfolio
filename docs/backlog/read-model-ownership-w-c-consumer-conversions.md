---
id: read-model-ownership-w-c-consumer-conversions
status: shipped
rank: 4
type: refactor
notes: "WS-C of read-model-ownership-producer-aggregates: convert the CLEAN consumer projections to projectVersioned keyed on upstream __version + register Projection<'P1'> — DWC LedgerSnapshot/InvestorProfileSnapshot/MarketSnapshot mirrors, dashboard-bff TimeTravelAvailability. Includes R4 per-service scoping drift-checker refinement (prereq for the Market/IP mirror P1 registrations). Documents Mandate fan-out contract in doc §9. MandateSnapshot (compliance-ctrl + DWC) SPLIT OUT 2026-06-02 → read-model-ownership-mandate-projection-fix (blocked on an investor-bff producer fix — see body)."
references:
  - "docs/superpowers/specs/2026-06-01-read-model-ownership-producer-aggregates-design.md"
spec: null
plan: "docs/superpowers/plans/2026-06-02-read-model-ownership-w-c-consumer-conversions.md"
topic_memory: [project_read_model_redesign.md]
out_of_scope:
  - "The mandatory-error drift-checker upgrade + exclusion registry (WS-D) — WS-C adds only the per-service R4 scoping needed to register same-typename-two-roles rows."
  - "MandateSnapshot P1 conversion (compliance-ctrl + DWC mandate-projector) — split out to read-model-ownership-mandate-projection-fix 2026-06-02. Blocked: OPERATING_MODE_CHANGED is CDC'd from the InvestorProfile row (a different __version counter + partial payload), not the Mandate row, so a single-version-line full-row P1 projection is impossible without an investor-bff producer fix."
  - "Real-LLM e2e — deferred to the single program-end consolidated pass at WS-D (2026-06-02 user cadence decision). WS-C's gate is the cheap set only: test,lint + per-service typecheck + event-processor:read-model-drift + test-integration (mocked agents) + the dev deploy."
validation_gate: |
  Cheap gate (real-LLM e2e deferred to WS-D consolidated pass per 2026-06-02 cadence decision):
  - tools/check-read-model-drift.test.mjs: 18/18 (node --test).
  - pnpm nx affected -t test,lint --base=origin/main: 28 projects PASS (final whole-branch review). Only lint warnings are pre-existing in untouched libs/integration-testing.
  - pnpm nx run decision-workflow-ctrl:typecheck + dashboard-bff:typecheck: PASS (ownership @ts-expect-error trip-wires fire).
  - pnpm nx run event-processor:read-model-drift: OK, 38 registered typenames, 0 drift. InvestorProfileSnapshot/MarketSnapshot/LedgerSnapshot (DWC) + TimeTravelAvailability (dashboard-bff) registered; R4 silent on the owner(CommandOwned)/mirror(P1) pairs (per-service scoping); MandateSnapshot still INFO (split out).
  - Deploy: bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=decision-workflow-ctrl,dashboard-bff → "Deployment complete. Tier: sandbox, Prefix: dev" (account 771924376645).
  - Integration (deploy+integration gate): the first run surfaced REAL failures — the version-guarded projectVersioned conversions drop events whose fixtures lacked the version field. Root-caused to WS-C; fixed by carrying __version (IP/Market) / lastEventSequence (ledger) on the synthetic events (commit e7024583). Re-run GREEN: decision-workflow-ctrl 20/20 (incl snapshot-projector.integration), dashboard-bff 21/21 (incl dashboard-bff.integration + read-model-projection.integration). NX exit 0.
  - Known non-blocker: investor-profile-ctrl.integration 'materialises an InvestorProfileSnapshot row on INVESTOR_PROFILE_UPDATED' fails deterministically (userId readback integ-profile-user-… vs integ-user-…) — the pre-existing ip-ctrl-integration-snapshot-userid-mismatch (LATER), proven not-WS-C during WS-B; pulled into the affected set only because the root-level tools/ change over-broadens nx affected.
  Commits: 5f558666 (R4 per-service) · 9028eeeb (DWC conversions) · 491d34c2 (DWC P1 reg) · 10b650cc (dashboard conversion) · 89f0ec92 (dashboard P1 reg) · d0d84b42 (doc §9) · 9275c753 (service cards) · e7024583 (integration fixtures).
---

# WS-C — Consumer projectVersioned conversions

> ⚠ **Read-model refactoring item.** Any side-finding required to call this refactoring complete must be **folded into a QUEUED read-model item, never parked in LATER** — see `CLAUDE.md` § "Backlog Discipline" (refactoring-completeness exception).


Workstream C of `read-model-ownership-producer-aggregates` (design § "WS-C").

Sequenced after WS-B (`read-model-ownership-w-b-version-carriage`, rank 3): the
consumer conversions need the upstream `__version` to exist first (`LedgerSnapshot`
excepted — its `lastEventSequence` source already exists).

Conversions (`record()`/`update()`/`project()` → `projectVersioned`, register
`Projection<'P1'>`):

- decision-workflow-ctrl `LedgerSnapshot` (`snapshot-projector.ts`; version =
  `subject.snapshot.lastEventSequence`; no WS-B dependency, but it deploys DWC so it
  rides with the other DWC conversions here rather than the type-only WS-A)
- decision-workflow-ctrl mirrors: `InvestorProfileSnapshot`, `MarketSnapshot`
  (`snapshot-projector.ts`; both already upsert `add:{__version:1}` upstream;
  version = `subject.__version`)
- dashboard-bff `TimeTravelAvailability` (`time-travel-availability.ts`; version =
  `subject.lastEventSequence` from `LEDGER_ENTRY_RECORDED`)

**MandateSnapshot split out** (2026-06-02): the design listed DWC + compliance-ctrl
`MandateSnapshot` here, but `OPERATING_MODE_CHANGED` is CDC'd from the InvestorProfile
row (a different `__version` counter + a partial payload missing level/status/
effectiveDate), not the Mandate row — so a single-version-line full-row P1 projection
is impossible without an investor-bff producer fix. Moved to
`read-model-ownership-mandate-projection-fix` (ranked before WS-D). MandateSnapshot
therefore stays unregistered (drift-checker INFO) after WS-C and is governed by that
follow-up.

Prerequisite refinement: scope drift-checker **R4 per-service** (registry key
becomes `(service, typename)`) so `MarketSnapshot`/`InvestorProfileSnapshot`
(CommandOwned in MI-ctrl/IP-ctrl via WS-A, P1 in DWC's mirror) don't trip the global
same-typename-conflict rule. Document the Mandate fan-out contract (investor-bff
owner of the `Mandate` row; compliance-ctrl + DWC each keep an independent
`MandateSnapshot` copy) in canonical doc §9 — including the operatingMode
cross-row caveat that motivates the split-out item.

Validation gate (cheap set only — real-LLM e2e deferred to WS-D, see out_of_scope):
deploy dev (`--services=decision-workflow-ctrl,dashboard-bff`) + `pnpm nx affected -t
test,lint` + per-service `typecheck` (decision-workflow-ctrl + dashboard-bff) +
`pnpm nx run event-processor:read-model-drift` green + `pnpm nx affected -t
test-integration` (mocked agents).

See [[project_read_model_redesign]].
