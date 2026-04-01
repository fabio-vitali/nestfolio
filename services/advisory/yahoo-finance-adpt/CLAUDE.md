# yahoo-finance-adpt

Domain: advisory | Bus: advisoryBus (data feed adapter)
Stack: services/advisory/yahoo-finance-adpt/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- advisoryBus → yahoo-finance-adpt-ingress (SQS → Lambda, 60s timeout)
  Subscriptions: FETCH_YAHOO_FINANCE_REQUESTED
  Environment: TICKERS (default: VTI, BND, QQQ, VTIP, SPY)

## Egress
- CDC: DynamoDB Streams → yahoo-finance-adpt-egress (Lambda)
  Emits: YAHOO_FINANCE_UPDATED (YahooFinanceArticle, insert only)

## Schedule
- AdapterSchedule: EventBridge Scheduler → FetchTrigger Lambda → publishes FETCH_YAHOO_FINANCE_REQUESTED
  Default rate: rate(24 hours), disabled by default

## Standalone Lambdas
- FetchTrigger: Publishes FETCH_YAHOO_FINANCE_REQUESTED to advisoryBus (invoked by EventBridge Scheduler)

## Handlers
- event-listener.ts — Ingress event handler (fetches Yahoo Finance data, materializes to DDB)
- event-publisher.ts — Egress CDC publisher
- fetch-trigger.ts — Scheduler trigger Lambda

## Event Types (domain/events.ts)
- YahooFinanceAdptEventTypes: FETCH_REQUESTED (FETCH_YAHOO_FINANCE_REQUESTED), YAHOO_FINANCE_UPDATED

## Tests
- handlers/event-listener.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor
