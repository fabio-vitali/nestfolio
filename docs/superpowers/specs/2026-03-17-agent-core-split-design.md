# Agent-Core Split: Generic Orchestration + Domain Separation

## Problem

`libs/agent-core` mixes two concerns:
1. Generic LangGraph+Bedrock orchestration infrastructure (node creation, retry/escalation, wave-based parallel execution)
2. Decision lifecycle domain code (6 agent schemas, model configs, fallback outputs, business validation rules, golden fixtures, prompt templates)

This makes agent-core non-reusable for future agent use cases and violates the project's "publisher owns domain" principle.

## Solution

Split into:
- **`libs/agent-core`** — fully generic orchestration toolkit with no domain knowledge
- **`services/advisory/advisory-ctrl/src/agents/`** — decision lifecycle domain code

## Existing Code to Migrate

### Current agent-core exports consumed by advisory-ctrl

From `services/advisory/advisory-ctrl/src/services/decision-lifecycle.service.ts`:
- `createAgentNode`, `invokeGraph`, `createFallbackNodeMap`, `AGENT_TYPES`
- Types: `AgentNodeMap`, `DecisionStateType`, `ServiceUnavailableResponse`

From `services/advisory/advisory-ctrl/agents/decision-lifecycle/src/index.ts`:
- `createAgentNode`, `buildDecisionGraph`, `AGENT_TYPES`, `AgentNodeMap`

### What gets removed/replaced

| Current | Replacement |
|---------|-------------|
| `AGENT_TYPES` (hardcoded 6-element array) | `AgentType` union in advisory-ctrl `config.ts` |
| `AgentNodeMap` (typed Record with 6 keys) | Generic `Record<K, RunnableNode>` built by `createOrchestrator` |
| `DecisionStateType` (hardcoded state shape) | `DecisionLifecycleState` annotation in advisory-ctrl `state.ts` |
| `ModelConfig` + `getModelConfig()` | Merged into `AgentConfig<T>` (schema + prompt included) |
| `getOutputSchema(agentType)` | Unnecessary — `AgentConfig.schema` carries the schema directly |
| `createAgentNode(agentType)` (looks up config by type) | `createAgentNode(config: AgentConfig<T>)` (config passed in) |
| `buildDecisionGraph(nodeMap)` (hardcoded 3-wave) | `createOrchestrator(config)` (wave config passed in) |
| `invokeGraph(input, { nodeMap, fallbackNodeMap })` | `invokeOrchestrator(graph, input, options?)` |
| `createRetryableAgentNode()` (monolithic) | Decomposed into `withRetry()` + `withValidation()` + `withFallback()` |

### Existing `agents/decision-lifecycle/` directory

The `services/advisory/advisory-ctrl/agents/decision-lifecycle/` directory (separate Nx project `decision-lifecycle-agent`) currently just builds the graph and exports it. After migration, this directory is **deleted** — the graph construction moves into `advisory-ctrl/src/agents/config.ts` and the service wires it via `createOrchestrator()`. The separate Nx project entry is removed from workspace config.

## agent-core: Generic Orchestration Toolkit

### Types

```ts
// Core config for any agent node
interface AgentConfig<T extends z.ZodType> {
  modelId: string;        // Bedrock model ID
  maxTokens: number;
  temperature: number;
  schema: T;              // Zod schema for structured output
  promptTemplate: string; // Prompt text (loaded by consumer, passed as string)
}

// Wave-based parallel execution definition
type WaveDefinition<K extends string> = Array<{
  agents: K[];            // Agents that run in parallel within this wave
  dependsOn?: K[];        // Agents from prior waves this wave depends on
}>;

// Full orchestrator configuration — consumer provides state annotation with
// keys matching agent names; createOrchestrator uses K to dynamically wire
// each agent's output into the corresponding state key.
interface OrchestratorConfig<K extends string, TState> {
  waves: WaveDefinition<K>;
  stateAnnotation: Annotation<TState>;
  agents: Record<K, AgentConfig<any>>;
  fallbacks?: Record<K, (input: TState) => Partial<TState>>;
  validationRules?: Record<K, ValidationRule<any>>;
}

// Generic validation rule
interface ValidationRule<T> {
  validate: (output: T) => ValidationResult;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Retry + escalation options
interface RetryOptions {
  maxAttempts: number;            // Default: 3
  escalationPath?: ModelTier[];   // e.g., ['haiku', 'sonnet', 'opus']
}

type ModelTier = 'haiku' | 'sonnet' | 'opus';
```

### Functions

| Function | Signature | Purpose |
|----------|-----------|---------|
| `createAgentNode` | `<T>(config: AgentConfig<T>) => RunnableNode` | Creates LangGraph node with `ChatBedrockConverse` + `withStructuredOutput(schema)` |
| `withValidation` | `<T>(node, rule: ValidationRule<T>) => RunnableNode` | Wraps node to validate output; throws `ValidationError` on failure (used within retry loop) |
| `withRetry` | `(node, options: RetryOptions) => RunnableNode` | Wraps node with retry loop + tier escalation on validation/invocation failure |
| `withFallback` | `(node, fallbackFn) => RunnableNode` | Decorates node with deterministic fallback on total failure |
| `createOrchestrator` | `<K, TState>(config: OrchestratorConfig<K, TState>) => CompiledGraph` | Builds StateGraph from wave definitions, wires parallel/sequential edges, applies validation+retry+fallback per node |
| `invokeOrchestrator` | `(graph, input, options?) => Promise<TState>` | Invokes graph with Logger/Metrics, primary→fallback flow, `ServiceUnavailableResponse` on total failure |
| `buildEscalationPath` | `(startTier: ModelTier) => ModelTier[]` | Returns escalation sequence (Haiku→Sonnet→Opus) |

### Decorator composition order

`createOrchestrator` composes decorators in this order for each agent node:
```
createAgentNode(config)
  → withValidation(node, rule)     // validates structured output against business rules
  → withRetry(validated, options)  // retries on ValidationError, escalates tier on retry
  → withFallback(retried, fn)     // deterministic fallback if all retries exhausted
```

This decomposition replaces the current monolithic `createRetryableAgentNode()` which interleaves validation within the retry loop. The validation decorator throws a typed `ValidationError` that `withRetry` catches to trigger retry/escalation, preserving the same behavior with cleaner separation.

### State annotation contract

The consumer defines a LangGraph `Annotation` whose keys match the agent keys `K`. For example, the decision lifecycle defines:
```ts
const DecisionLifecycleState = Annotation.Root({
  input: Annotation<string>,
  'user-goals': Annotation<GoalInterpretation>,
  'risk-assessment': Annotation<RiskAssessment>,
  // ... one key per agent
});
```

`createOrchestrator` uses the `K` type parameter to wire each agent node's output into `state[agentKey]`. The orchestrator does NOT create the annotation — it receives it. This keeps agent-core fully generic: it only requires that the annotation has keys matching the agent names in the config.

### Barrel Export (`src/index.ts`)

Exports all types and functions above. No domain-specific exports.

### Dependencies (unchanged)

- `@langchain/aws` (ChatBedrockConverse)
- `@langchain/langgraph` (StateGraph, Annotation)
- `@langchain/core` (messages, base classes)
- `@aws-lambda-powertools/logger`
- `@aws-lambda-powertools/metrics`
- `zod`

## advisory-ctrl/src/agents/: Decision Lifecycle Domain

### File Structure

```
services/advisory/advisory-ctrl/src/agents/
├── config.ts                         # AgentType union, AGENT_CONFIGS map, DECISION_LIFECYCLE_WAVES
├── state.ts                          # DecisionLifecycleState annotation
├── validation.ts                     # Business rules (weight sums, position limits, score-category, etc.)
├── fallbacks.ts                      # Deterministic fallback outputs (risk-profile-aware allocations)
├── schemas/
│   ├── index.ts                      # Re-exports all schemas + inferred types
│   ├── user-goals.schema.ts
│   ├── risk-assessment.schema.ts
│   ├── market-research.schema.ts
│   ├── portfolio-construction.schema.ts
│   ├── rebalance-planner.schema.ts
│   └── explainability.schema.ts
├── prompts/                          # .txt prompt template files (loaded at init, passed as strings)
│   └── *.txt
└── fixtures/                         # Golden test data
    ├── golden-contexts.ts
    └── golden-outputs.ts
```

### Prompt loading

Prompt `.txt` files move to `services/advisory/advisory-ctrl/src/agents/prompts/`. advisory-ctrl loads them at initialization (e.g., `readFileSync` or bundled as assets) and passes the resulting strings into `AgentConfig.promptTemplate`. agent-core never reads files — it receives prompt text as a string. The `loadPromptTemplate()` utility currently in agent-core is **deleted**.

### config.ts

```ts
import { AgentConfig, WaveDefinition } from '@nestfolio/agent-core';
import { UserGoalsSchema } from './schemas/user-goals.schema';
// ... other schema imports
import { loadPrompt } from './prompts/loader'; // local utility

export type AgentType =
  | 'user-goals'
  | 'risk-assessment'
  | 'market-research'
  | 'portfolio-construction'
  | 'rebalance-planner'
  | 'explainability';

export const AGENT_CONFIGS: Record<AgentType, AgentConfig<any>> = {
  'user-goals':             { modelId: 'anthropic.claude-3-haiku-...', maxTokens: 2048, temperature: 0.0, schema: UserGoalsSchema, promptTemplate: loadPrompt('user-goals') },
  'risk-assessment':        { modelId: 'anthropic.claude-3-opus-...',  maxTokens: 4096, temperature: 0.1, schema: RiskAssessmentSchema, promptTemplate: loadPrompt('risk-assessment') },
  'market-research':        { modelId: 'anthropic.claude-3-sonnet-...', maxTokens: 4096, temperature: 0.2, schema: MarketResearchSchema, promptTemplate: loadPrompt('market-research') },
  'portfolio-construction': { modelId: 'anthropic.claude-3-opus-...',  maxTokens: 4096, temperature: 0.1, schema: PortfolioConstructionSchema, promptTemplate: loadPrompt('portfolio-construction') },
  'rebalance-planner':      { modelId: 'anthropic.claude-3-sonnet-...', maxTokens: 4096, temperature: 0.1, schema: RebalancePlannerSchema, promptTemplate: loadPrompt('rebalance-planner') },
  'explainability':         { modelId: 'anthropic.claude-3-sonnet-...', maxTokens: 8192, temperature: 0.3, schema: ExplainabilitySchema, promptTemplate: loadPrompt('explainability') },
};

export const DECISION_LIFECYCLE_WAVES: WaveDefinition<AgentType> = [
  { agents: ['user-goals', 'risk-assessment', 'market-research'] },
  { agents: ['portfolio-construction', 'rebalance-planner'], dependsOn: ['user-goals', 'risk-assessment', 'market-research'] },
  { agents: ['explainability'], dependsOn: ['portfolio-construction', 'rebalance-planner'] },
];
```

### Wiring (in DecisionLifecycleService)

```ts
import { createOrchestrator, invokeOrchestrator } from '@nestfolio/agent-core';
import { AGENT_CONFIGS, DECISION_LIFECYCLE_WAVES } from './agents/config';
import { DecisionLifecycleState } from './agents/state';
import { FALLBACK_MAP } from './agents/fallbacks';
import { VALIDATION_RULES } from './agents/validation';

const graph = createOrchestrator({
  waves: DECISION_LIFECYCLE_WAVES,
  stateAnnotation: DecisionLifecycleState,
  agents: AGENT_CONFIGS,
  fallbacks: FALLBACK_MAP,
  validationRules: VALIDATION_RULES,
});

// In service method:
const result = await invokeOrchestrator(graph, { input: JSON.stringify(context) });
```

## Test Strategy

### agent-core tests (`libs/agent-core/test/`)

Generic infrastructure tests — no domain schemas or configs:

- **createAgentNode**: Creates node with arbitrary test schema, calls ChatBedrockConverse with correct params
- **withValidation**: Passes valid output through, throws `ValidationError` on rule failure
- **withRetry**: Retries on `ValidationError`, escalates tier, stops at max attempts
- **withFallback**: Calls fallback function on node failure, passes input through
- **buildEscalationPath**: Correct sequences for each starting tier
- **createOrchestrator**: Builds correct graph edges from wave config, parallel nodes within wave, sequential between waves, composes validation+retry+fallback per node
- **invokeOrchestrator**: Logs start/end, emits metrics, returns state on success, tries fallback graph, returns ServiceUnavailableResponse on total failure

All tests use simple test schemas (e.g., `z.object({ value: z.string() })`) — no decision lifecycle types.

### advisory-ctrl agent tests (`services/advisory/advisory-ctrl/test/agents/`)

Domain-specific tests:

- **schemas/**: Zod validation for all 6 schemas, boundary conditions
- **validation**: Business rules (weight sums ≈1.0, position limits, score-category consistency, ticker format, etc.)
- **fallbacks**: Deterministic outputs for all 6 agents, risk-profile-aware allocations, schema compliance
- **config**: All 6 agents have valid configs, wave dependencies are correct
- **fixtures**: Golden outputs pass schema + business validation
- **integration**: Full decision lifecycle graph invocation with mocked Bedrock responses

## Migration Notes

- Only consumer of agent-core is `advisory-ctrl` — no other services need updating
- `services/advisory/advisory-ctrl/agents/decision-lifecycle/` (Nx project `decision-lifecycle-agent`) is **deleted** after migration; its graph construction logic is absorbed into `src/agents/config.ts`
- Prompt `.txt` files move to `services/advisory/advisory-ctrl/src/agents/prompts/`; loaded locally, passed as strings to `AgentConfig`
- `loadPromptTemplate()` in agent-core is deleted — consumers handle their own prompt loading
- `getOutputSchema()` barrel lookup is deleted — schemas are carried directly in `AgentConfig.schema`
- `ModelConfig` type and `getModelConfig()` function are deleted — merged into `AgentConfig<T>`
- tsconfig path `@nestfolio/agent-core` remains (generic lib), no new paths needed
- `advisory-ctrl` project.json assets config may need updating to bundle prompt `.txt` files
