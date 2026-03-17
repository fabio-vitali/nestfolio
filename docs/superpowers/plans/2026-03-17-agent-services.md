# Agent Services — Implementation Plan (Plan 4/5)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create 4 agent services with dedicated Bedrock Knowledge Bases for RAG. Each service runs focused agents, receives trigger events carrying a `taskToken` from the decision-workflow-ctrl Step Functions orchestrator, and returns completion events echoing that `taskToken` for `SendTaskSuccess`. KB ingestion pipelines consume adapter feed events and own-service CDC output.

**Architecture:** Services are split by KB boundary — agents that share a knowledge domain live in the same service. investor-profile-ctrl clusters user-goals + risk-assessment (regulatory KB), market-intelligence-ctrl runs market-research (market KB), portfolio-engine-ctrl runs portfolio-construction + rebalance-planner (fund KB), advisory-narrative-ctrl runs explainability (feedback KB). Each service follows the existing advisory-ctrl pattern: `createEventHandler` + handler map, `ServiceStack` CDK construct, DDB State table, Ingress/Egress, plus the new `KnowledgeBase` construct (Plan 2) and generic `createOrchestrator`/`createAgentNode` from agent-core (Plan 1).

**Tech Stack:** TypeScript, LangGraph.js, Bedrock (ChatBedrockConverse), Zod, CDK, Jest

**Spec:** `docs/superpowers/specs/2026-03-17-advisory-agent-topology-design.md`

**Chunks:** 4 total. This file contains Chunks 1-2 (investor-profile-ctrl + market-intelligence-ctrl). Chunks 3-4 (portfolio-engine-ctrl + advisory-narrative-ctrl) will be appended.

---

## File Structure

### investor-profile-ctrl — files to CREATE

| File | Purpose |
|---|---|
| `services/advisory/investor-profile-ctrl/project.json` | Nx project config (tags: scope:advisory, type:service) |
| `services/advisory/investor-profile-ctrl/tsconfig.json` | Extends root tsconfig, paths |
| `services/advisory/investor-profile-ctrl/jest.config.ts` | Jest config (testEnvironment: node) |
| `services/advisory/investor-profile-ctrl/src/domain/events.ts` | Event type constants + Zod schemas |
| `services/advisory/investor-profile-ctrl/src/domain/models.ts` | AgentInvocation, ReasoningOutput, InvestorProfileResult types |
| `services/advisory/investor-profile-ctrl/src/domain/index.ts` | Barrel export |
| `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts` | Routes ANALYZE_INVESTOR_PROFILE → agent pipeline |
| `services/advisory/investor-profile-ctrl/src/handlers/kb-ingestion-handler.ts` | Routes DECISION_BLOCKED/APPROVED → S3 → KB sync |
| `services/advisory/investor-profile-ctrl/src/services/investor-profile.service.ts` | Agent pipeline: parallel user-goals + risk-assessment via createOrchestrator |
| `services/advisory/investor-profile-ctrl/src/agents/user-goals.config.ts` | AgentConfig for user-goals (Haiku, 2048 tokens, temp 0.0) |
| `services/advisory/investor-profile-ctrl/src/agents/risk-assessment.config.ts` | AgentConfig for risk-assessment (Opus, 4096 tokens, temp 0.1) |
| `services/advisory/investor-profile-ctrl/src/agents/schemas.ts` | Zod output schemas for both agents |
| `services/advisory/investor-profile-ctrl/src/agents/prompts.ts` | Prompt templates for both agents |
| `services/advisory/investor-profile-ctrl/src/service.stack.ts` | CDK stack with Ingress, Egress, KnowledgeBase, AgentRuntime |
| `services/advisory/investor-profile-ctrl/test/event-listener.spec.ts` | Handler routing + agent invocation tests |
| `services/advisory/investor-profile-ctrl/test/kb-ingestion-handler.spec.ts` | KB ingestion tests |
| `services/advisory/investor-profile-ctrl/test/investor-profile.service.spec.ts` | Orchestrator + agent pipeline tests |
| `services/advisory/investor-profile-ctrl/test/service.stack.spec.ts` | CDK snapshot test |

### market-intelligence-ctrl — files to CREATE

| File | Purpose |
|---|---|
| `services/advisory/market-intelligence-ctrl/project.json` | Nx project config |
| `services/advisory/market-intelligence-ctrl/tsconfig.json` | Extends root tsconfig |
| `services/advisory/market-intelligence-ctrl/jest.config.ts` | Jest config |
| `services/advisory/market-intelligence-ctrl/src/domain/events.ts` | Event type constants + Zod schemas |
| `services/advisory/market-intelligence-ctrl/src/domain/models.ts` | AgentInvocation, ReasoningOutput, MarketAnalysisResult types |
| `services/advisory/market-intelligence-ctrl/src/domain/index.ts` | Barrel export |
| `services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts` | Routes ANALYZE_MARKET → agent, feed events → kb-ingestion |
| `services/advisory/market-intelligence-ctrl/src/handlers/kb-ingestion-handler.ts` | 5 feed events → S3 → KB sync (90-day retention) |
| `services/advisory/market-intelligence-ctrl/src/handlers/tools/market-data.handler.ts` | Tool Lambda: live indices/volatility (moved from advisory-ctrl) |
| `services/advisory/market-intelligence-ctrl/src/handlers/tools/instrument-universe.handler.ts` | Tool Lambda: approved instruments (moved from advisory-ctrl) |
| `services/advisory/market-intelligence-ctrl/src/services/market-intelligence.service.ts` | Single agent: createAgentNode + withRetry + withFallback |
| `services/advisory/market-intelligence-ctrl/src/agents/market-research.config.ts` | AgentConfig for market-research (Sonnet, 4096 tokens, temp 0.2) |
| `services/advisory/market-intelligence-ctrl/src/agents/schemas.ts` | Zod output schema |
| `services/advisory/market-intelligence-ctrl/src/agents/prompts.ts` | Prompt template |
| `services/advisory/market-intelligence-ctrl/src/service.stack.ts` | CDK stack with KnowledgeBase (90-day retention), tool Lambdas |
| `services/advisory/market-intelligence-ctrl/test/event-listener.spec.ts` | Handler routing tests |
| `services/advisory/market-intelligence-ctrl/test/kb-ingestion-handler.spec.ts` | KB ingestion + retention tests |
| `services/advisory/market-intelligence-ctrl/test/market-intelligence.service.spec.ts` | Agent pipeline tests |
| `services/advisory/market-intelligence-ctrl/test/tools/market-data.handler.spec.ts` | Tool Lambda tests |
| `services/advisory/market-intelligence-ctrl/test/tools/instrument-universe.handler.spec.ts` | Tool Lambda tests |
| `services/advisory/market-intelligence-ctrl/test/service.stack.spec.ts` | CDK snapshot test |

---

## Chunk 1 — investor-profile-ctrl

### Task 1.1 — Scaffold project

- [ ] Create `services/advisory/investor-profile-ctrl/project.json`:

```json
{
  "name": "investor-profile-ctrl",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "services/advisory/investor-profile-ctrl/src",
  "projectType": "application",
  "tags": ["scope:advisory", "type:service"],
  "targets": {
    "build": {
      "executor": "@nx/esbuild:esbuild",
      "options": {
        "outputPath": "dist/services/advisory/investor-profile-ctrl",
        "main": "services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts",
        "tsConfig": "services/advisory/investor-profile-ctrl/tsconfig.json",
        "platform": "node",
        "format": ["cjs"],
        "additionalEntryPoints": [
          "services/advisory/investor-profile-ctrl/src/handlers/kb-ingestion-handler.ts"
        ]
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": {
        "jestConfig": "services/advisory/investor-profile-ctrl/jest.config.ts"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  }
}
```

- [ ] Create `tsconfig.json` extending `../../../tsconfig.base.json`
- [ ] Create `jest.config.ts` with `testEnvironment: 'node'`, `transform` using `ts-jest`, `moduleNameMapper` for `@nestfolio/*` paths

```
npx nx test investor-profile-ctrl  # expect 0 tests, 0 failures
```

**Commit:** `chore(investor-profile-ctrl): scaffold Nx project`

### Task 1.2 — Service domain (events + models)

- [ ] Create `src/domain/events.ts`:

```ts
// Input event from decision-workflow-ctrl
export const InvestorProfileEventTypes = {
  ANALYZE_INVESTOR_PROFILE: 'ANALYZE_INVESTOR_PROFILE',
} as const;

// Output events
export const InvestorProfileOutputEvents = {
  INVESTOR_PROFILE_COMPLETED: 'INVESTOR_PROFILE_COMPLETED',
  GOAL_INTERPRETATION_PRODUCED: 'GOAL_INTERPRETATION_PRODUCED',
  RISK_EVALUATION_PRODUCED: 'RISK_EVALUATION_PRODUCED',
} as const;

// KB ingestion triggers (from compliance-ctrl)
export const KBIngestionEventTypes = {
  DECISION_BLOCKED: 'DECISION_BLOCKED',
  DECISION_APPROVED: 'DECISION_APPROVED',
} as const;
```

- [ ] Create `src/domain/models.ts` with interfaces: `InvestorProfileInput` (tenantId, decisionId, taskToken, investorProfile, portfolioState), `GoalInterpretation`, `RiskEvaluation`, `InvestorProfileResult` (goals + risk + metadata)
- [ ] Create `src/domain/index.ts` barrel

**Commit:** `feat(investor-profile-ctrl): add service domain events and models`

### Task 1.3 — Agent configs, schemas, and prompts

- [ ] Create `src/agents/schemas.ts` — Zod schemas for GoalInterpretation and RiskEvaluation output types
- [ ] Create `src/agents/prompts.ts` — prompt templates for user-goals and risk-assessment agents. Each template receives investor profile context and returns system + user messages
- [ ] Create `src/agents/user-goals.config.ts`:

```ts
import type { AgentConfig } from '@nestfolio/agent-core';
import { GoalInterpretationSchema } from './schemas';
import { userGoalsPrompt } from './prompts';

export const userGoalsConfig: AgentConfig<GoalInterpretation> = {
  name: 'user-goals',
  modelTier: 'haiku',
  maxTokens: 2048,
  temperature: 0.0,
  outputSchema: GoalInterpretationSchema,
  promptTemplate: userGoalsPrompt,
};
```

- [ ] Create `src/agents/risk-assessment.config.ts` — same pattern, modelTier `'opus'`, maxTokens 4096, temp 0.1, RiskEvaluationSchema

**Commit:** `feat(investor-profile-ctrl): add agent configs, Zod schemas, and prompts`

### Task 1.4 — Agent pipeline service

- [ ] Create `src/services/investor-profile.service.ts`:

Key pattern — parallel orchestration using `createOrchestrator`:

```ts
import { createOrchestrator, invokeOrchestrator } from '@nestfolio/agent-core';
import { userGoalsConfig } from '../agents/user-goals.config';
import { riskAssessmentConfig } from '../agents/risk-assessment.config';

const orchestrator = createOrchestrator({
  name: 'investor-profile',
  waves: [
    {
      name: 'analyze',
      agents: [userGoalsConfig, riskAssessmentConfig], // parallel
    },
  ],
});

export const createInvestorProfileService = (deps: InvestorProfileDeps) => ({
  async analyzeProfile(input: InvestorProfileInput): Promise<InvestorProfileResult> {
    const result = await invokeOrchestrator(orchestrator, {
      tenantId: input.tenantId,
      decisionId: input.decisionId,
      context: { investorProfile: input.investorProfile, portfolioState: input.portfolioState },
    });
    // Persist AgentInvocation + ReasoningOutput to DDB
    await deps.repository.saveInvocation(input.tenantId, input.decisionId, result);
    return mapToProfileResult(result);
  },
});
```

- [ ] Write `test/investor-profile.service.spec.ts`:
  - Mock `createOrchestrator` and `invokeOrchestrator`
  - Test: calls orchestrator with correct context, persists invocation, maps result
  - Test: propagates orchestrator errors

```
npx nx test investor-profile-ctrl --testPathPattern=investor-profile.service
```

**Commit:** `feat(investor-profile-ctrl): add investor profile agent pipeline service`

### Task 1.5 — Event listener + KB ingestion handler

- [ ] Create `src/handlers/event-listener.ts`:

```ts
import { createEventHandler, skip, requireEnv } from '@nestfolio/event-processor';
import { InvestorProfileEventTypes, KBIngestionEventTypes } from '../domain/events';
import { createInvestorProfileService } from '../services/investor-profile.service';

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload, ctx) => Promise<ReturnType<typeof skip>>> = {};

  // Trigger event → run agent pipeline, emit completion
  handlers[InvestorProfileEventTypes.ANALYZE_INVESTOR_PROFILE] = async (payload, ctx) => {
    const result = await deps.profileService.analyzeProfile({
      tenantId: ctx.tenantId,
      decisionId: payload.subject.decisionId,
      taskToken: payload.subject.taskToken,
      investorProfile: payload.subject.investorProfile,
      portfolioState: payload.subject.portfolioState,
    });
    await deps.eventPublisher.publish('INVESTOR_PROFILE_COMPLETED', {
      decisionId: payload.subject.decisionId,
      taskToken: payload.subject.taskToken,
      result,
    });
    return skip();
  };

  // KB ingestion events → forward to kb-ingestion-handler (separate Lambda)
  // These are routed by Ingress to the kb-ingestion-handler Lambda, not here
  return handlers;
};

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
// ... DDB client, repository, service, deps
export const handler = createEventHandler({
  serviceName: 'investor-profile-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'INVESTOR_PROFILE_CTRL_FAILED',
});
```

- [ ] Create `src/handlers/kb-ingestion-handler.ts`:

```ts
// Receives DECISION_BLOCKED, DECISION_APPROVED from compliance-ctrl
// 1. Build compliance narrative string from event payload
// 2. Write to S3 bucket (key: `compliance/{decisionId}.txt`)
// 3. Trigger KB sync via StartIngestionJob API
export const handler = createEventHandler({
  serviceName: 'investor-profile-ctrl-kb',
  handlers: createKBIngestionHandlers(deps),
  table: requireEnv('TABLE_NAME'),
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'INVESTOR_PROFILE_KB_INGESTION_FAILED',
});
```

- [ ] Write `test/event-listener.spec.ts`:
  - Test: ANALYZE_INVESTOR_PROFILE routes to profileService.analyzeProfile
  - Test: publishes INVESTOR_PROFILE_COMPLETED with taskToken
  - Test: unknown event type is ignored

- [ ] Write `test/kb-ingestion-handler.spec.ts`:
  - Test: DECISION_BLOCKED writes narrative to S3, triggers KB sync
  - Test: DECISION_APPROVED writes narrative to S3, triggers KB sync

```
npx nx test investor-profile-ctrl
```

**Commit:** `feat(investor-profile-ctrl): add event listener and KB ingestion handler`

### Task 1.6 — CDK service stack

- [ ] Create `src/service.stack.ts`:

```ts
import { KnowledgeBase, ServiceStack, Ingress, Egress, AgentRuntime, defaultLambdaProps, createNamingService } from '@nestfolio/cdk-constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { join } from 'path';

export class InvestorProfileCtrlStack extends ServiceStack {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props, prefix: props.prefix,
      subsystem: 'advisory', service: 'investor-profile-ctrl', serviceDir: __dirname,
    });

    // Ingress: trigger event + KB ingestion events
    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: ['ANALYZE_INVESTOR_PROFILE', 'DECISION_BLOCKED', 'DECISION_APPROVED'],
    });

    // Egress: CDC events
    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['AgentInvocation', 'ReasoningOutput'],
      handlerEntry: join(__dirname, 'handlers/event-publisher-cdc.ts'),
      customEventTypeMap: {
        AgentInvocation: { GOAL_INTERPRETATION_PRODUCED: 'INSERT', RISK_EVALUATION_PRODUCED: 'INSERT' },
      },
    });

    // Knowledge Base: Regulatory & Compliance
    const kb = new KnowledgeBase(this, 'RegulatoryKB', {
      name: 'regulatory-compliance',
      bucketPrefix: 'kb-regulatory',
      description: 'Regulatory frameworks, suitability rules, compliance precedents',
    });

    // KB ingestion Lambda (separate from event-listener)
    const kbIngestionFn = new NodejsFunction(this, 'KBIngestion', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'kb-ingestion-handler.ts'),
      environment: {
        KB_BUCKET: kb.bucket.bucketName,
        KB_ID: kb.knowledgeBaseId,
        TABLE_NAME: this.state.getTable().tableName,
        BUS_NAME: ingress.bus.eventBusName,
      },
    });
    kb.bucket.grantWrite(kbIngestionFn);
    kb.grantStartIngestion(kbIngestionFn);

    // Route KB events to ingestion handler
    ingress.addTarget(kbIngestionFn, {
      eventTypes: ['DECISION_BLOCKED', 'DECISION_APPROVED'],
    });

    // Model SSM params from advisory-hub
    const hubNaming = createNamingService(this, { subsystem: 'advisory', service: 'advisory-hub' });
    const modelOpusId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/opus'));
    const modelHaikuId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/haiku'));

    ingress.handler.addEnvironment('MODEL_OPUS_SSM', hubNaming.ssmParameterPath('models/opus'));
    ingress.handler.addEnvironment('MODEL_HAIKU_SSM', hubNaming.ssmParameterPath('models/haiku'));

    // AgentRuntime (no tool Lambdas for this service)
    new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'investor_profile_agents',
      agentCodePath: join(__dirname, '..', 'agents'),
      description: 'user-goals (Haiku) + risk-assessment (Opus) parallel orchestration',
      tables: [this.state.getTable()],
      modelIds: [modelOpusId, modelHaikuId],
      toolTargets: [],
    });

    this.addObservability({
      ingress, egress,
      extraLambdas: [kbIngestionFn],
      monitorBedrock: true,
      bedrockModelIds: [modelOpusId, modelHaikuId],
    });
  }
}
```

- [ ] Write `test/service.stack.spec.ts` — CDK snapshot test: asserts Ingress, Egress, KnowledgeBase, AgentRuntime, KB ingestion Lambda

```
npx nx test investor-profile-ctrl
```

**Commit:** `feat(investor-profile-ctrl): add CDK service stack with KnowledgeBase construct`

> Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>

---

## Chunk 2 — market-intelligence-ctrl

### Task 2.1 — Scaffold project

- [ ] Create `services/advisory/market-intelligence-ctrl/project.json`:

```json
{
  "name": "market-intelligence-ctrl",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "services/advisory/market-intelligence-ctrl/src",
  "projectType": "application",
  "tags": ["scope:advisory", "type:service"],
  "targets": {
    "build": {
      "executor": "@nx/esbuild:esbuild",
      "options": {
        "outputPath": "dist/services/advisory/market-intelligence-ctrl",
        "main": "services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts",
        "tsConfig": "services/advisory/market-intelligence-ctrl/tsconfig.json",
        "platform": "node",
        "format": ["cjs"],
        "additionalEntryPoints": [
          "services/advisory/market-intelligence-ctrl/src/handlers/kb-ingestion-handler.ts",
          "services/advisory/market-intelligence-ctrl/src/handlers/tools/market-data.handler.ts",
          "services/advisory/market-intelligence-ctrl/src/handlers/tools/instrument-universe.handler.ts"
        ]
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": {
        "jestConfig": "services/advisory/market-intelligence-ctrl/jest.config.ts"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  }
}
```

- [ ] Create `tsconfig.json` and `jest.config.ts`

```
npx nx test market-intelligence-ctrl  # expect 0 tests
```

**Commit:** `chore(market-intelligence-ctrl): scaffold Nx project`

### Task 2.2 — Service domain (events + models)

- [ ] Create `src/domain/events.ts`:

```ts
// Trigger event from decision-workflow-ctrl
export const MarketIntelligenceEventTypes = {
  ANALYZE_MARKET: 'ANALYZE_MARKET',
} as const;

// Output events
export const MarketIntelligenceOutputEvents = {
  MARKET_ANALYSIS_COMPLETED: 'MARKET_ANALYSIS_COMPLETED',
  MARKET_SIGNAL_DETECTED: 'MARKET_SIGNAL_DETECTED',
} as const;

// Feed ingestion events (from adapter services)
export const FeedIngestionEventTypes = {
  YAHOO_FINANCE_UPDATED: 'YAHOO_FINANCE_UPDATED',
  MARKETWATCH_UPDATED: 'MARKETWATCH_UPDATED',
  SEC_8K_FILED: 'SEC_8K_FILED',
  FRED_INDICATORS_UPDATED: 'FRED_INDICATORS_UPDATED',
  ALPHA_VANTAGE_NEWS_UPDATED: 'ALPHA_VANTAGE_NEWS_UPDATED',
} as const;
```

- [ ] Create `src/domain/models.ts` — interfaces: `MarketAnalysisInput` (tenantId, decisionId, taskToken, upstreamOutputs), `MarketSignal`, `MarketAnalysisResult` (signals, tickers, outlook, metadata), `FeedContent` (source, articles)
- [ ] Create `src/domain/index.ts` barrel

**Commit:** `feat(market-intelligence-ctrl): add service domain events and models`

### Task 2.3 — Agent config, schema, and prompt

- [ ] Create `src/agents/schemas.ts` — Zod schema for MarketAnalysisOutput (signals array, tickersMentioned, marketOutlook, confidenceScore)
- [ ] Create `src/agents/prompts.ts` — market-research prompt template (receives upstream context + KB retrieval results)
- [ ] Create `src/agents/market-research.config.ts`:

```ts
import type { AgentConfig } from '@nestfolio/agent-core';
import { MarketAnalysisOutputSchema } from './schemas';
import { marketResearchPrompt } from './prompts';

export const marketResearchConfig: AgentConfig<MarketAnalysisOutput> = {
  name: 'market-research',
  modelTier: 'sonnet',
  maxTokens: 4096,
  temperature: 0.2,
  outputSchema: MarketAnalysisOutputSchema,
  promptTemplate: marketResearchPrompt,
};
```

**Commit:** `feat(market-intelligence-ctrl): add market-research agent config and schema`

### Task 2.4 — Agent service (single agent, no orchestrator)

- [ ] Create `src/services/market-intelligence.service.ts`:

```ts
import { createAgentNode, withRetry, withFallback } from '@nestfolio/agent-core';
import { marketResearchConfig } from '../agents/market-research.config';

export const createMarketIntelligenceService = (deps: MarketIntelligenceDeps) => {
  // Single agent — use createAgentNode directly (no orchestrator needed)
  const agentNode = withFallback(
    withRetry(
      createAgentNode(marketResearchConfig),
      { maxRetries: 2, escalateTier: true },
    ),
    marketResearchConfig.name,
  );

  return {
    async analyzeMarket(input: MarketAnalysisInput): Promise<MarketAnalysisResult> {
      // 1. Retrieve KB context (RAG)
      const kbContext = await deps.kbRetriever.retrieve(input.upstreamOutputs);
      // 2. Run agent with KB context injected into prompt
      const result = await agentNode({ ...input, kbContext });
      // 3. Persist invocation + output
      await deps.repository.saveInvocation(input.tenantId, input.decisionId, result);
      return mapToAnalysisResult(result);
    },
  };
};
```

- [ ] Write `test/market-intelligence.service.spec.ts`:
  - Test: retrieves KB context, invokes agent with context, persists result
  - Test: retry escalates tier on validation failure
  - Test: fallback produces safe output on total failure

```
npx nx test market-intelligence-ctrl --testPathPattern=market-intelligence.service
```

**Commit:** `feat(market-intelligence-ctrl): add market intelligence agent service`

### Task 2.5 — Event listener + KB ingestion handler

- [ ] Create `src/handlers/event-listener.ts`:

```ts
import { createEventHandler, skip, requireEnv } from '@nestfolio/event-processor';
import { MarketIntelligenceEventTypes } from '../domain/events';

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload, ctx) => Promise<ReturnType<typeof skip>>> = {};

  // Trigger: run agent pipeline
  handlers[MarketIntelligenceEventTypes.ANALYZE_MARKET] = async (payload, ctx) => {
    const result = await deps.marketService.analyzeMarket({
      tenantId: ctx.tenantId,
      decisionId: payload.subject.decisionId,
      taskToken: payload.subject.taskToken,
      upstreamOutputs: payload.subject.upstreamOutputs,
    });
    await deps.eventPublisher.publish('MARKET_ANALYSIS_COMPLETED', {
      decisionId: payload.subject.decisionId,
      taskToken: payload.subject.taskToken,
      result,
    });
    return skip();
  };

  // Feed events are routed to kb-ingestion-handler Lambda by Ingress, not here
  return handlers;
};

export const handler = createEventHandler({
  serviceName: 'market-intelligence-ctrl',
  handlers: createHandlers(deps),
  table: requireEnv('TABLE_NAME'),
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'MARKET_INTELLIGENCE_CTRL_FAILED',
});
```

- [ ] Create `src/handlers/kb-ingestion-handler.ts`:

```ts
// Routes 5 feed events → S3 → KB sync
// Key pattern: each feed type maps to an S3 key prefix for organization
// S3 key: `feeds/{source}/{date}/{eventId}.txt`
// 90-day retention: S3 lifecycle rule (configured in CDK, not here)
// After S3 write, call StartIngestionJob to sync KB

const FEED_HANDLERS: Record<string, (payload) => { key: string; content: string }> = {
  YAHOO_FINANCE_UPDATED: (p) => ({
    key: `feeds/yahoo-finance/${date()}/${p.subject.ticker}.txt`,
    content: formatArticles(p.subject.articles),
  }),
  MARKETWATCH_UPDATED: (p) => ({
    key: `feeds/marketwatch/${date()}/${uuid()}.txt`,
    content: formatArticles(p.subject.articles),
  }),
  SEC_8K_FILED: (p) => ({
    key: `feeds/sec-8k/${date()}/${p.subject.ticker}.txt`,
    content: p.subject.content,
  }),
  FRED_INDICATORS_UPDATED: (p) => ({
    key: `feeds/fred/${date()}/${uuid()}.txt`,
    content: formatIndicators(p.subject.indicators),
  }),
  ALPHA_VANTAGE_NEWS_UPDATED: (p) => ({
    key: `feeds/alpha-vantage/${date()}/${uuid()}.txt`,
    content: formatArticles(p.subject.articles),
  }),
};
```

- [ ] Write `test/event-listener.spec.ts`:
  - Test: ANALYZE_MARKET routes to marketService.analyzeMarket
  - Test: publishes MARKET_ANALYSIS_COMPLETED with taskToken
  - Test: unknown event type is ignored

- [ ] Write `test/kb-ingestion-handler.spec.ts`:
  - Test: each of 5 feed events writes to correct S3 prefix
  - Test: triggers StartIngestionJob after S3 write
  - Test: handles missing/malformed payload gracefully

```
npx nx test market-intelligence-ctrl
```

**Commit:** `feat(market-intelligence-ctrl): add event listener and KB ingestion handler`

### Task 2.6 — Tool Lambda handlers

- [ ] Create `src/handlers/tools/market-data.handler.ts` — move from `advisory-ctrl/src/handlers/tools/market-data.handler.ts`. Adapt to standalone Lambda: reads live market indices + volatility from external API or SSM-cached data.

- [ ] Create `src/handlers/tools/instrument-universe.handler.ts` — move from `advisory-ctrl/src/handlers/tools/instrument-universe.handler.ts`. Returns approved instrument list from DDB or SSM.

- [ ] Write `test/tools/market-data.handler.spec.ts`:
  - Test: returns formatted market data response
  - Test: handles API/SSM errors gracefully

- [ ] Write `test/tools/instrument-universe.handler.spec.ts`:
  - Test: returns approved instruments
  - Test: handles empty universe

```
npx nx test market-intelligence-ctrl --testPathPattern=tools
```

**Commit:** `feat(market-intelligence-ctrl): add market-data and instrument-universe tool Lambdas`

### Task 2.7 — CDK service stack

- [ ] Create `src/service.stack.ts`:

```ts
import { KnowledgeBase, ServiceStack, Ingress, Egress, AgentRuntime, defaultLambdaProps, createNamingService } from '@nestfolio/cdk-constructs';
import { Duration } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { join } from 'path';

export class MarketIntelligenceCtrlStack extends ServiceStack {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props, prefix: props.prefix,
      subsystem: 'advisory', service: 'market-intelligence-ctrl', serviceDir: __dirname,
    });

    // Ingress: trigger + 5 feed events
    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: [
        'ANALYZE_MARKET',
        'YAHOO_FINANCE_UPDATED', 'MARKETWATCH_UPDATED',
        'SEC_8K_FILED', 'FRED_INDICATORS_UPDATED', 'ALPHA_VANTAGE_NEWS_UPDATED',
      ],
    });

    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['AgentInvocation', 'ReasoningOutput'],
      handlerEntry: join(__dirname, 'handlers/event-publisher-cdc.ts'),
      customEventTypeMap: {
        AgentInvocation: { MARKET_SIGNAL_DETECTED: 'INSERT' },
      },
    });

    // Knowledge Base: Market Intelligence (90-day retention)
    const kb = new KnowledgeBase(this, 'MarketKB', {
      name: 'market-intelligence',
      bucketPrefix: 'kb-market',
      description: 'Market news, sentiment, macro indicators from 5 feed sources',
      retentionDays: 90,
    });

    // KB ingestion Lambda
    const kbIngestionFn = new NodejsFunction(this, 'KBIngestion', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'kb-ingestion-handler.ts'),
      environment: {
        KB_BUCKET: kb.bucket.bucketName,
        KB_ID: kb.knowledgeBaseId,
        TABLE_NAME: this.state.getTable().tableName,
        BUS_NAME: ingress.bus.eventBusName,
      },
    });
    kb.bucket.grantWrite(kbIngestionFn);
    kb.grantStartIngestion(kbIngestionFn);

    // Route feed events to KB ingestion handler
    ingress.addTarget(kbIngestionFn, {
      eventTypes: [
        'YAHOO_FINANCE_UPDATED', 'MARKETWATCH_UPDATED',
        'SEC_8K_FILED', 'FRED_INDICATORS_UPDATED', 'ALPHA_VANTAGE_NEWS_UPDATED',
      ],
    });

    // Tool Lambdas
    const marketDataFn = new NodejsFunction(this, 'MarketData', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'tools', 'market-data.handler.ts'),
    });

    const instrumentUniverseFn = new NodejsFunction(this, 'InstrumentUniverse', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'tools', 'instrument-universe.handler.ts'),
    });

    // Model SSM params
    const hubNaming = createNamingService(this, { subsystem: 'advisory', service: 'advisory-hub' });
    const modelSonnetId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/sonnet'));
    ingress.handler.addEnvironment('MODEL_SONNET_SSM', hubNaming.ssmParameterPath('models/sonnet'));

    // AgentRuntime
    new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'market_intelligence_agents',
      agentCodePath: join(__dirname, '..', 'agents'),
      description: 'market-research (Sonnet) agent with tool access',
      tables: [this.state.getTable()],
      modelIds: [modelSonnetId],
      toolTargets: [
        {
          name: 'market-data',
          description: 'Retrieve current market indices, volatility, and recent events',
          handler: marketDataFn,
          schemaPath: join(__dirname, 'tools', 'market-data-schema.json'),
        },
        {
          name: 'instrument-universe',
          description: 'Retrieve the approved instrument universe',
          handler: instrumentUniverseFn,
          schemaPath: join(__dirname, 'tools', 'instrument-universe-schema.json'),
        },
      ],
    });

    this.addObservability({
      ingress, egress,
      extraLambdas: [kbIngestionFn, marketDataFn, instrumentUniverseFn],
      monitorBedrock: true,
      bedrockModelIds: [modelSonnetId],
    });
  }
}
```

- [ ] Write `test/service.stack.spec.ts` — CDK snapshot test: asserts Ingress (6 event types), KnowledgeBase (90-day retention), 2 tool Lambdas, AgentRuntime, KB ingestion Lambda

```
npx nx test market-intelligence-ctrl
```

**Commit:** `feat(market-intelligence-ctrl): add CDK service stack with KnowledgeBase and tool Lambdas`

> Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>

---

<!-- Chunks 3-4 (portfolio-engine-ctrl + advisory-narrative-ctrl) will be appended below -->
