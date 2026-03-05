# 05 -- Testing & Operations Plan

Testing strategy, observability, deployment, prototype-to-production gate criteria, and development workflow for Nestfolio.

> [Back to Master Plan](./00-master-plan.md)
> **Phase scheme**: See [00-master-plan.md](./00-master-plan.md) for phase definitions (Phases 1-5).

---

## 1. Testing Strategy

### 1.1 Testing Pyramid

```
       /  E2E  \           ~5% of tests    (Playwright, full user flows)
      /----------\
     / Integration \       ~25% of tests   (AWS dev account, event flows)
    /----------------\
   /   Unit Tests     \    ~70% of tests   (Jest, Vitest, TestBed)
  /____________________\
```

### 1.2 Unit Testing

#### Backend (Lambda services): Jest + ts-jest

All backend Lambda code uses Jest with Awilix mock injection. The patterns follow the spec in `specifications/05-implementation-patterns/testing.md`.

**Service tests with Awilix mock injection:**

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

  it('should construct correct partition key for portfolio creation', async () => {
    await service.createPortfolio('tenant-123', 'portfolio-456', { ... });

    expect(mockTableRepository.put).toHaveBeenCalledWith(
      expect.objectContaining({
        pk: 'Portfolio#tenant-123#portfolio-456',
        sk: 'Portfolio',
      })
    );
  });

  it('should publish PORTFOLIO_ACTIVATED event after creation', async () => {
    await service.createPortfolio('tenant-123', 'portfolio-456', { ... });

    expect(mockBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PORTFOLIO_ACTIVATED',
        context: expect.objectContaining({ tenantId: 'tenant-123' }),
      })
    );
  });
});
```

**Pipe tests feeding stream pipelines:**

```typescript
// portfolio-created.pipe.test.ts
import _ from 'highland';

describe('PortfolioCreatedPipe', () => {
  let pipe: PortfolioCreatedPipe;
  let mockService: jest.Mocked<PortfolioService>;

  beforeEach(() => {
    mockService = createMock<PortfolioService>();
    pipe = new PortfolioCreatedPipe(mockService);
  });

  it('should process PORTFOLIO_CREATED events', async () => {
    const event = createTestEvent('PORTFOLIO_CREATED', {
      subject: { portfolioId: 'p-123' },
      context: { tenantId: 't-1', userId: 'u-1' },
    });

    const stream = _([{ event, payload: {}, record: {} }]);
    await pipe.feed(stream).collect().toPromise(Promise);

    expect(mockService.addEditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't-1',
        portfolioId: 'p-123',
      })
    );
  });

  it('should ignore non-matching event types', async () => {
    const event = createTestEvent('PORTFOLIO_UPDATED', { ... });
    const stream = _([{ event, payload: {}, record: {} }]);
    const results = await pipe.feed(stream).collect().toPromise(Promise);

    expect(results).toHaveLength(0);
    expect(mockService.addEditEvent).not.toHaveBeenCalled();
  });
});
```

**Pipeline routing tests:**

```typescript
// pipeline.test.ts
describe('Pipeline', () => {
  it('should route PORTFOLIO_CREATED to PortfolioCreatedPipe', async () => {
    const mockCreatedPipe = createMock<Pipe>();
    const mockUpdatedPipe = createMock<Pipe>();
    const pipeline = new Pipeline(mockBus, mockCreatedPipe, mockUpdatedPipe);

    const event = createTestEvent('PORTFOLIO_CREATED');
    const stream = _([{ event, payload: {}, record: {} }]);
    await pipeline.feed(stream).collect().toPromise(Promise);

    expect(mockCreatedPipe.feed).toHaveBeenCalled();
    expect(mockUpdatedPipe.feed).not.toHaveBeenCalled();
  });
});
```

**What to assert per layer:**

| Layer | Assert On |
|---|---|
| **Pipes** | Correct event filtering, service method calls with correct arguments, published follow-up events |
| **Services** | DynamoDB key construction (`{EntityType}#{tenantId}#{entityId}`), transaction structure, JSON Patch content |
| **Repositories** | Marshalling/unmarshalling, query parameters, GSI usage, condition expressions |
| **Pipeline** | Routing of event types to correct pipes, error handler invocation, parallelism |
| **Handler** | SQS record parsing into UnitOfWork, error propagation, batch item failure reporting |

#### Frontend (Angular): Vitest + Angular TestBed

**Recommendation: Vitest** over Karma/Jest for Angular unit tests.

Angular 19+ has experimental Vitest support via `@analogjs/vitest-angular`. Vitest is faster than Karma (no browser startup) and faster than Jest for TypeScript (native ESM). For a solo developer, faster test feedback loops matter.

| Tool | Pros | Cons |
|---|---|---|
| Karma | Official Angular support, real browser | Slow startup, being deprecated by Angular team |
| Jest | Fast, mocking support, widespread | Requires transform config for Angular, slower than Vitest |
| Vitest | Fastest, native ESM, Jest-compatible API | Angular support is newer, less battle-tested |

**Component tests with TestBed:**

```typescript
// dashboard.component.spec.ts
describe('DashboardComponent', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let mockPortfolioService: MockProxy<PortfolioService>;
  let mockAdvisoryService: MockProxy<AdvisoryService>;

  beforeEach(async () => {
    mockPortfolioService = mock<PortfolioService>();
    mockAdvisoryService = mock<AdvisoryService>();

    mockPortfolioService.getPortfolioSummary.mockResolvedValue({
      totalValue: 24350,
      changePercent: 3.2,
      changeDirection: 'positive',
    });

    await TestBed.configureTestingModule({
      imports: [DashboardComponent, NfCardComponent, NfStatusDotComponent],
      providers: [
        { provide: PortfolioService, useValue: mockPortfolioService },
        { provide: AdvisoryService, useValue: mockAdvisoryService },
        { provide: TenantContextService, useValue: mockTenantContext },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should display formatted portfolio value', () => {
    const valueEl = fixture.nativeElement.querySelector('.value-amount');
    expect(valueEl.textContent).toContain('24.350');
  });

  it('should show positive change indicator', () => {
    const changeEl = fixture.nativeElement.querySelector('.value-change');
    expect(changeEl.classList).toContain('text-positive');
  });

  it('should show action required card when confirmation pending', () => {
    mockAdvisoryService.getPendingConfirmation.mockResolvedValue({
      decisionId: 'dec-123',
      summary: 'Strategy adjustment',
    });
    fixture.detectChanges();

    const actionCard = fixture.nativeElement.querySelector('.action-card');
    expect(actionCard).toBeTruthy();
  });
});
```

**Design system component tests:**

```typescript
// button.component.spec.ts
describe('NfButton', () => {
  it('should render primary variant', () => {
    const fixture = TestBed.createComponent(NfButtonComponent);
    fixture.componentRef.setInput('variant', 'primary');
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button');
    expect(button.classList).toContain('btn-primary');
  });

  it('should have minimum 44px touch target', () => {
    const fixture = TestBed.createComponent(NfButtonComponent);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button');
    const rect = button.getBoundingClientRect();
    expect(rect.height).toBeGreaterThanOrEqual(44);
  });
});
```

### 1.3 Integration Testing: AWS Dev Account

Integration tests run against the deployed `dev` account infrastructure. This avoids local emulation complexity and tests against real AWS services, providing higher confidence than any local mock.

#### Workflow

1. Deploy the affected service(s) to the `dev` account (`nx affected --target=deploy --stage=dev`)
2. Publish a test event to the deployed EventBridge bus
3. Verify DynamoDB state mutations in the deployed table
4. Verify downstream events were published to the correct targets

#### Helper Scripts for Test Event Publishing

```typescript
// integration/helpers/dev-account-clients.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { SQSClient } from '@aws-sdk/client-sqs';

const REGION = 'eu-west-1';

// Real AWS SDK clients -- use default credential chain (AWS profile or CI role)
export const createDevClients = () => ({
  dynamoClient: new DynamoDBClient({ region: REGION }),
  eventBridgeClient: new EventBridgeClient({ region: REGION }),
  sqsClient: new SQSClient({ region: REGION }),
});

export const DEV_STACK_PREFIX = 'nestfolio-dev';
export const getTableName = (service: string) => `${DEV_STACK_PREFIX}-${service}-table`;
export const getBusName = (domain: string) => `${DEV_STACK_PREFIX}-${domain}-bus`;
export const getQueueUrl = (service: string) => `${DEV_STACK_PREFIX}-${service}-queue`;
```

#### End-to-End Event Flow Test

```typescript
// integration/portfolio-creation-flow.test.ts
describe('Portfolio creation event flow (dev account)', () => {
  let dynamoClient: DynamoDBClient;
  let eventBridgeClient: EventBridgeClient;
  let sqsClient: SQSClient;

  beforeAll(async () => {
    const clients = createDevClients();
    dynamoClient = clients.dynamoClient;
    eventBridgeClient = clients.eventBridgeClient;
    sqsClient = clients.sqsClient;
  });

  afterAll(async () => {
    dynamoClient.destroy();
    eventBridgeClient.destroy();
    sqsClient.destroy();
  });

  it('should process portfolio creation end-to-end', async () => {
    const testRunId = crypto.randomUUID().slice(0, 8);
    const tenantId = `test-tenant-${testRunId}`;
    const portfolioId = `test-portfolio-${testRunId}`;

    // 1. Publish PORTFOLIO_CREATED event to the deployed EventBridge bus
    await eventBridgeClient.send(new PutEventsCommand({
      Entries: [{
        Source: `${getBusName('execution')}@portfolio-bff`,
        DetailType: 'PORTFOLIO_CREATED',
        Detail: JSON.stringify({
          id: crypto.randomUUID(),
          type: 'PORTFOLIO_CREATED',
          timestamp: new Date().toISOString(),
          subject: { portfolioId },
          context: { tenantId, userId: 'test-user' },
        }),
        EventBusName: getBusName('execution'),
      }],
    }));

    // 2. Wait for async processing (Lambda triggered by SQS)
    await waitForProcessing({ maxWaitMs: 10000, pollIntervalMs: 1000 });

    // 3. Verify DynamoDB state update in the deployed table
    const item = await dynamoClient.send(new GetItemCommand({
      TableName: getTableName('portfolio-bff'),
      Key: {
        pk: { S: `Portfolio#${tenantId}#${portfolioId}` },
        sk: { S: 'Portfolio' },
      },
    }));
    expect(item.Item).toBeDefined();
    expect(item.Item!.status?.S).toBe('active');

    // 4. Verify EditEvent was written
    const editEvents = await queryEditEvents(
      dynamoClient, getTableName('portfolio-bff'), tenantId, portfolioId
    );
    expect(editEvents).toHaveLength(1);
    expect(JSON.parse(editEvents[0].patches.S!)).toContainEqual(
      expect.objectContaining({ op: 'add', path: '/status', value: 'active' })
    );

    // 5. Cleanup test data
    await cleanupTestData(dynamoClient, getTableName('portfolio-bff'), tenantId);
  });
});
```

#### Integration Test Coverage

| Scenario | Verification |
|---|---|
| Event consumption | EventBridge rule matches, SQS delivery, Lambda invocation |
| State mutations | DynamoDB writes with correct keys, attributes, and GSI projections |
| Event publishing (egress) | DynamoDB Stream triggers publisher Lambda, outbound events reach EventBridge |
| Idempotency | Duplicate event processing produces no side effects (idempotency key check) |
| Error paths | DLQ delivery on repeated failures, error event publishing |
| Cross-domain forwarding | Event Hub forwarding rules deliver events to target domain buses |
| Multi-tenant isolation | Events with tenant A context never mutate tenant B state |

### 1.4 E2E Testing: Playwright

**Recommendation: Playwright** over Cypress.

| Factor | Playwright | Cypress |
|---|---|---|
| Multi-browser | Chromium, Firefox, WebKit | Chromium, Firefox (WebKit experimental) |
| Speed | Faster -- headless by default, parallel | Slower -- browser startup overhead |
| Angular support | Official Angular schematic available | Requires separate setup |
| API mocking | Built-in route interception | `cy.intercept()` -- similar capability |
| Mobile emulation | Built-in device profiles | Plugin-based |
| Solo developer ergonomics | Better for CI -- faster, less flaky | Better DX for debugging (time-travel) |

#### E2E Test Structure

```
e2e/
  playwright.config.ts
  fixtures/
    mock-portfolio.json
    mock-notifications.json
    mock-decisions.json
  tests/
    onboarding.spec.ts
    dashboard.spec.ts
    portfolio-detail.spec.ts
    decision-detail.spec.ts
    confirmation.spec.ts
    settings.spec.ts
    deposit-withdrawal.spec.ts
  helpers/
    auth.helper.ts           # Cognito login automation
    api-mock.helper.ts       # AppSync response mocking
    page-objects/
      dashboard.page.ts
      portfolio.page.ts
```

#### Mock API Layer for E2E

E2E tests mock the AppSync API layer using Playwright's route interception:

```typescript
// helpers/api-mock.helper.ts
export async function mockAppSyncResponses(page: Page): Promise<void> {
  // Mock portfolio-bff AppSync
  await page.route('**/api/portfolio/*', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const operationName = body.operationName;

    const mockResponses: Record<string, unknown> = {
      getPortfolioSummary: {
        data: { getPortfolioSummary: mockPortfolioSummary },
      },
      getPositions: {
        data: { getPositions: mockPositions },
      },
    };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockResponses[operationName] ?? {}),
    });
  });
}
```

#### Key E2E User Flows

```typescript
// tests/onboarding.spec.ts
test.describe('Onboarding Flow', () => {
  test('should complete full onboarding in 7 steps', async ({ page }) => {
    await loginAsNewUser(page);

    // Step 1: Welcome
    await expect(page.getByText('Ciao!')).toBeVisible();
    await page.getByRole('button', { name: 'Iniziamo' }).click();

    // Step 2: Goal setting
    await page.getByRole('button', { name: 'Crescere il patrimonio' }).click();
    await page.getByRole('slider').fill('10');  // 10 years
    await page.getByRole('textbox').fill('5000');  // initial amount

    // Step 3: Risk comfort
    await page.getByText('Non fare nulla').click();  // if portfolio drops 10%
    await page.getByText('Un po').click();  // investment experience

    // Step 4: Operating mode
    await page.getByText('Bilanciata').click();  // Balanced mode

    // Step 5: Mandate & terms
    await page.getByRole('switch').click();  // consent toggle
    await page.getByRole('button', { name: 'Accetta' }).click();

    // Step 6: Account activation (wait for setup)
    await expect(page.getByText('Il tuo account e\' pronto!')).toBeVisible({ timeout: 10000 });

    // Step 7: Confirmation & launch
    await page.getByRole('button', { name: 'Vai alla Dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
```

### 1.5 AI Agent Testing

Testing LangGraph.js agents requires specific strategies because LLM outputs are non-deterministic. Unit tests validate agent logic locally (graph definitions, prompt templates, Zod schemas) without AWS. Integration tests invoke the deployed AgentCore Runtime endpoint (the containerized LangGraph agent). Together they cover both individual tool invocations and overall graph traversal logic.

> **Local development note**: Unit tests and agent pipeline tests run locally without AWS. Lambda handlers are testable via a local test harness. Integration tests run against real AWS services in a dev account.

#### Deterministic Test Fixtures (LangGraph StateGraph)

```typescript
// Agent test with known inputs and expected output structure
// Uses LangGraph.js test utilities for graph validation
describe('RebalancePlannerAgent (LangGraph StateGraph)', () => {
  it('should produce a valid rebalance plan for a drifted portfolio', async () => {
    const input: AgentInput = {
      portfolioState: createTestPortfolio({
        positions: [
          { instrument: 'VWCE.DE', weight: 0.65, targetWeight: 0.60 },
          { instrument: 'AGGH.DE', weight: 0.35, targetWeight: 0.40 },
        ],
        driftMagnitude: 0.05,
      }),
      guardrails: defaultBalancedGuardrails,
      marketContext: createStableMarketContext(),
    };

    // Invoke via LangGraph agent node -- Bedrock model invocations via AgentCore Runtime
    const agent = createAgentNode({
      model: createBedrockModel({
        modelId: 'anthropic.claude-sonnet-4-20250514-v1:0',
      }),
      tools: [rebalanceTool, guardrailCheckTool, explanationTool],
      graph: rebalancePlannerGraph,
    });

    const output = await agent.invoke(input);

    // Assert on structure, not exact values
    expect(output.trades).toHaveLength(2);
    expect(output.trades).toContainEqual(
      expect.objectContaining({
        instrument: 'VWCE.DE',
        side: 'SELL',
        weightChange: expect.toBeCloseTo(-0.05, 0.02),
      })
    );
    expect(output.trades).toContainEqual(
      expect.objectContaining({
        instrument: 'AGGH.DE',
        side: 'BUY',
        weightChange: expect.toBeCloseTo(0.05, 0.02),
      })
    );

    // Guardrail compliance
    expect(output.guardrailChecks.maxTradeSize.passed).toBe(true);
    expect(output.guardrailChecks.monthlyTurnover.passed).toBe(true);
  });

  it('should traverse the agent graph nodes in correct order', async () => {
    const traceCollector = createGraphTraceCollector();
    const agent = createAgentNode({
      model: createBedrockModel({
        modelId: 'anthropic.claude-sonnet-4-20250514-v1:0',
      }),
      graph: rebalancePlannerGraph,
      hooks: { onNodeEntry: traceCollector.onNodeEntry },
    });

    await agent.invoke(createTestInput());

    // Verify graph traversal order
    expect(traceCollector.visitedNodes).toEqual([
      'analyze-drift',
      'generate-trades',
      'check-guardrails',
      'build-explanation',
    ]);
  });

  it('should handle Bedrock model invocation failure gracefully', async () => {
    const agent = createAgentNode({
      model: createBedrockModel({
        modelId: 'anthropic.claude-sonnet-4-20250514-v1:0',
        simulateFailure: true,
      }),
      graph: rebalancePlannerGraph,
    });

    const output = await agent.invoke(createTestInput());

    expect(output).toBeDefined();
    expect(output.fallbackUsed).toBe(true);
  });
});
```

#### Snapshot Testing for Prompt Templates

```typescript
// Prompt template snapshot tests ensure prompts don't change unexpectedly
describe('Agent prompt templates', () => {
  it('rebalance planner system prompt should match snapshot', () => {
    const prompt = buildRebalancePlannerPrompt({
      operatingMode: 'balanced',
      guardrails: defaultBalancedGuardrails,
    });

    expect(prompt).toMatchSnapshot();
  });

  it('explanation generator prompt should include all reasoning factors', () => {
    const prompt = buildExplanationPrompt({
      decisionPacket: createTestDecisionPacket(),
      locale: 'it-IT',
    });

    expect(prompt).toContain('drift magnitude');
    expect(prompt).toContain('risk band');
    expect(prompt).toContain('goal horizon');
  });
});
```

#### Golden Output Regression Tests

```typescript
// Golden output tests compare agent output against approved baselines
describe('Golden output regression', () => {
  const goldenDatasets = loadGoldenDatasets('./test/golden/');

  goldenDatasets.forEach(({ name, input, expectedOutput }) => {
    it(`should produce acceptable output for: ${name}`, async () => {
      const agent = createAgentNode({
        model: createBedrockModel({
          modelId: 'anthropic.claude-sonnet-4-20250514-v1:0',
        }),
        graph: rebalancePlannerGraph,
      });

      const output = await agent.invoke(input);

      // Structural similarity (not exact match)
      expect(output.tradeCount).toBe(expectedOutput.tradeCount);
      expect(output.totalTurnover).toBeCloseTo(expectedOutput.totalTurnover, 0.05);
      expect(output.authorityLevel).toBe(expectedOutput.authorityLevel);

      // Explanation must mention key factors
      for (const factor of expectedOutput.requiredFactors) {
        expect(output.explanation).toContain(factor);
      }
    });
  });
});
```

#### Agent Testing Strategy Summary

| Test Type | Purpose | Deterministic? |
|---|---|---|
| Prompt template snapshots | Detect unintended prompt changes | Yes |
| Input/output structure validation | Ensure agent output conforms to schema | Yes |
| Guardrail compliance checks | Verify agent respects all guardrails | Yes |
| Agent graph traversal order | Verify LangGraph StateGraph node execution sequence | Yes |
| Bedrock model fallback | Verify graceful handling of Bedrock invocation failures | Yes |
| Golden output regression | Detect significant behavioral drift | Semi (tolerance bands) |
| Shadow comparison | Compare production vs candidate model outputs | No (observational) |

### 1.7 Multi-Tenancy Adversarial Tests

> **Pulled from**: 07-production-next-steps.md (AI-2). Implemented in Phase 5 as part of prototype testing.

Cross-tenant access tests run in CI on every commit. These verify tenant isolation at every layer of the stack.

```typescript
// integration/tenant-isolation.test.ts
describe('Multi-tenancy isolation (dev account)', () => {
  const tenantA = { tenantId: 'test-tenant-a', userId: 'user-a' };
  const tenantB = { tenantId: 'test-tenant-b', userId: 'user-b' };

  it('DynamoDB: tenant A cannot query tenant B data', async () => {
    // Seed data for tenant B
    await seedPortfolio(tenantB.tenantId, 'portfolio-b-1');

    // Query with tenant A context -- should return empty
    const results = await queryPortfolios(tenantA.tenantId);
    expect(results).toHaveLength(0);
  });

  it('AppSync: tenant A JWT cannot access tenant B resources', async () => {
    const tokenA = await getTestToken(tenantA);
    const response = await graphqlQuery(tokenA, {
      query: GET_PORTFOLIO,
      variables: { tenantId: tenantB.tenantId, portfolioId: 'portfolio-b-1' },
    });
    expect(response.errors?.[0]?.errorType).toBe('Unauthorized');
  });

  it('EventBridge: events carry tenant context and consumers filter by tenant', async () => {
    await publishEvent('PORTFOLIO_CREATED', {
      context: { tenantId: tenantA.tenantId },
      subject: { portfolioId: 'portfolio-a-1' },
    });

    // Verify the event was only processed for tenant A's data
    const tenantAData = await queryTable(tenantA.tenantId, 'Portfolio');
    const tenantBData = await queryTable(tenantB.tenantId, 'Portfolio');
    expect(tenantAData).toHaveLength(1);
    expect(tenantBData).toHaveLength(0);
  });
});
```

**Test coverage targets**:
- DynamoDB: tenant PK isolation, GSI tenant-index filtering
- AppSync: Lambda authorizer tenantId enforcement
- EventBridge: tenant context propagation in all 6 forwarding routes
- Lambda: tenant context extraction and enforcement in all handlers

### 1.8 Consumer-Side Event Schema Validation Tests

> Validates AD-21: events validated at both publish and consumption time.

```typescript
// integration/schema-validation.test.ts
describe('Event schema validation (dev account)', () => {
  it('Egress: rejects events that fail producer schema validation', async () => {
    // Insert a malformed DynamoDB record that triggers Egress publisher
    await insertMalformedRecord('investor-bff');

    // Verify: no event published to EventBridge (Egress blocked it)
    // Verify: error logged in CloudWatch
  });

  it('Ingress: sends schema-invalid events to DLQ', async () => {
    // Publish an event with missing required fields directly to EventBridge
    await publishMalformedEvent('MANDATE_GRANTED', { subject: {} });

    // Verify: DLQ receives the message (consumer validation rejected it)
    // Verify: error event published with type SCHEMA_VALIDATION_FAILED
  });
});
```

---

## 2. Observability

### 2.1 AWS Lambda Powertools Setup

Every Lambda function uses Powertools for structured logging, custom metrics, and distributed tracing.

```typescript
// libs/lambda-utils/src/observability.ts
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';

export const createObservability = (serviceName: string) => ({
  logger: new Logger({
    serviceName,
    logLevel: process.env.LOG_LEVEL ?? 'INFO',
    persistentLogAttributes: {
      environment: process.env.STAGE,
    },
  }),

  metrics: new Metrics({
    namespace: 'Nestfolio',
    serviceName,
    defaultDimensions: {
      environment: process.env.STAGE ?? 'dev',
    },
  }),

  tracer: new Tracer({
    serviceName,
    captureHTTPsRequests: true,
  }),
});
```

CDK integration for all Lambda functions:

```typescript
// libs/cdk-constructs/src/default-lambda-props.ts
export const defaultLambdaProps = (scope: Construct): Partial<NodejsFunctionProps> => ({
  runtime: Runtime.NODEJS_22_X,
  memorySize: 256,
  timeout: Duration.seconds(30),
  tracing: Tracing.ACTIVE,  // X-Ray
  environment: {
    POWERTOOLS_SERVICE_NAME: Stack.of(scope).stackName,
    POWERTOOLS_METRICS_NAMESPACE: 'Nestfolio',
    LOG_LEVEL: 'INFO',
  },
  bundling: {
    minify: true,
    sourceMap: true,
    externalModules: ['@aws-sdk/*'],
  },
});
```

### 2.2 CloudWatch Dashboards

Three dashboards per the spec:

#### Operations Dashboard

| Widget | Metric Source | Purpose |
|---|---|---|
| Service Health Grid | Lambda Errors, Invocations per function | Quick status of all 14 services |
| Event Throughput | EventBridge `PutEvents` by bus | Event flow rate across 3 domain buses |
| Queue Depth | SQS `ApproximateNumberOfMessagesVisible` | Backpressure detection |
| DLQ Messages | SQS DLQ `ApproximateNumberOfMessagesVisible` | Failed message monitoring |
| API Latency (p50, p95, p99) | AppSync `Latency` by API | Frontend response times |
| Lambda Duration | Lambda `Duration` (p50, p95, p99) | Processing performance |
| Error Rate | Lambda `Errors` / `Invocations` | Service reliability |
| DynamoDB Throttles | DynamoDB `ThrottledRequests` | Capacity issues |

#### Compliance Dashboard

| Widget | Metric Source | Purpose |
|---|---|---|
| Decisions Approved/Blocked | Custom metric from `compliance-ctrl` | Compliance throughput |
| Guardrail Violations | Custom metric from `compliance-ctrl` | Safety signal |
| Escalation Rate | Custom metric -- `ESCALATION_TRIGGERED` count | L1-to-L2 escalation frequency |
| Suitability Check Results | Pass/fail rate from `compliance-ctrl` | Regulatory compliance |
| Audit Artifact Count | DynamoDB item count projection | Audit trail completeness |

#### AI Governance Dashboard

| Widget | Metric Source | Purpose |
|---|---|---|
| Agent Success/Failure Rate | Custom metric from `advisory-ctrl` per agent type | Agent reliability |
| LangGraph Agent Invocations | Custom metric: Bedrock model invocations via AgentCore Runtime, latency, token usage | Agent runtime health |
| Decision Throughput | `DECISION_PACKET_CREATED` events/minute | System capacity |
| Execution Latency | Time from `DECISION_PACKET_CREATED` to `ORDER_FILLED` | End-to-end decision speed |
| Shadow Model Divergence | Custom metric from `operations-ctrl` | Model quality monitoring |
| Guardrail Pressure Index | Proximity of decisions to guardrail boundaries | Early warning signal |
| Reconciliation Confidence | Agreement between intent truth and settlement truth | Data integrity |

### 2.3 Key Metrics

Custom CloudWatch metrics emitted from application code:

```typescript
// In advisory-ctrl handler
metrics.addMetric('DecisionPacketCreated', MetricUnit.Count, 1);
metrics.addMetric('AgentInvocationDuration', MetricUnit.Milliseconds, duration);
metrics.addDimension('AgentType', agentName);
metrics.addDimension('OperatingMode', operatingMode);

// LangGraph agent node metrics (Bedrock model invocations via AgentCore Runtime)
metrics.addMetric('LangGraphNodeInvocation', MetricUnit.Count, 1);
metrics.addMetric('LangGraphAgentTokensUsed', MetricUnit.Count, tokenUsage.total);
metrics.addDimension('ModelId', bedrockModelId);        // e.g. 'anthropic.claude-sonnet-4-20250514-v1:0'
metrics.addDimension('RuntimeEndpoint', agentCoreEndpoint);

// In compliance-ctrl handler
metrics.addMetric('ComplianceCheckDuration', MetricUnit.Milliseconds, duration);
metrics.addMetric('GuardrailViolation', MetricUnit.Count, violations.length);
metrics.addDimension('ViolationType', violationType);

// In execution-adpt handler
metrics.addMetric('OrderSubmitted', MetricUnit.Count, 1);
metrics.addMetric('OrderFillLatency', MetricUnit.Milliseconds, fillLatency);

// In portfolio-ctrl handler
metrics.addMetric('ReconciliationMismatch', MetricUnit.Count, mismatchCount);
metrics.addMetric('ReconciliationConfidence', MetricUnit.None, confidence);
```

### 2.4 Alerting Strategy

| Alert | Condition | Severity | Action |
|---|---|---|---|
| Lambda error rate > 5% | 5-minute window, any service | SEV-3 | Investigate, check DLQ |
| DLQ messages > 0 | Any DLQ receives messages | SEV-3 | Investigate failed events |
| Agent failure rate > 10% | `advisory-ctrl` agent invocations | SEV-2 | Pause decisions, investigate |
| Reconciliation failure | `RECONCILIATION_FAILED` event | SEV-2 | Lock execution, manual review |
| Circuit breaker triggered | `CIRCUIT_BREAKER_TRIGGERED` event | SEV-2 | Verify containment, monitor |
| Broker session lost | `BROKER_SESSION_LOST` event, no recovery in 5 min | SEV-1 | Pause execution, reconnect |
| AppSync 5xx rate > 1% | AppSync error metrics | SEV-3 | Check resolver Lambdas |
| EventBridge delivery failures | `FailedInvocations` > 0 | SEV-3 | Check target health |
| DynamoDB throttles | Any table throttled | SEV-4 | Review capacity, partition strategy |

For the prototype phases (1-5), alerts route to a single SNS topic subscribed by the developer's email/Slack. No PagerDuty or complex escalation chains needed.

### 2.5 X-Ray Tracing

X-Ray tracing is enabled by default on all Lambda functions. For the LangGraph StateGraph (single-Lambda execution), tracing is instrumented within the agent graph nodes:

```typescript
// LangGraph StateGraph tracing within a single Lambda invocation
import { Tracer } from '@aws-lambda-powertools/tracer';

const tracer = new Tracer({ serviceName: 'advisory-ctrl' });

// Each LangGraph StateGraph node creates a subsegment
const agentGraphHooks = {
  onNodeEntry: (nodeName: string) => {
    const subsegment = tracer.getSegment()?.addNewSubsegment(`agent-node:${nodeName}`);
    return { subsegment };
  },
  onNodeExit: (nodeName: string, context: { subsegment: any }) => {
    context.subsegment?.close();
  },
  onModelCall: (provider: string, model: string, tokens: number) => {
    const subsegment = tracer.getSegment()?.addNewSubsegment(`model-call:${provider}`);
    subsegment?.addAnnotation('model', model);
    subsegment?.addAnnotation('provider', provider);
    subsegment?.addMetadata('tokens', tokens);
    subsegment?.close();
  },
};
```

This enables tracing a single decision through all agent graph nodes (analyze-drift, generate-trades, check-guardrails, build-explanation), Bedrock model invocations via AgentCore Runtime, and tool calls within a single Lambda execution -- critical for debugging decision flow issues and identifying model latency bottlenecks.

---

## 3. Deployment Strategy

### 3.1 CDK Deploy Workflow

**Recommendation: Per-service deployment** using Nx affected + CDK.

Each service has its own CDK stack, deployed independently. This aligns with the service decomposition where each service has its own `project.json` and CDK entry point.

```
Deploy pipeline per service:
  1. Nx detects affected services (based on git diff)
  2. For each affected service:
     a. Run unit tests
     b. CDK synth (validate template)
     c. CDK deploy to target environment
```

```bash
# Deploy a single service
npx nx run portfolio-bff:deploy --stage=dev

# Deploy all affected services
npx nx affected --target=deploy --stage=dev
```

CDK configuration per service:

```typescript
// services/execution/portfolio-bff/src/main.ts
const app = new App();

new PortfolioBffStage(app, 'portfolio-bff-dev', {
  env: { account: '123456789012', region: 'eu-west-1' },
  stageName: 'dev',
});
```

### 3.2 Environment Strategy

For the prototype phases (1-3), a single `dev` environment is sufficient. Additional environments are added as the project progresses.

| Environment | Purpose | Deployment | Data | Phase |
|---|---|---|---|---|
| `dev` | Development, testing, and internal simulation | Manual / on-demand + automated on merge to `main` | Ephemeral, seeded with test data and simulated portfolios | 1-3 |
| `production` | Real capital | Automated with approval gate | Real portfolios, real broker | 5+ |

Additional environments (`staging`, `sandbox`) will be introduced at Phase 4 transition when IBKR integration begins and multi-environment promotion is needed.

### 3.3 Lambda Deployment: Versioned Aliases

No blue/green or canary deployment for the prototype phases (1-5) -- overkill for a solo developer with no live users.

Instead: **versioned Lambda aliases** with instant rollback.

```typescript
// CDK Lambda alias for rollback capability
const alias = new lambda.Alias(this, 'Live', {
  aliasName: 'live',
  version: lambdaFunction.currentVersion,
});

// SQS event source and API routes point to the alias, not $LATEST
```

Rollback is a one-command operation: `aws lambda update-alias --function-name X --name live --function-version N-1`.

Post-prototype, introduce CodeDeploy linear/canary deployment for the alias.

### 3.4 DynamoDB Schema Evolution

DynamoDB is schemaless, so "migrations" are application-level concerns:

| Change Type | Strategy |
|---|---|
| Add new attribute | No migration needed -- old items simply lack the attribute, code handles `undefined` |
| Rename attribute | Write new attribute alongside old, backfill old items, update code to read new, remove old attribute reads |
| Add new GSI | CDK stack update creates GSI. Backfill data by scanning and updating items to populate GSI attributes |
| Change key structure | Create new table, migrate data with a script, swap references. Never change PK/SK structure on an existing table |
| TTL changes | Update CDK stack, no data migration needed |

For the prototype phases (1-5), schema evolution is low risk -- small data volumes, no production users. Wipe and reseed is acceptable.

### 3.5 Rollback Procedures

| Component | Rollback Method | Time to Recover |
|---|---|---|
| Lambda function | Update alias to previous version | < 1 minute |
| CDK stack (infra change) | `cdk deploy` with previous commit | 5-15 minutes |
| DynamoDB data corruption | Restore from point-in-time recovery (PITR) | 15-30 minutes |
| Frontend (S3 + CloudFront) | Deploy previous build artifact to S3, invalidate CloudFront cache | 2-5 minutes |
| LangGraph agent config | Deploy previous Lambda version (agent graph config bundled in code) | < 1 minute |
| Cognito | No rollback needed -- configuration changes are additive | N/A |

---

## 4. Prototype-to-Production Gate

### 4.1 Gate Criteria

The transition from the prototype phases (1-5) to production (IBKR sandbox with real capital) requires:

#### Decision Quality

- [ ] 100+ simulated decision cycles completed without agent failures
- [ ] Agent success rate > 95% across all 6 agents
- [ ] Golden output regression tests pass for all standard scenarios
- [ ] Shadow model comparison shows acceptable divergence (< 5% on trade decisions)
- [ ] All operating modes (Conservative, Balanced, Aggressive) exercised

#### Guardrail Compliance

- [ ] Zero guardrail bypass incidents in simulation
- [ ] Compliance check pass rate > 99%
- [ ] All escalation paths (L1 -> L2) tested
- [ ] Circuit breaker tested and validated (triggers correctly, resumes correctly)
- [ ] Cool-down enforcement verified

#### Execution Pipeline

- [ ] Order lifecycle fully tested: submit -> fill, submit -> partial fill, submit -> reject, submit -> cancel
- [ ] Staged order execution verified (outside market hours)
- [ ] Idempotency verified: duplicate events produce no side effects
- [ ] DLQ processing verified: failed events are captured and can be replayed

#### Reconciliation

- [ ] Reconciliation pipeline produces correct results against known portfolio states
- [ ] Drift detection triggers at correct thresholds per operating mode
- [ ] Lock/pause/correct/resume SAGA completes without data loss
- [ ] Reconciliation confidence score > 99% on simulated portfolios

#### Frontend

- [ ] All prototype screens functional and tested
- [ ] Onboarding flow completes successfully (E2E test)
- [ ] Dashboard shows real-time updates via subscriptions
- [ ] Decision Detail shows correct explanations
- [ ] i18n works for `it-IT` locale

#### Infrastructure

- [ ] All 14 services deploy successfully to `dev`
- [ ] No DLQ messages accumulated over 7-day simulation run
- [ ] CloudWatch dashboards showing all key metrics
- [ ] Alerting verified (test alerts fire and notify correctly)
- [ ] X-Ray traces show complete decision flows

#### Security

- [ ] Multi-tenant isolation verified: cross-tenant access structurally impossible
- [ ] Cognito JWT validation working on all AppSync APIs
- [ ] No secrets in environment variables (all in Secrets Manager)
- [ ] IBKR credentials isolated per tenant in Secrets Manager

### 4.2 What Changes Between Prototype and Production

| Component | Prototype (Phases 1-5) | Production |
|---|---|---|
| Broker | Simulated (mock events) | IBKR sandbox (paper trading API) |
| Market data | Historical replay | Real-time IBKR sandbox feed |
| Capital | None | Limited real capital (internal accounts) |
| Portfolios | Simulated positions | Real positions in IBKR sandbox |
| Orders | Simulated fills | Real paper trades |
| Deposits/Withdrawals | Simulated events | Real IBKR sandbox transfers |
| Operating mode | All modes exercised | Conservative only (initially) |
| Users | Internal test accounts | Internal test accounts |
| Frontend | All prototype screens | + Confirmation, Deposit, Withdrawal, Closure |

---

## 5. Development Workflow for Solo Developer

> **Local development story**: Unit tests and agent pipeline tests run locally without AWS. Lambda handlers are testable via a local test harness. Integration tests run against real AWS services in a dev account.

### 5.1 Local Development Loop

```
                    +------> Unit Tests (Jest/Vitest, < 30s)
                    |
Code Change --> Nx Affected --> Lint + Type Check --> Deploy to dev account
                    |                                       |
                    |                           Integration Tests (dev account, < 5min)
                    |
                    +------> E2E Tests (Playwright, < 5min)
```

**Daily workflow:**

1. Work on a feature branch
2. Run `nx affected:test` to validate changes
3. Run `nx affected:lint` to catch style issues
4. Deploy affected services to `dev` account (`nx affected --target=deploy --stage=dev`)
5. Run integration tests against deployed dev infrastructure
6. Open PR against `main` (even solo -- discipline)
7. Merge to `main` triggers automated deploy to `dev` + integration tests in CI

### 5.2 Nx Affected for Targeted Builds/Tests

Nx `affected` is the key to fast feedback loops. It only runs tasks for projects affected by the current git diff:

```bash
# Only test projects affected by changes since main
npx nx affected --target=test --base=main

# Only build affected services
npx nx affected --target=build --base=main

# Only deploy affected CDK stacks
npx nx affected --target=deploy --stage=dev --base=main

# Only lint affected projects
npx nx affected --target=lint --base=main
```

The dependency graph ensures that changes to `libs/lambda-utils` trigger tests for all services that depend on it, while changes to `services/execution/portfolio-bff` only trigger tests for that service.

### 5.3 Pre-Commit Hooks

Using `husky` + `lint-staged` for pre-commit validation:

```json
// package.json
{
  "lint-staged": {
    "*.ts": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.html": [
      "prettier --write"
    ],
    "*.scss": [
      "prettier --write"
    ]
  }
}
```

```bash
# .husky/pre-commit
npx lint-staged
npx nx affected --target=typecheck --base=HEAD~1
```

Pre-push hook runs affected unit tests:

```bash
# .husky/pre-push
npx nx affected --target=test --base=origin/main
```

### 5.4 PR Workflow

Even as a solo developer, PRs provide:

- A record of what changed and why
- A checkpoint for AI assistant to review changes
- A natural point for running the full CI pipeline
- Practice for when the team grows

**PR checklist:**

```markdown
## PR Checklist
- [ ] Unit tests pass (`nx affected:test`)
- [ ] Lint passes (`nx affected:lint`)
- [ ] Type check passes (`nx affected:typecheck`)
- [ ] Integration tests pass (if backend changes)
- [ ] E2E tests pass (if frontend changes)
- [ ] No new ESLint warnings
- [ ] GraphQL schema changes are backward-compatible
- [ ] Event contracts documented in service inventory
```

### 5.5 CI Pipeline (GitHub Actions)

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  affected:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for nx affected

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Lint affected
        run: npx nx affected --target=lint --base=origin/main

      - name: Type check affected
        run: npx nx affected --target=typecheck --base=origin/main

      - name: Test affected
        run: npx nx affected --target=test --base=origin/main

  deploy-dev:
    runs-on: ubuntu-latest
    needs: affected
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Deploy affected to dev
        run: npx nx affected --target=deploy --stage=dev --base=origin/main~1
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}

  integration:
    runs-on: ubuntu-latest
    needs: deploy-dev
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Integration tests (against deployed dev account)
        run: npx nx affected --target=test:integration --base=origin/main~1
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

