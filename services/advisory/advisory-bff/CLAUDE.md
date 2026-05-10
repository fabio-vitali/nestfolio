# advisory-bff

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/advisory-bff/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- advisoryBus → advisory-bff-ingress (SQS → Lambda)
  Subscriptions: DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED, DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMATION_REQUESTED
  + 7 SF trigger events (TRIGGER_EVENT_TYPES from decision-workflow-ctrl/events):
    MANDATE_SNAPSHOT_CREATED, INVESTOR_PROFILE_UPDATED, PORTFOLIO_DRIFT_DETECTED,
    ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED

## Egress
- CDC: DynamoDB Streams → advisory-bff-egress (Lambda)
  Emits:
  - DecisionReadModel → insert: DECISION_READ_MODEL_CREATED, modify: DECISION_READ_MODEL_UPDATED
  - UserInteraction → insert: USER_INTERACTION_CREATED, modify: USER_INTERACTION_UPDATED
  - UserConfirmation → insert: USER_CONFIRMED
  - UserRejection → insert: USER_REJECTED
  - AdvisoryStatus → insert: ADVISORY_STATUS_UPDATED, modify: ADVISORY_STATUS_UPDATED

## Facade
- AppSync GraphQL API (Cognito auth via investor user pool SSM)
  JS Resolvers via discoverJsResolvers
  Extra pipeline steps:
  - confirmDecision → get-decision-readback.fn.js
  - rejectDecision → get-decision-readback.fn.js
  New resolvers (Tasks 9–10):
  - getAdvisoryStatus → get-advisory-status.fn.js (GetItem on AdvisoryStatus row)
  - publishAdvisoryStatusUpdate → publish-advisory-status-update.fn.js (@aws_iam IAM-only mutation used by DDB-stream publisher)

## Handlers
- event-listener.ts — Ingress event handler
- event-publisher.ts — Egress CDC publisher (publishes AdvisoryStatus changes via publishAdvisoryStatusUpdate mutation)

## Transforms
- decision-packet-created.ts — materialises DecisionReadModel; also decrements AdvisoryStatus.inFlightCount (Task 3)
- decision-status-changed.ts — materialises status changes for DECISION_APPROVED / DECISION_BLOCKED / USER_CONFIRMATION_REQUESTED
- decision-trigger-received.ts — increments AdvisoryStatus.inFlightCount on any of the 7 trigger events; sets lastTriggerAt (Task 2)

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
- transforms/decision-packet-created.test.ts
- transforms/decision-status-changed.test.ts
- transforms/decision-trigger-received.test.ts (Task 2)
- test/integration/ (Task 11)

## Dependencies
- libs: cdk-constructs (core), event-processor
- SSM: investor/auth/userPoolId
