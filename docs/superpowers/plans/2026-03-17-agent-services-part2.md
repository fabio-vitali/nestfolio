# Agent Services — Part B (Chunks 3–4) Implementation Plan

> **Continuation of Plan 4.** Chunks 1–2 (investor-profile-ctrl, market-intelligence-ctrl) are in `2026-03-17-agent-services.md`. This file covers **Chunk 3 (portfolio-engine-ctrl)** and **Chunk 4 (advisory-narrative-ctrl)**.

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create two agent services that complete the advisory pipeline: `portfolio-engine-ctrl` (dual-agent parallel orchestration with Fund & Instrument KB) and `advisory-narrative-ctrl` (single explainability agent with feedback-loop KB).

**Tech Stack:** TypeScript, AWS CDK (Lambda, DynamoDB, S3, Bedrock KB, EventBridge), LangGraph.js, Jest

**Spec:** `docs/superpowers/specs/2026-03-17-advisory-agent-topology-design.md`

**Pre-requisites:**
- Plan 1 (Agent-Core Generic Refactor) — MUST be complete (generic `createOrchestrator`, `createAgentNode`)
- Plan 3 (Decision-Workflow-Ctrl) — SHOULD be complete (publishes CONSTRUCT_PORTFOLIO, GENERATE_NARRATIVE with taskToken)
- Part A Chunks 1–2 — SHOULD be complete (establishes agent service patterns)

---

## Chunk 3: portfolio-engine-ctrl (Tasks 1–8)

### File Structure

#### Files to CREATE

| File | Responsibility |
|---|---|
| `services/advisory/portfolio-engine-ctrl/project.json` | Nx project config |
| `services/advisory/portfolio-engine-ctrl/tsconfig.json` | TypeScript config |
| `services/advisory/portfolio-engine-ctrl/tsconfig.spec.json` | Test TypeScript config |
| `services/advisory/portfolio-engine-ctrl/jest.config.js` | Jest config |
| `services/advisory/portfolio-engine-ctrl/src/main.ts` | CDK app entry point |
| `services/advisory/portfolio-engine-ctrl/src/service.stack.ts` | CDK stack: State + Ingress + Egress + AgentRuntime + KB S3 + tool Lambda |
| `services/advisory/portfolio-engine-ctrl/src/service-domain/events.ts` | Event type constants |
| `services/advisory/portfolio-engine-ctrl/src/service-domain/models.ts` | AgentInvocation, ReasoningOutput, ProposedTrades types |
| `services/advisory/portfolio-engine-ctrl/src/service-domain/index.ts` | Barrel export |
| `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts` | Routes CONSTRUCT_PORTFOLIO / SEC_* events |
| `services/advisory/portfolio-engine-ctrl/src/handlers/kb-ingestion-handler.ts` | Pre-signed URL fetch → S3 write → KB sync |
| `services/advisory/portfolio-engine-ctrl/src/handlers/portfolio-lookup.ts` | Tool Lambda: DDB query for PortfolioSnapshot |
| `services/advisory/portfolio-engine-ctrl/src/agent-service.ts` | createOrchestrator with parallel wave (portfolio-construction + rebalance-planner) |
| `services/advisory/portfolio-engine-ctrl/stacks/service.stack.ts` | Re-export from src (CDK convention) |

#### Test files to CREATE

| File | Responsibility |
|---|---|
| `services/advisory/portfolio-engine-ctrl/test/event-listener.test.ts` | Event routing + agent invocation |
| `services/advisory/portfolio-engine-ctrl/test/kb-ingestion-handler.test.ts` | Pre-signed URL fetch, S3 write, KB sync trigger |
| `services/advisory/portfolio-engine-ctrl/test/portfolio-lookup.test.ts` | Tool Lambda DDB query |
| `services/advisory/portfolio-engine-ctrl/test/agent-service.test.ts` | Orchestrator parallel wave execution |
| `services/advisory/portfolio-engine-ctrl/test/service.stack.test.ts` | CDK synth assertions |

#### Files to MODIFY

| File | Change |
|---|---|
| `tsconfig.base.json` | Add `@nestfolio/portfolio-engine-ctrl/*` path aliases |

---

### Task 1: Scaffold Nx project

**Files:**
- Create: `services/advisory/portfolio-engine-ctrl/project.json`
- Create: `services/advisory/portfolio-engine-ctrl/tsconfig.json`
- Create: `services/advisory/portfolio-engine-ctrl/tsconfig.spec.json`
- Create: `services/advisory/portfolio-engine-ctrl/jest.config.js`

- [ ] **Step 1: Create project.json**

```json
// services/advisory/portfolio-engine-ctrl/project.json
{
  "name": "portfolio-engine-ctrl",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "services/advisory/portfolio-engine-ctrl/src",
  "projectType": "application",
  "targets": {
    "deploy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk deploy --app 'npx ts-node -r ./tools/register-paths.js services/advisory/portfolio-engine-ctrl/src/main.ts' --require-approval never -c prefix={args.prefix}"
      }
    },
    "destroy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk destroy --app 'npx ts-node -r ./tools/register-paths.js services/advisory/portfolio-engine-ctrl/src/main.ts' --force -c prefix={args.prefix}"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": { "jestConfig": "services/advisory/portfolio-engine-ctrl/jest.config.js" }
    },
    "lint": { "executor": "@nx/eslint:lint" }
  },
  "tags": ["scope:advisory", "type:ctrl"]
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
// services/advisory/portfolio-engine-ctrl/tsconfig.json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "types": ["node"]
  }
}
```

- [ ] **Step 3: Create tsconfig.spec.json**

```json
// services/advisory/portfolio-engine-ctrl/tsconfig.spec.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["jest", "node"]
  },
  "include": ["test/**/*.ts", "src/**/*.ts"]
}
```

- [ ] **Step 4: Create jest.config.js**

```js
// services/advisory/portfolio-engine-ctrl/jest.config.js
const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'portfolio-engine-ctrl',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/agent-core$': '<rootDir>/../../../libs/agent-core/src/index.ts',
    '^@nestfolio/agent-core/(.*)$': '<rootDir>/../../../libs/agent-core/src/$1',
    '^@nestfolio/decision-workflow-ctrl/service$': '<rootDir>/../../advisory/decision-workflow-ctrl/src/service-domain/index.ts',
    '^@nestfolio/execution-adpt/domain$': '<rootDir>/../../execution/execution-adpt/src/domain/index.ts',
    '^@nestfolio/sec-edgar-adpt/domain$': '<rootDir>/../../advisory/sec-edgar-adpt/src/domain/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
```

- [ ] **Step 5: Add tsconfig path aliases in tsconfig.base.json**

```jsonc
// In tsconfig.base.json paths:
"@nestfolio/portfolio-engine-ctrl/service": ["services/advisory/portfolio-engine-ctrl/src/service-domain/index.ts"],
"@nestfolio/portfolio-engine-ctrl/domain": ["services/advisory/portfolio-engine-ctrl/src/service-domain/index.ts"]
```

- [ ] **Step 6: Verify Nx detects the project**

```bash
npx nx show project portfolio-engine-ctrl
```

- [ ] **Step 7: Commit**

```
feat(portfolio-engine-ctrl): scaffold Nx project with configs

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 2: Create service-domain (events + models + barrel)

**Files:**
- Create: `services/advisory/portfolio-engine-ctrl/src/service-domain/events.ts`
- Create: `services/advisory/portfolio-engine-ctrl/src/service-domain/models.ts`
- Create: `services/advisory/portfolio-engine-ctrl/src/service-domain/index.ts`

- [ ] **Step 1: Write event type constants**

```ts
// services/advisory/portfolio-engine-ctrl/src/service-domain/events.ts

/** Events PUBLISHED by portfolio-engine-ctrl */
export const PortfolioEngineEventTypes = {
  // Completion (echoes taskToken back to orchestrator)
  PORTFOLIO_COMPLETED: 'PORTFOLIO_COMPLETED',

  // CDC events (from DDB Streams)
  PORTFOLIO_CONSTRUCTION_PROPOSED: 'PORTFOLIO_CONSTRUCTION_PROPOSED',
  REBALANCE_PLAN_PRODUCED: 'REBALANCE_PLAN_PRODUCED',
} as const;

export type PortfolioEngineEventType =
  (typeof PortfolioEngineEventTypes)[keyof typeof PortfolioEngineEventTypes];

/** Inbound event types consumed by portfolio-engine-ctrl */
export const HANDLED_EVENT_TYPES = new Set([
  'CONSTRUCT_PORTFOLIO',    // from decision-workflow-ctrl (taskToken)
  'SEC_PROSPECTUS_UPDATED', // from sec-edgar-adpt → KB ingestion
  'SEC_10K_UPDATED',        // from sec-edgar-adpt → KB ingestion
]);

/** KB ingestion event types — routed to kb-ingestion-handler */
export const KB_INGESTION_EVENT_TYPES = new Set([
  'SEC_PROSPECTUS_UPDATED',
  'SEC_10K_UPDATED',
]);
```

- [ ] **Step 2: Write models**

```ts
// services/advisory/portfolio-engine-ctrl/src/service-domain/models.ts

export interface AgentInvocation {
  readonly invocationId: string;
  readonly decisionId: string;
  readonly tenantId: string;
  readonly agentName: 'portfolio-construction' | 'rebalance-planner';
  readonly status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
}

export interface ReasoningOutput {
  readonly invocationId: string;
  readonly decisionId: string;
  readonly tenantId: string;
  readonly agentName: string;
  readonly reasoning: string;
  readonly confidence: number;
  readonly createdAt: string;
}

export interface ProposedTrade {
  readonly tradeId: string;
  readonly decisionId: string;
  readonly tenantId: string;
  readonly action: 'BUY' | 'SELL' | 'REBALANCE';
  readonly instrument: string;
  readonly targetWeight: number;
  readonly currentWeight: number;
  readonly quantity: number | null;
  readonly rationale: string;
  readonly createdAt: string;
}

export interface PortfolioSnapshot {
  readonly tenantId: string;
  readonly snapshotDate: string;
  readonly holdings: ReadonlyArray<{
    readonly instrument: string;
    readonly weight: number;
    readonly value: number;
  }>;
  readonly totalValue: number;
}
```

- [ ] **Step 3: Write barrel**

```ts
// services/advisory/portfolio-engine-ctrl/src/service-domain/index.ts
export * from './events';
export * from './models';
```

- [ ] **Step 4: Commit**

```
feat(portfolio-engine-ctrl): add service-domain events, models, and barrel

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 3: Create event-listener handler

**Files:**
- Create: `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts`
- Create: `services/advisory/portfolio-engine-ctrl/test/event-listener.test.ts`

- [ ] **Step 1: Write the test**

```ts
// services/advisory/portfolio-engine-ctrl/test/event-listener.test.ts
import { SQSEvent } from 'aws-lambda';

// Key test cases:
// 1. CONSTRUCT_PORTFOLIO → calls agentService.runPipeline(event) → publishes PORTFOLIO_COMPLETED with taskToken
// 2. SEC_PROSPECTUS_UPDATED → delegates to kbIngestionHandler
// 3. SEC_10K_UPDATED → delegates to kbIngestionHandler
// 4. Unknown event type → logs warning, skips (no failure)
// 5. Agent failure → catches, adds to SQS batch failures, emits EventFailed metric
```

Test uses `createHandler(mockDeps)` pattern. Mock `agentService`, `kbIngestionHandler`, `bus`, `metrics`.

- [ ] **Step 2: Write the handler**

Key routing pattern:

```ts
// services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts
import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { parseRecord, isRetryable, createServiceMetrics, traceEvent, applyMiddleware, withLambdaContext } from '@nestfolio/event-processor';
import { KB_INGESTION_EVENT_TYPES, HANDLED_EVENT_TYPES } from '../service-domain';

export interface EventListenerDeps {
  readonly agentService: { runPipeline: (event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  readonly kbIngestionHandler: { ingest: (event: Record<string, unknown>) => Promise<void> };
  readonly bus: { publish: (events: unknown[]) => Promise<void> };
  readonly metrics: ReturnType<typeof createServiceMetrics>;
}

export const createHandler = (deps: EventListenerDeps) =>
  async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failures: string[] = [];

    for (const record of event.Records) {
      try {
        const uow = parseRecord(record);
        const eventType = uow.event.type;
        traceEvent(eventType, uow.event.id);

        if (!HANDLED_EVENT_TYPES.has(eventType)) {
          continue;
        }

        switch (eventType) {
          case 'CONSTRUCT_PORTFOLIO': {
            const result = await deps.agentService.runPipeline(uow.event);
            await deps.bus.publish([{
              type: 'PORTFOLIO_COMPLETED',
              subject: { ...result, taskToken: uow.event.subject.taskToken },
            }]);
            break;
          }
          default:
            if (KB_INGESTION_EVENT_TYPES.has(eventType)) {
              await deps.kbIngestionHandler.ingest(uow.event);
            }
            break;
        }
        deps.metrics.emit('EventProcessed', 1);
      } catch (err) {
        if (!isRetryable(err)) { continue; }
        failures.push(record.messageId);
        deps.metrics.emit('EventFailed', 1);
      }
    }

    return { batchItemFailures: failures.map(id => ({ itemIdentifier: id })) };
  };
```

- [ ] **Step 3: Run test**

```bash
npx nx test portfolio-engine-ctrl --testPathPattern=event-listener
```

- [ ] **Step 4: Commit**

```
feat(portfolio-engine-ctrl): add event-listener with routing for CONSTRUCT_PORTFOLIO and KB ingestion events

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 4: Create kb-ingestion-handler

**Files:**
- Create: `services/advisory/portfolio-engine-ctrl/src/handlers/kb-ingestion-handler.ts`
- Create: `services/advisory/portfolio-engine-ctrl/test/kb-ingestion-handler.test.ts`

- [ ] **Step 1: Write the test**

Test cases:
1. Inline content (payload < 256KB) → writes to S3 → triggers KB sync
2. Pre-signed URL content → fetches URL → writes to S3 → triggers KB sync
3. Failed URL fetch → throws retryable error
4. KB sync trigger calls `StartIngestionJob` API

- [ ] **Step 2: Write the handler**

Key pattern — handles both inline and pre-signed URL content:

```ts
// services/advisory/portfolio-engine-ctrl/src/handlers/kb-ingestion-handler.ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { BedrockAgentClient, StartIngestionJobCommand } from '@aws-sdk/client-bedrock-agent';

export interface KbIngestionDeps {
  readonly s3: S3Client;
  readonly bedrockAgent: BedrockAgentClient;
  readonly kbBucket: string;
  readonly kbId: string;
  readonly kbDataSourceId: string;
}

export const createKbIngestionHandler = (deps: KbIngestionDeps) => ({
  ingest: async (event: Record<string, unknown>): Promise<void> => {
    const subject = event.subject as Record<string, unknown>;
    const eventType = event.type as string;

    // Determine content: inline or pre-signed URL
    let content: string;
    if (subject.content) {
      content = subject.content as string;
    } else if (subject.preSignedUrl) {
      const response = await fetch(subject.preSignedUrl as string);
      if (!response.ok) throw new Error(`Failed to fetch pre-signed URL: ${response.status}`);
      content = await response.text();
    } else {
      throw new Error(`No content or preSignedUrl in ${eventType} event`);
    }

    // Write to S3 with structured key
    const key = `${eventType.toLowerCase()}/${subject.filingId ?? subject.id ?? Date.now()}.txt`;
    await deps.s3.send(new PutObjectCommand({
      Bucket: deps.kbBucket,
      Key: key,
      Body: content,
      ContentType: 'text/plain',
    }));

    // Trigger KB sync
    await deps.bedrockAgent.send(new StartIngestionJobCommand({
      knowledgeBaseId: deps.kbId,
      dataSourceId: deps.kbDataSourceId,
    }));
  },
});
```

- [ ] **Step 3: Run test**

```bash
npx nx test portfolio-engine-ctrl --testPathPattern=kb-ingestion-handler
```

- [ ] **Step 4: Commit**

```
feat(portfolio-engine-ctrl): add kb-ingestion-handler with pre-signed URL and inline content support

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 5: Create agent-service with parallel orchestration

**Files:**
- Create: `services/advisory/portfolio-engine-ctrl/src/agent-service.ts`
- Create: `services/advisory/portfolio-engine-ctrl/test/agent-service.test.ts`

- [ ] **Step 1: Write the test**

Test cases:
1. `runPipeline` invokes both agents in parallel (Promise.all timing)
2. portfolio-construction receives upstream context + KB retrieval results
3. rebalance-planner receives upstream context + portfolio-construction output + KB retrieval
4. Result merges both agent outputs (allocations + trades)
5. Agent failure in one → whole pipeline fails (no partial results)
6. Invocation records written to DDB for both agents

- [ ] **Step 2: Write the agent service**

Uses `createOrchestrator` from agent-core with a single parallel wave:

```ts
// services/advisory/portfolio-engine-ctrl/src/agent-service.ts
import { createOrchestrator } from '@nestfolio/agent-core';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

export interface AgentServiceDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly tableName: string;
  readonly kbId: string;
  readonly portfolioLookupArn: string;
}

export const createAgentService = (deps: AgentServiceDeps) => {
  const orchestrator = createOrchestrator({
    agents: {
      'portfolio-construction': {
        modelId: 'anthropic.claude-opus-4-0-20250514',
        maxTokens: 4096,
        temperature: 0.1,
        systemPrompt: 'You are a portfolio construction specialist...',
        knowledgeBaseId: deps.kbId,
        tools: [{ name: 'portfolio-lookup', lambdaArn: deps.portfolioLookupArn }],
      },
      'rebalance-planner': {
        modelId: 'anthropic.claude-sonnet-4-20250514',
        maxTokens: 4096,
        temperature: 0.1,
        systemPrompt: 'You are a rebalance planning specialist...',
        knowledgeBaseId: deps.kbId,
        tools: [{ name: 'portfolio-lookup', lambdaArn: deps.portfolioLookupArn }],
      },
    },
    waves: [
      { agents: ['portfolio-construction', 'rebalance-planner'] }, // parallel
    ],
  });

  return {
    runPipeline: async (event: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const invocationId = crypto.randomUUID();
      const startedAt = new Date().toISOString();

      // Record invocation start
      await deps.docClient.send(new PutCommand({
        TableName: deps.tableName,
        Item: { pk: `INV#${invocationId}`, sk: 'META', decisionId: event.subject.decisionId, status: 'IN_PROGRESS', startedAt },
      }));

      const result = await orchestrator.invoke({
        decisionId: event.subject.decisionId,
        tenantId: event.subject.tenantId,
        upstreamOutputs: event.subject.context,
      });

      // Record completion + reasoning outputs + proposed trades
      const completedAt = new Date().toISOString();
      await deps.docClient.send(new PutCommand({
        TableName: deps.tableName,
        Item: { pk: `INV#${invocationId}`, sk: 'META', status: 'COMPLETED', completedAt, durationMs: Date.now() - new Date(startedAt).getTime() },
      }));

      return { decisionId: event.subject.decisionId, ...result };
    },
  };
};
```

- [ ] **Step 3: Run test**

```bash
npx nx test portfolio-engine-ctrl --testPathPattern=agent-service
```

- [ ] **Step 4: Commit**

```
feat(portfolio-engine-ctrl): add agent-service with parallel orchestration (portfolio-construction + rebalance-planner)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 6: Create portfolio-lookup tool Lambda

**Files:**
- Create: `services/advisory/portfolio-engine-ctrl/src/handlers/portfolio-lookup.ts`
- Create: `services/advisory/portfolio-engine-ctrl/test/portfolio-lookup.test.ts`

- [ ] **Step 1: Write the test**

Test cases:
1. Valid tenantId → returns latest PortfolioSnapshot from DDB
2. No snapshot found → returns empty holdings
3. Missing tenantId → returns error response

- [ ] **Step 2: Write the tool Lambda**

```ts
// services/advisory/portfolio-engine-ctrl/src/handlers/portfolio-lookup.ts
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

export interface PortfolioLookupDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly tableName: string;
}

export const createPortfolioLookup = (deps: PortfolioLookupDeps) =>
  async (event: { tenantId: string }): Promise<Record<string, unknown>> => {
    if (!event.tenantId) {
      return { error: 'tenantId is required' };
    }

    const result = await deps.docClient.send(new QueryCommand({
      TableName: deps.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${event.tenantId}`,
        ':prefix': 'SNAPSHOT#',
      },
      ScanIndexForward: false,
      Limit: 1,
    }));

    const snapshot = result.Items?.[0];
    return snapshot
      ? { tenantId: event.tenantId, snapshot }
      : { tenantId: event.tenantId, snapshot: null, holdings: [] };
  };
```

- [ ] **Step 3: Run test**

```bash
npx nx test portfolio-engine-ctrl --testPathPattern=portfolio-lookup
```

- [ ] **Step 4: Commit**

```
feat(portfolio-engine-ctrl): add portfolio-lookup tool Lambda for agent DDB access

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 7: Create service.stack.ts (CDK)

**Files:**
- Create: `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`
- Create: `services/advisory/portfolio-engine-ctrl/src/main.ts`
- Create: `services/advisory/portfolio-engine-ctrl/stacks/service.stack.ts`
- Create: `services/advisory/portfolio-engine-ctrl/test/service.stack.test.ts`

- [ ] **Step 1: Write the stack test**

Assertions:
1. Stack synths without errors
2. Has 3 DDB tables (or single-table with GSIs for AgentInvocation / ReasoningOutput / ProposedTrades)
3. Has S3 bucket for KB content
4. Has SQS queue (Ingress)
5. Has 3 Lambda functions (event-listener, kb-ingestion-handler, portfolio-lookup)
6. Has EventBridge rules for 3 inbound event types
7. Has AgentRuntime construct
8. Has Egress with CDC event types

- [ ] **Step 2: Write the stack**

Key constructs — follows advisory-ctrl pattern with additions for KB + tool Lambda:

```ts
// services/advisory/portfolio-engine-ctrl/src/service.stack.ts
import { StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Bucket, BlockPublicAccess, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { join } from 'path';
import {
  ServiceStack, Ingress, Egress, State, AgentRuntime,
  defaultLambdaProps, agentLambdaProps, createNamingService,
} from '@nestfolio/cdk-constructs';

export class PortfolioEngineCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: StackProps & { prefix: string }) {
    super(scope, id, { ...props, prefix: props.prefix, subsystem: 'advisory', service: 'portfolio-engine-ctrl', serviceDir: __dirname });

    // State: single-table design
    const state = new State(this, 'State', {
      tableName: `${props.prefix}-portfolio-engine`,
      gsis: [
        { indexName: 'gsi-decision', partitionKey: 'decisionId', sortKey: 'sk' },
      ],
    });

    // KB S3 bucket
    const kbBucket = new Bucket(this, 'KbBucket', {
      bucketName: `${this.account}-${props.prefix}-nestfolio-kb-fund`,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Ingress: 3 event types
    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: ['CONSTRUCT_PORTFOLIO', 'SEC_PROSPECTUS_UPDATED', 'SEC_10K_UPDATED'],
      // ... standard SQS + EventBridge rule config
    });

    // Tool Lambda: portfolio-lookup
    const portfolioLookup = new NodejsFunction(this, 'PortfolioLookup', {
      ...defaultLambdaProps,
      entry: join(__dirname, 'handlers/portfolio-lookup.ts'),
      environment: { TABLE_NAME: state.table.tableName },
    });
    state.table.grantReadData(portfolioLookup);

    // Event listener Lambda
    const eventListener = new NodejsFunction(this, 'EventListener', {
      ...agentLambdaProps, // higher timeout + memory for agent invocation
      entry: join(__dirname, 'handlers/event-listener.ts'),
      environment: {
        TABLE_NAME: state.table.tableName,
        KB_BUCKET: kbBucket.bucketName,
        KB_ID: '/* resolved from SSM at deploy */',
        PORTFOLIO_LOOKUP_ARN: portfolioLookup.functionArn,
      },
    });
    state.table.grantReadWriteData(eventListener);
    kbBucket.grantReadWrite(eventListener);
    ingress.queue.grantConsumeMessages(eventListener);

    // KB ingestion handler (separate Lambda for KB-specific events)
    const kbIngestionHandler = new NodejsFunction(this, 'KbIngestionHandler', {
      ...defaultLambdaProps,
      entry: join(__dirname, 'handlers/kb-ingestion-handler.ts'),
      environment: {
        KB_BUCKET: kbBucket.bucketName,
        KB_ID: '/* resolved from SSM */',
        KB_DATA_SOURCE_ID: '/* resolved from SSM */',
      },
    });
    kbBucket.grantWrite(kbIngestionHandler);
    kbIngestionHandler.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['bedrock:StartIngestionJob'],
      resources: ['*'],
    }));

    // AgentRuntime
    new AgentRuntime(this, 'AgentRuntime', { /* standard config */ });

    // Egress: CDC events
    new Egress(this, 'Egress', {
      customEventTypeMap: {
        PORTFOLIO_CONSTRUCTION_PROPOSED: 'PORTFOLIO_CONSTRUCTION_PROPOSED',
        REBALANCE_PLAN_PRODUCED: 'REBALANCE_PLAN_PRODUCED',
      },
    });
  }
}
```

- [ ] **Step 3: Write main.ts**

```ts
// services/advisory/portfolio-engine-ctrl/src/main.ts
import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { PortfolioEngineCtrlStack } from './service.stack';

const app = new App();
const config = resolvePipelineConfig(app, 'portfolio-engine-ctrl');
new PortfolioEngineCtrlStack(app, `${config.prefix}-portfolio-engine-ctrl`, { prefix: config.prefix, env: config.env });
```

- [ ] **Step 4: Write stacks/service.stack.ts re-export**

```ts
export { PortfolioEngineCtrlStack } from '../src/service.stack';
```

- [ ] **Step 5: Run stack synth test**

```bash
npx nx test portfolio-engine-ctrl --testPathPattern=service.stack
```

- [ ] **Step 6: Commit**

```
feat(portfolio-engine-ctrl): add CDK stack with State, Ingress, Egress, AgentRuntime, KB bucket, tool Lambda

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 8: Run full test suite + checkpoint

- [ ] **Step 1: Run all portfolio-engine-ctrl tests**

```bash
npx nx test portfolio-engine-ctrl
```

Expected: ALL PASS (~15-20 tests)

- [ ] **Step 2: Run all projects**

```bash
npx nx run-many -t test --all
```

Expected: ALL projects PASS

- [ ] **Step 3: Commit (if any fixes needed)**

```
fix(portfolio-engine-ctrl): test fixes from full suite run

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Chunk 4: advisory-narrative-ctrl (Tasks 9–14)

### File Structure

#### Files to CREATE

| File | Responsibility |
|---|---|
| `services/advisory/advisory-narrative-ctrl/project.json` | Nx project config |
| `services/advisory/advisory-narrative-ctrl/tsconfig.json` | TypeScript config |
| `services/advisory/advisory-narrative-ctrl/tsconfig.spec.json` | Test TypeScript config |
| `services/advisory/advisory-narrative-ctrl/jest.config.js` | Jest config |
| `services/advisory/advisory-narrative-ctrl/src/main.ts` | CDK app entry point |
| `services/advisory/advisory-narrative-ctrl/src/service.stack.ts` | CDK stack: State + Ingress + Egress + AgentRuntime + KB S3 |
| `services/advisory/advisory-narrative-ctrl/src/service-domain/events.ts` | Event type constants |
| `services/advisory/advisory-narrative-ctrl/src/service-domain/models.ts` | AgentInvocation, ReasoningOutput types |
| `services/advisory/advisory-narrative-ctrl/src/service-domain/index.ts` | Barrel export |
| `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts` | Routes GENERATE_NARRATIVE / DECISION_FEEDBACK events |
| `services/advisory/advisory-narrative-ctrl/src/handlers/feedback-correlator.ts` | Loads original explanation → annotates with outcome → writes to S3 → KB sync |
| `services/advisory/advisory-narrative-ctrl/src/agent-service.ts` | Single explainability agent (Sonnet, 8192 tokens, temp 0.3) |
| `services/advisory/advisory-narrative-ctrl/stacks/service.stack.ts` | Re-export from src |

#### Test files to CREATE

| File | Responsibility |
|---|---|
| `services/advisory/advisory-narrative-ctrl/test/event-listener.test.ts` | Event routing tests |
| `services/advisory/advisory-narrative-ctrl/test/feedback-correlator.test.ts` | Feedback loop: load → annotate → S3 → KB sync |
| `services/advisory/advisory-narrative-ctrl/test/agent-service.test.ts` | Single agent invocation |
| `services/advisory/advisory-narrative-ctrl/test/service.stack.test.ts` | CDK synth assertions |

#### Files to MODIFY

| File | Change |
|---|---|
| `tsconfig.base.json` | Add `@nestfolio/advisory-narrative-ctrl/*` path aliases |

---

### Task 9: Scaffold Nx project

**Files:**
- Create: `services/advisory/advisory-narrative-ctrl/project.json`
- Create: `services/advisory/advisory-narrative-ctrl/tsconfig.json`
- Create: `services/advisory/advisory-narrative-ctrl/tsconfig.spec.json`
- Create: `services/advisory/advisory-narrative-ctrl/jest.config.js`

- [ ] **Step 1: Create project.json**

Same pattern as portfolio-engine-ctrl — update `name`, `sourceRoot`, `command` paths, and `displayName` to `advisory-narrative-ctrl`.

```json
{
  "name": "advisory-narrative-ctrl",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "services/advisory/advisory-narrative-ctrl/src",
  "projectType": "application",
  "targets": {
    "deploy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk deploy --app 'npx ts-node -r ./tools/register-paths.js services/advisory/advisory-narrative-ctrl/src/main.ts' --require-approval never -c prefix={args.prefix}"
      }
    },
    "destroy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk destroy --app 'npx ts-node -r ./tools/register-paths.js services/advisory/advisory-narrative-ctrl/src/main.ts' --force -c prefix={args.prefix}"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": { "jestConfig": "services/advisory/advisory-narrative-ctrl/jest.config.js" }
    },
    "lint": { "executor": "@nx/eslint:lint" }
  },
  "tags": ["scope:advisory", "type:ctrl"]
}
```

- [ ] **Step 2: Create tsconfig.json + tsconfig.spec.json**

Same pattern as Chunk 3 Task 1.

- [ ] **Step 3: Create jest.config.js**

```js
const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'advisory-narrative-ctrl',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/agent-core$': '<rootDir>/../../../libs/agent-core/src/index.ts',
    '^@nestfolio/agent-core/(.*)$': '<rootDir>/../../../libs/agent-core/src/$1',
    '^@nestfolio/decision-workflow-ctrl/service$': '<rootDir>/../../advisory/decision-workflow-ctrl/src/service-domain/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
```

- [ ] **Step 4: Add tsconfig path aliases in tsconfig.base.json**

```jsonc
"@nestfolio/advisory-narrative-ctrl/service": ["services/advisory/advisory-narrative-ctrl/src/service-domain/index.ts"],
"@nestfolio/advisory-narrative-ctrl/domain": ["services/advisory/advisory-narrative-ctrl/src/service-domain/index.ts"]
```

- [ ] **Step 5: Verify Nx detects the project**

```bash
npx nx show project advisory-narrative-ctrl
```

- [ ] **Step 6: Commit**

```
feat(advisory-narrative-ctrl): scaffold Nx project with configs

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 10: Create service-domain (events + models + barrel)

**Files:**
- Create: `services/advisory/advisory-narrative-ctrl/src/service-domain/events.ts`
- Create: `services/advisory/advisory-narrative-ctrl/src/service-domain/models.ts`
- Create: `services/advisory/advisory-narrative-ctrl/src/service-domain/index.ts`

- [ ] **Step 1: Write event type constants**

```ts
// services/advisory/advisory-narrative-ctrl/src/service-domain/events.ts

/** Events PUBLISHED by advisory-narrative-ctrl */
export const NarrativeEventTypes = {
  NARRATIVE_COMPLETED: 'NARRATIVE_COMPLETED',
  EXPLANATION_GENERATED: 'EXPLANATION_GENERATED', // CDC
} as const;

export type NarrativeEventType =
  (typeof NarrativeEventTypes)[keyof typeof NarrativeEventTypes];

/** Inbound event types consumed by advisory-narrative-ctrl */
export const HANDLED_EVENT_TYPES = new Set([
  'GENERATE_NARRATIVE',  // from decision-workflow-ctrl (taskToken)
  'DECISION_FEEDBACK',   // from decision-workflow-ctrl (feedback loop)
]);

/** Feedback event type — routed to feedback-correlator */
export const FEEDBACK_EVENT_TYPES = new Set([
  'DECISION_FEEDBACK',
]);
```

- [ ] **Step 2: Write models**

```ts
// services/advisory/advisory-narrative-ctrl/src/service-domain/models.ts

export interface AgentInvocation {
  readonly invocationId: string;
  readonly decisionId: string;
  readonly tenantId: string;
  readonly agentName: 'explainability';
  readonly status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
}

export interface ReasoningOutput {
  readonly invocationId: string;
  readonly decisionId: string;
  readonly tenantId: string;
  readonly summary: string;
  readonly rationale: string;
  readonly keyFactors: ReadonlyArray<string>;
  readonly tone: string;
  readonly wordCount: number;
  readonly createdAt: string;
}

/** Feedback annotation written to S3 for KB ingestion */
export interface FeedbackAnnotation {
  readonly decisionId: string;
  readonly tenantId: string;
  readonly outcome: 'ACCEPTED' | 'REJECTED';
  readonly rejectionReason: string | null;
  readonly originalSummary: string;
  readonly originalTone: string;
  readonly originalWordCount: number;
  readonly originalKeyFactors: ReadonlyArray<string>;
  readonly riskCategory: string;
  readonly annotatedAt: string;
}
```

- [ ] **Step 3: Write barrel**

```ts
export * from './events';
export * from './models';
```

- [ ] **Step 4: Commit**

```
feat(advisory-narrative-ctrl): add service-domain events, models, and barrel

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 11: Create event-listener + agent-service

**Files:**
- Create: `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts`
- Create: `services/advisory/advisory-narrative-ctrl/src/agent-service.ts`
- Create: `services/advisory/advisory-narrative-ctrl/test/event-listener.test.ts`
- Create: `services/advisory/advisory-narrative-ctrl/test/agent-service.test.ts`

- [ ] **Step 1: Write event-listener test**

Test cases:
1. GENERATE_NARRATIVE → calls agentService.runPipeline → publishes NARRATIVE_COMPLETED with taskToken
2. DECISION_FEEDBACK → delegates to feedbackCorrelator.process
3. Unknown event → skips

- [ ] **Step 2: Write event-listener**

Same routing pattern as portfolio-engine-ctrl, but routes to:
- `GENERATE_NARRATIVE` → `agentService.runPipeline(event)` → publish `NARRATIVE_COMPLETED`
- `DECISION_FEEDBACK` → `feedbackCorrelator.process(event)`

```ts
export interface EventListenerDeps {
  readonly agentService: { runPipeline: (event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  readonly feedbackCorrelator: { process: (event: Record<string, unknown>) => Promise<void> };
  readonly bus: { publish: (events: unknown[]) => Promise<void> };
  readonly metrics: ReturnType<typeof createServiceMetrics>;
}

export const createHandler = (deps: EventListenerDeps) =>
  async (event: SQSEvent): Promise<SQSBatchResponse> => {
    // ... standard loop with parseRecord + traceEvent
    // switch on eventType:
    //   GENERATE_NARRATIVE → runPipeline → publish NARRATIVE_COMPLETED
    //   DECISION_FEEDBACK → feedbackCorrelator.process
  };
```

- [ ] **Step 3: Write agent-service test**

Test cases:
1. Single agent invocation with correct model/tokens/temp
2. KB retrieval integrated into prompt
3. Invocation + reasoning output recorded to DDB
4. Returns summary, rationale, keyFactors

- [ ] **Step 4: Write agent-service**

Single agent — no orchestrator needed, direct `createAgentNode` usage:

```ts
// services/advisory/advisory-narrative-ctrl/src/agent-service.ts
import { createAgentNode, withRetry, withValidation } from '@nestfolio/agent-core';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

export interface AgentServiceDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly tableName: string;
  readonly kbId: string;
}

export const createAgentService = (deps: AgentServiceDeps) => {
  const explainabilityNode = withRetry(
    withValidation(
      createAgentNode({
        modelId: 'anthropic.claude-sonnet-4-20250514',
        maxTokens: 8192,
        temperature: 0.3,
        systemPrompt: 'You are a financial explanation specialist. Synthesize all upstream decision context into a clear, personalized explanation...',
        knowledgeBaseId: deps.kbId,
      }),
      { /* output must contain summary, rationale, keyFactors */ },
    ),
    { maxAttempts: 2, escalationPath: ['sonnet', 'opus'] },
  );

  return {
    runPipeline: async (event: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const invocationId = crypto.randomUUID();
      // Record invocation start → invoke agent → record completion + reasoning output
      const result = await explainabilityNode({
        decisionId: event.subject.decisionId,
        tenantId: event.subject.tenantId,
        upstreamOutputs: event.subject.context,
      });
      // Write ReasoningOutput to DDB
      await deps.docClient.send(new PutCommand({
        TableName: deps.tableName,
        Item: { pk: `INV#${invocationId}`, sk: 'REASONING', ...result, createdAt: new Date().toISOString() },
      }));
      return { decisionId: event.subject.decisionId, ...result };
    },
  };
};
```

- [ ] **Step 5: Run tests**

```bash
npx nx test advisory-narrative-ctrl --testPathPattern="event-listener|agent-service"
```

- [ ] **Step 6: Commit**

```
feat(advisory-narrative-ctrl): add event-listener and agent-service (explainability, Sonnet 8192)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 12: Create feedback-correlator handler

**Files:**
- Create: `services/advisory/advisory-narrative-ctrl/src/handlers/feedback-correlator.ts`
- Create: `services/advisory/advisory-narrative-ctrl/test/feedback-correlator.test.ts`

This is the core of the feedback loop. When a DECISION_FEEDBACK event arrives (after USER_CONFIRMED or USER_REJECTED), the correlator:
1. Loads the original explanation from DDB (by decisionId)
2. Annotates it with the outcome (accepted/rejected + reason)
3. Writes the annotated narrative to S3
4. Triggers KB sync so future explanations learn from feedback

- [ ] **Step 1: Write the test**

Test cases:
1. ACCEPTED feedback → loads explanation → writes positive annotation to S3 → triggers KB sync
2. REJECTED feedback with reason → loads explanation → writes negative annotation with reason → KB sync
3. Missing explanation in DDB → logs warning, skips (no error — explanation may have been purged)
4. S3 write failure → throws retryable error
5. Annotation format matches `FeedbackAnnotation` model

- [ ] **Step 2: Write the handler**

```ts
// services/advisory/advisory-narrative-ctrl/src/handlers/feedback-correlator.ts
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { BedrockAgentClient, StartIngestionJobCommand } from '@aws-sdk/client-bedrock-agent';
import { logger } from '@nestfolio/event-processor';
import { FeedbackAnnotation } from '../service-domain';

export interface FeedbackCorrelatorDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly s3: S3Client;
  readonly bedrockAgent: BedrockAgentClient;
  readonly tableName: string;
  readonly kbBucket: string;
  readonly kbId: string;
  readonly kbDataSourceId: string;
}

export const createFeedbackCorrelator = (deps: FeedbackCorrelatorDeps) => ({
  process: async (event: Record<string, unknown>): Promise<void> => {
    const subject = event.subject as Record<string, unknown>;
    const decisionId = subject.decisionId as string;
    const outcome = subject.outcome as 'ACCEPTED' | 'REJECTED';
    const rejectionReason = (subject.rejectionReason as string) ?? null;

    // 1. Load original explanation from DDB
    const result = await deps.docClient.send(new QueryCommand({
      TableName: deps.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `DECISION#${decisionId}`,
        ':prefix': 'REASONING',
      },
      Limit: 1,
    }));

    const original = result.Items?.[0];
    if (!original) {
      logger.warn('No explanation found for decision, skipping feedback annotation', { decisionId });
      return;
    }

    // 2. Build annotation
    const annotation: FeedbackAnnotation = {
      decisionId,
      tenantId: original.tenantId as string,
      outcome,
      rejectionReason,
      originalSummary: original.summary as string,
      originalTone: original.tone as string,
      originalWordCount: original.wordCount as number,
      originalKeyFactors: original.keyFactors as string[],
      riskCategory: subject.riskCategory as string,
      annotatedAt: new Date().toISOString(),
    };

    // 3. Write to S3
    const key = `feedback/${outcome.toLowerCase()}/${decisionId}-${Date.now()}.json`;
    await deps.s3.send(new PutObjectCommand({
      Bucket: deps.kbBucket,
      Key: key,
      Body: JSON.stringify(annotation, null, 2),
      ContentType: 'application/json',
    }));

    // 4. Trigger KB sync
    await deps.bedrockAgent.send(new StartIngestionJobCommand({
      knowledgeBaseId: deps.kbId,
      dataSourceId: deps.kbDataSourceId,
    }));

    logger.info('Feedback annotation written and KB sync triggered', { decisionId, outcome, key });
  },
});
```

- [ ] **Step 3: Run test**

```bash
npx nx test advisory-narrative-ctrl --testPathPattern=feedback-correlator
```

- [ ] **Step 4: Commit**

```
feat(advisory-narrative-ctrl): add feedback-correlator — loads explanation, annotates with outcome, writes to KB

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 13: Create service.stack.ts (CDK)

**Files:**
- Create: `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`
- Create: `services/advisory/advisory-narrative-ctrl/src/main.ts`
- Create: `services/advisory/advisory-narrative-ctrl/stacks/service.stack.ts`
- Create: `services/advisory/advisory-narrative-ctrl/test/service.stack.test.ts`

- [ ] **Step 1: Write the stack test**

Assertions:
1. Stack synths without errors
2. Has DDB table (AgentInvocation + ReasoningOutput in single table)
3. Has S3 bucket for KB content (`nestfolio-kb-explainability`)
4. Has SQS queue (Ingress)
5. Has 2 Lambda functions (event-listener, feedback-correlator) — no tool Lambdas
6. Has EventBridge rules for 2 inbound event types (GENERATE_NARRATIVE, DECISION_FEEDBACK)
7. Has AgentRuntime construct
8. Has Egress with CDC event type (EXPLANATION_GENERATED)

- [ ] **Step 2: Write the stack**

```ts
// services/advisory/advisory-narrative-ctrl/src/service.stack.ts
import { StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Bucket, BlockPublicAccess, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { join } from 'path';
import {
  ServiceStack, Ingress, Egress, State, AgentRuntime,
  defaultLambdaProps, agentLambdaProps, createNamingService,
} from '@nestfolio/cdk-constructs';

export class AdvisoryNarrativeCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: StackProps & { prefix: string }) {
    super(scope, id, { ...props, prefix: props.prefix, subsystem: 'advisory', service: 'advisory-narrative-ctrl', serviceDir: __dirname });

    const state = new State(this, 'State', {
      tableName: `${props.prefix}-advisory-narrative`,
      gsis: [
        { indexName: 'gsi-decision', partitionKey: 'decisionId', sortKey: 'sk' },
      ],
    });

    // KB S3 bucket (Explainability Feedback)
    const kbBucket = new Bucket(this, 'KbBucket', {
      bucketName: `${this.account}-${props.prefix}-nestfolio-kb-explainability`,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: ['GENERATE_NARRATIVE', 'DECISION_FEEDBACK'],
    });

    // Event listener (agent invocation + feedback routing)
    const eventListener = new NodejsFunction(this, 'EventListener', {
      ...agentLambdaProps,
      entry: join(__dirname, 'handlers/event-listener.ts'),
      environment: {
        TABLE_NAME: state.table.tableName,
        KB_BUCKET: kbBucket.bucketName,
        KB_ID: '/* resolved from SSM */',
        KB_DATA_SOURCE_ID: '/* resolved from SSM */',
      },
    });
    state.table.grantReadWriteData(eventListener);
    kbBucket.grantReadWrite(eventListener);
    ingress.queue.grantConsumeMessages(eventListener);

    // Feedback correlator (separate handler for clarity)
    // Note: invoked by event-listener, not directly by SQS.
    // Alternatively, could be a separate SQS consumer — architecture choice.
    // For simplicity, feedback-correlator is a function called from event-listener.

    // AgentRuntime
    new AgentRuntime(this, 'AgentRuntime', { /* standard config */ });

    // Egress: CDC
    new Egress(this, 'Egress', {
      customEventTypeMap: {
        EXPLANATION_GENERATED: 'EXPLANATION_GENERATED',
      },
    });
  }
}
```

- [ ] **Step 3: Write main.ts**

```ts
import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { AdvisoryNarrativeCtrlStack } from './service.stack';

const app = new App();
const config = resolvePipelineConfig(app, 'advisory-narrative-ctrl');
new AdvisoryNarrativeCtrlStack(app, `${config.prefix}-advisory-narrative-ctrl`, { prefix: config.prefix, env: config.env });
```

- [ ] **Step 4: Write stacks/service.stack.ts re-export**

```ts
export { AdvisoryNarrativeCtrlStack } from '../src/service.stack';
```

- [ ] **Step 5: Run stack test**

```bash
npx nx test advisory-narrative-ctrl --testPathPattern=service.stack
```

- [ ] **Step 6: Commit**

```
feat(advisory-narrative-ctrl): add CDK stack with State, Ingress, Egress, AgentRuntime, KB bucket

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 14: Full test suite + final checkpoint

- [ ] **Step 1: Run all advisory-narrative-ctrl tests**

```bash
npx nx test advisory-narrative-ctrl
```

Expected: ALL PASS (~12-15 tests)

- [ ] **Step 2: Run both Chunk 3 + Chunk 4 services**

```bash
npx nx test portfolio-engine-ctrl advisory-narrative-ctrl
```

Expected: ALL PASS

- [ ] **Step 3: Run full project suite**

```bash
npx nx run-many -t test --all
```

Expected: ALL projects PASS

- [ ] **Step 4: Commit (if any fixes needed)**

```
fix(agent-services): test fixes from full suite run (chunks 3-4)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Summary

| Chunk | Service | Agents | KB | Tasks | Est. Tests |
|---|---|---|---|---|---|
| 3 | portfolio-engine-ctrl | portfolio-construction (Opus) + rebalance-planner (Sonnet) — parallel | Fund & Instrument | 8 | ~15-20 |
| 4 | advisory-narrative-ctrl | explainability (Sonnet) | Explainability Feedback | 6 | ~12-15 |
| **Total** | | **3 agents** | **2 KBs** | **14** | **~27-35** |
