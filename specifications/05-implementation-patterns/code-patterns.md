# Code Patterns

Concrete implementation patterns with code examples for Lambda handlers, dependency injection, stream processing, CQRS, multi-tenancy, error handling, and observability.

> [Back to Index](../../README.md) | [Section Overview](./README.md)

---

## Lambda Handler Pattern

Every Lambda entry point follows a consistent structure: a class implementing `LambdaInterface`, decorated with Powertools context injection, wrapping a Highland.js stream pipeline.

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

Key points:
- The handler class is instantiated once per cold start; the exported `handler` is a bound method reference.
- SQS records are mapped to `UnitOfWork` objects before entering the stream pipeline.
- Duration logging wraps the entire invocation for operational visibility.

---

## Dependency Injection Container

Awilix provides constructor-based DI in CLASSIC mode with strict resolution.

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

Lifetime guidance:

| Lifetime | Use When | Examples |
|----------|----------|----------|
| `asValue` | Immutable configuration | Environment variables, region, table names |
| `singleton` | Stateless or shared infrastructure | EventBridge bus, pipe processors, pipeline orchestrator |
| `scoped` | May accumulate per-invocation state | Domain services, repositories |

---

## Highland.js Stream Pipeline

The pipeline implements single-pass event routing using a `Map<string, Pipe>` for efficient dispatch.

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

Each event type gets its own pipe class responsible for a single transformation.

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
    const timestamp = new Date().toISOString();

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

---

## Event Structure

For the full event-driven architecture, see [Event-Driven Architecture](../03-event-driven-architecture.md).

### Event Type Definitions

Event types use `SCREAMING_SNAKE_CASE` with a `const` assertion for compile-time safety.

```typescript
// models/events.ts
export const EventTypes = {
  PORTFOLIO_CREATED: 'PORTFOLIO_CREATED',
  PORTFOLIO_UPDATED: 'PORTFOLIO_UPDATED',
  PORTFOLIO_PUBLISHED: 'PORTFOLIO_PUBLISHED',
  PORTFOLIO_ACTIVATED: 'PORTFOLIO_ACTIVATED',
} as const;

export type EventType = typeof EventTypes[keyof typeof EventTypes];
```

### Bus Event Envelope

```typescript
export type BusEvent<TSubject = {}, TContext = {}> = {
  id: string;           // crypto.randomUUID()
  type: string;         // Event type constant
  timestamp: string;    // ISO timestamp
  subject: TSubject;    // Event-specific payload
  context: TContext;    // Tenant/user context
};

export type TenantContext = {
  tenantId: string;
  tenantDomain?: string;
  userId: string;
  correlationId?: string;
};
```

### EventBridge Publishing

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

---

## CQRS Implementation with DynamoDB

### DynamoDB Table Design

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

### State Construct

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
      projectionType: ProjectionType.KEYS_ONLY,
    });
  }
}
```

### EditEvent Pattern

State mutations are stored as RFC 6902 JSON Patch operations, providing a full audit trail of every change.

```typescript
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

### Transactional Command Processing

The BFF writes both the state update and the edit event atomically using DynamoDB transactions.

```typescript
class PortfolioService {
  async addEditEvent(params: EditEventParams): Promise<void> {
    const { tenantId, userId, portfolioId, patches } = params;
    const timestamp = new Date().toISOString();
    const eventId = crypto.randomUUID();

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

### DynamoDB Streams to EventBridge (Egress)

The egress construct bridges DynamoDB change data capture to EventBridge.

```typescript
// event-publisher/handler.ts
export const handler = async (event: DynamoDBStreamEvent) => {
  const bus = new EventBridgeBus(...);
  const timestamp = new Date().toISOString();

  const publishPromises = event.Records
    .filter(record => record.eventName === 'INSERT' || record.eventName === 'MODIFY')
    .map(async (record) => {
      const newImage = unmarshall(record.dynamodb.NewImage);

      // Only publish for main entities, not EditEvents
      if (newImage.__typename === 'Portfolio') {
        return bus.publish({
          id: crypto.randomUUID(),
          type: record.eventName === 'INSERT'
            ? EventTypes.PORTFOLIO_CREATED
            : EventTypes.PORTFOLIO_UPDATED,
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

---

## CDK Construct Patterns

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

    // 4. Facade - API layer (JS pipeline resolvers)
    const facade = new Facade(this, 'Facade', {
      schemaPath: join(__dirname, 'schema.graphql'),
      userPool,
      table: state.table,
      jsResolvers: [
        {
          typeName: 'Query',
          fieldName: 'getPortfolio',
          pipeline: [checkAuthPath, getPortfolioPath, createPortfolioPath],
        },
        // ... one entry per GraphQL field
      ],
      // Lambda resolvers only for fields that cannot use JS (optional)
      lambdaResolvers: [
        { typeName: 'Query', fieldName: 'getComplexField', handler: resolverFn },
      ],
    });
  }
}
```

### Ingress Construct

```typescript
// constructs/ingress.ts
export class Ingress extends Construct {
  readonly queue: Queue;

  constructor(scope: Construct, id: string, props: IngressProps) {
    super(scope, id);

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

    props.handler.addEventSource(new SqsEventSource(sqsQueue, {
      batchSize: 10,
      maxBatchingWindowInMilliseconds: 1000,
      reportBatchItemFailures: true,
    }));

    this.queue = sqsQueue;
  }
}
```

### Egress Construct

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

    publisherFunction.addToRolePolicy(new PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [
        `arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${props.busName}`
      ],
    }));

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

---

## Multi-Tenancy Implementation

Tenant isolation is enforced at every layer.

| Layer | Isolation Mechanism |
|-------|-------------------|
| **Authentication** | Cognito `tenantId` as immutable custom attribute |
| **DynamoDB** | `tenantId` prefix in all partition keys |
| **S3** | Bucket prefixes by `tenantId` |
| **EventBridge** | `tenantId` in event metadata for routing |
| **AppSync** | Lambda authorizers enforce tenant context |
| **Queries** | Always filter by `tenantId` prefix |
| **Subscriptions** | Filtered by tenant context |

### Partition Key Structure

```
DynamoDB Item Structure:
PK: {EntityType}#{tenantId}#{entityId}
SK: {EntityType} | EditEvent#{timestamp}#{uuid}
```

Every query and write operation includes the `tenantId` segment in the partition key, making cross-tenant data access structurally impossible at the storage level.

---

## Error Handling and Resilience

### Error Classification

```typescript
// errors.ts
export class NotRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotRetryableError';
  }
}

export const isRetryable = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const err = error as { $retryable?: { throttling?: boolean }, name?: string };
  return err.$retryable?.throttling === true ||
         err.name === 'ProvisionedThroughputExceededException' ||
         err.name === 'ServiceUnavailable';
};
```

### Highland.js Error Handler with Circuit Breaker

```typescript
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
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 5000)
        )
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
const IDEMPOTENCY_TTL_SECONDS = 86400; // 24 hours

class PortfolioService {
  async processEvent(event: BusEvent): Promise<void> {
    const idempotencyKey = `${event.type}#${event.id}`;
    const ttl = Math.floor(Date.now() / 1000) + IDEMPOTENCY_TTL_SECONDS;

    try {
      await this.tableRepository.putWithCondition({
        item: {
          pk: `Idempotency#${idempotencyKey}`,
          sk: 'Processed',
          processedAt: new Date().toISOString(),
          ttl,
        },
        conditionExpression: 'attribute_not_exists(pk)',
      });

      await this.processBusinessLogic(event);

    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        logger.info('Event already processed', { idempotencyKey });
        return;
      }
      throw error;
    }
  }
}
```

### Event Replay and Recovery

```typescript
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

---

## Observability

### AWS Lambda Powertools Integration

```typescript
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnits } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';

const logger = new Logger({ serviceName: 'portfolio-bff' });
const metrics = new Metrics({ namespace: 'Portfolio', serviceName: 'portfolio-bff' });
const tracer = new Tracer({ serviceName: 'portfolio-bff' });

class Handler {
  @logger.injectLambdaContext()
  async handler(event: any, context: Context) {
    const recordCount = event.Records?.length || 0;

    if (recordCount > 0) {
      metrics.addMetric('EventsProcessed', MetricUnits.Count, recordCount);
    }

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
  }
}
```

### CloudWatch Alarms

```typescript
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

---

## Implementation Guardrails

### MUST

- Use Highland.js for stream processing in Lambda handlers
- Implement Awilix DI container for dependency management
- Follow the 4-construct pattern (State, Ingress, Egress, Facade)
- Publish all state changes as domain events
- Include `tenantId` in every event context
- Use SQS for EventBridge-to-Lambda decoupling
- Implement idempotency in all event handlers
- Use DynamoDB Streams for CDC, not polling
- Store EditEvents with JSON Patch format
- Use AWS Lambda Powertools for observability
- Handle errors with classification (retryable vs non-retryable)

### MUST NOT

- Call other services directly (no HTTP/SDK between services)
- Share databases between services
- Bypass EventBridge for inter-service communication
- Expose raw command/event stores to frontends
- Allow cross-tenant data access
- Use Lambda environment variables for secrets (use Secrets Manager)
- Implement synchronous request-response between services
- Mutate state directly -- use the EditEvents pattern
