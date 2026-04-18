# Advisory Agent Tool Wiring — Design

**Date:** 2026-04-17
**Status:** Draft, pending user review
**Related:** `project_agent_orchestrators.md`

## Motivation

Two advisory services have tool Lambdas built and tested but never invoked:

- `services/advisory/portfolio-engine-ctrl/src/handlers/tools/portfolio-lookup.ts`
- `services/advisory/market-intelligence-ctrl/src/handlers/tools/market-data.handler.ts`
- `services/advisory/market-intelligence-ctrl/src/handlers/tools/instrument-universe.handler.ts`

They are deployed Lambda functions with no event source, no function URL, no IAM grant to any caller, and no `toolTargets` entry on their service's `AgentRuntime`. The service cards describe them as *"standalone tool Lambdas"*, which is a euphemism for orphaned. The agent code in each service's `agents/{agent-name}/graph.ts` does not call them.

This spec fills the gap: make the three handlers actually contribute to their agents' reasoning while removing the dead Lambda infrastructure.

## Constraints that shape the design

1. **`withStructuredOutput` is incompatible with `bindTools`.** The agent factory at `libs/agent-orchestrator/src/agent-factory.ts:27` uses `llm.withStructuredOutput(schema)` to force Zod-schema JSON output. Bedrock implements structured output on top of the tool-use API, so binding additional tools via `model.bindTools()` and keeping forced structured output in a single invoke is not cleanly supported. LLM-driven (ReAct-style) tool calls would require reworking `createAgentNode` into a multi-step graph — out of scope.

2. **No agent in the system currently uses MCP Gateway tools.** `advisory-ctrl` has 4 `toolTargets` wired via CDK, but its agent code at `services/advisory/advisory-ctrl/agents/decision-lifecycle/graph.ts` has no `bindTools`, no MCP client, no Gateway invocation. `onboarding-bff`'s `search_knowledge_base` target is dormant the same way. The "reference implementation" for Gateway tool use does not exist yet.

3. **Existing context-augmentation pattern works.** Both in-scope services already call `kb.retrieve(input, 5)` and `session.readUpstreamOutput(serviceName)` deterministically inside `invokeMarketResearch` / `invokePortfolioEngine`, stuff results into the prompt as named sections, then invoke the LLM once. The new tools fit this shape naturally.

4. **The three tools are unconditionally needed.** They are not contextual lookups the agent should decide to skip — a market-intelligence invocation always wants current market state and the approved instrument universe; a portfolio-engine invocation always wants the latest portfolio snapshot. Determinism is correct semantics here, not a compromise.

## Non-goals

- Any change to `advisory-ctrl`'s 4 dormant Gateway tools.
- Any change to `onboarding-bff`'s dormant `search_knowledge_base` target.
- Any change to `investor-profile-ctrl` or `advisory-narrative-ctrl` (stacks explicitly declare no tools needed; not challenged here).
- Any change to `libs/agent-orchestrator` or `libs/cdk-constructs/src/extensions/agent-runtime.ts`.
- Any ReAct-style tool-call loop or MCP client integration.
- Prompt-engineering changes to improve how the LLM uses the injected context.

## Design

### Pattern: deterministic context injection

Each tool becomes a pure async function imported directly by `agents/{agent-name}/graph.ts`, invoked unconditionally before the LLM call, with its result formatted as a labelled prompt section appended to the existing `kbContext` + `upstreamContext`.

### File layout per service

**Move**, don't duplicate:

- `src/handlers/tools/<tool>.ts` → `src/agents/tools/<tool>.ts`

The factory export (`createPortfolioLookup`, `createMarketData`, `createInstrumentUniverse`) stays. The Lambda `handler` export at the bottom of each file is deleted.

Unit tests move with the code:

- `test/unit/tools/<tool>.test.ts` (renamed if needed to match the test convention; tests target the factory so they survive unchanged).

### Agent graph wiring

Each `agents/{agent-name}/graph.ts` gains a `buildTools()` helper constructed once at module scope:

```ts
function buildTools() {
  const tableName = process.env['TABLE_NAME'];
  if (!tableName) throw new Error('TABLE_NAME is required');
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return {
    portfolioLookup: createPortfolioLookup({ docClient, tableName }),
    // ...
  };
}
const tools = buildTools();
```

Inside the existing `invoke*()` function, after `kbContext` and `upstreamContext` are built:

```ts
const portfolioSnapshot = await tools.portfolioLookup({ tenantId: params.tenantId });
const toolContext = formatToolContext({ portfolioSnapshot });
const enrichedInput = params.input + kbContext + upstreamContext + toolContext;
```

`formatToolContext` produces a deterministic string block with a header such as `Current portfolio snapshot:` followed by a JSON or bulleted representation of the tool result. Empty or null results collapse to a single line (`Current portfolio snapshot: none`) rather than being omitted, to keep the prompt shape stable across invocations.

**Size cap:** each tool's contribution is truncated to a hard maximum (e.g. 4 KB) inside `formatToolContext` before being appended. Exceeding the cap logs a warning and elides trailing content.

### Per-service specifics

**`portfolio-engine-ctrl`**

- Tools injected: `portfolio-lookup` (keyed by `params.tenantId`).
- Call site: `agents/portfolio-engine/graph.ts` inside `invokePortfolioEngine`, between the upstream-context read and `invokeOrchestrator`.
- `enrichedInput` becomes: `params.input + kbContext + upstreamContext + toolContext`.

**`market-intelligence-ctrl`**

- Tools injected: `market-data` (no params) and `instrument-universe` (no params), invoked in parallel via `Promise.all`.
- Call site: `agents/market-intelligence/graph.ts` inside `invokeMarketResearch`, between the upstream-context read and `agentNode(...)`.
- `enrichedInput` becomes: `params.input + kbContext + upstreamContext + toolContext`.

### CDK changes

For each in-scope service's `src/service.stack.ts`:

1. **Delete** the `NodejsFunction` declarations for the tool Lambdas:
   - `portfolio-engine-ctrl`: `PortfolioLookup` block.
   - `market-intelligence-ctrl`: `MarketDataTool` and `InstrumentUniverseTool` blocks.
2. **Delete** the matching `state.getTable().grantReadData(…)` calls for those Lambdas.
3. **Remove** them from `extraLambdas` on `this.addObservability(...)`.
4. Leave `toolTargets: []` as-is — no Gateway to create.
5. Remove now-stale comments:
   - `market-intelligence-ctrl/src/service.stack.ts:126` — change to `// AgentRuntime`.
   - any comment referencing "standalone tool Lambdas".
6. No IAM change needed for the AgentRuntime: `libs/cdk-constructs/src/extensions/agent-runtime.ts:87` already grants `state.getTable().grantReadWriteData(this.runtime)`, which is strictly broader than the tool Lambdas' `grantReadData`.

### Testing

**Unit** — tool factory tests (existing) move with the code to `test/unit/tools/` and stay green unchanged.

**Graph** — `test/unit/graph.test.ts` in each service gains:

- A case that stubs the tool factory to return a known payload and asserts the stub's output appears in the prompt passed to the (mocked) agent node.
- A case with the factory returning empty/null data, asserting the stable "none" form is used.
- A case with oversized factory output, asserting truncation to the cap and a warning log.

**Stack** — `test/unit/service.stack.test.ts` in each service:

- Assert the deleted `NodejsFunction` logical IDs are **absent** from the synthesized template (by-logical-id check).
- Assert total Lambda count matches the expected post-change value.
- Assert the `AgentRuntime` construct still exists and the DDB table still grants RW to its role.

**Integration** — no new integration tests; existing integration tests either pass unchanged or surface regressions.

**E2E** — run the full E2E scenario sweep (`pnpm nx run e2e-feature-tests:test-e2e-features`) after the change to confirm no advisory decision flow regresses.

### Service card regeneration

Run the `audit-service` skill on each service after the change. Expected deltas:

- **Standalone Lambdas** section: remove the deleted Lambdas (portfolio-engine-ctrl loses `PortfolioLookup`; market-intelligence-ctrl loses `MarketDataTool` and `InstrumentUniverseTool`).
- **Handlers** section: remove `tools/*.ts` entries for the moved files.
- **AgentRuntime** section: add a sub-line, e.g.
  > Context augmentation: `portfolio-lookup` (in-process, deterministic pre-fetch)
- **Tests** section: update paths under the new `test/unit/tools/` location.

## Risk & rollback

- **Prompt bloat.** Adding unconditional tool context enlarges every prompt. Mitigations: size cap in `formatToolContext`; verify the largest realistic tool payload stays well under Sonnet/Opus context limits; watch token-cost metrics post-deploy.
- **DDB read amplification.** Each invocation now issues an extra DDB query. Scale is small (one read per agent invocation); acceptable.
- **Rollback.** `git revert` is safe. The deleted Lambdas had no caller to break. Agent code changes are localized to `graph.ts` in two services.

## Open questions (flagged, not blocking)

None. All design choices above are committed.

## Sequence of work (handoff to writing-plans)

1. `portfolio-engine-ctrl`: move tool file, update graph, delete CDK Lambda, update tests, regenerate service card.
2. `market-intelligence-ctrl`: same sequence for two tools.
3. Run full test suite (`pnpm nx affected -t test,lint,build`) + E2E sweep.
4. Single PR bundling both services (they share a pattern; splitting creates review churn with no isolation benefit).
