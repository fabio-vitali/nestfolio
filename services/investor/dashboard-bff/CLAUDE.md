# dashboard-bff

Domain: investor | Bus: investorBus
Stack: services/investor/dashboard-bff/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
<!-- card-drift:ingress (generated — `nx run event-processor:card-drift -- --fix`) -->
- Ingress: ADVISORY_STATUS_UPDATED, BALANCE_UPDATED, DECISION_APPROVED, DECISION_BLOCKED, DECISION_PACKET_CREATED, DEPOSIT_DETECTED, INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, LEDGER_ENTRY_RECORDED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED, WITHDRAWAL_SETTLED
<!-- /card-drift:ingress -->
- investorBus → dashboard-bff-ingress (SQS → Lambda)
  (Workstream 3: removed ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, PORTFOLIO_DRIFT_DETECTED, and MANDATE_ISSUED — these were the accumulate-based trigger events; replaced by ADVISORY_STATUS_UPDATED which receives advisory-bff's authoritative P3 announcement forwarded via investor-adpt.)

## Transforms
- advisory-status.ts — (Workstream 3; extended WS-4) P3 projection: on ADVISORY_STATUS_UPDATED, calls `projectVersioned('AdvisoryStatus', { pendingDecisionsCount: subject.inFlightCount, generatingCount, failedCount, oldestGeneratingAt }, { version: subject.__version, … })`. Maps producer field `inFlightCount` → read-model `pendingDecisionsCount`; carries WS-4 cycle signals `generatingCount`/`failedCount`/`oldestGeneratingAt` (`?? 0`/`?? null` defaults). No `accumulate`. Returns undefined if `__version` is absent. Reads `tenantId` from the event CONTEXT (`uow.event.context.tenantId`) — the AdvisoryStatus subject is now DRY (identity stripped to RequestContext, `tenantId` absent from subject). advisory-bff NOW exports `AdvisoryStatusSchema` at `@nestfolio/advisory-bff/contracts`; the full `parseSubject` seam conversion (replacing the current inline type on `uow.event.subject`) remains a WS-3/consumer-parse-subject follow-up.
- recent-activity.ts — dispatches DECISION_PACKET_CREATED (and other activity-relevant events) to the activity feed; rows are LIVE-broadcast via publishActivityUpdate → onActivityUpdate. Polymorphic feed (~8 producers); validates via `parseSubject` against a documented consumer-owned all-optional `RecentActivitySchema` (the one sanctioned exception to the producer-contract rule — no single producer owns these display fields).
- investor-snapshot.ts — (Workstream 4) version-guarded P1 projection (`projectVersioned`) of the composite INVESTOR_PROFILE_* payload, validated via `parseSubject(uow, InvestorProfileUpdatedSchema)` from `@nestfolio/investor-bff/contracts`: maps `goal.objective` → `goalType`, `riskProfile.score` → `riskLevel`, plus `operatingMode` and stable `onboardedAt` (from `payload.onboardingCompletedAt`, present on every CDC full-row emit so a full-row write never wipes it), keyed on investor-bff's row `__version`. Returns undefined if `__version` is absent.
- portfolio-summary.ts — version-guarded P1 projection (`projectVersioned`) from the authoritative ledger snapshot on BALANCE_UPDATED / PORTFOLIO_UPDATED, validated via `parseSubject(uow, z.object({ snapshot: LedgerSnapshotSchema }))` from `@nestfolio/ledger-adpt/domain`: writes full row `cashBalanceCents`, `positionCount` (quantity>0 holdings only), `totalValueCents`, keyed on `lastEventSequence` as `__version`. RECONCILIATION_COMPLETED (also routed here) is a deliberate no-op — guarded out before `parseSubject` so it never poison-pills to the DLQ.
- position-snapshot.ts — version-guarded P1 projection, one `projectVersioned('PositionSnapshot', …)` per holding from `snapshot.positions`, validated via `parseSubject(uow, z.object({ snapshot: LedgerSnapshotSchema }))` from `@nestfolio/ledger-adpt/domain`; cents/market-value computed here (snapshot is dollar-denominated), `weightPercent` = holding share of total market value.
- time-travel-availability.ts — (WS-C) version-guarded P1 projection (`projectVersioned('TimeTravelAvailability', …)`) on LEDGER_ENTRY_RECORDED, validated via `parseSubject(uow, LedgerEntryRecordedSchema)` from `@nestfolio/ledger-adpt/domain`; keyed on the contract-guaranteed `lastEventSequence`, `latestDate` derived from the guaranteed `snapshotAt`. Contract violation throws (poison-pill → DLQ).

## Read model (ownership)
- `ReadModelOwnership` registered in `src/read-model-ownership.ts` (side-effect-imported from `handlers/event-listener.ts`):
  - P1 (versioned snapshots via `projectVersioned`): `PortfolioSummary`, `PositionSnapshot`, `InvestorSnapshot`, `TimeTravelAvailability` (`InvestorSnapshot` registered in workstream 4 once investor-bff stamped `__version`; `TimeTravelAvailability` registered in WS-C keyed on `LEDGER_ENTRY_RECORDED.lastEventSequence`; `project()`/`update()` on any of them now fails typecheck)
  - P2 (append-only log via `record`): `Activity`
  - P3 (deferred projection of advisory-bff's authoritative aggregate via `projectVersioned`): `AdvisoryStatus` (registered in workstream 3; `accumulate` now fails typecheck)
- Enforcement: `tsconfig.type-test.json` + nx `typecheck` target compile `test/types/read-model-ownership.type-test.ts` (the `@ts-expect-error` trip-wire); run `pnpm nx run dashboard-bff:typecheck`.
- Dead `SimulationSummary` / `StreamSnapshot` / `upsertPositionSnapshot` repository writers removed (no callers; the live PositionSnapshot path is the `position-snapshot.ts` transform via `projectVersioned`). The `getSimulationSummary` GraphQL query/resolver remains (returns null via its own GetItem). The `PositionSnapshot` row timestamp is the executor-stamped `updatedAt` (the GraphQL field was renamed `lastUpdatedAt`→`updatedAt` to match; `upsertPositionSnapshot` was the lone writer of the old name).
- `DashboardRepository.upsertAdvisoryStatus` is now unused dead code (superseded by the P3 projectVersioned path); a follow-up workstream will remove it.

## Facade
- AppSync GraphQL API (JS Resolvers via discoverJsResolvers)

## MFE Hosting
- MfeBucket (mfeKey=dashboard): S3 bucket "{account}-{prefix}-nestfolio-mfe-dashboard"
  - CloudFront OAC bucket policy (scoped via AWS:SourceArn to investor-web distribution)
  - SSM exports: mfe/bucketName, mfe/key

## SSM Parameters Published
- api/graphqlUrl
- api/realtimeUrl
- mfe/bucketName
- mfe/key

## Handlers
- event-listener.ts — Ingress event handler
- dashboard-publisher.ts — DDB-stream-driven broadcaster: fires publishDashboardUpdate on **AdvisoryStatus**, **PortfolioSummary**, and **InvestorSnapshot** row mutations, publishActivityUpdate on Activity insert, and **publishPositionUpdate on PositionSnapshot row mutations** (all keyed by __typename, falling back to sk). PortfolioSummary broadcasts on INSERT + on whenChanged ['totalValueCents','cashBalanceCents','positionCount'] (gated on the KPI values, not updatedAt). **InvestorSnapshot** broadcasts on INSERT + on whenChanged ['executionMode','operatingMode','goalType','riskLevel','mandateLevel'] — the user-visible display fields only (NOT updatedAt/__version, which change on every projectVersioned write), so a go-live executionMode sim→live flip broadcasts but a no-op rewrite does not; this is the live path for the dashboard execution-mode badge (singleton summary surface → shared Dashboard channel, Approach A). The shared publishDashboardUpdate mutation now carries $advisoryStatus, $portfolioSummary, AND $investorSnapshot (each optional; a broadcast sends only its own surface, the others resolve null and the client ignores them). **PositionSnapshot** broadcasts on INSERT + on whenChanged ['quantity','avgCostBasisCents','currentPriceCents','marketValueCents','unrealizedPnlCents'] — the absolute fields only; `weightPercent` is intentionally excluded (relative, recomputed client-side) and the quantity>0→0 exit is caught by `quantity`. One PositionSnapshot row per holding → a per-symbol delta frame on the dedicated `onPositionUpdate` channel (mirrors the Activity keyed-collection channel); the dashboard-mfe merges by `symbol` (LWW by `updatedAt`) and filters quantity>0. publishPositionUpdate / publishActivityUpdate / publishDashboardUpdate are the three NONE-data-source resolvers registered in `discoverJsResolvers`.

## Tests
- unit/service.stack.test.ts (Broadcaster wiring: DLQ + bisectBatchOnError on the DDB-stream consumer)
- handlers/event-listener.test.ts
- handlers/dashboard-publisher.test.ts
- repositories/dashboard.repository.test.ts
- transforms/advisory-status.test.ts
- transforms/investor-snapshot.test.ts
- transforms/portfolio-summary.test.ts
- transforms/position-snapshot.test.ts
- transforms/recent-activity.test.ts
- transforms/time-travel-availability.test.ts
- test/integration/dashboard-bff.integration.test.ts
- test/integration/read-model-projection.integration.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor
- producer contracts (consumer of zod payload contracts via `parseSubject`):
  - `@nestfolio/investor-bff/contracts` — `InvestorProfileUpdatedSchema` (investor-snapshot.ts)
  - `@nestfolio/ledger-adpt/domain` — `LedgerSnapshotSchema` (portfolio-summary.ts, position-snapshot.ts), `LedgerEntryRecordedSchema` (time-travel-availability.ts)
  - `@nestfolio/advisory-bff/contracts` — `AdvisoryStatusSchema` available (advisory-status.ts currently reads subject via inline type; full parseSubject migration is a WS-3/consumer-parse-subject follow-up)
- producer events/domain (event-name constants + adapter routing): `@nestfolio/investor-bff/events`, `@nestfolio/advisory-adpt/domain`, `@nestfolio/investor-adpt/domain`, `@nestfolio/ledger-adpt/domain`

## DDB Entities
<!-- card-drift:ddb-entities (generated — `nx run event-processor:card-drift -- --fix`) -->
- Activity
- AdvisoryStatus
- InvestorSnapshot
- PortfolioSummary
- PositionSnapshot
- TimeTravelAvailability
<!-- /card-drift:ddb-entities -->
