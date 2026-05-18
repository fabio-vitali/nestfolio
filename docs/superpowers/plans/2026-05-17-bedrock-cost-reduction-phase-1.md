# Bedrock Cost Reduction — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut steady-state Bedrock spend from ~$2,300/mo projection toward ~$1,200/mo by executing Phase 1 levers A+B+C+E from `docs/backlog/bedrock-cost-reduction-may-2026.md`.

**Architecture:** Four independent changes against the advisory pipeline: (A) drop consolidation prompt from 3 of 4 AgentCore MemoryStrategies in `decision-workflow-ctrl`; (B) collapse two identical SEMANTIC rationale strategies into one shared namespace owned by both `portfolio-engine-ctrl` and `advisory-narrative-ctrl`; (C) flip `risk-assessment` agent in `investor-profile-ctrl` from Opus to Sonnet; (E) swap `MarketSignalExtractor` from CUSTOM Haiku to managed SEMANTIC default. All changes touch only CDK stack defs and agent-config literals — no runtime contracts, no event schemas, no SF state changes. Lever D (portfolio-construction Opus→Sonnet) is explicitly deferred to Phase 2.

**Tech Stack:** TypeScript, AWS CDK v2 (alpha constructs for AgentCore Memory), `@nestfolio/agent-orchestrator` (MemoryClient + AgentConfig), Jest (unit tests + CDK template assertions).

---

## File Structure

**Files modified or created across the workstream:**

- `libs/agent-orchestrator/src/memory/memory-client.ts` — add optional `namespacePrefix` config field; default to `serviceName` (Lever B)
- `libs/agent-orchestrator/test/memory-client.test.ts` — extend or create test for `namespacePrefix` default + override (Lever B)
- `services/advisory/decision-workflow-ctrl/src/service.stack.ts` — drop consolidation from 3 strategies (A), collapse rationale strategies into one (B), swap MarketSignalExtractor to managed SEMANTIC (E), update prose comments
- `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts` — update strategy assertions for A, B, E
- `services/advisory/decision-workflow-ctrl/CLAUDE.md` — regenerate via `audit-service` post-change (closing phase)
- `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts` — pass `namespacePrefix: 'shared-rationale'` to `createMemoryClient` (Lever B)
- `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts` — pass `namespacePrefix: 'shared-rationale'` to `createMemoryClient` (Lever B)
- `services/advisory/investor-profile-ctrl/src/agents/risk-assessment.config.ts` — flip `modelId` to Sonnet (Lever C)
- `services/advisory/investor-profile-ctrl/src/agent-service.ts` — update `metadata.modelTiers` label `['haiku','opus']` → `['haiku','sonnet']` (Lever C)
- `services/advisory/investor-profile-ctrl/test/unit/agent-service.test.ts` — update modelTiers assertion (Lever C)
- `services/advisory/investor-profile-ctrl/CLAUDE.md` — regenerate via `audit-service` post-change (closing phase)
- `services/advisory/portfolio-engine-ctrl/CLAUDE.md` — regenerate via `audit-service` post-change (closing phase)
- `services/advisory/advisory-narrative-ctrl/CLAUDE.md` — regenerate via `audit-service` post-change (closing phase)

**Boundaries:**
- `libs/agent-orchestrator` is the right place for the `namespacePrefix` change — it's a thin extension to an existing config interface, not a new abstraction.
- DWC owns the strategy topology (it's the SSM publisher + Memory resource owner). PE and AN are consumers that read/write via MemoryClient — they only need to know which namespace prefix to use.
- Lever C is local to `investor-profile-ctrl`; no other service imports the agent config.

---

## Pre-flight context engineers will need

**Where the cost comes from (read once before editing).** Phase B of `inter-agent-state-handoff` (commit `1e1e23d4`, shipped 2026-05-14) added four AgentCore MemoryStrategies to DWC. AgentCore runs each strategy's extraction prompt against every emitted CreateEventCommand. Three of those four also run a *consolidation* prompt over a sliding window of past records — that's the super-linear cost amplifier that surfaced on May 15. The 4-strategy + 3-consolidation layout was designed for cross-decision recall fidelity; Phase 1 trades a small fidelity reduction for ~$100/mo.

**Why we add `namespacePrefix` instead of merging strategies in place.** AgentCore enforces 1 namespace per MemoryStrategy. The two rationale strategies (`PortfolioRationaleArchivist`, `NarrativeRationaleArchivist`) have **identical extraction prompts**; the only reason there are two is that AWS rejected the original single strategy with 2 namespaces ("Member must have length less than or equal to 1", see service.stack.ts:55-57). The actual writers (PE + AN) currently configure MemoryClient with `serviceName: 'portfolio-engine'` and `serviceName: 'advisory-narrative'`, producing two distinct namespace paths. By introducing `namespacePrefix: 'shared-rationale'` on both clients, we get one strategy + one shared namespace, with producer attribution stored as a record attribute (not as a namespace component). The existing `serviceName` field is preserved for backwards compat — only the namespace construction uses `namespacePrefix ?? serviceName`.

**Why Lever C's Sonnet flip is safe.** Spec 4 (`project_agent_runtime_structured_output.md`) shipped α prompt-discipline + β `withFallback` discriminant + γ `assertOrchestratorOutput` + named-tool retry guard in `libs/agent-orchestrator/src/agent-factory.ts:113-128`. Those guards apply to all agents regardless of tier and surfaced as protecting Sonnet structured-output reliability. `RiskEvaluationSchema` is moderate-complexity (well within Sonnet capability — Sonnet 4.6 already drives `market-intelligence` and `rebalance-planner` on similar shapes).

**Pre-existing memory-namespace mismatch is out of scope.** Today PE and AN emit to `/portfolio-engine/{tenantId}/rationale` and `/advisory-narrative/{tenantId}/rationale` while DWC strategies template on `/portfolio-engine-ctrl/{actorId}/rationale` and `/advisory-narrative-ctrl/{actorId}/rationale` — strings don't match, so the strategies see zero emitted events of the "intended" shape but still extract from raw event payloads (strategies operate on event content via prompts, not on namespace match for extraction). Fixing the mismatch is the parking item `project_agent_runtime_structured_output.md`'s "pre-existing memory namespace mismatch", which is **explicitly out-of-scope** for this workstream (see `out_of_scope` in `docs/backlog/bedrock-cost-reduction-may-2026.md`). The Lever B merge happens to use the new namespace `/shared-rationale/{actorId}/rationale` cleanly without touching the pre-existing mismatch.

**Commit cadence.** Each lever ships as its own commit so a per-lever rollback is possible. Closing phase regenerates CLAUDE.md cards via `audit-service` skill and ships docs in a follow-up commit.

---

## Task 1: Add `namespacePrefix` to MemoryClientConfig (foundation for Lever B)

**Files:**
- Modify: `libs/agent-orchestrator/src/memory/memory-client.ts:12-16` (config interface), `:48-117` (createMemoryClient body)
- Modify or create: `libs/agent-orchestrator/test/memory-client.test.ts` (covers default + override behavior)

- [ ] **Step 1: Inspect existing test file (or note its absence)**

Run: `ls libs/agent-orchestrator/test/ | grep memory-client`
Expected: shows `memory-client.test.ts` if present, otherwise empty (we'll create it).

- [ ] **Step 2: Write the failing test — `namespacePrefix` overrides `serviceName` in namespace path**

If `libs/agent-orchestrator/test/memory-client.test.ts` does not exist, create it. Otherwise append.

```ts
import { mockClient } from 'aws-sdk-client-mock';
import { BedrockAgentCoreClient, CreateEventCommand, RetrieveMemoryRecordsCommand } from '@aws-sdk/client-bedrock-agentcore';
import { createMemoryClient } from '../src/memory/memory-client';

const acMock = mockClient(BedrockAgentCoreClient);

beforeEach(() => acMock.reset());

describe('createMemoryClient namespacePrefix', () => {
  it('uses serviceName for namespace path when namespacePrefix is absent (back-compat)', async () => {
    acMock.on(RetrieveMemoryRecordsCommand).resolves({ memoryRecordSummaries: [] });
    const client = createMemoryClient({ memoryId: 'mem-1', region: 'us-east-1', serviceName: 'foo-service' });
    await client.openDecisionSession('t1', 'd1').searchLongTermMemory('rationale', 'q');
    const call = acMock.commandCalls(RetrieveMemoryRecordsCommand)[0].args[0].input;
    expect(call.namespace).toBe('/foo-service/t1/rationale');
  });

  it('prefers namespacePrefix over serviceName for namespace path when both present', async () => {
    acMock.on(RetrieveMemoryRecordsCommand).resolves({ memoryRecordSummaries: [] });
    const client = createMemoryClient({
      memoryId: 'mem-1',
      region: 'us-east-1',
      serviceName: 'foo-service',
      namespacePrefix: 'shared-rationale',
    });
    await client.openDecisionSession('t1', 'd1').searchLongTermMemory('rationale', 'q');
    const call = acMock.commandCalls(RetrieveMemoryRecordsCommand)[0].args[0].input;
    expect(call.namespace).toBe('/shared-rationale/t1/rationale');
  });

  it('also applies namespacePrefix to searchTenantMemory', async () => {
    acMock.on(RetrieveMemoryRecordsCommand).resolves({ memoryRecordSummaries: [] });
    const client = createMemoryClient({
      memoryId: 'mem-1', region: 'us-east-1', serviceName: 'foo-service', namespacePrefix: 'shared-rationale',
    });
    await client.searchTenantMemory('t1', 'rationale', 'q');
    const call = acMock.commandCalls(RetrieveMemoryRecordsCommand)[0].args[0].input;
    expect(call.namespace).toBe('/shared-rationale/t1/rationale');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm nx run agent-orchestrator:test --testPathPatterns memory-client`
Expected: 3 new tests in the `namespacePrefix` describe block — back-compat test passes (no change yet), the two override tests fail because the field doesn't exist / has no effect.

If `aws-sdk-client-mock` is not already a dev dep of `agent-orchestrator`, install it first: `pnpm add -D -w aws-sdk-client-mock` and re-run.

- [ ] **Step 4: Implement `namespacePrefix` in the config interface and namespace builder**

Edit `libs/agent-orchestrator/src/memory/memory-client.ts`. Replace the `MemoryClientConfig` interface and the two `ns` builder sites:

```ts
// at top of file, replace existing MemoryClientConfig interface
export interface MemoryClientConfig {
  memoryId: string;
  region: string;
  serviceName: string;
  /**
   * Optional override for the leading path component of the long-term memory
   * namespace. When set, replaces `serviceName` in the namespace path
   * `/<prefix>/<tenantId>/<namespace>`. Used to share a namespace across
   * services (e.g., the merged `shared-rationale` strategy owned by both
   * portfolio-engine-ctrl and advisory-narrative-ctrl). Defaults to
   * `serviceName` for back-compat.
   */
  namespacePrefix?: string;
}

// inside createMemoryClient, immediately after `const client = new BedrockAgentCoreClient(...)`:
const nsPrefix = config.namespacePrefix ?? config.serviceName;

// then replace BOTH `const ns = `/${config.serviceName}/${tenantId}/${namespace}`;` lines with:
const ns = `/${nsPrefix}/${tenantId}/${namespace}`;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm nx run agent-orchestrator:test --testPathPatterns memory-client`
Expected: all 3 `namespacePrefix` tests PASS.

- [ ] **Step 6: Run the full agent-orchestrator test suite for regression**

Run: `pnpm nx run agent-orchestrator:test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add libs/agent-orchestrator/src/memory/memory-client.ts libs/agent-orchestrator/test/memory-client.test.ts
git commit -m "feat(agent-orchestrator): add namespacePrefix config to MemoryClient

Allows multiple services to share a single long-term memory namespace
(e.g., the merged rationale strategy owned by both portfolio-engine-ctrl
and advisory-narrative-ctrl). Defaults to serviceName for back-compat."
```

---

## Task 2 — Lever A: Drop consolidation from 3 of 4 MemoryStrategies

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts:64-136` (the `MemoryStrategies` array passed to `new agentcore.Memory(...)`)
- Modify: `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts:165-218` (the four `it()` blocks that assert per-strategy shape)

- [ ] **Step 1: Update the strategy assertions to drop consolidation expectations on 3 strategies**

Edit `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts`. Locate the four `it()` blocks that test each strategy.

For `InvestorPreferenceLearner` (test at :165-177), keep extraction but **drop** the consolidation assertion. Replace the block body with:

```ts
const strategies = getStrategies();
const learner = strategies.find(
  (s: any) => s.CustomMemoryStrategy?.Name === 'InvestorPreferenceLearner',
);
expect(learner).toBeDefined();
const cfg = learner?.CustomMemoryStrategy?.Configuration?.UserPreferenceOverride;
expect(cfg?.Extraction?.AppendToPrompt).toContain('risk tolerance');
expect(cfg?.Consolidation).toBeUndefined();
expect(learner?.CustomMemoryStrategy?.Namespaces).toEqual([
  '/investor-profile-ctrl/{actorId}/preferences',
]);
```

Also update the test name from `... custom Haiku extraction + consolidation` to `... custom Haiku extraction only` so the title reflects the new posture.

Apply the same pattern to `PortfolioRationaleArchivist` (test at :192-204): drop the `expect(cfg?.Consolidation?.AppendToPrompt).toContain('reasoning chain');` line, add `expect(cfg?.Consolidation).toBeUndefined();`, rename title to "extraction only".

(`NarrativeRationaleArchivist` will be removed entirely in Task 3 — leave its test block alone for now; Task 3 will delete it.)

`MarketSignalExtractor` already has no consolidation — leave that block untouched (Task 5 modifies it for Lever E).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx run decision-workflow-ctrl:test --testPathPatterns service.stack`
Expected: two tests FAIL — the assertions that `Consolidation` is undefined fail because the stack still includes a Consolidation block.

- [ ] **Step 3: Remove the `customConsolidation:` block from 3 strategies in the CDK stack**

Edit `services/advisory/decision-workflow-ctrl/src/service.stack.ts`. In the `memoryStrategies: [...]` array:

For `InvestorPreferenceLearner` (the `usingUserPreference` strategy at :69-87), delete the entire `customConsolidation: { ... }` block (lines 80-86).

For `PortfolioRationaleArchivist` (the `usingSemantic` strategy at :99-116), delete the entire `customConsolidation: { ... }` block (lines 110-115).

For `NarrativeRationaleArchivist` (the `usingSemantic` strategy at :117-134) — **do not edit; Task 3 removes the entire strategy.**

Also update the prose comment block at `:43-63` to reflect that 3 of 4 strategies are extraction-only post Phase 1. Specifically replace the line "Haiku extraction + consolidation" with "Haiku extraction only" for InvestorPreferenceLearner and PortfolioRationaleArchivist. Keep the AWS-limit note (:54-57) — still relevant for the merge in Task 3.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm nx run decision-workflow-ctrl:test --testPathPatterns service.stack`
Expected: all `service.stack` tests PASS (the `NarrativeRationaleArchivist` block still passes — Task 3 removes it).

- [ ] **Step 5: Run the full DWC unit suite for regression**

Run: `pnpm nx run decision-workflow-ctrl:test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/service.stack.ts services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts
git commit -m "refactor(decision-workflow-ctrl): drop consolidation from 3 MemoryStrategies (Lever A)

InvestorPreferenceLearner and PortfolioRationaleArchivist now run
extraction only. Sliding-window consolidation was the super-linear cost
amplifier that drove the May 15 daily-spend spike. NarrativeRationale-
Archivist consolidation also dropped here, but the strategy itself is
collapsed away in the next commit (Lever B).

Est. savings: ~\$30/mo. No MemoryClient retrieval calls reference the
consolidated summary records today."
```

---

## Task 3 — Lever B (DWC side): Collapse two rationale strategies into one

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts` (rename `PortfolioRationaleArchivist` → `RationaleArchivist`, change namespace to `/shared-rationale/{actorId}/rationale`, **delete** the entire `NarrativeRationaleArchivist` strategy)
- Modify: `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts` (rename + reshape the rationale assertion, delete `NarrativeRationaleArchivist` block, change the `toHaveLength(4)` assertion to `toHaveLength(3)`)

- [ ] **Step 1: Update the test for the strategy count and rationale strategy shape**

Edit `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts`.

Change the `attaches 4 strategies` test at :160 to expect 3:

```ts
it('attaches 3 strategies to the Memory resource (post Lever B merge)', () => {
  const strategies = getStrategies();
  expect(strategies).toHaveLength(3);
});
```

Replace the `PortfolioRationaleArchivist` test (:192-204) with a `RationaleArchivist` test that asserts the merged namespace:

```ts
it('attaches RationaleArchivist with SEMANTIC_MEMORY type, custom Haiku extraction only, shared namespace', () => {
  const strategies = getStrategies();
  const archivist = strategies.find(
    (s: any) => s.CustomMemoryStrategy?.Name === 'RationaleArchivist',
  );
  expect(archivist).toBeDefined();
  const cfg = archivist?.CustomMemoryStrategy?.Configuration?.SemanticOverride;
  expect(cfg?.Extraction?.AppendToPrompt).toContain('investor-facing narrative');
  expect(cfg?.Consolidation).toBeUndefined();
  expect(archivist?.CustomMemoryStrategy?.Namespaces).toEqual([
    '/shared-rationale/{actorId}/rationale',
  ]);
});
```

**Delete** the entire `NarrativeRationaleArchivist` test block (:206-218).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx run decision-workflow-ctrl:test --testPathPatterns service.stack`
Expected: the strategy-count test FAILS (still 4), the rationale test FAILS (still named `PortfolioRationaleArchivist` with old namespace). The (now-absent) `NarrativeRationaleArchivist` assertion is gone.

- [ ] **Step 3: Update the CDK stack — rename + change namespace + delete the second strategy**

Edit `services/advisory/decision-workflow-ctrl/src/service.stack.ts`.

In the `memoryStrategies` array, **delete the entire `NarrativeRationaleArchivist` strategy block** (after Task 2 changes, this is the strategy at roughly :117-128 — the `usingSemantic` one with name `'NarrativeRationaleArchivist'` and namespace `/advisory-narrative-ctrl/{actorId}/rationale`).

For the `PortfolioRationaleArchivist` strategy (the surviving `usingSemantic` for rationale), apply two edits:

1. Rename `name: 'PortfolioRationaleArchivist'` → `name: 'RationaleArchivist'`.
2. Change `namespaces: ['/portfolio-engine-ctrl/{actorId}/rationale']` → `namespaces: ['/shared-rationale/{actorId}/rationale']`.

Update the prose comment block (:43-63) to reflect 3 strategies: drop the bullets for `PortfolioRationaleArchivist` and `NarrativeRationaleArchivist`, add a single replacement bullet:

```ts
//   3. RationaleArchivist (SEMANTIC_MEMORY, Haiku extraction only)
//      Namespace: /shared-rationale/{actorId}/rationale
//      Shared by portfolio-engine-ctrl + advisory-narrative-ctrl; both
//      configure MemoryClient with namespacePrefix: 'shared-rationale'.
//      Producer attribution lives in the record payload.
```

The "AWS enforces 1 namespace per strategy" note at :54-57 can be tightened — the merge resolves the historical workaround. Replace it with a one-liner that states the limit and how the merge satisfies it:

```ts
// AgentCore enforces 1 namespace per MemoryStrategy. The two rationale
// strategies (Portfolio + Narrative) collapsed into one shared-namespace
// strategy with producer attribution stored as a record payload field.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm nx run decision-workflow-ctrl:test --testPathPatterns service.stack`
Expected: PASS (3 strategies, RationaleArchivist with shared namespace, no NarrativeRationaleArchivist).

- [ ] **Step 5: Run the full DWC unit suite for regression**

Run: `pnpm nx run decision-workflow-ctrl:test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/service.stack.ts services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts
git commit -m "refactor(decision-workflow-ctrl): merge rationale strategies (Lever B, DWC side)

PortfolioRationaleArchivist and NarrativeRationaleArchivist had
identical extraction prompts but separate namespaces because AgentCore
enforces 1 namespace per strategy. Merged into a single
RationaleArchivist with shared namespace /shared-rationale/{actorId}/
rationale. Producer attribution moves to a record-payload field.

Next commit (Lever B, callers side) flips PE + AN MemoryClient configs
to use namespacePrefix: 'shared-rationale' so they read/write to the
merged store.

Est. savings: ~\$15/mo (one extraction prompt per event, not two)."
```

---

## Task 4 — Lever B (callers side): Point PE + AN MemoryClient at the shared namespace

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts:165` (createMemoryClient call)
- Modify: `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts:183` (createMemoryClient call)

No new tests — Task 1 already covers the `namespacePrefix` behavior at the library level, and existing PE/AN unit tests mock `memoryClient` directly (they don't exercise the real `createMemoryClient` factory).

- [ ] **Step 1: Edit PE's createMemoryClient call to pass namespacePrefix**

Edit `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts`. Find the `createMemoryClient` call at line 165:

```ts
// BEFORE
const memoryClient = process.env.MEMORY_ID
  ? createMemoryClient({ memoryId: process.env.MEMORY_ID, region: process.env.AWS_REGION ?? 'us-east-1', serviceName: AGENT_NAME })
  : createNoOpMemoryClient();

// AFTER
const memoryClient = process.env.MEMORY_ID
  ? createMemoryClient({
      memoryId: process.env.MEMORY_ID,
      region: process.env.AWS_REGION ?? 'us-east-1',
      serviceName: AGENT_NAME,
      namespacePrefix: 'shared-rationale',
    })
  : createNoOpMemoryClient();
```

- [ ] **Step 2: Apply the same change to AN**

Edit `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts` at line 183 — same change as Step 1 (identical config shape).

- [ ] **Step 3: Run PE + AN unit suites for regression**

Run: `pnpm nx run portfolio-engine-ctrl:test && pnpm nx run advisory-narrative-ctrl:test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts
git commit -m "refactor(advisory): point PE + AN MemoryClient at shared-rationale namespace (Lever B, callers)

Both services now write to and read from /shared-rationale/{tenantId}/
rationale via the namespacePrefix override added in the previous
agent-orchestrator commit. Pairs with the DWC strategy merge."
```

---

## Task 5 — Lever E: Swap MarketSignalExtractor to managed SEMANTIC default

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts:88-98` (the MarketSignalExtractor strategy)
- Modify: `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts:179-190` (its assertion block)

- [ ] **Step 1: Update the test to expect a managed SEMANTIC strategy with no customExtraction**

Edit `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts`. Replace the MarketSignalExtractor block (:179-190):

```ts
it('attaches MarketSignalExtractor with managed SEMANTIC type (no custom extraction)', () => {
  const strategies = getStrategies();
  const extractor = strategies.find(
    (s: any) =>
      s.SemanticMemoryStrategy?.Name === 'MarketSignalExtractor' ||
      s.CustomMemoryStrategy?.Name === 'MarketSignalExtractor',
  );
  expect(extractor).toBeDefined();
  // Managed (non-custom) shape: SemanticMemoryStrategy with no customExtraction config.
  expect(extractor?.SemanticMemoryStrategy).toBeDefined();
  expect(extractor?.CustomMemoryStrategy).toBeUndefined();
  expect(extractor?.SemanticMemoryStrategy?.Namespaces).toEqual([
    '/market-intelligence-ctrl/{actorId}/signals',
  ]);
});
```

The dual-key `find()` tolerates either render shape — CDK alpha may surface managed strategies under `SemanticMemoryStrategy` rather than `CustomMemoryStrategy`. The follow-up assertions tighten the expectation.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run decision-workflow-ctrl:test --testPathPatterns service.stack`
Expected: FAIL — current synth uses `CustomMemoryStrategy` because `customExtraction` is set.

- [ ] **Step 3: Replace the strategy with the managed variant**

Edit `services/advisory/decision-workflow-ctrl/src/service.stack.ts`. Replace the MarketSignalExtractor strategy (the `usingSemantic` block at :88-98) with:

```ts
agentcore.MemoryStrategy.usingSemantic({
  name: 'MarketSignalExtractor',
  namespaces: ['/market-intelligence-ctrl/{actorId}/signals'],
}),
```

Update the prose comment for strategy 2 (around :47) to reflect that extraction is now managed:

```ts
//   2. MarketSignalExtractor (SEMANTIC_MEMORY, managed extraction)
//      Namespace: /market-intelligence-ctrl/{actorId}/signals
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run decision-workflow-ctrl:test --testPathPatterns service.stack`
Expected: PASS.

If the synth produces `SemanticMemoryStrategy.Name` undefined (CDK alpha quirk), fall back to filtering by `Namespaces` equality instead of `Name`:

```ts
const extractor = strategies.find(
  (s: any) => {
    const ns = s.SemanticMemoryStrategy?.Namespaces ?? s.CustomMemoryStrategy?.Namespaces;
    return ns?.[0] === '/market-intelligence-ctrl/{actorId}/signals';
  },
);
```

- [ ] **Step 5: Run the full DWC suite for regression**

Run: `pnpm nx run decision-workflow-ctrl:test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/service.stack.ts services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts
git commit -m "refactor(decision-workflow-ctrl): swap MarketSignalExtractor to managed SEMANTIC (Lever E)

Prompt was short and generic; managed default extraction is sufficient
for market-signal recall. Drops one Haiku invocation per
MARKET_SNAPSHOT_UPDATED event.

Est. savings: ~\$5/mo."
```

---

## Task 6 — Lever C: Flip `risk-assessment` agent from Opus to Sonnet

**Files:**
- Modify: `services/advisory/investor-profile-ctrl/src/agents/risk-assessment.config.ts:6` (modelId literal)
- Modify: `services/advisory/investor-profile-ctrl/src/agent-service.ts:143` (`modelTiers` label)
- Modify: `services/advisory/investor-profile-ctrl/test/unit/agent-service.test.ts:71` (assertion)

- [ ] **Step 1: Update the agent-service test to expect the new modelTiers label**

Edit `services/advisory/investor-profile-ctrl/test/unit/agent-service.test.ts:71`:

```ts
// BEFORE
metadata: expect.objectContaining({ modelTiers: ['haiku', 'opus'] }),

// AFTER
metadata: expect.objectContaining({ modelTiers: ['haiku', 'sonnet'] }),
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run investor-profile-ctrl:test --testPathPatterns agent-service`
Expected: FAIL — agent-service still returns `modelTiers: ['haiku', 'opus']`.

- [ ] **Step 3: Flip the agent config modelId**

Edit `services/advisory/investor-profile-ctrl/src/agents/risk-assessment.config.ts:6`:

```ts
// BEFORE
modelId: 'us.anthropic.claude-opus-4-6-v1',

// AFTER
modelId: 'us.anthropic.claude-sonnet-4-6',
```

- [ ] **Step 4: Update the metadata label in agent-service.ts**

Edit `services/advisory/investor-profile-ctrl/src/agent-service.ts:143`:

```ts
// BEFORE
metadata: { durationMs, modelTiers: ['haiku', 'opus'] },

// AFTER
metadata: { durationMs, modelTiers: ['haiku', 'sonnet'] },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm nx run investor-profile-ctrl:test --testPathPatterns agent-service`
Expected: PASS.

- [ ] **Step 6: Run the full IP-ctrl unit suite for regression**

Run: `pnpm nx run investor-profile-ctrl:test`
Expected: all green. Note: golden-fixture tests in `test/unit/agents/` test the agent graph against fixtures that don't hardcode a model ID — they exercise the schema + prompt path. They should pass unchanged.

- [ ] **Step 7: Commit**

```bash
git add services/advisory/investor-profile-ctrl/src/agents/risk-assessment.config.ts services/advisory/investor-profile-ctrl/src/agent-service.ts services/advisory/investor-profile-ctrl/test/unit/agent-service.test.ts
git commit -m "refactor(investor-profile-ctrl): flip risk-assessment Opus → Sonnet (Lever C)

RiskEvaluationSchema is moderate-complexity and well within Sonnet
capability. Spec 4 structured-output guards (α prompt-discipline + β
withFallback + γ assertOrchestratorOutput + named-tool retry) apply
regardless of tier. AGENT_MODEL_OVERRIDE Haiku-floor explicitly exempts
Opus (libs/agent-orchestrator/src/agent-factory.ts:37), so existing
safeguards don't help here — the flip is the lever.

Est. savings: ~\$50/mo. Lever D (portfolio-construction Opus → Sonnet)
is gated on one stable advisory cycle of this in dev."
```

---

## Task 7 — Verify the full Phase-1 stack synthesizes cleanly

This is a guardrail before the closing phase deploys against AWS. It does not need a commit; it's a pre-deploy smoke check.

- [ ] **Step 1: Run cdk synth scoped to the changed stack**

Run: `AWS_PROFILE=nestfolio-dev pnpm cdk synth -c prefix=dev DevDecisionWorkflowCtrl 2>&1 | tail -30`
Expected: no synth errors. The output shows the rendered CloudFormation template; spot-check that the `Memory` resource has 3 strategies and one of them is named `RationaleArchivist`.

If synth fails on `aws-bedrock-agentcore-alpha` MemoryStrategy shape (e.g., a TS field rejected), debug and patch before continuing. Common gotcha: the `usingSemantic` call without `customExtraction` may need to be passed as `agentcore.MemoryStrategy.usingSemantic({ name, namespaces })` (positional shape) or with all-optional fields explicitly omitted.

- [ ] **Step 2: Run nx affected lint + type-check on the touched projects**

Run: `pnpm nx affected -t lint,build --base=origin/main`
Expected: green across `agent-orchestrator`, `decision-workflow-ctrl`, `portfolio-engine-ctrl`, `advisory-narrative-ctrl`, `investor-profile-ctrl`.

---

## Closing phase (executed by the surrounding /backlog-next skill, not part of this plan)

The `/backlog-next` skill handles the closing phase: doc-derivation detection (regen CLAUDE.md cards via `audit-service` for the 4 services), full `nx affected -t test,lint`, deploy via `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=...`, scoped integration tests, scoped e2e (one full advisory cycle), backlog frontmatter `validation_gate` fill, index regen, and `superpowers:finishing-a-development-branch` for merge.

The validation_gate must include:
- Commit SHAs for all Phase 1 lever commits.
- Deploy log line confirming the 4 services updated.
- A non-empty e2e advisory-cycle `proposedTrades` (proves Sonnet `risk-assessment` flows cleanly through the pipeline).
- CloudWatch Bedrock metric: Haiku invocations per advisory cycle dropped ≥ 50% post-deploy.
- CloudWatch Bedrock metric: Opus invocations dropped ~50% (risk-assessment is one of two steady-state Opus sites).

---

## Self-review checklist

- [x] Lever A: Task 2 covers — drops consolidation on InvestorPreferenceLearner + PortfolioRationaleArchivist. (NarrativeRationaleArchivist consolidation is dropped implicitly in Task 3 when the strategy is deleted.)
- [x] Lever B: Tasks 1, 3, 4 cover — MemoryClient gets `namespacePrefix`, DWC merges into RationaleArchivist with shared namespace, PE + AN configure the prefix.
- [x] Lever C: Task 6 covers — modelId flip + metadata label + test assertion.
- [x] Lever E: Task 5 covers — strategy swap to managed SEMANTIC.
- [x] Lever D: not present. Explicitly out-of-scope per backlog `out_of_scope`.
- [x] No placeholders: each step has exact file paths, exact code, exact commands.
- [x] Type consistency: `namespacePrefix?: string` added to `MemoryClientConfig` in Task 1, used in Task 4; strategy names (`RationaleArchivist`) consistent across Tasks 3 + 5 surrounding text.
- [x] Producer attribution mentioned in Task 3's comment + commit message; no code change needed today because the existing `emitLongTermEvent` payload already includes producer-specific fields (`allocations/trades` from PE, `explainability` from AN) and AgentCore extraction operates on the prompt, not on a structural producer tag. If a future query requires producer-tagged filtering, that's a follow-up.
- [x] CLAUDE.md regeneration deferred to closing phase via `audit-service` — keeps the implementation commits focused on code.
