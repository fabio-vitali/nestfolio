# AgentCore Features Adoption — Design Spec

## Context

Nestfolio uses `@aws-cdk/aws-bedrock-agentcore-alpha@2.243.0-alpha.0` for its advisory domain AI agents. The current usage covers Runtime, Gateway, Memory (CDK + SDK), and a custom KnowledgeBase construct. Several AgentCore features remain unused. This spec designs the adoption of the 4 most valuable feature areas as independent tracks.

### Current AgentCore Usage

| Feature | Where | Details |
|---|---|---|
| `Runtime` | `AgentRuntime` construct (5 services) | `fromAsset()`, Cognito auth, lifecycle config, env vars |
| `Gateway` | `AgentRuntime` construct | MCP protocol, IAM auth, `addLambdaTarget()`, `ToolSchema` |
| `Memory` (CDK) | `decision-workflow-ctrl` stack | 5 strategies: 2x `usingUserPreference`, 2x `usingSemantic`, 1x `usingSummarization` |
| `Memory` (SDK) | 4 agent services + `assemble-packet` | `createMemoryClient()` → `CreateEvent`, `RetrieveMemoryRecords` |
| `KnowledgeBase` | 3 services (custom L1 construct) | S3 Vectors, Titan embeddings |

### Out of Scope

- **RuntimeEndpoint versioning** — not needed pre-production
- **VPC network configuration** — public network is sufficient; agents access DynamoDB via IAM, Bedrock via public API, external data via tool Lambdas
- **Episodic reflection** — can be added later without architectural changes
- **Self-managed Memory strategies** — custom extraction prompts (Track D) cover current needs
- **Gateway outbound auth** (OAuth, API Key, IAM Role) — no current tool targets call authenticated external APIs

---

## Track A: CodeInterpreter Construct

### Purpose

Enable portfolio-engine and market-intelligence agents to run sandboxed Python code for numerical analysis, data visualization, and ad-hoc computations that are too heavy or dynamic for inline Lambda execution.

### New File: `libs/cdk-constructs/src/code-interpreter.ts`

**Construct:** `AgentCodeInterpreter`

**Props:**

```typescript
export interface AgentCodeInterpreterProps {
  /** Name for the CodeInterpreter (e.g. 'portfolio_engine_sandbox') */
  readonly interpreterName: string;
  /** Human-readable description */
  readonly description?: string;
  /** Network mode: PUBLIC (internet access for pip install) or SANDBOX (isolated). Default: PUBLIC */
  readonly networkMode?: 'PUBLIC' | 'SANDBOX';
  /** Tags to apply */
  readonly tags?: Record<string, string>;
}
```

**What it provisions:**
- `agentcore.CodeInterpreterCustom` with configurable network mode (default PUBLIC)
- Standard tags via `applyStandardTags()`
- Exposes `grantInvoke(grantee)` for easy IAM wiring
- Exposes the underlying `codeInterpreter` resource for advanced access

**What it does NOT do:**
- No VPC support (public network is fine)
- No custom execution role (CDK auto-creates)

### Service Integration

| Service | Interpreter Name | Use Cases |
|---|---|---|
| `portfolio-engine-ctrl` | `portfolio_engine_sandbox` | Monte Carlo simulations, efficient frontier, VaR/Sharpe/Sortino, allocation optimization |
| `market-intelligence-ctrl` | `market_intelligence_sandbox` | Data analysis, backtesting, trend calculations |

**Wiring pattern in service stacks:**

```typescript
const codeInterpreter = new AgentCodeInterpreter(this, 'CodeInterpreter', {
  interpreterName: 'portfolio_engine_sandbox',
  description: 'Sandboxed Python for portfolio math and simulations',
});
codeInterpreter.grantInvoke(this.agentRuntime.runtime);
```

The Runtime's agent code (LangGraph.js) calls the CodeInterpreter SDK at invocation time. The CDK construct provisions infrastructure and grants permissions.

### Testing

- CDK assertion tests verifying resource type, properties, IAM grants, tags
- Snapshot test for synthesized template
- File: `libs/cdk-constructs/test/code-interpreter.test.ts`

---

## Track B: Browser Construct

### Purpose

Enable market-intelligence agents to browse live web sources — regulatory filings (SEC EDGAR), fund prospectuses, analyst reports, financial news — as part of their research workflow.

### New File: `libs/cdk-constructs/src/agent-browser.ts`

**Construct:** `AgentBrowser`

**Props:**

```typescript
export interface AgentBrowserProps {
  /** Name for the Browser (e.g. 'market_intelligence_browser') */
  readonly browserName: string;
  /** Human-readable description */
  readonly description?: string;
  /** Browser signing: identifies as AI agent to bot-control vendors. Default: ENABLED */
  readonly signing?: 'ENABLED' | 'DISABLED';
  /** Optional S3 bucket for session recordings (audit/compliance) */
  readonly recordingBucket?: IBucket;
  /** Tags to apply */
  readonly tags?: Record<string, string>;
}
```

**What it provisions:**
- `agentcore.BrowserCustom` with public network mode
- Browser signing enabled by default (ethical AI identification — important for a financial platform scraping regulatory sites)
- Optional S3 recording configuration for compliance audit trail
- Standard tags via `applyStandardTags()`
- Exposes `grantUse(grantee)` for IAM wiring

**What it does NOT do:**
- No VPC support
- No custom execution role

### Service Integration

| Service | Browser Name | Use Cases |
|---|---|---|
| `market-intelligence-ctrl` | `market_intelligence_browser` | SEC EDGAR filings, fund prospectuses, analyst reports, financial news |

**Wiring pattern in service stack:**

```typescript
const browser = new AgentBrowser(this, 'Browser', {
  browserName: 'market_intelligence_browser',
  description: 'Headless browser for regulatory filings and market research',
  signing: 'ENABLED',
});
browser.grantUse(this.agentRuntime.runtime);
```

**Recording:** Session recordings are optional but recommended for market-intelligence. When an agent scrapes a regulatory filing, recordings provide an audit trail of exactly what the agent saw. The `recordingBucket` can reuse the existing KB bucket or create a dedicated one.

### Testing

- CDK assertion tests verifying resource type, properties, signing config, recording setup, IAM grants, tags
- Snapshot test for synthesized template
- File: `libs/cdk-constructs/test/agent-browser.test.ts`

---

## Track C: Gateway Interceptors

### Purpose

Add cross-cutting guardrails to all MCP Gateway tool invocations: tenant isolation, audit logging, input validation, and rate limiting. These are compliance and security requirements for a multi-tenant financial advisory platform.

### Design Decision: Extend `AgentRuntime` (not separate constructs)

Interceptors are tightly coupled to the Gateway they attach to. Rather than standalone constructs, interceptor support is added to the existing `AgentRuntime` construct via new optional props.

### Changes to `AgentRuntimeProps`

```typescript
export interface InterceptorConfig {
  /** Inject tenantId into tool requests, reject requests without tenant context */
  tenantScope?: boolean;
  /** Validate/sanitize tool request payloads before they hit targets */
  inputValidation?: boolean;
  /** Throttle tool invocations per tenant per minute */
  rateLimiting?: {
    maxInvocationsPerMinute: number;
    table: ITable; // DDB table for rate counters (with TTL)
  };
  /** Log all tool invocations in structured JSON for compliance */
  auditTrail?: boolean;
}

export interface AgentRuntimeProps {
  // ... existing props ...
  /** Gateway interceptors for cross-cutting concerns */
  interceptors?: InterceptorConfig;
}
```

### Interceptor Details

| Interceptor | Point | Lambda File | Behavior |
|---|---|---|---|
| **Tenant scope** | `REQUEST` | `interceptors/tenant-scope.ts` | Extracts `tenantId` from caller's identity/session, injects into tool request payload. Rejects requests without valid tenant context. |
| **Input validator** | `REQUEST` | `interceptors/input-validator.ts` | Validates tool request payloads against expected shapes, sanitizes strings, rejects oversized payloads. Runs after tenant-scope. |
| **Rate limiter** | `REQUEST` | `interceptors/rate-limiter.ts` | Increments per-tenant counter in DDB (with TTL). Rejects if over threshold. Prevents runaway agent loops from burning budget. |
| **Audit trail** | `RESPONSE` | `interceptors/audit-trail.ts` | Logs tool name, tenant, input summary, output summary, latency, status to CloudWatch Logs in structured JSON. Post-response to capture outcome. |

### New Files

```
libs/cdk-constructs/src/interceptors/
  tenant-scope.ts        — REQUEST interceptor Lambda handler
  input-validator.ts     — REQUEST interceptor Lambda handler
  rate-limiter.ts        — REQUEST interceptor Lambda handler
  audit-trail.ts         — RESPONSE interceptor Lambda handler
```

### Request Interceptor Ordering

REQUEST interceptors fire in order: **tenant-scope → input-validator → rate-limiter**. This ensures:
1. Tenant context is established first
2. Payload is validated before rate-counting
3. Rate limiting uses the resolved tenantId

### Interceptor Lambda Placement

Interceptor Lambdas live in `cdk-constructs` (not individual services) because they are generic, reusable infrastructure. Service-specific logic stays in tool target Lambdas.

### Wiring

Interceptors are created inside the `AgentRuntime` construct when their flags are enabled. Each is a `NodejsFunction` bundled from `cdk-constructs/src/interceptors/` and attached to the Gateway via `agentcore.Interceptor.fromLambdaFunction()`.

```typescript
new AgentRuntime(this, 'AgentRuntime', {
  runtimeName: 'portfolio_engine_agents',
  agentCodePath: join(__dirname, '..', 'agents'),
  // ... existing props ...
  interceptors: {
    tenantScope: true,
    auditTrail: true,
    inputValidation: true,
    rateLimiting: {
      maxInvocationsPerMinute: 100,
      table: rateLimitTable,
    },
  },
});
```

### Testing

- CDK assertion tests: verify interceptor Lambdas are created only when flags are enabled, correct `InterceptionPoint`, proper IAM grants
- Unit tests for each interceptor Lambda handler: mock Gateway event shape, verify behavior
- Files: `libs/cdk-constructs/test/interceptors/tenant-scope.test.ts`, etc.

---

## Track D: Memory Enhancements

### Purpose

Harden the existing `agentcore.Memory` in `decision-workflow-ctrl` with KMS encryption (compliance requirement for financial data) and domain-specific extraction/consolidation prompts (improve LTM quality).

### Change 1: KMS Encryption

Add a customer-managed KMS key with automatic rotation.

```typescript
const memoryKey = new kms.Key(this, 'AgentMemoryKey', {
  alias: `${props.prefix}/agent-memory`,
  description: 'Encryption key for AgentCore Memory (investor financial data)',
  enableKeyRotation: true,
});

const memory = new agentcore.Memory(this, 'AgentMemory', {
  // ... existing props ...
  encryptionKmsKey: memoryKey,
});
```

**Why `enableKeyRotation: true`:** Financial data compliance typically requires automatic key rotation. AWS handles rotation transparently.

**IAM impact:** The `Memory` L2 construct automatically grants the memory's execution role `kms:Decrypt` and `kms:GenerateDataKey`. Consumer stacks (4 agent services) don't need changes — the Memory construct's role handles encryption internally.

### Change 2: Custom Extraction/Consolidation Prompts

Override default LTM extraction prompts on 3 of the 5 strategies to be domain-specific.

| Strategy | Custom Extraction Prompt | Custom Consolidation Prompt |
|---|---|---|
| `InvestorPreferenceLearner` | "Extract investment preferences: risk tolerance level, asset class preferences, ESG constraints, liquidity needs, time horizon, and any stated return targets. Ignore conversational filler." | "When consolidating investor preferences, newer statements override older ones for the same dimension. Flag contradictions (e.g., 'high growth' vs 'conservative')." |
| `AllocationRationaleExtractor` | "Extract portfolio allocation rationale: why each asset class was weighted, which constraints were binding, what trade-offs were made, and confidence level of each recommendation." | "Consolidate allocation rationale chronologically. Preserve the reasoning chain — don't collapse distinct decisions into a summary." |
| `NarrativePreferenceLearner` | "Extract communication preferences: preferred explanation depth (simple/detailed), terminology level (retail/professional), format preferences (bullet points/prose), and topics the investor engages with most." | "Consolidate communication preferences using most recent signals. Weight explicit feedback ('I prefer simpler explanations') higher than inferred patterns." |

**Unchanged strategies:**
- `MarketSignalExtractor` (semantic) — default extraction works well for market signals
- `NarrativeSessionSummarizer` (summarization) — default summarization is appropriate

**Prompt location:** Inline in the stack file. They're short, tightly coupled to the strategy, and don't change frequently. Can be extracted to a `prompts/` directory later if needed.

**Model override:** Uses the default model provided by AgentCore. No need to override with a specific model.

### Testing

- Update existing `decision-workflow-ctrl` stack test to verify:
  - KMS key is created with rotation enabled
  - Memory resource references the KMS key
  - Custom extraction/consolidation prompts are set on the correct 3 strategies
  - Remaining 2 strategies have no custom overrides
- No new test files — extend existing stack tests

---

## Cross-Cutting Concerns

### Construct Exports

Update `libs/cdk-constructs/src/index.ts`:

```typescript
export { AgentCodeInterpreter, AgentCodeInterpreterProps } from './code-interpreter';
export { AgentBrowser, AgentBrowserProps } from './agent-browser';
// InterceptorConfig is already exported via AgentRuntimeProps
```

### Track Independence

All 4 tracks are fully independent with no ordering constraints. They can be implemented in parallel or in any sequence.

The only shared touchpoint is that Track C modifies `AgentRuntime` (which Tracks A and B's service stacks also use), but changes are additive (new optional props — no breaking changes).

### File Summary

| Track | New Files | Modified Files |
|---|---|---|
| A | `cdk-constructs/src/code-interpreter.ts`, `cdk-constructs/test/code-interpreter.test.ts` | `cdk-constructs/src/index.ts`, `portfolio-engine-ctrl/src/service.stack.ts`, `market-intelligence-ctrl/src/service.stack.ts` |
| B | `cdk-constructs/src/agent-browser.ts`, `cdk-constructs/test/agent-browser.test.ts` | `cdk-constructs/src/index.ts`, `market-intelligence-ctrl/src/service.stack.ts` |
| C | `cdk-constructs/src/interceptors/tenant-scope.ts`, `cdk-constructs/src/interceptors/input-validator.ts`, `cdk-constructs/src/interceptors/rate-limiter.ts`, `cdk-constructs/src/interceptors/audit-trail.ts`, `cdk-constructs/test/interceptors/*.test.ts` | `cdk-constructs/src/agent-runtime.ts` |
| D | (none) | `decision-workflow-ctrl/src/service.stack.ts`, `decision-workflow-ctrl/test/*.test.ts` |
