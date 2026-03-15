# Transparent Event-Driven Guards — Deep Analysis

## Current State

### 35 write methods across 13 repositories, 3 idempotency strategies

| Strategy | Count | Mechanism | Risk if missed |
|----------|-------|-----------|----------------|
| `putIfNotExists` | 12 | `ConditionExpression: attribute_not_exists(pk)` | Duplicate entities |
| `guardedWrite` | 3 | Atomic transaction: guard marker + business ops | Double-counting (financial) |
| Natural idempotency (upsert/SET) | 8 | Overwrite semantics — replay = same result | None (safe by design) |
| **No guard** | **7** | Raw PUT/ADD/UPDATE | **Duplicates / double-counting** |
| Partial guard | 1 | Condition on trade record, not on event | Race window |

### High-risk unguarded operations

| Service | Method | Operation | Risk |
|---------|--------|-----------|------|
| execution-ctrl | `createStagedOrder` | Raw PUT | Duplicate orders |
| ledger-ctrl | `nextSequence` | Raw ADD (counter) | Sequence increments on replay |
| ledger-bff | `saveLedgerEntry` | Raw PUT (eventId in key but no condition) | Silent overwrite |
| ledger-ctrl | `saveSnapshotWithEvents` | TransactWrite without guard | Snapshot duplication |
| dashboard-bff | EditEvent generation (6 pipes) | No guard on the edit event itself | Duplicate edit events |
| execution-adpt | `executeTrade` | Trade record condition only | No event-level dedup |

### Per-record boilerplate repeated in all 11 event listeners

Every `createHandler` repeats the same ~30-line loop:
```
for record of event.Records:
  try:
    parseRecord → extractTenantId → traceEvent → logger.info
    switch(eventType) → business logic → explicit idempotency check
    metrics.addMetric('EventProcessed')
  catch:
    logger.error → publishErrorEvent → metrics.addMetric('EventFailed')
    if isRetryable → failures.push(record.messageId)
  finally:
    metrics.publishStoredMetrics()
  return { batchItemFailures }
```

This boilerplate is where guards get forgotten — the framework doesn't enforce them.

---

## Design: Transparent Event Processing Framework

### Core Idea

Replace the manual per-record loop with a **declarative event processor** that enforces idempotency by strategy selection, not by manual implementation.

### API Surface

```typescript
// libs/lambda-utils/src/event-processor.ts

type IdempotencyStrategy =
  | 'putIfNotExists'   // Entity creation — pk+sk uniqueness
  | 'guardedWrite'     // Additive ops — atomic guard marker + business write
  | 'upsert'           // Overwrite — naturally idempotent, no guard needed
  | 'custom';          // Escape hatch for special cases (e.g., reducer)

interface EventHandlerConfig<T = unknown> {
  /** Which strategy protects this event type */
  strategy: IdempotencyStrategy;

  /**
   * Process the event payload.
   * - For 'putIfNotExists': return the item to put. Framework calls repo.putIfNotExists().
   * - For 'guardedWrite': return { guardKey, transactItems, ttl? }. Framework calls guardedWrite().
   * - For 'upsert': just do the work — no guard needed.
   * - For 'custom': full control, return void.
   */
  process: (payload: T, ctx: EventContext) => Promise<ProcessResult>;
}

interface EventContext {
  eventId: string;
  eventType: string;
  tenantId: string;
  userId?: string;
  timestamp: string;
  /** The raw SQS record for escape hatches */
  record: SQSRecord;
}

interface EventProcessorConfig {
  serviceName: string;
  errorEventType: string;
  handlers: Record<string, EventHandlerConfig>;
  /** Injected deps (repository, bus, metrics) */
  deps: EventListenerDeps;
}

// Usage:
export function createEventProcessor(config: EventProcessorConfig):
  (event: SQSEvent) => Promise<SQSBatchResponse>;
```

### What the framework does transparently

| Concern | Current (manual) | Proposed (framework) |
|---------|------------------|----------------------|
| Event parsing | `parseRecord(record)` in every handler | Automatic |
| Tenant extraction | `extractTenantId(event)` in every handler | Automatic → `ctx.tenantId` |
| X-Ray tracing | `traceEvent(type, id)` in every handler | Automatic |
| Structured logging | `logger.info('Processing...')` in every handler | Automatic |
| Metrics (success/fail) | `addMetric('EventProcessed'/'EventFailed')` | Automatic |
| Error classification | `isRetryable(error)` in every catch | Automatic |
| Error publishing | `publishErrorEvent(bus, type, error)` in every catch | Automatic |
| Batch failure collection | `failures.push(messageId)` | Automatic |
| **Idempotency** | **Explicit per method call** | **Declared per event type** |
| Unknown event types | `if (!HANDLED.has(type)) return` | Automatic (warn + skip) |

### Strategy implementations inside the framework

#### `putIfNotExists`
```typescript
// Handler returns the item to write
const item = await config.process(payload, ctx);
const created = await deps.repository.putIfNotExists(item);
if (!created) {
  logger.info('Duplicate event, skipping', { eventId: ctx.eventId, eventType: ctx.eventType });
  return; // metrics still recorded as 'EventDeduplicated'
}
```

#### `guardedWrite`
```typescript
// Handler returns guard key + transaction items
const { guardKey, transactItems, ttl } = await config.process(payload, ctx);
// Default guardKey: { pk: entityPk, sk: `ProcessedEvent#${ctx.eventId}` }
const written = await guardedWrite(deps.docClient, deps.tableName, guardKey, transactItems, ttl);
if (!written) {
  logger.info('Guard marker exists, skipping', { eventId: ctx.eventId });
  return;
}
```

#### `upsert`
```typescript
// No guard — just run the handler
await config.process(payload, ctx);
// Framework still logs, traces, metrics — but no dedup check
```

### New metric: `EventDeduplicated`

The framework emits a **dedicated metric** when a duplicate is detected, giving visibility into replay rates without relying on log searches.

---

## Impact Analysis: Mapping Current Services

### investor-ctrl (9 event types)
| Event | Current | Proposed Strategy | Notes |
|-------|---------|-------------------|-------|
| ONBOARDING_COMPLETED | No guard (lifecycle service) | `upsert` | Overwrites profile state |
| MANDATE_GRANTED | No guard | `upsert` | Updates mandate status |
| GOAL_UPDATED | No guard | `upsert` | Overwrites goal |
| DEPOSIT_INITIATED | No guard | `upsert` | Updates deposit status |
| OPERATING_MODE_CHANGED | No guard | `upsert` | Overwrites mode |
| DECISION_APPROVED | No guard | `putIfNotExists` | Creates notification — needs guard |
| ORDER_FILLED | No guard | `putIfNotExists` | Creates notification — needs guard |
| BALANCE_UPDATED | No guard | `upsert` | Overwrites balance display |

### investor-bff (3 event types)
| Event | Current | Proposed Strategy |
|-------|---------|-------------------|
| USER_REGISTERED | putIfNotExists (pipe) | `putIfNotExists` |
| NOTIFICATION_CREATED | putIfNotExists (pipe) | `putIfNotExists` |
| BALANCE_UPDATED | upsert (pipe) | `upsert` |

### dashboard-bff (8 event types, 6 pipes)
| Event | Current | Proposed Strategy | Notes |
|-------|---------|-------------------|-------|
| PORTFOLIO_UPDATED | upsert (PortfolioSummaryPipe) | `upsert` | |
| ORDER_FILLED | putIfNotExists (PositionSnapshotPipe) | `putIfNotExists` | |
| Various → RecentActivityPipe | putIfNotExists + guardedWrite | `guardedWrite` | Additive: counter + activity |
| Various → AdvisoryStatusPipe | guardedWrite | `guardedWrite` | Additive: status counter |
| Various → InvestorSnapshotPipe | upsert | `upsert` | |
| BALANCE_UPDATED → TimeTravelAvailabilityPipe | upsert | `upsert` | |

### advisory-ctrl (9+ event types)
| Event | Current | Proposed Strategy | Notes |
|-------|---------|-------------------|-------|
| MANDATE_GRANTED | upsert | `upsert` | Updates decision context |
| GOAL_UPDATED | upsert | `upsert` | |
| RISK_PROFILE_UPDATED | upsert | `upsert` | |
| PORTFOLIO_DRIFT_DETECTED | putIfNotExists | `putIfNotExists` | Creates decision packet |
| ORDER_FILLED/REJECTED/CANCELLED | upsert | `upsert` | Updates decision status |
| DEPOSIT_DETECTED | putIfNotExists | `putIfNotExists` | Creates decision packet |

### advisory-bff (5 event types)
| Event | Current | Proposed Strategy |
|-------|---------|-------------------|
| DECISION_PACKET_CREATED | putIfNotExists (pipe) | `putIfNotExists` |
| DECISION_PACKET_ENRICHED | upsert (pipe) | `upsert` |
| DECISION_APPROVED | upsert (pipe) | `upsert` |
| DECISION_BLOCKED | upsert (pipe) | `upsert` |
| USER_CONFIRMATION_REQUESTED | upsert (pipe) | `upsert` |

### compliance-ctrl (6 event types)
| Event | Current | Proposed Strategy | Notes |
|-------|---------|-------------------|-------|
| DECISION_PACKET_CREATED | No direct writes (rule engine → event) | `custom` | Forwards enriched event |
| MANDATE_GRANTED/UPDATED/REVOKED | upsert | `upsert` | Rule cache update |
| OPERATING_MODE_CHANGED | upsert | `upsert` | |

### execution-ctrl (1 event type)
| Event | Current | Proposed Strategy | Notes |
|-------|---------|-------------------|-------|
| DECISION_APPROVED | putIfNotExists | `putIfNotExists` | Creates staged order |

### execution-adpt (3 event types)
| Event | Current | Proposed Strategy | Notes |
|-------|---------|-------------------|-------|
| ORDER_SUBMITTED | guardedWrite (executeTrade) | `guardedWrite` | Trade execution + balance update |
| WITHDRAWAL_REQUESTED | guardedWrite | `guardedWrite` | Balance decrement |
| DEPOSIT_INITIATED | guardedWrite | `guardedWrite` | Balance increment |

### ledger-ctrl (8 event types)
| Event | Current | Proposed Strategy | Notes |
|-------|---------|-------------------|-------|
| ORDER_FILLED | putIfNotExists | `putIfNotExists` | Ledger entry |
| ORDER_PARTIALLY_FILLED | putIfNotExists | `putIfNotExists` | |
| ORDER_REJECTED | putIfNotExists | `putIfNotExists` | |
| ORDER_CANCELLED | putIfNotExists | `putIfNotExists` | |
| DEPOSIT_DETECTED | putIfNotExists | `putIfNotExists` | |
| WITHDRAWAL_COMPLETED | putIfNotExists | `putIfNotExists` | |
| CORPORATE_ACTION_PROCESSED | putIfNotExists | `putIfNotExists` | |
| DECISION_PACKET_CREATED | putIfNotExists | `putIfNotExists` | Simulation entry |

### ledger-bff (3 event types)
| Event | Current | Proposed Strategy |
|-------|---------|-------------------|
| BALANCE_UPDATED | upsert (pipe) | `upsert` |
| PORTFOLIO_UPDATED | upsert (pipe) | `upsert` |
| LEDGER_ENTRY_RECORDED | putIfNotExists (pipe) | `putIfNotExists` |

### reconciliation-ctrl (3 event types)
| Event | Current | Proposed Strategy |
|-------|---------|-------------------|
| LEDGER_ENTRY_RECORDED | putIfNotExists | `putIfNotExists` |
| ORDER_FILLED | putIfNotExists | `putIfNotExists` |
| CORPORATE_ACTION_PROCESSED | putIfNotExists | `putIfNotExists` |

---

## Special Cases

### Reducer (ledger-ctrl)
- **Trigger**: DDB Stream (not SQS)
- **Pattern**: Replays events via `replayEvents()` → saves snapshot
- **Strategy**: `custom` — the reducer is idempotent by design (replays produce same snapshot)
- **Not covered** by the event processor framework (different trigger type)

### GraphQL Resolvers (mutations)
- Currently moving to JS pipeline resolvers (AppSync runtime)
- Mutations that write data go through `checkAuth.fn.js → businessLogic.fn.js`
- Idempotency for mutations is a **separate concern** (client-side idempotency keys)
- **Not covered** by the event processor framework (different entry point)

### Pipes (BFF services)
- investor-bff, advisory-bff, dashboard-bff, ledger-bff use Pipe classes
- Each pipe has a `process()` method with its own write logic
- **Migration path**: Pipe.process() returns a `ProcessResult` that the framework interprets
- Pipes map 1:1 to event types, so they fit naturally into the `handlers` config

---

## Strategy Decision Matrix

```
Is the write additive (increment/counter)?
  YES → guardedWrite (atomic guard + business write)
  NO → Is the write creating a new entity?
    YES → putIfNotExists (conditional create)
    NO → Is the write overwriting/replacing state?
      YES → upsert (naturally idempotent, no guard)
      NO → custom (escape hatch)
```

---

## Open Questions

1. **Pipe integration**: Should pipes keep their `process()` method and the framework wraps them, or should pipes be replaced entirely by handler functions in the config?

2. **Multi-write events**: Some events trigger multiple writes (e.g., dashboard-bff's RecentActivityPipe does putIfNotExists + guardedWrite counter increment). How does the framework handle mixed strategies for a single event?

3. **Event forwarding**: compliance-ctrl processes events and forwards enriched events to EventBridge. The "write" is an event publish, not a DDB write. Should the framework support `publishIfNotProcessed` as a strategy?

4. **Granularity**: Should the framework be the **only** way to write in event listeners (enforced by linting/convention), or an optional layer that coexists with manual processing?

5. **Testing**: The framework would need to be testable in isolation. Should `EventProcessorConfig` accept a `repository` interface, or should it work with raw `DynamoDBDocumentClient`?

6. **Reducer/Stream handlers**: Should there be a parallel `createStreamProcessor` for DDB Stream triggers, or are those rare enough to stay manual?
