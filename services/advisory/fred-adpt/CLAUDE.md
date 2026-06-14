# fred-adpt

Domain: advisory | Bus: advisoryBus (data feed adapter)
Stack: services/advisory/fred-adpt/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
<!-- card-drift:ingress (generated — `nx run event-processor:card-drift -- --fix`) -->
- Ingress: FETCH_FRED_REQUESTED
<!-- /card-drift:ingress -->
- advisoryBus → fred-adpt-ingress (SQS → Lambda, 90s timeout)
  Subscriptions: FETCH_FRED_REQUESTED
  Environment: FRED_API_KEY (from SSM)

## Egress
<!-- card-drift:egress (generated — `nx run event-processor:card-drift -- --fix`) -->
- FredIndicator: FRED_INDICATORS_UPDATED
<!-- /card-drift:egress -->
- CDC: DynamoDB Streams → fred-adpt-egress (Lambda)
  Emits: FRED_INDICATORS_UPDATED (FredIndicator, insert only)

## Schedule
- AdapterSchedule: EventBridge Scheduler → FetchTrigger Lambda → publishes FETCH_FRED_REQUESTED
  Default rate: rate(24 hours), disabled by default

## Standalone Lambdas
- FetchTrigger: Publishes FETCH_FRED_REQUESTED to advisoryBus (invoked by EventBridge Scheduler)

## Handlers
<!-- card-drift:handlers (generated — `nx run event-processor:card-drift -- --fix`) -->
- fetch-trigger.ts
<!-- /card-drift:handlers -->
- event-listener.ts — Ingress event handler (fetches FRED data, materializes to DDB)
- event-publisher.ts — Egress CDC publisher (changeDataCapture pipeline, typed-subject mode)
- publisher-schemas.ts — typed-subject registry: maps each emitted __typename → its producer zod contract (subjectSchemas) + exemptTypenames; the publisher emits schema.parse(row) (the DRY subject) for covered types, the fat row for exempt.
- fetch-trigger.ts — Scheduler trigger Lambda

## Event Types (domain/events.ts)
<!-- card-drift:event-types (generated — `nx run event-processor:card-drift -- --fix`) -->
- FredAdptEventTypes: FETCH_REQUESTED (FETCH_FRED_REQUESTED), FRED_INDICATORS_UPDATED
<!-- /card-drift:event-types -->
- FredAdptEventTypes: FETCH_REQUESTED (FETCH_FRED_REQUESTED), FRED_INDICATORS_UPDATED

## Event Payload Contracts (domain/contracts.ts → @nestfolio/fred-adpt/contracts)
Producer-owned zod CDC subject contracts. GLOBAL aggregate — SubjectContext only, no identity context. project() injects pk/sk/__typename, so subjects are fields-only.
- FredIndicatorSchema / FredIndicator — FRED_INDICATORS_UPDATED subject. Fields: seriesId, label, date, value. Replaces the old `interface FredIndicator` (re-exported directly from contracts).

## Tests
- handlers/event-listener.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor
- SSM: advisory/fred-api-key

## DDB Entities
<!-- card-drift:ddb-entities (generated — `nx run event-processor:card-drift -- --fix`) -->
- FredIndicator
<!-- /card-drift:ddb-entities -->
