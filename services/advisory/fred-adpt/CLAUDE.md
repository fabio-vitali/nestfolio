# fred-adpt

Domain: advisory | Bus: AdvisoryBus (data feed adapter)
Stack: services/advisory/fred-adpt/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- AdvisoryBus -> fred-adpt-ingress (SQS -> Lambda, 90s timeout)
  Subscriptions: FETCH_FRED_REQUESTED

## Egress
- CDC: DynamoDB Streams -> fred-adpt-egress (Lambda)
  Emits: FredIndicator

## Schedule
- AdapterSchedule: EventBridge Scheduler -> FetchTrigger Lambda -> publishes FETCH_FRED_REQUESTED
  Default rate: rate(24 hours), disabled by default

## Handlers
- event-listener.ts
- event-publisher.ts
- fetch-trigger.ts

## Tests
- handlers/

## Dependencies
- libs: cdk-constructs (core, extensions, utils)
- SSM: advisory/fred-api-key
