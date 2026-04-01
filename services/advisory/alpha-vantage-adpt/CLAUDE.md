# alpha-vantage-adpt

Domain: advisory | Bus: advisoryBus (data feed adapter)
Stack: services/advisory/alpha-vantage-adpt/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- advisoryBus → alpha-vantage-adpt-ingress (SQS → Lambda, 90s timeout)
  Subscriptions: FETCH_ALPHA_VANTAGE_REQUESTED
  Environment: ALPHA_VANTAGE_API_KEY (from SSM)

## Egress
- CDC: DynamoDB Streams → alpha-vantage-adpt-egress (Lambda)
  Emits: ALPHA_VANTAGE_NEWS_UPDATED (AlphaVantageArticle, insert only), ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED (EconomicIndicator, insert only)

## Schedule
- AdapterSchedule: EventBridge Scheduler → FetchTrigger Lambda → publishes FETCH_ALPHA_VANTAGE_REQUESTED
  Default rate: rate(24 hours), disabled by default

## Standalone Lambdas
- FetchTrigger: Publishes FETCH_ALPHA_VANTAGE_REQUESTED to advisoryBus (invoked by EventBridge Scheduler)

## Handlers
- event-listener.ts — Ingress event handler (fetches Alpha Vantage data, materializes to DDB)
- event-publisher.ts — Egress CDC publisher
- fetch-trigger.ts — Scheduler trigger Lambda

## Event Types (domain/events.ts)
- AlphaVantageAdptEventTypes: FETCH_REQUESTED (FETCH_ALPHA_VANTAGE_REQUESTED), ALPHA_VANTAGE_NEWS_UPDATED, ECONOMIC_INDICATOR_UPDATED (ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED)

## Tests
- handlers/event-listener.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor
- SSM: advisory/alpha-vantage-api-key
