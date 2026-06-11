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
  Emits:
  - MarketWatchArticle → insert: MARKETWATCH_UPDATED

## Schedule
- AdapterSchedule: EventBridge Scheduler → FetchTrigger Lambda → publishes FETCH_MARKETWATCH_REQUESTED
  Default rate: rate(24 hours), disabled by default

## Standalone Lambdas
- FetchTrigger: Publishes FETCH_MARKETWATCH_REQUESTED to advisoryBus (invoked by EventBridge Scheduler)

## Handlers
- event-listener.ts — Ingress event handler (fetches MarketWatch articles, materializes to DDB)
- event-publisher.ts — Egress CDC publisher (changeDataCapture pipeline, typed-subject mode)
- publisher-schemas.ts — typed-subject registry: maps each emitted __typename → its producer zod contract (subjectSchemas) + exemptTypenames; the publisher emits schema.parse(row) (the DRY subject) for covered types, the fat row for exempt.
- fetch-trigger.ts — Scheduler trigger Lambda

## Event Types (domain/events.ts)
- MarketwatchAdptEventTypes: FETCH_REQUESTED (FETCH_MARKETWATCH_REQUESTED), MARKETWATCH_UPDATED

## Event Payload Contracts (domain/contracts.ts → @nestfolio/marketwatch-adpt/contracts)
Producer-owned zod CDC subject contracts. GLOBAL aggregate — SubjectContext only, no identity context. project() injects pk/sk/__typename, so subjects are fields-only.
- MarketWatchArticleSchema / MarketWatchArticle — MARKETWATCH_UPDATED subject. Fields: feed, source (literal 'marketwatch'), articles (array — z.unknown(); RSS items are opaque at the producer level, parsed downstream by event-processor parseRssFeed). Replaces the old `interface MarketWatchArticle`.

## Tests
- handlers/event-listener.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor
