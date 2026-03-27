# yahoo-finance-adpt

Domain: advisory | Bus: AdvisoryBus (data feed adapter)
Stack: services/advisory/yahoo-finance-adpt/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- AdvisoryBus -> yahoo-finance-adpt-ingress (SQS -> Lambda, 60s timeout)
  Subscriptions: FETCH_YAHOO_FINANCE_REQUESTED

## Egress
- CDC: DynamoDB Streams -> yahoo-finance-adpt-egress (Lambda)
  Emits: YahooFinanceArticle

## Schedule
- AdapterSchedule: EventBridge Scheduler -> FetchTrigger Lambda -> publishes FETCH_YAHOO_FINANCE_REQUESTED
  Default rate: rate(24 hours), disabled by default
  Default tickers: VTI, BND, QQQ, VTIP, SPY

## Handlers
- event-listener.ts
- event-publisher.ts
- fetch-trigger.ts

## Tests
- handlers/

## Dependencies
- libs: cdk-constructs (core, extensions, utils)
