# AgentCore Memory Integration: Cross-Decision Learning & Simplified Context Sharing

## Motivation

The 4 agent services (investor-profile-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl, advisory-narrative-ctrl) currently operate statelessly per invocation. Each decision lifecycle threads context through Step Functions payloads (`upstreamOutputs`), which grows as outputs accumulate through the pipeline. Agents have no memory of past decisions for the same tenant — every invocation starts from scratch.

This design integrates Amazon Bedrock AgentCore Memory to:

1. **Replace `upstreamOutputs` payload threading** — agents write to and read from a shared Memory session, shrinking SF payloads to `{ decisionId, tenantId, taskToken }`
2. **Enable cross-decision learning** — long-term memory strategies extract tenant patterns (risk preferences, communication style, allocation rationale) that improve agent quality over time
3. **Simplify DDB persistence** — semantic content (inputs, outputs, reasoning) moves to Memory; DDB retains only operational metadata (status, duration, model tier)

## Architecture

### Memory Resource Topology

One Memory resource per environment, provisioned in decision-workflow-ctrl stack (the orchestrator that owns the decision lifecycle). Shared across all agent services via SSM parameter.

```
Memory: "nestfolio-{env}-agent-memory"  (in decision-workflow-ctrl stack)
│
├── Short-term (per-decision, expires after 7 days)
│   ├── /investor-profile/{tenantId}/decisions/{decisionId}
│   ├── /market-intelligence/{tenantId}/decisions/{decisionId}
│   ├── /portfolio-engine/{tenantId}/decisions/{decisionId}
│   └── /advisory-narrative/{tenantId}/decisions/{decisionId}
│
└── Long-term (per-tenant, persists across decisions)
    ├── /investor-profile/{tenantId}/preferences       (userPreference strategy)
    ├── /market-intelligence/{tenantId}/signals         (semantic strategy)
    ├── /portfolio-engine/{tenantId}/rationale           (semantic strategy)
    ├── /advisory-narrative/{tenantId}/preferences       (userPreference strategy)
    └── /advisory-narrative/{tenantId}/sessions           (summary strategy)
```

**Namespace convention:** `/{serviceName}/{tenantId}/{scope}` where scope is either `decisions/{decisionId}` (short-term) or a long-term category.

### Memory vs Knowledge Base (RAG)

These are complementary, not competing:

| Concern | Tool | Content |
|---------|------|---------|
| **Behavioral patterns** (tenant preferences, signal trends) | AgentCore Memory | Extracted automatically from conversation events |
| **Document retrieval** (regulations, prospectuses, news) | Bedrock Knowledge Base | Ingested from S3 via StartIngestionJob |

Both are consulted at inference time. Memory provides "what does this tenant prefer?", KB provides "what do authoritative sources say?".

## Decision Session Flow

### Current flow (upstreamOutputs threading)

```
SF → ANALYZE_INVESTOR_PROFILE { decisionId, tenantId, taskToken, investorProfile, portfolioState }
  → investor-profile-ctrl runs agents
  → publishes INVESTOR_PROFILE_COMPLETED { decisionId, taskToken, result }
SF → ANALYZE_MARKET { decisionId, tenantId, taskToken, upstreamOutputs: { investorProfile: result } }
  → market-intelligence-ctrl runs agents
  → publishes MARKET_ANALYSIS_COMPLETED { decisionId, taskToken, result }
SF → CONSTRUCT_PORTFOLIO { ..., upstreamOutputs: { investorProfile, marketAnalysis } }
  → ... payload grows with each step
```

### New flow (Memory-based)

```
SF → creates decision session (actorId=tenantId, sessionId=decisionId)
SF → ANALYZE_INVESTOR_PROFILE { decisionId, tenantId, taskToken }
  → investor-profile-ctrl reads investorProfile from DDB State table
  → searches long-term memory: /investor-profile/{tenantId}/preferences
  → runs agents with enriched context
  → writes output to Memory: /investor-profile/{tenantId}/decisions/{decisionId}
  → publishes INVESTOR_PROFILE_COMPLETED { decisionId, taskToken }

SF → ANALYZE_MARKET { decisionId, tenantId, taskToken }
  → market-intelligence-ctrl searches Memory: /investor-profile/{tenantId}/decisions/{decisionId}
  → searches long-term memory: /market-intelligence/{tenantId}/signals
  → runs agent
  → writes output to Memory: /market-intelligence/{tenantId}/decisions/{decisionId}
  → publishes MARKET_ANALYSIS_COMPLETED { decisionId, taskToken }

SF → CONSTRUCT_PORTFOLIO { decisionId, tenantId, taskToken }
  → portfolio-engine-ctrl searches Memory for both upstream outputs
  → ... same pattern

SF → GENERATE_NARRATIVE { decisionId, tenantId, taskToken }
  → advisory-narrative-ctrl searches Memory for all 3 upstream outputs
  → searches long-term: preferences + sessions
  → ... same pattern

SF → AssembleDecisionPacket
  → decision-workflow-ctrl reads all 4 outputs from Memory namespaces
  → assembles final DecisionPacket
```

**Key change:** SF payloads shrink to 3 fields. No output accumulation. Each agent pulls exactly what it needs from Memory.

## Long-term Memory Strategies

Five strategies declared on the single Memory resource:

| Strategy | Type | Service | Namespace | What it learns |
|----------|------|---------|-----------|---------------|
| InvestorPreferenceLearner | userPreference | investor-profile-ctrl | `/investor-profile/{actorId}/preferences` | Risk tolerance, goal patterns, rejected proposal types |
| MarketSignalExtractor | semantic | market-intelligence-ctrl | `/market-intelligence/{actorId}/signals` | Recurring market signals, sector trends |
| AllocationRationaleExtractor | semantic | portfolio-engine-ctrl | `/portfolio-engine/{actorId}/rationale` | Allocation decisions, trade outcomes |
| NarrativePreferenceLearner | userPreference | advisory-narrative-ctrl | `/advisory-narrative/{actorId}/preferences` | Explanation length, tone, jargon tolerance |
| NarrativeSessionSummarizer | summary | advisory-narrative-ctrl | `/advisory-narrative/{actorId}/sessions` | Decision session summaries |

**Population:** Automatic. AgentCore Memory extracts long-term records asynchronously from short-term conversation events. No custom extraction Lambda needed.

**advisory-narrative-ctrl feedback loop:** The existing feedback-correlator Lambda is kept. Memory's userPreference strategy learns behavioral patterns (tone, length preferences). The Explainability KB retains full annotated narrative documents for RAG. Different purposes: Memory captures *patterns*, KB captures *exemplars*.

## Runtime Helper in agent-core

A thin `createMemoryClient` factory in `libs/agent-core/src/memory/` standardizing how services interact with Memory.

```typescript
// libs/agent-core/src/memory/memory-client.ts

export interface MemoryClientConfig {
  memoryId: string;       // from MEMORY_ID env var
  region: string;
  serviceName: string;    // e.g. 'investor-profile'
}

export interface DecisionSession {
  /** Write agent output to short-term decision namespace */
  writeAgentOutput(output: Record<string, unknown>): Promise<void>;
  /** Read upstream agent output from another service's decision namespace */
  readUpstreamOutput(upstreamService: string): Promise<Record<string, unknown>[]>;
  /** Search long-term memory for this tenant */
  searchLongTermMemory(query: string, topK?: number): Promise<MemoryRecord[]>;
}

export function createMemoryClient(config: MemoryClientConfig): MemoryClient;

export interface MemoryClient {
  /** Open or resume a decision session (short-term) */
  openDecisionSession(tenantId: string, decisionId: string): DecisionSession;
  /** Search tenant long-term memory (cross-decision) */
  searchTenantMemory(tenantId: string, query: string, topK?: number): Promise<MemoryRecord[]>;
}
```

**Namespace logic baked in:** `openDecisionSession('tenant-1', 'dec-42')` on a client with `serviceName: 'investor-profile'` writes to `/investor-profile/tenant-1/decisions/dec-42`.

**Graceful degradation:** If Memory API is unavailable, `createMemoryClient` returns a no-op client. Agents run without memory context — Memory is an enhancement, not a hard dependency.

## CDK Wiring

### decision-workflow-ctrl stack (Memory owner)

```typescript
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';

// Memory resource with all 5 strategies
const memory = new agentcore.Memory(this, 'AgentMemory', {
  memoryName: `nestfolio-${props.prefix}-agent-memory`,
  description: 'Shared agent memory for cross-decision learning',
  expirationDuration: Duration.days(7),
  strategies: [
    MemoryStrategy.usingUserPreference({
      name: 'InvestorPreferenceLearner',
      namespaces: ['/investor-profile/{actorId}/preferences'],
    }),
    MemoryStrategy.usingSemantic({
      name: 'MarketSignalExtractor',
      namespaces: ['/market-intelligence/{actorId}/signals'],
    }),
    MemoryStrategy.usingSemantic({
      name: 'AllocationRationaleExtractor',
      namespaces: ['/portfolio-engine/{actorId}/rationale'],
    }),
    MemoryStrategy.usingUserPreference({
      name: 'NarrativePreferenceLearner',
      namespaces: ['/advisory-narrative/{actorId}/preferences'],
    }),
    MemoryStrategy.usingSummary({
      name: 'NarrativeSessionSummarizer',
      namespaces: ['/advisory-narrative/{actorId}/sessions'],
    }),
  ],
});

// Export memoryId via SSM for service stacks
new StringParameter(this, 'MemoryIdParam', {
  parameterName: naming.ssmParameterPath('memory/id'),
  stringValue: memory.memoryId,
});
```

### Each agent service stack (consumer)

```typescript
// Read Memory ID from decision-workflow-ctrl SSM
const workflowNaming = new NamingService({
  prefix: props.prefix, subsystem: 'advisory', service: 'decision-workflow-ctrl',
});
const memoryId = StringParameter.valueForStringParameter(
  this, workflowNaming.ssmParameterPath('memory/id'),
);

// Pass to Lambda
ingress.handler.addEnvironment('MEMORY_ID', memoryId);

// IAM grants for Memory API
ingress.handler.addToRolePolicy(new PolicyStatement({
  actions: [
    'bedrock-agentcore:CreateEvent',
    'bedrock-agentcore:RetrieveMemoryRecords',
  ],
  resources: ['*'],  // scoped to memory ARN when available via SSM
}));
```

## DDB Persistence Changes

**Before:** Each service writes full `AgentInvocation` record to DDB:
```
PK: DECISION#{decisionId}  SK: INV#{invocationId}
Fields: agentName, status, startedAt, completedAt, durationMs, input, output, metadata
```

**After:** DDB keeps operational fields only:
```
PK: DECISION#{decisionId}  SK: INV#{invocationId}
Fields: agentName, status, startedAt, completedAt, durationMs, modelTier, errorInfo
```

`input` and `output` fields (the bulkiest part) move to Memory as conversation events. DDB stays fast and cheap for operational queries. Memory is searchable for semantic retrieval.

## Simplifications Summary

### Code removed

| What | Where | Change |
|------|-------|--------|
| `upstreamOutputs` field | SF trigger payloads, all 4 agent event schemas | Removed — agents read from Memory |
| Output accumulation logic | decision-workflow-ctrl state machine | Removed — no threading outputs through SF state |
| `input`/`output` fields in DDB writes | All 4 agent service repositories | Removed — semantic content in Memory |
| `AssembleDecisionPacket` payload merge | decision-workflow-ctrl | Reads 4 namespaces from Memory |

### Code added

| What | Where | Size |
|------|-------|------|
| `createMemoryClient` + `DecisionSession` | `libs/agent-core/src/memory/` | ~100 lines + tests |
| `agentcore.Memory` construct + SSM export | decision-workflow-ctrl stack | ~30 lines |
| `MEMORY_ID` env var + IAM grants | 5 service stacks | ~10 lines each |
| Memory read/write calls | Each agent service handler | ~15 lines each |

### What stays unchanged

- KnowledgeBase construct + KB ingestion handlers (RAG for documents)
- feedback-correlator in advisory-narrative-ctrl (exemplar narratives for KB)
- AgentRuntime constructs in each service stack
- LangGraph orchestration in agent-core
- DDB State tables (operational records, minus input/output fields)

## Dependencies

- `@aws-cdk/aws-bedrock-agentcore-alpha` — CDK construct for Memory (alpha, add to devDependencies)
- AgentCore Memory JS/TS SDK — runtime client for write/search (verify npm package availability; fallback to raw API calls via `@aws-sdk/client-bedrock-agent-runtime` if no dedicated SDK)

## Risk & Mitigations

| Risk | Mitigation |
|------|-----------|
| AgentCore CDK package is alpha | Pin version, wrap in thin construct if API changes |
| JS/TS Memory SDK may not exist yet | Use `@aws-sdk/client-bedrock-agent-runtime` API calls directly |
| Memory API latency adds to agent invocation time | Parallel: search Memory + fetch DDB state concurrently |
| Memory unavailable | Graceful degradation — no-op client, agents work without |
| Long-term extraction lag (async, ~60s) | Acceptable — long-term memory is for *next* decision, not current |
