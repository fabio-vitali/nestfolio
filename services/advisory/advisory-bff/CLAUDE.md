# advisory-bff

Domain: advisory | Bus: AdvisoryBus
Stack: services/advisory/advisory-bff/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- AdvisoryBus -> advisory-bff-ingress (SQS -> Lambda)
  Subscriptions: DECISION_PACKET_CREATED, DECISION_PACKET_ENRICHED, DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMATION_REQUESTED

## Egress
- CDC: DynamoDB Streams -> advisory-bff-egress (Lambda)
  Emits: DecisionReadModel, UserInteraction, UserConfirmation, UserRejection

## Facade
- AppSync GraphQL API (Cognito auth via investor user pool)
  JS Resolvers with extra pipeline steps:
  - confirmDecision -> get-decision-readback.fn.js
  - rejectDecision -> get-decision-readback.fn.js

## Handlers
- event-listener.ts
- event-publisher.ts

## Tests
- advisory.repository.test.ts
- handlers/
- transforms/

## Dependencies
- libs: cdk-constructs (core)
- SSM: investor/auth/userPoolId
