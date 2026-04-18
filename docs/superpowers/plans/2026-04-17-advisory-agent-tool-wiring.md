# Advisory Agent Tool Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire three orphaned tool handlers in `portfolio-engine-ctrl` and `market-intelligence-ctrl` into their agents as in-process deterministic context augmentation, and delete the dead Lambda infrastructure.

**Architecture:** Each tool factory is imported directly by its service's `agents/{agent-name}/graph.ts` and invoked before the LLM call, with the result formatted as a labelled prompt section appended to the existing `kbContext` + `upstreamContext`. No Gateway, no `bindTools`, no MCP — same pattern the services already use for `kb.retrieve()` and `session.readUpstreamOutput()`. The standalone `NodejsFunction` CDK resources for these tools are deleted.

**Tech Stack:** TypeScript, Jest, AWS CDK, `@langchain/aws`, `@nestfolio/agent-orchestrator`, `aws-sdk-client-mock`.

**Spec:** `docs/superpowers/specs/2026-04-17-advisory-agent-tool-wiring-design.md`

---

## Phase 1 — portfolio-engine-ctrl

### Task 1: Move portfolio-lookup tool into the agents tree

**Files:**
- Create: `services/advisory/portfolio-engine-ctrl/src/agents/tools/portfolio-lookup.ts`
- Delete: `services/advisory/portfolio-engine-ctrl/src/handlers/tools/portfolio-lookup.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/test/unit/portfolio-lookup.test.ts` (update import path)

- [ ] **Step 1: Create the new file** with the factory only (Lambda handler export removed)

```ts
// services/advisory/portfolio-engine-ctrl/src/agents/tools/portfolio-lookup.ts
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

interface PortfolioLookupDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly tableName: string;
}

export const createPortfolioLookup = (deps: PortfolioLookupDeps) =>
  async (event: { tenantId?: string }): Promise<Record<string, unknown>> => {
    if (!event.tenantId) {
      return { error: 'tenantId is required' };
    }

    const result = await deps.docClient.send(new QueryCommand({
      TableName: deps.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${event.tenantId}`,
        ':prefix': 'SNAPSHOT#',
      },
      ScanIndexForward: false,
      Limit: 1,
    }));

    const snapshot = result.Items?.[0];
    return snapshot
      ? { tenantId: event.tenantId, snapshot }
      : { tenantId: event.tenantId, snapshot: null, holdings: [] };
  };
```

- [ ] **Step 2: Update the test's import path**

Change line 8 of `test/unit/portfolio-lookup.test.ts` from
```ts
import { createPortfolioLookup } from '../../src/handlers/tools/portfolio-lookup';
```
to
```ts
import { createPortfolioLookup } from '../../src/agents/tools/portfolio-lookup';
```

- [ ] **Step 3: Delete the old file**

```bash
rm services/advisory/portfolio-engine-ctrl/src/handlers/tools/portfolio-lookup.ts
```

- [ ] **Step 4: Run the tool test — verify green**

```bash
pnpm nx test portfolio-engine-ctrl --testPathPattern=portfolio-lookup
```

Expected: all 3 tests in `portfolio-lookup.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/src/agents/tools/portfolio-lookup.ts \
        services/advisory/portfolio-engine-ctrl/src/handlers/tools/portfolio-lookup.ts \
        services/advisory/portfolio-engine-ctrl/test/unit/portfolio-lookup.test.ts
git commit -m "refactor(portfolio-engine-ctrl): move portfolio-lookup tool into agents tree"
```

---

### Task 2: Add format-context helper

**Files:**
- Create: `services/advisory/portfolio-engine-ctrl/src/agents/tools/format-context.ts`
- Create: `services/advisory/portfolio-engine-ctrl/test/unit/agents/format-context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/advisory/portfolio-engine-ctrl/test/unit/agents/format-context.test.ts
import { formatToolContext, MAX_SECTION_BYTES } from '../../../src/agents/tools/format-context';

describe('formatToolContext', () => {
  it('produces labelled sections for each entry', () => {
    const out = formatToolContext({
      'Portfolio snapshot': { totalValue: 50000, holdings: [] },
    });
    expect(out).toContain('Portfolio snapshot:');
    expect(out).toContain('"totalValue": 50000');
  });

  it('emits a stable "none" placeholder when data is null', () => {
    const out = formatToolContext({ 'Portfolio snapshot': null });
    expect(out).toContain('Portfolio snapshot:');
    expect(out).toContain('none');
  });

  it('truncates each section independently at MAX_SECTION_BYTES', () => {
    const bigString = 'x'.repeat(MAX_SECTION_BYTES + 500);
    const out = formatToolContext({ 'Big': { blob: bigString } });
    expect(out).toContain('[truncated]');
    const bigSection = out.split('Big:')[1] ?? '';
    expect(bigSection.length).toBeLessThanOrEqual(MAX_SECTION_BYTES + 100);
  });

  it('preserves order of sections as passed', () => {
    const out = formatToolContext({ A: 1, B: 2, C: 3 });
    expect(out.indexOf('A:')).toBeLessThan(out.indexOf('B:'));
    expect(out.indexOf('B:')).toBeLessThan(out.indexOf('C:'));
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```bash
pnpm nx test portfolio-engine-ctrl --testPathPattern=format-context
```

Expected: FAIL — `Cannot find module '.../format-context'`.

- [ ] **Step 3: Write the implementation**

```ts
// services/advisory/portfolio-engine-ctrl/src/agents/tools/format-context.ts
export const MAX_SECTION_BYTES = 4096;

export function formatToolContext(sections: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [label, data] of Object.entries(sections)) {
    const body = data === null || data === undefined
      ? 'none'
      : JSON.stringify(data, null, 2);
    const truncated = body.length > MAX_SECTION_BYTES
      ? `${body.slice(0, MAX_SECTION_BYTES)}\n... [truncated]`
      : body;
    parts.push(`\n\n${label}:\n${truncated}`);
  }
  return parts.join('');
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
pnpm nx test portfolio-engine-ctrl --testPathPattern=format-context
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/src/agents/tools/format-context.ts \
        services/advisory/portfolio-engine-ctrl/test/unit/agents/format-context.test.ts
git commit -m "feat(portfolio-engine-ctrl): add formatToolContext helper"
```

---

### Task 3: Extend graph test with a failing tool-injection assertion

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/test/unit/graph.test.ts`

- [ ] **Step 1: Add the failing test case**

Add the following block inside the `describe('portfolio-engine-ctrl orchestrator graph', …)` block, after the existing `it('invokePortfolioEngine enriches input with KB context', …)` test:

```ts
  it('invokePortfolioEngine injects portfolio snapshot into enriched input', async () => {
    mockKBRetrieve.mockResolvedValue([]);
    mockInvokeOrchestrator.mockResolvedValue({
      'portfolio-construction': { allocations: [] },
      'rebalance-planner': { trades: [] },
    });

    const snapshot = {
      tenantId: 't1',
      snapshot: { totalValue: 50000, holdings: [{ instrument: 'VTI', weight: 0.6 }] },
    };

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      jest.doMock('../../src/agents/tools/portfolio-lookup', () => ({
        createPortfolioLookup: () => async () => snapshot,
      }));
      const mod = require('../../agents/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    process.env['TABLE_NAME'] = 'test-table';
    await invokePortfolioEngine!({ tenantId: 't1', decisionId: 'd1', input: 'Rebalance' });

    const passedInput = mockInvokeOrchestrator.mock.calls[0][1].input as string;
    expect(passedInput).toContain('Portfolio snapshot:');
    expect(passedInput).toContain('"totalValue": 50000');
  });
```

- [ ] **Step 2: Run it — verify failure**

```bash
pnpm nx test portfolio-engine-ctrl --testPathPattern=graph
```

Expected: the new test fails because `invokePortfolioEngine` does not yet read the tool or inject its output into the prompt.

- [ ] **Step 3: Commit the failing test**

```bash
git add services/advisory/portfolio-engine-ctrl/test/unit/graph.test.ts
git commit -m "test(portfolio-engine-ctrl): expect portfolio snapshot in agent prompt"
```

---

### Task 4: Wire portfolio-lookup into graph.ts

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts`

- [ ] **Step 1: Update imports and add the tool-building helper**

At the top of `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts`, add:

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createPortfolioLookup } from '../src/agents/tools/portfolio-lookup';
import { formatToolContext } from '../src/agents/tools/format-context';
```

After the existing `buildMemoryClient` function, add:

```ts
function buildTools() {
  const tableName = process.env['TABLE_NAME'];
  if (!tableName) throw new Error('TABLE_NAME is required for portfolio-engine tools');
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return {
    portfolioLookup: createPortfolioLookup({ docClient, tableName }),
  };
}

const tools = buildTools();
```

- [ ] **Step 2: Inject tool output into the enriched prompt**

Replace the body of `invokePortfolioEngine` — specifically the block starting at "3. Invoke orchestrator" — so the function becomes:

```ts
export async function invokePortfolioEngine(params: {
  tenantId: string;
  decisionId: string;
  input: string;
}): Promise<Record<string, unknown>> {
  const memory = buildMemoryClient();
  const session = memory.openDecisionSession(params.tenantId, params.decisionId);
  const kb = buildKBClient();

  // 1. Retrieve fund/instrument data from KB
  let kbContext = '';
  if (kb) {
    const kbResults = await kb.retrieve(params.input, 5);
    if (kbResults.length > 0) {
      kbContext = `\n\nFund & instrument data from knowledge base:\n${kbResults.map((r) => r.text).join('\n')}`;
    }
  }

  // 2. Read upstream context
  const upstreamRecords = await session.readUpstreamOutput('advisory-ctrl');
  const upstreamContext = upstreamRecords.length > 0
    ? `\n\nUpstream context:\n${upstreamRecords.map((r) => r.content).join('\n')}`
    : '';

  // 3. Deterministic tool context (portfolio snapshot)
  const portfolioSnapshot = await tools.portfolioLookup({ tenantId: params.tenantId });
  const toolContext = formatToolContext({ 'Portfolio snapshot': portfolioSnapshot });

  // 4. Invoke orchestrator (parallel: portfolio-construction + rebalance-planner)
  const enrichedInput = params.input + kbContext + upstreamContext + toolContext;
  const result = await invokeOrchestrator(graph, { input: enrichedInput }, {});

  // 5. Persist to memory
  if (!('serviceUnavailable' in result)) {
    await session.writeAgentOutput(result);
  }

  return result;
}
```

- [ ] **Step 3: Run graph tests — verify pass**

```bash
pnpm nx test portfolio-engine-ctrl --testPathPattern=graph
```

Expected: all graph tests pass, including the new injection assertion.

- [ ] **Step 4: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts
git commit -m "feat(portfolio-engine-ctrl): inject portfolio snapshot into agent prompt"
```

---

### Task 5: Delete tool Lambda from CDK stack

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`

- [ ] **Step 1: Remove the `PortfolioLookup` NodejsFunction block**

Delete lines 55-61 (the `// Tool Lambda: portfolio-lookup` block plus the `grantReadData` call):

```ts
    // Tool Lambda: portfolio-lookup
    const portfolioLookupFn = new NodejsFunction(this, 'PortfolioLookup', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'tools', 'portfolio-lookup.ts'),
      environment: { TABLE_NAME: state.getTable().tableName },
    });
    state.getTable().grantReadData(portfolioLookupFn);
```

- [ ] **Step 2: Remove it from observability**

Change `extraLambdas: [kbIngestionFn, portfolioLookupFn],` (near the bottom) to:

```ts
      extraLambdas: [kbIngestionFn],
```

- [ ] **Step 3: Remove the `handlers` tools directory if now empty**

```bash
rmdir services/advisory/portfolio-engine-ctrl/src/handlers/tools 2>/dev/null || true
```

- [ ] **Step 4: Run build to verify the stack still compiles**

```bash
pnpm nx build portfolio-engine-ctrl
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/src/service.stack.ts
git commit -m "chore(portfolio-engine-ctrl): remove orphaned portfolio-lookup Lambda"
```

---

### Task 6: Update stack test for new Lambda count

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Replace the vague Lambda-count test with a precise assertion**

Replace the existing `it('creates Lambda functions …')` block (lines 36-39) with:

```ts
  it('creates the expected Lambda functions (event-listener, CDC, KB ingestion)', () => {
    const lambdas = template.findResources('AWS::Lambda::Function');
    const logicalIds = Object.keys(lambdas);
    expect(logicalIds.some((id) => id.includes('PortfolioLookup'))).toBe(false);
    expect(logicalIds.some((id) => id.includes('Ingress'))).toBe(true);
    expect(logicalIds.some((id) => id.includes('Egress'))).toBe(true);
    expect(logicalIds.some((id) => id.includes('KBIngestion'))).toBe(true);
  });
```

- [ ] **Step 2: Run stack test — verify pass**

```bash
pnpm nx test portfolio-engine-ctrl --testPathPattern=service.stack
```

Expected: all stack tests pass.

- [ ] **Step 3: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts
git commit -m "test(portfolio-engine-ctrl): assert portfolio-lookup Lambda is absent"
```

---

### Task 7: Regenerate service card

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/CLAUDE.md`

- [ ] **Step 1: Invoke the audit-service skill**

Run the `audit-service` skill scoped to `portfolio-engine-ctrl` to regenerate the card from code.

Expected deltas:
- "Standalone Lambdas" section: remove `PortfolioLookup` entry.
- "Handlers" section: remove `tools/portfolio-lookup.ts` entry.
- "AgentRuntime" block: add a line under it — `Context augmentation: portfolio-lookup (in-process, deterministic pre-fetch)`.
- "Tests" section: replace `portfolio-lookup.test.ts` reference with `agents/format-context.test.ts` added, and note that `portfolio-lookup.test.ts` still exists but imports from `src/agents/tools/`.

- [ ] **Step 2: Run full affected test suite for this service**

```bash
pnpm nx run-many -t test,lint --projects=portfolio-engine-ctrl
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/CLAUDE.md
git commit -m "docs(portfolio-engine-ctrl): regenerate service card after tool refactor"
```

---

## Phase 2 — market-intelligence-ctrl

### Task 8: Convert `market-data` handler to a pure factory function

**Files:**
- Create: `services/advisory/market-intelligence-ctrl/src/agents/tools/market-data.ts`
- Delete: `services/advisory/market-intelligence-ctrl/src/handlers/tools/market-data.handler.ts`
- Modify: `services/advisory/market-intelligence-ctrl/test/unit/tools/market-data.handler.test.ts` → rename to `market-data.test.ts` and update

- [ ] **Step 1: Create the factory file**

```ts
// services/advisory/market-intelligence-ctrl/src/agents/tools/market-data.ts
export interface MarketDataInput {
  readonly tickers?: readonly string[];
}

export interface MarketIndex {
  readonly ticker: string;
  readonly price: number;
  readonly change: number;
  readonly changePercent: number;
  readonly volume: number;
}

export interface MarketDataResult {
  readonly indices: readonly MarketIndex[];
  readonly volatility: { readonly vix: number };
  readonly timestamp: string;
}

export function getMarketData(input: MarketDataInput = {}): MarketDataResult {
  const tickers = input.tickers ?? ['SPY', 'QQQ', 'DIA', 'IWM'];
  const indices = tickers.map((ticker) => ({
    ticker,
    price: 450 + Math.random() * 50,
    change: (Math.random() - 0.5) * 4,
    changePercent: (Math.random() - 0.5) * 2,
    volume: Math.floor(Math.random() * 10_000_000),
  }));
  return {
    indices,
    volatility: { vix: 15 + Math.random() * 10 },
    timestamp: new Date().toISOString(),
  };
}
```

- [ ] **Step 2: Rename and rewrite the test**

```bash
git mv services/advisory/market-intelligence-ctrl/test/unit/tools/market-data.handler.test.ts \
       services/advisory/market-intelligence-ctrl/test/unit/tools/market-data.test.ts
```

Then replace the file contents with:

```ts
// services/advisory/market-intelligence-ctrl/test/unit/tools/market-data.test.ts
import { getMarketData } from '../../../src/agents/tools/market-data';

describe('market-data tool', () => {
  it('returns market indices for default tickers', () => {
    const result = getMarketData();
    expect(result.indices).toHaveLength(4);
    expect(result.indices[0]).toHaveProperty('ticker');
    expect(result.indices[0]).toHaveProperty('price');
    expect(result.indices[0]).toHaveProperty('change');
    expect(result.indices[0]).toHaveProperty('volume');
    expect(result.volatility).toHaveProperty('vix');
    expect(result.timestamp).toBeDefined();
  });

  it('returns market indices for specified tickers', () => {
    const result = getMarketData({ tickers: ['SPY', 'QQQ'] });
    expect(result.indices).toHaveLength(2);
    expect(result.indices.map((i) => i.ticker)).toEqual(['SPY', 'QQQ']);
  });
});
```

- [ ] **Step 3: Delete the old handler file**

```bash
rm services/advisory/market-intelligence-ctrl/src/handlers/tools/market-data.handler.ts
```

- [ ] **Step 4: Run the tool test — verify green**

```bash
pnpm nx test market-intelligence-ctrl --testPathPattern=market-data
```

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/src/agents/tools/market-data.ts \
        services/advisory/market-intelligence-ctrl/src/handlers/tools/market-data.handler.ts \
        services/advisory/market-intelligence-ctrl/test/unit/tools/market-data.test.ts \
        services/advisory/market-intelligence-ctrl/test/unit/tools/market-data.handler.test.ts
git commit -m "refactor(market-intelligence-ctrl): convert market-data handler to in-process factory"
```

---

### Task 9: Convert `instrument-universe` handler to a pure factory function

**Files:**
- Create: `services/advisory/market-intelligence-ctrl/src/agents/tools/instrument-universe.ts`
- Delete: `services/advisory/market-intelligence-ctrl/src/handlers/tools/instrument-universe.handler.ts`
- Modify: `services/advisory/market-intelligence-ctrl/test/unit/tools/instrument-universe.handler.test.ts` → rename and update

- [ ] **Step 1: Create the factory file**

```ts
// services/advisory/market-intelligence-ctrl/src/agents/tools/instrument-universe.ts
export interface Instrument {
  readonly ticker: string;
  readonly name: string;
  readonly assetClass: string;
  readonly region: string;
}

export interface InstrumentUniverseInput {
  readonly assetClass?: string;
}

export interface InstrumentUniverseResult {
  readonly instruments: readonly Instrument[];
  readonly count: number;
  readonly timestamp: string;
}

const APPROVED_INSTRUMENTS: readonly Instrument[] = [
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF', assetClass: 'equity', region: 'US' },
  { ticker: 'QQQ', name: 'Invesco QQQ Trust', assetClass: 'equity', region: 'US' },
  { ticker: 'AGG', name: 'iShares Core U.S. Aggregate Bond ETF', assetClass: 'fixed-income', region: 'US' },
  { ticker: 'GLD', name: 'SPDR Gold Shares', assetClass: 'commodity', region: 'global' },
  { ticker: 'VWO', name: 'Vanguard FTSE Emerging Markets ETF', assetClass: 'equity', region: 'EM' },
  { ticker: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', assetClass: 'fixed-income', region: 'US' },
  { ticker: 'IWM', name: 'iShares Russell 2000 ETF', assetClass: 'equity', region: 'US' },
  { ticker: 'EFA', name: 'iShares MSCI EAFE ETF', assetClass: 'equity', region: 'intl' },
];

export function getInstrumentUniverse(input: InstrumentUniverseInput = {}): InstrumentUniverseResult {
  const filtered = input.assetClass
    ? APPROVED_INSTRUMENTS.filter((i) => i.assetClass === input.assetClass)
    : APPROVED_INSTRUMENTS;
  return {
    instruments: filtered,
    count: filtered.length,
    timestamp: new Date().toISOString(),
  };
}
```

- [ ] **Step 2: Rename and rewrite the test**

```bash
git mv services/advisory/market-intelligence-ctrl/test/unit/tools/instrument-universe.handler.test.ts \
       services/advisory/market-intelligence-ctrl/test/unit/tools/instrument-universe.test.ts
```

Replace contents with:

```ts
// services/advisory/market-intelligence-ctrl/test/unit/tools/instrument-universe.test.ts
import { getInstrumentUniverse } from '../../../src/agents/tools/instrument-universe';

describe('instrument-universe tool', () => {
  it('returns the full approved list by default', () => {
    const result = getInstrumentUniverse();
    expect(result.instruments.length).toBeGreaterThan(0);
    expect(result.count).toBe(result.instruments.length);
    expect(result.instruments[0]).toHaveProperty('ticker');
    expect(result.instruments[0]).toHaveProperty('name');
    expect(result.instruments[0]).toHaveProperty('assetClass');
    expect(result.instruments[0]).toHaveProperty('region');
    expect(result.timestamp).toBeDefined();
  });

  it('filters by asset class', () => {
    const result = getInstrumentUniverse({ assetClass: 'fixed-income' });
    expect(result.instruments.length).toBeGreaterThan(0);
    result.instruments.forEach((i) => expect(i.assetClass).toBe('fixed-income'));
  });

  it('returns an empty list for unknown asset class', () => {
    const result = getInstrumentUniverse({ assetClass: 'crypto' });
    expect(result.instruments).toHaveLength(0);
    expect(result.count).toBe(0);
  });
});
```

- [ ] **Step 3: Delete the old handler file**

```bash
rm services/advisory/market-intelligence-ctrl/src/handlers/tools/instrument-universe.handler.ts
```

- [ ] **Step 4: Run the tool test — verify green**

```bash
pnpm nx test market-intelligence-ctrl --testPathPattern=instrument-universe
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/src/agents/tools/instrument-universe.ts \
        services/advisory/market-intelligence-ctrl/src/handlers/tools/instrument-universe.handler.ts \
        services/advisory/market-intelligence-ctrl/test/unit/tools/instrument-universe.test.ts \
        services/advisory/market-intelligence-ctrl/test/unit/tools/instrument-universe.handler.test.ts
git commit -m "refactor(market-intelligence-ctrl): convert instrument-universe handler to in-process factory"
```

---

### Task 10: Add format-context helper (market-intelligence-ctrl)

**Files:**
- Create: `services/advisory/market-intelligence-ctrl/src/agents/tools/format-context.ts`
- Create: `services/advisory/market-intelligence-ctrl/test/unit/agents/format-context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/advisory/market-intelligence-ctrl/test/unit/agents/format-context.test.ts
import { formatToolContext, MAX_SECTION_BYTES } from '../../../src/agents/tools/format-context';

describe('formatToolContext', () => {
  it('produces labelled sections for each entry', () => {
    const out = formatToolContext({
      'Market data': { indices: [{ ticker: 'SPY', price: 450 }] },
    });
    expect(out).toContain('Market data:');
    expect(out).toContain('SPY');
  });

  it('emits a stable "none" placeholder when data is null', () => {
    const out = formatToolContext({ 'Market data': null });
    expect(out).toContain('Market data:');
    expect(out).toContain('none');
  });

  it('truncates each section independently at MAX_SECTION_BYTES', () => {
    const bigString = 'x'.repeat(MAX_SECTION_BYTES + 500);
    const out = formatToolContext({ 'Big': { blob: bigString } });
    expect(out).toContain('[truncated]');
    const bigSection = out.split('Big:')[1] ?? '';
    expect(bigSection.length).toBeLessThanOrEqual(MAX_SECTION_BYTES + 100);
  });

  it('preserves order of sections as passed', () => {
    const out = formatToolContext({ A: 1, B: 2, C: 3 });
    expect(out.indexOf('A:')).toBeLessThan(out.indexOf('B:'));
    expect(out.indexOf('B:')).toBeLessThan(out.indexOf('C:'));
  });
});
```

- [ ] **Step 2: Run — verify it fails**

```bash
pnpm nx test market-intelligence-ctrl --testPathPattern=format-context
```

Expected: FAIL — `Cannot find module '.../format-context'`.

- [ ] **Step 3: Write implementation**

```ts
// services/advisory/market-intelligence-ctrl/src/agents/tools/format-context.ts
export const MAX_SECTION_BYTES = 4096;

export function formatToolContext(sections: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [label, data] of Object.entries(sections)) {
    const body = data === null || data === undefined
      ? 'none'
      : JSON.stringify(data, null, 2);
    const truncated = body.length > MAX_SECTION_BYTES
      ? `${body.slice(0, MAX_SECTION_BYTES)}\n... [truncated]`
      : body;
    parts.push(`\n\n${label}:\n${truncated}`);
  }
  return parts.join('');
}
```

- [ ] **Step 4: Run — verify pass**

```bash
pnpm nx test market-intelligence-ctrl --testPathPattern=format-context
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/src/agents/tools/format-context.ts \
        services/advisory/market-intelligence-ctrl/test/unit/agents/format-context.test.ts
git commit -m "feat(market-intelligence-ctrl): add formatToolContext helper"
```

---

### Task 11: Extend graph test for tool injection

**Files:**
- Modify: `services/advisory/market-intelligence-ctrl/test/unit/graph.test.ts`

- [ ] **Step 1: Add the failing test**

Insert the following `it(…)` block inside the `describe('market-intelligence-ctrl structured graph', …)` block:

```ts
  it('injects market-data and instrument-universe into the agent prompt', async () => {
    mockKBRetrieve.mockResolvedValue([]);
    mockAgentNode.mockResolvedValue({
      signals: [],
      tickersMentioned: [],
      marketOutlook: 'neutral',
      confidenceScore: 0.5,
    });

    await invokeMarketResearch({
      tenantId: 't1',
      decisionId: 'd1',
      input: 'Scan market',
    });

    const passedInput = (mockAgentNode.mock.calls[0][0] as { input: string }).input;
    expect(passedInput).toContain('Current market data:');
    expect(passedInput).toContain('Instrument universe:');
  });
```

- [ ] **Step 2: Run — verify failure**

```bash
pnpm nx test market-intelligence-ctrl --testPathPattern=graph
```

Expected: the new test fails because `invokeMarketResearch` does not yet inject tool context.

- [ ] **Step 3: Commit the failing test**

```bash
git add services/advisory/market-intelligence-ctrl/test/unit/graph.test.ts
git commit -m "test(market-intelligence-ctrl): expect market data + universe in agent prompt"
```

---

### Task 12: Wire the two tools into graph.ts

**Files:**
- Modify: `services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts`

- [ ] **Step 1: Add imports and injection**

At the top of `services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts`, add:

```ts
import { getMarketData } from '../src/agents/tools/market-data';
import { getInstrumentUniverse } from '../src/agents/tools/instrument-universe';
import { formatToolContext } from '../src/agents/tools/format-context';
```

Rewrite `invokeMarketResearch` so that after the `upstreamContext` line and before `agentNode(...)`:

```ts
export async function invokeMarketResearch(params: {
  tenantId: string;
  decisionId: string;
  input: string;
}): Promise<Record<string, unknown>> {
  const memory = buildMemoryClient();
  const session = memory.openDecisionSession(params.tenantId, params.decisionId);
  const kb = buildKBClient();

  // 1. Retrieve market intelligence from KB (news, sentiment, macro)
  let kbContext = '';
  if (kb) {
    const kbResults = await kb.retrieve(params.input, 5);
    if (kbResults.length > 0) {
      kbContext = `\n\nMarket intelligence from knowledge base:\n${kbResults.map((r) => r.text).join('\n')}`;
    }
  }

  // 2. Read upstream context (investor profile from advisory-ctrl)
  const upstreamRecords = await session.readUpstreamOutput('advisory-ctrl');
  const upstreamContext = upstreamRecords.length > 0
    ? `\n\nUpstream context:\n${upstreamRecords.map((r) => r.content).join('\n')}`
    : '';

  // 3. Deterministic tool context (market data + instrument universe, in parallel)
  const [marketData, instrumentUniverse] = await Promise.all([
    Promise.resolve(getMarketData()),
    Promise.resolve(getInstrumentUniverse()),
  ]);
  const toolContext = formatToolContext({
    'Current market data': marketData,
    'Instrument universe': instrumentUniverse,
  });

  // 4. Invoke agent
  const enrichedInput = params.input + kbContext + upstreamContext + toolContext;
  const result = await agentNode({ input: enrichedInput });

  // 5. Persist to memory
  await session.writeAgentOutput(result);

  return result;
}
```

- [ ] **Step 2: Run graph tests — verify pass**

```bash
pnpm nx test market-intelligence-ctrl --testPathPattern=graph
```

Expected: all graph tests pass including the new injection assertion.

- [ ] **Step 3: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts
git commit -m "feat(market-intelligence-ctrl): inject market data + universe into agent prompt"
```

---

### Task 13: Delete both tool Lambdas from CDK stack

**Files:**
- Modify: `services/advisory/market-intelligence-ctrl/src/service.stack.ts`

- [ ] **Step 1: Remove the `MarketDataTool` block**

Delete lines 77-85 (the `// Tool Lambdas` comment through the end of the `marketDataFn` block including its `grantReadData`):

```ts
    // Tool Lambdas
    const marketDataFn = new NodejsFunction(this, 'MarketDataTool', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'tools', 'market-data.handler.ts'),
      environment: {
        TABLE_NAME: state.getTable().tableName,
      },
    });
    state.getTable().grantReadData(marketDataFn);
```

- [ ] **Step 2: Remove the `InstrumentUniverseTool` block**

Delete lines 87-94:

```ts
    const instrumentUniverseFn = new NodejsFunction(this, 'InstrumentUniverseTool', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'tools', 'instrument-universe.handler.ts'),
      environment: {
        TABLE_NAME: state.getTable().tableName,
      },
    });
    state.getTable().grantReadData(instrumentUniverseFn);
```

- [ ] **Step 3: Fix up the AgentRuntime comment on line 126**

Replace
```ts
    // AgentRuntime (tool Lambdas are standalone — gateway integration added when schemas defined)
```
with
```ts
    // AgentRuntime
```

- [ ] **Step 4: Remove deleted Lambdas from observability**

Change `extraLambdas: [kbIngestionFn, marketDataFn, instrumentUniverseFn],` to:

```ts
      extraLambdas: [kbIngestionFn],
```

- [ ] **Step 5: Remove now-empty handlers/tools directory**

```bash
rmdir services/advisory/market-intelligence-ctrl/src/handlers/tools 2>/dev/null || true
```

- [ ] **Step 6: Build — verify compile**

```bash
pnpm nx build market-intelligence-ctrl
```

Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/src/service.stack.ts
git commit -m "chore(market-intelligence-ctrl): remove orphaned tool Lambdas"
```

---

### Task 14: Update stack test for new Lambda count

**Files:**
- Modify: `services/advisory/market-intelligence-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Read the current file to locate the Lambda-count assertion**

```bash
cat services/advisory/market-intelligence-ctrl/test/unit/service.stack.test.ts
```

- [ ] **Step 2: Replace the Lambda-count test with a by-logical-id assertion**

Find the test that counts Lambdas (similar in shape to the portfolio-engine-ctrl stack test); replace with:

```ts
  it('creates the expected Lambda functions (event-listener, CDC, KB ingestion) and no tool Lambdas', () => {
    const lambdas = template.findResources('AWS::Lambda::Function');
    const logicalIds = Object.keys(lambdas);
    expect(logicalIds.some((id) => id.includes('MarketDataTool'))).toBe(false);
    expect(logicalIds.some((id) => id.includes('InstrumentUniverseTool'))).toBe(false);
    expect(logicalIds.some((id) => id.includes('Ingress'))).toBe(true);
    expect(logicalIds.some((id) => id.includes('Egress'))).toBe(true);
    expect(logicalIds.some((id) => id.includes('KBIngestion'))).toBe(true);
  });
```

- [ ] **Step 3: Run stack test — verify pass**

```bash
pnpm nx test market-intelligence-ctrl --testPathPattern=service.stack
```

Expected: all stack tests pass.

- [ ] **Step 4: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/test/unit/service.stack.test.ts
git commit -m "test(market-intelligence-ctrl): assert tool Lambdas are absent"
```

---

### Task 15: Regenerate service card

**Files:**
- Modify: `services/advisory/market-intelligence-ctrl/CLAUDE.md`

- [ ] **Step 1: Invoke the audit-service skill**

Run the `audit-service` skill scoped to `market-intelligence-ctrl` to regenerate the card from code.

Expected deltas:
- "Standalone Lambdas" section: remove `MarketDataTool` and `InstrumentUniverseTool` entries.
- "Handlers" section: remove both `tools/*.handler.ts` entries.
- "AgentRuntime" block: add — `Context augmentation: market-data, instrument-universe (in-process, deterministic pre-fetch)`.
- "Tests" section: update to reference `agents/format-context.test.ts` and the renamed `tools/market-data.test.ts` + `tools/instrument-universe.test.ts`.

- [ ] **Step 2: Run full affected suite for this service**

```bash
pnpm nx run-many -t test,lint --projects=market-intelligence-ctrl
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/CLAUDE.md
git commit -m "docs(market-intelligence-ctrl): regenerate service card after tool refactor"
```

---

## Phase 3 — System verification

### Task 16: Run full affected test + lint + build sweep

- [ ] **Step 1: Run nx affected across test, lint, build**

```bash
pnpm nx affected -t test,lint,build --base=HEAD~14
```

(Adjust `--base` if fewer commits have been made.) Expected: all affected projects pass.

- [ ] **Step 2: If anything fails, stop and diagnose**

Do not proceed to E2E until affected is clean. Typical failures to look for:
- Leftover references to the deleted handler files from another service or test fixture.
- Import boundary violations (the pre-commit hook will also flag these).

---

### Task 17: Run E2E feature tests

- [ ] **Step 1: Run the full E2E sweep**

```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev \
  pnpm nx run e2e-feature-tests:test-e2e-features
```

Expected: all 13 E2E scenarios still green. Advisory-driven scenarios exercise the two services touched here.

- [ ] **Step 2: If any scenario fails, triage before merge**

Inspect the failure: is it a prompt-size issue from the added context (truncate further), a missing `TABLE_NAME` env var on the runtime (verify it is still set by `AgentRuntime`'s `environmentVariables`), or an unrelated flake (rerun)?

---

### Task 18: Verify no stray references remain

- [ ] **Step 1: Grep for deleted Lambda logical IDs and old paths**

```bash
pnpm -w exec rg -n "MarketDataTool|InstrumentUniverseTool|handlers/tools/market-data|handlers/tools/instrument-universe|handlers/tools/portfolio-lookup"
```

Expected: no matches in `services/` or `test/` or `libs/`. Matches inside `docs/` may be historical and are acceptable; review them.

- [ ] **Step 2: Grep for orphan comment**

```bash
pnpm -w exec rg -n "standalone — gateway integration"
```

Expected: no matches.

---

### Task 19: Open PR

- [ ] **Step 1: Push branch and open PR**

```bash
git push -u origin HEAD
gh pr create --title "refactor(advisory): wire orphaned agent tools as in-process context" --body "$(cat <<'EOF'
## Summary
- Move `portfolio-lookup` into `portfolio-engine-ctrl`'s agent tree and inject it into the agent prompt.
- Move `market-data` + `instrument-universe` into `market-intelligence-ctrl`'s agent tree, convert from Lambda-envelope handlers to pure factory functions, inject both into the agent prompt.
- Delete the 3 standalone tool Lambdas — they had no caller.
- Regenerate both service cards.

Design: `docs/superpowers/specs/2026-04-17-advisory-agent-tool-wiring-design.md`.

## Test plan
- [ ] `pnpm nx affected -t test,lint,build` green
- [ ] E2E feature test sweep green (all 13 scenarios)
- [ ] Deploy to sandbox + spot-check advisory decision flow invokes both services without error

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Return the PR URL to the user**

---

## Self-Review Notes

- **Spec coverage:** § 1 scope (Tasks 1-15), § 2 file layout (Tasks 1, 8, 9), § 3 graph wiring (Tasks 3-4, 11-12), § 4 CDK (Tasks 5-6, 13-14), § 5 testing (Tasks 2-6, 10-14), § 6 service cards (Tasks 7, 15), § 7 risk mitigations (Task 2 cap, Task 17 E2E) — all mapped.
- **No placeholders:** every code block contains runnable TypeScript or an exact shell command.
- **Type consistency:** `createPortfolioLookup` returns `async (event: { tenantId?: string }) => Promise<Record<string, unknown>>` (unchanged from current file); `getMarketData`/`getInstrumentUniverse` return typed `MarketDataResult`/`InstrumentUniverseResult`; `formatToolContext(sections: Record<string, unknown>): string` is consistent across both services.
- **Frequent commits:** 14 commits across 19 tasks, each small and reversible.
