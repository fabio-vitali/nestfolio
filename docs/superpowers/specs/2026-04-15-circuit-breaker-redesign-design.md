# Circuit Breaker Redesign + Feature Flags

## Problem Statement

The circuit breaker feature has four issues:

1. **Advisory-initiated circuit breaker (Flows A/B) is dead scaffolding.** Event routing infrastructure exists (adapter rules, skip handlers, event types) but the advisory agent never triggers it, execution-ctrl doesn't enforce it, and no state is checked before order execution. It provides false safety confidence.

2. **Broker circuit breaker (Flow C) is scoped per-tenant-per-symbol.** When Alpaca goes down, it's globally down — but each tenant's each symbol independently discovers this via 300s timeouts, opening N×M breakers and launching N×M parallel HealStateMachines that all ping Alpaca simultaneously.

3. **The circuit breaker lives in the wrong service.** broker-ctrl (broker-agnostic orchestrator) owns detection, state, and healing — but broker-alpaca-adpt is the service that talks to Alpaca and knows immediately when it fails. The 300s timeout in broker-ctrl is a delayed, indirect detection of what the adapter already knew in seconds.

4. **Zero investor visibility.** No notification, no feature gating, no UI indication. Orders silently fail, escalate, and are abandoned. The investor has no idea.

## Decisions Made During Design

| Decision | Choice | Rationale |
|---|---|---|
| Circuit breaker scope | Per-broker-adapter (`CircuitBreaker#alpaca`) | Failure domain is the adapter, not tenant or symbol |
| Breaker trigger | Health-check-first (verify before opening) | Avoid false positives from transient failures |
| Breaker owner | broker-alpaca-adpt | Adapter detects failure immediately; no 300s wait |
| Health check mechanism | SF HTTP:Invoke with native retry/backoff | No new Lambda; EB Connection handles Alpaca auth (apiKey + headerParameters) |
| HealSM CDK construct | Generic `CircuitBreakerHealDefinition` in libs/cdk-constructs | Reusable by future adapters; parameterized event names and health check config |
| Runtime repository | Per-service, not shared | ~30 lines of DDB ops; not worth extracting |
| Schema ownership | Each service defines its own CircuitBreakerSchema | Event schemas belong to the service that owns them |
| Investor notification mechanism | Event-driven materialization in investor-bff | BFF is the CQRS read side; system state for the UI belongs there |
| Feature flags approach | Generic `getFeatureFlags` query + `onFeatureFlagUpdate` subscription | Reusable for future flags beyond circuit breaker |
| Feature flags shared lib | Frontend Angular lib in libs/ui/feature-flags | Inspired by shape-frontends feature-access pattern (store + guard + directive) |
| Subscription trigger | AppSync IAM mutation `updateFeatureFlag` called from investor-bff event-listener | Standard AppSync pattern: mutations trigger subscriptions |
| Subscription initialization | Shell-level at app boot | Feature flags are cross-cutting; can't wait for MFE lazy load |
| Notification tone | Action-oriented | "Deposits, withdrawals, and accepting decisions are temporarily paused" — tells what, not why |
| System-wide notifications | `tenantId: 'SYSTEM'` | Avoids fan-out to all tenants; investor-bff query includes SYSTEM notifications |
| Mutation gating | investor-bff pipeline resolver step + frontend button disable | advisory-bff not gated (frontend disables button; adapter rejects as fallback) |
| Mutation error type | GraphQL error (`SERVICE_TEMPORARILY_UNAVAILABLE`) | Frontend catches generically from errors[] array |
| Advisory-bff guard | Not needed | Frontend disables confirmDecision button; adapter rejects if race condition leaks through |
| Banner + notification | Both | Banner for real-time visibility; notification for history |

## Scope

### Part 1: Cleanup — Remove Advisory Circuit Breaker Scaffolding

Pure deletion. No new code.

**Files to edit:**

| File | Change |
|---|---|
| `services/advisory/advisory-ctrl/src/domain/events.ts` | Remove `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET` |
| `services/advisory/advisory-adpt/src/domain/events.ts` | Remove same |
| `services/execution/execution-adpt/src/domain/events.ts` | Remove same |
| `services/execution/execution-adpt/src/service.stack.ts` | Remove from `fromAdvisoryEvents` array |
| `services/investor/investor-adpt/src/domain/events.ts` | Remove same |
| `services/investor/investor-adpt/src/service.stack.ts` | Remove from `fromAdvisoryEvents` array |
| `services/execution/execution-ctrl/src/handlers/event-listener.ts` | Remove two skip handlers |
| `services/execution/execution-ctrl/src/service.stack.ts` | Remove two Ingress subscriptions |
| `services/execution/execution-ctrl/test/unit/event-listener.test.ts` | Remove two unit tests |
| `services/execution/execution-ctrl/test/integration/execution-ctrl.integration.test.ts` | Remove two integration tests |
| `flows/circuit-breaker.flow.yaml` | Delete file entirely (replaced by new flow spec in Part 5) |

### Part 2: Redesign — Adapter-Owned Circuit Breaker

#### 2A. Generic CDK Construct — `CircuitBreakerHealDefinition`

**Location:** `libs/cdk-constructs/src/core/circuit-breaker-heal.ts`

**API:**

```typescript
export interface CircuitBreakerHealDefinitionProps {
  readonly table: ITable;
  readonly breakerKey: string;                    // e.g. 'CircuitBreaker#alpaca'
  readonly events: {
    readonly closed: string;                      // e.g. 'BROKER_CIRCUIT_CLOSED'
    readonly escalated: string;                   // e.g. 'BROKER_HEAL_ESCALATED'
  };
  readonly healthCheck: {
    readonly connection: events.IConnection;
    readonly apiRoot: string;
    readonly apiEndpoint: sfn.TaskInput;
    readonly method: sfn.TaskInput;
    readonly timeoutSeconds?: number;             // default 10
  };
  readonly retry?: {
    readonly maxAttempts?: number;                 // default 10
    readonly intervalSeconds?: number;            // default 60
  };
  readonly healthCheckRetry?: {
    readonly maxAttempts?: number;                 // default 3
    readonly intervalSeconds?: number;            // default 5
    readonly backoffRate?: number;                // default 2
  };
}

export class CircuitBreakerHealDefinition extends Construct {
  readonly definitionBody: sfn.DefinitionBody;
}
```

**State machine chain:**

```
InitAttemptCount (Pass: attemptCount=0)
  → HealthCheck (HTTP:Invoke with Retry policy)
    → success → CloseBreaker (DDB UpdateItem: state=CLOSED)
      → EmitBreakerClosed (DDB PutItem: NormalizedEvent sk={events.closed}#{timestamp})
        → EndHealed (Succeed)
    → catch → IncrementAttempt (Pass: attemptCount + 1)
      → CheckAttemptLimit (Choice)
        → < maxAttempts → WaitForRetry (Wait intervalSeconds)
          → HealthCheck (loop)
        → >= maxAttempts → EscalateHealFailure (DDB PutItem: NormalizedEvent sk={events.escalated}#{timestamp})
          → EndEscalated (Fail)
```

**Key details:**
- `breakerKey` is used directly in DDB Key expressions (no format assumptions)
- `events.closed` and `events.escalated` are used as NormalizedEvent sk prefixes for CDC passthrough
- No schema imports, no event type enum imports — pure string parameterization
- `definitionBody` is consumed by the existing `Orchestration` construct

**Tests:** `libs/cdk-constructs/test/unit/circuit-breaker-heal.test.ts` — CDK assertion tests for generated SF definition (state names, DDB keys, HTTP:Invoke config, retry policy).

#### 2B. broker-alpaca-adpt — Circuit Breaker Owner

**New files:**

| File | Purpose |
|---|---|
| `src/domain/schemas.ts` | Add `CircuitBreakerSchema` (Zod: pk, sk, __typename, state, adapter, openedAt, closedAt, reason) |
| `src/repositories/circuit-breaker.repository.ts` | `isOpen(adapterId)`, `open(adapterId, reason)` (conditional write), `close(adapterId)` |

**Modified files:**

| File | Change |
|---|---|
| `src/handlers/event-listener.ts` | Add breaker check at handler entry; add failure detection + breaker opening on Alpaca failure |
| `src/domain/events.ts` | Add `BROKER_CIRCUIT_OPEN`, `BROKER_CIRCUIT_CLOSED`, `BROKER_HEAL_ESCALATED` to outbound event types |
| `src/service.stack.ts` | Add EB Connection, CircuitBreakerHealDefinition, third Orchestration, Egress eventTypes for circuit breaker events |
| `src/clients/alpaca.client.ts` | Add retry logic (3 attempts, exponential backoff) on API calls |

**Event-listener handler changes:**

```typescript
// Pseudocode — all handlers gain a breaker check preamble
async function processOrderRequested(payload: EventPayload, ctx: EventContext) {
  // 1. Check breaker
  if (await circuitBreakerRepo.isOpen('alpaca')) {
    return record('AlpacaOrderResult', {
      status: 'REJECTED',
      rejectionReason: 'BROKER_UNAVAILABLE',
      ...orderFields(payload),
    }, { pk: ..., sk: ... });
  }

  // 2. Call Alpaca (client now has internal 3x retry with backoff)
  try {
    const result = await ordersService.submitOrder(...);
    return record('AlpacaOrderResult', result, { pk: ..., sk: ... });
  } catch (error) {
    // 3. All retries failed — verify broker is down
    const isDown = await isBrokerDown();  // lightweight GET /v2/account via client
    if (isDown) {
      await circuitBreakerRepo.open('alpaca', 'API unreachable after retries');
      // Write NormalizedEvent for CDC → BROKER_CIRCUIT_OPEN
      // (this triggers HealSM via Orchestration)
    }
    return record('AlpacaOrderResult', {
      status: 'REJECTED',
      rejectionReason: isDown ? 'BROKER_UNAVAILABLE' : error.message,
      ...orderFields(payload),
    }, { pk: ..., sk: ... });
  }
}
```

The same pattern applies to `processTransferRequested`, `processCancelRequested`, and `processAccountCheck`.

**`isBrokerDown()` function:**
- Calls `alpacaClient.getAccount()` (single attempt, short timeout ~5s)
- Returns `true` if broker is unreachable, `false` if the previous failure was transient
- This prevents opening the breaker for a single flaky request

**Service stack changes:**

```typescript
// New: EventBridge Connection for Alpaca auth
const alpacaConnection = new events.Connection(this, 'AlpacaConnection', {
  authorization: events.Authorization.apiKey(
    'APCA-API-KEY-ID',
    SecretValue.secretsManager(`${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`, { jsonField: 'apiKeyId' }),
  ),
  headerParameters: {
    'APCA-API-SECRET-KEY': events.HttpParameter.fromSecret(
      SecretValue.secretsManager(`${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`, { jsonField: 'apiKeySecret' }),
    ),
  },
});

// New: Heal workflow definition (generic construct)
const healWorkflow = new CircuitBreakerHealDefinition(this, 'HealWorkflow', {
  table: state.getTable(),
  breakerKey: 'CircuitBreaker#alpaca',
  events: {
    closed: AlpacaAdptEventTypes.BROKER_CIRCUIT_CLOSED,
    escalated: AlpacaAdptEventTypes.BROKER_HEAL_ESCALATED,
  },
  healthCheck: {
    connection: alpacaConnection,
    apiRoot: alpacaBaseUrl,   // resolved from SSM at deploy time
    apiEndpoint: sfn.TaskInput.fromText('/v2/account'),
    method: sfn.TaskInput.fromText('GET'),
    timeoutSeconds: 10,
  },
});

// New: Third Orchestration
const healOrchestration = new Orchestration(this, 'HealStateMachine', {
  state,
  definitionBody: healWorkflow.definitionBody,
  triggers: [AlpacaAdptEventTypes.BROKER_CIRCUIT_OPEN],
  timeout: Duration.hours(2),
});
```

**Egress eventTypes additions:**

The circuit breaker events use the **Passthrough** pattern (not FieldDispatch), because the sk value includes a timestamp suffix (e.g., `BROKER_CIRCUIT_OPEN#2026-04-15T10:00:00Z`). Passthrough splits on `#` and matches the prefix.

```typescript
eventTypes: {
  // existing...
  'AlpacaOrderResult': { insert: { field: 'status', map: { ... } } },
  // new circuit breaker events (NormalizedEvent INSERT, sk passthrough)
  'NormalizedEvent': {
    insert: {
      field: 'sk',
      passthrough: true,
      emits: [
        AlpacaAdptEventTypes.BROKER_CIRCUIT_OPEN,
        AlpacaAdptEventTypes.BROKER_CIRCUIT_CLOSED,
        AlpacaAdptEventTypes.BROKER_HEAL_ESCALATED,
      ],
    },
  },
}
```

**Event source change:** These events were previously emitted by broker-ctrl (source `ExecutionBus@broker-ctrl`). After the redesign, the source changes to `ExecutionBus@broker-alpaca-adpt`. The investor-adpt EB rules match on `detail-type` only (not source), so forwarding is unaffected. No consumers filter by source for these events.

**Singleton guard for HealSM:**
The Orchestration construct must be enhanced to support a fixed `executionName` prop. When provided, the EventBridge target uses this fixed name for StartExecution, making it idempotent — SF ignores duplicate starts with the same name within the execution window. This prevents N concurrent heal workflows.

```typescript
const healOrchestration = new Orchestration(this, 'HealStateMachine', {
  state,
  definitionBody: healWorkflow.definitionBody,
  triggers: [AlpacaAdptEventTypes.BROKER_CIRCUIT_OPEN],
  timeout: Duration.hours(2),
  executionName: 'heal-alpaca',  // new prop — ensures singleton
});
```

The Orchestration construct change: add optional `executionName?: string` to `OrchestrationProps`. CDK's `SfnStateMachine` EventBridge target does not directly expose `executionName`, so the implementation requires an L1 override on the `CfnRule` target to set `StepFunctionsParameters.Name`. This is a small, backward-compatible enhancement but requires CloudFormation-level manipulation rather than a simple CDK prop. The implementation plan should treat this as a discrete task.

**IAM grants for HTTP:Invoke + EB Connection:**

The SF role needs permissions to use the EB Connection's credentials at runtime:
- `events:RetrieveConnectionCredentials` on the Connection ARN
- `secretsmanager:GetSecretValue` and `secretsmanager:DescribeSecret` on the Connection's secret ARN

The `CircuitBreakerHealDefinition` construct should accept the `connection` prop and call `connection.grant(stateMachine.role, ...)` or the Orchestration construct should handle this via a new `grantConnection(connection)` method. Implementation detail to be resolved during planning.

**Alpaca base URL — deploy-time baking:**

The EB Connection's `apiRoot` is resolved from SSM at deploy time (`StringParameter.valueForStringParameter()`), baked into the SF definition. This is a behavioral change from the current runtime resolution (Lambda reads SSM on cold start via Parameters and Secrets Extension). This is acceptable — the Alpaca API URL rarely changes, and a URL change would require redeployment anyway. Worth noting: changing the URL in SSM without redeploying broker-alpaca-adpt will NOT affect the heal workflow's health check (it will still use the old URL).

**DDB record:**

```
pk: CircuitBreaker#alpaca
sk: CircuitBreaker
__typename: CircuitBreaker
state: OPEN | CLOSED
adapter: alpaca
openedAt: ISO timestamp
closedAt: ISO timestamp
reason: string
```

**Tests:**

| Test file | Coverage |
|---|---|
| `test/unit/event-listener.test.ts` | Breaker check → immediate rejection; failure detection → open breaker; verify-health inline check |
| `test/unit/circuit-breaker.repository.test.ts` | isOpen, open (conditional), close |
| `test/unit/service.stack.test.ts` | CDK assertions: EB Connection, HealSM Orchestration, Egress eventTypes |
| `test/integration/broker-alpaca-adpt.integration.test.ts` | End-to-end: open breaker → reject subsequent requests → close breaker → accept again |

#### 2C. broker-ctrl — Simplification

**Removed files:**

| File | Reason |
|---|---|
| `src/repositories/circuit-breaker.repository.ts` | Breaker state no longer in broker-ctrl |
| `src/state-machine/circuit-breaker-heal.ts` | HealSM moved to broker-alpaca-adpt (generic construct) |
| `src/handlers/emit-health-check.ts` | Replaced by HTTP:Invoke in broker-alpaca-adpt |
| `test/unit/circuit-breaker.repository.test.ts` | Repository removed |
| `test/unit/emit-health-check.test.ts` | Handler removed |

**Modified files:**

| File | Change |
|---|---|
| `src/service.stack.ts` | Remove HealStateMachine Orchestration, emit-health-check Lambda, grantCallbackAccess for heal. Remove BROKER_CIRCUIT_OPEN/CLOSED/HEAL_ESCALATED from Egress eventTypes. Remove ALPACA_ACCOUNT_SNAPSHOT from callback-ingress subscriptions. |
| `src/state-machine/order-state-machine.ts` | Remove: ReadCircuitBreaker, IsCircuitBreakerOpen, BreakerWait, retry loop (CheckRetryCount, IncrementRetry, RetryBackoff, WaitForRetryResult), HandleTimeout branches for OpenBreaker and CircuitBreakerEvent. Add: BROKER_UNAVAILABLE classification in ClassifyResult (adapter rejected due to breaker). |
| `src/handlers/callback-resolver.ts` | Remove CircuitBreakerRepository import, ALPACA_ACCOUNT_SNAPSHOT handler, healTaskToken resolution. Keep order fill/rejection/cancel callback resolution. |
| `src/domain/events.ts` | Remove BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED from BrokerCtrlEventTypes. Remove ALPACA_ACCOUNT_SNAPSHOT from BrokerCtrlInboundEventTypes. |
| `src/domain/schemas.ts` | Remove CircuitBreakerSchema. |
| `src/domain/index.ts` | Remove CircuitBreaker exports. |

**Simplified OrderStateMachine flow:**

```
ReadExecutionMode
  → RouteOrder (Lambda invoke.waitForTaskToken, 300s timeout)
    → ClassifyResult (Choice)
      ├─ FILLED → MarkFilled (Parallel: UpdateOrder + NormalizedEvent) → EndFilled
      ├─ PARTIALLY_FILLED → MarkPartialFill → WaitForMoreFills → ClassifyResult
      └─ default (REJECTED, BROKER_UNAVAILABLE, etc.) → MarkRejected (Parallel: UpdateOrder + NormalizedEvent) → EndRejected
    (timeout) → HandleTimeout (Parallel: EscalateOrder + NormalizedEvent ORDER_ESCALATED) → EndEscalated
```

The state machine drops from ~550 lines to ~300 lines.

**Tests:**

| Test file | Coverage |
|---|---|
| `test/unit/callback-resolver.test.ts` | Remove ALPACA_ACCOUNT_SNAPSHOT test cases, remove circuit breaker assertions |
| `test/unit/service.stack.test.ts` | Update CDK assertions: no HealSM, no emit-health-check, fewer Egress eventTypes |
| `test/integration/order-lifecycle.test.ts` | Verify simplified order lifecycle still works (fill, reject, timeout → escalate) |

#### 2D. Event Routing Changes

**investor-adpt (`services/investor/investor-adpt/src/service.stack.ts`):**

Add to `fromExecutionEvents` array:
- `BROKER_CIRCUIT_CLOSED`
- `BROKER_HEAL_ESCALATED`

(`BROKER_CIRCUIT_OPEN` already forwarded.)

Remove from `fromAdvisoryEvents` array:
- `CIRCUIT_BREAKER_TRIGGERED` (Part 1 cleanup)
- `CIRCUIT_BREAKER_RESET` (Part 1 cleanup)

**investor-adpt (`services/investor/investor-adpt/src/domain/events.ts`):**

Add:
- `BROKER_CIRCUIT_CLOSED`
- `BROKER_HEAL_ESCALATED`

Remove:
- `CIRCUIT_BREAKER_TRIGGERED`
- `CIRCUIT_BREAKER_RESET`

**execution-adpt (`services/execution/execution-adpt/src/domain/events.ts`):**

Add to `ExecutionCrossDomainEventTypes` (for documentation completeness — these events cross from ExecutionBus to InvestorBus via investor-adpt):
- `BROKER_CIRCUIT_CLOSED`
- `BROKER_HEAL_ESCALATED`

(`BROKER_CIRCUIT_OPEN` already listed.)

No EB rule changes in execution-adpt — it doesn't forward these events (investor-adpt does). This is just the event type registry update.

execution-adpt also loses the CIRCUIT_BREAKER_TRIGGERED/RESET event types and EB rules (Part 1 cleanup).

### Part 3: Investor Notification + Feature Flags

#### 3A. investor-bff — Feature Flags

**Modified files:**

| File | Change |
|---|---|
| `src/schema.graphql` | Add `FeatureFlag` type, `getFeatureFlags` query, `updateFeatureFlag` mutation (@aws_iam), `onFeatureFlagUpdate` subscription |
| `src/handlers/event-listener.ts` | Add `BROKER_CIRCUIT_OPEN` and `BROKER_CIRCUIT_CLOSED` handlers that call AppSync `updateFeatureFlag` mutation via IAM |
| `src/service.stack.ts` | Add `BROKER_CIRCUIT_OPEN` and `BROKER_CIRCUIT_CLOSED` to Ingress event subscriptions. Add AppSync IAM invoke permissions to Ingress handler. Enhance Facade to add IAM as additional auth mode. Pass AppSync URL to Ingress handler environment. |
| `src/domain/events.ts` | Add `BROKER_CIRCUIT_OPEN`, `BROKER_CIRCUIT_CLOSED` to inbound event types |

**Prerequisites — Facade construct enhancement:**

The `Facade` construct (`libs/cdk-constructs/src/core/facade.ts`) currently creates the AppSync API with Cognito User Pool authorization only. To support the `@aws_iam` mutation, the Facade must add IAM as an additional authorization mode:

```typescript
// In Facade construct — add IAM as additional auth mode
additionalAuthorizationModes: [{ authorizationType: AuthorizationType.IAM }]
```

This is a backward-compatible change to the Facade construct (existing mutations continue using Cognito auth; only `@aws_iam`-annotated mutations accept IAM-signed requests).

**AppSync invocation from event-listener:**

The Ingress handler Lambda needs:
1. **Environment variable**: `APPSYNC_URL` — the Facade's GraphQL endpoint URL (passed via `Ingress.environment` prop or resolved from the Facade construct's `graphqlUrl` property)
2. **IAM permission**: `appsync:GraphQL` on the Facade API ARN (granted in service.stack.ts: `facade.api.grant(ingress.handler, 'appsync:GraphQL')`)
3. **AppSync client**: a lightweight IAM-signing client using `@aws-sdk/client-appsync` or plain `fetch` with SigV4 signing from `@aws-sdk/signature-v4`. The handler constructs the `updateFeatureFlag` mutation and sends it as a signed HTTP POST to the AppSync endpoint.

This is a new pattern for investor-bff (no existing handler calls AppSync mutations via IAM). The implementation plan should include a small utility for IAM-signed AppSync mutations, potentially reusable by other BFFs.

Note: investor-bff does NOT subscribe to `BROKER_HEAL_ESCALATED`. Escalation doesn't change the feature flag state — the breaker is still open, flags remain disabled. Escalation only triggers a stronger notification in investor-ctrl (email + push). Feature flags are already disabled from the initial `BROKER_CIRCUIT_OPEN` event.

**New files:**

| File | Purpose |
|---|---|
| `src/graphql/js-function/get-feature-flags.fn.js` | Query resolver: DDB Query `pk=FeatureFlag#{tenantId}`, `begins_with(sk, 'FeatureFlag#')`. Returns empty array if no records (default-open). |
| `src/graphql/js-function/update-feature-flag.fn.js` | Mutation resolver (IAM auth): DDB PutItem `FeatureFlag#{tenantId}` / `FeatureFlag#{name}`. Returns the FeatureFlag record. |
| `src/graphql/js-function/check-feature-flag.fn.js` | Pipeline step for gated mutations: DDB GetItem for the mutation name. If `enabled === false` → `util.error('SERVICE_TEMPORARILY_UNAVAILABLE', '...')`. |

**GraphQL schema additions:**

```graphql
type FeatureFlag {
  name: String!
  enabled: Boolean!
  reason: String
}

type Query {
  getFeatureFlags: [FeatureFlag!]!
}

type Mutation {
  updateFeatureFlag(name: String!, enabled: Boolean!, reason: String): FeatureFlag!
    @aws_iam
}

type Subscription {
  onFeatureFlagUpdate: FeatureFlag!
    @aws_subscribe(mutations: ["updateFeatureFlag"])
}
```

**Event-listener handler for circuit breaker events:**

```typescript
[InvestorBffEventTypes.BROKER_CIRCUIT_OPEN]: async (_payload, ctx) => {
  const flags = [
    { name: 'confirmDecision', enabled: false, reason: 'Broker connectivity issue' },
    { name: 'initiateDeposit', enabled: false, reason: 'Broker connectivity issue' },
    { name: 'requestWithdrawal', enabled: false, reason: 'Broker connectivity issue' },
  ];
  for (const flag of flags) {
    await appSyncClient.mutate('updateFeatureFlag', flag);  // IAM auth
  }
  return skip();  // no DDB write from event-listener itself
},

[InvestorBffEventTypes.BROKER_CIRCUIT_CLOSED]: async (_payload, ctx) => {
  const flags = [
    { name: 'confirmDecision', enabled: true },
    { name: 'initiateDeposit', enabled: true },
    { name: 'requestWithdrawal', enabled: true },
  ];
  for (const flag of flags) {
    await appSyncClient.mutate('updateFeatureFlag', flag);
  }
  return skip();
},
```

**Mutation gating pipeline:**

`initiateDeposit` and `requestWithdrawal` mutation resolvers gain a pipeline step:

```
check-auth.fn.js → check-feature-flag.fn.js → initiate-deposit.fn.js
```

`check-feature-flag.fn.js` performs a DDB GetItem with `pk: FeatureFlag#SYSTEM` and `sk: FeatureFlag#{mutationName}`. If the item exists and `enabled === false` → `util.error('This action is temporarily paused', 'SERVICE_TEMPORARILY_UNAVAILABLE')`. If the item doesn't exist → continue (default-open). Also checks `pk: FeatureFlag#{tenantId}` for tenant-specific overrides.

Note: `confirmDecision` is a **frontend-only flag** — it is written to the FeatureFlag table and pushed via subscription, but no BFF pipeline step enforces it server-side. advisory-bff is not gated. Defense-in-depth: the frontend disables the button, and broker-alpaca-adpt rejects the resulting order if a race condition leaks through.

**DDB record:**

```
pk: FeatureFlag#{tenantId}
sk: FeatureFlag#{flagName}       e.g. FeatureFlag#confirmDecision
__typename: FeatureFlag
name: string
enabled: boolean
reason: string | null
updatedAt: ISO timestamp
```

Note: `tenantId` for system-wide flags (broker circuit breaker) should use a convention — either the actual tenantId from the event context (per-tenant flag state) or a well-known key. Since the breaker is global (affects all tenants), the event-listener handler must update flags for all tenants, OR use a `SYSTEM` tenant approach where the query includes both tenant-specific and SYSTEM flags.

Decision: **Use `tenantId: 'SYSTEM'` for global flags.** The `getFeatureFlags` query reads `pk=FeatureFlag#SYSTEM` in addition to `pk=FeatureFlag#{tenantId}`. This avoids fan-out and supports both global and per-tenant flags in the future.

Corrected event-listener: the handler calls `updateFeatureFlag` with `tenantId: 'SYSTEM'` (not per-tenant).

Corrected query resolver: `getFeatureFlags` runs two queries (`FeatureFlag#SYSTEM` + `FeatureFlag#{tenantId}`) and merges results (tenant-specific flags override SYSTEM flags if both exist).

**Tests:**

| Test file | Coverage |
|---|---|
| `test/unit/event-listener.test.ts` | BROKER_CIRCUIT_OPEN → calls updateFeatureFlag 3x; BROKER_CIRCUIT_CLOSED → re-enables 3x |
| `test/unit/service.stack.test.ts` | CDK assertions: new Ingress subscriptions, IAM policy for AppSync |

#### 3B. investor-ctrl — Notification Templates

**Modified files:**

| File | Change |
|---|---|
| `src/handlers/event-listener.ts` | Add 3 notification templates and handlers |
| `src/service.stack.ts` | Add `BROKER_CIRCUIT_OPEN`, `BROKER_CIRCUIT_CLOSED`, `BROKER_HEAL_ESCALATED` to Ingress subscriptions |
| `src/domain/events.ts` | No change needed — investor-ctrl imports inbound event types from `InvestorIngestEventTypes` (defined in investor-adpt). The 3 new events are already added there in Section 2D. |

**Notification templates:**

```typescript
BROKER_CIRCUIT_OPEN: {
  title: 'Some features are temporarily paused',
  body: 'Deposits, withdrawals, and accepting decisions are temporarily paused. We\'re working on it and will notify you when they\'re available again.',
  channel: 'push',
},
BROKER_CIRCUIT_CLOSED: {
  title: 'All features are available',
  body: 'Everything is back to normal. All features are available again.',
  channel: 'push',
},
BROKER_HEAL_ESCALATED: {
  title: 'We\'re looking into an issue',
  body: 'We\'re experiencing an extended issue affecting some features. Our team is working on it — we\'ll update you as soon as it\'s resolved.',
  channel: 'email,push',
},
```

**System notification handling:**

These events have no `tenantId` (broker outage is global). The handler creates a single notification with `tenantId: 'SYSTEM'`:

```typescript
record('Notification', {
  __typename: 'Notification',
  tenantId: 'SYSTEM',
  notificationId: ctx.eventId,
  type: ctx.eventType,
  title: template.title,
  body: template.body,
  channel: template.channel,
  status: 'DELIVERED',
  sourceEventId: ctx.eventId,
  ...timestamps,
}, { pk: `Notification#SYSTEM#${ctx.eventId}`, sk: 'Notification' });
```

investor-bff's `getNotifications` query must be updated to include `SYSTEM` notifications alongside tenant-specific ones (same pattern as feature flags).

**Real-time notification delivery note:** The existing `onNotification` subscription triggers on `markNotificationRead` mutations only — there is no subscription for newly created notifications. SYSTEM notifications created by investor-ctrl arrive in the notification list on the next `getNotifications` query (page refresh or pagination). This is acceptable because the **real-time UX is handled by the feature flags subscription + system banner** (Section 3A/4B), not by the notification list. The notification list provides history, not real-time alerts.

**Tests:**

| Test file | Coverage |
|---|---|
| `test/unit/event-listener.test.ts` | 3 new handlers produce correct notification records with SYSTEM tenantId |

### Part 4: Frontend — Feature Flags Store + System Banner

#### 4A. Shared Feature Flags Lib

**Location:** `libs/ui/feature-flags/`

**Files:**

| File | Purpose |
|---|---|
| `src/lib/feature-flags.store.ts` | NgRx Signal Store (`providedIn: 'root'`). State: `Record<string, FeatureFlag>`. Methods: `setFlags(flags[])`, `updateFlag(flag)`, `isEnabled(name): Signal<boolean>`, `disabledFlags(): Signal<FeatureFlag[]>`. |
| `src/lib/feature-flags.guard.ts` | Route guard `canActivateWhenEnabled` — reads flag name from route data, checks store |
| `src/lib/feature-flags.directive.ts` | Structural directive `*featureEnabled="'flagName'"` — shows/hides template based on flag state |
| `src/lib/feature-flags.model.ts` | `FeatureFlag` interface: `{ name: string; enabled: boolean; reason?: string }` |
| `src/lib/feature-flags.queries.ts` | GraphQL query and subscription statements (`GET_FEATURE_FLAGS`, `ON_FEATURE_FLAG_UPDATE`) |
| `src/index.ts` | Public API exports |

**Store implementation:**

```typescript
export const FeatureFlagsStore = signalStore(
  { providedIn: 'root' },
  withState({ flags: {} as Record<string, FeatureFlag> }),
  withComputed((store) => ({
    disabledFlags: computed(() =>
      Object.values(store.flags()).filter(f => !f.enabled)
    ),
  })),
  withMethods((store) => ({
    setFlags(flags: FeatureFlag[]): void {
      const record = Object.fromEntries(flags.map(f => [f.name, f]));
      patchState(store, { flags: record });
    },
    updateFlag(flag: FeatureFlag): void {
      patchState(store, { flags: { ...store.flags(), [flag.name]: flag } });
    },
    isEnabled(name: string): boolean {
      return store.flags()[name]?.enabled ?? true;  // default-open
    },
  })),
  withDevtools('FeatureFlagsStore'),
);
```

#### 4B. Shell Integration

**Modified files:**

| File | Change |
|---|---|
| `libs/shell/src/services/feature-flag.service.ts` | New service: injects `GraphqlService`, initializes subscription at construction, calls `getFeatureFlags` query, updates `FeatureFlagsStore` |
| `libs/shell/src/components/system-banner.component.ts` | New component: injects `FeatureFlagsStore`, shows/hides based on `disabledFlags().length > 0`, displays reason text |
| `libs/shell/src/components/shell-layout.component.ts` | Add `<app-system-banner>` above main content area |
| `apps/nestfolio-host/src/app/app.config.ts` | Provide `FeatureFlagService` at app root (triggers subscription on boot) |

**FeatureFlagService:**

```typescript
@Injectable({ providedIn: 'root' })
export class FeatureFlagService implements OnDestroy {
  private readonly graphql = inject(GraphqlService);
  private readonly store = inject(FeatureFlagsStore);
  private subscription?: Subscription;

  constructor() {
    // 1. Load initial flags
    this.graphql.query<{ getFeatureFlags: FeatureFlag[] }>(GET_FEATURE_FLAGS)
      .subscribe(result => this.store.setFlags(result.getFeatureFlags));

    // 2. Subscribe to real-time updates
    this.subscription = this.graphql
      .subscribe<{ onFeatureFlagUpdate: FeatureFlag }>(ON_FEATURE_FLAG_UPDATE)
      .subscribe(result => this.store.updateFlag(result.onFeatureFlagUpdate));
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }
}
```

**SystemBannerComponent:**

```typescript
@Component({
  selector: 'app-system-banner',
  standalone: true,
  template: `
    @if (show()) {
      <div class="system-banner">{{ message() }}</div>
    }
  `,
})
export class SystemBannerComponent {
  private readonly store = inject(FeatureFlagsStore);

  show = computed(() => this.store.disabledFlags().length > 0);
  message = computed(() => {
    const flags = this.store.disabledFlags();
    return flags.length > 0 ? flags[0].reason : '';
  });
}
```

**Mutation button gating in MFE components:**

Components that trigger gated actions inject `FeatureFlagsStore`:

```typescript
featureFlags = inject(FeatureFlagsStore);
canDeposit = computed(() => this.featureFlags.isEnabled('initiateDeposit'));
// Template: <button [disabled]="!canDeposit()">Deposit</button>
```

### Part 5: Flow Spec

**Delete:** `flows/circuit-breaker.flow.yaml`

**Create:** `flows/broker-circuit-breaker.flow.yaml` reflecting the new architecture as described in Section 8 of the design discussion.

## Edge Cases

1. **Two orders fail simultaneously.** Both handlers call `circuitBreakerRepo.open('alpaca', ...)`. The conditional DDB write (`attribute_not_exists(pk) OR state <> :open`) ensures only one succeeds. The second handler sees "already open" and just rejects its order. Both write rejection records for their orders.

2. **HealSM already running when another BROKER_CIRCUIT_OPEN fires.** SF execution name is fixed (`heal-alpaca`). StartExecution with the same name within the execution window is idempotent — SF ignores the duplicate. Only one heal workflow runs at a time.

3. **Breaker closes but orders are stuck in broker-ctrl's OrderStateMachine.** Orders submitted before the breaker opened are waiting for adapter callbacks. If the adapter rejected them (breaker was open when they arrived), broker-ctrl gets the rejection callback and handles it normally. If the orders were in-flight when Alpaca went down, the adapter's polling SF eventually times out and writes a failure. broker-ctrl's 300s timeout is the final safety net.

4. **Lambda cold start during breaker check.** The `isOpen()` DDB GetItem adds ~5ms latency. Negligible.

5. **Alpaca returns 429 (rate limited) vs 5xx (down).** The client's retry logic (3x with backoff) handles transient 429s. If all retries fail, the `isBrokerDown()` inline check distinguishes: if health check passes → transient rate limiting, don't open breaker. If health check fails → broker is down, open breaker.

6. **Breaker opens but investor-bff event-listener hasn't processed the event yet.** Race condition: user clicks "Deposit" before feature flag is disabled. The `check-feature-flag.fn.js` pipeline step catches it (if the flag was already written by a previous event). If the flag hasn't been written yet either, the mutation proceeds, the order reaches broker-alpaca-adpt which rejects it immediately. Defense-in-depth: the adapter is the final gate.

7. **SYSTEM notifications in getNotifications query.** The query runs two DDB queries (tenant + SYSTEM) and merges. SYSTEM notifications sort by timestamp alongside tenant notifications. If a SYSTEM notification is marked as read, it's per-tenant (the markNotificationRead mutation operates on the tenant's copy — this requires creating a tenant-specific copy on first read, or accepting that SYSTEM notifications can't be individually marked as read). Recommendation: SYSTEM notifications are not individually dismissable — they disappear when the condition clears (BROKER_CIRCUIT_CLOSED). The notification list shows them but without a "mark as read" action.

8. **AlpacaClient retry vs handler-level breaker open.** The client retries 3x with backoff (covers transient failures). If all 3 fail, the handler runs `isBrokerDown()`. If that also fails, the handler opens the breaker. The client does NOT check the breaker — only the handler does at entry. This prevents the client from being coupled to breaker state.

9. **Partial flag update on Lambda retry.** The investor-bff event-listener calls `updateFeatureFlag` 3 times (one per flag). If the Lambda fails between mutations (e.g., after 2 of 3), the SQS retry will re-execute all 3. The mutations are DDB PutItem (idempotent), so re-applying already-set flags is safe. During the retry window, one flag may be out of sync (e.g., `confirmDecision` disabled but `requestWithdrawal` not yet). This is acceptable — the window is seconds, and the adapter rejects as fallback.

## Out of Scope

- **advisory-bff mutation gating** — frontend disables button; adapter rejects as fallback. No cross-domain event routing for a BFF guard.
- **Order retry after heal** — escalated orders stay escalated. No automatic re-queue after breaker closes. Future feature.
- **Per-tenant circuit breaker** — not needed. Broker outage is global.
- **deposit-withdrawal-normalizer refactoring** — adapter-specific field mapping stays in broker-ctrl for now. Orthogonal to circuit breaker.
- **investor-bff getNotifications SYSTEM merge** — detailed query refactoring is implementation detail, not spec concern. The pattern (query SYSTEM + tenant, merge) is defined; exact DDB query structure is implementation.

## Success Criteria

1. When Alpaca goes down: broker-alpaca-adpt detects within seconds (not 300s), opens a single global breaker, starts one heal workflow
2. All subsequent orders/transfers are immediately rejected with `BROKER_UNAVAILABLE` — no 300s timeout wait
3. Investor sees system banner + notification within seconds of breaker opening
4. `initiateDeposit` and `requestWithdrawal` mutations are gated in investor-bff
5. `confirmDecision` button is disabled in frontend
6. When Alpaca recovers: breaker closes, flags re-enable, banner disappears, "back to normal" notification sent
7. After 10 failed heal attempts: escalation notification sent via push + email
8. broker-ctrl's OrderStateMachine is simplified (~300 lines, no circuit breaker logic)
9. No advisory circuit breaker scaffolding remains in the codebase
10. `CircuitBreakerHealDefinition` construct is reusable by any future adapter service

## Post-Implementation

- Regenerate CLAUDE.md service cards for all affected services: broker-alpaca-adpt, broker-ctrl, investor-adpt, investor-bff, investor-ctrl, execution-adpt, execution-ctrl, advisory-ctrl, advisory-adpt
- Regenerate C4 diagrams (circuit breaker events now originate from broker-alpaca-adpt, not broker-ctrl)
- Scaffold `libs/ui/feature-flags/` Nx project via generator before implementing frontend code
