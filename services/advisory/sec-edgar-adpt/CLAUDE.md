# sec-edgar-adpt

Domain: advisory | Bus: AdvisoryBus (data feed adapter)
Stack: services/advisory/sec-edgar-adpt/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- AdvisoryBus -> sec-edgar-adpt-ingress (SQS -> Lambda, 120s timeout, 512 MB)
  Subscriptions: FETCH_SEC_EDGAR_REQUESTED

## Egress
- CDC: DynamoDB Streams -> sec-edgar-adpt-egress (Lambda)
  Emits: SecFiling (form-type-based event routing)

## Schedule
- AdapterSchedule: EventBridge Scheduler -> FetchTrigger Lambda -> publishes FETCH_SEC_EDGAR_REQUESTED
  Default rate: rate(24 hours), disabled by default
  Tracked CIKs: 0000102909, 0000088053, 0000914208

## Handlers
- event-listener.ts
- event-publisher.ts
- fetch-trigger.ts

## Tests
- event-listener.test.ts
- handlers/

## Dependencies
- libs: cdk-constructs (core, extensions, utils)
