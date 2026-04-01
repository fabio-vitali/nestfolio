# marketwatch-adpt

Domain: advisory | Bus: advisoryBus (data feed adapter)
Stack: services/advisory/marketwatch-adpt/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- advisoryBus → marketwatch-adpt-ingress (SQS → Lambda, 60s timeout)
  Subscriptions: FETCH_MARKETWATCH_REQUESTED

## Egress
- CDC: DynamoDB Streams → marketwatch-adpt-egress (Lambda)
  Emits: MARKETWATCH_UPDATED (MarketWatchArticle, insert only)

## Schedule
- AdapterSchedule: EventBridge Scheduler → FetchTrigger Lambda → publishes FETCH_MARKETWATCH_REQUESTED
  Default rate: rate(24 hours), disabled by default

## Standalone Lambdas
- FetchTrigger: Publishes FETCH_MARKETWATCH_REQUESTED to advisoryBus (invoked by EventBridge Scheduler)

## Handlers
- event-listener.ts — Ingress event handler (fetches MarketWatch data, materializes to DDB)
- event-publisher.ts — Egress CDC publisher
- fetch-trigger.ts — Scheduler trigger Lambda

## Event Types (domain/events.ts)
- MarketwatchAdptEventTypes: FETCH_REQUESTED (FETCH_MARKETWATCH_REQUESTED), MARKETWATCH_UPDATED

## Tests
- handlers/event-listener.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor
