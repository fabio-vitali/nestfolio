# 01 -- Foundation: Monorepo, Shared Libraries, Infrastructure, CI/CD

Blueprint for Nestfolio's development foundation -- Nx monorepo setup, shared libraries, AWS infrastructure, CI/CD pipeline, and local development environment.

> **Audience**: Solo developer building with AI assistance
> **Tech Stack**: Nx v20+, Node.js 22 LTS, TypeScript 5.x, pnpm, AWS CDK v2
> **Scope**: Phase 1-3 (prototype/reference architecture through IBKR sandbox). See [00-master-plan.md](./00-master-plan.md) for phase definitions.

---

## 1. Nx Monorepo Setup

### 1.1 Workspace Initialization

```bash
# Create Nx workspace with integrated monorepo
npx create-nx-workspace@latest nestfolio \
  --preset=ts \
  --pm=pnpm \
  --nxCloud=skip

cd nestfolio

# Install core dependencies
pnpm add -D @nx/js @nx/node @nx/web @nx/angular
pnpm add aws-cdk-lib constructs @aws-cdk/aws-solutions-constructs
pnpm add @aws-lambda-powertools/logger @aws-lambda-powertools/metrics @aws-lambda-powertools/tracer
pnpm add awilix highland mutative zod
pnpm add @langchain/langgraph @langchain/aws @langchain/core  # Pin to latest stable at project start -- use exact versions, no ^ ranges
pnpm add -D @types/highland jest ts-jest esbuild @aws-cdk/aws-bedrock-agentcore-alpha
```

### 1.2 Workspace Structure

```
nestfolio/
├── nx.json                          # Nx workspace config
├── tsconfig.base.json               # Root TS config with path aliases
├── pnpm-workspace.yaml              # pnpm workspace config
├── .github/
│   ├── workflows/
│   │   ├── pr-deploy.yml            # PR workflow: sandbox deployment
│   │   ├── main-deploy.yml          # Main workflow: staging + production
│   │   └── pr-cleanup.yml           # Sandbox cleanup on PR close
│   └── scripts/
│       └── validate-pipeline-configs.sh  # Pipeline.json schema validation
│
├── .aws/
│   └── github-oidc-setup.yml       # CloudFormation: OIDC trust for GitHub Actions
├── .pipeline-schema.json            # JSON Schema for pipeline.json files
├── deploy-all.sh                    # Phase-ordered deployment script
├── destroy-all.sh                   # Reverse-order teardown script
│
├── services/
│   ├── investor/                    # Investor domain
│   │   ├── investor-hub/            # EventBridge bus + forwarding rules
│   │   ├── investor-web/            # Cognito + CloudFront + static assets
│   │   ├── investor-bff/            # AppSync GraphQL, InvestorProfile aggregate
│   │   └── investor-ctrl/           # Notification pipeline (Step Functions)
│   │
│   ├── advisory/                    # Advisory domain
│   │   ├── advisory-hub/            # EventBridge bus + forwarding rules
│   │   ├── advisory-ctrl/           # Decision lifecycle (Step Functions)
│   │   ├── compliance-ctrl/         # Compliance check pipeline (Step Functions)
│   │   ├── operations-ctrl/         # Incident, model promotion, cost governance
│   │   └── advisory-bff/            # Recommendations, compliance, ops dashboards
│   │
│   └── execution/                   # Execution domain
│       ├── execution-hub/           # EventBridge bus + forwarding rules
│       ├── execution-ctrl/          # Order lifecycle (Step Functions)
│       ├── execution-adpt/          # IBKR adapter (anti-corruption layer)
│       ├── portfolio-bff/           # Portfolio dashboard, positions, performance
│       └── portfolio-ctrl/          # Reconciliation pipeline (Step Functions)
│
├── libs/
│   ├── cdk-constructs/              # Reusable CDK construct library
│   ├── lambda-utils/                # Shared Lambda runtime utilities (handler base, DI container, idempotency)
│   ├── platform-core/               # Reusable patterns ported from @event-lab/event-processor:
│   │                                #   Bus, EventBridgeBus, Pipe, UnitOfWork, TableRepository,
│   │                                #   EventRepository, BucketRepository, NotRetryableError,
│   │                                #   handleClientError, handleErrors, Highland.js streaming,
│   │                                #   logger with @log() decorator, Awilix DI, event schema validation
│   ├── domain-core/                 # Nestfolio-specific event types, domain models, agent schemas
│   ├── agent-core/                  # LangGraph.js agent orchestration (factory, graph, prompts)
│   ├── ui-components/               # Design system component library
│   ├── appsync-client/              # AppSync multi-endpoint client wrapper
│   ├── auth/                        # Cognito auth service, guards, interceptors
│   ├── i18n/                        # Locale service, formatters, translation pipes
│   └── shared-state/                # Tenant context, user profile signals
│
├── tools/
│   └── scripts/                     # Development utility scripts
│
└── apps/
    ├── investor-app/                # Angular shell host (investor-facing, loads MFE remotes)
    ├── operations-app/              # Angular shell host (internal ops dashboards)
    ├── portfolio-mfe/               # MFE remote — Dashboard, Portfolio Detail (deploys to portfolio-bff S3)
    ├── advisory-mfe/                # MFE remote — Decision Detail, Confirmation (deploys to advisory-bff S3)
    └── investor-mfe/                # MFE remote — Onboarding, Settings, Notifications (deploys to investor-bff S3)
```

### 1.3 Project Naming Conventions

Nx project names match spec service names exactly. The `project.json` at each service root defines the project.

| Nx Project Name | Path | Type |
|---|---|---|
| `investor-hub` | `services/investor/investor-hub` | CDK Stack |
| `investor-web` | `services/investor/investor-web` | CDK Stack |
| `investor-bff` | `services/investor/investor-bff` | CDK Stack |
| `investor-ctrl` | `services/investor/investor-ctrl` | CDK Stack |
| `advisory-hub` | `services/advisory/advisory-hub` | CDK Stack |
| `advisory-ctrl` | `services/advisory/advisory-ctrl` | CDK Stack |
| `compliance-ctrl` | `services/advisory/compliance-ctrl` | CDK Stack |
| `operations-ctrl` | `services/advisory/operations-ctrl` | CDK Stack |
| `advisory-bff` | `services/advisory/advisory-bff` | CDK Stack |
| `execution-hub` | `services/execution/execution-hub` | CDK Stack |
| `execution-ctrl` | `services/execution/execution-ctrl` | CDK Stack |
| `execution-adpt` | `services/execution/execution-adpt` | CDK Stack |
| `portfolio-bff` | `services/execution/portfolio-bff` | CDK Stack |
| `portfolio-ctrl` | `services/execution/portfolio-ctrl` | CDK Stack |
| `cdk-constructs` | `libs/cdk-constructs` | Library |
| `lambda-utils` | `libs/lambda-utils` | Library |
| `platform-core` | `libs/platform-core` | Library |
| `domain-core` | `libs/domain-core` | Library |
| `agent-core` | `libs/agent-core` | Library |
| `ui-components` | `libs/ui-components` | Library |
| `appsync-client` | `libs/appsync-client` | Library |
| `auth` | `libs/auth` | Library |
| `i18n` | `libs/i18n` | Library |
| `shared-state` | `libs/shared-state` | Library |
| `investor-app` | `apps/investor-app` | Angular Shell Host |
| `operations-app` | `apps/operations-app` | Angular Shell Host |
| `portfolio-mfe` | `apps/portfolio-mfe` | Angular MFE Remote |
| `advisory-mfe` | `apps/advisory-mfe` | Angular MFE Remote |
| `investor-mfe` | `apps/investor-mfe` | Angular MFE Remote |

### 1.4 pnpm Workspace Configuration

```yaml
# pnpm-workspace.yaml
packages:
  - 'services/**'
  - 'libs/*'
  - 'tools/*'
  - 'apps/*'
```

### 1.5 TypeScript Project References

```jsonc
// tsconfig.base.json
{
  "compileOnSave": false,
  "compilerOptions": {
    "rootDir": ".",
    "sourceMap": true,
    "declaration": true,
    "moduleResolution": "node",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022"],
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "paths": {
      "@nestfolio/cdk-constructs": ["libs/cdk-constructs/src/index.ts"],
      "@nestfolio/lambda-utils": ["libs/lambda-utils/src/index.ts"],
      "@nestfolio/platform-core": ["libs/platform-core/src/index.ts"],
      "@nestfolio/platform-core/*": ["libs/platform-core/src/*"],
      "@nestfolio/domain-core": ["libs/domain-core/src/index.ts"],
      "@nestfolio/domain-core/*": ["libs/domain-core/src/*"],
      "@nestfolio/agent-core": ["libs/agent-core/src/index.ts"],
      "@nestfolio/agent-core/*": ["libs/agent-core/src/*"],
      "@nestfolio/ui-components": ["libs/ui-components/src/index.ts"],
      "@nestfolio/appsync-client": ["libs/appsync-client/src/index.ts"],
      "@nestfolio/auth": ["libs/auth/src/index.ts"],
      "@nestfolio/i18n": ["libs/i18n/src/index.ts"],
      "@nestfolio/shared-state": ["libs/shared-state/src/index.ts"]
    }
  },
  "exclude": ["node_modules", "tmp"]
}
```

### 1.6 Nx Configuration

```jsonc
// nx.json
{
  "$schema": "./node_modules/nx/schemas/nx-schema.json",
  "namedInputs": {
    "default": ["{projectRoot}/**/*", "sharedGlobals"],
    "sharedGlobals": ["{workspaceRoot}/tsconfig.base.json"],
    "production": [
      "default",
      "!{projectRoot}/**/*.test.ts",
      "!{projectRoot}/test/**/*",
      "!{projectRoot}/jest.config.ts"
    ]
  },
  "targetDefaults": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["production", "^production"],
      "cache": true
    },
    "test": {
      "inputs": ["default", "^production"],
      "cache": true
    },
    "lint": {
      "inputs": ["default"],
      "cache": true
    },
    "deploy": {
      "dependsOn": ["build"],
      "cache": false
    }
  },
  "defaultBase": "main"
}
```

---

## 2. Shared Libraries

### 2.1 `libs/cdk-constructs/` -- Reusable CDK Patterns

Implements the **five-construct pattern** that every service stack composes. Each construct encapsulates a distinct infrastructure concern.

#### State Construct

Owns the data layer: DynamoDB tables and S3 buckets.

```typescript
// libs/cdk-constructs/src/state.ts
import { Construct } from 'constructs';
import {
  Table, AttributeType, BillingMode,
  StreamViewType, ProjectionType
} from 'aws-cdk-lib/aws-dynamodb';
import { Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface StateProps {
  /** Include S3 bucket alongside DynamoDB table */
  withBucket?: boolean;
  /** Additional GSIs beyond the two default ones */
  additionalGsis?: GsiConfig[];
}

export class State extends Construct {
  readonly table: Table;
  readonly bucket?: Bucket;

  constructor(scope: Construct, id: string, props: StateProps = {}) {
    super(scope, id);

    this.table = new Table(this, 'Table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.DESTROY, // Phase 1: DESTROY for clean teardown. Use RETAIN for production.
    });

    // GSI 1: Tenant queries -- all entities for a tenant
    this.table.addGlobalSecondaryIndex({
      indexName: 'tenantId-index',
      partitionKey: { name: 'tenantId', type: AttributeType.STRING },
      sortKey: { name: '__typename', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI 2: Time-based queries -- per entity type
    this.table.addGlobalSecondaryIndex({
      indexName: 'typename-timestamp-index',
      partitionKey: { name: '__typename', type: AttributeType.STRING },
      sortKey: { name: 'timestamp', type: AttributeType.STRING },
      projectionType: ProjectionType.KEYS_ONLY,
    });

    if (props.withBucket) {
      this.bucket = new Bucket(this, 'Bucket', {
        encryption: BucketEncryption.S3_MANAGED,
        versioned: true,
        removalPolicy: RemovalPolicy.DESTROY, // Phase 1: DESTROY for clean teardown. Use RETAIN for production.
        autoDeleteObjects: true, // Required for DESTROY policy on non-empty buckets
      });
    }
  }
}
```

#### Ingress Construct

Event consumption path: EventBridge rule -> SQS queue (with DLQ) -> Lambda consumer.

```typescript
// libs/cdk-constructs/src/ingress.ts
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { IEventBus, Rule } from 'aws-cdk-lib/aws-events';
import { SqsQueue } from 'aws-cdk-lib/aws-events-targets';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

export interface IngressProps {
  eventBus: IEventBus;
  eventTypes: string[];
  handler: IFunction;
  batchSize?: number;
  maxBatchingWindowMs?: number;
  maxRetries?: number;
}

export class Ingress extends Construct {
  readonly queue: Queue;
  readonly dlq: Queue;

  constructor(scope: Construct, id: string, props: IngressProps) {
    super(scope, id);

    this.dlq = new Queue(this, 'DLQ', {
      retentionPeriod: Duration.days(14),
    });

    this.queue = new Queue(this, 'Queue', {
      visibilityTimeout: Duration.seconds(180),
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: props.maxRetries ?? 10,
      },
    });

    new Rule(this, 'Rule', {
      eventBus: props.eventBus,
      eventPattern: {
        detailType: props.eventTypes,
      },
      targets: [new SqsQueue(this.queue)],
    });

    props.handler.addEventSource(new SqsEventSource(this.queue, {
      batchSize: props.batchSize ?? 10,
      maxBatchingWindow: Duration.millis(props.maxBatchingWindowMs ?? 1000),
      reportBatchItemFailures: true,
    }));
  }
}
```

#### Egress Construct

Event publishing path: DynamoDB Streams -> Lambda publisher -> EventBridge.

```typescript
// libs/cdk-constructs/src/egress.ts
import { Construct } from 'constructs';
import { Stack } from 'aws-cdk-lib';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { StartingPosition, FilterCriteria, FilterRule } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

export interface EgressProps {
  table: ITable;
  busName: string;
  serviceName: string;
  /** DynamoDB __typename values to publish events for */
  publishableTypes: string[];
}

export class Egress extends Construct {
  constructor(scope: Construct, id: string, props: EgressProps) {
    super(scope, id);

    const publisher = new NodejsFunction(this, 'Publisher', {
      entry: require.resolve('@nestfolio/lambda-utils/event-publisher'),
      environment: {
        BUS_NAME: props.busName,
        SERVICE_NAME: props.serviceName,
      },
    });

    publisher.addToRolePolicy(new PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [
        `arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${props.busName}`,
      ],
    }));

    publisher.addEventSource(new DynamoEventSource(props.table, {
      startingPosition: StartingPosition.LATEST,
      bisectBatchOnError: true,
      retryAttempts: 3,
      filters: props.publishableTypes.flatMap(typeName => [
        FilterCriteria.filter({
          eventName: FilterRule.isEqual('INSERT'),
          dynamodb: {
            NewImage: {
              __typename: { S: FilterRule.isEqual(typeName) },
            },
          },
        }),
        FilterCriteria.filter({
          eventName: FilterRule.isEqual('MODIFY'),
          dynamodb: {
            NewImage: {
              __typename: { S: FilterRule.isEqual(typeName) },
            },
          },
        }),
      ]),
    }));
  }
}
```

#### Facade Construct

API surface: AppSync GraphQL (BFF services) or REST API Gateway (ADPT services).

```typescript
// libs/cdk-constructs/src/facade.ts
import { Construct } from 'constructs';
import { GraphqlApi, SchemaFile, AuthorizationType, UserPoolConfig } from 'aws-cdk-lib/aws-appsync';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { IUserPool } from 'aws-cdk-lib/aws-cognito';

export interface FacadeProps {
  /** Path to GraphQL schema file (for BFF services) */
  schemaPath?: string;
  /** Cognito User Pool for authentication (AD-9) */
  userPool?: IUserPool;
  /** Lambda resolvers for AppSync */
  resolverFunctions?: Record<string, IFunction>;
  /** DynamoDB table for direct resolvers */
  table?: ITable;
}

export class Facade extends Construct {
  readonly api?: GraphqlApi;

  constructor(scope: Construct, id: string, props: FacadeProps) {
    super(scope, id);

    if (props.schemaPath) {
      this.api = new GraphqlApi(this, 'Api', {
        name: `${id}-api`,
        schema: SchemaFile.fromAsset(props.schemaPath),
        authorizationConfig: {
          defaultAuthorization: {
            authorizationType: AuthorizationType.USER_POOL,
            userPoolConfig: { userPool: props.userPool! },
          },
        },
      });
    }
  }
}
```

#### AgentRuntime Construct

Wraps `@aws-cdk/aws-bedrock-agentcore-alpha` constructs (Runtime, Gateway, Memory) to provision Bedrock AgentCore infrastructure for advisory-domain services. Provides a high-level interface for deploying LangGraph.js agent runtimes backed by Bedrock model access, session memory, and API gateway routing. Detailed CDK implementation is in [03-ai-agent-system.md](./03-ai-agent-system.md).

#### Additional CDK Utilities

```typescript
// libs/cdk-constructs/src/default-lambda-props.ts
import { Construct } from 'constructs';
import { Runtime, Architecture, Tracing } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';

export const defaultLambdaProps = (scope: Construct): Partial<NodejsFunctionProps> => ({
  runtime: Runtime.NODEJS_22_X,
  architecture: Architecture.ARM_64,
  memorySize: 256,
  timeout: Duration.seconds(30),
  tracing: Tracing.ACTIVE,
  bundling: {
    minify: true,
    sourceMap: true,
    target: 'node22',
  },
});
```

---

### 2.2 `libs/platform-core/` -- Reusable Event Processing Patterns

> **Ported from**: `@event-lab/event-processor` library. Patterns are adapted into Nestfolio's own library — no external runtime dependency.

Provides the core event processing abstractions: Bus, Pipe, UnitOfWork, repositories, error handling, logger, and Highland.js stream processing. These patterns are domain-agnostic and reusable across projects.

#### Source Structure

```
libs/platform-core/src/
├── index.ts                    # Re-exports
├── bus.ts                      # Bus interface, EventBridgeBus implementation (publish failures throw retryable Error by default; NotRetryableError only for validation errors like oversized payloads)
├── core.ts                     # Event, Pipe, UnitOfWork types, envVar, getTime, getUUID
├── errors.ts                   # NotRetryableError, handleClientError, handleErrors
├── logger.ts                   # Powertools Logger with @log() decorator
├── table.ts                    # TableEntry type
├── validation.ts               # Consumer-side event schema validation (see below)
└── repositories/
    ├── table.repository.ts     # Abstract DynamoDB repository with pagination
    ├── event.repository.ts     # Abstract EventBridge repository
    └── bucket.repository.ts    # Abstract S3 repository
```

#### Consumer-Side Event Schema Validation (AD-21)

Consumer services import Zod schemas from the producing service's domain-core exports and validate incoming events at ingestion time:

```typescript
// libs/platform-core/src/validation.ts
import Highland from 'highland';
const _ = Highland;
import { ZodSchema, ZodError } from 'zod';
import { Bus, BusEvent } from './bus';
import { logger } from './logger';
import { getUUID, getTime } from './core';

export interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  error?: ZodError;
}

/**
 * Validates an incoming event against the producer's exported Zod schema.
 * Used in Ingress handlers before passing events to the pipeline.
 */
export function validateIncomingEvent<T>(
  event: BusEvent,
  schema: ZodSchema<T>,
): ValidationResult<T> {
  const result = schema.safeParse(event);
  if (result.success) {
    return { valid: true, data: result.data };
  }
  logger.error('Consumer-side schema validation failed', {
    eventType: event.type,
    eventId: event.id,
    errors: result.error.issues,
  });
  return { valid: false, error: result.error };
}

/**
 * Highland.js stream operator that validates and filters events.
 * Invalid events are published as error events and dropped from the stream.
 */
export function withSchemaValidation<T>(
  schema: ZodSchema<T>,
  bus: Bus,
  errorEventType: string,
) {
  return (source: Highland.Stream<UnitOfWork>) =>
    source.flatMap((uow) => {
      const result = validateIncomingEvent(uow.event, schema);
      if (result.valid) {
        return _([uow]);
      }
      // Publish error event, drop from stream (message goes to DLQ via SQS)
      return _(bus.publish({
        id: getUUID(),
        type: errorEventType,
        timestamp: getTime(),
        error: {
          name: 'SchemaValidationError',
          message: `Event ${uow.event.type} failed consumer schema validation`,
          details: { eventId: uow.event.id, issues: result.error!.issues },
        },
      }).then(() => []));
    });
}
```

**Usage in a consumer service's Ingress handler**:

```typescript
// services/advisory/advisory-ctrl/src/handler.ts
import { MandateGrantedSchema } from '@nestfolio/domain-core/investor/schemas';
import { withSchemaValidation } from '@nestfolio/platform-core';

// In the pipeline, validate incoming events from investor-bff
const pipeline = source
  .through(withSchemaValidation(MandateGrantedSchema, bus, 'SCHEMA_VALIDATION_FAILED'))
  .through(mandateGrantedPipe.feed);
```

---

### 2.3 `libs/lambda-utils/` -- Shared Lambda Runtime

Provides the handler base class, DI container setup (Awilix), SQS record parsing, and idempotency utilities. **Core types (BusEvent, TenantContext, UnitOfWork, Bus, EventBridgeBus, Pipe, NotRetryableError) live in `libs/platform-core/`** — lambda-utils re-exports them for convenience but does not redefine them.

#### Re-exports from platform-core

```typescript
// libs/lambda-utils/src/index.ts
// Re-export core types from platform-core for convenience
export { BusEvent, TenantContext, UnitOfWork, Bus, EventBridgeBus, Pipe, NotRetryableError, isRetryable } from '@nestfolio/platform-core';
```

#### SQS Record Parsing

```typescript
// libs/lambda-utils/src/sqs-parser.ts
import { SQSRecord } from 'aws-lambda';
import { BusEvent, UnitOfWork } from '@nestfolio/platform-core';

/** Parses an SQS record into a UnitOfWork for pipeline processing */
export function parseRecord<T = Record<string, unknown>>(record: SQSRecord): UnitOfWork<T> {
  const body = JSON.parse(record.body);
  const event: BusEvent<T> = body.detail ?? body;
  return { event, payload: event.subject as Record<string, unknown>, record };
}
```

#### Idempotency Utilities

```typescript
// libs/lambda-utils/src/idempotency.ts
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

const IDEMPOTENCY_TTL_SECONDS = 86400; // 24 hours

export class IdempotencyGuard {
  constructor(
    private readonly client: DynamoDBClient,
    private readonly tableName: string,
  ) {}

  async ensureOnce(eventType: string, eventId: string): Promise<boolean> {
    const key = `${eventType}#${eventId}`;
    const ttl = Math.floor(Date.now() / 1000) + IDEMPOTENCY_TTL_SECONDS;

    try {
      await this.client.send(new PutItemCommand({
        TableName: this.tableName,
        Item: {
          pk: { S: `Idempotency#${key}` },
          sk: { S: 'Processed' },
          processedAt: { S: new Date().toISOString() },
          ttl: { N: ttl.toString() },
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }));
      return true; // First time -- proceed
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        return false; // Already processed -- skip
      }
      throw error;
    }
  }
}
```

#### Base Repository Classes

```typescript
// libs/lambda-utils/src/repositories/table.repository.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

export abstract class TableRepository {
  protected readonly docClient: DynamoDBDocumentClient;

  constructor(
    protected readonly client: DynamoDBClient,
    protected readonly tableName: string,
  ) {
    this.docClient = DynamoDBDocumentClient.from(client);
  }

  protected async put(item: Record<string, unknown>): Promise<void> {
    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
    }));
  }

  protected async queryByPk(pk: string, skPrefix?: string): Promise<Record<string, unknown>[]> {
    const params: any = {
      TableName: this.tableName,
      KeyConditionExpression: skPrefix
        ? 'pk = :pk AND begins_with(sk, :sk)'
        : 'pk = :pk',
      ExpressionAttributeValues: { ':pk': pk, ...(skPrefix ? { ':sk': skPrefix } : {}) },
    };
    const result = await this.docClient.send(new QueryCommand(params));
    return result.Items ?? [];
  }
}
```

---

### 2.4 `libs/domain-core/` -- Nestfolio-Specific Event Types, Schemas, and Domain Models

Organized by domain, exports Nestfolio-specific typed event definitions, **Zod schemas for each event type** (used by both producers and consumers per AD-21), domain entity types, and agent schemas. Reusable patterns (Bus, Pipe, UnitOfWork, repositories, validation) live in `libs/platform-core/`.

#### Directory Structure

```
libs/domain-core/src/
├── index.ts                    # Re-exports
├── shared/
│   ├── types.ts                # BusEvent, TenantContext, EditEvent
│   └── errors.ts               # Domain error types
├── investor/
│   ├── events.ts               # Investor domain event type constants
│   ├── schemas.ts              # Zod schemas for each investor event (producer exports, consumers import)
│   └── models.ts               # InvestorProfile, Goal, RiskProfile, Mandate, Notification
├── advisory/
│   ├── events.ts               # Advisory domain event type constants
│   ├── schemas.ts              # Zod schemas for each advisory event
│   └── models.ts               # DecisionPacket, ComplianceCheck, Incident, ModelVersion
└── execution/
    ├── events.ts               # Execution domain event type constants
    ├── schemas.ts              # Zod schemas for each execution event
    └── models.ts               # Order, Portfolio, Position, Reconciliation, BrokerSession
```

**Event schema export pattern** (AD-21): Each domain's `schemas.ts` defines and exports Zod schemas for every event type in that domain. The producing service uses these schemas at publish time (Egress validation). Consumer services import the same schemas for ingestion validation (Ingress validation via `withSchemaValidation` from `platform-core`).

```typescript
// libs/domain-core/src/investor/schemas.ts
import { z } from 'zod';
import { BusEventSchema } from '../shared/types';

export const MandateGrantedSchema = BusEventSchema.extend({
  type: z.literal('MANDATE_GRANTED'),
  subject: z.object({
    mandateId: z.string(),
    level: z.enum(['ADVISORY', 'DISCRETIONARY']),
    effectiveDate: z.string().datetime(),
  }),
});

export const GoalUpdatedSchema = BusEventSchema.extend({
  type: z.literal('GOAL_UPDATED'),
  subject: z.object({
    goalId: z.string(),
    objective: z.string(),
    timeHorizonMonths: z.number().int().positive(),
    targetReturn: z.number().min(0).max(1),
  }),
});

// ... one schema per event type
```

#### Event Type Definitions (Investor Domain Example)

```typescript
// libs/domain-core/src/investor/events.ts
export const InvestorEventTypes = {
  // investor-web
  USER_REGISTERED: 'USER_REGISTERED',
  USER_AUTHENTICATED: 'USER_AUTHENTICATED',
  USER_SESSION_EXPIRED: 'USER_SESSION_EXPIRED',
  USER_DELETION_REQUESTED: 'USER_DELETION_REQUESTED',
  PII_REMOVED: 'PII_REMOVED',
  TENANT_ANONYMIZED: 'TENANT_ANONYMIZED',

  // investor-bff
  ONBOARDING_ANSWER_RECORDED: 'ONBOARDING_ANSWER_RECORDED',
  ONBOARDING_COMPLETED: 'ONBOARDING_COMPLETED',
  GOAL_SET: 'GOAL_SET',
  GOAL_UPDATED: 'GOAL_UPDATED',
  RISK_PROFILE_SET: 'RISK_PROFILE_SET',
  RISK_PROFILE_UPDATED: 'RISK_PROFILE_UPDATED',
  MANDATE_GRANTED: 'MANDATE_GRANTED',
  MANDATE_UPDATED: 'MANDATE_UPDATED',
  MANDATE_REVOKED: 'MANDATE_REVOKED',
  OPERATING_MODE_SELECTED: 'OPERATING_MODE_SELECTED',
  OPERATING_MODE_CHANGED: 'OPERATING_MODE_CHANGED',
  DEPOSIT_INITIATED: 'DEPOSIT_INITIATED',
  WITHDRAWAL_REQUESTED: 'WITHDRAWAL_REQUESTED',
  ACCOUNT_CLOSURE_REQUESTED: 'ACCOUNT_CLOSURE_REQUESTED',
  ACCOUNT_CLOSED: 'ACCOUNT_CLOSED',
  BROKER_AUTHORIZATION_REVOKED: 'BROKER_AUTHORIZATION_REVOKED',
  NOTIFICATION_READ: 'NOTIFICATION_READ',

  // investor-ctrl
  NOTIFICATION_CREATED: 'NOTIFICATION_CREATED',
  NOTIFICATION_SENT: 'NOTIFICATION_SENT',
  NOTIFICATION_DELIVERED: 'NOTIFICATION_DELIVERED',
  MONTHLY_REPORT_GENERATED: 'MONTHLY_REPORT_GENERATED',
} as const;

export type InvestorEventType = typeof InvestorEventTypes[keyof typeof InvestorEventTypes];
```

```typescript
// libs/domain-core/src/advisory/events.ts
export const AdvisoryEventTypes = {
  // advisory-ctrl
  AGENT_INVOCATION_STARTED: 'AGENT_INVOCATION_STARTED',
  AGENT_INVOCATION_COMPLETED: 'AGENT_INVOCATION_COMPLETED',
  AGENT_EXECUTION_FAILED: 'AGENT_EXECUTION_FAILED',
  GOAL_INTERPRETATION_PRODUCED: 'GOAL_INTERPRETATION_PRODUCED',
  RISK_EVALUATION_PRODUCED: 'RISK_EVALUATION_PRODUCED',
  MARKET_SIGNAL_DETECTED: 'MARKET_SIGNAL_DETECTED',
  PORTFOLIO_CONSTRUCTION_PROPOSED: 'PORTFOLIO_CONSTRUCTION_PROPOSED',
  REBALANCE_PLAN_PRODUCED: 'REBALANCE_PLAN_PRODUCED',
  RECOMMENDATION_PROPOSED: 'RECOMMENDATION_PROPOSED',
  EXPLANATION_GENERATED: 'EXPLANATION_GENERATED',
  DECISION_PACKET_CREATED: 'DECISION_PACKET_CREATED',
  DECISION_PACKET_ENRICHED: 'DECISION_PACKET_ENRICHED',
  USER_CONFIRMATION_REQUESTED: 'USER_CONFIRMATION_REQUESTED',
  USER_CONFIRMED: 'USER_CONFIRMED',
  USER_REJECTED: 'USER_REJECTED',

  // compliance-ctrl
  DECISION_APPROVED: 'DECISION_APPROVED',
  DECISION_BLOCKED: 'DECISION_BLOCKED',
  GUARDRAIL_VIOLATION_DETECTED: 'GUARDRAIL_VIOLATION_DETECTED',
  ESCALATION_TRIGGERED: 'ESCALATION_TRIGGERED',
  COMPLIANCE_APPROVAL_GRANTED: 'COMPLIANCE_APPROVAL_GRANTED',
  AUDIT_ARTIFACT_CREATED: 'AUDIT_ARTIFACT_CREATED',
  SUITABILITY_CHECK_PASSED: 'SUITABILITY_CHECK_PASSED',
  SUITABILITY_CHECK_FAILED: 'SUITABILITY_CHECK_FAILED',

  // operations-ctrl
  INCIDENT_DETECTED: 'INCIDENT_DETECTED',
  INCIDENT_CONTAINED: 'INCIDENT_CONTAINED',
  INCIDENT_ESCALATED: 'INCIDENT_ESCALATED',
  INCIDENT_RESOLVED: 'INCIDENT_RESOLVED',
  CIRCUIT_BREAKER_TRIGGERED: 'CIRCUIT_BREAKER_TRIGGERED',
  CIRCUIT_BREAKER_RESET: 'CIRCUIT_BREAKER_RESET',
  HEALTH_CHECK_COMPLETED: 'HEALTH_CHECK_COMPLETED',
  MODEL_REGISTERED: 'MODEL_REGISTERED',
  SHADOW_RUN_STARTED: 'SHADOW_RUN_STARTED',
  SHADOW_RUN_COMPLETED: 'SHADOW_RUN_COMPLETED',
  MODEL_PROMOTION_REQUESTED: 'MODEL_PROMOTION_REQUESTED',
  MODEL_PROMOTION_APPROVED: 'MODEL_PROMOTION_APPROVED',
  MODEL_PROMOTED: 'MODEL_PROMOTED',
  MODEL_ROLLBACK_TRIGGERED: 'MODEL_ROLLBACK_TRIGGERED',
  TENANT_BUDGET_APPROACHING: 'TENANT_BUDGET_APPROACHING',
  TENANT_BUDGET_EXCEEDED: 'TENANT_BUDGET_EXCEEDED',
  REASONING_TIER_CHANGED: 'REASONING_TIER_CHANGED',
  OPERATOR_ACTION_PERFORMED: 'OPERATOR_ACTION_PERFORMED',
  EVENT_DELIVERY_FAILED: 'EVENT_DELIVERY_FAILED',
  EVENT_REPLAYED: 'EVENT_REPLAYED',

  // advisory-bff
  USER_VIEWED_EXPLANATION: 'USER_VIEWED_EXPLANATION',
} as const;

export type AdvisoryEventType = typeof AdvisoryEventTypes[keyof typeof AdvisoryEventTypes];
```

```typescript
// libs/domain-core/src/execution/events.ts
export const ExecutionEventTypes = {
  // execution-ctrl
  ORDER_SUBMITTED: 'ORDER_SUBMITTED',
  ORDER_STAGED: 'ORDER_STAGED',
  EXECUTION_PAUSED: 'EXECUTION_PAUSED',
  EXECUTION_RESUMED: 'EXECUTION_RESUMED',

  // execution-adpt
  ORDER_ACCEPTED: 'ORDER_ACCEPTED',
  ORDER_PARTIALLY_FILLED: 'ORDER_PARTIALLY_FILLED',
  ORDER_FILLED: 'ORDER_FILLED',
  ORDER_REJECTED: 'ORDER_REJECTED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  PORTFOLIO_SNAPSHOT_IMPORTED: 'PORTFOLIO_SNAPSHOT_IMPORTED',
  BROKER_SESSION_ESTABLISHED: 'BROKER_SESSION_ESTABLISHED',
  BROKER_SESSION_LOST: 'BROKER_SESSION_LOST',
  STREAM_CONNECTED: 'STREAM_CONNECTED',
  STREAM_DISCONNECTED: 'STREAM_DISCONNECTED',
  BROKER_AUTHORIZATION_REVOKED: 'BROKER_AUTHORIZATION_REVOKED',
  DEPOSIT_DETECTED: 'DEPOSIT_DETECTED',
  WITHDRAWAL_SUBMITTED: 'WITHDRAWAL_SUBMITTED',
  WITHDRAWAL_COMPLETED: 'WITHDRAWAL_COMPLETED',
  WITHDRAWAL_REJECTED: 'WITHDRAWAL_REJECTED',

  // portfolio-bff
  PORTFOLIO_CREATED: 'PORTFOLIO_CREATED',
  PORTFOLIO_UPDATED: 'PORTFOLIO_UPDATED',
  POSITION_UPDATED: 'POSITION_UPDATED',
  CASH_BALANCE_UPDATED: 'CASH_BALANCE_UPDATED',

  // portfolio-ctrl
  PORTFOLIO_DRIFT_DETECTED: 'PORTFOLIO_DRIFT_DETECTED',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  RECONCILIATION_STARTED: 'RECONCILIATION_STARTED',
  RECONCILIATION_COMPLETED: 'RECONCILIATION_COMPLETED',
  RECONCILIATION_FAILED: 'RECONCILIATION_FAILED',
  RECONCILIATION_LOCK_ACQUIRED: 'RECONCILIATION_LOCK_ACQUIRED',
  RECONCILIATION_LOCK_RELEASED: 'RECONCILIATION_LOCK_RELEASED',
  PROJECTION_REBUILT: 'PROJECTION_REBUILT',
  CORPORATE_ACTION_APPLIED: 'CORPORATE_ACTION_APPLIED',
} as const;

export type ExecutionEventType = typeof ExecutionEventTypes[keyof typeof ExecutionEventTypes];
```

---

### 2.5 `libs/agent-core/` -- LangGraph.js Agent Orchestration

Centralises all AI agent creation, orchestration, prompt management, and structured output validation. Contains LangGraph.js graph definitions, prompt templates, and Zod output schemas. Every advisory-domain service that invokes an LLM agent imports from this library rather than directly depending on provider SDKs. The agent factory uses `ChatBedrockConverse` from `@langchain/aws` for all model access via Amazon Bedrock.

> **Version pinning (AD-13)**: Pin `@langchain/langgraph` and `@langchain/aws` to exact versions at project start. LangGraph.js has had breaking changes between minor versions. Use exact versions in `package.json` (no `^` ranges). Record the pinned versions in a compatibility matrix at the top of this file when the project starts.

#### Directory Structure

```
libs/agent-core/src/
├── index.ts                        # Re-exports
├── agent-factory.ts                # Creates LangChain-backed agent functions per type with correct provider/model/tools/prompt
├── graph-orchestrator.ts           # LangGraph StateGraph definition for the decision lifecycle
│                                   #   (parallel waves, serial gates)
├── agent-invoker.ts                # Wraps agent node invocation with observability + fallback
├── model-config.ts                 # Bedrock model config mapping (agent name → Bedrock model ID)
├── prompt-templates/               # Per-agent system prompts (names match AGENT_MODEL_CONFIG keys)
│   ├── user-goals.txt
│   ├── risk-assessment.txt
│   ├── market-research.txt
│   ├── portfolio-construction.txt
│   ├── rebalance-planner.txt
│   └── explainability.txt
└── output-schemas/                 # Zod schemas for each agent's structured output
    ├── user-goals.schema.ts
    ├── risk-assessment.schema.ts
    ├── market-research.schema.ts
    ├── portfolio-construction.schema.ts
    ├── rebalance-planner.schema.ts
    └── explainability.schema.ts
```

#### Key Modules

**`agent-factory.ts`** -- Creates a LangChain-backed agent function for each agent type. Resolves the Bedrock model ID, tools, and system prompt from `model-config.ts` and `prompt-templates/`. All model access goes through `ChatBedrockConverse` from `@langchain/aws`.

```typescript
// libs/agent-core/src/agent-factory.ts
import { ChatBedrockConverse } from '@langchain/aws';
import { getModelConfig } from './model-config';
import { loadPromptTemplate } from './prompt-templates';
import { getOutputSchema } from './output-schemas';

export type AgentType =
  | 'user-goals'
  | 'risk-assessment'
  | 'market-research'
  | 'portfolio-construction'
  | 'rebalance-planner'
  | 'explainability';

function buildChatModel(config: ReturnType<typeof getModelConfig>, outputSchema: ZodSchema) {
  return new ChatBedrockConverse({
    model: config.modelId,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    region: process.env.AWS_REGION,
  }).withStructuredOutput(outputSchema);
}

/**
 * Returns a LangGraph-compatible node function for the given agent type.
 * Each node receives the graph state, invokes the LLM via Bedrock,
 * validates output with .withStructuredOutput() (Bedrock native tool_use),
 * and returns the updated state slice.
 */
export function createAgentNode(type: AgentType) {
  const config = getModelConfig(type);
  const systemPrompt = loadPromptTemplate(type);
  const outputSchema = getOutputSchema(type);
  const model = buildChatModel(config, outputSchema);

  return async (state: Record<string, unknown>) => {
    const parsed = await model.invoke([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(state.context) },
    ]);
    return { [type]: parsed };
  };
}
```

**`graph-orchestrator.ts`** -- Defines the decision lifecycle execution order as a LangGraph `StateGraph`. Uses the canonical agent names from `03-ai-agent-system.md`.

```typescript
// libs/agent-core/src/graph-orchestrator.ts
import { StateGraph, Annotation } from '@langchain/langgraph';
import { createAgentNode } from './agent-factory';

// Decision state that flows through the graph
const DecisionState = Annotation.Root({
  context: Annotation<ContextBundle>,
  userGoals: Annotation<UserGoalsOutput | null>({ default: () => null }),
  risk: Annotation<RiskOutput | null>({ default: () => null }),
  market: Annotation<MarketOutput | null>({ default: () => null }),
  portfolio: Annotation<PortfolioOutput | null>({ default: () => null }),
  rebalance: Annotation<RebalanceOutput | null>({ default: () => null }),
  explanation: Annotation<ExplanationOutput | null>({ default: () => null }),
});

export function buildDecisionGraph() {
  const graph = new StateGraph(DecisionState)
    .addNode('user-goals', createAgentNode('user-goals'))
    .addNode('risk-assessment', createAgentNode('risk-assessment'))
    .addNode('market-research', createAgentNode('market-research'))
    .addNode('portfolio-construction', createAgentNode('portfolio-construction'))
    .addNode('rebalance-planner', createAgentNode('rebalance-planner'))
    .addNode('explainability', createAgentNode('explainability'))
    // Wave 1: parallel analysis
    .addEdge('__start__', 'user-goals')
    .addEdge('__start__', 'risk-assessment')
    .addEdge('__start__', 'market-research')
    // Wave 2: depends on Wave 1
    .addEdge('user-goals', 'portfolio-construction')
    .addEdge('risk-assessment', 'portfolio-construction')
    .addEdge('market-research', 'portfolio-construction')
    .addEdge('user-goals', 'rebalance-planner')
    .addEdge('risk-assessment', 'rebalance-planner')
    .addEdge('market-research', 'rebalance-planner')
    // Compliance runs outside the graph (compliance-ctrl is sole authority -- AD-19)
    // Explanation: serial after synthesis
    .addEdge('portfolio-construction', 'explainability')
    .addEdge('rebalance-planner', 'explainability')
    .addEdge('explainability', '__end__');

  return graph.compile();
}
```

**`model-config.ts`** -- Maps each agent name to a Bedrock model ID. All model access goes through Amazon Bedrock using `ChatBedrockConverse`.

```typescript
// libs/agent-core/src/model-config.ts
// CANONICAL SOURCE: 03-ai-agent-system.md section 3.1

export interface ModelConfig {
  modelId: string;
  maxTokens: number;
  temperature: number;
  tools?: string[];
}

const MODEL_MAP: Record<string, ModelConfig> = {
  'user-goals':             { modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0',  maxTokens: 2048, temperature: 0.0 },
  'risk-assessment':        { modelId: 'anthropic.claude-opus-4-6-20250501-v1:0',   maxTokens: 4096, temperature: 0.1 },
  'market-research':        { modelId: 'anthropic.claude-sonnet-4-6-20250514-v1:0', maxTokens: 4096, temperature: 0.2 },
  'portfolio-construction': { modelId: 'anthropic.claude-opus-4-6-20250501-v1:0',   maxTokens: 4096, temperature: 0.1 },
  'rebalance-planner':      { modelId: 'anthropic.claude-sonnet-4-6-20250514-v1:0', maxTokens: 4096, temperature: 0.1 },
  'explainability':         { modelId: 'anthropic.claude-sonnet-4-6-20250514-v1:0', maxTokens: 8192, temperature: 0.3 },
};

export function getModelConfig(agentType: string): ModelConfig {
  const config = MODEL_MAP[agentType];
  if (!config) throw new Error(`Unknown agent type: ${agentType}`);
  return config;
}
```

**`agent-invoker.ts`** -- Wraps compiled graph invocation with structured logging (via Powertools), latency metrics, and automatic fallback to an alternative graph on transient failures.

```typescript
// libs/agent-core/src/agent-invoker.ts
import { CompiledStateGraph } from '@langchain/langgraph';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

const logger = new Logger({ serviceName: 'agent-core' });
const metrics = new Metrics({ namespace: 'Nestfolio/AgentCore' });

export interface InvocationResult<T> {
  output: T;
  latencyMs: number;
  fallbackUsed: boolean;
}

export async function invokeGraph<T>(
  graph: CompiledStateGraph<any, any>,
  input: Record<string, unknown>,
  fallbackGraph?: CompiledStateGraph<any, any>,
): Promise<InvocationResult<T>> {
  const start = Date.now();
  let fallbackUsed = false;

  try {
    const output = await graph.invoke(input);
    const latencyMs = Date.now() - start;
    metrics.addMetric('GraphLatency', MetricUnit.Milliseconds, latencyMs);
    logger.info('Graph invocation succeeded', { latencyMs });
    return { output: output as T, latencyMs, fallbackUsed };
  } catch (error) {
    logger.warn('Primary graph failed, attempting fallback', { error });
    if (!fallbackGraph) throw error;

    fallbackUsed = true;
    const output = await fallbackGraph.invoke(input);
    const latencyMs = Date.now() - start;
    metrics.addMetric('GraphFallbackLatency', MetricUnit.Milliseconds, latencyMs);
    return { output: output as T, latencyMs, fallbackUsed };
  }
}
```

**`output-schemas/`** -- Zod schemas that validate each agent's structured output at runtime, ensuring downstream consumers receive well-typed data.

```typescript
// libs/agent-core/src/output-schemas/goal-interpretation.schema.ts
import { z } from 'zod';

export const GoalInterpretationSchema = z.object({
  goalId: z.string(),
  interpretedObjective: z.string(),
  timeHorizonMonths: z.number().int().positive(),
  targetReturn: z.number().min(0).max(1),
  riskBudget: z.number().min(0).max(1),
  constraints: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export type GoalInterpretation = z.infer<typeof GoalInterpretationSchema>;
```

---

## 3. AWS Infrastructure Foundation

### 3.1 EventBridge Buses -- 3 Domain Hubs

Each domain gets its own EventBridge bus, deployed as a separate CDK stack. The hub stacks are lightweight -- they own the bus, the archive, and the cross-domain forwarding rules.

```typescript
// services/investor/investor-hub/src/service.stack.ts
import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { EventBus, Archive, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';

export interface HubStackProps extends StackProps {
  advisoryBusArn: string;
  executionBusArn: string;
}

export class InvestorHubStack extends Stack {
  readonly bus: EventBus;

  constructor(scope: Construct, id: string, props: HubStackProps) {
    super(scope, id, props);

    // Domain bus
    this.bus = new EventBus(this, 'InvestorBus', {
      eventBusName: 'investor-hub',
    });

    // Event archive for replay
    new Archive(this, 'Archive', {
      sourceEventBus: this.bus,
      archiveName: 'investor-archive',
      retention: Duration.days(365),
      eventPattern: { source: [{ prefix: '' }] as any },
    });

    // Cross-domain forwarding: Investor --> Advisory
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', props.advisoryBusArn);
    new Rule(this, 'ToAdvisory', {
      eventBus: this.bus,
      eventPattern: {
        detailType: [
          'GOAL_UPDATED', 'RISK_PROFILE_UPDATED', 'OPERATING_MODE_CHANGED',
          'MANDATE_GRANTED', 'MANDATE_UPDATED', 'MANDATE_REVOKED',
        ],
      },
      targets: [new EventBusTarget(advisoryBus)],
    });

    // Cross-domain forwarding: Investor --> Execution
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', props.executionBusArn);
    new Rule(this, 'ToExecution', {
      eventBus: this.bus,
      eventPattern: {
        detailType: ['WITHDRAWAL_REQUESTED', 'ACCOUNT_CLOSURE_REQUESTED'],
      },
      targets: [new EventBusTarget(executionBus)],
    });
  }
}
```

### 3.2 Cross-Domain Forwarding Routes (6 Routes)

| # | From | To | Events | Hub Stack |
|---|---|---|---|---|
| 1 | Investor | Advisory | `GOAL_UPDATED`, `RISK_PROFILE_UPDATED`, `OPERATING_MODE_CHANGED`, `MANDATE_GRANTED`, `MANDATE_UPDATED`, `MANDATE_REVOKED` | investor-hub |
| 2 | Investor | Execution | `WITHDRAWAL_REQUESTED`, `ACCOUNT_CLOSURE_REQUESTED` | investor-hub |
| 3 | Advisory | Investor | `DECISION_PACKET_CREATED`, `USER_CONFIRMATION_REQUESTED`, `EXPLANATION_GENERATED`, `DECISION_APPROVED`, `DECISION_BLOCKED`, `ESCALATION_TRIGGERED`, `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET`, `INCIDENT_DETECTED`, `INCIDENT_RESOLVED` | advisory-hub |
| 4 | Advisory | Execution | `DECISION_APPROVED`, `USER_CONFIRMED`, `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET` | advisory-hub |
| 5 | Execution | Investor | `ORDER_FILLED`, `ORDER_PARTIALLY_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `ORDER_STAGED`, `DEPOSIT_DETECTED`, `WITHDRAWAL_COMPLETED`, `WITHDRAWAL_REJECTED`, `CORPORATE_ACTION_APPLIED`, `RECONCILIATION_COMPLETED`, `RECONCILIATION_FAILED` | execution-hub |
| 6 | Execution | Advisory | `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`, `PORTFOLIO_DRIFT_DETECTED`, `BROKER_SESSION_LOST`, `STREAM_DISCONNECTED`, `RECONCILIATION_FAILED` | execution-hub |

**Deployment order**: The 3 hub stacks have circular cross-references. Resolved via **SSM parameters** in 2 passes:
1. **Pass 1**: Deploy all 3 hubs without forwarding rules (bus + archive only). Each hub writes its bus ARN to SSM parameter (`/nestfolio/{stage}/bus/{domain}-hub-arn`).
2. **Pass 2**: Deploy again with forwarding rules. Each hub reads the other bus ARNs from SSM parameters using `StringParameter.valueFromLookup()`.

This avoids CDK cross-stack coupling and works across separate `cdk deploy` invocations.

### 3.3 DynamoDB Table-Per-Service with Single-Table Patterns

Each service owns its own DynamoDB table (e.g., `{prefix}-investor-bff-table`, `{prefix}-portfolio-bff-table`). This is **table-per-service**, not a global single table for the entire system. Within each table, **single-table design patterns** are used: composite PK/SK keys, heterogeneous entity types colocated by access pattern, and standard GSIs for cross-entity queries. No service reads from another service's table — cross-service communication is exclusively via EventBridge events (AD-20: event-carried state transfer).

All services follow the same key structure:

```
Primary Key Design:
  PK: {EntityType}#{tenantId}#{entityId}
  SK: {EntityType}                           -- Main entity record
    | EditEvent#{timestamp}#{uuid}           -- Mutation history
    | {RelationType}#{relatedId}             -- Related entities

GSIs (standard on every table):
  tenantId-index:  PK=tenantId, SK=__typename   -- All entities for a tenant
  typename-timestamp-index: PK=__typename, SK=timestamp  -- Time-based queries

Special records:
  PK: Idempotency#{eventType}#{eventId}  SK: Processed  -- Idempotency guard
```

**Per-service entity examples**:

| Service | Entities | PK Pattern | SK Patterns |
|---|---|---|---|
| investor-bff | InvestorProfile, Goal, RiskProfile, Mandate, Notification | `InvestorProfile#{tid}#{uid}` | `InvestorProfile`, `EditEvent#...`, `Goal#{gid}`, `Notification#{nid}` |
| investor-ctrl | Notification, NotificationPolicy | `Notification#{tid}#{nid}` | `Notification`, `DeliveryAttempt#{ts}` |
| advisory-ctrl | AgentInvocation, DecisionPacket, Workflow | `DecisionPacket#{tid}#{dpid}` | `DecisionPacket`, `AgentInvocation#{step}`, `EditEvent#...` |
| compliance-ctrl | ComplianceCheck, GuardrailPolicy, AuditArtifact | `ComplianceCheck#{tid}#{ccid}` | `ComplianceCheck`, `AuditArtifact#{aaid}` |
| operations-ctrl | Incident, ModelVersion, ShadowRun | `Incident#{tid}#{iid}` | `Incident`, `ContainmentAction#{caid}` |
| execution-ctrl | Order | `Order#{tid}#{oid}` | `Order`, `EditEvent#...` |
| execution-adpt | BrokerSession, Deposit, Withdrawal | `BrokerSession#{tid}#{bsid}` | `BrokerSession`, `StreamConnection#{scid}` |
| portfolio-bff | Portfolio, Position | `Portfolio#{tid}#{pid}` | `Portfolio`, `Position#{instrument}`, `EditEvent#...` |
| portfolio-ctrl | Reconciliation, DriftRecord | `Reconciliation#{tid}#{rid}` | `Reconciliation`, `DriftRecord#{instrument}` |

### 3.4 SQS Queues with DLQ Patterns

Every Ingress construct creates an SQS queue + DLQ pair. Standard configuration:

| Parameter | Value | Rationale |
|---|---|---|
| Visibility timeout | 180 seconds | 6x Lambda timeout (30s) as AWS recommends |
| DLQ retention | 14 days | Sufficient investigation window |
| Max receive count | 10 | Retries before DLQ |
| Batch size | 10 | Balance throughput vs. latency |
| Batching window | 1000ms | Accumulate records for efficiency |

DLQ monitoring: CloudWatch alarm on `ApproximateNumberOfMessagesVisible > 0` triggers SNS notification.

### 3.5 Secrets Manager -- IBKR Credentials (Phase 2)

```typescript
// Phase 2: execution-adpt provisions per-tenant secrets
const ibkrSecret = new Secret(this, 'IbkrCredentials', {
  secretName: `nestfolio/${stageName}/ibkr/${tenantId}`,
  description: 'IBKR delegated access tokens for tenant',
});
```

- Secrets are partitioned by `tenant_id` in the secret name
- Only `execution-adpt` Lambda role has `secretsmanager:GetSecretValue` permission
- Token refresh is handled by `execution-adpt` internally
- Phase 1 uses mock credentials (no real IBKR connection)

**AI Model Access** (all phases):

All LLM access is via Amazon Bedrock using IAM-based authentication -- no API key secrets are required for AI providers. The agent factory uses `ChatBedrockConverse` from `@langchain/aws`, and Lambda roles in the advisory domain are granted `bedrock:InvokeModel` permissions for the required model IDs.

### 3.6 S3 Buckets

| Bucket | Owner | Purpose | Phase |
|---|---|---|---|
| Static assets | `investor-web` | Landing page, marketing assets | 1 |
| Microfrontend bundles | `investor-web` | Angular microfrontend builds served via CloudFront | 1 |
| Model artifacts | `operations-ctrl` | ML model versions, evaluation datasets | 2 |
| Operations reports | `operations-ctrl` | Shadow run results, evaluation reports | 2 |

### 3.7 Cost Controls: Billing Alarm + Budget Threshold

Bedrock model costs (especially Opus for deep reasoning) and sandbox environment proliferation can add up quickly for a solo developer. Cost controls are deployed in Phase 1 alongside the first infrastructure.

```typescript
// libs/cdk-constructs/src/cost-controls.ts
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { Alarm, ComparisonOperator, Metric } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';

export interface CostControlsProps {
  alertEmail: string;
  monthlyBudgetUsd: number;  // e.g. 200
}

export class CostControls extends Construct {
  constructor(scope: Construct, id: string, props: CostControlsProps) {
    super(scope, id);

    const alertTopic = new Topic(this, 'CostAlertTopic');
    alertTopic.addSubscription(new EmailSubscription(props.alertEmail));

    // AWS Budget with 80% and 100% thresholds
    new CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'nestfolio-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: props.monthlyBudgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
            notificationType: 'ACTUAL',
          },
          subscribers: [{ subscriptionType: 'SNS', address: alertTopic.topicArn }],
        },
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
            notificationType: 'ACTUAL',
          },
          subscribers: [{ subscriptionType: 'SNS', address: alertTopic.topicArn }],
        },
      ],
    });

    // CloudWatch billing alarm (catches sudden cost spikes)
    new Alarm(this, 'BillingAlarm', {
      alarmName: 'nestfolio-billing-spike',
      metric: new Metric({
        namespace: 'AWS/Billing',
        metricName: 'EstimatedCharges',
        dimensionsMap: { Currency: 'USD' },
        statistic: 'Maximum',
        period: Duration.hours(6),
      }),
      threshold: props.monthlyBudgetUsd * 0.5,  // Alert at 50% of monthly in a single 6h window
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    }).addAlarmAction(new SnsAction(alertTopic));
  }
}
```

**Deployed in Phase 1** as part of the first CDK stack (investor-hub or a dedicated `infra-base` stack):

```typescript
new CostControls(this, 'CostControls', {
  alertEmail: 'dev@nestfolio.app',
  monthlyBudgetUsd: 200,
});
```

---

## 4. CI/CD Pipeline

> **Pattern source**: Adapted from the [event-lab CI/CD pipeline](../references/event-lab-cicd.md). Key differences: single AWS region (`eu-south-1`), Nestfolio service naming, 4 deployment phases (hubs → web → application → frontend).

### 4.1 Two-Pipeline Architecture

The CI/CD pipeline is split into two separate workflows following the event-lab pattern:

1. **PR Workflow** (`.github/workflows/pr-deploy.yml`) -- Runs on PR open/update, deploys to isolated sandbox
2. **Main Workflow** (`.github/workflows/main-deploy.yml`) -- Runs after PR merge, deploys to staging (and later production)

```
PR Workflow:                          Main Workflow:
PR opened/updated                     PR merged into main
    |                                     |
    v                                     v
detect-affected (Nx)                  detect-affected (Nx)
    |                                     |
    v                                     v
build-and-test                        build-and-test
    |                                     |
    v                                     v
sandbox-deploy                        staging-deploy
(prefix: sandbox-pr-{N})             (prefix: staging)
    |                                     |
    v                                     v
[Ready to merge]                      [Manual approval gate]
                                          |
PR closed → pr-cleanup                    v
(destroy sandbox-pr-{N})             production-deploy (future)
```

### 4.2 OIDC Authentication (No Long-Lived Credentials)

All AWS access uses GitHub OIDC federation -- **no long-lived AWS credentials** (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) stored in GitHub secrets.

**Setup**: Deploy the CloudFormation OIDC trust stack:

```yaml
# .aws/github-oidc-setup.yml (CloudFormation template)
Parameters:
  GitHubOrg:
    Type: String
  GitHubRepo:
    Type: String
    Default: nestfolio

Resources:
  GitHubOIDCProvider:
    Type: AWS::IAM::OIDCProvider
    Properties:
      Url: https://token.actions.githubusercontent.com
      ClientIdList: [sts.amazonaws.com]
      ThumbprintList: [6938fd4d98bab03faadb97b34396831e3780aea1]

  GitHubActionRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: github-actions-nestfolio
      AssumeRolePolicyDocument:
        Statement:
          - Effect: Allow
            Principal:
              Federated: !Ref GitHubOIDCProvider
            Action: sts:AssumeRoleWithWebIdentity
            Condition:
              StringLike:
                token.actions.githubusercontent.com:sub: !Sub "repo:${GitHubOrg}/${GitHubRepo}:*"
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/AdministratorAccess
```

**GitHub repository setup**:
- Secret: `AWS_ROLE_ARN` (output from the CloudFormation stack)
- Environments: `sandbox`, `staging`, `production` (with approval gate on production)

**Workflow usage** (all jobs that need AWS access):

```yaml
permissions:
  id-token: write
  contents: read
steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
      aws-region: eu-south-1
```

### 4.3 Pipeline Configuration Per Service

Each service declares its deployment metadata in a `pipeline.json` file, validated by a JSON schema on every CI run.

```json
{
  "$schema": "../../../.pipeline-schema.json",
  "service": "investor-bff",
  "subsystem": "investor",
  "deploymentPhase": 3,
  "production": {
    "regions": ["eu-south-1"],
    "parallelDeploy": true
  },
  "dependencies": ["investor-hub", "investor-web"]
}
```

**Pipeline schema** (`.pipeline-schema.json`):

```json
{
  "type": "object",
  "required": ["service", "subsystem", "deploymentPhase", "production"],
  "properties": {
    "service": { "type": "string" },
    "subsystem": { "enum": ["investor", "advisory", "execution"] },
    "deploymentPhase": { "type": "integer", "minimum": 1, "maximum": 4 },
    "production": {
      "type": "object",
      "required": ["regions"],
      "properties": {
        "regions": { "type": "array", "items": { "type": "string", "pattern": "^[a-z]{2}-[a-z]+-[0-9]+$" } },
        "parallelDeploy": { "type": "boolean" }
      }
    },
    "dependencies": { "type": "array", "items": { "type": "string" } }
  },
  "additionalProperties": false
}
```

### 4.4 Deployment Phase Ordering

Services deploy in 4 phases to respect dependency ordering. The `deploy-all.sh` script enforces this order.

| Phase | Services | Exports |
|---|---|---|
| 1 | `investor-hub`, `advisory-hub`, `execution-hub` | EventBridge bus ARNs via SSM |
| 2 | `investor-web` | Cognito UserPoolId via SSM, CloudFront distribution |
| 3 | `investor-bff`, `investor-ctrl`, `advisory-ctrl`, `compliance-ctrl`, `operations-ctrl`, `advisory-bff`, `execution-ctrl`, `execution-adpt`, `portfolio-bff`, `portfolio-ctrl` | AppSync endpoints via SSM |
| 4 | `investor-app` (Angular shell) | Static assets to S3, MFE bundles |

```bash
# Deploy all services in phase order
./deploy-all.sh dev

# Deploy a single service
pnpm nx deploy investor-bff -- -c prefix=dev
```

### 4.5 Prefix-Based Naming

The `NamingService` CDK construct (adapted from event-lab) generates consistent, prefixed resource names across all services:

```typescript
const naming = createNamingService(this, {
  subsystem: 'investor',
  service: 'investor-bff',
  prefix: 'dev',  // from CDK context: -c prefix=dev
});

naming.eventBusName();       // "dev-investor-event-bus"
naming.tableName();          // "dev-investor-bff-table"
naming.ssmParameterPath('event-hub/busArn');
  // "/nestfolio/dev-investor/event-hub/busArn"
```

**Prefix conventions**:

| Environment | Prefix | Lifecycle |
|---|---|---|
| PR sandbox | `sandbox-pr-{N}` | Auto-created on PR open, auto-destroyed on PR close |
| Development | `dev` | Persistent, deployed on merge to main |
| Staging | `staging` | Persistent, deployed after dev validation |

### 4.6 PR Workflow

```yaml
# .github/workflows/pr-deploy.yml
name: PR Deploy Pipeline
on:
  pull_request:
    branches: [main]

concurrency:
  group: pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true

env:
  PREFIX_SANDBOX: sandbox-pr-${{ github.event.pull_request.number }}

jobs:
  detect-affected:
    runs-on: ubuntu-latest
    outputs:
      affected: ${{ steps.affected.outputs.services }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - id: affected
        run: |
          AFFECTED=$(pnpm nx show projects --affected --base=origin/main --type=app | tr '\n' ',')
          echo "services=$AFFECTED" >> $GITHUB_OUTPUT

  build-and-test:
    needs: detect-affected
    if: needs.detect-affected.outputs.affected != ''
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: bash .github/scripts/validate-pipeline-configs.sh
      - run: pnpm nx affected -t lint --base=origin/main --parallel=3
      - run: pnpm nx affected -t test --base=origin/main --parallel=3

  sandbox-deploy:
    needs: build-and-test
    runs-on: ubuntu-latest
    environment: sandbox
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: eu-south-1
      - run: bash deploy-all.sh "$PREFIX_SANDBOX"
```

### 4.7 Main Workflow

```yaml
# .github/workflows/main-deploy.yml
name: Main Branch Deploy Pipeline
on:
  push:
    branches: [main]

concurrency:
  group: main-deploy
  cancel-in-progress: false

jobs:
  detect-affected:
    # Same as PR workflow but with --base=HEAD~1

  build-and-test:
    # Same as PR workflow

  staging-deploy:
    needs: build-and-test
    runs-on: ubuntu-latest
    environment: staging
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: eu-south-1
      - run: bash deploy-all.sh staging

  integration-test:
    needs: staging-deploy
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: eu-south-1
      - run: pnpm nx affected -t test:integration --base=HEAD~1 --parallel=3
```

### 4.8 PR Cleanup

```yaml
# .github/workflows/pr-cleanup.yml
name: PR Cleanup
on:
  pull_request:
    types: [closed]
  workflow_dispatch:
    inputs:
      pr-number:
        description: 'PR number to clean up'
        required: true

jobs:
  cleanup:
    runs-on: ubuntu-latest
    environment: sandbox
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: eu-south-1
      - run: echo "yes" | bash destroy-all.sh "sandbox-pr-${{ github.event.pull_request.number || github.event.inputs.pr-number }}"
```

### 4.9 CDK Stage Classes

Each service has a `service.stage.ts` that wraps the stack for pipeline deployment, accepting a `prefix` prop:

```typescript
// services/investor/investor-bff/src/service.stage.ts
export class InvestorBffStage extends Stage {
  constructor(scope: Construct, id: string, props?: StageProps & { prefix?: string }) {
    super(scope, id, props);
    if (props?.prefix) {
      this.node.setContext('prefix', props.prefix);
    }
    new InvestorBffStack(this, 'InvestorBffStack');
  }
}
```

### 4.10 Environment Strategy

| Environment | Purpose | Prefix | Deployment Trigger | Phase |
|---|---|---|---|---|
| Sandbox | Isolated PR testing | `sandbox-pr-{N}` | PR open/update | 1 |
| Dev | Persistent development | `dev` | Merge to main | 1 |
| Staging | Pre-production validation | `staging` | After dev success | 1 |
| Production | Real capital (future) | `prod` | Manual approval gate | Post-prototype |

---

## 5. Development Environment

### 5.1 Direct AWS Development

Development runs against a dedicated AWS dev account -- no local AWS emulation. This removes fidelity gaps and ensures CDK stacks are validated against real services from day one.

#### AWS Dev Account Setup

```bash
# 1. Configure AWS SSO profile for the dev account
aws configure sso --profile nestfolio-dev
#   SSO start URL: <your-org-sso-url>
#   SSO Region: eu-south-1
#   Account ID: <dev-account-id>
#   Role: AdministratorAccess (or scoped dev role)

# 2. Bootstrap CDK in the dev account (one-time)
aws sso login --profile nestfolio-dev
export AWS_PROFILE=nestfolio-dev
npx cdk bootstrap aws://<dev-account-id>/eu-south-1
```

#### Development Workflow

Deploy any service to the dev stage using Nx:

```bash
# Deploy a single service
nx run investor-bff:deploy --stage=dev

# Deploy all affected services after a change
pnpm nx affected -t deploy --stage=dev

# Run integration tests against the deployed dev stack
pnpm nx affected -t test:integration --stage=dev
```

All services deploy with the `dev-` prefix (e.g., `dev-investor-bff`) so they are clearly separated from staging/production resources.

### 5.2 Jest Configuration

```typescript
// jest.preset.ts (workspace root)
import type { Config } from 'jest';

const preset: Config = {
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/main.ts',
    '!src/**/*.stack.ts',
    '!src/**/*.stage.ts',
    '!src/**/constructs/**',
  ],
  coverageThreshold: {
    global: { branches: 70, functions: 80, lines: 80, statements: 80 },
  },
};

export default preset;
```

Per-service Jest config:

```typescript
// services/investor/investor-bff/jest.config.ts
import preset from '../../../jest.preset';

export default {
  ...preset,
  displayName: 'investor-bff',
  testEnvironment: 'node',
};
```

### 5.3 ESLint + Prettier

```jsonc
// .eslintrc.json (workspace root)
{
  "root": true,
  "ignorePatterns": ["**/*"],
  "plugins": ["@nx"],
  "overrides": [
    {
      "files": ["*.ts"],
      "extends": [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "prettier"
      ],
      "rules": {
        "@typescript-eslint/no-explicit-any": "warn",
        "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
        "no-console": "error"
      }
    }
  ]
}
```

```jsonc
// .prettierrc
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true
}
```

### 5.4 IDE Setup

Recommended VS Code extensions (`.vscode/extensions.json`):

```jsonc
{
  "recommendations": [
    "nrwl.angular-console",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "amazonwebservices.aws-toolkit-vscode",
    "ms-azuretools.vscode-docker"
  ]
}
```

Recommended workspace settings (`.vscode/settings.json`):

```jsonc
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "typescript.preferences.importModuleSpecifier": "non-relative",
  "typescript.tsdk": "node_modules/typescript/lib",
  "eslint.workingDirectories": [{ "mode": "auto" }]
}
```

---

## 6. Implementation Order

The foundation must be built before any service work begins. Here is the recommended build order:

| Step | Work Item | Depends On | Phase |
|---|---|---|---|
| F1 | Nx workspace initialization, pnpm config, tsconfig | -- | 1 |
| F2 | `libs/platform-core` + `libs/domain-core` -- Reusable patterns, event type definitions, shared types | F1 | 1 |
| F3 | `libs/lambda-utils` -- Bus, Pipe, UoW, errors, idempotency, base repos | F1 | 1 |
| F4 | `libs/cdk-constructs` -- State, Ingress, Egress, Facade, AgentRuntime constructs | F1 | 1 |
| F5 | 3 Hub stacks (investor-hub, advisory-hub, execution-hub) with buses + archives | F4 | 1 |
| F6 | Cross-domain forwarding rules (6 routes) | F5 | 1 |
| F7 | Jest + ESLint + Prettier configuration | F1 | 1 |
| F8 | `libs/agent-core` -- Agent factory, graph orchestrator, prompts, Zod schemas | F2 | 1 |
| F9 | GitHub Actions CI pipeline | F7 | 1 |
| F10 | CDK deployment targets in Nx (`deploy` target per service) | F4, F9 | 1 |
| F11 | Secrets Manager setup for IBKR credentials | F5 | 2 |
| F12 | S3 buckets for static assets + microfrontend hosting | F4 | 1 |
| F13 | `libs/ui-components`, `libs/appsync-client`, `libs/auth`, `libs/i18n`, `libs/shared-state` -- Frontend shared libraries | F1 | 1 |

### Critical Path

```
F1 --> F2 --> F3 --> Ready for first service
        |
        +--> F4 --> F5 --> F6 --> Infrastructure ready
        |
        +--> F8 --> Ready for advisory agents
        |
        +--> F13 --> Ready for frontend apps
```

The critical path is **F1 -> F2 -> F3** because services need `platform-core`, `domain-core`, and `lambda-utils` before they can implement handlers. CDK constructs (F4) and hub stacks (F5-F6) can be built in parallel with `lambda-utils`. The `agent-core` library (F8) depends on `domain-core` (F2) and can be built in parallel with F3-F6. Frontend shared libraries (F13) can be built in parallel once F1 is complete.

### Key Risks

| Risk | Mitigation |
|---|---|
| CDK circular references between hubs | Deploy in 2 passes: buses first, then forwarding rules. Use SSM parameters for ARN sharing |
| Highland.js learning curve | The event-processing library is being developed separately; integrate once stable |
| AWS dev account costs | Teardown stacks when not developing; use DESTROY removal policies for dev |
| Nx v20+ breaking changes | Pin exact Nx version in package.json; test upgrades in isolation |
| Single-table DynamoDB complexity | Start with well-defined PK/SK patterns; use `domain-core` types to enforce key structure at compile time |
