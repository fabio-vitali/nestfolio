# 03 — AI Agent System Architecture

> Multi-agent architecture for Nestfolio's advisory domain. Built on **AWS Bedrock AgentCore** for managed agent deployment, **LangGraph.js** for graph-based orchestration inside AgentCore Runtimes, **Bedrock model tiering** for cost-effective model selection, and a deterministic compliance pipeline.

> **Key decision**: Full LLM from Phase 1. No rules-first fallback. The goal is to validate the AI value proposition early. Compliance is the sole exception — deterministic rule engine, no LLM.

> [Back to Master Plan](./00-master-plan.md)

---

## 1. Agent Architecture Overview

### 1.1 Agent Taxonomy

Nestfolio uses a **governed multi-agent architecture** with clear separation of concerns. LLM agents run inside an **AWS Bedrock AgentCore Runtime** as a containerized LangGraph StateGraph. Compliance runs in a separate service with no LLM.

```
                    ┌─────────────────────────────────┐
                    │   AgentCore Runtime              │
                    │   (containerized LangGraph.js)   │
                    │   advisory-ctrl invokes via       │
                    │   Runtime endpoint               │
                    └──────────┬──────────────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            │                                      │
  ┌─────────▼────────┐                  ┌─────────▼────────┐
  │ Proposal Agents  │                  │  Output Agent    │
  │ (generate plans) │                  │  (explain)       │
  └──────────────────┘                  └──────────────────┘
  - User & Goals                          - Explainability
  - Risk Assessment
  - Market & Research           ┌──────────────────────────┐
  - Portfolio Construction      │  compliance-ctrl         │
  - Rebalance Planner           │  (separate service)      │
                                │  Deterministic rule      │
                                │  engine — async via      │
                                │  EventBridge (AD-19)     │
                                └──────────────────────────┘

  ┌─────────────────────────────────────────────────────────┐
  │  AgentCore Gateway (MCP protocol)                       │
  │  Lambda tool targets:                                   │
  │  - Portfolio lookup (DynamoDB)                           │
  │  - Event publisher (EventBridge)                        │
  │  - Market data retrieval                                │
  │  - Instrument universe lookup                           │
  └─────────────────────────────────────────────────────────┘
```

| Agent | Bedrock Model | Tier | Rationale |
|-------|---------------|------|-----------|
| **Orchestrator** | None (LangGraph StateGraph) | — | Hardcoded graph execution order, no LLM routing |
| **User & Goals** | Claude Haiku 4.5 / Mistral Small | Simple | Structured constraint extraction, minimal reasoning |
| **Risk Assessment** | Claude Opus 4.6 | Complex | Correlation analysis, deep reasoning required |
| **Market & Research** | Claude Sonnet 4.6 | Balanced | Market synthesis, good quality/cost ratio |
| **Portfolio Construction** | Claude Opus 4.6 | Complex | Core optimization — highest quality required |
| **Rebalance Planner** | Claude Haiku 4.5 / Mistral Small | Simple | Sequencing is structured, low reasoning overhead |
| **Compliance** | **Deterministic** (no model) | — | Pure TypeScript rule engine (AD-19) |
| **Explainability** | Claude Sonnet 4.6 | Balanced | Clear writing — powers the "Why?" screen |
| **Execution Agent** | None (deterministic) | — | Submits validated orders to broker (single writer) |
| **Reconciliation Agent** | None (deterministic) | — | Compares intent truth vs settlement truth |

**All models accessed via Bedrock** — no direct API keys. `ChatBedrockConverse` from `@langchain/aws` provides a unified interface. Model selection is config-driven (AD-14).

### 1.2 Agent Principles

- **Stateless**: Every agent receives its full context as input (Context Bundle). No in-memory state between invocations.
- **Event-activated**: Agents are invoked within the LangGraph StateGraph running inside the AgentCore Runtime. They don't poll.
- **Managed compute**: AgentCore handles scaling, lifecycle, and container management. No Lambda timeouts, no cold start optimization needed for the agent pipeline.
- **Idempotent**: Same Context Bundle + same model version → structurally equivalent output (validated by schema, not exact string match).
- **Auditable**: Every agent invocation produces a stored artifact (input, output, model metadata, prompt hash).

---

## 2. AWS Bedrock AgentCore Infrastructure

### 2.1 Architecture: AgentCore Runtime + Gateway

The decision lifecycle agent code (LangGraph.js) runs inside an **AgentCore Runtime** — a managed, containerized deployment. AgentCore handles the underlying compute (no Lambda/ECS/EKS specified). The Runtime exposes a versioned HTTP endpoint that `advisory-ctrl` invokes.

Tools (DynamoDB lookups, EventBridge publishing, market data retrieval) are exposed via an **AgentCore Gateway** using MCP protocol. The agent discovers and calls tools through the Gateway, not through hardcoded function calls.

```
advisory-ctrl (event-listener Lambda)
    │
    │  Invokes AgentCore Runtime endpoint
    ▼
AgentCore Runtime (containerized LangGraph.js agent)
    │
    ├── Bedrock models (via grantInvoke)
    │   ├── Claude Opus 4.6
    │   ├── Claude Sonnet 4.6
    │   └── Claude Haiku 4.5 / Mistral Small
    │
    ├── AgentCore Gateway (MCP protocol)
    │   ├── Lambda target: portfolio-lookup
    │   ├── Lambda target: event-publisher
    │   ├── Lambda target: market-data
    │   └── Lambda target: instrument-universe
    │
    └── AgentCore Memory (context persistence)

    Total: ~8-15 seconds per decision lifecycle
    No Lambda timeout constraints — AgentCore manages lifecycle
```

### 2.2 CDK: AgentCore Runtime

```typescript
// services/advisory/advisory-ctrl/infra/agent-runtime.ts
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as path from 'path';

// AgentCore Runtime — containerized LangGraph agent
const advisoryRuntime = new agentcore.Runtime(this, 'AdvisoryRuntime', {
  runtimeName: 'advisory_decision_lifecycle',
  agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromAsset(
    path.join(__dirname, '../agents/decision-lifecycle'),
  ),
  description: 'Multi-agent decision lifecycle orchestrated via LangGraph.js',
  authorizerConfiguration: agentcore.RuntimeAuthorizerConfiguration.usingCognito(
    userPool,
    [userPoolClient],
  ),
  environmentVariables: {
    GATEWAY_ID: toolGateway.gatewayId,
    PROMPT_REGISTRY_TABLE: promptRegistryTable.tableName,
    DECISION_TABLE: decisionTable.tableName,
  },
  lifecycleConfiguration: {
    idleRuntimeSessionTimeout: Duration.minutes(15),
    maxLifetime: Duration.hours(4),
  },
});

// Grant Bedrock model access (AD-14: tiered model selection)
const claudeOpus = bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_OPUS_V4_6;
const claudeSonnet = bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_SONNET_V4_6;
const claudeHaiku = bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_HAIKU_V4_5;

claudeOpus.grantInvoke(advisoryRuntime);
claudeSonnet.grantInvoke(advisoryRuntime);
claudeHaiku.grantInvoke(advisoryRuntime);

// Grant DynamoDB access for decision persistence
decisionTable.grantReadWriteData(advisoryRuntime);
promptRegistryTable.grantReadData(advisoryRuntime);

// Versioned deployment endpoints
advisoryRuntime.addEndpoint('production', {
  version: '1',
  description: 'Stable production endpoint',
});
```

### 2.3 CDK: AgentCore Gateway (Tool Targets)

```typescript
// services/advisory/advisory-ctrl/infra/agent-gateway.ts
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';

const toolGateway = new agentcore.Gateway(this, 'AdvisoryToolGateway', {
  gatewayName: 'advisory-tools',
  protocolConfiguration: new agentcore.McpProtocolConfiguration({
    instructions: 'Tools for the advisory decision lifecycle agent',
    searchType: agentcore.McpGatewaySearchType.SEMANTIC,
  }),
  authorizerConfiguration: agentcore.GatewayAuthorizer.usingAwsIam(),
});

// Tool: Portfolio lookup (DynamoDB read)
toolGateway.addLambdaTarget('PortfolioLookup', {
  gatewayTargetName: 'portfolio-lookup',
  description: 'Retrieve current portfolio positions and cash balance',
  lambdaFunction: portfolioLookupFn,
  toolSchema: agentcore.ToolSchema.fromLocalAsset(
    path.join(__dirname, '../tools/portfolio-lookup-schema.json'),
  ),
});

// Tool: Event publisher (EventBridge)
toolGateway.addLambdaTarget('EventPublisher', {
  gatewayTargetName: 'event-publisher',
  description: 'Publish events to the advisory EventBridge bus',
  lambdaFunction: eventPublisherFn,
  toolSchema: agentcore.ToolSchema.fromLocalAsset(
    path.join(__dirname, '../tools/event-publisher-schema.json'),
  ),
});

// Tool: Market data retrieval
toolGateway.addLambdaTarget('MarketData', {
  gatewayTargetName: 'market-data',
  description: 'Retrieve current market indices, volatility, and recent events',
  lambdaFunction: marketDataFn,
  toolSchema: agentcore.ToolSchema.fromLocalAsset(
    path.join(__dirname, '../tools/market-data-schema.json'),
  ),
});

// Tool: Instrument universe
toolGateway.addLambdaTarget('InstrumentUniverse', {
  gatewayTargetName: 'instrument-universe',
  description: 'Retrieve the approved instrument universe for portfolio construction',
  lambdaFunction: instrumentUniverseFn,
  toolSchema: agentcore.ToolSchema.fromLocalAsset(
    path.join(__dirname, '../tools/instrument-universe-schema.json'),
  ),
});

// Grant Runtime access to invoke the Gateway
toolGateway.grantInvoke(advisoryRuntime);
```

### 2.4 CDK: AgentCore Memory

```typescript
// services/advisory/advisory-ctrl/infra/agent-memory.ts
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';

const advisoryMemory = new agentcore.Memory(this, 'AdvisoryMemory', {
  // Memory provides long-term context persistence for the agent
  // Used for: investor preference history, past decision context,
  // market pattern recall across decision lifecycles
});
```

### 2.5 Versioned Deployment Pattern

AgentCore provides immutable versions with named endpoints for controlled rollouts:

```
Initial deployment → Version 1 + DEFAULT endpoint
                     └── Production endpoint pinned to V1

Agent code update  → Version 2 created
                     ├── DEFAULT points to V2
                     ├── Staging endpoint pinned to V2 (test)
                     └── Production still on V1

After validation   → Production endpoint updated to V2
                     └── V1 kept for rollback
```

This replaces Lambda aliases/versions for the agent workload. The `advisory-ctrl` event-listener Lambda invokes a specific Runtime endpoint (production), not the DEFAULT.

### 2.6 Key Design Decisions

- **AgentCore manages compute**: No Lambda timeout constraints (the old 90s timeout concern is eliminated). No cold start optimization for the agent pipeline. No memory tuning.
- **Gateway for tool access**: Tools are discovered via MCP protocol, not hardcoded. When adapting to a new domain, define new tool targets in the Gateway — the agent code discovers them automatically.
- **Versioned deployments**: Each code change creates a new immutable version. Production endpoint stays pinned until explicitly promoted. Instant rollback by re-pinning.
- **Cognito auth on Runtime**: The Runtime endpoint itself is authenticated, not just the Lambda that calls it. Defense in depth.

---

## 3. LangGraph.js Graph Orchestration (Inside AgentCore Runtime)

### 3.1 Architecture: LangGraph Inside AgentCore

The LangGraph StateGraph runs **inside** the AgentCore Runtime container. AgentCore provides the managed compute; LangGraph provides the multi-agent orchestration logic. This is a supported pattern — AgentCore explicitly supports LangGraph as an agent framework.

```
AgentCore Runtime Container
┌─────────────────────────────────────────────────────────┐
│  LangGraph StateGraph                                   │
│                                                         │
│  ┌─── Parallel Wave 1 ────────────────────────────┐    │
│  │  User & Goals (Haiku)                          │    │
│  │  Risk Assessment (Opus)                        │    │
│  │  Market & Research (Sonnet)                    │    │
│  └────────────────────────────────────────────────┘    │
│                      │                                  │
│                      ▼                                  │
│  ┌─── Parallel Wave 2 ────────────────────────────┐    │
│  │  Portfolio Construction (Opus)                  │    │
│  │  Rebalance Planner (Haiku)                     │    │
│  └────────────────────────────────────────────────┘    │
│                      │                                  │
│                      ▼                                  │
│  ┌─── Serial: Explainability ─────────────────────┐    │
│  │  Claude Sonnet                                 │    │
│  └────────────────────────────────────────────────┘    │
│                      │                                  │
│                      ▼                                  │
│  ┌─── Compose & Return ──────────────────────────┐     │
│  │  Build Decision Packet → return to caller      │     │
│  └────────────────────────────────────────────────┘    │
│                                                         │
│  Total: ~8-15 seconds                                   │
└─────────────────────────────────────────────────────────┘

        advisory-ctrl event-listener receives result
        → persists Decision Packet
        → publishes DECISION_PACKET_CREATED to advisory-hub

                    ┌──── EventBridge (advisory-hub) ────┐
                    │  DECISION_PACKET_CREATED            │
                    └──────────────┬─────────────────────┘
                                   ▼
        compliance-ctrl (separate service, AD-19)
        ┌─────────────────────────────────────────────────┐
        │  Deterministic rule engine (<100ms, no LLM)     │
        │  → Publishes DECISION_APPROVED or BLOCKED       │
        └─────────────────────────────────────────────────┘
```

### 3.2 Graph Definition

```typescript
// services/advisory/advisory-ctrl/agents/decision-lifecycle/src/graph/decision-graph.ts
import { Annotation, StateGraph, END } from '@langchain/langgraph';
import { createAgentNode } from '../agents/agent-nodes';
import type { ContextBundle, DecisionGraphState } from '@nestfolio/agent-core';

// Graph state schema — accumulated across nodes
const DecisionState = Annotation.Root({
  context: Annotation<ContextBundle>,
  userGoals: Annotation<UserGoalsProposal | null>({ default: () => null }),
  risk: Annotation<RiskProposal | null>({ default: () => null }),
  market: Annotation<MarketProposal | null>({ default: () => null }),
  portfolio: Annotation<PortfolioConstructionProposal | null>({ default: () => null }),
  rebalance: Annotation<RebalancePlanProposal | null>({ default: () => null }),
  explanation: Annotation<ExplanationOutput | null>({ default: () => null }),
  decisionPacket: Annotation<DecisionPacket | null>({ default: () => null }),
});

export function buildDecisionGraph(context: ContextBundle) {
  const graph = new StateGraph(DecisionState);

  // Wave 1: Independent data gathering (parallel via fan-out)
  graph.addNode('user-goals', createAgentNode('user-goals', context));
  graph.addNode('risk-assessment', createAgentNode('risk-assessment', context));
  graph.addNode('market-research', createAgentNode('market-research', context));

  // Wave 2: Depends on Wave 1 outputs (parallel)
  graph.addNode('portfolio-construction', createAgentNode('portfolio-construction', context));
  graph.addNode('rebalance-planner', createAgentNode('rebalance-planner', context));

  // Serial: Explainability
  graph.addNode('explainability', createAgentNode('explainability', context));

  // Serial: Compose Decision Packet
  graph.addNode('compose-packet', composeDecisionPacketNode);

  // Edges: Wave 1 → Wave 2
  graph.addEdge('__start__', 'user-goals');
  graph.addEdge('__start__', 'risk-assessment');
  graph.addEdge('__start__', 'market-research');
  graph.addEdge('user-goals', 'portfolio-construction');
  graph.addEdge('risk-assessment', 'portfolio-construction');
  graph.addEdge('market-research', 'portfolio-construction');
  graph.addEdge('user-goals', 'rebalance-planner');
  graph.addEdge('risk-assessment', 'rebalance-planner');
  graph.addEdge('market-research', 'rebalance-planner');

  // Wave 2 → Explainability → Compose
  graph.addEdge('portfolio-construction', 'explainability');
  graph.addEdge('rebalance-planner', 'explainability');
  graph.addEdge('explainability', 'compose-packet');
  graph.addEdge('compose-packet', END);

  return graph.compile();
}
```

### 3.3 Validation Spike: Parallel Execution

Before building the full graph, validate that LangGraph's fan-out works as expected:

- [ ] Multiple edges from `__start__` trigger parallel execution (not sequential)
- [ ] Wave 2 nodes properly wait for all Wave 1 predecessors
- [ ] Error in one Wave 1 agent doesn't silently drop the others
- [ ] Graph state accumulates correctly across parallel branches

This spike should be one of the first tasks in Phase 3.

---

## 4. Bedrock Model Configuration

### 4.1 Model Configuration (Config-Driven)

```typescript
// libs/agent-core/src/config/model-config.ts
export const AGENT_MODEL_CONFIG = {
  'user-goals':             { modelId: 'anthropic.claude-haiku-4-5-v1',   maxTokens: 2048, temperature: 0.0 },
  'risk-assessment':        { modelId: 'anthropic.claude-opus-4-6-v1',    maxTokens: 4096, temperature: 0.1 },
  'market-research':        { modelId: 'anthropic.claude-sonnet-4-6-v1',  maxTokens: 4096, temperature: 0.2 },
  'portfolio-construction': { modelId: 'anthropic.claude-opus-4-6-v1',    maxTokens: 4096, temperature: 0.1 },
  'rebalance-planner':      { modelId: 'anthropic.claude-haiku-4-5-v1',   maxTokens: 4096, temperature: 0.1 },
  'explainability':         { modelId: 'anthropic.claude-sonnet-4-6-v1',  maxTokens: 8192, temperature: 0.3 },
} as const;
```

### 4.2 Agent Factory (Bedrock via LangChain)

```typescript
// libs/agent-core/src/factory/agent-factory.ts
import { ChatBedrockConverse } from '@langchain/aws';
import { AGENT_MODEL_CONFIG } from '../config/model-config';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

export function createModel(agentName: string): BaseChatModel {
  const config = AGENT_MODEL_CONFIG[agentName];
  if (!config) throw new Error(`Unknown agent: ${agentName}`);

  return new ChatBedrockConverse({
    model: config.modelId,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    region: process.env.AWS_REGION,
    // Credentials are automatically available inside the AgentCore Runtime
    // via the execution role that has grantInvoke for these models
  });

  // Note: structured output is NOT bound here — the invokeAgent() function
  // calls .withStructuredOutput(zodSchema) with the agent-specific output schema.
}
```

### 4.3 Adaptive Tier Escalation

When an agent's output fails validation or confidence is below threshold, the graph runner retries with a higher-capability model:

- Haiku agents: Haiku → Sonnet → Opus
- Sonnet agents: Sonnet → Opus
- Opus agents: Retry at Opus (already highest tier)

All models are accessed through the same `ChatBedrockConverse` interface — escalation just changes the `modelId`. No provider switching needed.

### 4.4 Cost Estimation

| Agent | Model | Est. Input Tokens | Est. Output Tokens | Est. Cost per Decision |
|-------|-------|------------------:|-------------------:|-----------------------:|
| User & Goals | Haiku | ~5,000 | ~500 | ~$0.005 |
| Risk Assessment | Opus | ~8,000 | ~2,000 | ~$0.20 |
| Market & Research | Sonnet | ~8,000 | ~2,000 | ~$0.05 |
| Portfolio Construction | Opus | ~10,000 | ~2,000 | ~$0.24 |
| Rebalance Planner | Haiku | ~6,000 | ~1,500 | ~$0.008 |
| Explainability | Sonnet | ~10,000 | ~4,000 | ~$0.08 |
| **Total per decision** | | | | **~$0.58** |

Note: Bedrock pricing may include additional per-request charges. Prompt caching (if available) could reduce input token costs by 50-70%.

---

## 5. Structured Output Pattern

### 5.1 Unified Invocation Interface

Every agent uses LangChain's `.withStructuredOutput(zodSchema)` to produce typed JSON. `ChatBedrockConverse` supports this natively via Bedrock's tool use mechanism.

```typescript
// libs/agent-core/src/agent/agent-invoker.ts
import { ChatBedrockConverse } from '@langchain/aws';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { z } from 'zod';

interface AgentInvocation<TInput, TOutput> {
  agentName: string;
  systemPrompt: string;
  inputSchema: z.ZodSchema<TInput>;
  outputSchema: z.ZodSchema<TOutput>;
}

export async function invokeAgent<TInput, TOutput>(
  invocation: AgentInvocation<TInput, TOutput>,
  input: TInput,
  context: AgentContext,
): Promise<AgentResult<TOutput>> {
  const startTime = Date.now();

  const validatedInput = invocation.inputSchema.parse(input);

  const model = createModel(invocation.agentName);
  const structuredModel = model.withStructuredOutput(invocation.outputSchema);

  const response = await structuredModel.invoke([
    new SystemMessage(invocation.systemPrompt),
    new HumanMessage(JSON.stringify(validatedInput)),
  ]);

  const durationMs = Date.now() - startTime;
  const config = AGENT_MODEL_CONFIG[invocation.agentName];

  return {
    output: response,
    metadata: {
      agentName: invocation.agentName,
      modelId: config.modelId,
      inputTokens: response._metadata?.usage?.input_tokens ?? 0,
      outputTokens: response._metadata?.usage?.output_tokens ?? 0,
      durationMs,
      promptHash: hashPrompt(invocation.systemPrompt),
      timestamp: new Date().toISOString(),
    },
  };
}
```

### 5.2 System Prompt Architecture

Each agent's system prompt is composed of 3 layers:

```
┌─────────────────────────────────────┐
│  Base Layer (shared across agents)  │  Identity, safety rules, output format
├─────────────────────────────────────┤
│  Agent-Specific Layer               │  Role, domain knowledge, constraints
├─────────────────────────────────────┤
│  Context Injection Layer            │  Portfolio state, mandate, guardrails
└─────────────────────────────────────┘
```

```typescript
// libs/agent-core/src/agent/prompt-builder.ts

const BASE_SYSTEM_PROMPT = `
You are a specialized financial analysis agent within Nestfolio, an AI-managed investment platform.

CRITICAL RULES:
- You MUST produce output using the provided tool. No free-text responses.
- You MUST NOT recommend specific securities by name unless they are in the approved instrument universe.
- You MUST NOT fabricate market data, prices, or statistics. Use only data provided in the context.
- You MUST stay within the guardrail boundaries provided. If a proposed action would violate a guardrail, flag it.
- All percentage allocations MUST sum to exactly 100%.
- All monetary values MUST be in EUR.
- You are operating in {{operatingMode}} mode with the following risk band: {{riskBand}}.
`;

function buildAgentPrompt(agent: AgentConfig, context: ContextBundle): string {
  return [
    BASE_SYSTEM_PROMPT
      .replace('{{operatingMode}}', context.mandate.operatingMode)
      .replace('{{riskBand}}', JSON.stringify(context.mandate.riskBand)),
    agent.specificPrompt,
    `\n## Current Context\n${JSON.stringify(context, null, 2)}`,
  ].join('\n\n');
}
```

### 5.3 Example: Portfolio Construction Agent

```typescript
const PORTFOLIO_CONSTRUCTION_PROMPT = `
You are the Portfolio Construction Agent. Your role is to propose a target asset allocation
for the investor's portfolio based on their goals, risk profile, operating mode, and current
market conditions.

INPUT: You will receive the investor's goal constraints, risk assessment, market context,
and current portfolio state (if any).

OUTPUT: Use the portfolio_construction_output tool to produce:
- targetAllocation: Array of {instrument, targetWeight, rationale} where weights sum to 1.0
- rebalanceUrgency: "none" | "low" | "medium" | "high"
- reasoning: Array of factors that drove the allocation decision
- confidenceScore: 0.0 to 1.0 indicating your confidence in this allocation

CONSTRAINTS:
- Only use instruments from the APPROVED_UNIVERSE provided in context
- Respect the risk band boundaries (min/max equity allocation)
- Respect the operating mode parameters (max single position, diversification minimum)
- If current portfolio exists, minimize unnecessary turnover (prefer drift tolerance)
- For new portfolios, start with the model allocation for the operating mode
`;

const PortfolioConstructionOutput = z.object({
  targetAllocation: z.array(z.object({
    instrument: z.string(),
    targetWeight: z.number().min(0).max(1),
    rationale: z.string(),
  })),
  rebalanceUrgency: z.enum(['none', 'low', 'medium', 'high']),
  reasoning: z.array(z.object({
    factor: z.string(),
    weight: z.number().min(0).max(1),
    description: z.string(),
  })),
  confidenceScore: z.number().min(0).max(1),
});
```

---

## 6. Compliance Agent (Deterministic Rule Engine)

The Compliance Agent is **not an LLM agent**. It is a pure TypeScript rule engine with explicit check functions, deployed as a separate service (`compliance-ctrl`).

### 6.1 Why Deterministic

- **Auditability**: Every compliance decision is the result of explicit, traceable boolean logic.
- **Determinism**: Same input always produces same output. Critical for financial compliance.
- **Speed**: <100ms execution. No API call latency, no token costs.
- **Testability**: 100% unit test coverage on every check path.

### 6.2 Rule Registry Pattern

The compliance engine uses a **rule registry** for extensibility. New checks are added by registering them, not by modifying a monolithic function. This pattern transfers to other domains (healthcare compliance, e-commerce fraud rules, etc.).

```typescript
// services/advisory/compliance-ctrl/src/compliance/compliance-engine.ts

export interface ComplianceCheck {
  check: string;
  passed: boolean;
  detail: string;
}

export interface ComplianceResult {
  overallDecision: 'APPROVED' | 'BLOCKED' | 'CONFIRMATION_REQUIRED' | 'ESCALATED';
  authorityLevel: 'L0' | 'L1' | 'L2' | 'L3';
  checks: ComplianceCheck[];
  blockReason?: string;
  escalationReason?: string;
}

type ComplianceCheckFn = (
  tradePlan: TradePlan,
  mandate: MandateContext,
  portfolio: PortfolioSnapshot,
  lastRebalanceDate: string | null,
) => ComplianceCheck;

export class ComplianceEngine {
  private checks: ComplianceCheckFn[] = [];

  register(check: ComplianceCheckFn): this {
    this.checks.push(check);
    return this;
  }

  run(
    tradePlan: TradePlan,
    mandate: MandateContext,
    portfolio: PortfolioSnapshot,
    lastRebalanceDate: string | null,
  ): ComplianceResult {
    const results = this.checks.map(check =>
      check(tradePlan, mandate, portfolio, lastRebalanceDate),
    );

    const anyFailed = results.some(c => !c.passed);
    const authorityLevel = determineAuthorityLevel(tradePlan, mandate);

    return {
      overallDecision: anyFailed
        ? 'BLOCKED'
        : authorityLevel === 'L2'
          ? 'CONFIRMATION_REQUIRED'
          : 'APPROVED',
      authorityLevel,
      checks: results,
      blockReason: anyFailed
        ? results.filter(c => !c.passed).map(c => c.detail).join('; ')
        : undefined,
    };
  }
}

// Default engine with standard Nestfolio checks
export function createNestfolioComplianceEngine(): ComplianceEngine {
  return new ComplianceEngine()
    .register(checkMandateScope)
    .register(checkRiskBand)
    .register(checkMonthlyTurnover)
    .register(checkMaxSingleTrade)
    .register(checkCoolDown)
    .register(checkSuitability);
}
```

### 6.3 Individual Check Functions

```typescript
function checkMandateScope(tradePlan: TradePlan, mandate: MandateContext): ComplianceCheck {
  const outOfScope = tradePlan.trades.filter(
    t => !mandate.allowedAssetClasses.includes(t.assetClass),
  );
  return {
    check: 'MANDATE_SCOPE',
    passed: outOfScope.length === 0,
    detail: outOfScope.length === 0
      ? 'All trades within mandate scope'
      : `Out-of-scope instruments: ${outOfScope.map(t => t.instrument).join(', ')}`,
  };
}

function checkRiskBand(
  tradePlan: TradePlan, mandate: MandateContext, portfolio: PortfolioSnapshot,
): ComplianceCheck {
  const resultingEquityWeight = calculateResultingEquityWeight(tradePlan, portfolio);
  const inBand = resultingEquityWeight >= mandate.riskBand.minEquity
              && resultingEquityWeight <= mandate.riskBand.maxEquity;
  return {
    check: 'RISK_BAND',
    passed: inBand,
    detail: inBand
      ? `Equity ${(resultingEquityWeight * 100).toFixed(1)}% within band`
      : `Equity ${(resultingEquityWeight * 100).toFixed(1)}% outside band`,
  };
}

function checkMonthlyTurnover(
  tradePlan: TradePlan, mandate: MandateContext, portfolio: PortfolioSnapshot,
): ComplianceCheck {
  const totalTradeValue = tradePlan.trades.reduce((sum, t) => sum + t.estimatedValue, 0);
  const turnover = totalTradeValue / (2 * portfolio.totalValue);
  const withinCap = turnover <= mandate.monthlyTurnoverCap;
  return {
    check: 'MONTHLY_TURNOVER',
    passed: withinCap,
    detail: withinCap
      ? `Turnover ${(turnover * 100).toFixed(1)}% within cap`
      : `Turnover ${(turnover * 100).toFixed(1)}% exceeds cap`,
  };
}

function checkMaxSingleTrade(
  tradePlan: TradePlan, mandate: MandateContext, portfolio: PortfolioSnapshot,
): ComplianceCheck {
  const maxTrade = Math.max(...tradePlan.trades.map(t => t.estimatedValue));
  const maxTradePercent = maxTrade / portfolio.totalValue;
  const withinMax = maxTradePercent <= mandate.maxSingleTrade;
  return {
    check: 'MAX_SINGLE_TRADE',
    passed: withinMax,
    detail: withinMax
      ? `Largest trade ${(maxTradePercent * 100).toFixed(1)}% within limit`
      : `Largest trade ${(maxTradePercent * 100).toFixed(1)}% exceeds limit`,
  };
}

function checkCoolDown(lastRebalanceDate: string | null, mandate: MandateContext): ComplianceCheck {
  if (!lastRebalanceDate) {
    return { check: 'COOL_DOWN', passed: true, detail: 'No previous rebalance — cool-down not applicable' };
  }
  const elapsed = Date.now() - new Date(lastRebalanceDate).getTime();
  const coolDownMs = parseDuration(mandate.coolDownPeriod);
  return {
    check: 'COOL_DOWN',
    passed: elapsed >= coolDownMs,
    detail: elapsed >= coolDownMs
      ? `Cool-down period satisfied`
      : `Cool-down period not met`,
  };
}

function checkSuitability(tradePlan: TradePlan, mandate: MandateContext): ComplianceCheck {
  const aggressiveInstruments = tradePlan.trades.filter(t => t.riskCategory === 'high');
  const unsuitable = mandate.operatingMode === 'conservative' && aggressiveInstruments.length > 0;
  return {
    check: 'SUITABILITY',
    passed: !unsuitable,
    detail: unsuitable
      ? `Conservative mandate but plan includes high-risk instruments`
      : 'Trade plan suitable for investor risk profile',
  };
}
```

---

## 7. Decision Lifecycle (9-Step Flow)

### 7.1 Flow Overview

```
┌─────────────┐
│  1. TRIGGER  │  Event received (MANDATE_GRANTED, DRIFT_DETECTED, etc.)
└──────┬──────┘    Event payload carries investor profile + portfolio snapshots (AD-20)
       ▼
┌──────────────────┐
│  2. COMPOSE      │  Assemble Context Bundle from event payload
│     CONTEXT      │  (AD-20: event-carried state transfer)
└──────┬───────────┘
       ▼
┌──────────────────┐
│  3. INVOKE       │  advisory-ctrl invokes AgentCore Runtime endpoint
│     AGENTCORE    │  Runtime executes LangGraph StateGraph (Wave 1 → Wave 2 → Explain)
│     RUNTIME      │  Runtime returns Decision Packet to caller
└──────┬───────────┘
       ▼
┌──────────────────┐
│  4. PERSIST &    │  advisory-ctrl persists Decision Packet to DynamoDB
│     PUBLISH      │  Publishes DECISION_PACKET_CREATED to advisory-hub
└──────┬───────────┘
       │  ─── EventBridge (advisory-hub) ───
       ▼
┌──────────────────┐
│  5. COMPLIANCE   │  compliance-ctrl: deterministic rule engine (AD-19)
│     GATE         │  Publishes DECISION_APPROVED / BLOCKED / CONFIRMATION_REQUIRED
└──────┬───────────┘
       ├── BLOCKED ──────────▶ END
       ├── APPROVED (L1) ───▶ Step 8
       └── CONFIRMATION_REQUIRED (L2) ──▶ Step 6
              ▼
┌──────────────────┐
│  6. USER         │  USER_CONFIRMATION_REQUESTED → wait (72h timeout)
│     CONFIRMATION │  → CONFIRMED / REJECTED / EXPIRED
└──────┬───────────┘
       ▼
┌──────────────────┐
│  7. EXPLANATION  │  Already produced in step 3 (part of Decision Packet)
└──────┬───────────┘
       ▼
┌──────────────────┐
│  8. SUBMIT       │  ORDER_SUBMISSION_REQUESTED to execution-hub
└──────┬───────────┘
       ▼
┌──────────────────┐
│  9. AWAIT        │  ORDER_FILLED / REJECTED / CANCELLED
│     EXECUTION    │  Update Decision Packet, notify investor
└─────────────────┘
```

### 7.2 advisory-ctrl: Event Listener → Runtime Invocation

```typescript
// services/advisory/advisory-ctrl/src/handlers/decision-lifecycle.ts

export async function handler(event: TriggerEvent): Promise<DecisionResult> {
  const context = composeContextBundle(event);

  // Invoke AgentCore Runtime endpoint
  const runtimeEndpoint = process.env.ADVISORY_RUNTIME_ENDPOINT;
  const runtimeResult = await invokeAgentCoreRuntime(runtimeEndpoint, context);

  const decisionPacket = runtimeResult.decisionPacket;
  await persistDecision(decisionPacket);
  await publishEvent('DECISION_PACKET_CREATED', decisionPacket);

  return { status: 'PENDING_COMPLIANCE', decisionId: decisionPacket.decisionId };
}

// Separate handler: compliance response callback
export async function complianceResponseHandler(event: ComplianceResponseEvent): Promise<void> {
  const decisionPacket = await loadDecision(event.detail.decisionId);
  decisionPacket.complianceDecision = event.detail.complianceResult;

  if (event.detail.complianceResult.overallDecision === 'BLOCKED') {
    await updateDecisionStatus(decisionPacket.decisionId, 'BLOCKED');
    await publishEvent('DECISION_BLOCKED', decisionPacket);
    return;
  }

  if (event.detail.complianceResult.overallDecision === 'CONFIRMATION_REQUIRED') {
    await updateDecisionStatus(decisionPacket.decisionId, 'AWAITING_CONFIRMATION');
    await publishEvent('USER_CONFIRMATION_REQUESTED', decisionPacket);
    return;
  }

  // APPROVED (L1) — proceed to order submission
  await updateDecisionStatus(decisionPacket.decisionId, 'SUBMITTED');
  await publishEvent('ORDER_SUBMISSION_REQUESTED', decisionPacket);
}
```

### 7.3 advisory-ctrl Has Two Execution Modes

1. **AgentCore Runtime invocation** — triggered by `MANDATE_GRANTED`, `DRIFT_DETECTED`, etc. Composes context, invokes Runtime, persists result, publishes event.
2. **Event-driven callbacks** — triggered by `DECISION_APPROVED`, `USER_CONFIRMED`, `ORDER_FILLED`, etc. Updates DynamoDB state and publishes follow-up events.

### 7.4 Decision Packet Structure

```typescript
// libs/domain-core/src/advisory/decision-packet.ts
export interface DecisionPacket {
  decisionId: string;
  tenantId: string;
  userId: string;
  timestamp: string;

  trigger: { eventType: string; eventId: string; triggerReason: string };

  portfolioContext: {
    portfolioId: string;
    currentAllocation: AllocationSnapshot[];
    totalValue: number;
    cashBalance: number;
    driftMagnitude: number | null;
  };

  mandateContext: {
    operatingMode: 'conservative' | 'balanced' | 'aggressive';
    riskBand: { minEquity: number; maxEquity: number };
    maxSingleTrade: number;
    monthlyTurnoverCap: number;
    rebalanceCadence: string;
    coolDownPeriod: string;
  };

  agentProposals: {
    userGoals: UserGoalsProposal;
    risk: RiskProposal;
    market: MarketProposal;
    portfolio: PortfolioConstructionProposal;
    rebalance: RebalancePlanProposal;
  };

  tradePlan: {
    trades: ProposedTrade[];
    estimatedCost: number;
    estimatedTurnover: number;
    netAllocationChange: AllocationDelta[];
  };

  complianceDecision: ComplianceResult;
  requiredAuthorityLevel: 'L0' | 'L1' | 'L2' | 'L3';

  userConfirmation?: { action: 'CONFIRMED' | 'REJECTED' | 'EXPIRED'; timestamp: string };

  explanation?: {
    headline: string;
    reasoning: string;
    factors: ExplainabilityFactor[];
    locale: string;
  };

  executionOutcome?: {
    orders: OrderOutcome[];
    totalExecuted: number;
    totalFees: number;
    status: 'FILLED' | 'PARTIALLY_FILLED' | 'REJECTED' | 'CANCELLED';
  };

  auditMetadata: {
    modelVersions: Record<string, string>;
    promptHashes: Record<string, string>;
    policyVersion: string;
    decisionHash: string;
    agentCoreRuntimeVersion: string;
  };
}
```

---

## 8. Context Bundle

### 8.1 Composition

```typescript
export interface ContextBundle {
  triggerEvent: BusEvent;
  portfolioSnapshot: {
    portfolioId: string;
    positions: PositionSnapshot[];
    cashBalance: number;
    totalValue: number;
    lastRebalanceDate: string | null;
    currentDrift: number | null;
  };
  mandate: {
    operatingMode: 'conservative' | 'balanced' | 'aggressive';
    riskProfile: RiskProfile;
    goals: InvestorGoal[];
    guardrails: GuardrailPolicy;
    grantedAt: string;
  };
  marketSignals: {
    majorIndices: IndexSnapshot[];
    volatilityIndex: number;
    interestRates: RateSnapshot;
    recentEvents: MarketEvent[];
    dataTimestamp: string;
  };
  instrumentUniverse: Instrument[];
  versions: {
    policyVersion: string;
    modelVersions: Record<string, string>;
    promptVersions: Record<string, string>;
  };
}
```

### 8.2 Context Retrieval (Event-Carried State Transfer — AD-20)

Assembled **from the triggering event payload**, not from cross-domain DynamoDB reads. EventBridge 256KB limit applies — for large portfolios, the event carries entity references and advisory-ctrl does a lookup via the Gateway tool target.

---

## 9. Guardrails Against LLM Hallucination

### 9.1 Defense-in-Depth

```
Layer 1: Structured Output (tool_use via Bedrock)      → LLM can only produce typed JSON
Layer 2: Schema Validation (Zod)                        → Output must conform to exact schema
Layer 3: Sanity Checks (deterministic)                  → Business rule validation on output
Layer 4: Cross-Agent Consistency                        → Proposals compared for contradictions
Layer 5: Compliance Gate (deterministic rule engine)     → Final authorization before execution
Layer 6: Execution Bounds                               → Hard limits on what can be executed
```

### 9.2 Sanity Checks (Layer 3)

```typescript
export function validatePortfolioAllocation(output: PortfolioConstructionOutput): ValidationResult {
  const errors: string[] = [];

  const totalWeight = output.targetAllocation.reduce((sum, a) => sum + a.targetWeight, 0);
  if (Math.abs(totalWeight - 1.0) > 0.001) errors.push(`Weights sum to ${totalWeight}, expected 1.0`);

  if (output.targetAllocation.some(a => a.targetWeight < 0)) errors.push('Negative weights found');

  const unknown = output.targetAllocation.filter(a => !APPROVED_UNIVERSE.includes(a.instrument));
  if (unknown.length > 0) errors.push(`Unknown instruments: ${unknown.map(u => u.instrument).join(', ')}`);

  if (output.confidenceScore < 0.1) errors.push(`Suspiciously low confidence: ${output.confidenceScore}`);

  const maxPosition = Math.max(...output.targetAllocation.map(a => a.targetWeight));
  if (maxPosition > 0.40) errors.push(`Single position exceeds 40%: ${maxPosition}`);

  return { valid: errors.length === 0, errors };
}
```

### 9.3 Validation Failure → Tier Escalation → Deterministic Fallback

```typescript
async function invokeWithRetry(agentName: string, context: ContextBundle): Promise<AgentResult> {
  const escalationPath = getEscalationPath(agentName);
  let currentConfigIndex = 0;

  for (let attempt = 0; attempt < 3; attempt++) {
    const config = escalationPath[currentConfigIndex];
    const result = await invokeAgent(agentName, context, config);
    const validation = AGENT_VALIDATORS[agentName](result.output, context);
    if (validation.valid) return result;

    logger.warn('Validation failed', { agent: agentName, attempt, errors: validation.errors });
    if (currentConfigIndex < escalationPath.length - 1) currentConfigIndex++;
  }

  logger.error('All attempts failed, using deterministic fallback', { agent: agentName });
  return AGENT_FALLBACKS[agentName](context);
}
```

### 9.4 Deterministic Fallbacks

| Agent | Deterministic Fallback |
|-------|----------------------|
| User & Goals | Extract constraints directly from structured profile |
| Risk | Risk profile score → fixed risk band mapping |
| Market & Research | Return "neutral" market context |
| Portfolio Construction | Model allocation for operating mode (60/40, 30/70, 80/20) |
| Rebalance Planner | Proportional rebalance to target weights |
| Explainability | Template-based explanation |

Every fallback activation is logged as an incident metric.

---

## 10. Prompt Engineering

> **Prototype scope**: Golden datasets, basic evaluation metrics, and prompt template versioning are implemented during Phase 3. Advanced methodology (A/B testing, gradual rollout, automated regression) is deferred to production — see [07-production-next-steps.md § 3](./07-production-next-steps.md).

### 10.1 Golden Test Scenarios (Prototype Baseline)

Each LLM agent gets **3-5 golden test scenarios** per category during Phase 3, expanding to 50+ for production:

| Category | Scenarios per Agent | Purpose |
|---|---|---|
| Normal operation | 3-5 | Various risk profiles, portfolio sizes, market conditions |
| Edge cases | 2-3 | Extreme allocations, minimal portfolios, conflicting constraints |
| Adversarial inputs | 1-2 | Prompt injection attempts, malformed data, boundary values |

**Storage**: Golden datasets are versioned fixtures in `libs/agent-core/test-fixtures/` in the monorepo. Each fixture includes input context, expected output structure, and tolerance bands for non-deterministic fields.

### 10.2 Evaluation Metrics (Prototype Baseline)

| Metric | Description | Phase 3 Target |
|---|---|---|
| Schema compliance rate | Output conforms to Zod schema | >99% |
| Guardrail pass rate | Decisions pass all defense-in-depth layers | >95% |
| Decision consistency | Same input produces semantically equivalent output across runs | >80% |

Advanced metrics (confidence calibration, semantic accuracy, hallucination rate) are tracked in production — see [07-production-next-steps.md § 3](./07-production-next-steps.md).

### 10.3 Prompt Template Versioning

Every agent invocation records the prompt hash in its artifact metadata, enabling audit replay with the exact prompt used.

```typescript
interface PromptVersion {
  agentName: string;
  hash: string;
  version: string;
  content: string;
  status: 'active' | 'deprecated';
}
```

Golden dataset regression runs on every prompt change in CI.

---

## 11. AI Reasoning Persistence

### 11.1 Stored Artifacts

```typescript
interface AgentArtifact {
  decisionId: string;
  agentName: string;
  timestamp: string;
  contextBundleHash: string;
  contextBundleS3Key: string;
  structuredOutput: unknown;
  rawResponse: string;
  modelId: string;
  promptHash: string;
  temperature: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  validationResult: 'PASS' | 'FAIL_RETRIED' | 'FALLBACK';
  agentCoreRuntimeVersion: string;
}
```

Storage: DynamoDB (metadata) + S3 (full context bundles and raw responses).

---

## 12. Model Governance

### 12.1 Four-Stage Promotion Pipeline

```
DRAFT ──▶ EVALUATING ──▶ SHADOW ──▶ ACTIVE ──▶ DEPRECATED
```

For initial development: Draft → Evaluating → Active (skip Shadow). Shadow mode introduced when real capital is at stake.

---

## 13. Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **LLM hallucination** | Medium | Critical | 6-layer guardrails, deterministic compliance gate |
| **AgentCore alpha instability** | Medium | Medium | Pin CDK version, abstract behind custom construct, test updates in staging |
| **Bedrock rate limits** | Medium | High | Tier escalation, circuit breaker on decision throughput |
| **Latency** | Medium | Medium | Parallel waves in LangGraph, Haiku for simple agents |
| **Model version drift** | Medium | Medium | Immutable prompt versioning, golden output regression |
| **Prompt injection** | Low | High | Structured context data, no user text in system prompts |
| **Bedrock regional availability** | Low | High | Check AgentCore + model availability before starting |

### Circuit Breaker

```typescript
const DECISION_CIRCUIT_BREAKER = {
  maxDecisionsPerMinute: 10,
  maxDecisionsPerTenantPerHour: 5,
  coolDownOnBreak: 300_000,
};
```
