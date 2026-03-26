# broker-ctrl Order State Machine — Step Functions Design

Exploratory design for implementing the broker-ctrl order state machine as a Step Functions Standard Workflow.

## Overview

One SF execution per order. Started when `ORDER_SUBMITTED` arrives. The SF orchestrates routing, fill tracking, retries, timeouts, and normalization. DynamoDB is still used as a queryable read model (BrokerOrder entity).

## State Machine

```mermaid
stateDiagram-v2
    [*] --> LookupExecutionMode

    LookupExecutionMode: Read ExecutionMode from DDB
    LookupExecutionMode --> CheckCircuitBreaker

    CheckCircuitBreaker: Read CircuitBreaker state
    CheckCircuitBreaker --> CircuitBreakerOpen: OPEN
    CheckCircuitBreaker --> RouteOrder: CLOSED

    CircuitBreakerOpen: Wait until breaker closes
    CircuitBreakerOpen --> QueuedWait
    QueuedWait: Wait(30s) then re-check
    QueuedWait --> CheckCircuitBreaker

    state RouteOrder <<choice>>
    RouteOrder --> EmitSimOrder: mode = simulation
    RouteOrder --> EmitAlpacaOrder: mode = live

    EmitSimOrder: Emit SIM_ORDER_REQUESTED\n(Lambda: publish to EventBridge)
    EmitSimOrder --> WriteDDB_Routing

    EmitAlpacaOrder: Emit ALPACA_ORDER_REQUESTED\n(Lambda: publish to EventBridge)
    EmitAlpacaOrder --> WriteDDB_Routing

    WriteDDB_Routing: Write BrokerOrder\nstate=AWAITING_FILL\n(Lambda: DDB put)
    WriteDDB_Routing --> WaitForResult

    state WaitForResult {
        [*] --> WaitForCallback
        WaitForCallback: WaitForTaskCallback\nHeartbeatTimeout: 30s\nTimeout: 5min (configurable)

        WaitForCallback --> ProcessResult: callback received
        WaitForCallback --> OrderTimedOut: timeout
        WaitForCallback --> HeartbeatReceived: heartbeat (partial updates)

        HeartbeatReceived --> WaitForCallback
    }

    ProcessResult: Parse adapter result\n(from SendTaskSuccess payload)
    ProcessResult --> ClassifyResult

    state ClassifyResult <<choice>>
    ClassifyResult --> HandleFilled: FILLED
    ClassifyResult --> HandlePartialFill: PARTIALLY_FILLED
    ClassifyResult --> HandleRejected: REJECTED (deterministic)
    ClassifyResult --> HandleTransientError: REJECTED (transient)

    HandleFilled: Lambda: Write BrokerOrder\nstate=FILLED
    HandleFilled --> NormalizeFilled

    NormalizeFilled: Lambda: Write normalized\nORDER_FILLED to DDB → CDC
    NormalizeFilled --> [*]

    HandlePartialFill: Lambda: Update BrokerOrder\nfilledQty, remainingQty
    HandlePartialFill --> NormalizePartialFill

    NormalizePartialFill: Lambda: Write normalized\nORDER_PARTIALLY_FILLED to DDB → CDC
    NormalizePartialFill --> WaitForRemainder

    state WaitForRemainder {
        [*] --> WaitForNextFill
        WaitForNextFill: WaitForTaskCallback\nTimeout: 15min

        WaitForNextFill --> ProcessRemainderResult: callback
        WaitForNextFill --> RemainderTimedOut: timeout

        ProcessRemainderResult --> RemainderFilled: FILLED (full qty reached)
        ProcessRemainderResult --> AnotherPartial: PARTIALLY_FILLED
        ProcessRemainderResult --> RemainderRejected: REJECTED

        AnotherPartial: Update qty, emit\nORDER_PARTIALLY_FILLED
        AnotherPartial --> WaitForNextFill

        RemainderFilled --> [*]
        RemainderRejected --> [*]
        RemainderTimedOut --> [*]
    }

    WaitForRemainder --> HandleRemainderOutcome

    state HandleRemainderOutcome <<choice>>
    HandleRemainderOutcome --> NormalizeFilled: all filled
    HandleRemainderOutcome --> EscalatePartial: timed out or rejected

    EscalatePartial: Lambda: Write BrokerOrder\nstate=ESCALATED\nEmit ORDER_ESCALATED → CDC
    EscalatePartial --> [*]

    state RetryLoop {
        [*] --> IncrementRetry
        IncrementRetry: Lambda: retryCount + 1\nUpdate BrokerOrder
        IncrementRetry --> RetryWait
        RetryWait: Wait(exponential backoff)\n5s → 15s → 45s
        RetryWait --> ReEmitOrder
        ReEmitOrder: Lambda: Re-emit\nSIM_*/ALPACA_* to EventBridge
        ReEmitOrder --> WaitForRetryResult
        WaitForRetryResult: WaitForTaskCallback\nTimeout: 5min
        WaitForRetryResult --> RetryResultReceived: callback
        WaitForRetryResult --> RetryTimedOut: timeout
    }

    HandleTransientError --> CheckRetryCount

    state CheckRetryCount <<choice>>
    CheckRetryCount --> RetryLoop: retryCount < 3
    CheckRetryCount --> MaxRetriesExhausted: retryCount >= 3

    RetryLoop --> RetryOutcome

    state RetryOutcome <<choice>>
    RetryOutcome --> HandleFilled: FILLED
    RetryOutcome --> HandlePartialFill: PARTIALLY_FILLED
    RetryOutcome --> HandleTransientError: transient again
    RetryOutcome --> HandleRejected: deterministic
    RetryOutcome --> OrderTimedOut: timed out

    MaxRetriesExhausted: Lambda: Write BrokerOrder\nstate=FAILED
    MaxRetriesExhausted --> NormalizeRejected

    HandleRejected: Lambda: Write BrokerOrder\nstate=REJECTED
    HandleRejected --> NormalizeRejected

    NormalizeRejected: Lambda: Write normalized\nORDER_REJECTED to DDB → CDC
    NormalizeRejected --> [*]

    OrderTimedOut: Lambda: Open circuit breaker\n(instrument-level)\nWrite BrokerOrder state=ESCALATED
    OrderTimedOut --> NormalizeEscalated

    NormalizeEscalated: Lambda: Write\nORDER_ESCALATED to DDB → CDC
    NormalizeEscalated --> [*]
```

## Task Token Flow

The critical integration point: how does an async EventBridge event callback into a running SF execution?

```mermaid
sequenceDiagram
    participant SF as Step Functions<br/>(order execution)
    participant L1 as broker-ctrl Lambda<br/>(SF task runner)
    participant EB as EventBridge<br/>(ExecutionBus)
    participant Adapter as broker-*-adpt
    participant L2 as broker-ctrl Lambda<br/>(event listener)
    participant DDB as DynamoDB

    SF->>L1: Invoke with taskToken
    L1->>DDB: Store taskToken on BrokerOrder record
    L1->>EB: Emit ALPACA_ORDER_REQUESTED<br/>(includes orderId)
    L1-->>SF: (Lambda returns, SF waits)

    EB->>Adapter: ALPACA_ORDER_REQUESTED
    Adapter->>Adapter: POST /v2/orders
    Adapter->>EB: ALPACA_ORDER_FILLED<br/>(CDC, includes orderId)

    EB->>L2: ALPACA_ORDER_FILLED
    L2->>DDB: Lookup taskToken by orderId
    L2->>SF: SendTaskSuccess(taskToken, result)

    SF->>SF: Continue to ClassifyResult
```

### Key: taskToken stored in DDB, not in the event payload

The task token is NOT passed through the adapter. Instead:
1. SF invokes Lambda with `taskToken` in the context
2. Lambda stores `taskToken` on the `BrokerOrder` DDB record (keyed by orderId)
3. When the result event arrives, the event-listener Lambda looks up the `taskToken` from DDB by orderId
4. Lambda calls `SendTaskSuccess(taskToken, result)` to resume SF

This avoids coupling adapters to SF task tokens — adapters remain thin and unaware of orchestration.

## Cancel Flow (Parallel Branch)

Cancellation can arrive at any point while the order is in `AWAITING_FILL` or `PARTIALLY_FILLED`. This is handled by a **parallel SF branch** that listens for cancel requests.

```mermaid
stateDiagram-v2
    state OrderExecution {
        state MainFlow {
            [*] --> Route
            Route --> WaitForFill
            WaitForFill --> ProcessFill
        }
        state CancelListener {
            [*] --> WaitForCancelRequest
            WaitForCancelRequest: WaitForTaskCallback\n(separate taskToken for cancel)
            WaitForCancelRequest --> EmitCancel: cancel requested
            EmitCancel: Emit ALPACA_ORDER_CANCEL_REQUESTED
            EmitCancel --> WaitForCancelResult
            WaitForCancelResult: WaitForTaskCallback
            WaitForCancelResult --> CancelSucceeded: CANCELLED
            WaitForCancelResult --> CancelFailed: CANCEL_FAILED
        }
    }
```

This requires storing TWO task tokens per order in DDB:
- `fillTaskToken` — for fill/rejection results
- `cancelTaskToken` — for cancel results

When cancel succeeds, the parallel branch completes and the main flow is terminated.

## DDB Entity (updated for SF)

```
pk: BrokerOrder#{tenantId}#{orderId}
sk: BrokerOrder

{
  tenantId, orderId, executionMode,
  state: ROUTING | AWAITING_FILL | FILLED | PARTIALLY_FILLED | REJECTED | FAILED | ESCALATED | CANCEL_REQUESTED | CANCELLED,
  routedTo: 'sim' | 'alpaca',
  alpacaOrderId: string | null,

  // SF integration
  sfExecutionArn: string,
  fillTaskToken: string | null,     // active WaitForCallback token for fills
  cancelTaskToken: string | null,   // active WaitForCallback token for cancel

  // fill tracking
  requestedQty, filledQty, remainingQty,
  fills: [{ qty, price, timestamp }],

  // failure tracking
  retryCount: number,
  lastFailureReason: string,
  failureClass: 'transient' | 'deterministic' | 'ambiguous',

  instrumentId: string,
  routedAt, lastUpdateAt, timeoutAt
}
```

## Honest Assessment

### What this design reveals

**Gains over Lambda+DDB:**
- Timeout handling is elegant — `WaitForTaskCallback` with timeout replaces separate SF Express executions
- Retry backoff is declarative — `Wait` states with increasing durations, loop naturally
- Partial fill tracking is a clean loop — not scattered across multiple Lambda invocations
- Cancel as parallel branch is expressive — captures the real concurrency model
- Full execution history in SF console — every state transition recorded, debuggable

**Pain points:**
- **Two task tokens per order** — fill and cancel are concurrent concerns, each needs its own callback
- **DDB is still required** — for task token lookup (mapping orderId → taskToken) and queryable read model
- **Lambda count increases** — each SF state that "does something" is a Lambda invocation. Route (1) + emit (1) + write DDB (1) + normalize (1) = 4+ Lambdas per happy path, vs. 1-2 in the event-driven approach
- **Circuit breaker polling loop** — the `QueuedWait → re-check` loop in SF is clunky compared to event-driven "resume when breaker closes"
- **Standard Workflow cost** — ~$0.025 per 1000 transitions. An order with retries might hit 15-20 transitions. Still cheap for personal use.
- **CDK verbosity** — defining this in CDK is significantly more code than the Lambda+DDB approach

### When SF would clearly win

- High order volume where visual debugging matters
- Complex order types (bracket orders, OCO, multi-leg) where the state machine grows
- Regulatory audit requirements (SF provides immutable execution history)

### When Lambda+DDB clearly wins

- Low volume personal use
- Simpler testing (unit test Lambdas in isolation)
- Fewer moving parts
- Consistent with the rest of the event-driven architecture
