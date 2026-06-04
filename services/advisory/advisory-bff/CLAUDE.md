# advisory-bff

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/advisory-bff/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- advisoryBus → advisory-bff-ingress (SQS → Lambda)
  Subscriptions: DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED
  (Workstream 3: DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMATION_REQUESTED, and all 7 SF
  trigger events removed — their effects arrive inside the versioned CDC snapshot, eliminating
  cross-event races by construction.)

## Egress
- CDC: DynamoDB Streams → advisory-bff-egress (Lambda)
  Emits:
  - DecisionReadModel → insert: DECISION_READ_MODEL_CREATED, modify: DECISION_READ_MODEL_UPDATED
  - UserInteraction → insert: USER_INTERACTION_CREATED, modify: USER_INTERACTION_UPDATED
  - UserConfirmation → insert: USER_CONFIRMED
  - UserRejection → insert: USER_REJECTED
  - AdvisoryStatus → insert: ADVISORY_STATUS_UPDATED, modify: ADVISORY_STATUS_UPDATED

## Facade
- AppSync GraphQL API (Cognito auth via investor user pool SSM; IAM auth also enabled)
  JS Resolvers via discoverJsResolvers
  Pipeline steps:
  - confirmDecision: preStep + extraStep → get-decision-readback.fn.js (reads existing DecisionReadModel to lift taskToken); confirm-decision.fn.js writes ONLY UserConfirmation intent row (PutItem) — no DecisionReadModel write
  - rejectDecision: preStep + extraStep → get-decision-readback.fn.js; reject-decision.fn.js writes ONLY UserRejection intent row (PutItem) — no DecisionReadModel write
  - getAdvisoryStatus → get-advisory-status.fn.js (GetItem on AdvisoryStatus row)
  - publishAdvisoryStatusUpdate → publish-advisory-status-update.fn.js (@aws_iam IAM-only mutation used by advisory-status-projector)
  - publishDecisionUpdate → publish-decision-update.fn.js (@aws_iam IAM-only mutation used by decision-publisher)

## Handlers
- event-listener.ts — Ingress handler; dispatches DECISION_PACKET_CREATED + DECISION_PACKET_UPDATED to decisionSnapshot; drops degraded snapshots (no explanation + no trades) via skip()
- advisory-status-projector.ts — DDB-stream consumer (advisory-bff's own command-owned derived aggregate); recomputes AdvisoryStatus.inFlightCount post-commit by counting non-terminal DecisionReadModel rows via countInFlightDecisions; writes via update(..., { add: { __version: 1 } }) (atomic strictly-monotonic __version self-increment, was projectVersioned+Date.now()); loop-guarded to skip AdvisoryStatus records
- decision-publisher.ts — DDB-stream consumer; broadcasts DecisionReadModel changes to MFE via AppSync publishDecisionUpdate mutation
- event-publisher.ts — Egress CDC publisher

## Transforms
- decision-snapshot.ts — single transform for DECISION_PACKET_CREATED + DECISION_PACKET_UPDATED; projects the full CDC subject (DecisionPacket NewImage) into DecisionReadModel P1 via projectVersioned; returns undefined (→ skip()) for degraded snapshots (no explanation AND no proposedTrades)
  (Removed: decision-packet-created.ts, decision-status-changed.ts, decision-trigger-received.ts)

## Read model
- ReadModelOwnership registered in src/read-model-ownership.ts
  - P1 (projectVersioned): DecisionReadModel
  - CommandOwned (self-versioned derived aggregate via update+add:{__version:1}): AdvisoryStatus (owner; dashboard-bff holds the consumer-side Projection<'P3'> copy)
  - CommandOwned (AppSync fn.js PutItems): UserConfirmation, UserRejection, UserInteraction
- Enforced by `nx run advisory-bff:typecheck` (test/types/read-model-ownership.type-test.ts)

## Event Types (domain/events.ts)
- AdvisoryBffEventTypes: ADVISORY_STATUS_UPDATED, USER_CONFIRMED, USER_REJECTED, USER_VIEWED_EXPLANATION,
  DECISION_READ_MODEL_CREATED, DECISION_READ_MODEL_UPDATED, USER_INTERACTION_CREATED, USER_INTERACTION_UPDATED

## GraphQL Surface (schema.graphql)
- Query: getAdvisoryStatus → AdvisoryStatus (by tenantId from auth context)
- Mutation: publishAdvisoryStatusUpdate(tenantId, inFlightCount, lastTriggerAt, updatedAt) @aws_iam
- Subscription: onAdvisoryStatusUpdate(tenantId) @aws_subscribe(publishAdvisoryStatusUpdate) @aws_cognito_user_pools @aws_iam
- Type: AdvisoryStatus { tenantId, inFlightCount, lastTriggerAt, updatedAt }

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
