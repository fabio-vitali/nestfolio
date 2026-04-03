---
name: cdk-patterns
description: CDK 6-construct pattern reference for Nestfolio services. Use when creating or modifying service stacks, adding constructs, wiring observability, or understanding the ServiceStack API.
---

# CDK 6-Construct Pattern Reference

## When This Skill Applies

- Creating a new service stack (`service.stack.ts`)
- Adding Ingress, Egress, Facade, AgentRuntime, or Orchestration constructs
- Wiring observability via `addObservability()`
- Adapting a service that has no state (adapter pattern)
- Connecting EventBridge → Step Functions
- Cross-resource IAM grants

---

## ServiceStack Base Class

**File:** `libs/cdk-constructs/src/core/service-stack.ts`

```ts
export interface ServiceStackProps extends StackProps {
  prefix: string;        // env prefix: 'dev' | 'staging' | 'prod'
  subsystem: string;     // domain: 'investor' | 'advisory' | 'execution' | 'ledger'
  service: string;       // service name: 'ledger-ctrl', 'broker-sim-adpt', etc.
  serviceDir?: string;   // path to handlers dir — pass __dirname from stack file
  domain?: string;       // tagging override; defaults to subsystem
  eventBus?: IEventBus;  // inject explicit bus (e.g. from SSM ARN lookup)
  observability?: boolean; // enable Monitoring+Dashboard, default true
}
```

> **Important:** State is now consumer-instantiated, NOT auto-created by ServiceStack. Each service that needs state must create `new State(this, 'State', { ... })` explicitly in its constructor.

### Public API

| Member | Type | Notes |
|---|---|---|
| `this.prefix` | `string` | Environment prefix (e.g. `'dev'`) |
| `this.serviceName` | `string` | From `props.service` |
| `this.serviceDir` | `string` | From `props.serviceDir ?? ''` |
| `this.state` | `State \| undefined` | Consumer-set via `this.state = state`. Only present when the service creates and assigns a State construct |
| `this.eventBus` | `IEventBus` | Lazy-resolved from `naming.eventBusName()` unless injected. **Settable by subclasses** |
| `this.naming` | `NamingService` | Resource naming helper |
| `this.observability` | `boolean` | Whether Monitoring/Dashboard are wired |

### Static Helper

```ts
ServiceStack.of(construct) // walks up tree to find nearest ServiceStack ancestor
```

### addObservability()

Call **once** at the end of the constructor after building Ingress/Egress:

```ts
this.addObservability({
  ingress,            // optional — exposes handler + dlq
  egress,             // optional — exposes dlq
  orchestration,      // optional — exposes state machine metrics
  extraLambdas: [],   // additional Lambda functions to monitor
  extraDlqs: [],      // additional DLQs
  monitorBedrock: false,
  bedrockModelIds: [],
});
```

**Important:** Pass the construct objects (`Ingress`, `Egress`, `Orchestration`) directly — NOT their `.handler` properties. The method extracts handlers and DLQs internally. The property name for additional Lambda functions is `extraLambdas` (not `extra`).

```ts
// WRONG — passes a Lambda function instead of the construct
this.addObservability({ ingress: ingress.handler, egress: egress.handler });

// CORRECT — passes construct objects
this.addObservability({ ingress, egress, orchestration });
```

---

## 6-Construct Pattern

### 1. State

**File:** `libs/cdk-constructs/src/core/state.ts`

Provisions a DynamoDB table (pk/sk, PAY_PER_REQUEST, streams NEW_AND_OLD_IMAGES, TTL) with two built-in GSIs:
- `tenantId-index` — PK: `tenantId`, SK: `__typename`
- `typename-timestamp-index` — PK: `__typename`, SK: `timestamp` (KEYS_ONLY)

```ts
export interface StateProps {
  withTable?: boolean;           // default true
  withBucket?: boolean;          // add S3 bucket alongside table, default false
  additionalGsis?: GsiConfig[];  // extra GSIs beyond the two defaults
  removalPolicy?: RemovalPolicy; // default RETAIN
  encryption?: TableEncryption;  // default AWS_MANAGED
}

export interface GsiConfig {
  indexName: string;
  partitionKey: { name: string; type: AttributeType };
  sortKey?: { name: string; type: AttributeType };
  projectionType?: ProjectionType;  // default ALL
}
```

State is consumer-instantiated: each service creates `new State(this, 'State', { ... })` explicitly and assigns it to `this.state`. Services that don't need state simply skip this step. Other constructs (Ingress, Egress, Facade, AgentRuntime) accept `state` as a prop for explicit wiring.

**Accessors (throw if resource absent):**
```ts
this.state.getTable()   // returns Table — throws if withTable: false
this.state.getBucket()  // returns Bucket — throws if withBucket: false
```

Direct access (optional chaining safe):
```ts
this.state.table    // Table | undefined
this.state.bucket   // Bucket | undefined
```

---

### 2. Ingress

**File:** `libs/cdk-constructs/src/core/ingress.ts`

Wires: EventBridge Rule → SQS Queue (with DLQ) → Lambda handler.

Auto-injects env vars: `SERVICE_NAME`, `BUS_NAME`, `TABLE_NAME` (if state with table passed), `BUCKET_NAME` (if state with bucket passed).
Auto-grants: `table.grantReadWriteData`, `bucket.grantReadWrite`, `events:PutEvents` — only when state is provided.

```ts
export interface IngressProps {
  eventTypes: string[];            // EventBridge detail-type filter list
  state?: State;                   // optional — when provided, auto-injects TABLE_NAME/BUCKET_NAME and grants
  entry?: string;                  // default: join(serviceDir, 'handlers', 'event-listener.ts')
  environment?: Record<string, string>; // extra env vars merged in
  lambdaProps?: Partial<NodejsFunctionProps>; // override timeout, memorySize, etc.
  batchSize?: number;              // SQS event source batch size, default 10
  maxBatchingWindowMs?: number;    // batching window in ms, default 1000
  maxBatchingWindow?: Duration;    // takes precedence over maxBatchingWindowMs
  maxRetries?: number;             // DLQ max receive count, default 10
  visibilityTimeout?: Duration;    // queue visibility; auto = 6 x lambdaTimeout if not set
  lambdaTimeout?: Duration;        // used to auto-calculate visibilityTimeout
}
```

**Public members:**
```ts
ingress.handler  // NodejsFunction
ingress.queue    // Queue
ingress.dlq      // Queue
```

---

### 3. Egress

**File:** `libs/cdk-constructs/src/core/egress.ts`

Wires: DynamoDB Stream → Lambda CDC publisher (INSERT + MODIFY events filtered by `__typename`).

Auto-injects env vars: `SERVICE_NAME`, `BUS_NAME`, `TABLE_NAME`, `BUCKET_NAME`.
Auto-grants: `table.grantReadWriteData`, `bucket.grantReadWrite`, `events:PutEvents`.

```ts
export interface EgressProps {
  state: State;                      // required — Egress reads DynamoDB Streams from state.getTable()
  eventTypes: EventTypesMap;         // declarative event type mapping: record type → event config
  entry?: string;                    // default: join(serviceDir, 'handlers', 'event-publisher.ts')
  environment?: Record<string, string>;
  lambdaProps?: Partial<NodejsFunctionProps>;
  retryAttempts?: number;            // DDB stream retry attempts before DLQ, default 3
  batchSize?: number;                // DDB stream batch size
}
```

**Public members:**
```ts
egress.handler  // NodejsFunction
egress.dlq      // Queue
```

Egress filters INSERT and MODIFY events for each `publishableType`. `StartingPosition.LATEST`, `bisectBatchOnError: true`.

**Filter grouping:** Filter criteria are auto-grouped by DynamoDB Stream action (INSERT / MODIFY / REMOVE) with OR'd `__typename` values. This means the actual number of filters is at most 3 (one per action), regardless of how many event types are declared. **Warning:** Never create multiple `DynamoEventSource` instances on the same table — DynamoDB Streams enforces a 2-reader-per-shard throttling limit. If a service needs a second Stream consumer (e.g. a reducer), coordinate carefully with Egress to stay within the limit.

---

### 4. Facade

**File:** `libs/cdk-constructs/src/core/facade.ts`

Provisions an AppSync GraphQL API (Cognito user pool auth, WAF rate limit by default).
Supports JS pipeline resolvers (from compiled `.fn.js` files) and Lambda resolvers.

```ts
export interface FacadeProps {
  state?: State;                  // optional — when provided, JS resolvers get DynamoDB data source
  schemaPath?: string;            // default: join(serviceDir, 'schema.graphql')
  userPool?: IUserPool;           // explicit pool; else resolved from SSM
  userPoolSsmPath?: string;       // SSM path override; default: naming.ssmParameterPath('auth/userPoolId')
  jsResolvers?: JsResolverConfig[];
  lambdaResolvers?: LambdaResolverConfig[];
  queryDepthLimit?: number;       // default 10
  enableWaf?: boolean;            // default true
  wafRateLimit?: number;          // requests/5min per IP, default 1000
}

export interface JsResolverConfig {
  typeName: 'Query' | 'Mutation';
  fieldName: string;
  pipeline: string[];             // ordered list of .fn.js file paths
  dataSource?: 'dynamodb' | 'none';
}

export interface LambdaResolverConfig {
  typeName: 'Query' | 'Mutation';
  fieldName: string;
  handler: IFunction;
}
```

**Public members:**
```ts
facade.api          // GraphqlApi | undefined (undefined if no resolvers)
facade.graphqlUrl   // string | undefined
```

API URL is auto-stored in SSM at `naming.ssmParameterPath('api/graphqlUrl')`.

**SSM path for Facade exports:** Use `this.naming.ssmServicePath('api/endpoint')` (per-service path), NOT `this.naming.ssmParameterPath(...)` (per-subsystem path). `ssmServicePath` scopes the parameter to the individual service, avoiding collisions when multiple services in the same subsystem export API endpoints.

**Auto-discovery helper:**
```ts
import { discoverJsResolvers } from '@nestfolio/cdk-constructs/core';

const jsResolvers = discoverJsResolvers(__dirname, {
  noneDataSource: ['someField'],   // fields using NoneDataSource
  extraSteps: { createFoo: ['readback.fn.js'] }, // extra pipeline steps
  exclude: ['fieldHandledByLambda'],
});
```

---

### 5. AgentRuntime

**File:** `libs/cdk-constructs/src/extensions/agent-runtime.ts`

Wraps Bedrock AgentCore Runtime (container) + optional MCP Gateway.
Auto-grants Bedrock model invoke and DynamoDB access.

```ts
export interface AgentRuntimeProps {
  runtimeName: string;                    // AgentCore runtime name
  agentCodePath: string;                  // directory with Dockerfile
  description?: string;
  state?: State;                          // optional — replaces `tables`; auto-grants R/W on state.table
  userPool?: IUserPool;
  userPoolClients?: IUserPoolClient[];
  environmentVariables?: Record<string, string>;
  toolTargets?: ToolTarget[];             // MCP Gateway tool definitions
  modelIds?: string[];                    // Bedrock model IDs for InvokeModel grants
  idleTimeout?: Duration;                 // default 15 minutes
  maxLifetime?: Duration;                 // default 4 hours
}

export interface ToolTarget {
  name: string;
  description: string;
  handler: IFunction;
  schemaPath: string;   // path to OpenAPI/tool schema file
}
```

**Public members:**
```ts
agentRuntime.runtime   // agentcore.Runtime
agentRuntime.gateway   // agentcore.Gateway | undefined (present if toolTargets provided)
```

**Naming rules:** Runtime names must match `[a-zA-Z0-9_]` (underscores OK, no hyphens). Gateway and target names must match `[a-zA-Z0-9-]` (hyphens only, no underscores). NamingService sanitizes these automatically: `runtimeName` substitutes underscores, while gateway/target IDs substitute hyphens. Always use the NamingService output rather than hand-crafting names.

**Memory namespace `{sessionId}`:** `MemoryStrategy.usingSummarization()` requires a `{sessionId}` placeholder in the namespace string — the runtime replaces it at invocation time. Other strategy types (`UserPreference`, `Semantic`) do NOT require it. Example: `namespaces: ['/my-scope/{actorId}/sessions/{sessionId}']`.

**Bedrock model IDs — inference profiles:** Newer Claude models (4.5, 4.6) require US inference profile IDs, not base model IDs. Use `us.anthropic.claude-sonnet-4-6`, `us.anthropic.claude-opus-4-6-v1`, `us.anthropic.claude-haiku-4-5-20251001-v1:0`. `BedrockFoundationModel.grantInvoke()` generates `foundation-model/` ARN which doesn't match inference profiles — add a manual IAM grant for `inference-profile/*` when using `Memory` or other constructs that internally call `model.grantInvoke()`.

---

### 6. Orchestration

**File:** `libs/cdk-constructs/src/core/orchestration.ts`

Wraps a Step Functions state machine with EventBridge trigger rules and task-token callback wiring.

```ts
export interface OrchestrationProps {
  state?: State;                        // optional — grants R/W to state machine role when provided
  definitionBody: sfn.DefinitionBody;   // state machine definition (fromChainable or fromFile)
  triggers: string[];                   // event types that trigger new state machine executions (EB rules created per type)
  timeout?: Duration;                   // state machine execution timeout, default 5 minutes
}
```

**Public members:**
```ts
orchestration.stateMachine   // sfn.StateMachine
```

**Task token wiring:**
```ts
orchestration.grantCallbackAccess(handler);
// Grants sfn:SendTaskSuccess + sfn:SendTaskFailure
// Injects STATE_MACHINE_ARN env var to the handler
```

Optional `envVarName` parameter overrides the default `STATE_MACHINE_ARN` env var name:
```ts
orchestration.grantCallbackAccess(handler, 'DECISION_SM_ARN');
```

**Migration note:** When migrating an existing Step Functions state machine to the Orchestration construct, use the same construct ID to preserve CloudFormation logical IDs and avoid resource replacement.

**CustomState `addCatch` requirement:** When using `sfn.CustomState`, Catch targets MUST be wired via the `.addCatch()` API, NOT via raw JSON `Catch[].Next` strings in `stateJson`. Raw JSON Catch blocks are opaque to CDK's graph traversal — catch-target states won't be discovered by `DefinitionBody.fromChainable()` and will be silently excluded from the rendered ASL.

```ts
// WRONG: handleError state not discoverable by CDK — omitted from ASL
new sfn.CustomState(this, 'MyTask', {
  stateJson: { ..., Catch: [{ ErrorEquals: ['States.Timeout'], Next: 'HandleError' }] },
});

// CORRECT: handleError registered in CDK state graph
const myTask = new sfn.CustomState(this, 'MyTask', { stateJson: { ... } });
myTask.addCatch(handleError, { errors: ['States.Timeout'], resultPath: '$.error' });
```

---

## Common Patterns

### Standard Service Stack (State + Ingress + Egress)

```ts
export class MyServiceStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State', {});
    this.state = state;

    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: ['MY_EVENT_TYPE', 'OTHER_EVENT'],
    });

    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'MyAggregate': 'MY_AGGREGATE',
        'MyProjection': 'MY_PROJECTION',
      },
    });

    this.addObservability({ ingress, egress });
  }
}
```

### Multiple Ingress Handlers

When a service needs separate Lambda functions for different event sets, create multiple Ingress constructs with distinct IDs:

```ts
const primaryIngress = new Ingress(this, 'PrimaryIngress', {
  eventTypes: ['ORDER_PLACED'],
});

const statusIngress = new Ingress(this, 'StatusIngress', {
  eventTypes: ['ORDER_STATUS_CHANGED'],
  entry: join(__dirname, 'handlers', 'status-listener.ts'),
});

this.addObservability({
  ingress: primaryIngress,
  extraLambdas: [statusIngress.handler],
  extraDlqs: [statusIngress.dlq],
});
```

Note: CDK alarm IDs are disambiguated by the Ingress construct ID when multiple exist.

### Orchestration Pattern (EventBridge → Step Functions)

For orchestration services (e.g. broker-ctrl, broker-alpaca-adpt), use the Orchestration construct with `triggers` for EventBridge-driven state machine execution:

```ts
const state = new State(this, 'State', {});
this.state = state;

const orchestration = new Orchestration(this, 'OrderStateMachine', {
  state,
  definitionBody: sfn.DefinitionBody.fromChainable(definition),
  triggers: ['ORDER_SUBMITTED'],
  timeout: Duration.minutes(5),
});

// Grant callback access to Ingress handlers
orchestration.grantCallbackAccess(callbackIngress.handler);
```

### Cross-Domain Bus Lookup (Hub Stacks)

Hub stacks use SSM deploy-time lookup (not synth-time):

```ts
import { resolveBusArn, getDomainAccounts } from '@nestfolio/cdk-constructs/extensions';

const domainAccounts = getDomainAccounts(this);
const ledgerBusArn = resolveBusArn(this, 'LedgerBus', this.prefix, 'ledger', domainAccounts);
this.eventBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);
```

Use `valueForStringParameter` (deploy-time), never `valueFromLookup` (synth-time) for hub stacks.

### Stateless Adapter Pattern (Cross-Domain Ingestion)

Cross-domain ingestion adapters (e.g. `advisory-adpt`) that forward events between buses omit the State construct:

```ts
super(scope, id, { ...props, serviceDir: __dirname });
// No State created — Ingress works without state prop
const ingress = new Ingress(this, 'Ingress', {
  eventTypes: ['SOME_EVENT'],
});
```

Ingress handles the absence of state gracefully — it skips env vars and grants when no state prop is provided.

Note: Broker adapters (e.g. `broker-sim-adpt`) are NOT stateless — they manage external integration state with State + Ingress + Egress.

### Extra State-Only Lambda (e.g. Reducer)

When a second Lambda consumes DDB Streams directly beyond the Egress CDC publisher:

```ts
const reducerFn = new NodejsFunction(this, 'ReducerFn', {
  ...defaultLambdaProps(this),
  entry: join(__dirname, 'handlers', 'reducer.ts'),
  environment: {
    TABLE_NAME: this.state.getTable().tableName,
    SERVICE_NAME: this.serviceName,
  },
});
this.state.getTable().grantReadWriteData(reducerFn);

reducerFn.addEventSource(new DynamoEventSource(this.state.getTable(), {
  startingPosition: StartingPosition.LATEST,
  bisectBatchOnError: true,
  retryAttempts: 3,
  batchSize: 100,
  maxBatchingWindow: Duration.seconds(5),
  filters: [FilterCriteria.filter({ ... })],
}));

this.addObservability({ ingress, egress, extraLambdas: [reducerFn] });
```

### NamingService API

```ts
this.naming.eventBusName()              // "dev-investor-event-bus"
this.naming.tableName()                 // "dev-investor-bff-table"
this.naming.queueName()                 // "dev-investor-bff-queue"
this.naming.queueName('dlq')            // "dev-investor-bff-dlq-queue"
this.naming.functionName('handler')     // "dev-investor-bff-handler"
this.naming.ssmParameterPath('api/url') // "/nestfolio/dev-investor/api/url"         (per-subsystem)
this.naming.ssmServicePath('api/endpoint') // "/nestfolio/dev-investor-bff/api/endpoint" (per-service — use for Facade exports)
```

---

## Service Archetypes

| Archetype | Constructs | Example |
|---|---|---|
| **BFF** | State + Ingress + Egress + Facade | `investor-bff` |
| **Hub** | Ingress (cross-domain bus lookup, no state) | `execution-hub` |
| **Broker Adapter** | State + Ingress + Egress | `broker-sim-adpt` |
| **Ingestion Adapter** | Ingress (no state) | `advisory-adpt` |
| **Standard Ctrl** | State + Ingress + Egress | `ledger-ctrl` |
| **Orchestrated Ctrl** | State + Ingress + Egress + Orchestration | `broker-ctrl` |
| **AgentRuntime Ctrl** | State + Ingress + Egress + AgentRuntime | `advisory-ctrl` |

---

## Reference Files

- `libs/cdk-constructs/src/core/service-stack.ts` — ServiceStack base class
- `libs/cdk-constructs/src/core/state.ts` — State (DynamoDB + S3)
- `libs/cdk-constructs/src/core/ingress.ts` — Ingress (EB → SQS → Lambda)
- `libs/cdk-constructs/src/core/egress.ts` — Egress (DDB Streams → Lambda → EB)
- `libs/cdk-constructs/src/core/facade.ts` — Facade (AppSync GraphQL + WAF)
- `libs/cdk-constructs/src/extensions/agent-runtime.ts` — AgentRuntime (Bedrock AgentCore)
- `libs/cdk-constructs/src/core/orchestration.ts` — Orchestration (Step Functions + EventBridge triggers)
- `libs/cdk-constructs/src/utils/naming-service.ts` — NamingService, getPrefix, discoverSubsystem
- `services/ledger/ledger-ctrl/src/service.stack.ts` — Full example: State + Ingress + Egress + extra DDB stream consumer
- `services/execution/broker-sim-adpt/src/service.stack.ts` — Minimal adapter example (no state)
- `services/execution/broker-ctrl/src/service.stack.ts` — Orchestrated service example (State + Orchestration)

---

## Anti-Patterns

- **Never** call `valueFromLookup` in hub stacks — use `valueForStringParameter` for deploy-time SSM resolution
- **Never** hardcode table/bus names — always use `this.naming.*` or the env vars injected by Ingress/Egress
- **Never** call `addObservability()` more than once — it creates duplicate Monitoring and Dashboard constructs
- **Never** use Egress without passing a State with a table — Egress calls `state.getTable()` which throws
- **Never** create Lambda handlers outside the event-processor pipeline pattern (exception: SF task token callbacks)
- **Do not** use `ServiceStack.of(construct)` from outside a `ServiceStack` subtree — it throws
- **Do not** manually add `TABLE_NAME`/`BUS_NAME` env vars — Ingress/Egress inject them automatically
- **Do not** use `stateProps` on ServiceStack — State is now consumer-instantiated (stateProps has been removed)
