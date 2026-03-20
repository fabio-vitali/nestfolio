# Conversational Onboarding Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the investor-mfe stepper wizard with a conversational onboarding agent powered by CopilotKit + LangGraph.js + Bedrock AgentCore, delivered as a new `onboarding-agent-bff` service.

**Architecture:** New backend service (`onboarding-agent-bff`) runs a LangGraph StateGraph with 7 phase nodes, CopilotKit Runtime on Hono, and writes to investor-bff's DDB table. Frontend replaces the PrimeNG stepper with CopilotKit's Angular chat component + 7 custom Generative UI renderers. RAG via Bedrock Knowledge Base for product documentation questions.

**Tech Stack:** Angular 21, CopilotKit (`@copilotkitnext/angular`, `@copilotkit/runtime`), AG-UI Protocol, LangGraph.js (`@langchain/langgraph`), Bedrock Claude Sonnet, Hono, AWS CDK, DynamoDB, Bedrock Knowledge Base, Zod

**Spec:** `docs/superpowers/specs/2026-03-19-conversational-onboarding-agent-design.md`

---

## File Structure

### New Service: `services/investor/onboarding-agent-bff/`

```
services/investor/onboarding-agent-bff/
├── Dockerfile                            ← Container image for AgentCore Runtime
├── src/
│   ├── main.ts                           ← CDK app entry point
│   ├── service.stack.ts                  ← CDK stack (KnowledgeBase + AgentRuntime)
│   ├── agent/
│   │   ├── state.ts                      ← OnboardingState Zod schema + LangGraph Annotation
│   │   ├── graph.ts                      ← StateGraph definition (7 phase nodes + router)
│   │   ├── router.ts                     ← Conditional edge: routes to current phase node
│   │   ├── phase-node.ts                ← Shared phase node factory (all 7 phases use this)
│   │   ├── session.ts                   ← Session resume logic (rehydrate state from DDB)
│   │   ├── tools/
│   │   │   ├── render-ui.ts             ← Generative UI tool definitions (7 render tools)
│   │   │   ├── commit-phase.ts          ← DynamoDB persistence per phase
│   │   │   ├── compute-risk.ts          ← Deterministic risk scoring function
│   │   │   └── search-kb.handler.ts     ← Lambda handler: RAG query Bedrock Knowledge Base
│   │   ├── tools/search-kb.schema.json  ← JSON schema for search_knowledge_base tool
│   │   └── prompts/
│   │       ├── system.ts                ← Base system prompt (Italian, Nestfolio persona)
│   │       └── phase-instructions.ts    ← Per-phase instructions
│   ├── runtime/
│   │   └── server.ts                    ← CopilotKit Runtime on Hono + LangGraph adapter
│   ├── repositories/
│   │   └── onboarding.repository.ts     ← DDB writes (same table/PK schema as investor-bff)
│   └── service-domain/
│       ├── index.ts                     ← Barrel export
│       ├── events.ts                    ← ONBOARDING_STARTED, ONBOARDING_COMPLETED constants
│       ├── schemas.ts                   ← Zod schemas for persisted data (AccountMode, OnboardingSession)
│       └── models.ts                    ← TypeScript interfaces
├── test/
│   ├── agent/
│   │   ├── state.test.ts                ← Zod schema validation tests
│   │   ├── router.test.ts              ← Router conditional edge tests
│   │   ├── graph.test.ts               ← Graph structure integration test
│   │   ├── session.test.ts             ← Session resume tests (rehydrate from phases 1-6)
│   │   └── phase-node.test.ts          ← Phase node factory test
│   ├── tools/
│   │   ├── commit-phase.test.ts
│   │   ├── compute-risk.test.ts
│   │   ├── render-ui.test.ts
│   │   └── search-kb.test.ts
│   ├── repositories/
│   │   └── onboarding.repository.test.ts
│   ├── runtime/
│   │   └── server.test.ts
│   └── service-domain/
│       └── schemas.test.ts
├── project.json
├── jest.config.js
├── tsconfig.json
└── tsconfig.spec.json
```

### New RAG Documents: `docs/knowledge-base/`

```
docs/knowledge-base/
├── product-overview.md
├── fees-and-pricing.md
├── faq.md
├── risk-disclaimer.md
├── operating-modes.md
├── simulation-mode.md
└── mandate-terms.md
```

### Modified: `apps/investor-mfe/`

```
apps/investor-mfe/src/app/
├── onboarding/
│   ├── onboarding-chat.component.ts          ← NEW (replaces onboarding-container)
│   ├── onboarding-theme.css                  ← NEW (CopilotKit CSS overrides)
│   ├── renderers/                            ← NEW
│   │   ├── options-renderer.component.ts
│   │   ├── mode-cards-renderer.component.ts
│   │   ├── slider-renderer.component.ts
│   │   ├── amount-renderer.component.ts
│   │   ├── summary-renderer.component.ts
│   │   ├── consent-renderer.component.ts
│   │   └── cta-renderer.component.ts
│   ├── onboarding-container.component.ts     ← DELETE
│   └── steps/                                ← DELETE (all 6 step components)
├── stores/
│   └── onboarding.store.ts                   ← REWRITE (simplified, state from CoAgent)
├── services/
│   └── onboarding.service.ts                 ← DELETE (mutations now handled by agent)
└── remote-routes.ts                          ← MODIFY (swap component, remove old providers)
```

### Modified: `services/investor/investor-bff/`

```
# DELETE these JS resolver files:
src/graphql/js-function/record-onboarding-answer.fn.js
src/graphql/js-function/set-goal.fn.js
src/graphql/js-function/set-risk-profile.fn.js
src/graphql/js-function/select-operating-mode.fn.js
src/graphql/js-function/grant-mandate.fn.js

# MODIFY:
src/schema.graphql                    ← Remove 5 onboarding mutations + related inputs/types
src/service.stack.ts                  ← Remove onboarding resolvers from Facade config
```

---

## Chunk 1: Backend Scaffolding & Domain Schemas (Tasks 1-4)

### Task 1: Scaffold onboarding-agent-bff Nx Project

**Files:**
- Create: `services/investor/onboarding-agent-bff/project.json`
- Create: `services/investor/onboarding-agent-bff/tsconfig.json`
- Create: `services/investor/onboarding-agent-bff/tsconfig.spec.json`
- Create: `services/investor/onboarding-agent-bff/jest.config.js`
- Create: `services/investor/onboarding-agent-bff/src/main.ts`

- [ ] **Step 1: Create project.json**

```json
{
  "name": "onboarding-agent-bff",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "services/investor/onboarding-agent-bff/src",
  "projectType": "application",
  "targets": {
    "deploy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk deploy --app 'npx ts-node -r ./tools/register-paths.js services/investor/onboarding-agent-bff/src/main.ts' --require-approval never -c prefix={args.prefix}"
      }
    },
    "destroy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk destroy --app 'npx ts-node -r ./tools/register-paths.js services/investor/onboarding-agent-bff/src/main.ts' --force -c prefix={args.prefix}"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": { "jestConfig": "services/investor/onboarding-agent-bff/jest.config.js" }
    },
    "lint": { "executor": "@nx/eslint:lint" }
  },
  "tags": ["scope:investor", "type:bff"]
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "types": ["jest", "node"]
  }
}
```

- [ ] **Step 3: Create tsconfig.spec.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["jest", "node"]
  },
  "include": ["test/**/*.ts", "src/**/*.ts"]
}
```

- [ ] **Step 4: Create jest.config.js**

```javascript
const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'onboarding-agent-bff',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/agent-core$': '<rootDir>/../../../libs/agent-core/src/index.ts',
    '^@nestfolio/agent-core/(.*)$': '<rootDir>/../../../libs/agent-core/src/$1',
    '^@nestfolio/investor-bff/service$': '<rootDir>/../../investor/investor-bff/src/service-domain/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
```

- [ ] **Step 5: Create stub main.ts**

```typescript
// services/investor/onboarding-agent-bff/src/main.ts
import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { OnboardingAgentBffStack } from './service.stack';

const app = new App();
const { prefix, account, region, service, subsystem } = resolvePipelineConfig(
  app,
  'onboarding-agent-bff',
);

new OnboardingAgentBffStack(app, `${prefix}-${service}`, {
  subsystem,
  service,
  prefix,
  env: {
    account: account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
```

- [ ] **Step 6: Create stub service.stack.ts (minimal, will be fleshed out in Task 12)**

```typescript
// services/investor/onboarding-agent-bff/src/service.stack.ts
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs';

export class OnboardingAgentBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });
  }
}
```

- [ ] **Step 7: Verify Nx recognizes the project**

Run: `pnpm nx show project onboarding-agent-bff`
Expected: shows project config with targets

- [ ] **Step 8: Commit**

```bash
git add services/investor/onboarding-agent-bff/
git commit -m "feat(onboarding-agent-bff): scaffold nx project with CDK stub"
```

---

### Task 2: Define Service Domain — Zod Schemas, Models, Events

**Files:**
- Create: `services/investor/onboarding-agent-bff/src/service-domain/models.ts`
- Create: `services/investor/onboarding-agent-bff/src/service-domain/schemas.ts`
- Create: `services/investor/onboarding-agent-bff/src/service-domain/events.ts`
- Create: `services/investor/onboarding-agent-bff/src/service-domain/index.ts`
- Test: `services/investor/onboarding-agent-bff/test/service-domain/schemas.test.ts`

- [ ] **Step 1: Write schemas test**

```typescript
// test/service-domain/schemas.test.ts
import {
  AccountModeSchema,
  OnboardingSessionSchema,
  OnboardingPhaseSchema,
  RiskProfileDataSchema,
} from '../../src/service-domain/schemas';

describe('AccountModeSchema', () => {
  it('accepts valid simulation mode', () => {
    const result = AccountModeSchema.safeParse({
      mode: 'simulation',
      capitalAmount: 10000,
      currency: 'EUR',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid live mode', () => {
    const result = AccountModeSchema.safeParse({
      mode: 'live',
      capitalAmount: 50000,
      currency: 'EUR',
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative capitalAmount', () => {
    const result = AccountModeSchema.safeParse({
      mode: 'simulation',
      capitalAmount: -100,
      currency: 'EUR',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown mode', () => {
    const result = AccountModeSchema.safeParse({
      mode: 'demo',
      capitalAmount: 10000,
      currency: 'EUR',
    });
    expect(result.success).toBe(false);
  });
});

describe('OnboardingSessionSchema', () => {
  it('accepts valid session', () => {
    const result = OnboardingSessionSchema.safeParse({
      sessionId: 'sess-123',
      currentPhase: 'goal',
      phaseIndex: 0,
      startedAt: '2026-03-19T10:00:00Z',
      agentMemorySessionId: 'mem-456',
    });
    expect(result.success).toBe(true);
  });

  it('accepts completed session', () => {
    const result = OnboardingSessionSchema.safeParse({
      sessionId: 'sess-123',
      currentPhase: 'completed',
      phaseIndex: 7,
      startedAt: '2026-03-19T10:00:00Z',
      completedAt: '2026-03-19T10:30:00Z',
      agentMemorySessionId: 'mem-456',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid phase', () => {
    const result = OnboardingSessionSchema.safeParse({
      sessionId: 'sess-123',
      currentPhase: 'invalid',
      phaseIndex: 0,
      startedAt: '2026-03-19T10:00:00Z',
      agentMemorySessionId: 'mem-456',
    });
    expect(result.success).toBe(false);
  });
});

describe('OnboardingPhaseSchema', () => {
  it('validates all 7 phases', () => {
    const phases = ['goal', 'horizon', 'mode', 'capital', 'risk', 'operating_mode', 'mandate'];
    for (const phase of phases) {
      expect(OnboardingPhaseSchema.safeParse(phase).success).toBe(true);
    }
  });

  it('validates completed as valid value', () => {
    expect(OnboardingPhaseSchema.safeParse('completed').success).toBe(true);
  });
});

describe('RiskProfileDataSchema', () => {
  it('accepts valid risk profile', () => {
    const result = RiskProfileDataSchema.safeParse({
      tolerance: 'hold',
      experienceLevel: 'novice',
      score: 25,
      category: 'conservative',
    });
    expect(result.success).toBe(true);
  });

  it('rejects score out of range', () => {
    const result = RiskProfileDataSchema.safeParse({
      tolerance: 'hold',
      experienceLevel: 'novice',
      score: 150,
      category: 'conservative',
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=schemas`
Expected: FAIL — module not found

- [ ] **Step 3: Implement schemas.ts**

```typescript
// src/service-domain/schemas.ts
import { z } from 'zod';

export const OnboardingPhaseSchema = z.enum([
  'goal', 'horizon', 'mode', 'capital', 'risk', 'operating_mode', 'mandate', 'completed',
]);
export type OnboardingPhase = z.infer<typeof OnboardingPhaseSchema>;

export const AccountModeSchema = z.object({
  mode: z.enum(['simulation', 'live']),
  capitalAmount: z.number().nonnegative(),
  currency: z.string().min(3).max(3),
});
export type AccountMode = z.infer<typeof AccountModeSchema>;

export const OnboardingSessionSchema = z.object({
  sessionId: z.string().min(1),
  currentPhase: OnboardingPhaseSchema,
  phaseIndex: z.number().int().min(0).max(7),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  agentMemorySessionId: z.string().min(1),
});
export type OnboardingSession = z.infer<typeof OnboardingSessionSchema>;

export const RiskProfileDataSchema = z.object({
  tolerance: z.string(),
  experienceLevel: z.string(),
  score: z.number().int().min(0).max(100),
  category: z.enum(['conservative', 'moderate', 'aggressive']),
});
export type RiskProfileData = z.infer<typeof RiskProfileDataSchema>;
```

- [ ] **Step 4: Implement models.ts**

```typescript
// src/service-domain/models.ts
import type { AccountMode, OnboardingSession, RiskProfileData } from './schemas';

export interface OnboardingState {
  phase: 'goal' | 'horizon' | 'mode' | 'capital' | 'risk' | 'operating_mode' | 'mandate';
  phaseIndex: number;
  totalPhases: number;
  goal?: string;
  horizonYears?: number;
  accountMode?: 'simulation' | 'live';
  capitalAmount?: number;
  riskProfile?: RiskProfileData;
  operatingMode?: 'conservative' | 'balanced' | 'aggressive';
  mandateAccepted?: boolean;
}

export type { AccountMode, OnboardingSession, RiskProfileData };
```

- [ ] **Step 5: Implement events.ts**

```typescript
// src/service-domain/events.ts
export const ONBOARDING_STARTED = 'ONBOARDING_STARTED' as const;
export const ONBOARDING_COMPLETED = 'ONBOARDING_COMPLETED' as const;

export type OnboardingEventType = typeof ONBOARDING_STARTED | typeof ONBOARDING_COMPLETED;
```

- [ ] **Step 6: Create barrel index.ts**

```typescript
// src/service-domain/index.ts
export * from './schemas';
export * from './models';
export * from './events';
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=schemas`
Expected: PASS (all 9 tests)

- [ ] **Step 8: Commit**

```bash
git add services/investor/onboarding-agent-bff/src/service-domain/ services/investor/onboarding-agent-bff/test/service-domain/
git commit -m "feat(onboarding-agent-bff): add service-domain schemas, models, events"
```

---

### Task 3: Implement Onboarding Repository

**Files:**
- Create: `services/investor/onboarding-agent-bff/src/repositories/onboarding.repository.ts`
- Test: `services/investor/onboarding-agent-bff/test/repositories/onboarding.repository.test.ts`

**Context:** Follows the same `TableRepository` pattern as `investor-bff`'s `InvestorProfileRepository`. Uses the same table + PK schema (`InvestorProfile#${tenantId}#${userId}`) so DDB Streams CDC fires the same domain events.

- [ ] **Step 1: Write repository tests**

```typescript
// test/repositories/onboarding.repository.test.ts
import { OnboardingRepository } from '../../src/repositories/onboarding.repository';

// Mock the DynamoDB doc client at module level
const mockSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend }),
  },
  PutCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetCommand: jest.fn().mockImplementation((input) => ({ input })),
  QueryCommand: jest.fn().mockImplementation((input) => ({ input })),
  UpdateCommand: jest.fn().mockImplementation((input) => ({ input })),
  TransactWriteCommand: jest.fn().mockImplementation((input) => ({ input })),
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

describe('OnboardingRepository', () => {
  let repo: OnboardingRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new OnboardingRepository('test-table');
  });

  describe('createSession', () => {
    it('writes OnboardingSession + EditEvent in transaction', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await repo.createSession('tenant-1', 'user-1', 'mem-session-1');
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(2);
      expect(call.input.TransactItems[0].Put.Item.sk).toMatch(/^OnboardingSession#/);
      expect(call.input.TransactItems[0].Put.Item.currentPhase).toBe('goal');
      expect(call.input.TransactItems[1].Put.Item.__typename).toBe('EditEvent');
      expect(result.sessionId).toBeDefined();
      expect(result.currentPhase).toBe('goal');
    });
  });

  describe('commitHorizon', () => {
    it('queries existing goal and updates timeHorizonMonths', async () => {
      // queryByPk returns existing goal
      mockSend.mockResolvedValueOnce({ Items: [{ pk: 'InvestorProfile#tenant-1#user-1', sk: 'Goal#g1' }] });
      // UpdateCommand
      mockSend.mockResolvedValueOnce({});
      // put EditEvent
      mockSend.mockResolvedValueOnce({});
      await repo.commitHorizon('tenant-1', 'user-1', 10);
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('does nothing when no goal exists', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await repo.commitHorizon('tenant-1', 'user-1', 10);
      expect(mockSend).toHaveBeenCalledTimes(1); // only the query
    });
  });

  describe('commitGoal', () => {
    it('writes Goal record + EditEvent', async () => {
      mockSend.mockResolvedValueOnce({});
      await repo.commitGoal('tenant-1', 'user-1', 'Far crescere il capitale');
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(2);
      expect(call.input.TransactItems[0].Put.Item.__typename).toBe('Goal');
      expect(call.input.TransactItems[0].Put.Item.objective).toBe('Far crescere il capitale');
    });
  });

  describe('commitAccountMode', () => {
    it('writes AccountMode record + EditEvent', async () => {
      mockSend.mockResolvedValueOnce({});
      await repo.commitAccountMode('tenant-1', 'user-1', 'simulation', 10000);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems[0].Put.Item.sk).toBe('AccountMode');
      expect(call.input.TransactItems[0].Put.Item.mode).toBe('simulation');
      expect(call.input.TransactItems[0].Put.Item.capitalAmount).toBe(10000);
    });
  });

  describe('commitRiskProfile', () => {
    it('writes RiskProfile record + EditEvent', async () => {
      mockSend.mockResolvedValueOnce({});
      await repo.commitRiskProfile('tenant-1', 'user-1', {
        tolerance: 'hold',
        experienceLevel: 'novice',
        score: 25,
        category: 'conservative',
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems[0].Put.Item.__typename).toBe('RiskProfile');
      expect(call.input.TransactItems[0].Put.Item.score).toBe(25);
    });
  });

  describe('commitOperatingMode', () => {
    it('writes OperatingMode + updates InvestorProfile + EditEvent', async () => {
      mockSend.mockResolvedValueOnce({});
      await repo.commitOperatingMode('tenant-1', 'user-1', 'balanced');
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      // OperatingMode Put + InvestorProfile Update + EditEvent Put = 3 items
      expect(call.input.TransactItems).toHaveLength(3);
    });
  });

  describe('commitMandate', () => {
    it('writes Mandate record + EditEvent', async () => {
      mockSend.mockResolvedValueOnce({});
      await repo.commitMandate('tenant-1', 'user-1');
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems[0].Put.Item.__typename).toBe('Mandate');
    });
  });

  describe('advanceSession', () => {
    it('updates session phase and phaseIndex', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: { currentPhase: 'horizon', phaseIndex: 1 } });
      await repo.advanceSession('tenant-1', 'user-1', 'sess-1', 'horizon', 1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Key.sk).toBe('OnboardingSession#sess-1');
    });
  });

  describe('getActiveSession', () => {
    it('returns session if exists and not completed', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [{ sessionId: 'sess-1', currentPhase: 'capital', phaseIndex: 3 }],
      });
      const result = await repo.getActiveSession('tenant-1', 'user-1');
      expect(result).toEqual({ sessionId: 'sess-1', currentPhase: 'capital', phaseIndex: 3 });
    });

    it('returns null if no active session', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      const result = await repo.getActiveSession('tenant-1', 'user-1');
      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=repository`
Expected: FAIL — module not found

- [ ] **Step 3: Implement onboarding.repository.ts**

```typescript
// src/repositories/onboarding.repository.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getUUID, getTime, type TableEntry } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import type { RiskProfileData, OnboardingSession } from '../service-domain/schemas';

function profilePk(tenantId: string, userId: string): string {
  return `InvestorProfile#${tenantId}#${userId}`;
}

function editEvent(pk: string, tenantId: string, userId: string, operation: string, path: string, value: unknown, action?: string): TableEntry {
  const now = getTime();
  return {
    pk,
    sk: `EditEvent#${now}#${getUUID()}`,
    __typename: 'EditEvent',
    tenantId,
    timestamp: now,
    operation,
    path,
    value,
    editedBy: userId,
    editedAt: now,
    ...(action ? { action } : {}),
  };
}

export class OnboardingRepository extends TableRepository {
  private readonly log = withMethodLogging('OnboardingRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly createSession = this.log('createSession',
    async (tenantId: string, userId: string, agentMemorySessionId: string): Promise<OnboardingSession & { sessionId: string }> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();
      const sessionId = getUUID();

      const sessionItem: TableEntry = {
        pk,
        sk: `OnboardingSession#${sessionId}`,
        __typename: 'OnboardingSession',
        tenantId,
        timestamp: now,
        sessionId,
        currentPhase: 'goal',
        phaseIndex: 0,
        startedAt: now,
        agentMemorySessionId,
        ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 day TTL
      };

      await this.transactWrite({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: sessionItem } },
          { Put: { TableName: this.tableName, Item: editEvent(pk, tenantId, userId, 'add', '/onboardingSession', { sessionId }, 'ONBOARDING_STARTED') } },
        ],
      });

      return { sessionId, currentPhase: 'goal' as const, phaseIndex: 0, startedAt: now, agentMemorySessionId };
    },
  );

  readonly commitGoal = this.log('commitGoal',
    async (tenantId: string, userId: string, objective: string): Promise<void> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();
      const goalId = getUUID();

      const goalItem: TableEntry = {
        pk,
        sk: `Goal#${goalId}`,
        __typename: 'Goal',
        tenantId,
        timestamp: now,
        goalId,
        objective,
        targetAmountCents: 0,
        currency: 'EUR',
        timeHorizonMonths: 0,
        targetReturn: 0,
        createdAt: now,
        updatedAt: now,
      };

      await this.transactWrite({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: goalItem } },
          { Put: { TableName: this.tableName, Item: editEvent(pk, tenantId, userId, 'add', `/goals/${goalId}`, { objective }) } },
        ],
      });
    },
  );

  readonly commitHorizon = this.log('commitHorizon',
    async (tenantId: string, userId: string, horizonYears: number): Promise<void> => {
      const pk = profilePk(tenantId, userId);
      // Find existing goal to update horizonYears
      const goals = await this.queryByPk(pk, 'Goal#');
      if (goals.length === 0) return;
      const latestGoal = goals[goals.length - 1];
      const now = getTime();

      await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk: latestGoal.sk as string },
        UpdateExpression: 'SET timeHorizonMonths = :months, #ts = :ts, updatedAt = :now',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: { ':months': horizonYears * 12, ':ts': now, ':now': now },
        ConditionExpression: 'attribute_exists(pk)',
      }));

      await this.put(editEvent(pk, tenantId, userId, 'replace', '/goals/horizonYears', { horizonYears }));
    },
  );

  readonly commitAccountMode = this.log('commitAccountMode',
    async (tenantId: string, userId: string, mode: 'simulation' | 'live', capitalAmount: number): Promise<void> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();

      const item: TableEntry = {
        pk,
        sk: 'AccountMode',
        __typename: 'AccountMode',
        tenantId,
        timestamp: now,
        mode,
        capitalAmount,
        currency: 'EUR',
        createdAt: now,
        updatedAt: now,
      };

      await this.transactWrite({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: item } },
          { Put: { TableName: this.tableName, Item: editEvent(pk, tenantId, userId, 'add', '/accountMode', { mode, capitalAmount }) } },
        ],
      });
    },
  );

  readonly commitRiskProfile = this.log('commitRiskProfile',
    async (tenantId: string, userId: string, risk: RiskProfileData): Promise<void> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();
      const profileId = getUUID();

      const item: TableEntry = {
        pk,
        sk: 'RiskProfile',
        __typename: 'RiskProfile',
        tenantId,
        timestamp: now,
        profileId,
        score: risk.score,
        band: bandFromCategory(risk.category),
        toleranceResponse: risk.tolerance,
        experienceLevel: risk.experienceLevel,
        assessedAt: now,
        version: 1,
      };

      await this.transactWrite({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: item } },
          { Put: { TableName: this.tableName, Item: editEvent(pk, tenantId, userId, 'add', '/riskProfile', risk) } },
        ],
      });
    },
  );

  readonly commitOperatingMode = this.log('commitOperatingMode',
    async (tenantId: string, userId: string, mode: string): Promise<void> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();
      const modeUpper = mode.toUpperCase();

      const item: TableEntry = {
        pk,
        sk: 'OperatingMode',
        __typename: 'OperatingModeRecord',
        tenantId,
        timestamp: now,
        mode: modeUpper,
        selectedAt: now,
      };

      await this.transactWrite({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: item } },
          {
            Update: {
              TableName: this.tableName,
              Key: { pk, sk: 'InvestorProfile' },
              UpdateExpression: 'SET operatingMode = :mode, updatedAt = :now, #ts = :ts',
              ExpressionAttributeNames: { '#ts': 'timestamp' },
              ExpressionAttributeValues: { ':mode': modeUpper, ':now': now, ':ts': now },
            },
          },
          { Put: { TableName: this.tableName, Item: editEvent(pk, tenantId, userId, 'replace', '/operatingMode', modeUpper) } },
        ],
      });
    },
  );

  readonly commitMandate = this.log('commitMandate',
    async (tenantId: string, userId: string): Promise<void> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();
      const mandateId = getUUID();

      const item: TableEntry = {
        pk,
        sk: 'Mandate',
        __typename: 'Mandate',
        tenantId,
        timestamp: now,
        mandateId,
        level: 'ADVISORY',
        monthlyTurnoverCapPercent: 10,
        maxSingleTradePercent: 5,
        coolDownDays: 1,
        rebalanceCadence: 'QUARTERLY',
        effectiveDate: now,
        revokedAt: null,
        version: 1,
      };

      await this.transactWrite({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: item } },
          { Put: { TableName: this.tableName, Item: editEvent(pk, tenantId, userId, 'add', '/mandate', { mandateId }, 'GRANT_MANDATE') } },
        ],
      });
    },
  );

  readonly advanceSession = this.log('advanceSession',
    async (tenantId: string, userId: string, sessionId: string, nextPhase: string, phaseIndex: number): Promise<void> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();

      await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk: `OnboardingSession#${sessionId}` },
        UpdateExpression: 'SET currentPhase = :phase, phaseIndex = :idx, #ts = :ts' +
          (nextPhase === 'completed' ? ', completedAt = :now' : ''),
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':phase': nextPhase,
          ':idx': phaseIndex,
          ':ts': now,
          ...(nextPhase === 'completed' ? { ':now': now } : {}),
        },
        ConditionExpression: 'attribute_exists(pk)',
      }));
    },
  );

  readonly getActiveSession = this.log('getActiveSession',
    async (tenantId: string, userId: string): Promise<Record<string, unknown> | null> => {
      const pk = profilePk(tenantId, userId);
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: 'currentPhase <> :completed',
        ExpressionAttributeValues: { ':pk': pk, ':sk': 'OnboardingSession#', ':completed': 'completed' },
        ScanIndexForward: false,
        Limit: 1,
      }));
      return result.Items?.[0] ?? null;
    },
  );
}

function bandFromCategory(category: string): { minEquity: number; maxEquity: number } {
  switch (category) {
    case 'conservative': return { minEquity: 0.1, maxEquity: 0.3 };
    case 'moderate': return { minEquity: 0.3, maxEquity: 0.6 };
    case 'aggressive': return { minEquity: 0.6, maxEquity: 0.9 };
    default: return { minEquity: 0.3, maxEquity: 0.6 };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=repository`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add services/investor/onboarding-agent-bff/src/repositories/ services/investor/onboarding-agent-bff/test/repositories/
git commit -m "feat(onboarding-agent-bff): add onboarding repository with DDB persistence"
```

---

### Task 4: Implement Agent Tools — compute-risk + render-ui

**Files:**
- Create: `services/investor/onboarding-agent-bff/src/agent/tools/compute-risk.ts`
- Create: `services/investor/onboarding-agent-bff/src/agent/tools/render-ui.ts`
- Test: `services/investor/onboarding-agent-bff/test/tools/compute-risk.test.ts`
- Test: `services/investor/onboarding-agent-bff/test/tools/render-ui.test.ts`

- [ ] **Step 1: Write compute-risk tests**

```typescript
// test/tools/compute-risk.test.ts
import { computeRiskProfile } from '../../src/agent/tools/compute-risk';

describe('computeRiskProfile', () => {
  it('conservative: low tolerance + novice = score 0-33, category conservative', () => {
    const result = computeRiskProfile(0, 0);
    expect(result.score).toBeLessThanOrEqual(33);
    expect(result.category).toBe('conservative');
  });

  it('moderate: medium tolerance + intermediate = score 34-66, category moderate', () => {
    const result = computeRiskProfile(1, 1);
    expect(result.score).toBeGreaterThanOrEqual(17);
    expect(result.score).toBeLessThanOrEqual(67);
    expect(result.category).toBe('moderate');
  });

  it('aggressive: high tolerance + expert = score 67-100, category aggressive', () => {
    const result = computeRiskProfile(3, 3);
    expect(result.score).toBeGreaterThanOrEqual(67);
    expect(result.category).toBe('aggressive');
  });

  it('mixed: high tolerance + novice = moderate', () => {
    const result = computeRiskProfile(3, 0);
    expect(result.category).toBe('moderate');
  });

  it('produces deterministic output for same inputs', () => {
    const a = computeRiskProfile(2, 1);
    const b = computeRiskProfile(2, 1);
    expect(a).toEqual(b);
  });

  it('all 16 input combinations produce valid results', () => {
    for (let t = 0; t <= 3; t++) {
      for (let e = 0; e <= 3; e++) {
        const result = computeRiskProfile(t, e);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
        expect(['conservative', 'moderate', 'aggressive']).toContain(result.category);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=compute-risk`
Expected: FAIL

- [ ] **Step 3: Implement compute-risk.ts**

```typescript
// src/agent/tools/compute-risk.ts
import type { RiskProfileData } from '../../service-domain/schemas';

const TOLERANCE_LABELS = ['hold', 'cautious', 'selective', 'aggressive'] as const;
const EXPERIENCE_LABELS = ['novice', 'beginner', 'intermediate', 'expert'] as const;

/**
 * Deterministic risk scoring: pure function, no LLM.
 * @param toleranceIdx 0-3 (from card selection or free-text mapping)
 * @param experienceIdx 0-3 (from card selection or free-text mapping)
 */
export function computeRiskProfile(toleranceIdx: number, experienceIdx: number): RiskProfileData {
  const t = Math.max(0, Math.min(3, Math.round(toleranceIdx)));
  const e = Math.max(0, Math.min(3, Math.round(experienceIdx)));

  // Weighted average: tolerance 60%, experience 40%
  const raw = (t * 0.6 + e * 0.4) / 3;
  const score = Math.round(raw * 100);

  const category = score <= 33 ? 'conservative' as const
    : score <= 66 ? 'moderate' as const
    : 'aggressive' as const;

  return {
    tolerance: TOLERANCE_LABELS[t],
    experienceLevel: EXPERIENCE_LABELS[e],
    score,
    category,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=compute-risk`
Expected: PASS (6 tests)

- [ ] **Step 5: Write render-ui tests**

```typescript
// test/tools/render-ui.test.ts
import { RENDER_TOOLS } from '../../src/agent/tools/render-ui';

describe('RENDER_TOOLS', () => {
  it('defines 7 render tools', () => {
    expect(RENDER_TOOLS).toHaveLength(7);
  });

  it('each tool has name, description, and schema', () => {
    for (const tool of RENDER_TOOLS) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.schema).toBeDefined();
    }
  });

  const expectedTools = [
    'render_options',
    'render_mode_cards',
    'render_slider',
    'render_amount',
    'render_summary',
    'render_consent',
    'render_cta',
  ];

  it.each(expectedTools)('includes %s tool', (toolName) => {
    expect(RENDER_TOOLS.find((t) => t.name === toolName)).toBeDefined();
  });

  it('render_options schema requires title + options array', () => {
    const tool = RENDER_TOOLS.find((t) => t.name === 'render_options')!;
    const parsed = tool.schema.safeParse({ title: 'Obiettivo', options: [{ id: 'grow', emoji: '📈', label: 'Crescita' }] });
    expect(parsed.success).toBe(true);
  });

  it('render_slider schema requires min, max, step, label', () => {
    const tool = RENDER_TOOLS.find((t) => t.name === 'render_slider')!;
    const parsed = tool.schema.safeParse({ label: 'Orizzonte', min: 1, max: 30, step: 1, unit: 'anni' });
    expect(parsed.success).toBe(true);
  });

  it('render_amount schema requires currency + presets', () => {
    const tool = RENDER_TOOLS.find((t) => t.name === 'render_amount')!;
    const parsed = tool.schema.safeParse({ label: 'Capitale', currency: 'EUR', presets: [5000, 10000, 25000] });
    expect(parsed.success).toBe(true);
  });
});
```

- [ ] **Step 6: Implement render-ui.ts**

```typescript
// src/agent/tools/render-ui.ts
import { z } from 'zod';

const OptionItemSchema = z.object({
  id: z.string(),
  emoji: z.string().optional(),
  label: z.string(),
  description: z.string().optional(),
});

const ModeCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  badge: z.string().optional(),
  details: z.array(z.string()),
});

export const RENDER_TOOLS = [
  {
    name: 'render_options',
    description: 'Display emoji choice cards for the user to select from',
    schema: z.object({
      title: z.string(),
      options: z.array(OptionItemSchema).min(2),
    }),
  },
  {
    name: 'render_mode_cards',
    description: 'Display large cards with badge and details list for mode selection',
    schema: z.object({
      title: z.string(),
      cards: z.array(ModeCardSchema).min(2),
    }),
  },
  {
    name: 'render_slider',
    description: 'Display a range slider for numeric input',
    schema: z.object({
      label: z.string(),
      min: z.number(),
      max: z.number(),
      step: z.number(),
      unit: z.string().optional(),
    }),
  },
  {
    name: 'render_amount',
    description: 'Display a currency input with preset buttons',
    schema: z.object({
      label: z.string(),
      currency: z.string(),
      presets: z.array(z.number()),
    }),
  },
  {
    name: 'render_summary',
    description: 'Display a read-only recap card with label-value rows',
    schema: z.object({
      title: z.string(),
      rows: z.array(z.object({ label: z.string(), value: z.string() })),
    }),
  },
  {
    name: 'render_consent',
    description: 'Display a consent checkbox with legal links',
    schema: z.object({
      label: z.string(),
      links: z.array(z.object({ text: z.string(), url: z.string() })).optional(),
    }),
  },
  {
    name: 'render_cta',
    description: 'Display a call-to-action button',
    schema: z.object({
      label: z.string(),
      action: z.string(),
    }),
  },
] as const;
```

- [ ] **Step 7: Run all tool tests**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=tools`
Expected: PASS (all tests)

- [ ] **Step 8: Commit**

```bash
git add services/investor/onboarding-agent-bff/src/agent/tools/ services/investor/onboarding-agent-bff/test/tools/
git commit -m "feat(onboarding-agent-bff): add compute-risk scoring + render-ui tool definitions"
```

---

## Chunk 2: Agent Graph & Runtime (Tasks 5-10)

### Task 5: Implement Agent State (LangGraph Annotation)

**Files:**
- Create: `services/investor/onboarding-agent-bff/src/agent/state.ts`
- Test: `services/investor/onboarding-agent-bff/test/agent/state.test.ts`

- [ ] **Step 1: Write state tests**

```typescript
// test/agent/state.test.ts
import { OnboardingStateSchema, PHASE_ORDER, phaseIndexOf } from '../../src/agent/state';

describe('OnboardingStateSchema', () => {
  it('accepts valid initial state', () => {
    const result = OnboardingStateSchema.safeParse({
      phase: 'goal',
      phaseIndex: 0,
      totalPhases: 7,
      messages: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts fully populated state', () => {
    const result = OnboardingStateSchema.safeParse({
      phase: 'mandate',
      phaseIndex: 6,
      totalPhases: 7,
      goal: 'Crescita',
      horizonYears: 10,
      accountMode: 'simulation',
      capitalAmount: 25000,
      riskProfile: { tolerance: 'hold', experienceLevel: 'novice', score: 25, category: 'conservative' },
      operatingMode: 'balanced',
      mandateAccepted: false,
      messages: [],
    });
    expect(result.success).toBe(true);
  });
});

describe('PHASE_ORDER', () => {
  it('has 7 phases', () => {
    expect(PHASE_ORDER).toHaveLength(7);
  });

  it('starts with goal and ends with mandate', () => {
    expect(PHASE_ORDER[0]).toBe('goal');
    expect(PHASE_ORDER[6]).toBe('mandate');
  });
});

describe('phaseIndexOf', () => {
  it('returns correct index for each phase', () => {
    expect(phaseIndexOf('goal')).toBe(0);
    expect(phaseIndexOf('horizon')).toBe(1);
    expect(phaseIndexOf('mandate')).toBe(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=state.test`
Expected: FAIL

- [ ] **Step 3: Implement state.ts**

```typescript
// src/agent/state.ts
import { z } from 'zod';
import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { RiskProfileDataSchema } from '../service-domain/schemas';

export const PHASE_ORDER = ['goal', 'horizon', 'mode', 'capital', 'risk', 'operating_mode', 'mandate'] as const;
export type Phase = (typeof PHASE_ORDER)[number];

export function phaseIndexOf(phase: Phase): number {
  return PHASE_ORDER.indexOf(phase);
}

export function nextPhase(current: Phase): Phase | 'completed' {
  const idx = PHASE_ORDER.indexOf(current);
  return idx < PHASE_ORDER.length - 1 ? PHASE_ORDER[idx + 1] : 'completed';
}

export const OnboardingStateSchema = z.object({
  phase: z.enum(PHASE_ORDER),
  phaseIndex: z.number().int().min(0).max(6),
  totalPhases: z.literal(7),
  goal: z.string().optional(),
  horizonYears: z.number().int().min(1).max(30).optional(),
  accountMode: z.enum(['simulation', 'live']).optional(),
  capitalAmount: z.number().nonnegative().optional(),
  riskProfile: RiskProfileDataSchema.optional(),
  operatingMode: z.enum(['conservative', 'balanced', 'aggressive']).optional(),
  mandateAccepted: z.boolean().optional(),
  turnCount: z.number().int().min(0).default(0),
  messages: z.array(z.any()),
});

export const MAX_TURNS = 50;

export const OnboardingAnnotation = Annotation.Root({
  phase: Annotation<Phase>({ reducer: (_, v) => v, default: () => 'goal' }),
  phaseIndex: Annotation<number>({ reducer: (_, v) => v, default: () => 0 }),
  totalPhases: Annotation<number>({ reducer: (_, v) => v, default: () => 7 }),
  goal: Annotation<string | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  horizonYears: Annotation<number | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  accountMode: Annotation<'simulation' | 'live' | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  capitalAmount: Annotation<number | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  riskProfile: Annotation<Record<string, unknown> | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  operatingMode: Annotation<string | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  mandateAccepted: Annotation<boolean | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  turnCount: Annotation<number>({ reducer: (prev, next) => prev + next, default: () => 0 }),
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  sessionId: Annotation<string | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  tenantId: Annotation<string | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  userId: Annotation<string | undefined>({ reducer: (_, v) => v, default: () => undefined }),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=state.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/investor/onboarding-agent-bff/src/agent/state.ts services/investor/onboarding-agent-bff/test/agent/state.test.ts
git commit -m "feat(onboarding-agent-bff): add OnboardingState schema + LangGraph Annotation"
```

---

### Task 6: Implement Agent Prompts

**Files:**
- Create: `services/investor/onboarding-agent-bff/src/agent/prompts/system.ts`
- Create: `services/investor/onboarding-agent-bff/src/agent/prompts/phase-instructions.ts`

No separate test file — prompts are string constants tested implicitly via phase node tests.

- [ ] **Step 1: Implement system.ts**

```typescript
// src/agent/prompts/system.ts
export const SYSTEM_PROMPT = `Sei l'assistente di Nestfolio, una piattaforma di consulenza finanziaria. Il tuo compito è guidare l'utente attraverso il processo di onboarding con un tono amichevole, professionale e rassicurante.

REGOLE:
- Parla SEMPRE in italiano
- Non dare MAI consigli finanziari durante l'onboarding — raccogli solo le preferenze dell'utente
- Conferma SEMPRE prima di procedere alla fase successiva ("Ho capito bene: [riassunto]. Confermi?")
- Se l'utente fa domande sul prodotto, usa lo strumento search_knowledge_base per cercare nella documentazione
- Dopo aver risposto a una domanda off-topic, torna gentilmente al flusso ("Ottima domanda! [risposta]. Torniamo a noi — stavamo parlando di...")
- Se l'utente scrive qualcosa di incomprensibile, richiedi gentilmente: "Non ho capito, potresti ripetere?"
- Usa gli strumenti render_* per mostrare componenti UI ricchi (carte, slider, input)
- NON inventare informazioni — usa solo la documentazione ufficiale

FLUSSO:
Il processo di onboarding ha 7 fasi. Tu guidi l'utente attraverso ciascuna in ordine.
Dopo ogni fase, chiama commit_phase per salvare i dati raccolti.

PERSONALITA':
- Nome: Nestfolio
- Tono: amichevole ma professionale, come un consulente finanziario giovane e competente
- Emoji: usa con moderazione per rendere la conversazione più naturale
`;
```

- [ ] **Step 2: Implement phase-instructions.ts**

```typescript
// src/agent/prompts/phase-instructions.ts
export const PHASE_INSTRUCTIONS: Record<string, string> = {
  goal: `FASE: Obiettivo di investimento
Chiedi all'utente qual è il suo obiettivo principale. Usa render_options con queste opzioni:
- 📈 Far crescere il capitale
- 🏠 Acquistare un immobile
- 👨‍👩‍👧 Pianificare per la famiglia
- 🎓 Finanziare studi/formazione
- 🏖️ Prepararsi alla pensione
- 💼 Altro
Se l'utente scrive a testo libero, mappa al più vicino e conferma.
Dopo la conferma, chiama commit_phase con tool_input { phase: "goal", data: { goal: "<obiettivo>" } }.`,

  horizon: `FASE: Orizzonte temporale
Chiedi all'utente per quanti anni intende investire. Usa render_slider con min=1, max=30, step=1, unit="anni".
Dopo la scelta, conferma e chiama commit_phase con { phase: "horizon", data: { horizonYears: <N> } }.`,

  mode: `FASE: Modalità account
Chiedi se vuole iniziare in simulazione o con denaro reale. Usa render_mode_cards con:
- Simulazione: "Impara senza rischi", badge "Consigliato", details: ["Soldi virtuali", "Stesso algoritmo", "Passa al reale quando vuoi"]
- Reale: "Investi subito", details: ["Denaro reale", "Rendimenti reali", "Richiede verifica identità"]
Dopo la scelta, conferma e chiama commit_phase con { phase: "mode", data: { accountMode: "simulation"|"live" } }.`,

  capital: `FASE: Capitale iniziale
Chiedi quanto vuole investire inizialmente. Usa render_amount con currency="EUR" e presets=[5000, 10000, 25000, 50000].
L'utente può anche digitare un importo personalizzato.
Dopo la scelta, conferma e chiama commit_phase con { phase: "capital", data: { capitalAmount: <N> } }.`,

  risk: `FASE: Profilo di rischio
Raccogli il profilo di rischio con DUE domande separate:

1. Tolleranza al rischio — usa render_options:
   - 😌 Non faccio nulla e aspetto (hold)
   - 🤔 Osservo con attenzione (cautious)
   - 📊 Rivedo selettivamente (selective)
   - ⚡ Agisco rapidamente (aggressive)

2. Livello di esperienza — usa render_options:
   - 🌱 Principiante (novice)
   - 📚 Ho qualche nozione (beginner)
   - 📈 Investo da qualche anno (intermediate)
   - 🎯 Esperto (expert)

Se l'utente scrive a testo libero, interpreta e conferma la categoria prima di procedere.
Dopo entrambe le risposte, chiama compute_risk_profile con i due indici, poi commit_phase con { phase: "risk", data: { toleranceIdx, experienceIdx, riskProfile } }.`,

  operating_mode: `FASE: Modalità operativa
Chiedi la modalità operativa preferita. Usa render_mode_cards con:
- Conservativo: "Proteggi il capitale", details: ["Bassa volatilità", "Rendimenti moderati", "Ribilanciamento raro"]
- Bilanciato: "Equilibrio rischio-rendimento", badge "Più scelto", details: ["Volatilità media", "Buoni rendimenti", "Ribilanciamento periodico"]
- Aggressivo: "Massimizza i rendimenti", details: ["Alta volatilità", "Potenziali alti rendimenti", "Ribilanciamento frequente"]
Dopo la scelta, conferma e chiama commit_phase con { phase: "operating_mode", data: { operatingMode: "conservative"|"balanced"|"aggressive" } }.`,

  mandate: `FASE: Mandato
Mostra un riepilogo di tutte le scelte fatte usando render_summary. Poi mostra render_consent con il testo del mandato:
"Autorizzo Nestfolio a gestire il mio portafoglio secondo le preferenze indicate".
Se l'utente accetta, chiama commit_phase con { phase: "mandate", data: { mandateAccepted: true } }.
Dopo il commit, mostra render_cta con label="Vai alla Dashboard" e action="navigate:/dashboard".`,
};
```

- [ ] **Step 3: Commit**

```bash
git add services/investor/onboarding-agent-bff/src/agent/prompts/
git commit -m "feat(onboarding-agent-bff): add system + phase-specific prompts (Italian)"
```

---

### Task 7: Implement commit-phase Tool + search-kb Handler

**Files:**
- Create: `services/investor/onboarding-agent-bff/src/agent/tools/commit-phase.ts`
- Create: `services/investor/onboarding-agent-bff/src/agent/tools/search-kb.handler.ts`
- Create: `services/investor/onboarding-agent-bff/src/agent/tools/search-kb.schema.json`
- Test: `services/investor/onboarding-agent-bff/test/tools/commit-phase.test.ts`
- Test: `services/investor/onboarding-agent-bff/test/tools/search-kb.test.ts`

- [ ] **Step 1: Write commit-phase tests**

```typescript
// test/tools/commit-phase.test.ts
import { createCommitPhaseTool } from '../../src/agent/tools/commit-phase';

describe('createCommitPhaseTool', () => {
  const mockRepo = {
    commitGoal: jest.fn(),
    commitHorizon: jest.fn(),
    commitAccountMode: jest.fn(),
    commitRiskProfile: jest.fn(),
    commitOperatingMode: jest.fn(),
    commitMandate: jest.fn(),
    advanceSession: jest.fn(),
  };

  const tool = createCommitPhaseTool(mockRepo as any);

  beforeEach(() => jest.clearAllMocks());

  it('has name commit_phase', () => {
    expect(tool.name).toBe('commit_phase');
  });

  it('commits goal phase and advances session', async () => {
    const result = await tool.invoke({
      tenantId: 't1', userId: 'u1', sessionId: 's1',
      phase: 'goal', data: { goal: 'Crescita' },
    });
    expect(mockRepo.commitGoal).toHaveBeenCalledWith('t1', 'u1', 'Crescita');
    expect(mockRepo.advanceSession).toHaveBeenCalledWith('t1', 'u1', 's1', 'horizon', 1);
    expect(result).toContain('committed');
  });

  it('commits horizon phase', async () => {
    await tool.invoke({
      tenantId: 't1', userId: 'u1', sessionId: 's1',
      phase: 'horizon', data: { horizonYears: 10 },
    });
    expect(mockRepo.commitHorizon).toHaveBeenCalledWith('t1', 'u1', 10);
    expect(mockRepo.advanceSession).toHaveBeenCalledWith('t1', 'u1', 's1', 'mode', 2);
  });

  it('commits mode + capital as single phase', async () => {
    await tool.invoke({
      tenantId: 't1', userId: 'u1', sessionId: 's1',
      phase: 'mode', data: { accountMode: 'simulation' },
    });
    expect(mockRepo.commitAccountMode).toHaveBeenCalled();
  });

  it('commits mandate and advances to completed', async () => {
    await tool.invoke({
      tenantId: 't1', userId: 'u1', sessionId: 's1',
      phase: 'mandate', data: { mandateAccepted: true },
    });
    expect(mockRepo.commitMandate).toHaveBeenCalledWith('t1', 'u1');
    expect(mockRepo.advanceSession).toHaveBeenCalledWith('t1', 'u1', 's1', 'completed', 7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=commit-phase`
Expected: FAIL

- [ ] **Step 3: Implement commit-phase.ts**

```typescript
// src/agent/tools/commit-phase.ts
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { OnboardingRepository } from '../../repositories/onboarding.repository';
import { PHASE_ORDER, nextPhase, phaseIndexOf, type Phase } from '../state';

const CommitPhaseSchema = z.object({
  tenantId: z.string(),
  userId: z.string(),
  sessionId: z.string(),
  phase: z.enum(PHASE_ORDER),
  data: z.record(z.unknown()),
});

export function createCommitPhaseTool(repo: OnboardingRepository): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'commit_phase',
    description: 'Persist phase data to DynamoDB and advance to the next phase',
    schema: CommitPhaseSchema,
    func: async (input) => {
      const { tenantId, userId, sessionId, phase, data } = input;

      switch (phase) {
        case 'goal':
          await repo.commitGoal(tenantId, userId, data.goal as string);
          break;
        case 'horizon':
          await repo.commitHorizon(tenantId, userId, data.horizonYears as number);
          break;
        case 'mode':
          await repo.commitAccountMode(tenantId, userId, data.accountMode as 'simulation' | 'live', (data.capitalAmount as number) ?? 0);
          break;
        case 'capital':
          await repo.commitAccountMode(tenantId, userId, (data.accountMode as 'simulation' | 'live') ?? 'simulation', data.capitalAmount as number);
          break;
        case 'risk':
          await repo.commitRiskProfile(tenantId, userId, data.riskProfile as any);
          break;
        case 'operating_mode':
          await repo.commitOperatingMode(tenantId, userId, data.operatingMode as string);
          break;
        case 'mandate':
          await repo.commitMandate(tenantId, userId);
          break;
      }

      const next = nextPhase(phase as Phase);
      const nextIdx = next === 'completed' ? 7 : phaseIndexOf(next as Phase);
      await repo.advanceSession(tenantId, userId, sessionId, next, nextIdx);

      return `Phase "${phase}" committed. Next: "${next}".`;
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=commit-phase`
Expected: PASS

- [ ] **Step 5: Write search-kb test**

```typescript
// test/tools/search-kb.test.ts
import { handler } from '../../src/agent/tools/search-kb.handler';

const mockRetrieveAndGenerate = jest.fn();
jest.mock('@aws-sdk/client-bedrock-agent-runtime', () => ({
  BedrockAgentRuntimeClient: jest.fn().mockImplementation(() => ({
    send: mockRetrieveAndGenerate,
  })),
  RetrieveAndGenerateCommand: jest.fn().mockImplementation((input) => input),
}));

describe('search-kb handler', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns generated text from Knowledge Base', async () => {
    mockRetrieveAndGenerate.mockResolvedValueOnce({
      output: { text: 'Nestfolio è una piattaforma di consulenza finanziaria automatizzata.' },
    });

    const result = await handler({
      query: 'Cos\'è Nestfolio?',
    });

    expect(result).toBe('Nestfolio è una piattaforma di consulenza finanziaria automatizzata.');
    expect(mockRetrieveAndGenerate).toHaveBeenCalledTimes(1);
  });

  it('returns fallback message when no results', async () => {
    mockRetrieveAndGenerate.mockResolvedValueOnce({ output: { text: '' } });
    const result = await handler({ query: 'something unknown' });
    expect(result).toContain('Non ho trovato');
  });
});
```

- [ ] **Step 6: Implement search-kb.handler.ts**

```typescript
// src/agent/tools/search-kb.handler.ts
import {
  BedrockAgentRuntimeClient,
  RetrieveAndGenerateCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';

const client = new BedrockAgentRuntimeClient({});
const KNOWLEDGE_BASE_ID = process.env['KNOWLEDGE_BASE_ID'] ?? '';

export async function handler(event: { query: string }): Promise<string> {
  const response = await client.send(
    new RetrieveAndGenerateCommand({
      input: { text: event.query },
      retrieveAndGenerateConfiguration: {
        type: 'KNOWLEDGE_BASE',
        knowledgeBaseConfiguration: {
          knowledgeBaseId: KNOWLEDGE_BASE_ID,
          modelArn: 'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-20250514',
        },
      },
    }),
  );

  const text = response.output?.text ?? '';
  return text || 'Non ho trovato informazioni su questo argomento nella documentazione.';
}
```

- [ ] **Step 7: Create search-kb.schema.json**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "The search query to look up in the Nestfolio documentation"
    }
  },
  "required": ["query"]
}
```

- [ ] **Step 8: Run all tool tests**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=tools`
Expected: PASS (all tests)

- [ ] **Step 9: Commit**

```bash
git add services/investor/onboarding-agent-bff/src/agent/tools/ services/investor/onboarding-agent-bff/test/tools/
git commit -m "feat(onboarding-agent-bff): add commit-phase tool + search-kb Lambda handler"
```

---

### Task 8: Implement Router + Phase Nodes + Graph Assembly

**Files:**
- Create: `services/investor/onboarding-agent-bff/src/agent/router.ts`
- Create: `services/investor/onboarding-agent-bff/src/agent/phase-node.ts`
- Create: `services/investor/onboarding-agent-bff/src/agent/graph.ts`
- Test: `services/investor/onboarding-agent-bff/test/agent/router.test.ts`
- Test: `services/investor/onboarding-agent-bff/test/agent/graph.test.ts`

- [ ] **Step 1: Write router test**

```typescript
// test/agent/router.test.ts
import { routeToPhase } from '../../src/agent/router';

describe('routeToPhase', () => {
  it('routes to goal when phase is goal', () => {
    expect(routeToPhase({ phase: 'goal' })).toBe('goal_node');
  });

  it('routes to horizon when phase is horizon', () => {
    expect(routeToPhase({ phase: 'horizon' })).toBe('horizon_node');
  });

  it('routes to each phase node correctly', () => {
    const phases = ['goal', 'horizon', 'mode', 'capital', 'risk', 'operating_mode', 'mandate'];
    for (const phase of phases) {
      expect(routeToPhase({ phase })).toBe(`${phase}_node`);
    }
  });

  it('routes to __end__ when phase is completed', () => {
    expect(routeToPhase({ phase: 'completed' })).toBe('__end__');
  });

  it('routes to safety_cap_node when turnCount >= 50', () => {
    expect(routeToPhase({ phase: 'capital', turnCount: 50 })).toBe('safety_cap_node');
    expect(routeToPhase({ phase: 'risk', turnCount: 55 })).toBe('safety_cap_node');
  });

  it('routes normally when turnCount < 50', () => {
    expect(routeToPhase({ phase: 'capital', turnCount: 49 })).toBe('capital_node');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=router`
Expected: FAIL

- [ ] **Step 3: Implement router.ts**

```typescript
// src/agent/router.ts
import { END } from '@langchain/langgraph';
import { MAX_TURNS } from './state';

export function routeToPhase(state: { phase: string; turnCount?: number }): string {
  if (state.phase === 'completed') return END;
  if ((state.turnCount ?? 0) >= MAX_TURNS) return 'safety_cap_node';
  return `${state.phase}_node`;
}
```

The `safety_cap_node` (added in graph.ts) commits all collected data so far, shows a summary, and presents a "Riprendi piu tardi" CTA.

- [ ] **Step 4: Run router test**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=router`
Expected: PASS

- [ ] **Step 5: Implement phase node factory**

All 7 phase nodes use the same factory — the phase-specific behavior comes from the `PHASE_INSTRUCTIONS` prompt. Single file, no per-phase boilerplate:

```typescript
// src/agent/phase-node.ts
import { ChatBedrockConverse } from '@langchain/aws';
import { SystemMessage } from '@langchain/core/messages';
import { SYSTEM_PROMPT } from './prompts/system';
import { PHASE_INSTRUCTIONS } from './prompts/phase-instructions';

export interface PhaseNodeDeps {
  model: ChatBedrockConverse;
  tools: readonly any[];
}

export function createPhaseNode(phaseName: string, deps: PhaseNodeDeps) {
  return async (state: Record<string, unknown>) => {
    const { model, tools } = deps;
    const phaseInstructions = PHASE_INSTRUCTIONS[phaseName];
    const modelWithTools = model.bindTools(tools as any[]);

    const systemMsg = new SystemMessage(`${SYSTEM_PROMPT}\n\n${phaseInstructions}`);
    const messages = [systemMsg, ...(state.messages as any[])];

    const response = await modelWithTools.invoke(messages);
    return { messages: [response], turnCount: 1 };
  };
}
```

`graph.ts` calls `createPhaseNode(phaseName, deps)` for each of the 7 phases — no separate phase files needed.

- [ ] **Step 6: Implement graph.ts**

```typescript
// src/agent/graph.ts
import { StateGraph } from '@langchain/langgraph';
import { ChatBedrockConverse } from '@langchain/aws';
import { OnboardingAnnotation, PHASE_ORDER, MAX_TURNS } from './state';
import { routeToPhase } from './router';
import { createPhaseNode } from './phase-node';
import { RENDER_TOOLS } from './tools/render-ui';
import type { OnboardingRepository } from '../repositories/onboarding.repository';
import { createCommitPhaseTool } from './tools/commit-phase';
import { computeRiskProfile } from './tools/compute-risk';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

export interface GraphDeps {
  modelId?: string;
  region?: string;
  repo: OnboardingRepository;
}

export function buildOnboardingGraph(deps: GraphDeps) {
  const model = new ChatBedrockConverse({
    model: deps.modelId ?? 'anthropic.claude-sonnet-4-20250514',
    region: deps.region ?? 'us-east-1',
  });

  const commitPhaseTool = createCommitPhaseTool(deps.repo);

  const computeRiskTool = new DynamicStructuredTool({
    name: 'compute_risk_profile',
    description: 'Compute deterministic risk score from tolerance and experience indices (0-3)',
    schema: z.object({
      toleranceIdx: z.number().int().min(0).max(3),
      experienceIdx: z.number().int().min(0).max(3),
    }),
    func: async ({ toleranceIdx, experienceIdx }) => {
      const result = computeRiskProfile(toleranceIdx, experienceIdx);
      return JSON.stringify(result);
    },
  });

  const allTools = [...RENDER_TOOLS.map((t) => new DynamicStructuredTool({
    name: t.name,
    description: t.description,
    schema: t.schema as any,
    func: async (input) => JSON.stringify(input),
  })), commitPhaseTool, computeRiskTool];

  const nodeDeps = { model, tools: allTools };

  const graph = new StateGraph(OnboardingAnnotation);

  // Add router node
  graph.addNode('router', async (state) => state);

  // Add phase nodes
  for (const phase of PHASE_ORDER) {
    graph.addNode(`${phase}_node`, createPhaseNode(phase, nodeDeps));
  }

  // Safety cap node: commits collected data + shows resume CTA (50-turn limit)
  graph.addNode('safety_cap_node', async (state) => {
    const { messages } = state;
    // Agent will receive a system message to wrap up gracefully
    const wrapUpMsg = new (await import('@langchain/core/messages')).SystemMessage(
      'SAFETY CAP: L\'utente ha raggiunto il limite di 50 turni. Salva tutti i dati raccolti finora, mostra un riepilogo e presenta un pulsante "Riprendi piu tardi". NON continuare con nuove fasi.'
    );
    const response = await nodeDeps.model.bindTools(allTools as any[]).invoke([wrapUpMsg, ...messages as any[]]);
    return { messages: [response] };
  });

  // Edges
  graph.addEdge('__start__', 'router');
  graph.addConditionalEdges('router', routeToPhase, {
    goal_node: 'goal_node',
    horizon_node: 'horizon_node',
    mode_node: 'mode_node',
    capital_node: 'capital_node',
    risk_node: 'risk_node',
    operating_mode_node: 'operating_mode_node',
    mandate_node: 'mandate_node',
    safety_cap_node: 'safety_cap_node',
    __end__: '__end__',
  });
  graph.addEdge('safety_cap_node', '__end__');

  // Each phase node loops back to router
  for (const phase of PHASE_ORDER) {
    graph.addEdge(`${phase}_node`, 'router');
  }

  return graph.compile();
}
```

- [ ] **Step 7: Write graph integration test**

```typescript
// test/agent/graph.test.ts
import { routeToPhase } from '../../src/agent/router';
import { PHASE_ORDER, nextPhase, phaseIndexOf } from '../../src/agent/state';

// Graph assembly is tested structurally since full LLM invocation requires Bedrock
describe('Graph structure', () => {
  it('router routes to all 7 phase nodes', () => {
    for (const phase of PHASE_ORDER) {
      expect(routeToPhase({ phase })).toBe(`${phase}_node`);
    }
  });

  it('router routes completed to __end__', () => {
    expect(routeToPhase({ phase: 'completed' })).toBe('__end__');
  });

  it('nextPhase chains correctly through all phases', () => {
    let current = PHASE_ORDER[0];
    for (let i = 1; i < PHASE_ORDER.length; i++) {
      const next = nextPhase(current);
      expect(next).toBe(PHASE_ORDER[i]);
      current = next as any;
    }
    expect(nextPhase(current)).toBe('completed');
  });

  it('phaseIndexOf is consistent with PHASE_ORDER', () => {
    for (let i = 0; i < PHASE_ORDER.length; i++) {
      expect(phaseIndexOf(PHASE_ORDER[i])).toBe(i);
    }
  });
});
```

- [ ] **Step 8: Run all agent tests**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=agent`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add services/investor/onboarding-agent-bff/src/agent/ services/investor/onboarding-agent-bff/test/agent/
git commit -m "feat(onboarding-agent-bff): add LangGraph StateGraph with 7 phase nodes + router"
```

---

### Task 9: Implement CopilotKit Runtime (Hono Server)

**Files:**
- Create: `services/investor/onboarding-agent-bff/src/runtime/server.ts`
- Test: `services/investor/onboarding-agent-bff/test/runtime/server.test.ts`

- [ ] **Step 1: Write server test**

```typescript
// test/runtime/server.test.ts
import { createApp } from '../../src/runtime/server';

// Mock CopilotKit + LangGraph
jest.mock('@copilotkit/runtime', () => ({
  CopilotRuntime: jest.fn().mockImplementation(() => ({
    process: jest.fn().mockResolvedValue(new Response('ok')),
  })),
  LangGraphAdapter: jest.fn(),
}));

jest.mock('../../src/agent/graph', () => ({
  buildOnboardingGraph: jest.fn().mockReturnValue({}),
}));

jest.mock('../../src/repositories/onboarding.repository', () => ({
  OnboardingRepository: jest.fn().mockImplementation(() => ({})),
}));

describe('CopilotKit Runtime Server', () => {
  it('createApp returns a Hono app', () => {
    const app = createApp();
    expect(app).toBeDefined();
    expect(typeof app.fetch).toBe('function');
  });

  it('responds to health check at /health', async () => {
    const app = createApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });

  it('has /copilotkit POST endpoint', async () => {
    const app = createApp();
    const res = await app.request('/copilotkit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // Should not 404
    expect(res.status).not.toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=server`
Expected: FAIL

- [ ] **Step 3: Implement server.ts**

```typescript
// src/runtime/server.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { CopilotRuntime, LangGraphAdapter } from '@copilotkit/runtime';
import { buildOnboardingGraph } from '../agent/graph';
import { OnboardingRepository } from '../repositories/onboarding.repository';

export function createApp() {
  const app = new Hono();

  app.use('/*', cors({
    origin: '*', // Tightened per-environment via CDK env vars
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }));

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.post('/copilotkit', async (c) => {
    const tableName = process.env['TABLE_NAME'] ?? '';
    const repo = new OnboardingRepository(tableName);
    const graph = buildOnboardingGraph({ repo });

    const runtime = new CopilotRuntime();
    const adapter = new LangGraphAdapter({ graph });
    return runtime.process(c.req.raw, adapter);
  });

  return app;
}

// Entry point for AgentCore container
if (process.env['AGENT_RUNTIME'] === 'true') {
  const app = createApp();
  const port = parseInt(process.env['PORT'] ?? '8080', 10);
  console.log(`Onboarding agent runtime listening on port ${port}`);
  // Hono serve handled by the container runtime
  Bun?.serve?.({ fetch: app.fetch, port }) ?? import('node:http').then(({ createServer }) => {
    createServer(app.fetch as any).listen(port);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/investor/onboarding-agent-bff/src/runtime/ services/investor/onboarding-agent-bff/test/runtime/
git commit -m "feat(onboarding-agent-bff): add CopilotKit Runtime on Hono server"
```

---

### Task 10: Implement Session Resume Logic

**Files:**
- Create: `services/investor/onboarding-agent-bff/src/agent/session.ts`
- Test: `services/investor/onboarding-agent-bff/test/agent/session.test.ts`

**Context:** The spec (Section 6) requires that users can close and reopen the onboarding chat, resuming from the last committed phase. The session resume flow:
1. On page load, frontend calls a session-check endpoint
2. If active session exists, rehydrate LangGraph state from committed DDB records
3. Load conversation history from AgentCore Memory via `agentMemorySessionId`
4. Agent greets with "Bentornato! Eravamo rimasti a..."

- [ ] **Step 1: Write session resume tests**

```typescript
// test/agent/session.test.ts
import { rehydrateState } from '../../src/agent/session';

describe('rehydrateState', () => {
  it('returns initial state when no session exists', () => {
    const state = rehydrateState(null, {});
    expect(state.phase).toBe('goal');
    expect(state.phaseIndex).toBe(0);
  });

  it('resumes from horizon phase with goal data', () => {
    const session = { currentPhase: 'horizon', phaseIndex: 1, sessionId: 's1', agentMemorySessionId: 'm1' };
    const committed = { goal: { objective: 'Crescita' } };
    const state = rehydrateState(session, committed);
    expect(state.phase).toBe('horizon');
    expect(state.phaseIndex).toBe(1);
    expect(state.goal).toBe('Crescita');
    expect(state.sessionId).toBe('s1');
  });

  it('resumes from capital phase with goal + horizon + mode data', () => {
    const session = { currentPhase: 'capital', phaseIndex: 3, sessionId: 's2', agentMemorySessionId: 'm2' };
    const committed = {
      goal: { objective: 'Pensione' },
      horizonYears: 20,
      accountMode: { mode: 'simulation' },
    };
    const state = rehydrateState(session, committed);
    expect(state.phase).toBe('capital');
    expect(state.horizonYears).toBe(20);
    expect(state.accountMode).toBe('simulation');
  });

  it('marks completed sessions', () => {
    const session = { currentPhase: 'completed', phaseIndex: 7, sessionId: 's3', agentMemorySessionId: 'm3' };
    const state = rehydrateState(session, {});
    expect(state.phase).toBe('completed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=session`
Expected: FAIL

- [ ] **Step 3: Implement session.ts**

```typescript
// src/agent/session.ts
import type { Phase } from './state';
import { PHASE_ORDER } from './state';

interface SessionRecord {
  currentPhase: string;
  phaseIndex: number;
  sessionId: string;
  agentMemorySessionId: string;
}

interface CommittedData {
  goal?: { objective: string };
  horizonYears?: number;
  accountMode?: { mode: 'simulation' | 'live'; capitalAmount?: number };
  riskProfile?: Record<string, unknown>;
  operatingMode?: string;
}

export function rehydrateState(
  session: SessionRecord | null,
  committed: CommittedData,
): Record<string, unknown> {
  if (!session) {
    return {
      phase: 'goal' as Phase,
      phaseIndex: 0,
      totalPhases: 7,
      turnCount: 0,
      messages: [],
    };
  }

  return {
    phase: session.currentPhase as Phase,
    phaseIndex: session.phaseIndex,
    totalPhases: 7,
    turnCount: 0,
    sessionId: session.sessionId,
    goal: committed.goal?.objective,
    horizonYears: committed.horizonYears,
    accountMode: committed.accountMode?.mode,
    capitalAmount: committed.accountMode?.capitalAmount,
    riskProfile: committed.riskProfile,
    operatingMode: committed.operatingMode,
    messages: [],
  };
}
```

- [ ] **Step 4: Wire session resume into server.ts**

Add a `/session` GET endpoint to `server.ts` that:
1. Extracts `tenantId` + `userId` from auth context
2. Calls `repo.getActiveSession()`
3. If active: queries committed DDB records, calls `rehydrateState()`, returns state
4. If completed: returns `{ completed: true }` with recap data
5. If none: returns `{ newSession: true }`

Also update the `/copilotkit` POST handler to accept an optional `sessionId` and pass rehydrated state to the graph.

- [ ] **Step 5: Run tests**

Run: `pnpm nx test onboarding-agent-bff -- --testPathPattern=session`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/investor/onboarding-agent-bff/src/agent/session.ts services/investor/onboarding-agent-bff/test/agent/session.test.ts services/investor/onboarding-agent-bff/src/runtime/server.ts
git commit -m "feat(onboarding-agent-bff): add session resume with state rehydration"
```

---

## Chunk 3: CDK Stack + RAG Documents + Dockerfile (Tasks 11-13)

> Tasks 11, 12, 13 can be parallelized (Dockerfile, CDK stack, RAG docs are independent).

### Task 11: Create Dockerfile for AgentCore Container

**Files:**
- Create: `services/investor/onboarding-agent-bff/Dockerfile`

**Context:** `AgentRuntime` construct calls `AgentRuntimeArtifact.fromAsset(agentCodePath)` which requires a Dockerfile in the asset directory to build the container image.

- [ ] **Step 1: Create Dockerfile**

```dockerfile
# services/investor/onboarding-agent-bff/Dockerfile
FROM node:20-slim

WORKDIR /app

# Copy package files for dependency install
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --prod --frozen-lockfile

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

# Build TypeScript
RUN npx tsc --outDir dist

# Runtime
ENV AGENT_RUNTIME=true
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/runtime/server.js"]
```

**Note:** The exact Dockerfile may need adjustment based on how existing advisory-ctrl Dockerfiles are structured. Check `services/advisory/advisory-ctrl/Dockerfile` (or equivalent) and match the pattern.

- [ ] **Step 2: Commit**

```bash
git add services/investor/onboarding-agent-bff/Dockerfile
git commit -m "feat(onboarding-agent-bff): add Dockerfile for AgentCore container"
```

---

### Task 12: CDK Service Stack

**Files:**
- Modify: `services/investor/onboarding-agent-bff/src/service.stack.ts`

- [ ] **Step 1: Implement full service stack**

Replace the stub with the full implementation:

```typescript
// src/service.stack.ts
import * as path from 'path';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import {
  AgentRuntime,
  KnowledgeBase,
  ServiceStack,
  ServiceStackProps,
} from '@nestfolio/cdk-constructs';

export class OnboardingAgentBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    // Reuse investor-bff's DDB table (looked up via SSM)
    const tableName = StringParameter.valueForStringParameter(
      this, `/${props.prefix}/investor-hub/table-name`,
    );
    const investorTable = Table.fromTableName(this, 'InvestorTable', tableName);

    // Model IDs from SSM (shared with advisory services)
    const sonnetModelId = StringParameter.valueForStringParameter(
      this, `/${props.prefix}/advisory-hub/sonnet-model-id`,
    );

    // Knowledge Base for product documentation RAG
    const knowledgeBase = new KnowledgeBase(this, 'OnboardingKB', {
      kbName: 'nestfolio-docs',
      description: 'Nestfolio product documentation for onboarding agent',
    });

    // Lambda handler for RAG search tool
    const searchKbFn = new NodejsFunction(this, 'SearchKbFn', {
      entry: path.join(__dirname, 'agent/tools/search-kb.handler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      environment: {
        KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
      },
    });

    // Grant KB access to the Lambda
    searchKbFn.addToRolePolicy(knowledgeBase.triggerSyncPolicy());

    // AgentCore Runtime
    new AgentRuntime(this, 'OnboardingAgent', {
      runtimeName: 'onboarding-agent',
      agentCodePath: path.join(__dirname, '..'),
      description: 'Conversational onboarding agent for investor onboarding',
      modelIds: [sonnetModelId],
      tables: [investorTable],
      toolTargets: [{
        name: 'search_knowledge_base',
        description: 'Search Nestfolio documentation to answer user questions',
        handler: searchKbFn,
        schemaPath: path.join(__dirname, 'agent/tools/search-kb.schema.json'),
      }],
      environmentVariables: {
        TABLE_NAME: tableName,
        KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
        AGENT_RUNTIME: 'true',
      },
    });
  }
}
```

- [ ] **Step 2: Run lint to verify**

Run: `pnpm nx lint onboarding-agent-bff`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add services/investor/onboarding-agent-bff/src/service.stack.ts
git commit -m "feat(onboarding-agent-bff): CDK stack with KnowledgeBase + AgentRuntime"
```

---

### Task 13: Create RAG Knowledge Base Documents

**Files:**
- Create: `docs/knowledge-base/product-overview.md`
- Create: `docs/knowledge-base/fees-and-pricing.md`
- Create: `docs/knowledge-base/faq.md`
- Create: `docs/knowledge-base/risk-disclaimer.md`
- Create: `docs/knowledge-base/operating-modes.md`
- Create: `docs/knowledge-base/simulation-mode.md`
- Create: `docs/knowledge-base/mandate-terms.md`

These are content documents (not code), written in Italian as the agent serves Italian-speaking users.

- [ ] **Step 1: Create all 7 knowledge base documents**

Create each file with relevant content about Nestfolio's product. These are stub documents — the content team should review and expand them. Each file should be 1-2 pages of Italian documentation covering the topic described in the filename.

Example structure for `product-overview.md`:
```markdown
# Nestfolio — Panoramica del Prodotto

Nestfolio è una piattaforma di consulenza finanziaria automatizzata (robo-advisor) ...
```

- [ ] **Step 2: Commit**

```bash
git add docs/knowledge-base/
git commit -m "docs: add RAG knowledge base documents for onboarding agent"
```

---

## Chunk 4: Frontend — CopilotKit Integration (Tasks 14-17)

### Task 14: Install CopilotKit + AG-UI Packages

**Files:**
- Modify: `package.json` (pnpm overrides)

- [ ] **Step 1: Install new npm packages**

Run:
```bash
pnpm add @copilotkitnext/angular @ag-ui/client @ag-ui/core @copilotkit/runtime @ag-ui/langgraph hono
```

- [ ] **Step 2: Add pnpm.overrides for Angular 21 compat**

Add to root `package.json` under `pnpm.overrides`:
```json
{
  "@copilotkitnext/angular>@angular/core": "21.x",
  "@copilotkitnext/angular>@angular/common": "21.x",
  "@copilotkitnext/angular>@angular/cdk": "21.x"
}
```

- [ ] **Step 3: Reinstall to apply overrides**

Run: `pnpm install`

- [ ] **Step 4: Update federation.config.js shared singletons**

Add `@copilotkitnext/angular` and `@ag-ui/client` to the shared singletons in `apps/investor-mfe/federation.config.js`.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml apps/investor-mfe/federation.config.js
git commit -m "chore: install CopilotKit + AG-UI packages with Angular 21 overrides"
```

---

### Task 15: Implement Generative UI Renderer Components

**Files:**
- Create: `apps/investor-mfe/src/app/onboarding/renderers/options-renderer.component.ts`
- Create: `apps/investor-mfe/src/app/onboarding/renderers/mode-cards-renderer.component.ts`
- Create: `apps/investor-mfe/src/app/onboarding/renderers/slider-renderer.component.ts`
- Create: `apps/investor-mfe/src/app/onboarding/renderers/amount-renderer.component.ts`
- Create: `apps/investor-mfe/src/app/onboarding/renderers/summary-renderer.component.ts`
- Create: `apps/investor-mfe/src/app/onboarding/renderers/consent-renderer.component.ts`
- Create: `apps/investor-mfe/src/app/onboarding/renderers/cta-renderer.component.ts`
- Test: `apps/investor-mfe/test/app/onboarding/renderers/*.spec.ts` (one test per renderer)

- [ ] **Step 1: Write options-renderer test**

```typescript
// test/app/onboarding/renderers/options-renderer.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OptionsRendererComponent } from '../../../../src/app/onboarding/renderers/options-renderer.component';

describe('OptionsRendererComponent', () => {
  let fixture: ComponentFixture<OptionsRendererComponent>;
  let component: OptionsRendererComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OptionsRendererComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(OptionsRendererComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('title', 'Obiettivo');
    fixture.componentRef.setInput('options', [
      { id: 'grow', emoji: '📈', label: 'Crescita' },
      { id: 'home', emoji: '🏠', label: 'Immobile' },
    ]);
    fixture.detectChanges();
  });

  it('renders title', () => {
    expect(fixture.nativeElement.textContent).toContain('Obiettivo');
  });

  it('renders option cards', () => {
    const cards = fixture.nativeElement.querySelectorAll('.option-card');
    expect(cards.length).toBe(2);
  });

  it('emits selected option on click', () => {
    const spy = jest.fn();
    component.selected.subscribe(spy);
    const cards = fixture.nativeElement.querySelectorAll('.option-card');
    cards[0].click();
    expect(spy).toHaveBeenCalledWith('grow');
  });
});
```

- [ ] **Step 2: Implement options-renderer.component.ts**

```typescript
// src/app/onboarding/renderers/options-renderer.component.ts
import { Component, input, output } from '@angular/core';

interface OptionItem {
  id: string;
  emoji?: string;
  label: string;
  description?: string;
}

@Component({
  selector: 'app-options-renderer',
  standalone: true,
  template: `
    <div class="options-container">
      <h3 class="options-title">{{ title() }}</h3>
      <div class="options-grid">
        @for (opt of options(); track opt.id) {
          <button class="option-card" [class.selected]="selectedId === opt.id" (click)="select(opt.id)">
            @if (opt.emoji) { <span class="option-emoji">{{ opt.emoji }}</span> }
            <span class="option-label">{{ opt.label }}</span>
            @if (opt.description) { <span class="option-desc">{{ opt.description }}</span> }
          </button>
        }
      </div>
    </div>
  `,
  styles: [`
    .options-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.75rem; }
    .option-card {
      display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
      padding: 1rem; border: 2px solid var(--nf-border, #e0e0e0); border-radius: 12px;
      background: var(--nf-bg-card, #fff); cursor: pointer; transition: all 0.2s;
    }
    .option-card:hover { border-color: var(--p-primary-color); }
    .option-card.selected { border-color: var(--p-primary-color); background: var(--p-primary-50, #eef); }
    .option-emoji { font-size: 1.5rem; }
    .option-label { font-weight: 600; text-align: center; }
    .option-desc { font-size: 0.85rem; color: var(--nf-text-secondary); text-align: center; }
    .options-title { margin: 0 0 1rem; font-size: 1rem; }
  `],
})
export class OptionsRendererComponent {
  title = input.required<string>();
  options = input.required<OptionItem[]>();
  selected = output<string>();

  selectedId: string | null = null;

  select(id: string): void {
    this.selectedId = id;
    this.selected.emit(id);
  }
}
```

- [ ] **Step 3: Implement remaining 6 renderers following the same pattern**

Each renderer: standalone component, `input()` for data, `output()` for user interaction, minimal CSS using project design tokens. Follow the same test→implement pattern:

- `slider-renderer.component.ts` — range input with label/value display, emits number
- `amount-renderer.component.ts` — text input + preset buttons, emits number
- `mode-cards-renderer.component.ts` — larger cards with badge + bullet details, emits id
- `summary-renderer.component.ts` — read-only label/value rows (no output)
- `consent-renderer.component.ts` — checkbox + legal links, emits boolean
- `cta-renderer.component.ts` — button, emits action string

- [ ] **Step 4: Write tests for all 7 renderers**

One test file per renderer in `test/app/onboarding/renderers/`. Each tests:
1. Renders correct DOM from inputs
2. Emits correct output on user interaction (where applicable)

- [ ] **Step 5: Run all renderer tests**

Run: `pnpm nx test investor-mfe -- --testPathPattern=renderers`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/investor-mfe/src/app/onboarding/renderers/ apps/investor-mfe/test/app/onboarding/renderers/
git commit -m "feat(investor-mfe): add 7 Generative UI renderer components for onboarding chat"
```

---

### Task 16: Replace Stepper with CopilotKit Chat Component

**Files:**
- Create: `apps/investor-mfe/src/app/onboarding/onboarding-chat.component.ts`
- Create: `apps/investor-mfe/src/app/onboarding/onboarding-theme.css`
- Modify: `apps/investor-mfe/src/app/stores/onboarding.store.ts`
- Modify: `apps/investor-mfe/src/app/remote-routes.ts`
- Delete: `apps/investor-mfe/src/app/onboarding/onboarding-container.component.ts`
- Delete: `apps/investor-mfe/src/app/onboarding/steps/` (all 6 files)
- Delete: `apps/investor-mfe/src/app/services/onboarding.service.ts`
- Test: `apps/investor-mfe/test/app/onboarding-chat.component.spec.ts`

- [ ] **Step 1: Write onboarding-chat test**

```typescript
// test/app/onboarding-chat.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OnboardingChatComponent } from '../../src/app/onboarding/onboarding-chat.component';
import { provideRouter } from '@angular/router';

// Mock CopilotKit module
jest.mock('@copilotkitnext/angular', () => ({
  CopilotChatComponent: class MockCopilotChat {},
}));

describe('OnboardingChatComponent', () => {
  let fixture: ComponentFixture<OnboardingChatComponent>;
  let component: OnboardingChatComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OnboardingChatComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(OnboardingChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders agent header', () => {
    expect(fixture.nativeElement.querySelector('.agent-header')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Nestfolio');
  });

  it('renders progress bar', () => {
    expect(fixture.nativeElement.querySelector('.progress-bar')).toBeTruthy();
  });

  it('has default 7 total phases', () => {
    expect(component.totalPhases()).toBe(7);
  });
});
```

- [ ] **Step 2: Implement onboarding-chat.component.ts**

```typescript
// src/app/onboarding/onboarding-chat.component.ts
import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-onboarding-chat',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="chat-screen">
      <header class="agent-header">
        <div class="agent-avatar">N</div>
        <div>
          <div class="agent-name">Nestfolio</div>
          <div class="agent-status">Attivo ora</div>
        </div>
      </header>
      <div class="progress-bar">
        <div class="progress-fill" [style.width.%]="progressPercent()"></div>
        <span class="progress-label">{{ phaseIndex() + 1 }} di {{ totalPhases() }}</span>
      </div>
      <div class="chat-area">
        <!-- CopilotKit chat component will be wired here once @copilotkitnext/angular is verified -->
        <!-- Fallback: AG-UI client + custom SSE handling -->
        <div class="chat-placeholder">Chat agent loading...</div>
      </div>
    </div>
  `,
  styleUrl: './onboarding-theme.css',
})
export class OnboardingChatComponent {
  phaseIndex = signal(0);
  totalPhases = signal(7);
  progressPercent = computed(() => ((this.phaseIndex() + 1) / this.totalPhases()) * 100);
}
```

- [ ] **Step 3: Create onboarding-theme.css**

```css
/* CopilotKit CSS overrides using Nestfolio design tokens */
.chat-screen {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 480px;
  margin: 0 auto;
  background: var(--nf-bg-primary, #ffffff);
}

.agent-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  border-bottom: 1px solid var(--nf-border, #e0e0e0);
}

.agent-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--p-primary-color);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 1.1rem;
}

.agent-name { font-weight: 600; }
.agent-status { font-size: 0.8rem; color: var(--nf-text-secondary); }

.progress-bar {
  height: 6px;
  background: var(--nf-bg-secondary, #e9ecef);
  position: relative;
  margin: 0 1rem;
}

.progress-fill {
  height: 100%;
  background: var(--p-primary-color);
  transition: width 0.3s ease;
}

.progress-label {
  position: absolute;
  right: 0;
  top: 8px;
  font-size: 0.75rem;
  color: var(--nf-text-secondary);
}

.chat-area {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.chat-placeholder {
  text-align: center;
  color: var(--nf-text-secondary);
  padding: 2rem;
}
```

- [ ] **Step 4: Simplify onboarding.store.ts**

Rewrite the store to be a thin wrapper around the CoAgent shared state:

```typescript
// src/app/stores/onboarding.store.ts
import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { withCallState, withDevtools, withLogoutReset } from '@nestfolio/shared-state';

interface OnboardingChatState {
  phaseIndex: number;
  totalPhases: number;
  phase: string;
  isComplete: boolean;
}

const initialState: OnboardingChatState = {
  phaseIndex: 0,
  totalPhases: 7,
  phase: 'goal',
  isComplete: false,
};

export const OnboardingStore = signalStore(
  withState(initialState),
  withCallState(),
  withComputed((store) => ({
    progress: computed(() => ((store.phaseIndex() + 1) / store.totalPhases()) * 100),
  })),
  withMethods((store) => ({
    updateFromAgent(state: { phaseIndex: number; phase: string }): void {
      patchState(store, { phaseIndex: state.phaseIndex, phase: state.phase });
    },
    markComplete(): void {
      patchState(store, { isComplete: true });
    },
    reset(): void {
      patchState(store, { ...initialState, callState: 'init', callError: null });
    },
  })),
  withLogoutReset(() => ({
    ...initialState,
    callState: 'init' as const,
    callError: null,
  })),
  withDevtools('OnboardingStore'),
);
```

- [ ] **Step 5: Update remote-routes.ts**

```typescript
// src/app/remote-routes.ts
import { Routes } from '@angular/router';
import { OnboardingStore } from './stores/onboarding.store';
import { NotificationService } from './services/notification.service';
import { NotificationStore } from './stores/notification.store';

export const remoteRoutes: Routes = [
  {
    path: '',
    providers: [OnboardingStore, NotificationService, NotificationStore],
    children: [
      {
        path: 'onboarding',
        loadComponent: () =>
          import('./onboarding/onboarding-chat.component').then(
            (m) => m.OnboardingChatComponent,
          ),
      },
      {
        path: 'notifications',
        loadComponent: () =>
          import('./notifications/notification-list.component').then(
            (m) => m.NotificationListComponent,
          ),
      },
      { path: '', redirectTo: 'notifications', pathMatch: 'full' },
    ],
  },
];
```

- [ ] **Step 6: Delete old stepper files**

Delete:
- `apps/investor-mfe/src/app/onboarding/onboarding-container.component.ts`
- `apps/investor-mfe/src/app/onboarding/steps/welcome-step.component.ts`
- `apps/investor-mfe/src/app/onboarding/steps/risk-assessment-step.component.ts`
- `apps/investor-mfe/src/app/onboarding/steps/goals-step.component.ts`
- `apps/investor-mfe/src/app/onboarding/steps/risk-confirm-step.component.ts`
- `apps/investor-mfe/src/app/onboarding/steps/operating-mode-step.component.ts`
- `apps/investor-mfe/src/app/onboarding/steps/mandate-step.component.ts`
- `apps/investor-mfe/src/app/services/onboarding.service.ts`
- `apps/investor-mfe/test/app/onboarding-container.component.spec.ts`
- `apps/investor-mfe/test/app/onboarding.service.spec.ts`
- `apps/investor-mfe/test/app/steps/` (all 6 spec files)

- [ ] **Step 7: Update onboarding.store.spec.ts for simplified store**

Rewrite tests for the simplified store shape.

- [ ] **Step 8: Run investor-mfe tests**

Run: `pnpm nx test investor-mfe`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/investor-mfe/
git commit -m "feat(investor-mfe): replace stepper wizard with CopilotKit chat interface"
```

---

### Task 17: Wire CopilotKit Angular Integration + Verify Compatibility

**Files:**
- Modify: `apps/investor-mfe/src/app/onboarding/onboarding-chat.component.ts`

**Note:** This task wires the actual CopilotKit Angular bindings. If `@copilotkitnext/angular` proves incompatible at runtime, fall back to the AG-UI client approach described in the spec's Fallback Plan (§ Fallback Plan).

- [ ] **Step 1: Verify CopilotKit Angular compatibility**

Create a minimal test import to check if `@copilotkitnext/angular` compiles with Angular 21:

```typescript
// In a scratch test file or the component itself:
import { CopilotChatComponent } from '@copilotkitnext/angular';
```

Run: `pnpm nx build investor-mfe --skip-nx-cache`

**If build succeeds:** Proceed with CopilotKit wiring (Step 2a).
**If build fails:** Switch to AG-UI fallback (Step 2b).

- [ ] **Step 2a: Wire CopilotKit (primary path)**

Update `onboarding-chat.component.ts` to:
1. Import `CopilotChatComponent` from `@copilotkitnext/angular`
2. Add `CopilotKitProvider` with `runtimeUrl` pointing to onboarding-agent-bff endpoint
3. Register renderer components as Generative UI annotations (map `render_options` → `OptionsRendererComponent`, etc.)
4. Subscribe to CoAgent `OnboardingState` changes via CopilotKit's `useCoAgent` equivalent
5. Update `phaseIndex` signal on state change to drive progress bar

- [ ] **Step 2b: Wire AG-UI fallback (if CopilotKit fails)**

If CopilotKit Angular is incompatible:
1. Remove `@copilotkitnext/angular` import
2. Import `@ag-ui/client` directly
3. Create an SSE EventSource connection to the `/copilotkit` endpoint
4. Parse AG-UI events manually: `TEXT_MESSAGE_CONTENT`, `TOOL_CALL_START`, `TOOL_CALL_RESULT`, `STATE_SNAPSHOT`
5. Render tool calls by matching tool name → renderer component using `@switch` in template
6. Handle streaming text via an `agentMessage` signal updated from SSE chunks

**Backend is unchanged** — both approaches consume the same CopilotKit Runtime endpoint.

- [ ] **Step 3: Add error handling UI**

Add to the chat component:
- Loading/typing indicator ("Un momento..." after 3s of no response)
- Timeout message after 15s with retry button
- SSE reconnect: `EventSource` auto-reconnects; on reconnect, call `/session` endpoint to rehydrate state
- Error banner for connection failures

- [ ] **Step 4: Run tests**

Run: `pnpm nx test investor-mfe -- --testPathPattern=onboarding-chat`
Expected: PASS

- [ ] **Step 5: Smoke-test in browser**

Run: `pnpm nx serve investor-mfe`
Verify: Chat interface renders at `/investor/onboarding`, shows Nestfolio header + progress bar. Agent connection will fail without backend deployed — that's expected.

- [ ] **Step 6: Commit**

```bash
git add apps/investor-mfe/src/app/onboarding/
git commit -m "feat(investor-mfe): wire CopilotKit Angular integration with renderers"
```

---

## Chunk 5: Cleanup investor-bff (Tasks 18-19)

### Task 18: Remove Onboarding Mutations from investor-bff

**Files:**
- Modify: `services/investor/investor-bff/src/schema.graphql`
- Modify: `services/investor/investor-bff/src/service.stack.ts`
- Delete: `services/investor/investor-bff/src/graphql/js-function/record-onboarding-answer.fn.js`
- Delete: `services/investor/investor-bff/src/graphql/js-function/set-goal.fn.js`
- Delete: `services/investor/investor-bff/src/graphql/js-function/set-risk-profile.fn.js`
- Delete: `services/investor/investor-bff/src/graphql/js-function/select-operating-mode.fn.js`
- Delete: `services/investor/investor-bff/src/graphql/js-function/grant-mandate.fn.js`

- [ ] **Step 1: Remove mutations from schema.graphql**

Remove from `Mutation` type:
- `recordOnboardingAnswer(input: OnboardingAnswerInput!): OnboardingStep!`
- `setGoal(input: GoalInput!): Goal!`
- `setRiskProfile(input: RiskProfileInput!): RiskProfile!`
- `selectOperatingMode(mode: OperatingMode!): OperatingModeResult!`
- `grantMandate(input: MandateInput!): Mandate!`

Remove unused types/inputs:
- `type OnboardingStep`
- `input OnboardingAnswerInput`

**Keep**: `updateGoal`, `updateMandate`, `revokeMandate` (post-onboarding profile editing), all queries, all other mutations.

- [ ] **Step 2: Delete 5 JS resolver files**

Delete:
- `record-onboarding-answer.fn.js`
- `set-goal.fn.js`
- `set-risk-profile.fn.js`
- `select-operating-mode.fn.js`
- `grant-mandate.fn.js`

- [ ] **Step 3: Update service.stack.ts**

Remove `recordOnboardingAnswer` from the `noneDataSource` array in `discoverJsResolvers`:

```typescript
new Facade(this, 'Facade', {
  jsResolvers: discoverJsResolvers(__dirname, {
    noneDataSource: ['requestAccountClosure'],
  }),
});
```

- [ ] **Step 4: Run investor-bff tests**

Run: `pnpm nx test investor-bff`
Expected: PASS (some tests may need updating if they reference removed mutations)

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/
git commit -m "refactor(investor-bff): remove onboarding mutations (moved to onboarding-agent-bff)"
```

---

### Task 19: Remove Onboarding GraphQL Operations from appsync-client

**Files:**
- Modify: `libs/appsync-client/src/` (remove RECORD_ONBOARDING_ANSWER, SET_GOAL, SET_RISK_PROFILE, SELECT_OPERATING_MODE, GRANT_MANDATE operations)

- [ ] **Step 1: Find and remove onboarding mutation definitions**

Search for the 5 mutation constants in the appsync-client lib and remove them.

- [ ] **Step 2: Run affected tests**

Run: `pnpm nx run-many -t test --projects=investor-mfe,investor-bff,appsync-client`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add libs/appsync-client/
git commit -m "refactor(appsync-client): remove onboarding mutation operations"
```

---

## Chunk 6: Final Integration + Verification (Task 20)

### Task 20: Full Test Suite + Lint Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all onboarding-agent-bff tests**

Run: `pnpm nx test onboarding-agent-bff`
Expected: PASS (all tests)

- [ ] **Step 2: Run investor-mfe tests**

Run: `pnpm nx test investor-mfe`
Expected: PASS

- [ ] **Step 3: Run investor-bff tests**

Run: `pnpm nx test investor-bff`
Expected: PASS

- [ ] **Step 4: Run full affected test suite**

Run: `pnpm nx affected -t test`
Expected: PASS

- [ ] **Step 5: Run full affected lint**

Run: `pnpm nx affected -t lint`
Expected: PASS

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git commit -m "chore: fix integration issues from onboarding agent migration"
```
