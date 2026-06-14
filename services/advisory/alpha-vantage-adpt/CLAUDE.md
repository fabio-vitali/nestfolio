# alpha-vantage-adpt

Domain: advisory | Bus: advisoryBus (data feed adapter)
Stack: services/advisory/alpha-vantage-adpt/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
<!-- card-drift:ingress (generated — `nx run event-processor:card-drift -- --fix`) -->
- Ingress: FETCH_ALPHA_VANTAGE_REQUESTED
<!-- /card-drift:ingress -->
- advisoryBus → alpha-vantage-adpt-ingress (SQS → Lambda, 90s timeout)
  Subscriptions: FETCH_ALPHA_VANTAGE_REQUESTED
  Environment: ALPHA_VANTAGE_API_KEY (from SSM)

## Egress
<!-- card-drift:egress (generated — `nx run event-processor:card-drift -- --fix`) -->
- AlphaVantageArticle: ALPHA_VANTAGE_NEWS_UPDATED
- EconomicIndicator: ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED
<!-- /card-drift:egress -->
- CDC: DynamoDB Streams → alpha-vantage-adpt-egress (Lambda)
  Emits: ALPHA_VANTAGE_NEWS_UPDATED (AlphaVantageArticle, insert only), ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED (EconomicIndicator, insert only)

## Schedule
- AdapterSchedule: EventBridge Scheduler → FetchTrigger Lambda → publishes FETCH_ALPHA_VANTAGE_REQUESTED
  Default rate: rate(24 hours), disabled by default

## Standalone Lambdas
- FetchTrigger: Publishes FETCH_ALPHA_VANTAGE_REQUESTED to advisoryBus (invoked by EventBridge Scheduler)

## Handlers
<!-- card-drift:handlers (generated — `nx run event-processor:card-drift -- --fix`) -->
- fetch-trigger.ts
<!-- /card-drift:handlers -->
- event-listener.ts — Ingress event handler (fetches Alpha Vantage data, materializes to DDB)
- event-publisher.ts — Egress CDC publisher (changeDataCapture pipeline, typed-subject mode)
- publisher-schemas.ts — typed-subject registry: maps each emitted __typename → its producer zod contract (subjectSchemas) + exemptTypenames; the publisher emits schema.parse(row) (the DRY subject) for covered types, the fat row for exempt.
- fetch-trigger.ts — Scheduler trigger Lambda

## Event Types (domain/events.ts)
<!-- card-drift:event-types (generated — `nx run event-processor:card-drift -- --fix`) -->
- AlphaVantageAdptEventTypes: ALPHA_VANTAGE_NEWS_UPDATED, ECONOMIC_INDICATOR_UPDATED (ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED), FETCH_REQUESTED (FETCH_ALPHA_VANTAGE_REQUESTED)
<!-- /card-drift:event-types -->
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

## DDB Entities
<!-- card-drift:ddb-entities (generated — `nx run event-processor:card-drift -- --fix`) -->
- AlphaVantageArticle
- EconomicIndicator
<!-- /card-drift:ddb-entities -->
