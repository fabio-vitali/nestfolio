# CDK Constructs Grouping Strategy

## Goals

1. **Discoverability** — replace flat 18-file structure with logical subdirectories
2. **Subpath imports** — consumers import from `@nestfolio/cdk-constructs/core`, `/observability`, `/extensions`, `/utils`
3. **Dependency boundaries** — isolate heavy dependencies (Bedrock, AppSync) from core constructs

## Directory Structure

```
libs/cdk-constructs/src/
  core/
    index.ts
    service-stack.ts
    state.ts
    ingress.ts
    egress.ts
    facade.ts                     # includes discoverJsResolvers (stays in same file)
  observability/
    index.ts
    monitoring.ts
    dashboard.ts
  extensions/
    index.ts
    agent-runtime.ts
    knowledge-base.ts
    cross-account.ts
    cost-controls.ts
    adapter-schedule.ts
    runtime-config.ts
  utils/
    index.ts
    naming-service.ts
    default-lambda-props.ts
    tagging.ts
    resolve-pipeline-config.ts
```

No root `index.ts` barrel. The `@nestfolio/cdk-constructs` tsconfig path alias is removed. Consumers must use subpath imports.

## Subpath Aliases (tsconfig.base.json)

```
@nestfolio/cdk-constructs/core          → libs/cdk-constructs/src/core/index.ts
@nestfolio/cdk-constructs/observability  → libs/cdk-constructs/src/observability/index.ts
@nestfolio/cdk-constructs/extensions     → libs/cdk-constructs/src/extensions/index.ts
@nestfolio/cdk-constructs/utils          → libs/cdk-constructs/src/utils/index.ts
```

Specific subpaths listed before any wildcard. The old `@nestfolio/cdk-constructs` root alias is deleted.

## Group Contents

### core/
The foundational 5-construct service pattern used by all consumers.

| Export | Type | Description |
|--------|------|-------------|
| ServiceStack, ServiceStackProps | Construct | CDK Stack base class (naming, state, eventBus, observability context) |
| State, StateProps, GsiConfig | Construct | DynamoDB table + optional S3 bucket |
| Ingress, IngressProps | Construct | EventBridge → SQS → Lambda pipeline |
| Egress, EgressProps | Construct | DynamoDB Streams → Lambda → EventBridge |
| Facade, FacadeProps, JsResolverConfig, LambdaResolverConfig | Construct | AppSync GraphQL API with JS pipeline + Lambda resolvers |
| parseSchemaFields, discoverJsResolvers | Function | Facade helpers (schema parsing, `.fn.js` file discovery) |

### observability/
CloudWatch monitoring and dashboards. Used by hub stacks only.

| Export | Type | Description |
|--------|------|-------------|
| Monitoring, MonitoringProps | Construct | CloudWatch alarms for Lambda/SQS/EventBridge/Bedrock |
| ServiceDashboard, ServiceDashboardProps | Construct | CloudWatch dashboards with Lambda/DLQ/EventBridge metrics |

### extensions/
Specialized, optional constructs with heavier or narrower dependencies.

| Export | Type | Description |
|--------|------|-------------|
| AgentRuntime, AgentRuntimeProps | Construct | Bedrock AgentCore runtime + tool targets |
| KnowledgeBase, KnowledgeBaseProps | Construct | Bedrock Knowledge Base + S3 data source |
| CrossAccountBusPolicy, CrossAccountBusPolicyProps | Construct | Cross-account EventBridge policy |
| SharedParameter, SharedParameterProps | Construct | Cross-account SSM parameter sharing |
| DomainAccountMap, getDomainAccounts, getConsumerAccountIds | Type/Function | Cross-account account resolution helpers |
| resolveBusArn, resolveSsmValue | Function | Cross-account ARN/SSM resolution |
| CostControls, CostControlsProps | Construct | AWS Budgets monitoring (80%/100% thresholds) |
| AdapterSchedule, AdapterScheduleProps | Construct | EventBridge polling rules |
| RuntimeConfig, RuntimeConfigProps, RuntimeConfigSsmPaths | Construct | Writes config.json to S3 from SSM parameters |

### utils/
Utility functions (not constructs) used across services.

| Export | Type | Description |
|--------|------|-------------|
| NamingService, NamingServiceConfig, createNamingService, getPrefix, discoverSubsystem | Type/Function | Consistent resource naming |
| defaultLambdaProps, agentLambdaProps | Function | Standard Lambda configuration |
| applyStandardTags, StandardTagsProps | Function | CDK tag application |
| resolvePipelineConfig, ResolvedPipelineConfig, ScheduleConfig, inferServiceMetadata, loadTierDefaults, mergeConfigs, HARDCODED_FALLBACKS | Function/Type | Pipeline configuration resolution |

## Test Organization

Tests mirror source structure:

```
libs/cdk-constructs/test/
  core/
    service-stack.test.ts
    state.test.ts
    ingress.test.ts
    egress.test.ts
    facade.test.ts
  observability/
    monitoring.test.ts
  extensions/
    adapter-schedule.test.ts
    cross-account.test.ts
    knowledge-base.test.ts
  utils/
    default-lambda-props.test.ts
    naming-service.test.ts
    resolve-pipeline-config.test.ts
    tagging.test.ts
```

Note: No test files exist for `agent-runtime`, `cost-controls`, `runtime-config`, or `dashboard` constructs. No new tests are created as part of this grouping.

## Consumer Migration

No root barrel. All existing `@nestfolio/cdk-constructs` imports are rewritten to subpaths.

| Consumer type | Typical imports | New subpath |
|---|---|---|
| All 17 services/hubs | ServiceStack + props | `cdk-constructs/core` |
| 15+ services | resolvePipelineConfig | `cdk-constructs/utils` |
| 8 event consumers | Ingress | `cdk-constructs/core` |
| 6 event publishers | Egress | `cdk-constructs/core` |
| 4 BFFs | Facade, discoverJsResolvers | `cdk-constructs/core` |
| 3 hubs | Monitoring, ServiceDashboard | `cdk-constructs/observability` |
| 3 hubs | createNamingService, applyStandardTags | `cdk-constructs/utils` |
| advisory-ctrl | AgentRuntime | `cdk-constructs/extensions` |
| investor-hub | CostControls | `cdk-constructs/extensions` |
| Hubs w/ cross-account | CrossAccountBusPolicy, SharedParameter | `cdk-constructs/extensions` |

~62 import statements across ~17 consumers. Most services end up with 2 imports (`core` + `utils`). Hubs have 3-4.

## Non-Goals

- No new constructs or functionality
- No changes to construct internals or APIs
- No splitting into separate Nx libraries
