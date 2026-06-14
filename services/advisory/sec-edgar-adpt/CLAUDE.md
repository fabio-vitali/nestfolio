# sec-edgar-adpt

Domain: advisory | Bus: advisoryBus (data feed adapter)
Stack: services/advisory/sec-edgar-adpt/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
<!-- card-drift:ingress (generated — `nx run event-processor:card-drift -- --fix`) -->
- Ingress: FETCH_SEC_EDGAR_REQUESTED
<!-- /card-drift:ingress -->
- advisoryBus → sec-edgar-adpt-ingress (SQS → Lambda, 120s timeout, 512 MB)
  Environment: TRACKED_CIKS (0000102909, 0000088053, 0000914208)

## Egress
<!-- card-drift:egress (generated — `nx run event-processor:card-drift -- --fix`) -->
- SecFiling: SEC_10K_UPDATED, SEC_8K_FILED, SEC_PROSPECTUS_UPDATED
<!-- /card-drift:egress -->
- CDC: DynamoDB Streams → sec-edgar-adpt-egress (Lambda)
  Emits (form-type-based event routing on SecFiling entity):
  - 8-K → SEC_8K_FILED
  - 485BPOS, N-1A → SEC_PROSPECTUS_UPDATED
  - 10-K, 10-Q → SEC_10K_UPDATED
  - default → SEC_8K_FILED

## Schedule
- AdapterSchedule: EventBridge Scheduler → FetchTrigger Lambda → publishes FETCH_SEC_EDGAR_REQUESTED
  Default rate: rate(24 hours), disabled by default

## Standalone Lambdas
- FetchTrigger: Publishes FETCH_SEC_EDGAR_REQUESTED to advisoryBus (invoked by EventBridge Scheduler)

## Handlers
<!-- card-drift:handlers (generated — `nx run event-processor:card-drift -- --fix`) -->
- fetch-trigger.ts
<!-- /card-drift:handlers -->
- event-listener.ts — Ingress event handler (fetches SEC EDGAR filings, materializes to DDB)
- event-publisher.ts — Egress CDC publisher (changeDataCapture pipeline, typed-subject mode)
- publisher-schemas.ts — typed-subject registry: maps each emitted __typename → its producer zod contract (subjectSchemas) + exemptTypenames; the publisher emits schema.parse(row) (the DRY subject) for covered types, the fat row for exempt.
- fetch-trigger.ts — Scheduler trigger Lambda

## Event Types (domain/events.ts)
<!-- card-drift:event-types (generated — `nx run event-processor:card-drift -- --fix`) -->
- SecEdgarAdptEventTypes: FETCH_REQUESTED (FETCH_SEC_EDGAR_REQUESTED), SEC_10K_UPDATED, SEC_8K_FILED, SEC_PROSPECTUS_UPDATED
<!-- /card-drift:event-types -->

## Event Payload Contracts (domain/contracts.ts → @nestfolio/sec-edgar-adpt/contracts)
Producer-owned zod CDC subject contracts. GLOBAL aggregate — SubjectContext only, no identity context. project() injects pk/sk/__typename, so subjects are fields-only.
- SecFilingSchema / SecFiling — SEC_8K_FILED / SEC_PROSPECTUS_UPDATED / SEC_10K_UPDATED subject (field-mapped on formType). Fields: cik, issuer, formType, filingDate, accessionNumber, body, source (literal 'sec-edgar'), fetchedAt. Replaces the old `interface SecFiling` that redundantly declared pk/sk/__typename.

## Tests
- edgar-api.test.ts
- event-listener.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor

## DDB Entities
<!-- card-drift:ddb-entities (generated — `nx run event-processor:card-drift -- --fix`) -->
- SecFiling
<!-- /card-drift:ddb-entities -->
