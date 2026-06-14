# advisory-bff

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/advisory-bff/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
<!-- card-drift:ingress (generated — `nx run event-processor:card-drift -- --fix`) -->
- Ingress: DECISION_CYCLE_FAILED, DECISION_CYCLE_STARTED, DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED
<!-- /card-drift:ingress -->
- advisoryBus → advisory-bff-ingress (SQS → Lambda)
  (WS-2: the two SF-direct cycle-lifecycle events project GENERATING/FAILED onto the DecisionReadModel
  row before any packet exists; the Ingress $or source filter accepts the bare serviceName source.)
  (Workstream 3: DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMATION_REQUESTED, and all 7 SF
  trigger events removed — their effects arrive inside the versioned CDC snapshot, eliminating
  cross-event races by construction.)

## Egress
<!-- card-drift:egress (generated — `nx run event-processor:card-drift -- --fix`) -->
- AdvisoryStatus: ADVISORY_STATUS_UPDATED
- DecisionReadModel: DECISION_READ_MODEL_CREATED, DECISION_READ_MODEL_UPDATED
- UserConfirmation: USER_CONFIRMED
- UserRejection: USER_REJECTED
<!-- /card-drift:egress -->
- CDC: DynamoDB Streams → advisory-bff-egress (Lambda)
  (UserInteraction row is still written but NOT CDC-emitted — USER_INTERACTION_CREATED + USER_INTERACTION_UPDATED were stop-emitted; zero consumers.)

## Facade
- AppSync GraphQL API (Cognito auth via investor user pool SSM; IAM auth also enabled)
  JS Resolvers via discoverJsResolvers
  Pipeline steps:
  - confirmDecision: preStep + extraStep → get-decision-readback.fn.js (reads existing DecisionReadModel to lift taskToken); confirm-decision.fn.js writes ONLY UserConfirmation intent row (PutItem) — no DecisionReadModel write
  - rejectDecision: preStep + extraStep → get-decision-readback.fn.js; reject-decision.fn.js writes ONLY UserRejection intent row (PutItem) — no DecisionReadModel write
  - publishDecisionUpdate → publish-decision-update.fn.js (@aws_iam IAM-only mutation used by decision-publisher)
  (WS-3: getAdvisoryStatus + publishAdvisoryStatusUpdate resolvers removed — the AppSync AdvisoryStatus
  read/subscribe surface had no consumer once advisory-mfe moved to status-routed rendering off
  DecisionReadModel. The AdvisoryStatus aggregate stays, consumed by dashboard-bff via the ADVISORY_STATUS_UPDATED CDC.)

## Handlers
<!-- card-drift:handlers (generated — `nx run event-processor:card-drift -- --fix`) -->
- advisory-status-projector.ts
- decision-publisher.ts
<!-- /card-drift:handlers -->
- event-listener.ts — Ingress handler; dispatches DECISION_PACKET_CREATED + DECISION_PACKET_UPDATED to decisionSnapshot; drops degraded snapshots (no explanation + no trades) via skip()
- advisory-status-projector.ts — DDB-stream consumer (advisory-bff's own command-owned derived aggregate); recomputes the AdvisoryStatus aggregate post-commit via `repo.deriveAdvisoryAggregate(tenantId)` — ONE `tenantId-index` query over this tenant's non-terminal DecisionReadModel rows (status+createdAt projected) yielding `inFlightCount` (PENDING/AWAITING_CONFIRMATION), `generatingCount` (GENERATING), `failedCount` (FAILED), `oldestGeneratingAt` (min GENERATING createdAt, or null); writes all four via update(..., { add: { __version: 1 } }) (atomic strictly-monotonic __version self-increment, was projectVersioned+Date.now()); loop-guarded to skip AdvisoryStatus records. (WS-4: generating/failed/oldestGeneratingAt added so dashboard-bff can reflect generating/failed cycle states; replaced the prior COUNT-only countInFlightDecisions.)
- decision-publisher.ts — DDB-stream consumer; broadcasts DecisionReadModel changes to MFE via AppSync publishDecisionUpdate mutation (WS-3: the AdvisoryStatus → publishAdvisoryStatusUpdate broadcast was removed — no MFE subscriber remains)
- event-publisher.ts — Egress CDC publisher (changeDataCapture pipeline, typed-subject mode)
- publisher-schemas.ts — typed-subject registry: maps each emitted __typename → its producer zod contract (subjectSchemas) + exemptTypenames; the publisher emits schema.parse(row) (the DRY subject) for covered types, the fat row for exempt. Exempt: none (every emitted __typename now has a row-level contract — DecisionReadModel → DecisionReadModelSchema, AdvisoryStatus → AdvisoryStatusSchema, UserConfirmation → UserConfirmationSchema, UserRejection → UserRejectionSchema).

## Transforms
- decision-snapshot.ts — single transform for DECISION_PACKET_CREATED + DECISION_PACKET_UPDATED; projects the full CDC subject (DecisionPacket NewImage) into DecisionReadModel P1 via projectVersioned; returns undefined (→ skip()) for degraded snapshots (no explanation AND no proposedTrades)
  (Removed: decision-packet-created.ts, decision-status-changed.ts, decision-trigger-received.ts)
- decision-cycle-status.ts — WS-2 transform for DECISION_CYCLE_STARTED + DECISION_CYCLE_FAILED; projects a MINIMAL versioned DecisionReadModel P1 row (decisionId/tenantId/status/trigger=''/createdAt/updatedAt) via projectVersioned — STARTED→GENERATING (v0), FAILED→FAILED (v1). createdAt/updatedAt come from the envelope timestamp. `trigger` is written '' (WS-3) because getPendingDecisions selects DecisionPacket.trigger as String! — a missing trigger fails the whole list query; the value is cosmetic (these rows are filtered out of the visible list). The version guard lets a content DECISION_PACKET_CREATED (v1) overwrite GENERATING (v0) and drops a late STARTED.

## Read model
- ReadModelOwnership registered in src/read-model-ownership.ts
  - P1 (projectVersioned): DecisionReadModel
  - CommandOwned (self-versioned derived aggregate via update+add:{__version:1}): AdvisoryStatus (owner; dashboard-bff holds the consumer-side Projection<'P3'> copy)
  - CommandOwned (AppSync fn.js PutItems): UserConfirmation, UserRejection, UserInteraction
- Enforced by `nx run advisory-bff:typecheck` (test/types/read-model-ownership.type-test.ts)

## Event Payload Contracts (domain/contracts.ts → @nestfolio/advisory-bff/contracts)
Producer-owned zod CDC subject contracts, exported via `@nestfolio/advisory-bff/contracts`. DRY domain subjects — identity travels in the event context (RequestContext), not on the subject. JS resolvers cannot import TypeScript contracts at runtime; these contracts validate the emitted shape in unit tests and the e2e `parseSubject` gate.
- DecisionReadModelSchema / DecisionReadModel — `DecisionReadModel` row (pk=`Decision#${tenantId}#${decisionId}`, sk='DecisionReadModel'), CDC-emitted DECISION_READ_MODEL_CREATED / DECISION_READ_MODEL_UPDATED. Written by TWO builders: decision-snapshot.ts (full) + decision-cycle-status.ts (minimal), so snapshot-only fields are optional. Required fields: decisionId, trigger (cycle-status writes '' not undefined), status, version, createdAt, updatedAt. Optional fields: proposedTrades, explanation, confirmationRequired, complianceChecks, agentInvocations, confirmedAt, rejectedAt, taskToken. Outcome field nullability: `rejectionReason` is `.nullable().optional()` — copied from DecisionPacketSchema (which declares it `.nullable()`), so non-rejected rows carry `rejectionReason:null` in DDB (proven by the e2e gate). `confirmedAt` and `rejectedAt` are absent (undefined) on non-confirmed/non-rejected rows (`.optional()` only, not nullable).
- UserConfirmationSchema / UserConfirmation — `UserConfirmation#${autoId}` intent row (JS resolver PutItem), CDC-emitted USER_CONFIRMED. Fields: decisionId, confirmedAt, confirmedBy, timestamp, taskToken?.
- UserRejectionSchema / UserRejection — `UserRejection#${autoId}` intent row (JS resolver PutItem), CDC-emitted USER_REJECTED. Fields: decisionId, rejectedAt, rejectedBy, rejectionReason, timestamp, taskToken?.
- AdvisoryStatusSchema / AdvisoryStatus — the command-owned derived AdvisoryStatus aggregate DRY subject, CDC-emitted as ADVISORY_STATUS_UPDATED (insert + modify). Fields: inFlightCount (number), generatingCount (number), failedCount (number), oldestGeneratingAt (string | null), __version (number — retained in subject for downstream P3 keying by dashboard-bff). Identity (tenantId) travels in RequestContext.

## Event Types (domain/events.ts)
<!-- card-drift:event-types (generated — `nx run event-processor:card-drift -- --fix`) -->
- AdvisoryBffEventTypes: ADVISORY_STATUS_UPDATED, DECISION_READ_MODEL_CREATED, DECISION_READ_MODEL_UPDATED, USER_CONFIRMED, USER_INTERACTION_CREATED, USER_INTERACTION_UPDATED, USER_REJECTED, USER_VIEWED_EXPLANATION
<!-- /card-drift:event-types -->
## GraphQL Surface (schema.graphql)
- Queries: getDecision, getPendingDecisions, getDecisionHistory, getAgentInvocations, getComplianceChecks
  - getPendingDecisions status filter includes GENERATING + FAILED (WS-3) so cycle-lifecycle rows reach the /advisory list UI.
- Mutations: confirmDecision, rejectDecision, recordExplanationView, publishDecisionUpdate (@aws_iam)
- Subscription: onDecisionUpdate(tenantId) @aws_subscribe(confirmDecision, rejectDecision, publishDecisionUpdate) @aws_cognito_user_pools @aws_iam
- DecisionStatus enum includes GENERATING (WS-2) + FAILED so cycle-status rows broadcast via publishDecisionUpdate without enum-validation failure.
- (WS-3: the AdvisoryStatus AppSync surface — getAdvisoryStatus Query, publishAdvisoryStatusUpdate Mutation, onAdvisoryStatusUpdate Subscription, AdvisoryStatus type — was removed as dead. The AdvisoryStatus DDB aggregate + ADVISORY_STATUS_UPDATED CDC remain for dashboard-bff.)

## MFE Hosting
- MfeBucket (mfeKey=advisory): S3 bucket "{account}-{prefix}-nestfolio-mfe-advisory"
  - CloudFront OAC bucket policy (scoped via AWS:SourceArn to investor-web distribution)
  - SSM exports: mfe/bucketName, mfe/key

## SSM Parameters Published
- api/graphqlUrl
- api/realtimeUrl
- mfe/bucketName
- mfe/key

## Tests
- advisory.repository.test.ts
- handlers/event-listener.test.ts
- handlers/advisory-status-projector.test.ts
- handlers/decision-publisher.test.ts
- transforms/decision-snapshot.test.ts
- graphql/mutation-region.test.ts
- types/read-model-ownership.type-test.ts
- service.stack.test.ts
- test/integration/advisory-bff.integration.test.ts
  (Removed: transforms/decision-packet-created.test.ts, transforms/decision-status-changed.test.ts, transforms/decision-trigger-received.test.ts)

## Dependencies
- libs: cdk-constructs (core), event-processor
- SSM: investor/auth/userPoolId

## DDB Entities
<!-- card-drift:ddb-entities (generated — `nx run event-processor:card-drift -- --fix`) -->
- AdvisoryStatus
- DecisionReadModel
- UserConfirmation
- UserRejection
<!-- /card-drift:ddb-entities -->
