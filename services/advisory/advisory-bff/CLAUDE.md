# advisory-bff

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/advisory-bff/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- advisoryBus → advisory-bff-ingress (SQS → Lambda)
  Subscriptions: DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED, DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMATION_REQUESTED

## Egress
- CDC: DynamoDB Streams → advisory-bff-egress (Lambda)
  Emits:
  - DecisionReadModel → DECISION_READ_MODEL
  - UserInteraction → USER_INTERACTION
  - UserConfirmation → insert: USER_CONFIRMED
  - UserRejection → insert: USER_REJECTED

## Facade
- AppSync GraphQL API (Cognito auth via investor user pool SSM)
  JS Resolvers via discoverJsResolvers
  Extra pipeline steps:
  - confirmDecision → get-decision-readback.fn.js
  - rejectDecision → get-decision-readback.fn.js

## Handlers
- event-listener.ts — Ingress event handler
- event-publisher.ts — Egress CDC publisher

## Event Types (domain/events.ts)
- AdvisoryBffEventTypes: USER_CONFIRMED, USER_REJECTED, USER_VIEWED_EXPLANATION

## Tests
- advisory.repository.test.ts
- handlers/event-listener.test.ts
- transforms/decision-packet-created.test.ts
- transforms/decision-status-changed.test.ts

## Dependencies
- libs: cdk-constructs (core), event-processor
- SSM: investor/auth/userPoolId
