# advisory-hub

Domain: advisory | Bus: AdvisoryBus
Stack: services/advisory/advisory-hub/src/service.stack.ts

## State
None (stateProps: false)

## Infrastructure
- EventBridge bus: AdvisoryBus (domain event hub)
- Event archive: 365-day retention, all events
- SharedParameter: bus ARN published to SSM (cross-account via RAM)
- CrossAccountBusPolicy: allows cross-account PutEvents

## SSM Parameters (source of truth for advisory domain)
- models/opus: anthropic.claude-opus-4-6-20250501-v1:0
- models/sonnet: anthropic.claude-sonnet-4-6-20250514-v1:0
- models/haiku: anthropic.claude-haiku-4-5-20251001-v1:0

## Tests
- service.stack.test.ts

## Dependencies
- libs: cdk-constructs (core, observability, extensions)
