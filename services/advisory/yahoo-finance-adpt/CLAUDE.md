# yahoo-finance-adpt

Domain: advisory | Bus: advisoryBus (data feed adapter)
Stack: services/advisory/yahoo-finance-adpt/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
<!-- card-drift:ingress (generated — `nx run event-processor:card-drift -- --fix`) -->
- Ingress: FETCH_YAHOO_FINANCE_REQUESTED
<!-- /card-drift:ingress -->
- advisoryBus → yahoo-finance-adpt-ingress (SQS → Lambda, 60s timeout)
  Environment: TICKERS (default: VTI,BND,QQQ,VTIP,SPY)

## Egress
<!-- card-drift:egress (generated — `nx run event-processor:card-drift -- --fix`) -->
- YahooFinanceArticle: YAHOO_FINANCE_UPDATED
<!-- /card-drift:egress -->
- CDC: DynamoDB Streams → yahoo-finance-adpt-egress (Lambda)

## Schedule
- AdapterSchedule: EventBridge Scheduler → FetchTrigger Lambda → publishes FETCH_YAHOO_FINANCE_REQUESTED
  Default rate: rate(24 hours), disabled by default

## Standalone Lambdas
- FetchTrigger: Publishes FETCH_YAHOO_FINANCE_REQUESTED to advisoryBus (invoked by EventBridge Scheduler)

## Handlers
<!-- card-drift:handlers (generated — `nx run event-processor:card-drift -- --fix`) -->
- fetch-trigger.ts
<!-- /card-drift:handlers -->
- event-listener.ts — Ingress event handler (fetches Yahoo Finance articles, materializes to DDB)
- event-publisher.ts — Egress CDC publisher (changeDataCapture pipeline, typed-subject mode)
- publisher-schemas.ts — typed-subject registry: maps each emitted __typename → its producer zod contract (subjectSchemas) + exemptTypenames; the publisher emits schema.parse(row) (the DRY subject) for covered types, the fat row for exempt.
- fetch-trigger.ts — Scheduler trigger Lambda

## Event Types (domain/events.ts)
<!-- card-drift:event-types (generated — `nx run event-processor:card-drift -- --fix`) -->
- YahooFinanceAdptEventTypes: FETCH_REQUESTED (FETCH_YAHOO_FINANCE_REQUESTED), YAHOO_FINANCE_UPDATED
<!-- /card-drift:event-types -->

## Event Payload Contracts (domain/contracts.ts → @nestfolio/yahoo-finance-adpt/contracts)
Producer-owned zod CDC subject contracts. GLOBAL aggregate — SubjectContext only, no identity context. project() injects pk/sk/__typename, so subjects are fields-only.
- YahooFinanceArticleSchema / YahooFinanceArticle — YAHOO_FINANCE_UPDATED subject. Fields: ticker, source (literal 'yahoo-finance'), articles (array — z.unknown(); RSS items are opaque at the producer level, parsed downstream by event-processor parseRssFeed). Replaces the old `interface YahooFinanceArticle`.

## Tests
- handlers/event-listener.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor

## DDB Entities
<!-- card-drift:ddb-entities (generated — `nx run event-processor:card-drift -- --fix`) -->
- YahooFinanceArticle
<!-- /card-drift:ddb-entities -->
