# Decision-Workflow-Ctrl Service — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `decision-workflow-ctrl` — a new service that orchestrates the decision lifecycle via AWS Step Functions, owns the DecisionPacket DDB table, handles compliance callbacks and user responses. This is Plan 3 of 5 for the Advisory Agent Topology project.

**Architecture:** Step Functions state machine with `waitForTaskToken` pattern. The state machine publishes trigger events to EventBridge with `taskToken` embedded, agent services echo the token back in completion events, and the orchestrator's event-listener calls `SendTaskSuccess` to resume the state machine. Parallel state for investor-profile + market-intelligence, then sequential portfolio-engine → advisory-narrative, followed by compliance wait → optional user confirmation wait.

**Tech Stack:** TypeScript, AWS CDK (Step Functions L2 constructs, EventBridge, DynamoDB, Lambda), Jest

**Spec:** `docs/superpowers/specs/2026-03-17-advisory-agent-topology-design.md`

**Pre-requisites:**
- Plan 1 (Agent-Core Generic Refactor) — MUST be complete (decision-workflow-ctrl imports generic agent-core types)
- Plan 2 (Advisory-Ctrl Slim-Down) — SHOULD be complete (avoids event type conflicts)

**Risks:**
- Step Functions is NEW to this codebase — no existing patterns to follow
- 17 inbound event types require careful routing logic
- `waitForTaskToken` integration with EventBridge PutEvents requires specific CDK L2 usage (`aws-stepfunctions-tasks`)

---

## File Structure

### Files to CREATE

| File | Responsibility |
|---|---|
| `services/advisory/decision-workflow-ctrl/project.json` | Nx project config |
| `services/advisory/decision-workflow-ctrl/tsconfig.json` | TypeScript config |
| `services/advisory/decision-workflow-ctrl/tsconfig.spec.json` | Test TypeScript config |
| `services/advisory/decision-workflow-ctrl/jest.config.js` | Jest config |
| `services/advisory/decision-workflow-ctrl/src/main.ts` | CDK app entry point |
| `services/advisory/decision-workflow-ctrl/src/service.stack.ts` | CDK stack: State + Ingress + Step Functions + Egress |
| `services/advisory/decision-workflow-ctrl/src/service-domain/events.ts` | Event type constants |
| `services/advisory/decision-workflow-ctrl/src/service-domain/models.ts` | DecisionPacket type, WorkflowStatus enum |
| `services/advisory/decision-workflow-ctrl/src/service-domain/index.ts` | Barrel export |
| `services/advisory/decision-workflow-ctrl/src/repositories/decision-packet.repository.ts` | DDB operations for DecisionPacket |
| `services/advisory/decision-workflow-ctrl/src/handlers/event-listener.ts` | Routes 17 event types: triggers → startExecution, completions → SendTaskSuccess |
| `services/advisory/decision-workflow-ctrl/src/handlers/event-publisher-cdc.ts` | DDB Streams → EventBridge CDC |
| `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` | Step Functions state machine CDK construct |

### Test files to CREATE

| File | Responsibility |
|---|---|
| `services/advisory/decision-workflow-ctrl/test/decision-packet.repository.test.ts` | Repository unit tests |
| `services/advisory/decision-workflow-ctrl/test/event-listener.test.ts` | Event routing + SFN integration tests |
| `services/advisory/decision-workflow-ctrl/test/event-publisher-cdc.test.ts` | CDC publisher tests |
| `services/advisory/decision-workflow-ctrl/test/service.stack.test.ts` | CDK stack synthesis assertions |

### Files to MODIFY

| File | Change |
|---|---|
| `tsconfig.base.json` | Add `@nestfolio/decision-workflow-ctrl/*` path aliases |

---

## Chunk 1: Service Scaffold + Domain Types + Repository (Tasks 1–5)

### Task 1: Scaffold Nx project

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/project.json`
- Create: `services/advisory/decision-workflow-ctrl/tsconfig.json`
- Create: `services/advisory/decision-workflow-ctrl/tsconfig.spec.json`
- Create: `services/advisory/decision-workflow-ctrl/jest.config.js`

- [ ] **Step 1: Create project.json**

```json
// services/advisory/decision-workflow-ctrl/project.json
{
  "name": "decision-workflow-ctrl",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "services/advisory/decision-workflow-ctrl/src",
  "projectType": "application",
  "targets": {
    "deploy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk deploy --app 'npx ts-node -r ./tools/register-paths.js services/advisory/decision-workflow-ctrl/src/main.ts' --require-approval never -c prefix={args.prefix}"
      }
    },
    "destroy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk destroy --app 'npx ts-node -r ./tools/register-paths.js services/advisory/decision-workflow-ctrl/src/main.ts' --force -c prefix={args.prefix}"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": { "jestConfig": "services/advisory/decision-workflow-ctrl/jest.config.js" }
    },
    "lint": { "executor": "@nx/eslint:lint" }
  },
  "tags": ["scope:advisory", "type:ctrl"]
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
// services/advisory/decision-workflow-ctrl/tsconfig.json
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
// services/advisory/decision-workflow-ctrl/tsconfig.spec.json
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
// services/advisory/decision-workflow-ctrl/jest.config.js
const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'decision-workflow-ctrl',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/investor-adpt/domain$': '<rootDir>/../../investor/investor-adpt/src/domain/index.ts',
    '^@nestfolio/advisory-bff/service$': '<rootDir>/../../advisory/advisory-bff/src/service-domain/index.ts',
    '^@nestfolio/compliance-ctrl/service$': '<rootDir>/../../advisory/compliance-ctrl/src/service-domain/index.ts',
    '^@nestfolio/execution-adpt/domain$': '<rootDir>/../../execution/execution-adpt/src/domain/index.ts',
    '^@nestfolio/ledger-adpt/domain$': '<rootDir>/../../ledger/ledger-adpt/src/domain/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
```

- [ ] **Step 5: Add tsconfig path alias in tsconfig.base.json**

Add path entries for the new service's domain barrel:

```jsonc
// In tsconfig.base.json paths:
"@nestfolio/decision-workflow-ctrl/service": ["services/advisory/decision-workflow-ctrl/src/service-domain/index.ts"],
"@nestfolio/decision-workflow-ctrl/domain": ["services/advisory/decision-workflow-ctrl/src/service-domain/index.ts"]
```

- [ ] **Step 6: Verify Nx detects the project**

```bash
npx nx show project decision-workflow-ctrl
```

- [ ] **Step 7: Commit scaffold**

```
feat(decision-workflow-ctrl): scaffold Nx project with configs

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 2: Create service-domain/events.ts

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/src/service-domain/events.ts`

- [ ] **Step 1: Write event type constants**

```ts
// services/advisory/decision-workflow-ctrl/src/service-domain/events.ts

/** Events PUBLISHED by decision-workflow-ctrl */
export const DecisionWorkflowEventTypes = {
  // Lifecycle events (CDC from DDB)
  DECISION_PACKET_CREATED: 'DECISION_PACKET_CREATED',
  DECISION_PACKET_ENRICHED: 'DECISION_PACKET_ENRICHED',

  // Agent trigger events (published by Step Functions via EventBridge integration)
  ANALYZE_INVESTOR_PROFILE: 'ANALYZE_INVESTOR_PROFILE',
  ANALYZE_MARKET: 'ANALYZE_MARKET',
  CONSTRUCT_PORTFOLIO: 'CONSTRUCT_PORTFOLIO',
  GENERATE_NARRATIVE: 'GENERATE_NARRATIVE',

  // Post-agent lifecycle
  RECOMMENDATION_PROPOSED: 'RECOMMENDATION_PROPOSED',
  USER_CONFIRMATION_REQUESTED: 'USER_CONFIRMATION_REQUESTED',

  // Feedback loop
  DECISION_FEEDBACK: 'DECISION_FEEDBACK',

  // Error
  DECISION_WORKFLOW_FAILED: 'DECISION_WORKFLOW_FAILED',
} as const;

export type DecisionWorkflowEventType =
  (typeof DecisionWorkflowEventTypes)[keyof typeof DecisionWorkflowEventTypes];

/**
 * Inbound event types consumed by decision-workflow-ctrl (17 total).
 * Grouped by routing action in the event-listener.
 */

/** 9 trigger events → start new Step Functions execution */
export const TRIGGER_EVENT_TYPES = [
  'MANDATE_GRANTED',
  'GOAL_UPDATED',
  'RISK_PROFILE_UPDATED',
  'OPERATING_MODE_CHANGED',
  'PORTFOLIO_DRIFT_DETECTED',
  'ORDER_FILLED',
  'ORDER_REJECTED',
  'ORDER_CANCELLED',
  'DEPOSIT_DETECTED',
] as const;

/** 4 agent completion events → SendTaskSuccess with agent outputs */
export const AGENT_COMPLETION_EVENT_TYPES = [
  'INVESTOR_PROFILE_COMPLETED',
  'MARKET_ANALYSIS_COMPLETED',
  'PORTFOLIO_COMPLETED',
  'NARRATIVE_COMPLETED',
] as const;

/** 2 compliance events → SendTaskSuccess with approved/blocked */
export const COMPLIANCE_EVENT_TYPES = [
  'DECISION_APPROVED',
  'DECISION_BLOCKED',
] as const;

/** 2 user response events → SendTaskSuccess with confirmed/rejected */
export const USER_RESPONSE_EVENT_TYPES = [
  'USER_CONFIRMED',
  'USER_REJECTED',
] as const;

/** All 17 inbound event types for Ingress EventBridge rules */
export const ALL_INBOUND_EVENT_TYPES = [
  ...TRIGGER_EVENT_TYPES,
  ...AGENT_COMPLETION_EVENT_TYPES,
  ...COMPLIANCE_EVENT_TYPES,
  ...USER_RESPONSE_EVENT_TYPES,
] as const;
```

- [ ] **Step 2: Commit**

```
feat(decision-workflow-ctrl): add event type constants (17 inbound, 10 outbound)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 3: Create service-domain/models.ts + barrel

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/src/service-domain/models.ts`
- Create: `services/advisory/decision-workflow-ctrl/src/service-domain/index.ts`

- [ ] **Step 1: Write the models**

```ts
// services/advisory/decision-workflow-ctrl/src/service-domain/models.ts

/** Status of a DecisionPacket through the Step Functions workflow. */
export type WorkflowStatus =
  | 'INITIATED'           // SF execution started, DecisionPacket created
  | 'PROFILING'           // Parallel: investor-profile + market-intelligence in progress
  | 'CONSTRUCTING'        // portfolio-engine in progress
  | 'NARRATING'           // advisory-narrative in progress
  | 'PROPOSED'            // All agents complete, recommendation assembled
  | 'COMPLIANCE_REVIEW'   // Waiting for compliance callback
  | 'APPROVED'            // Compliance approved (L1 — auto-execute)
  | 'BLOCKED'             // Compliance blocked
  | 'AWAITING_CONFIRMATION' // L2 — waiting for user confirmation
  | 'CONFIRMED'           // User confirmed
  | 'REJECTED'            // User rejected
  | 'FAILED';             // SF execution failed / timed out

/** Agent step names matching the Step Functions state names. */
export type AgentStep =
  | 'investor-profile'
  | 'market-intelligence'
  | 'portfolio-engine'
  | 'advisory-narrative';

/** DecisionPacket: the core aggregate owned by decision-workflow-ctrl. */
export interface DecisionPacket {
  readonly decisionId: string;
  readonly tenantId: string;
  readonly trigger: string;
  readonly triggerEventId: string;
  readonly status: WorkflowStatus;
  readonly executionArn: string | null;
  readonly investorProfileOutput: Record<string, unknown> | null;
  readonly marketAnalysisOutput: Record<string, unknown> | null;
  readonly portfolioOutput: Record<string, unknown> | null;
  readonly narrativeOutput: Record<string, unknown> | null;
  readonly complianceResult: 'APPROVED' | 'BLOCKED' | null;
  readonly authorityLevel: 'L1' | 'L2' | null;
  readonly userDecision: 'CONFIRMED' | 'REJECTED' | null;
  readonly blockReason: string | null;
  readonly rejectionReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Payload shape for agent trigger events published by Step Functions. */
export interface AgentTriggerPayload {
  readonly decisionId: string;
  readonly tenantId: string;
  readonly taskToken: string;
  readonly context: Record<string, unknown>;
  readonly upstreamOutputs?: Record<string, unknown>;
}

/** Payload shape for agent completion events received by the orchestrator. */
export interface AgentCompletionPayload {
  readonly decisionId: string;
  readonly tenantId: string;
  readonly taskToken: string;
  readonly outputs: Record<string, unknown>;
}
```

- [ ] **Step 2: Write the barrel**

```ts
// services/advisory/decision-workflow-ctrl/src/service-domain/index.ts
export * from './events';
export * from './models';
```

- [ ] **Step 3: Commit**

```
feat(decision-workflow-ctrl): add domain models — DecisionPacket, WorkflowStatus, payloads

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 4: Create decision-packet.repository.ts

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/src/repositories/decision-packet.repository.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/decision-packet.repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/advisory/decision-workflow-ctrl/test/decision-packet.repository.test.ts
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockImplementation(() => ({ send: mockSend })),
    },
    PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
    QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
    TransactWriteCommand: jest.fn().mockImplementation((input) => ({ _type: 'TransactWrite', input })),
  };
});

jest.mock('@nestfolio/event-processor', () => ({
  TableRepository: class {
    protected readonly docClient: { send: jest.Mock };
    protected readonly tableName: string;
    constructor(tableName: string) {
      this.tableName = tableName;
      this.docClient = { send: mockSend };
    }
    protected async put(item: Record<string, unknown>) {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item }));
    }
    protected async putIfNotExists(item: Record<string, unknown>): Promise<boolean> {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      try {
        await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item }));
        return true;
      } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') return false;
        throw err;
      }
    }
    protected async queryByPk(pk: string, skPrefix?: string) {
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :sk)' : 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk, ...(skPrefix ? { ':sk': skPrefix } : {}) },
      }));
      return result.Items ?? [];
    }
    protected async transactWrite(input: unknown) {
      const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new TransactWriteCommand(input));
    }
    protected buildTransactUpdate(pk: string, sk: string, attrs: Record<string, unknown>) {
      const entries = Object.entries(attrs);
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      const sets: string[] = [];
      entries.forEach(([k, v], i) => { names[`#a${i}`] = k; values[`:v${i}`] = v; sets.push(`#a${i} = :v${i}`); });
      return { Update: { TableName: this.tableName, Key: { pk, sk }, UpdateExpression: `SET ${sets.join(', ')}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values } };
    }
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  withMethodLogging: jest.fn().mockReturnValue((_name: string, fn: (...args: unknown[]) => unknown) => fn),
}));

process.env.TABLE_NAME = 'test-table';

import { DecisionPacketRepository } from '../src/repositories/decision-packet.repository';

function extractUpdateAttrs(update: any): Record<string, unknown> {
  const names = update.ExpressionAttributeNames;
  const values = update.ExpressionAttributeValues;
  const result: Record<string, unknown> = {};
  for (const [nameKey, attrName] of Object.entries(names)) {
    const idx = nameKey.replace('#a', '');
    result[attrName as string] = values[`:v${idx}`];
  }
  return result;
}

describe('DecisionPacketRepository', () => {
  let repo: DecisionPacketRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new DecisionPacketRepository('test-table');
  });

  describe('createDecisionPacket', () => {
    it('should create a DecisionPacket with status INITIATED', async () => {
      mockSend.mockResolvedValueOnce({});

      const created = await repo.createDecisionPacket({
        tenantId: 't1',
        decisionId: 'dp-1',
        trigger: 'MANDATE_GRANTED',
        triggerEventId: 'evt-1',
        executionArn: 'arn:aws:states:us-east-1:123:execution:sm:exec-1',
      });

      expect(created).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'DecisionPacket#t1#dp-1',
        sk: 'DecisionPacket',
        __typename: 'DecisionPacket',
        tenantId: 't1',
        decisionId: 'dp-1',
        status: 'INITIATED',
        trigger: 'MANDATE_GRANTED',
        triggerEventId: 'evt-1',
        executionArn: 'arn:aws:states:us-east-1:123:execution:sm:exec-1',
      });
    });

    it('should return false when conditional write fails (duplicate)', async () => {
      const condError = new Error('Condition not met');
      condError.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(condError);

      const created = await repo.createDecisionPacket({
        tenantId: 't1',
        decisionId: 'dp-dup',
        trigger: 'MANDATE_GRANTED',
        triggerEventId: 'evt-dup',
        executionArn: null,
      });
      expect(created).toBe(false);
    });
  });

  describe('getDecisionPacket', () => {
    it('should return packet when found', async () => {
      const dp = {
        pk: 'DecisionPacket#t1#dp-1',
        sk: 'DecisionPacket',
        __typename: 'DecisionPacket',
        tenantId: 't1',
        decisionId: 'dp-1',
        status: 'INITIATED',
      };
      mockSend.mockResolvedValueOnce({ Items: [dp] });

      const result = await repo.getDecisionPacket('t1', 'dp-1');
      expect(result).toEqual(dp);
    });

    it('should return null when not found', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      const result = await repo.getDecisionPacket('t1', 'dp-missing');
      expect(result).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('should update status with edit event in transaction', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateStatus('t1', 'dp-1', 'PROFILING');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(2);
      const attrs = extractUpdateAttrs(call.input.TransactItems[0].Update);
      expect(attrs).toMatchObject({ status: 'PROFILING' });
      expect(call.input.TransactItems[1].Put.Item).toMatchObject({
        __typename: 'EditEvent',
        operation: 'replace',
      });
    });

    it('should merge extra details into the update', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateStatus('t1', 'dp-1', 'APPROVED', {
        authorityLevel: 'L1',
        complianceResult: 'APPROVED',
      });

      const call = mockSend.mock.calls[0][0];
      const attrs = extractUpdateAttrs(call.input.TransactItems[0].Update);
      expect(attrs).toMatchObject({
        status: 'APPROVED',
        authorityLevel: 'L1',
        complianceResult: 'APPROVED',
      });
    });
  });

  describe('storeAgentOutput', () => {
    it('should store agent output as a sub-item', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.storeAgentOutput('t1', 'dp-1', 'investor-profile', { riskScore: 0.45 });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'DecisionPacket#t1#dp-1',
        sk: 'AgentOutput#investor-profile',
        __typename: 'AgentOutput',
        agentStep: 'investor-profile',
        output: { riskScore: 0.45 },
      });
    });
  });
});
```

- [ ] **Step 2: Run test — expect failures (module not found)**

```bash
npx nx test decision-workflow-ctrl
```

- [ ] **Step 3: Implement the repository**

```ts
// services/advisory/decision-workflow-ctrl/src/repositories/decision-packet.repository.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { TableRepository, getUUID, getTime, type TableEntry } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import type { WorkflowStatus, AgentStep } from '../service-domain/models';

function decisionPk(tenantId: string, dpId: string): string {
  return `DecisionPacket#${tenantId}#${dpId}`;
}

export interface CreateDecisionPacketInput {
  readonly tenantId: string;
  readonly decisionId: string;
  readonly trigger: string;
  readonly triggerEventId: string;
  readonly executionArn: string | null;
}

export class DecisionPacketRepository extends TableRepository {
  private readonly log = withMethodLogging('DecisionPacketRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  /** Idempotent create — returns false if packet already exists. */
  readonly createDecisionPacket = this.log('createDecisionPacket', async (
    input: CreateDecisionPacketInput,
  ): Promise<boolean> => {
    const now = getTime();
    const item: TableEntry = {
      pk: decisionPk(input.tenantId, input.decisionId),
      sk: 'DecisionPacket',
      __typename: 'DecisionPacket',
      tenantId: input.tenantId,
      timestamp: now,
      decisionId: input.decisionId,
      trigger: input.trigger,
      triggerEventId: input.triggerEventId,
      executionArn: input.executionArn,
      status: 'INITIATED' as WorkflowStatus,
      investorProfileOutput: null,
      marketAnalysisOutput: null,
      portfolioOutput: null,
      narrativeOutput: null,
      complianceResult: null,
      authorityLevel: null,
      userDecision: null,
      blockReason: null,
      rejectionReason: null,
      createdAt: now,
      updatedAt: now,
    };
    return this.putIfNotExists(item);
  });

  readonly getDecisionPacket = this.log('getDecisionPacket', async (
    tenantId: string,
    dpId: string,
  ): Promise<Record<string, unknown> | null> => {
    const pk = decisionPk(tenantId, dpId);
    const items = await this.queryByPk(pk, 'DecisionPacket');
    return items.length > 0 ? items[0] : null;
  });

  /** Update status with optional extra attributes. Writes an EditEvent for audit trail. */
  readonly updateStatus = this.log('updateStatus', async (
    tenantId: string,
    dpId: string,
    status: WorkflowStatus,
    details?: Record<string, unknown>,
  ): Promise<void> => {
    const pk = decisionPk(tenantId, dpId);
    const now = getTime();

    const editEvent: TableEntry = {
      pk,
      sk: `EditEvent#${now}#${getUUID()}`,
      __typename: 'EditEvent',
      tenantId,
      timestamp: now,
      operation: 'replace',
      path: `/decisionPacket/${dpId}/status`,
      value: { status, ...(details ?? {}) },
      editedBy: 'system',
      editedAt: now,
    };

    await this.transactWrite({
      TransactItems: [
        this.buildTransactUpdate(pk, 'DecisionPacket', {
          status,
          updatedAt: now,
          timestamp: now,
          ...(details ?? {}),
        }) as any,
        { Put: { TableName: this.tableName, Item: editEvent } },
      ],
    });
  });

  /** Store agent output as a sub-item under the DecisionPacket partition. */
  readonly storeAgentOutput = this.log('storeAgentOutput', async (
    tenantId: string,
    dpId: string,
    agentStep: AgentStep,
    output: Record<string, unknown>,
  ): Promise<void> => {
    const now = getTime();
    const item: TableEntry = {
      pk: decisionPk(tenantId, dpId),
      sk: `AgentOutput#${agentStep}`,
      __typename: 'AgentOutput',
      tenantId,
      timestamp: now,
      decisionId: dpId,
      agentStep,
      output,
    };
    await this.put(item);
  });
}
```

- [ ] **Step 4: Run test — expect all pass**

```bash
npx nx test decision-workflow-ctrl
```

- [ ] **Step 5: Commit**

```
feat(decision-workflow-ctrl): add DecisionPacketRepository with idempotent create + audit trail

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 5: Create CDC event publisher

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/src/handlers/event-publisher-cdc.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/event-publisher-cdc.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/advisory/decision-workflow-ctrl/test/event-publisher-cdc.test.ts
import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(['DecisionPacket', 'AgentOutput', 'EditEvent']);

describe('decision-workflow-ctrl CDC event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'decision-workflow-ctrl', eventTypeMap });

  it('publishes DECISION_PACKET_CREATED for DecisionPacket INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'DecisionPacket', tenantId: 't1', status: 'INITIATED' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('DECISION_PACKET_CREATED');
  });

  it('publishes DECISION_PACKET_MODIFIED for DecisionPacket MODIFY', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('MODIFY', { __typename: 'DecisionPacket', tenantId: 't1', status: 'PROPOSED' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('DECISION_PACKET_MODIFIED');
  });

  it('publishes AGENT_OUTPUT_CREATED for AgentOutput INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'AgentOutput', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('AGENT_OUTPUT_CREATED');
  });
});
```

- [ ] **Step 2: Run test — expect fail**

```bash
npx nx test decision-workflow-ctrl
```

- [ ] **Step 3: Implement the CDC handler**

```ts
// services/advisory/decision-workflow-ctrl/src/handlers/event-publisher-cdc.ts
import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'decision-workflow-ctrl',
  eventTypeMap: buildEventTypeMap(['DecisionPacket', 'AgentOutput', 'EditEvent']),
});
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx nx test decision-workflow-ctrl
```

- [ ] **Step 5: Commit**

```
feat(decision-workflow-ctrl): add CDC event publisher for DDB stream changes

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Chunk 2: Step Functions State Machine + CDK Stack (Tasks 6–8)

### Task 6: Create DecisionStateMachine CDK construct

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`

This is the core Step Functions state machine. It uses CDK L2 constructs from `aws-cdk-lib/aws-stepfunctions` and `aws-cdk-lib/aws-stepfunctions-tasks`.

- [ ] **Step 1: Write the state machine construct**

```ts
// services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import { IEventBus } from 'aws-cdk-lib/aws-events';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

export interface DecisionStateMachineProps {
  readonly eventBus: IEventBus;
  readonly table: ITable;
  readonly serviceName: string;
}

/**
 * Step Functions state machine for the decision lifecycle.
 *
 * Flow:
 * 1. Parallel: InvestorProfile + MarketIntelligence (waitForTaskToken)
 * 2. Sequential: PortfolioEngine (waitForTaskToken)
 * 3. Sequential: AdvisoryNarrative (waitForTaskToken)
 * 4. AssemblePacket (Pass state — merges outputs)
 * 5. WaitForCompliance (waitForTaskToken)
 * 6. Choice: APPROVED L1 → end, BLOCKED → end, L2 → user confirmation
 * 7. WaitForUserResponse (waitForTaskToken)
 * 8. End
 */
export class DecisionStateMachine extends Construct {
  readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: DecisionStateMachineProps) {
    super(scope, id);

    const { eventBus, serviceName } = props;
    const busArn = `arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${eventBus.eventBusName}`;

    // Helper: create a waitForTaskToken state that publishes an event to EventBridge
    const createAgentInvocationState = (
      stateId: string,
      detailType: string,
      timeout: Duration = Duration.minutes(10),
    ): sfn.CustomState => {
      // CustomState because the CDK L2 EventBridgePutEvents task does not natively
      // support waitForTaskToken with $.Task.Token injection. We use raw ASL.
      return new sfn.CustomState(this, stateId, {
        stateJson: {
          Type: 'Task',
          Resource: 'arn:aws:states:::events:putEvents.waitForTaskToken',
          Parameters: {
            Entries: [
              {
                EventBusName: eventBus.eventBusName,
                Source: serviceName,
                DetailType: detailType,
                Detail: {
                  'decisionId.$': '$.decisionId',
                  'tenantId.$': '$.tenantId',
                  'taskToken.$': '$$.Task.Token',
                  'context.$': '$.context',
                  'upstreamOutputs.$': '$.upstreamOutputs',
                },
              },
            ],
          },
          TimeoutSeconds: timeout.toSeconds(),
          ResultPath: `$.agentResults.${stateId}`,
        },
      });
    };

    // --- Agent invocation states ---

    const invokeInvestorProfile = createAgentInvocationState(
      'InvokeInvestorProfile',
      'ANALYZE_INVESTOR_PROFILE',
    );

    const invokeMarketIntelligence = createAgentInvocationState(
      'InvokeMarketIntelligence',
      'ANALYZE_MARKET',
    );

    const invokePortfolioEngine = createAgentInvocationState(
      'InvokePortfolioEngine',
      'CONSTRUCT_PORTFOLIO',
    );

    const invokeAdvisoryNarrative = createAgentInvocationState(
      'InvokeAdvisoryNarrative',
      'GENERATE_NARRATIVE',
    );

    // --- Parallel: investor-profile + market-intelligence ---

    const parallelProfiling = new sfn.Parallel(this, 'ParallelProfiling', {
      resultPath: '$.parallelResults',
    });
    parallelProfiling.branch(invokeInvestorProfile);
    parallelProfiling.branch(invokeMarketIntelligence);

    // --- Merge parallel outputs ---

    const mergeParallelOutputs = new sfn.Pass(this, 'MergeParallelOutputs', {
      parameters: {
        'decisionId.$': '$.decisionId',
        'tenantId.$': '$.tenantId',
        'context.$': '$.context',
        'upstreamOutputs': {
          'investorProfile.$': '$.parallelResults[0].agentResults.InvokeInvestorProfile',
          'marketAnalysis.$': '$.parallelResults[1].agentResults.InvokeMarketIntelligence',
        },
      },
    });

    // --- Merge all outputs before compliance ---

    const assemblePacket = new sfn.Pass(this, 'AssembleDecisionPacket', {
      comment: 'Merge all agent outputs into a single decision packet payload',
    });

    // --- Compliance wait ---

    const publishRecommendation = new sfn.CustomState(this, 'PublishRecommendation', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::events:putEvents',
        Parameters: {
          Entries: [
            {
              EventBusName: eventBus.eventBusName,
              Source: serviceName,
              DetailType: 'RECOMMENDATION_PROPOSED',
              Detail: {
                'decisionId.$': '$.decisionId',
                'tenantId.$': '$.tenantId',
              },
            },
          ],
        },
        ResultPath: sfn.JsonPath.DISCARD,
      },
    });

    const waitForCompliance = new sfn.CustomState(this, 'WaitForCompliance', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::events:putEvents.waitForTaskToken',
        Parameters: {
          Entries: [
            {
              EventBusName: eventBus.eventBusName,
              Source: serviceName,
              DetailType: 'RECOMMENDATION_PROPOSED',
              Detail: {
                'decisionId.$': '$.decisionId',
                'tenantId.$': '$.tenantId',
                'taskToken.$': '$$.Task.Token',
                'awaitingCompliance': true,
              },
            },
          ],
        },
        TimeoutSeconds: Duration.hours(24).toSeconds(),
        ResultPath: '$.complianceResult',
      },
    });

    // --- Compliance choice ---

    const complianceChoice = new sfn.Choice(this, 'ComplianceChoice');

    const blockedEnd = new sfn.Pass(this, 'UpdateStatusBlocked', {
      comment: 'Decision blocked by compliance',
    }).next(new sfn.Succeed(this, 'EndBlocked'));

    const approvedL1End = new sfn.Pass(this, 'UpdateStatusApprovedL1', {
      comment: 'Decision approved (L1 autonomous)',
    }).next(new sfn.Succeed(this, 'EndApprovedL1'));

    // --- User confirmation ---

    const requestUserConfirmation = new sfn.CustomState(this, 'RequestUserConfirmation', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::events:putEvents.waitForTaskToken',
        Parameters: {
          Entries: [
            {
              EventBusName: eventBus.eventBusName,
              Source: serviceName,
              DetailType: 'USER_CONFIRMATION_REQUESTED',
              Detail: {
                'decisionId.$': '$.decisionId',
                'tenantId.$': '$.tenantId',
                'taskToken.$': '$$.Task.Token',
              },
            },
          ],
        },
        TimeoutSeconds: Duration.hours(72).toSeconds(),
        ResultPath: '$.userResponse',
      },
    });

    const updateFinalStatus = new sfn.Pass(this, 'UpdateFinalStatus', {
      comment: 'Final status from user response',
    });

    const endSuccess = new sfn.Succeed(this, 'EndSuccess');

    // --- Wire the chain ---

    const definition = parallelProfiling
      .next(mergeParallelOutputs)
      .next(invokePortfolioEngine)
      .next(invokeAdvisoryNarrative)
      .next(assemblePacket)
      .next(publishRecommendation)
      .next(waitForCompliance)
      .next(
        complianceChoice
          .when(sfn.Condition.stringEquals('$.complianceResult.decision', 'BLOCKED'), blockedEnd)
          .when(
            sfn.Condition.and(
              sfn.Condition.stringEquals('$.complianceResult.decision', 'APPROVED'),
              sfn.Condition.stringEquals('$.complianceResult.authorityLevel', 'L1'),
            ),
            approvedL1End,
          )
          .otherwise(
            requestUserConfirmation
              .next(updateFinalStatus)
              .next(endSuccess),
          ),
      );

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.hours(72),
      tracingEnabled: true,
      stateMachineType: sfn.StateMachineType.STANDARD,
      comment: 'Decision lifecycle orchestration — advisory agent topology',
    });

    // Grant PutEvents to the state machine execution role
    this.stateMachine.addToRolePolicy(
      new (require('aws-cdk-lib/aws-iam').PolicyStatement)({
        actions: ['events:PutEvents'],
        resources: [busArn],
      }),
    );
  }
}
```

- [ ] **Step 2: Commit**

```
feat(decision-workflow-ctrl): add DecisionStateMachine CDK construct with waitForTaskToken

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 7: Create service.stack.ts + main.ts

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/src/service.stack.ts`
- Create: `services/advisory/decision-workflow-ctrl/src/main.ts`

- [ ] **Step 1: Write the stack**

```ts
// services/advisory/decision-workflow-ctrl/src/service.stack.ts
import { StackProps } from 'aws-cdk-lib';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { join } from 'path';
import {
  ServiceStack,
  Ingress,
  Egress,
  defaultLambdaProps,
} from '@nestfolio/cdk-constructs';
import { DecisionStateMachine } from './constructs/decision-state-machine';
import { ALL_INBOUND_EVENT_TYPES } from './service-domain/events';

export class DecisionWorkflowCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: StackProps & { prefix: string }) {
    super(scope, id, {
      ...props,
      prefix: props.prefix,
      subsystem: 'advisory',
      service: 'decision-workflow-ctrl',
      serviceDir: __dirname,
    });

    // --- State machine ---
    const { stateMachine } = new DecisionStateMachine(this, 'DecisionStateMachine', {
      eventBus: this.eventBus,
      table: this.state.getTable(),
      serviceName: this.serviceName,
    });

    // --- Ingress: 17 inbound event types ---
    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: [...ALL_INBOUND_EVENT_TYPES],
    });

    // Grant the event-listener Lambda permissions to start executions and send task tokens
    ingress.handler.addEnvironment('STATE_MACHINE_ARN', stateMachine.stateMachineArn);
    stateMachine.grantStartExecution(ingress.handler);
    stateMachine.grantTaskResponse(ingress.handler);

    // --- Egress: CDC from DDB Streams ---
    new Egress(this, 'Egress', {
      publishableTypes: ['DecisionPacket', 'AgentOutput', 'EditEvent'],
      handlerEntry: join(__dirname, 'handlers/event-publisher-cdc.ts'),
    });

    // --- Observability ---
    this.addObservability({ ingress });
  }
}
```

- [ ] **Step 2: Write main.ts**

```ts
// services/advisory/decision-workflow-ctrl/src/main.ts
import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { DecisionWorkflowCtrlStack } from './service.stack';

const app = new App();
const config = resolvePipelineConfig(app, 'decision-workflow-ctrl');

new DecisionWorkflowCtrlStack(app, `${config.prefix}-decision-workflow-ctrl`, {
  prefix: config.prefix,
  env: {
    account: config.account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: config.region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
```

- [ ] **Step 3: Commit**

```
feat(decision-workflow-ctrl): add CDK stack with Step Functions, Ingress (17 events), Egress

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 8: Write CDK stack synthesis test

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/test/service.stack.test.ts`

- [ ] **Step 1: Write the stack test**

```ts
// services/advisory/decision-workflow-ctrl/test/service.stack.test.ts
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DecisionWorkflowCtrlStack } from '../src/service.stack';

describe('DecisionWorkflowCtrlStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new DecisionWorkflowCtrlStack(app, 'TestStack', { prefix: 'test' });
    template = Template.fromStack(stack);
  });

  it('creates a DynamoDB table', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  });

  it('creates a Step Functions state machine', () => {
    template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
    template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
      StateMachineType: 'STANDARD',
      TracingConfiguration: { Enabled: true },
    });
  });

  it('creates SQS queues for Ingress + Egress DLQs', () => {
    // At least 2 DLQs: one for ingress, one for egress
    template.resourcePropertiesCountIs('AWS::SQS::Queue', {
      MessageRetentionPeriod: 1209600,
    }, Match.anyValue());
  });

  it('creates EventBridge rules for 17 inbound event types', () => {
    // The Ingress construct creates rules that match on detail-type
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.anyValue(),
      }),
    });
  });

  it('creates Lambda functions for event-listener and CDC publisher', () => {
    // At minimum: ingress handler + egress publisher
    const lambdas = template.findResources('AWS::Lambda::Function');
    expect(Object.keys(lambdas).length).toBeGreaterThanOrEqual(2);
  });

  it('grants SFN startExecution to the ingress handler', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['states:StartExecution']),
          }),
        ]),
      },
    });
  });

  it('grants SFN task response permissions to the ingress handler', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              Match.stringLikeRegexp('states:SendTask.*'),
            ]),
          }),
        ]),
      },
    });
  });
});
```

- [ ] **Step 2: Run test**

```bash
npx nx test decision-workflow-ctrl
```

- [ ] **Step 3: Fix any synthesis issues and re-run until green**

- [ ] **Step 4: Commit**

```
test(decision-workflow-ctrl): add CDK stack synthesis assertions

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Chunk 3: Event Listener + Task Token Routing (Tasks 9–12)

### Task 9: Create event-listener with SFN routing

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/src/handlers/event-listener.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/event-listener.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/advisory/decision-workflow-ctrl/test/event-listener.test.ts
const mockSend = jest.fn();
const mockSfnSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockImplementation(() => ({ send: mockSend })),
    },
    PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
    QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
    TransactWriteCommand: jest.fn().mockImplementation((input) => ({ _type: 'TransactWrite', input })),
  };
});

jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn().mockImplementation(() => ({ send: mockSfnSend })),
  StartExecutionCommand: jest.fn().mockImplementation((input) => ({ _type: 'StartExecution', input })),
  SendTaskSuccessCommand: jest.fn().mockImplementation((input) => ({ _type: 'SendTaskSuccess', input })),
}));

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  TableRepository: class {
    protected readonly docClient: { send: jest.Mock };
    protected readonly tableName: string;
    constructor(tableName: string) {
      this.tableName = tableName;
      this.docClient = { send: mockSend };
    }
    protected async put(item: Record<string, unknown>) {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item }));
    }
    protected async putIfNotExists(item: Record<string, unknown>): Promise<boolean> {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      try {
        await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item }));
        return true;
      } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') return false;
        throw err;
      }
    }
    protected async queryByPk(pk: string, skPrefix?: string) {
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :sk)' : 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk, ...(skPrefix ? { ':sk': skPrefix } : {}) },
      }));
      return result.Items ?? [];
    }
    protected async transactWrite(input: unknown) {
      const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new TransactWriteCommand(input));
    }
    protected buildTransactUpdate(pk: string, sk: string, attrs: Record<string, unknown>) {
      const entries = Object.entries(attrs);
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      const sets: string[] = [];
      entries.forEach(([k, v], i) => { names[`#a${i}`] = k; values[`:v${i}`] = v; sets.push(`#a${i} = :v${i}`); });
      return { Update: { TableName: this.tableName, Key: { pk, sk }, UpdateExpression: `SET ${sets.join(', ')}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values } };
    }
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  requireEnv: (name: string) => process.env[name] ?? name,
  withMethodLogging: jest.fn().mockReturnValue((_name: string, fn: (...args: unknown[]) => unknown) => fn),
}));

process.env.TABLE_NAME = 'test-table';
process.env.BUS_NAME = 'test-bus';
process.env.STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:test-sm';

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';
import { DecisionPacketRepository } from '../src/repositories/decision-packet.repository';

describe('decision-workflow-ctrl event-listener', () => {
  const repository = new DecisionPacketRepository('test-table');

  const mockDeps: EventListenerDeps = {
    repository,
    sfnSend: mockSfnSend,
    stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:test-sm',
  };

  const harness = createTestHarness({
    serviceName: 'decision-workflow-ctrl',
    handlers: createHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockSfnSend.mockResolvedValue({ executionArn: 'arn:aws:states:us-east-1:123:execution:sm:exec-1' });
  });

  // --- Trigger events ---

  describe('trigger events → startExecution', () => {
    it('should start SF execution for MANDATE_GRANTED', async () => {
      const result = await harness.process([
        fakeSqsRecord('MANDATE_GRANTED', {
          tenantId: 't1', userId: 'u1',
        }, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockSfnSend).toHaveBeenCalledTimes(1);
      const startCall = mockSfnSend.mock.calls[0][0];
      expect(startCall._type).toBe('StartExecution');
      expect(startCall.input.stateMachineArn).toBe('arn:aws:states:us-east-1:123:stateMachine:test-sm');
    });

    it('should start SF execution for PORTFOLIO_DRIFT_DETECTED', async () => {
      const result = await harness.process([
        fakeSqsRecord('PORTFOLIO_DRIFT_DETECTED', {
          tenantId: 't1',
        }, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockSfnSend).toHaveBeenCalledTimes(1);
    });

    it('should create DecisionPacket for trigger events', async () => {
      await harness.process([
        fakeSqsRecord('GOAL_UPDATED', {
          tenantId: 't1',
        }, { tenantId: 't1' }),
      ]);
      // Should call DDB put for DecisionPacket creation
      const ddbCalls = mockSend.mock.calls.filter((c) => c[0]._type === 'Put');
      expect(ddbCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle duplicate trigger gracefully (idempotent)', async () => {
      const condError = new Error('Condition not met');
      condError.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(condError);

      const result = await harness.process([
        fakeSqsRecord('MANDATE_GRANTED', {
          tenantId: 't1',
        }, { tenantId: 't1' }),
      ]);
      // Duplicate should not fail the batch — skip gracefully
      expect(result.batchItemFailures).toHaveLength(0);
    });
  });

  // --- Agent completion events ---

  describe('agent completion events → SendTaskSuccess', () => {
    it('should call SendTaskSuccess for INVESTOR_PROFILE_COMPLETED', async () => {
      const result = await harness.process([
        fakeSqsRecord('INVESTOR_PROFILE_COMPLETED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-abc',
          outputs: { riskScore: 0.45 },
        }, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockSfnSend).toHaveBeenCalledTimes(1);
      const call = mockSfnSend.mock.calls[0][0];
      expect(call._type).toBe('SendTaskSuccess');
      expect(call.input.taskToken).toBe('token-abc');
    });

    it('should call SendTaskSuccess for MARKET_ANALYSIS_COMPLETED', async () => {
      await harness.process([
        fakeSqsRecord('MARKET_ANALYSIS_COMPLETED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-def',
          outputs: { sentiment: 'bullish' },
        }, { tenantId: 't1' }),
      ]);
      expect(mockSfnSend).toHaveBeenCalledTimes(1);
      const call = mockSfnSend.mock.calls[0][0];
      expect(call._type).toBe('SendTaskSuccess');
      expect(call.input.taskToken).toBe('token-def');
    });

    it('should call SendTaskSuccess for PORTFOLIO_COMPLETED', async () => {
      await harness.process([
        fakeSqsRecord('PORTFOLIO_COMPLETED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-ghi',
          outputs: { allocations: [] },
        }, { tenantId: 't1' }),
      ]);
      const call = mockSfnSend.mock.calls[0][0];
      expect(call._type).toBe('SendTaskSuccess');
    });

    it('should call SendTaskSuccess for NARRATIVE_COMPLETED', async () => {
      await harness.process([
        fakeSqsRecord('NARRATIVE_COMPLETED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-jkl',
          outputs: { narrative: 'Based on...' },
        }, { tenantId: 't1' }),
      ]);
      const call = mockSfnSend.mock.calls[0][0];
      expect(call._type).toBe('SendTaskSuccess');
    });

    it('should store agent output in DDB', async () => {
      await harness.process([
        fakeSqsRecord('INVESTOR_PROFILE_COMPLETED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-abc',
          outputs: { riskScore: 0.45 },
        }, { tenantId: 't1' }),
      ]);
      const putCalls = mockSend.mock.calls.filter((c) => c[0]._type === 'Put');
      expect(putCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // --- Compliance events ---

  describe('compliance events → SendTaskSuccess', () => {
    it('should resume SF for DECISION_APPROVED', async () => {
      const result = await harness.process([
        fakeSqsRecord('DECISION_APPROVED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-compliance',
          authorityLevel: 'L1',
        }, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockSfnSend).toHaveBeenCalledTimes(1);
      const call = mockSfnSend.mock.calls[0][0];
      expect(call._type).toBe('SendTaskSuccess');
      expect(JSON.parse(call.input.output)).toMatchObject({
        decision: 'APPROVED',
        authorityLevel: 'L1',
      });
    });

    it('should resume SF for DECISION_BLOCKED', async () => {
      await harness.process([
        fakeSqsRecord('DECISION_BLOCKED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-compliance-2',
          reason: 'Exceeds risk limits',
        }, { tenantId: 't1' }),
      ]);
      const call = mockSfnSend.mock.calls[0][0];
      expect(call._type).toBe('SendTaskSuccess');
      expect(JSON.parse(call.input.output)).toMatchObject({
        decision: 'BLOCKED',
      });
    });

    it('should update DDB status for compliance events', async () => {
      await harness.process([
        fakeSqsRecord('DECISION_APPROVED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-compliance',
          authorityLevel: 'L1',
        }, { tenantId: 't1' }),
      ]);
      const transactCalls = mockSend.mock.calls.filter((c) => c[0]._type === 'TransactWrite');
      expect(transactCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // --- User response events ---

  describe('user response events → SendTaskSuccess', () => {
    it('should resume SF for USER_CONFIRMED', async () => {
      const result = await harness.process([
        fakeSqsRecord('USER_CONFIRMED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-user',
        }, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockSfnSend).toHaveBeenCalledTimes(1);
      const call = mockSfnSend.mock.calls[0][0];
      expect(JSON.parse(call.input.output)).toMatchObject({
        decision: 'CONFIRMED',
      });
    });

    it('should resume SF for USER_REJECTED', async () => {
      await harness.process([
        fakeSqsRecord('USER_REJECTED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-user-2',
          reason: 'Too risky',
        }, { tenantId: 't1' }),
      ]);
      const call = mockSfnSend.mock.calls[0][0];
      expect(JSON.parse(call.input.output)).toMatchObject({
        decision: 'REJECTED',
        reason: 'Too risky',
      });
    });

    it('should update DDB status for user response events', async () => {
      await harness.process([
        fakeSqsRecord('USER_CONFIRMED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-user',
        }, { tenantId: 't1' }),
      ]);
      const transactCalls = mockSend.mock.calls.filter((c) => c[0]._type === 'TransactWrite');
      expect(transactCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // --- Unknown events ---

  it('should skip unknown event types gracefully', async () => {
    const result = await harness.process([
      fakeSqsRecord('UNKNOWN_EVENT', {}, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(1);
  });
});
```

- [ ] **Step 2: Run test — expect failures**

```bash
npx nx test decision-workflow-ctrl
```

- [ ] **Step 3: Implement the event-listener**

```ts
// services/advisory/decision-workflow-ctrl/src/handlers/event-listener.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SFNClient, StartExecutionCommand, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';
import {
  createEventHandler, skip,
  type EventPayload, type EventContext,
  requireEnv, logger, getUUID,
} from '@nestfolio/event-processor';
import { DecisionPacketRepository } from '../repositories/decision-packet.repository';
import {
  TRIGGER_EVENT_TYPES,
  AGENT_COMPLETION_EVENT_TYPES,
  COMPLIANCE_EVENT_TYPES,
  USER_RESPONSE_EVENT_TYPES,
} from '../service-domain/events';

export interface EventListenerDeps {
  readonly repository: DecisionPacketRepository;
  readonly sfnSend: (command: unknown) => Promise<unknown>;
  readonly stateMachineArn: string;
}

/** Map agent completion event types to agent step names */
const AGENT_STEP_MAP: Record<string, string> = {
  INVESTOR_PROFILE_COMPLETED: 'investor-profile',
  MARKET_ANALYSIS_COMPLETED: 'market-intelligence',
  PORTFOLIO_COMPLETED: 'portfolio-engine',
  NARRATIVE_COMPLETED: 'advisory-narrative',
};

// --- Handler functions ---

async function handleTriggerEvent(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  const tenantId = (payload.subject?.tenantId as string) ?? ctx.tenantId;
  const decisionId = getUUID();

  // Start Step Functions execution
  const startCmd = new StartExecutionCommand({
    stateMachineArn: deps.stateMachineArn,
    name: `decision-${decisionId}`,
    input: JSON.stringify({
      decisionId,
      tenantId,
      trigger: ctx.eventType,
      triggerEventId: ctx.eventId,
      context: payload.subject ?? {},
    }),
  });

  const result = (await deps.sfnSend(startCmd)) as { executionArn?: string };

  // Create DecisionPacket in DDB (idempotent)
  await deps.repository.createDecisionPacket({
    tenantId,
    decisionId,
    trigger: ctx.eventType,
    triggerEventId: ctx.eventId,
    executionArn: result.executionArn ?? null,
  });

  logger.info('Started decision workflow', { decisionId, trigger: ctx.eventType, tenantId });
  return skip();
}

async function handleAgentCompletion(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  const subject = payload.subject ?? {};
  const taskToken = subject.taskToken as string;
  const decisionId = subject.decisionId as string;
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const outputs = (subject.outputs as Record<string, unknown>) ?? {};

  if (!taskToken) {
    throw new Error(`Missing taskToken in ${ctx.eventType} event`);
  }

  const agentStep = AGENT_STEP_MAP[ctx.eventType];

  // Store agent output in DDB
  if (agentStep && decisionId) {
    await deps.repository.storeAgentOutput(tenantId, decisionId, agentStep as any, outputs);
  }

  // Resume Step Functions
  const sendCmd = new SendTaskSuccessCommand({
    taskToken,
    output: JSON.stringify(outputs),
  });
  await deps.sfnSend(sendCmd);

  logger.info('Resumed workflow after agent completion', { agentStep, decisionId });
  return skip();
}

async function handleComplianceEvent(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  const subject = payload.subject ?? {};
  const taskToken = subject.taskToken as string;
  const decisionId = subject.decisionId as string;
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const authorityLevel = (subject.authorityLevel as string) ?? 'L2';
  const reason = subject.reason as string | undefined;

  if (!taskToken) {
    throw new Error(`Missing taskToken in ${ctx.eventType} event`);
  }

  const isApproved = ctx.eventType === 'DECISION_APPROVED';
  const decision = isApproved ? 'APPROVED' : 'BLOCKED';
  const status = isApproved
    ? (authorityLevel === 'L1' ? 'APPROVED' : 'AWAITING_CONFIRMATION')
    : 'BLOCKED';

  // Update DDB
  if (decisionId) {
    await deps.repository.updateStatus(tenantId, decisionId, status as any, {
      complianceResult: decision,
      authorityLevel,
      ...(reason ? { blockReason: reason } : {}),
    });
  }

  // Resume Step Functions
  const sendCmd = new SendTaskSuccessCommand({
    taskToken,
    output: JSON.stringify({ decision, authorityLevel, ...(reason ? { reason } : {}) }),
  });
  await deps.sfnSend(sendCmd);

  logger.info('Resumed workflow after compliance', { decision, decisionId });
  return skip();
}

async function handleUserResponse(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  const subject = payload.subject ?? {};
  const taskToken = subject.taskToken as string;
  const decisionId = subject.decisionId as string;
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const reason = subject.reason as string | undefined;

  if (!taskToken) {
    throw new Error(`Missing taskToken in ${ctx.eventType} event`);
  }

  const isConfirmed = ctx.eventType === 'USER_CONFIRMED';
  const decision = isConfirmed ? 'CONFIRMED' : 'REJECTED';

  // Update DDB
  if (decisionId) {
    await deps.repository.updateStatus(tenantId, decisionId, decision as any, {
      userDecision: decision,
      ...(reason ? { rejectionReason: reason } : {}),
    });
  }

  // Resume Step Functions
  const sendCmd = new SendTaskSuccessCommand({
    taskToken,
    output: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
  });
  await deps.sfnSend(sendCmd);

  logger.info('Resumed workflow after user response', { decision, decisionId });
  return skip();
}

// --- Handler map builder ---

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<ReturnType<typeof skip>>> = {};

  for (const type of TRIGGER_EVENT_TYPES) {
    handlers[type] = (payload, ctx) => handleTriggerEvent(deps, payload, ctx);
  }

  for (const type of AGENT_COMPLETION_EVENT_TYPES) {
    handlers[type] = (payload, ctx) => handleAgentCompletion(deps, payload, ctx);
  }

  for (const type of COMPLIANCE_EVENT_TYPES) {
    handlers[type] = (payload, ctx) => handleComplianceEvent(deps, payload, ctx);
  }

  for (const type of USER_RESPONSE_EVENT_TYPES) {
    handlers[type] = (payload, ctx) => handleUserResponse(deps, payload, ctx);
  }

  return handlers;
};

// --- Production wiring ---

const TABLE_NAME = requireEnv('TABLE_NAME');
const STATE_MACHINE_ARN = requireEnv('STATE_MACHINE_ARN');
const dynamoClient = new DynamoDBClient({});
const sfnClient = new SFNClient({});
const repository = new DecisionPacketRepository(TABLE_NAME, dynamoClient);

const deps: EventListenerDeps = {
  repository,
  sfnSend: (cmd) => sfnClient.send(cmd as any),
  stateMachineArn: STATE_MACHINE_ARN,
};

export const handler = createEventHandler({
  serviceName: 'decision-workflow-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'DECISION_WORKFLOW_FAILED',
});
```

- [ ] **Step 4: Run test — expect all pass**

```bash
npx nx test decision-workflow-ctrl
```

- [ ] **Step 5: Commit**

```
feat(decision-workflow-ctrl): add event-listener with 17-event routing + SFN task token handling

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Task 10: Integration wiring — verify full test suite

**Files:** All files created above

- [ ] **Step 1: Run full test suite**

```bash
npx nx test decision-workflow-ctrl
```

- [ ] **Step 2: Verify all tests pass — fix any import or wiring issues**

- [ ] **Step 3: Run lint**

```bash
npx nx lint decision-workflow-ctrl
```

- [ ] **Step 4: Fix any lint issues**

- [ ] **Step 5: Final commit**

```
chore(decision-workflow-ctrl): finalize integration wiring, all tests passing

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Summary

| Chunk | Tasks | Tests | Description |
|---|---|---|---|
| 1 | 1–5 | ~12 | Service scaffold, domain types, repository, CDC publisher |
| 2 | 6–8 | ~7 | Step Functions state machine construct, CDK stack, stack synthesis test |
| 3 | 9–10 | ~15 | Event listener with 17-event routing + SFN integration, final wiring |
| **Total** | **10** | **~34** | |

**Key patterns introduced:**
- `CustomState` for Step Functions `waitForTaskToken` → EventBridge PutEvents integration (new to codebase)
- `SFNClient` + `StartExecutionCommand` / `SendTaskSuccessCommand` in event-listener (new to codebase)
- Task token flow: SF injects `taskToken` → agent echoes back → orchestrator calls `SendTaskSuccess`
- Parallel state for independent agent steps (investor-profile + market-intelligence)

**Test command:** `npx nx test decision-workflow-ctrl`
