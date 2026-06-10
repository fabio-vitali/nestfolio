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

## Event Payload Contracts (domain/contracts.ts → @nestfolio/alpha-vantage-adpt/contracts)
Producer-owned zod CDC subject contracts. GLOBAL aggregate — SubjectContext only, no identity context. project() injects pk/sk/__typename, so subjects are fields-only. This adapter had no payload interface prior to this slice.
- AlphaVantageArticleSchema / AlphaVantageArticle — ALPHA_VANTAGE_NEWS_UPDATED subject. Fields: title, url, time_published, summary, overall_sentiment_score? (number). Schema uses .passthrough() to preserve additional raw feed keys from the Alpha Vantage NEWS_SENTIMENT feed.
- EconomicIndicatorSchema / EconomicIndicator — ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED subject. Fields: function (string), data (unknown). Typename is distinct from fred-adpt's FredIndicator.

## Tests
- handlers/event-listener.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor
- SSM: advisory/alpha-vantage-api-key
