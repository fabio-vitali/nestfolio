# advisory-hub

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/advisory-hub/src/service.stack.ts

## State
None (hub — manages shared infrastructure only)

## Infrastructure
- AdvisoryBus: EventBridge domain bus (eventBusName from naming service)
- Archive: 365-day event archive for replay (all events)
- SharedParameter: Bus ARN published to SSM (cross-account via RAM when multi-account)
- CrossAccountBusPolicy: Allows cross-account PutEvents when multi-account

## SSM Parameters (source of truth for advisory domain)
- models/opus: anthropic.claude-opus-4-6-20250501-v1:0
- models/sonnet: anthropic.claude-sonnet-4-6-20250514-v1:0
- models/haiku: anthropic.claude-haiku-4-5-20251001-v1:0

## Tests
- service.stack.test.ts

## Dependencies
- libs: cdk-constructs (core, observability, extensions)
