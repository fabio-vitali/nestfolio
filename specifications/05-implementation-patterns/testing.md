# Testing

Unit testing patterns with Jest and Awilix-based services, integration testing with LocalStack for AWS service emulation, and conventions for test organization.

> [Back to Index](../../README.md) | [Section Overview](./README.md)

---

## Unit Testing

### Approach

Unit tests validate individual pipes, services, and repositories in isolation. All external dependencies are replaced with Jest mocks injected via Awilix constructor parameters.

### Service Tests

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

### Pipe Tests

Pipe tests feed a Highland.js stream through the pipe and assert on the collected output.

```typescript
// portfolio-created.pipe.test.ts
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
```

### What to Assert

| Layer | Assert On |
|-------|-----------|
| **Pipes** | Correct event filtering, service method calls, published follow-up events |
| **Services** | Correct DynamoDB key construction, transaction structure, JSON Patch content |
| **Repositories** | Correct marshalling/unmarshalling, query parameters, GSI usage |
| **Pipeline** | Routing of event types to correct pipes, error handler invocation |

---

## Integration Testing with LocalStack

### Setup

LocalStack emulates AWS services locally, enabling end-to-end event flow testing without deploying to AWS.

```typescript
const testStack = new TestStack(app, 'TestStack', {
  env: {
    account: '000000000000',
    region: 'us-east-1',
  },
});

const dynamoClient = new DynamoDBClient({
  endpoint: 'http://localhost:4566',
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
});
```

### Test Structure

Integration tests exercise the full event path: publish to EventBridge, consume from SQS, process in the Lambda handler, verify DynamoDB state, and confirm outbound events.

```typescript
describe('end-to-end event flow', () => {
  let dynamoClient: DynamoDBClient;
  let eventBridgeClient: EventBridgeClient;

  beforeEach(async () => {
    dynamoClient = new DynamoDBClient({ endpoint: 'http://localhost:4566' });
    eventBridgeClient = new EventBridgeClient({ endpoint: 'http://localhost:4566' });
  });

  afterEach(async () => {
    await dynamoClient.send(new DeleteItemCommand({
      TableName: 'test-table',
      Key: { pk: { S: 'test-key' }, sk: { S: 'test-sort' } }
    }));
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

### What Integration Tests Cover

| Scenario | Verification |
|----------|-------------|
| Event consumption | EventBridge rule matches, SQS delivery, Lambda invocation |
| State mutations | DynamoDB writes with correct keys and attributes |
| Event publishing | Outbound events reach EventBridge with correct detail type |
| Idempotency | Duplicate event processing produces no side effects |
| Error paths | DLQ delivery on repeated failures, error event publishing |

---

## Test Conventions

| Convention | Rule |
|------------|------|
| File naming | `{module}.test.ts` colocated in `test/` directory |
| Test runner | Jest with TypeScript (ts-jest) |
| Mock creation | Use `createMock<T>()` helper for typed mocks |
| Test data | Use factory functions (e.g., `createTestEvent`) for consistent fixtures |
| Cleanup | Always destroy AWS SDK clients and clean up test data in `afterEach` |
| Isolation | Each test creates its own service instance with fresh mocks |
| Assertions | Prefer `expect.objectContaining` for partial matching on DynamoDB items |

---

## New Service Testing Checklist

When adding a new service, create tests for:

1. Each pipe in `pipes/` -- event filtering, service calls, follow-up events
2. The domain service -- key construction, transaction shape, patch content
3. The pipeline -- event routing and error handling
4. Integration flow -- end-to-end from EventBridge to DynamoDB state (LocalStack)
