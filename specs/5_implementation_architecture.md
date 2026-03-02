# Implementation Architecture

## System Overview

### Core Principles
- **Fully event-driven** architecture with zero synchronous inter-service communication
- **CQRS + Event Sourcing** for state management and frontend synchronization
- **Multi-tenant** by design with tenantId partition key enforcement
- **Nx monorepo** with shared CDK constructs and domain contracts
- **AWS serverless** foundation (Lambda, DynamoDB, S3, EventBridge, AppSync)

### Tech Stack Foundation
- **Nx v19** - Monorepo orchestration with workspace layout
- **AWS CDK v2** - Infrastructure as Code with TypeScript
- **Projen** - Configuration generation (auto-generates package.json, tsconfig.json, etc.)
- **Node.js 20 + TypeScript 5** - Runtime and language
- **pnpm** - Package management with workspace support
- **Highland.js** - Functional stream processing for event pipelines
- **Awilix** - Dependency injection container (CLASSIC mode, strict: true)
- **AWS Lambda Powertools** - Logging, metrics, tracing
- **Mutative** - Immutable state management with RFC 6902 JSON Patch

### Service Taxonomy & Naming Conventions

| Suffix | Role | Example | Purpose |
|--------|------|---------|---------|
| `-web` | Web Frontend | `portfolio-web` | Frontend infrastructure, CloudFront distribution |
| `-event-hub` | Event Router | `portfolio-event-hub` | EventBridge bus for cross-domain routing |
| `-bff` | Backend-for-Frontend | `portfolio-viewer-bff` | GraphQL/REST API, CQRS command ingestion |
| `-ctrl` | Controller | `portfolio-publisher-ctrl` | Async orchestration, Step Functions workflows |
| `-adpt` | Adapter | `analytics-adpt` | External system integration, webhook handling |

**Service = 4 CDK Constructs Pattern:**
1. **State** - Data layer (DynamoDB tables, S3 buckets)
2. **Ingress** - Event consumption (EventBridge → SQS → Lambda)
3. **Egress** - Event publishing (DynamoDB Streams → Lambda → EventBridge)
4. **Facade** - API surface (AppSync GraphQL, REST API, CloudFront)

## Nx Monorepo Structure & File Organization

```
/
├── services/
│   └── {domain}/                     # Domain grouping (e.g., portfolio, auth)
│       └── {service-name}/            # Service with suffix (-bff, -ctrl, -adpt)
│           ├── src/
│           │   ├── main.ts            # CDK app entry point
│           │   ├── service.stage.ts   # CDK Stage with tags & context
│           │   ├── service.stack.ts   # Main stack composing 4 constructs
│           │   ├── pipeline.stack.ts  # CI/CD pipeline (optional)
│           │   ├── constructs/        # Service-specific CDK constructs
│           │   │   ├── state.ts       # DynamoDB tables, S3 buckets
│           │   │   ├── ingress.ts     # EventBridge → SQS → Lambda
│           │   │   ├── egress.ts      # DynamoDB Streams → EventBridge
│           │   │   └── facade.ts      # AppSync/REST API
│           │   ├── handlers/          # Lambda implementations
│           │   │   ├── event-listener/
│           │   │   │   ├── handler.ts     # Lambda entry point
│           │   │   │   ├── pipeline.ts    # Highland.js stream orchestrator
│           │   │   │   ├── container.ts   # Awilix DI container
│           │   │   │   ├── service.ts     # Domain logic
│           │   │   │   └── pipes/         # Per-event processors
│           │   │   │       ├── portfolio-created.pipe.ts
│           │   │   │       └── portfolio-updated.pipe.ts
│           │   │   ├── event-publisher/
│           │   │   │   └── handler.ts     # DynamoDB Streams → EventBridge
│           │   │   └── graphql-resolver/
│           │   │       └── handler.ts     # AppSync resolver
│           │   ├── models/
│           │   │   ├── events.ts      # Event type constants (SCREAMING_SNAKE)
│           │   │   └── domain.ts       # Domain types & interfaces
│           │   ├── repositories/       # Data access layer
│           │   │   ├── portfolio-table.repository.ts
│           │   │   └── portfolio-gql.repository.ts
│           │   └── graphql/            # BFF only
│           │       ├── schema.graphql
│           │       └── resolvers.ts
│           ├── test/                  # Unit & integration tests
│           ├── .projenrc.ts           # Projen configuration
│           └── project.json            # Nx project configuration
│
└── libs/
    ├── cdk-constructs/                # Reusable AWS CDK patterns
    │   ├── src/
    │   │   ├── default-lambda-props.ts
    │   │   ├── datadog-instrumentation.ts
    │   │   ├── replicable-table.ts
    │   │   └── replicable-bucket.ts
    │   └── project.json
    ├── lambda-utils/                   # Shared Lambda utilities
    │   ├── src/
    │   │   ├── bus.ts                 # EventBridge abstraction
    │   │   ├── pipe.ts                # Highland.js pipe interface
    │   │   ├── unit-of-work.ts        # Event context wrapper
    │   │   ├── errors.ts              # Error handling patterns
    │   │   ├── repositories/          # Base repository classes
    │   │   │   ├── table.repository.ts
    │   │   │   ├── gql.repository.ts
    │   │   │   └── bucket.repository.ts
    │   │   └── core.ts                # Core types & utilities
    │   └── project.json
    └── domain-core/                    # Domain models & events
        ├── src/
        │   ├── portfolio/
        │   │   ├── events.ts           # Event type definitions
        │   │   └── models.ts           # Domain entities
        │   └── shared/
        │       └── types.ts            # Shared types
        └── project.json
```

## Implementation Patterns

### Lambda Handler Pattern
```typescript
// handler.ts - Standard Lambda entry point
import { LambdaInterface } from '@aws-lambda-powertools/commons/types';
import { logger } from '@aws-lambda-powertools/logger';

class Handler implements LambdaInterface {
  @logger.injectLambdaContext()
  async handler(event: SQSEvent, context: Context) {
    const start = Date.now();
    logger.info('start', { records: event.Records.length });

    try {
      const source = _(event.Records).map(toUnitOfWork);
      const result = await pipeline.feed(source).collect().toPromise(Promise);
      logger.info('success', { durationMs: Date.now() - start });
      return result;
    } catch (err) {
      logger.error('fail', { error: err });
      throw err;
    }
  }
}

const toUnitOfWork = (record: SQSRecord): UnitOfWork => ({
  event: JSON.parse(record.body).detail,
  payload: {},
  record,
});

// Create single instance and bind context
const handlerInstance = new Handler();
export const handler = handlerInstance.handler.bind(handlerInstance);
```

### Dependency Injection Container
```typescript
// container.ts - Awilix DI setup
import { createContainer, asClass, asValue, InjectionMode } from 'awilix';

export const container = createContainer({
  injectionMode: InjectionMode.CLASSIC,
  strict: true,
}).register({
  // Configuration (immutable values)
  region: asValue(process.env.AWS_REGION),
  serviceName: asValue(process.env.SERVICE_NAME),
  tableName: asValue(process.env.TABLE_NAME),
  busName: asValue(process.env.BUS_NAME),

  // Stateless services - can be singletons
  bus: asClass(EventBridgeBus).singleton(),

  // Services that might accumulate state - use scoped
  service: asClass(PortfolioService).scoped(),
  tableRepository: asClass(PortfolioTableRepository).scoped(),

  // Pipes - stateless processors can be singletons
  portfolioCreatedPipe: asClass(PortfolioCreatedPipe).singleton(),
  portfolioUpdatedPipe: asClass(PortfolioUpdatedPipe).singleton(),

  // Main pipeline - singleton as it's just orchestration
  pipeline: asClass(Pipeline).singleton(),
});
```

### Highland.js Stream Pipeline
```typescript
// pipeline.ts - Event stream orchestration with single-pass routing
export class Pipeline implements Pipe<UnitOfWork> {
  private readonly pipes: Map<string, Pipe>;

  constructor(
    private readonly bus: Bus,
    portfolioCreatedPipe: Pipe,
    portfolioUpdatedPipe: Pipe,
  ) {
    // Map event types to their processors for efficient routing
    this.pipes = new Map([
      [EventTypes.PORTFOLIO_CREATED, portfolioCreatedPipe],
      [EventTypes.PORTFOLIO_UPDATED, portfolioUpdatedPipe],
    ]);
  }

  feed(source: Highland.Stream<UnitOfWork>) {
    // Single-pass routing without forking
    return source
      .map(uow => {
        const pipe = this.pipes.get(uow.event.type);
        return pipe ? _([uow]).through(pipe.feed.bind(pipe)) : _([]);
      })
      .parallel(10) // Process different event types in parallel
      .errors(handleErrors(this.bus, 'PORTFOLIO_BFF_FAILED'))
      .flatten();
  }
}
```

### Event Processor Pipe
```typescript
// pipes/portfolio-created.pipe.ts
const MAX_CONCURRENT_PROCESSING = 5; // Named constant for concurrency

export class PortfolioCreatedPipe implements Pipe<UnitOfWork> {
  constructor(private readonly service: PortfolioService) {}

  feed(source: Highland.Stream<UnitOfWork>) {
    return source
      .filter(({ event }) => event.type === EventTypes.PORTFOLIO_CREATED)
      .map(this.processPortfolioCreated.bind(this))
      .parallel(MAX_CONCURRENT_PROCESSING);
  }

  private processPortfolioCreated(uow: UnitOfWork) {
    const { subject, context } = uow.event as BusEvent<PortfolioCreated, TenantContext>;
    const timestamp = new Date().toISOString(); // Create timestamp once

    return _(
      (async () => {
        // Apply JSON Patch mutations
        const patches: Patches = [
          { op: 'add', path: '/status', value: 'active' },
          { op: 'add', path: '/createdAt', value: timestamp },
        ];

        await this.service.addEditEvent({
          tenantId: context.tenantId,
          userId: context.userId,
          portfolioId: subject.portfolioId,
          patches: JSON.stringify(patches)
        });

        // Publish follow-up events
        await this.bus.publish({
          id: crypto.randomUUID(),
          type: EventTypes.PORTFOLIO_ACTIVATED,
          timestamp,
          subject: { portfolioId: subject.portfolioId },
          context,
        });

        return uow;
      })()
    );
  }
}
```

## Service Pattern Responsibilities

### web
- **Cognito User Pool** with Google/Facebook federation
- **Lambda triggers** on PostAuthentication, PostConfirmation
  - Publish `user.registered`, `user.authenticated` events
  - Include tenantId custom attribute in event metadata
- **CloudFront distribution**
  - Origin: AppSync GraphQL endpoints from BFFs
  - Behaviors: path-based routing to different BFFs
- **Route53** hosted zone for domain management

### event-hub
- **EventBridge Custom EventBus** (`platform-events`)
  - Event pattern rules route to service SQS queues
  - Dead letter queue for failed deliveries
- **EventBridge Archive**
  - Archive name: `platform-event-store`
  - Retention: 90 days minimum
  - Replay capability for disaster recovery
- **EventBridge Schema Registry** for event contract validation

### bff
- **AppSync GraphQL API**
  - Mutations: command ingestion → DynamoDB command store
  - Queries: read from materialized state (DynamoDB/S3)
  - Subscriptions: real-time state changes to frontend
- **Command Store** (DynamoDB single-table)
  - Partition key: `tenantId#entityId`
  - Sort key: `timestamp#commandId`
  - TTL: 30 days on raw commands
- **Reducer Lambda** (DynamoDB Streams trigger)
  - Query historical commands by entity
  - Apply state reduction logic
  - Write materialized state
- **Event Publisher Lambda** (DynamoDB Streams CDC)
  - Transform state changes to domain events
  - Publish to EventBridge with tenantId metadata
- **S3 Bucket** for microfrontend hosting

### controller
- **SQS Queue** subscribed to relevant domain events
- **Event Listener Lambda**
  - Consume events from SQS
  - Update internal state (DynamoDB)
  - Trigger Step Functions execution
- **Step Functions State Machine**
  - Orchestrate multi-step workflows
  - Wait states for temporal logic
  - Parallel states for concurrent operations
  - Error handling with retries/compensation
- **Event Publisher Lambda**
  - Emit orchestration completion events
  - Include reduced state snapshots in events

### adapter
- **SQS Queue** for inbound domain events
- **Event Consumer Lambda**
  - Transform domain events to external API calls
  - Handle retries with exponential backoff
  - Store API responses in DynamoDB
- **API Gateway REST API**
  - Webhook endpoints for external callbacks
  - Request validation and transformation
  - Rate limiting per API key
- **Event Publisher Lambda**
  - Convert external responses to domain events
  - Maintain event correlation IDs

## Event Structure & Flow Patterns

### Event Type Definition
```typescript
// models/events.ts - Event type constants using const assertion for type safety
export const EventTypes = {
  PORTFOLIO_CREATED: 'PORTFOLIO_CREATED',
  PORTFOLIO_UPDATED: 'PORTFOLIO_UPDATED',
  PORTFOLIO_PUBLISHED: 'PORTFOLIO_PUBLISHED',
  PORTFOLIO_ACTIVATED: 'PORTFOLIO_ACTIVATED',
} as const;

export type EventType = typeof EventTypes[keyof typeof EventTypes];

// Event payload types
export type BusEvent<TSubject = {}, TContext = {}> = {
  id: string;           // crypto.randomUUID()
  type: string;         // Event type constant
  timestamp: string;    // ISO timestamp
  subject: TSubject;    // Event-specific payload
  context: TContext;    // Tenant/user context
};

// Context always includes tenant isolation
export type TenantContext = {
  tenantId: string;
  tenantDomain?: string;
  userId: string;
  correlationId?: string;
};

// Example event
const event: BusEvent<PortfolioCreated, TenantContext> = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  type: 'PORTFOLIO_CREATED',
  timestamp: '2024-01-15T10:30:00Z',
  subject: {
    portfolioId: 'portfolio-123',
    title: 'My Portfolio',
    visibility: 'public',
  },
  context: {
    tenantId: 'tenant-456',
    userId: 'user-789',
    correlationId: 'req-abc',
  },
};
```

### EventBridge Integration Pattern
```typescript
// bus.ts - Event publishing
export class EventBridgeBus implements Bus {
  constructor(
    private readonly client: EventBridgeClient,
    private readonly busName: string,
    private readonly serviceName: string,
  ) {}

  async publish(event: BusEvent): Promise<void> {
    const command = new PutEventsCommand({
      Entries: [{
        Source: `${this.busName}@${this.serviceName}`,
        DetailType: event.type,
        Detail: JSON.stringify(event),
        EventBusName: this.busName,
      }],
    });

    const response = await this.client.send(command);
    if (response.FailedEntryCount > 0) {
      throw new NotRetryableError('Event publishing failed');
    }
  }
}
```

### CQRS Flow with EditEvents
```typescript
// BFF Command Processing
interface EditEventParams {
  tenantId: string;
  userId: string;
  portfolioId: string;
  patches: string; // JSON Patch operations
}

class PortfolioService {
  async addEditEvent(params: EditEventParams): Promise<void> {
    const { tenantId, userId, portfolioId, patches } = params;
    const timestamp = new Date().toISOString();
    const eventId = crypto.randomUUID();

    // Transactional write: Update state + Add edit event
    const command = new TransactWriteItemsCommand({
      TransactItems: [
        {
          Update: {
            TableName: this.tableName,
            Key: {
              pk: { S: `Portfolio#${tenantId}#${portfolioId}` },
              sk: { S: 'Portfolio' },
            },
            UpdateExpression: 'SET #updated = :timestamp',
            ExpressionAttributeNames: { '#updated': 'updatedAt' },
            ExpressionAttributeValues: { ':timestamp': { S: timestamp } },
          },
        },
        {
          Put: {
            TableName: this.tableName,
            Item: {
              pk: { S: `Portfolio#${tenantId}#${portfolioId}` },
              sk: { S: `EditEvent#${timestamp}#${eventId}` },
              __typename: { S: 'EditEvent' },
              userId: { S: userId },
              patches: { S: patches },
              timestamp: { S: timestamp },
            },
          },
        },
      ],
    });

    await this.client.send(command);
  }
}
```

### DynamoDB Streams → EventBridge Pattern
```typescript
// event-publisher/handler.ts
export const handler = async (event: DynamoDBStreamEvent) => {
  const bus = new EventBridgeBus(...);
  const timestamp = new Date().toISOString(); // Create once for batch

  // Process records in parallel for better throughput
  const publishPromises = event.Records
    .filter(record => record.eventName === 'INSERT' || record.eventName === 'MODIFY')
    .map(async (record) => {
      const newImage = unmarshall(record.dynamodb.NewImage);

      // Only publish for main entities, not EditEvents
      if (newImage.__typename === 'Portfolio') {
        return bus.publish({
          id: crypto.randomUUID(),
          type: record.eventName === 'INSERT' ? EventTypes.PORTFOLIO_CREATED : EventTypes.PORTFOLIO_UPDATED,
          timestamp,
          subject: {
            portfolioId: newImage.portfolioId,
            ...newImage,
          },
          context: {
            tenantId: newImage.tenantId,
            userId: newImage.userId,
          },
        });
      }
    });

  await Promise.all(publishPromises);
};
```

## CDK Construct Implementation Patterns

### Service Stack Composition
```typescript
// service.stack.ts - Main stack orchestrating 4 constructs
export class PortfolioBffStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // 1. State - Data layer
    const state = new State(this, 'State', {
      tableName: `${stageName}-portfolio-table`,
      bucketName: `${stageName}-portfolio-assets`,
    });

    // 2. Ingress - Event consumption
    const ingress = new Ingress(this, 'Ingress', {
      eventBus: EventBus.fromEventBusArn(this, 'Bus', busArn),
      eventTypes: [PORTFOLIO_REQUESTED, USER_UPDATED],
      handler: eventListenerFunction,
    });

    // 3. Egress - Event publishing
    const egress = new Egress(this, 'Egress', {
      table: state.table,
      streamFilter: { __typename: 'Portfolio' },
      busName: process.env.BUS_NAME!,
    });

    // 4. Facade - API layer
    const facade = new Facade(this, 'Facade', {
      schemaPath: './graphql/schema.graphql',
      resolvers: graphqlResolvers,
      table: state.table,
    });
  }
}
```

### State Construct - DynamoDB Design
```typescript
// constructs/state.ts
export class State extends Construct {
  readonly table: Table;
  readonly bucket: Bucket;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.table = new Table(this, 'Table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // GSI for tenant queries - project only needed attributes
    this.table.addGlobalSecondaryIndex({
      indexName: 'tenantId-index',
      partitionKey: { name: 'tenantId', type: AttributeType.STRING },
      sortKey: { name: '__typename', type: AttributeType.STRING },
      projectionType: ProjectionType.INCLUDE,
      nonKeyAttributes: ['portfolioId', 'title', 'status', 'updatedAt'],
    });

    // GSI for time-based queries - project only needed attributes
    this.table.addGlobalSecondaryIndex({
      indexName: 'typename-timestamp-index',
      partitionKey: { name: '__typename', type: AttributeType.STRING },
      sortKey: { name: 'timestamp', type: AttributeType.STRING },
      projectionType: ProjectionType.KEYS_ONLY, // Just keys for existence checks
    });
  }
}
```

### Ingress Construct - Event Consumption
```typescript
// constructs/ingress.ts
export class Ingress extends Construct {
  readonly queue: Queue;

  constructor(scope: Construct, id: string, props: IngressProps) {
    super(scope, id);

    // EventBridge → SQS pattern
    const { sqsQueue, deadLetterQueue } = new EventbridgeToSqs(this, 'E2Q', {
      eventRuleProps: {
        eventBus: props.eventBus,
        eventPattern: {
          detailType: props.eventTypes,
        },
      },
      queueProps: {
        visibilityTimeout: Duration.seconds(45),
      },
      deadLetterQueueProps: {
        retentionPeriod: Duration.days(14),
      },
      maxReceiveCount: 10,
    });

    // SQS → Lambda
    props.handler.addEventSource(new SqsEventSource(sqsQueue, {
      batchSize: 10,
      maxBatchingWindowInMilliseconds: 1000,
      reportBatchItemFailures: true,
    }));

    this.queue = sqsQueue;
  }
}
```

### Egress Construct - Event Publishing
```typescript
// constructs/egress.ts
export class Egress extends Construct {
  constructor(scope: Construct, id: string, props: EgressProps) {
    super(scope, id);

    const publisherFunction = new NodejsFunction(this, 'Publisher', {
      ...defaultLambdaProps(this),
      entry: './src/handlers/event-publisher/handler.ts',
      environment: {
        BUS_NAME: props.busName,
        SERVICE_NAME: Stack.of(this).stackName,
      },
    });

    // Grant EventBridge permissions - specific to account and region
    publisherFunction.addToRolePolicy(new PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${props.busName}`],
    }));

    // DynamoDB Streams → Lambda with filtering
    publisherFunction.addEventSource(new DynamoEventSource(props.table.tableStreamArn!, {
      startingPosition: StartingPosition.LATEST,
      filters: [
        FilterCriteria.filter({
          eventName: FilterRule.isEqual('INSERT'),
          dynamodb: {
            NewImage: {
              __typename: { S: FilterRule.isEqual(props.streamFilter.__typename) },
            },
          },
        }),
      ],
      bisectBatchOnError: true,
      retryAttempts: 3,
    }));
  }
}
```

## CQRS & Event Sourcing Implementation

### DynamoDB Table Design Pattern
```
Primary Key Design:
- PK: {EntityType}#{tenantId}#{entityId}
- SK: {EntityType} | EditEvent#{timestamp}#{uuid} | {RelationType}#{id}

Examples:
- PK: Portfolio#tenant123#portfolio456
  SK: Portfolio                           # Main entity
  SK: EditEvent#2024-01-15T10:30:00Z#abc  # Edit history
  SK: Project#project789                  # Related entity

GSI Patterns:
- tenantId-index: Query all entities for a tenant
- typename-timestamp-index: Time-based queries per entity type
```

### EditEvent Pattern for State Mutations
```typescript
// Store state changes as RFC 6902 JSON Patch operations
type EditEvent = {
  pk: string;           // Entity partition key
  sk: string;           // EditEvent#{timestamp}#{uuid}
  __typename: 'EditEvent';
  userId: string;       // Who made the change
  patches: string;      // JSON stringified patch operations
  timestamp: string;    // When the change occurred
  ttl?: number;         // Optional TTL for cleanup
};

// Example patches
const patches = [
  { op: 'replace', path: '/title', value: 'New Title' },
  { op: 'add', path: '/tags/0', value: 'featured' },
  { op: 'remove', path: '/draft' },
];
```

### Event Replay & Recovery
```typescript
// Replay events from archive for disaster recovery
const replayCommand = new StartReplayCommand({
  ReplayName: `recovery-${Date.now()}`,
  EventSourceArn: archiveArn,
  EventStartTime: startTime,
  EventEndTime: endTime,
  Destination: {
    Arn: eventBusArn,
  },
});
```

## Multi-Tenancy Strategy

### Tenant Isolation
- **Cognito**: tenantId as immutable custom attribute
- **DynamoDB**: tenantId prefix in all partition keys
- **S3**: bucket prefixes by tenantId
- **EventBridge**: tenantId in event metadata for routing

### Data Partitioning
```
DynamoDB Item Structure:
PK: tenant123#product456
SK: 2024-01-15T10:30:00Z#cmd789
```

### Query Boundaries
- **AppSync**: Lambda authorizers enforce tenant context
- **Queries**: Always filter by tenantId prefix
- **Subscriptions**: Filtered by tenant context

## Error Handling & Resilience Patterns

### Error Classification
```typescript
// errors.ts - Error handling strategy
export class NotRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotRetryableError';
  }
}

// Determine if AWS SDK error is retryable
export const isRetryable = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const err = error as { $retryable?: { throttling?: boolean }, name?: string };
  return err.$retryable?.throttling === true ||
         err.name === 'ProvisionedThroughputExceededException' ||
         err.name === 'ServiceUnavailable';
};

// Highland.js error handler with circuit breaker pattern
const MAX_ERROR_EVENTS_PER_MINUTE = 10;
let errorEventCount = 0;
let errorEventResetTime = Date.now();

export const handleErrors = (bus: Bus, errorEventType: string) => {
  return (err: Error, push: Highland.PushFunction) => {
    logger.error('Pipeline error', {
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack
    });

    // Circuit breaker for error event publishing
    const now = Date.now();
    if (now - errorEventResetTime > 60000) {
      errorEventCount = 0;
      errorEventResetTime = now;
    }

    if (err instanceof NotRetryableError && errorEventCount < MAX_ERROR_EVENTS_PER_MINUTE) {
      errorEventCount++;
      // Fire-and-forget error event publishing with timeout
      Promise.race([
        bus.publish({
          id: crypto.randomUUID(),
          type: errorEventType,
          timestamp: new Date().toISOString(),
          subject: {
            errorName: err.name,
            errorMessage: err.message,
          },
          context: {},
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
      ]).catch(publishErr => {
        logger.warn('Failed to publish error event', { error: publishErr });
      });
    }

    // Don't push error downstream - handle gracefully
    push(null, Highland.nil);
  };
};
```

### Idempotency Pattern
```typescript
// Use idempotency keys with conditional writes to prevent duplicate processing
const IDEMPOTENCY_TTL_SECONDS = 86400; // 24 hours as named constant

class PortfolioService {
  async processEvent(event: BusEvent): Promise<void> {
    const idempotencyKey = `${event.type}#${event.id}`;
    const ttl = Math.floor(Date.now() / 1000) + IDEMPOTENCY_TTL_SECONDS;

    try {
      // Use conditional write to atomically check and mark as processed
      await this.tableRepository.putWithCondition({
        item: {
          pk: `Idempotency#${idempotencyKey}`,
          sk: 'Processed',
          processedAt: new Date().toISOString(),
          ttl,
        },
        conditionExpression: 'attribute_not_exists(pk)', // Only write if not exists
      });

      // Process event here - only runs if conditional write succeeded
      await this.processBusinessLogic(event);

    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        logger.info('Event already processed', { idempotencyKey });
        return; // Idempotent - already processed
      }
      throw error; // Re-throw other errors
    }
  }
}
```

## Observability & Monitoring

### AWS Lambda Powertools Integration
```typescript
// handler.ts - Structured logging & tracing
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnits } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';

const logger = new Logger({ serviceName: 'portfolio-bff' });
const metrics = new Metrics({ namespace: 'Portfolio', serviceName: 'portfolio-bff' });
const tracer = new Tracer({ serviceName: 'portfolio-bff' });

class Handler {
  // Use only essential decorators to reduce overhead
  @logger.injectLambdaContext()
  async handler(event: any, context: Context) {
    const recordCount = event.Records?.length || 0;

    // Add metrics only for significant events
    if (recordCount > 0) {
      metrics.addMetric('EventsProcessed', MetricUnits.Count, recordCount);
    }

    // Structured logging
    logger.info('Processing events', {
      eventCount: recordCount,
      requestId: context.requestId,
    });

    // Only trace when explicitly enabled via environment variable
    if (process.env.ENABLE_TRACING === 'true') {
      const subsegment = tracer.getSegment()?.addNewSubsegment('processEvents');
      try {
        // Process...
        subsegment?.addAnnotation('eventType', event.Records[0]?.eventName);
      } finally {
        subsegment?.close();
      }
    }

    // Process events...
  }
}
```

### CloudWatch Alarms
```typescript
// CDK alarm configuration
new Alarm(this, 'ErrorAlarm', {
  metric: new Metric({
    namespace: 'AWS/Lambda',
    metricName: 'Errors',
    dimensionsMap: {
      FunctionName: lambdaFunction.functionName,
    },
  }),
  threshold: 10,
  evaluationPeriods: 1,
  treatMissingData: TreatMissingData.NOT_BREACHING,
});
```

## Testing Patterns

### Unit Testing with Jest
```typescript
// portfolio.service.test.ts
describe('PortfolioService', () => {
  let service: PortfolioService;
  let mockTableRepository: jest.Mocked<TableRepository>;
  let mockBus: jest.Mocked<Bus>;

  beforeEach(() => {
    mockTableRepository = createMock<TableRepository>();
    mockBus = createMock<Bus>();
    service = new PortfolioService(mockTableRepository, mockBus);
  });

  it('should create portfolio with correct partition key', async () => {
    const tenantId = 'tenant-123';
    const portfolioId = 'portfolio-456';

    await service.createPortfolio(tenantId, portfolioId, {...});

    expect(mockTableRepository.put).toHaveBeenCalledWith(
      expect.objectContaining({
        pk: `Portfolio#${tenantId}#${portfolioId}`,
        sk: 'Portfolio',
      })
    );
  });
});
```

### Integration Testing with LocalStack
```typescript
// Use LocalStack for local AWS service emulation
const testStack = new TestStack(app, 'TestStack', {
  env: {
    account: '000000000000',
    region: 'us-east-1',
  },
});

// Override endpoints for local testing
const dynamoClient = new DynamoDBClient({
  endpoint: 'http://localhost:4566',
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
});
```

## Implementation Guardrails

### MUST
- **MUST** use Highland.js for stream processing in Lambda handlers
- **MUST** implement Awilix DI container for dependency management
- **MUST** follow the 4-construct pattern (State, Ingress, Egress, Facade)
- **MUST** publish all state changes as domain events
- **MUST** include tenantId in every event context
- **MUST** use SQS for EventBridge → Lambda decoupling
- **MUST** implement idempotency in all event handlers
- **MUST** use DynamoDB Streams for CDC, not polling
- **MUST** store EditEvents with JSON Patch format
- **MUST** use AWS Lambda Powertools for observability
- **MUST** handle errors with classification (retryable vs non-retryable)

### MUST NOT
- **MUST NOT** call other services directly (no HTTP/SDK between services)
- **MUST NOT** share databases between services
- **MUST NOT** bypass EventBridge for inter-service communication
- **MUST NOT** expose raw command/event stores to frontends
- **MUST NOT** allow cross-tenant data access
- **MUST NOT** use Lambda environment variables for secrets (use Secrets Manager)
- **MUST NOT** implement synchronous request-response between services
- **MUST NOT** mutate state directly - use EditEvents pattern

## Optional Enhancements

### Performance Optimization (Optional)
- **DynamoDB Accelerator (DAX)** for microsecond read latency
- **CloudFront caching** for GraphQL query results
- **Lambda SnapStart** for Java-based services
- **EventBridge Global Endpoints** for multi-region failover

### Advanced Event Patterns (Optional)
- **Event Enrichment**: Lambda functions to add context to events
- **Event Deduplication**: DynamoDB table tracking processed event IDs
- **Saga Pattern**: Distributed transaction coordination via Step Functions
- **Event Versioning**: Schema evolution with backward compatibility

### Observability (Optional)
- **X-Ray tracing** across all Lambda functions
- **CloudWatch Logs Insights** queries for event correlation
- **EventBridge event metrics** dashboards
- **Custom metrics** for business KPIs via CloudWatch

### Development Experience (Optional)
- **LocalStack** for local EventBridge testing
- **Nx affected** commands for selective deployments
- **CDK Pipelines** for automated multi-environment deployments
- **Contract testing** between event producers/consumers

### Security Hardening (Optional)
- **AWS WAF** on API Gateway and AppSync
- **VPC endpoints** for service isolation
- **KMS encryption** for all data at rest
- **EventBridge content-based filtering** for PII redaction

## Implementation Example: Portfolio Service

### Step 1: Service Structure
```
services/portfolio/portfolio-viewer-bff/
├── src/
│   ├── main.ts                    # CDK app entry
│   ├── service.stack.ts           # Stack with 4 constructs
│   ├── constructs/
│   │   ├── state.ts               # DynamoDB + S3
│   │   ├── ingress.ts             # EventBridge → SQS → Lambda
│   │   ├── egress.ts              # DynamoDB Streams → EventBridge
│   │   └── facade.ts              # AppSync GraphQL
│   ├── handlers/
│   │   └── event-listener/
│   │       ├── handler.ts         # Lambda entry
│   │       ├── pipeline.ts        # Highland orchestration
│   │       ├── container.ts       # Awilix DI
│   │       └── pipes/
│   │           └── portfolio-created.pipe.ts
│   └── models/
│       └── events.ts              # PORTFOLIO_CREATED, etc.
```

### Step 2: Event Flow Implementation

```graphql
# 1. User creates portfolio via GraphQL mutation
mutation CreatePortfolio {
  createPortfolio(input: { title: "My Work" }) {
    portfolioId
    status
  }
}
```

```javascript
// 2. BFF stores command and triggers DynamoDB Stream
const portfolioRecord = {
  pk: "Portfolio#tenant123#portfolio456",
  sk: "Portfolio",
  __typename: "Portfolio",
  tenantId: "tenant123",
  portfolioId: "portfolio456",
  title: "My Work",
  status: "draft"
};

// 3. Egress publishes PORTFOLIO_CREATED event
const portfolioCreatedEvent = {
  id: "evt-789",
  type: "PORTFOLIO_CREATED",
  timestamp: "2024-01-15T10:30:00Z",
  subject: { portfolioId: "portfolio456", title: "My Work" },
  context: { tenantId: "tenant123", userId: "user123" }
};

// 4. Other services react asynchronously
// - Analytics service tracks creation
// - Notification service sends confirmation
// - Search service indexes portfolio
```

### Step 3: Testing Strategy
```typescript
// Unit test the pipe
test('portfolio-created.pipe processes event correctly', async () => {
  const mockService = { addEditEvent: jest.fn() };
  const pipe = new PortfolioCreatedPipe(mockService);

  const event = createTestEvent(PORTFOLIO_CREATED);
  const stream = _([{ event, payload: {}, record: {} }]);

  await pipe.feed(stream).collect().toPromise(Promise);

  expect(mockService.addEditEvent).toHaveBeenCalledWith(
    expect.any(String),  // tenantId
    expect.any(String),  // userId
    expect.any(String),  // portfolioId
    expect.any(String),  // patches
  );
});

// Integration test with LocalStack
describe('end-to-end event flow', () => {
  let dynamoClient: DynamoDBClient;
  let eventBridgeClient: EventBridgeClient;

  beforeEach(async () => {
    // Setup test clients
    dynamoClient = new DynamoDBClient({ endpoint: 'http://localhost:4566' });
    eventBridgeClient = new EventBridgeClient({ endpoint: 'http://localhost:4566' });
  });

  afterEach(async () => {
    // Clean up test data
    await dynamoClient.send(new DeleteItemCommand({
      TableName: 'test-table',
      Key: { pk: { S: 'test-key' }, sk: { S: 'test-sort' } }
    }));
    // Destroy clients
    dynamoClient.destroy();
    eventBridgeClient.destroy();
  });

  test('processes portfolio creation', async () => {
    // 1. Publish event to EventBridge
    // 2. Verify SQS receives message
    // 3. Trigger Lambda handler
    // 4. Verify DynamoDB state update
    // 5. Verify outbound event published
  });
});
```

## Quick Reference Checklist

### Starting a New Service
- [ ] Create service directory under `services/{domain}/{service-name}/`
- [ ] Initialize with Projen: `npx projen new awscdk-app-ts`
- [ ] Implement 4 CDK constructs: State, Ingress, Egress, Facade
- [ ] Set up Lambda handlers with Highland.js pipeline
- [ ] Configure Awilix DI container
- [ ] Define event types in SCREAMING_SNAKE_CASE
- [ ] Implement error handling with retryable classification
- [ ] Add AWS Lambda Powertools for observability
- [ ] Write unit tests for pipes and services
- [ ] Configure multi-region deployment if needed

### Common Pitfalls to Avoid
- ❌ Don't call other services directly - use events
- ❌ Don't share databases between services
- ❌ Don't skip tenant isolation in partition keys
- ❌ Don't implement synchronous request-response patterns
- ❌ Don't mutate state without EditEvents
- ❌ Don't process events without idempotency checks
- ❌ Don't use polling - use DynamoDB Streams
- ❌ Don't hardcode configuration - use environment variables
- ❌ Don't skip error classification (retryable vs non-retryable)
- ❌ Don't create services without the 4-construct pattern