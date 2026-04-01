# sec-edgar-adpt

Domain: advisory | Bus: advisoryBus (data feed adapter)
Stack: services/advisory/sec-edgar-adpt/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- advisoryBus → sec-edgar-adpt-ingress (SQS → Lambda, 120s timeout, 512 MB)
  Subscriptions: FETCH_SEC_EDGAR_REQUESTED
  Environment: TRACKED_CIKS (0000102909, 0000088053, 0000914208)

## Egress
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
- event-listener.ts — Ingress event handler (fetches SEC EDGAR filings, materializes to DDB)
- event-publisher.ts — Egress CDC publisher
- fetch-trigger.ts — Scheduler trigger Lambda

## Event Types (domain/events.ts)
- SecEdgarAdptEventTypes: FETCH_REQUESTED (FETCH_SEC_EDGAR_REQUESTED), SEC_8K_FILED, SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED

## Tests
- edgar-api.test.ts
- event-listener.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor
