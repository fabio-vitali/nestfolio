# AgentCore Memory Custom Prompts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add domain-specific extraction/consolidation prompts to 3 of the 5 existing AgentCore Memory strategies in `decision-workflow-ctrl`. This improves long-term memory quality for investor preferences, allocation rationale, and communication preferences — the strategies where generic defaults lose domain signal.

**Scope:** Single service (`decision-workflow-ctrl`), single new dependency (`@aws-cdk/aws-bedrock-alpha`), no new constructs, no new infrastructure.

**Spec:** `docs/superpowers/specs/2026-03-19-agentcore-features-design.md` (Track D only — Tracks A/B/C dropped as over-engineering for POC stage)

---

## What was dropped and why

| Track | Feature | Why dropped |
|-------|---------|-------------|
| A | CodeInterpreter construct | Tool Lambdas already cover all computations. No concrete use case that needs ad-hoc Python sandboxing at POC stage. |
| B | Browser construct | Market data comes from 5 structured feeds (Yahoo Finance, MarketWatch, SEC 8K, FRED, Alpha Vantage) via event-driven ingestion. No live web scraping needed. |
| C | Gateway interceptors | 4 of 5 services have `toolTargets: []` — interceptors would never fire. Tenant context already flows through events. Audit already covered by `traceEvent()` + `createServiceMetrics`. Rate limiting is production hardening, not POC. |
| D (KMS) | Customer-managed encryption key | AWS encrypts at rest by default. Customer-managed KMS adds cost and operational overhead without POC value. |

---

## Chunk 1: Install peer dependency (Task 1)

### Task 1: Install `@aws-cdk/aws-bedrock-alpha`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

`@aws-cdk/aws-bedrock-alpha` is a peer dependency of `@aws-cdk/aws-bedrock-agentcore-alpha` and provides `IBedrockInvokable` / `BedrockFoundationModel`, required for the `OverrideConfig.model` field in memory strategy custom prompts.

The installed `@aws-cdk/aws-bedrock-agentcore-alpha` version is `2.243.0-alpha.0`. The bedrock-alpha version MUST match.

Run: `pnpm add -D @aws-cdk/aws-bedrock-alpha@2.243.0-alpha.0`

Expected: Package installed, `package.json` and `pnpm-lock.yaml` updated.

- [ ] **Step 2: Verify it resolves**

Run: `node -e "require('@aws-cdk/aws-bedrock-alpha')"`
Expected: No error

- [ ] **Step 3: Verify `BedrockFoundationModel` API**

The `OverrideConfig.model` field requires `IBedrockInvokable`. Check the actual API:

Run: `node -e "const b = require('@aws-cdk/aws-bedrock-alpha'); console.log(Object.keys(b).filter(k => k.includes('Model')))"`

Then inspect the `.d.ts` to find the correct way to create a model reference (e.g. `BedrockFoundationModel.ANTHROPIC_CLAUDE_SONNET_V2_0` or `fromFoundationModelId()`). The plan's Step 5 uses whichever API is available — do NOT guess.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: install @aws-cdk/aws-bedrock-alpha peer dependency for Memory OverrideConfig"
```

---

## Chunk 2: Add custom prompts to Memory strategies (Task 2)

### Task 2: Add domain-specific extraction/consolidation prompts

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts`
- Modify: `services/advisory/decision-workflow-ctrl/test/service.stack.test.ts`

- [ ] **Step 1: Write new tests**

Add to `services/advisory/decision-workflow-ctrl/test/service.stack.test.ts`:

```typescript
it('sets custom extraction on InvestorPreferenceLearner strategy', () => {
  const memory = template.findResources('AWS::BedrockAgentCore::Memory');
  const strategies = Object.values(memory)[0]?.Properties?.Strategies ?? [];
  const investorPref = strategies.find((s: any) => s.StrategyName === 'InvestorPreferenceLearner');
  expect(investorPref).toBeDefined();
  expect(investorPref?.Configuration?.ExtractionConfiguration?.CustomExtractionConfiguration).toBeDefined();
  expect(investorPref?.Configuration?.ConsolidationConfiguration?.CustomConsolidationConfiguration).toBeDefined();
});

it('sets custom extraction on AllocationRationaleExtractor strategy', () => {
  const memory = template.findResources('AWS::BedrockAgentCore::Memory');
  const strategies = Object.values(memory)[0]?.Properties?.Strategies ?? [];
  const allocRationale = strategies.find((s: any) => s.StrategyName === 'AllocationRationaleExtractor');
  expect(allocRationale).toBeDefined();
  expect(allocRationale?.Configuration?.ExtractionConfiguration?.CustomExtractionConfiguration).toBeDefined();
  expect(allocRationale?.Configuration?.ConsolidationConfiguration?.CustomConsolidationConfiguration).toBeDefined();
});

it('sets custom extraction on NarrativePreferenceLearner strategy', () => {
  const memory = template.findResources('AWS::BedrockAgentCore::Memory');
  const strategies = Object.values(memory)[0]?.Properties?.Strategies ?? [];
  const narrativePref = strategies.find((s: any) => s.StrategyName === 'NarrativePreferenceLearner');
  expect(narrativePref).toBeDefined();
  expect(narrativePref?.Configuration?.ExtractionConfiguration?.CustomExtractionConfiguration).toBeDefined();
  expect(narrativePref?.Configuration?.ConsolidationConfiguration?.CustomConsolidationConfiguration).toBeDefined();
});

it('does not set custom extraction on MarketSignalExtractor strategy', () => {
  const memory = template.findResources('AWS::BedrockAgentCore::Memory');
  const strategies = Object.values(memory)[0]?.Properties?.Strategies ?? [];
  const marketSignal = strategies.find((s: any) => s.StrategyName === 'MarketSignalExtractor');
  expect(marketSignal?.Configuration?.ExtractionConfiguration?.CustomExtractionConfiguration).toBeUndefined();
});

it('does not set custom extraction on NarrativeSessionSummarizer strategy', () => {
  const memory = template.findResources('AWS::BedrockAgentCore::Memory');
  const strategies = Object.values(memory)[0]?.Properties?.Strategies ?? [];
  const summarizer = strategies.find((s: any) => s.StrategyName === 'NarrativeSessionSummarizer');
  expect(summarizer?.Configuration?.ExtractionConfiguration?.CustomExtractionConfiguration).toBeUndefined();
});
```

**Important:** The exact CFN property names for strategy overrides may differ from expected. If tests fail after implementation, inspect `template.toJSON()` to find the correct property structure and update the assertions accordingly. The L2 → CFN mapping for `OverrideConfig` fields isn't documented — you MUST verify empirically.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test decision-workflow-ctrl -- --testPathPattern=service.stack`
Expected: FAIL — no custom extraction configured on any strategy

- [ ] **Step 3: Resolve the Sonnet model reference**

In `services/advisory/decision-workflow-ctrl/src/service.stack.ts`, add the Sonnet model resolution. The advisory domain already resolves model IDs from SSM in every service stack. Follow the same pattern:

```typescript
import { BedrockFoundationModel } from '@aws-cdk/aws-bedrock-alpha';

// In the constructor, after existing imports but before Memory creation:
const hubNaming = new NamingService({ prefix: props.prefix, subsystem: 'advisory', service: 'advisory-hub' });
const modelSonnetId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/sonnet'));
```

Then create the model reference. The exact API depends on what `@aws-cdk/aws-bedrock-alpha` exposes — check the `.d.ts` file from Task 1 Step 3. Likely one of:

- `BedrockFoundationModel.fromFoundationModelId(this, 'SonnetModel', modelSonnetId)` — if static factory exists
- `new BedrockFoundationModel(modelSonnetId)` — if constructor accepts string
- A static constant like `BedrockFoundationModel.ANTHROPIC_CLAUDE_SONNET_V2_0` — if only predefined models work

**Do NOT guess. Verify the API first.** If none of these work with an SSM-resolved token, you may need to use the raw `CfnMemory` L1 override instead.

- [ ] **Step 4: Add custom prompts to the 3 strategies**

Update the `memoryStrategies` array in `decision-workflow-ctrl/src/service.stack.ts`. Only 3 of the 5 strategies get custom prompts:

```typescript
memoryStrategies: [
  agentcore.MemoryStrategy.usingUserPreference({
    name: 'InvestorPreferenceLearner',
    namespaces: ['/investor-profile/{actorId}/preferences'],
    customExtraction: {
      model: sonnetModel,
      appendToPrompt: 'Extract investment preferences: risk tolerance level, asset class preferences, ESG constraints, liquidity needs, time horizon, and any stated return targets. Ignore conversational filler.',
    },
    customConsolidation: {
      model: sonnetModel,
      appendToPrompt: 'When consolidating investor preferences, newer statements override older ones for the same dimension. Flag contradictions (e.g., high growth vs conservative).',
    },
  }),
  agentcore.MemoryStrategy.usingSemantic({
    name: 'MarketSignalExtractor',
    namespaces: ['/market-intelligence/{actorId}/signals'],
    // No custom override — default extraction works well for market signals
  }),
  agentcore.MemoryStrategy.usingSemantic({
    name: 'AllocationRationaleExtractor',
    namespaces: ['/portfolio-engine/{actorId}/rationale'],
    customExtraction: {
      model: sonnetModel,
      appendToPrompt: 'Extract portfolio allocation rationale: why each asset class was weighted, which constraints were binding, what trade-offs were made, and confidence level of each recommendation.',
    },
    customConsolidation: {
      model: sonnetModel,
      appendToPrompt: 'Consolidate allocation rationale chronologically. Preserve the reasoning chain — don\'t collapse distinct decisions into a summary.',
    },
  }),
  agentcore.MemoryStrategy.usingUserPreference({
    name: 'NarrativePreferenceLearner',
    namespaces: ['/advisory-narrative/{actorId}/preferences'],
    customExtraction: {
      model: sonnetModel,
      appendToPrompt: 'Extract communication preferences: preferred explanation depth (simple/detailed), terminology level (retail/professional), format preferences (bullet points/prose), and topics the investor engages with most.',
    },
    customConsolidation: {
      model: sonnetModel,
      appendToPrompt: 'Consolidate communication preferences using most recent signals. Weight explicit feedback (I prefer simpler explanations) higher than inferred patterns.',
    },
  }),
  agentcore.MemoryStrategy.usingSummarization({
    name: 'NarrativeSessionSummarizer',
    namespaces: ['/advisory-narrative/{actorId}/sessions'],
    // No custom override — default summarization is appropriate
  }),
],
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm nx test decision-workflow-ctrl -- --testPathPattern=service.stack`
Expected: PASS (including 5 new tests)

If tests fail on CFN property name assertions, inspect the synthesized template:

```typescript
// Temporary debug: add to any test
console.log(JSON.stringify(template.findResources('AWS::BedrockAgentCore::Memory'), null, 2));
```

Then update the test assertions to match the actual CFN property names.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/service.stack.ts services/advisory/decision-workflow-ctrl/test/service.stack.test.ts
git commit -m "feat(decision-workflow): add domain-specific extraction/consolidation prompts to Memory strategies"
```

---

## Chunk 3: Verification (Task 3)

### Task 3: Full verification

- [ ] **Step 1: Run decision-workflow-ctrl tests**

Run: `pnpm nx test decision-workflow-ctrl`
Expected: ALL PASS

- [ ] **Step 2: Run all advisory domain tests**

Run: `pnpm nx run-many -t test -p advisory-narrative-ctrl,investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-ctrl,decision-workflow-ctrl`
Expected: ALL PASS — no regressions (other stacks don't import `@aws-cdk/aws-bedrock-alpha`)

- [ ] **Step 3: Run lint**

Run: `pnpm nx lint decision-workflow-ctrl`
Expected: PASS

- [ ] **Step 4: Run cdk-constructs build**

Run: `pnpm nx build cdk-constructs`
Expected: BUILD SUCCESS — no changes to cdk-constructs, just confirming no regressions
