# alpha-vantage-adpt

Domain: advisory | Bus: AdvisoryBus (data feed adapter)
Stack: services/advisory/alpha-vantage-adpt/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- AdvisoryBus -> alpha-vantage-adpt-ingress (SQS -> Lambda, 90s timeout)
  Subscriptions: FETCH_ALPHA_VANTAGE_REQUESTED

## Egress
- CDC: DynamoDB Streams -> alpha-vantage-adpt-egress (Lambda)
  Emits: AlphaVantageArticle, EconomicIndicator

## Schedule
- AdapterSchedule: EventBridge Scheduler -> FetchTrigger Lambda -> publishes FETCH_ALPHA_VANTAGE_REQUESTED
  Default rate: rate(24 hours), disabled by default

## Handlers
- event-listener.ts
- event-publisher.ts
- fetch-trigger.ts

## Tests
- event-publisher.test.ts
- handlers/

## Dependencies
- libs: cdk-constructs (core, extensions, utils)
- SSM: advisory/alpha-vantage-api-key
