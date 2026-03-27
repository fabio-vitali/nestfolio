# marketwatch-adpt

Domain: advisory | Bus: AdvisoryBus (data feed adapter)
Stack: services/advisory/marketwatch-adpt/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- AdvisoryBus -> marketwatch-adpt-ingress (SQS -> Lambda, 60s timeout)
  Subscriptions: FETCH_MARKETWATCH_REQUESTED

## Egress
- CDC: DynamoDB Streams -> marketwatch-adpt-egress (Lambda)
  Emits: MarketWatchArticle

## Schedule
- AdapterSchedule: EventBridge Scheduler -> FetchTrigger Lambda -> publishes FETCH_MARKETWATCH_REQUESTED
  Default rate: rate(24 hours), disabled by default

## Handlers
- event-listener.ts
- event-publisher.ts
- fetch-trigger.ts

## Tests
- handlers/

## Dependencies
- libs: cdk-constructs (core, extensions, utils)
