# Portfolio-engine mode-anchored examples (α-tune) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the operating-mode e2e gate (`apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts`) on CONSERVATIVE + AGGRESSIVE by (a) reframing `largestPositionWeight` as "largest EQUITY position" so the CONSERVATIVE envelope is mathematically satisfiable, and (b) anchoring portfolio-construction on per-mode worked examples so Opus 4.6 stops regressing to a BALANCED-shaped output regardless of mode.

**Architecture:** Two coupled changes in `services/advisory/portfolio-engine-ctrl/`:
1. **Envelope clarification (Fix 1)** — three doc-only edits (prompt rule wording, schema field description, e2e test filter) plus a one-line cross-reference in the Phase 2 spec.
2. **Per-mode prompt + cached orchestrator (Fix 2)** — `prompts.ts` exposes `buildPortfolioConstructionPrompt(mode)` (three per-mode shape constants + one builder), `portfolio-construction.config.ts` exposes `buildPortfolioConstructionConfig(mode)`, and `agents/portfolio-engine/graph.ts` builds the orchestrator lazily per mode with a `Map<OperatingMode, CompiledGraph>` cache (3 graphs ever, one per mode, since `rebalancePlannerConfig` does not vary).

**Tech Stack:** TypeScript, Zod, LangGraph (`@langchain/langgraph`), `@nestfolio/agent-orchestrator` (in-house lib), Jest 30, Bedrock (Claude Opus 4.6 for portfolio-construction). Build via `pnpm nx`.

**Spec:** `docs/superpowers/specs/2026-05-06-portfolio-engine-mode-anchored-examples-design.md` — read this before starting; the worked examples (CONSERVATIVE/BALANCED/AGGRESSIVE shapes) are reproduced verbatim in Task 4.

---

## File map

| File                                                                                                                  | Action  | Purpose                                                                                       |
| --------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `services/advisory/portfolio-engine-ctrl/src/agents/schemas.ts`                                                       | Modify  | `largestPositionWeight.describe()` → "largest EQUITY position" semantic                       |
| `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts`                                            | Modify  | (a) modeContext rules reword; (b) lazy per-mode orchestrator + Map cache; (c) drop bare `export { graph }` |
| `services/advisory/portfolio-engine-ctrl/src/agents/prompts.ts`                                                       | Modify  | Three per-mode shape constants + `buildPortfolioConstructionPrompt(mode)` builder             |
| `services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config.ts`                                 | Modify  | Replace constant export with `buildPortfolioConstructionConfig(mode)` factory                 |
| `services/advisory/portfolio-engine-ctrl/test/unit/graph.test.ts`                                                     | Modify  | Test #1 adapt to lazy build; new test asserts cache reuse                                     |
| `services/advisory/portfolio-engine-ctrl/test/unit/prompts.test.ts`                                                   | Create  | New unit tests for the per-mode prompt builder                                                |
| `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts`                                 | Modify  | Filter to `assetClass === 'EQUITY'` before `Math.max`; update JSDoc                            |
| `docs/superpowers/specs/2026-05-05-operating-mode-phase-2-design.md`                                                  | Modify  | Append clarification reference on §Step 6 envelope table                                      |

---

## Task 1: Reframe `largestPositionWeight` as "largest EQUITY position" — schema + prompt + e2e test

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/agents/schemas.ts:24`
- Modify: `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts:107-115`
- Modify: `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts:28-33,132`
- Modify: `docs/superpowers/specs/2026-05-05-operating-mode-phase-2-design.md:149-151`

This task is doc/wording-only — no behavior change in the orchestrator graph. It establishes the contract that Task 4's per-mode worked examples will then satisfy.

- [ ] **Step 1: Update the schema field description**

In `services/advisory/portfolio-engine-ctrl/src/agents/schemas.ts:24`, change:

```ts
    largestPositionWeight: z.number().min(0).max(1).describe('Weight of the single largest position'),
```

to:

```ts
    largestPositionWeight: z.number().min(0).max(1).describe('Weight of the single largest EQUITY position (max targetWeight across allocations whose assetClass is EQUITY)'),
```

- [ ] **Step 2: Update the modeContext rules in graph.ts**

In `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts:107-115`, replace the entire `modeGuidance` object with:

```ts
  const modeGuidance: Record<string, string> = {
    CONSERVATIVE: 'OPERATING MODE: CONSERVATIVE. THESE ARE HARD RULES FOR THIS INVOCATION — every clause MUST be honoured exactly. (1) equityWeight MUST be ≤ 0.30 (the rest in fixed income / cash). (2) the largest single EQUITY position (max targetWeight across allocations whose assetClass is EQUITY) MUST be ≤ 0.10 — bond and cash positions may be larger. (3) allocations.length MUST be between 3 and 5 inclusive. (4) Prefer broad-market ETFs over single names. (5) Prioritise capital preservation over growth. Producing equityWeight > 0.30, an equity position > 10%, or fewer than 3 / more than 5 positions is a HARD FAILURE.',
    BALANCED: 'OPERATING MODE: BALANCED. THESE ARE HARD RULES FOR THIS INVOCATION — every clause MUST be honoured exactly. (1) equityWeight MUST be in [0.50, 0.70]. (2) the largest single EQUITY position (max targetWeight across allocations whose assetClass is EQUITY) MUST be ≤ 0.15 — bond and cash positions may be larger. (3) allocations.length MUST be between 5 and 8 inclusive. (4) Mix broad ETFs with measured sector tilts. (5) Balance growth and stability. Producing equityWeight outside [0.50, 0.70], an equity position > 15%, or fewer than 5 / more than 8 positions is a HARD FAILURE.',
    AGGRESSIVE: 'OPERATING MODE: AGGRESSIVE. THESE ARE HARD RULES FOR THIS INVOCATION — every clause MUST be honoured exactly. (1) equityWeight MUST be in [0.70, 0.90]. (2) the largest single EQUITY position (max targetWeight across allocations whose assetClass is EQUITY) MUST be ≤ 0.25 — bond and cash positions may be larger. (3) allocations.length MUST be between 6 and 12 inclusive. (4) Sector and thematic concentrations allowed. (5) Prioritise long-term growth and accept higher volatility. Producing equityWeight outside [0.70, 0.90], an equity position > 25%, or fewer than 6 / more than 12 positions is a HARD FAILURE.',
  };
```

- [ ] **Step 3: Update the e2e test JSDoc**

In `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts:28-33`, replace:

```ts
 * Mode envelopes (from spec §Step 6):
 *   CONSERVATIVE  count ≤ 5,  equityWeight ≤ 0.30, largestPositionWeight ≤ 0.10
 *   BALANCED      count 5-8,  equityWeight 0.50-0.70, largestPositionWeight ≤ 0.15
 *   AGGRESSIVE    count ≥ 6,  equityWeight ≥ 0.70, largestPositionWeight ≤ 0.25
```

with:

```ts
 * Mode envelopes (from spec §Step 6, clarified 2026-05-06):
 *   CONSERVATIVE  count ≤ 5,  equityWeight ≤ 0.30, largest EQUITY position ≤ 0.10
 *   BALANCED      count 5-8,  equityWeight 0.50-0.70, largest EQUITY position ≤ 0.15
 *   AGGRESSIVE    count ≥ 6,  equityWeight ≥ 0.70, largest EQUITY position ≤ 0.25
 *
 * `largestPositionWeight` constraint applies only to allocations whose
 * assetClass === 'EQUITY' — broad bond ETFs and cash equivalents may exceed
 * the cap because they are diversified by construction.
```

- [ ] **Step 4: Update the e2e test assertion**

In `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts:132`, replace:

```ts
    const largestPositionWeight = Math.max(0, ...packet.proposedTrades.map((t) => (t.targetWeightPercent ?? 0) / 100));
```

with:

```ts
    const equityPositions = packet.proposedTrades.filter((t) => t.assetClass === 'EQUITY');
    const largestPositionWeight = equityPositions.length > 0
      ? Math.max(...equityPositions.map((t) => (t.targetWeightPercent ?? 0) / 100))
      : 0;
```

- [ ] **Step 5: Update the Phase 2 spec envelope reference**

In `docs/superpowers/specs/2026-05-05-operating-mode-phase-2-design.md:149-151`, replace:

```markdown
  - **CONSERVATIVE**: `proposedTrades.length` ≤ 5, `equityWeight` ≤ 0.30, `largestPositionWeight` ≤ 0.10
  - **BALANCED**: `proposedTrades.length` ∈ [5, 8], `equityWeight` ∈ [0.50, 0.70], `largestPositionWeight` ≤ 0.15
  - **AGGRESSIVE**: `proposedTrades.length` ≥ 6, `equityWeight` ≥ 0.70, `largestPositionWeight` ≤ 0.25
```

with:

```markdown
  - **CONSERVATIVE**: `proposedTrades.length` ≤ 5, `equityWeight` ≤ 0.30, largest EQUITY position ≤ 0.10
  - **BALANCED**: `proposedTrades.length` ∈ [5, 8], `equityWeight` ∈ [0.50, 0.70], largest EQUITY position ≤ 0.15
  - **AGGRESSIVE**: `proposedTrades.length` ≥ 6, `equityWeight` ≥ 0.70, largest EQUITY position ≤ 0.25

  > Envelope clarified 2026-05-06 — `largestPositionWeight` reframed as "largest EQUITY position" so the CONSERVATIVE math is satisfiable. See `docs/superpowers/specs/2026-05-06-portfolio-engine-mode-anchored-examples-design.md` § "Root cause 1" for the full reasoning.
```

- [ ] **Step 6: Run portfolio-engine-ctrl unit tests**

Run:

```bash
pnpm nx run portfolio-engine-ctrl:test
```

Expected: all suites green. The schema field rename is a description-only change; existing tests do not assert on the description string.

- [ ] **Step 7: Run portfolio-engine-ctrl lint**

Run:

```bash
pnpm nx run portfolio-engine-ctrl:lint
```

Expected: zero errors.

- [ ] **Step 8: Type-check the e2e-feature-tests project**

Run:

```bash
pnpm nx run e2e-feature-tests:lint
```

Expected: zero errors. The new `equityPositions` variable is correctly typed because `packet.proposedTrades` already declares `assetClass: string`.

- [ ] **Step 9: Commit Fix 1**

```bash
git add services/advisory/portfolio-engine-ctrl/src/agents/schemas.ts \
        services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts \
        apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts \
        docs/superpowers/specs/2026-05-05-operating-mode-phase-2-design.md
git commit -m "$(cat <<'EOF'
fix(advisory): reframe largestPositionWeight as 'largest EQUITY position'

The original 'any-position' semantic made the CONSERVATIVE envelope (count ≤5
+ cap ≤0.10) mathematically unsatisfiable: for N positions summing to 1.0,
min(largestWeight) = 1/N, so 5 positions floor at 0.20 not 0.10. The financial
intent of the cap is single-name equity concentration risk; broad bond/cash
ETFs are diversified by construction and don't carry that risk.

Reframing to 'largest EQUITY position ≤ X' makes the math feasible across all
3 modes and aligns with retail portfolio convention.

Spec: docs/superpowers/specs/2026-05-06-portfolio-engine-mode-anchored-examples-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add per-mode shape constants + builder to `prompts.ts` (TDD, prompts.test.ts is new)

**Files:**
- Create: `services/advisory/portfolio-engine-ctrl/test/unit/prompts.test.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/src/agents/prompts.ts`

This task introduces the per-mode prompt builder. We TDD it because the schema-shape strings are the actual instrument the model anchors on — getting the numbers wrong silently un-does the entire α-tune.

- [ ] **Step 1: Write the failing test file**

Create `services/advisory/portfolio-engine-ctrl/test/unit/prompts.test.ts` with:

```ts
import {
  buildPortfolioConstructionPrompt,
  rebalancePlannerPrompt,
} from '../../src/agents/prompts';

describe('buildPortfolioConstructionPrompt', () => {
  describe('CONSERVATIVE', () => {
    const prompt = buildPortfolioConstructionPrompt('CONSERVATIVE');

    it('embeds the CONSERVATIVE worked example numbers', () => {
      // Worked example shape per spec § "Concrete worked examples".
      // BND 0.50 / SHY 0.30 / VTI 0.10 / IXUS 0.10 → equity 0.20, largest-equity 0.10
      expect(prompt).toContain('"BND"');
      expect(prompt).toContain('"targetWeight": 0.50');
      expect(prompt).toContain('"equityWeight": 0.20');
      expect(prompt).toContain('"largestPositionWeight": 0.10');
    });

    it('rules state the largest EQUITY position cap is 0.10', () => {
      expect(prompt).toMatch(/largest .*EQUITY.*0\.10/);
    });

    it('rules state the position count band is 3 to 5', () => {
      expect(prompt).toMatch(/3 (to|and|-) 5/);
    });

    it('rules state the equityWeight cap is 0.30', () => {
      expect(prompt).toMatch(/equityWeight .* 0\.30/);
    });
  });

  describe('BALANCED', () => {
    const prompt = buildPortfolioConstructionPrompt('BALANCED');

    it('embeds the BALANCED worked example numbers', () => {
      // VTI 0.14 / IXUS 0.14 / QQQ 0.14 / VWO 0.13 / BND 0.27 / SHY 0.18
      // → equity 0.55, largest-equity 0.14, count 6
      expect(prompt).toContain('"QQQ"');
      expect(prompt).toContain('"equityWeight": 0.55');
      expect(prompt).toContain('"largestPositionWeight": 0.14');
    });

    it('rules state the largest EQUITY position cap is 0.15', () => {
      expect(prompt).toMatch(/largest .*EQUITY.*0\.15/);
    });

    it('rules state the equityWeight band is 0.50 to 0.70', () => {
      expect(prompt).toContain('0.50');
      expect(prompt).toContain('0.70');
    });

    it('rules state the position count band is 5 to 8', () => {
      expect(prompt).toMatch(/5 (to|and|-) 8/);
    });
  });

  describe('AGGRESSIVE', () => {
    const prompt = buildPortfolioConstructionPrompt('AGGRESSIVE');

    it('embeds the AGGRESSIVE worked example numbers', () => {
      // VTI 0.20 / VOO 0.18 / QQQ 0.15 / IXUS 0.12 / VWO 0.10 / ARKK 0.10
      // / BND 0.10 / BIL 0.05 → equity 0.85, largest-equity 0.20, count 8
      expect(prompt).toContain('"ARKK"');
      expect(prompt).toContain('"equityWeight": 0.85');
      expect(prompt).toContain('"largestPositionWeight": 0.20');
    });

    it('rules state the largest EQUITY position cap is 0.25', () => {
      expect(prompt).toMatch(/largest .*EQUITY.*0\.25/);
    });

    it('rules state the equityWeight floor is 0.70', () => {
      expect(prompt).toMatch(/equityWeight .* 0\.70/);
    });

    it('rules state the position count band starts at 6', () => {
      expect(prompt).toMatch(/6 (to|and|-) 12/);
    });
  });

  it('rejects unknown modes at compile time', () => {
    // @ts-expect-error — mode parameter is a literal union
    buildPortfolioConstructionPrompt('UNKNOWN');
  });
});

describe('rebalancePlannerPrompt (mode-orthogonal — unchanged by α-tune)', () => {
  it('still exports a single string prompt', () => {
    expect(typeof rebalancePlannerPrompt).toBe('string');
    expect(rebalancePlannerPrompt).toContain('rebalance planning specialist');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm nx run portfolio-engine-ctrl:test --testPathPattern=prompts.test
```

Expected: FAIL with `TypeError: buildPortfolioConstructionPrompt is not a function` (the import doesn't exist yet).

- [ ] **Step 3: Implement the per-mode prompt builder in `prompts.ts`**

Replace the entire contents of `services/advisory/portfolio-engine-ctrl/src/agents/prompts.ts` with:

```ts
import { formatStructuredOutputPrompt } from '@nestfolio/agent-orchestrator';

export type OperatingMode = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

// Per-mode worked example shapes. Numbers are tuned to sit inside their mode
// envelope so the model anchors on a mode-correct shape rather than regressing
// to a BALANCED-shaped output. See spec § "Concrete worked examples" for the
// reasoning behind each example.

const conservativeShape = `{
  "allocations": [
    {
      "instrument": "BND",
      "assetClass": "FIXED_INCOME",
      "targetWeight": 0.50,
      "rationale": "Core aggregate bond ETF for capital preservation"
    },
    {
      "instrument": "SHY",
      "assetClass": "FIXED_INCOME",
      "targetWeight": 0.30,
      "rationale": "Short-duration treasuries — minimal interest-rate sensitivity"
    },
    {
      "instrument": "VTI",
      "assetClass": "EQUITY",
      "targetWeight": 0.10,
      "rationale": "Broad-market US equity for modest growth participation"
    },
    {
      "instrument": "IXUS",
      "assetClass": "EQUITY",
      "targetWeight": 0.10,
      "rationale": "Broad ex-US equity for geographic diversification"
    }
  ],
  "totalExposure": 1.0,
  "equityWeight": 0.20,
  "riskMetrics": {
    "concentrationRisk": 0.10,
    "sectorDiversity": 0.85,
    "largestPositionWeight": 0.10
  },
  "confidence": 0.88
}`;

const balancedShape = `{
  "allocations": [
    {
      "instrument": "VTI",
      "assetClass": "EQUITY",
      "targetWeight": 0.14,
      "rationale": "Core US broad-market equity"
    },
    {
      "instrument": "IXUS",
      "assetClass": "EQUITY",
      "targetWeight": 0.14,
      "rationale": "Broad ex-US equity for geographic diversification"
    },
    {
      "instrument": "QQQ",
      "assetClass": "EQUITY",
      "targetWeight": 0.14,
      "rationale": "Tech tilt within equity sleeve"
    },
    {
      "instrument": "VWO",
      "assetClass": "EQUITY",
      "targetWeight": 0.13,
      "rationale": "Emerging markets equity"
    },
    {
      "instrument": "BND",
      "assetClass": "FIXED_INCOME",
      "targetWeight": 0.27,
      "rationale": "Aggregate bond ETF for income and ballast"
    },
    {
      "instrument": "SHY",
      "assetClass": "FIXED_INCOME",
      "targetWeight": 0.18,
      "rationale": "Short-duration treasuries — interest-rate hedge"
    }
  ],
  "totalExposure": 1.0,
  "equityWeight": 0.55,
  "riskMetrics": {
    "concentrationRisk": 0.18,
    "sectorDiversity": 0.72,
    "largestPositionWeight": 0.14
  },
  "confidence": 0.86
}`;

const aggressiveShape = `{
  "allocations": [
    {
      "instrument": "VTI",
      "assetClass": "EQUITY",
      "targetWeight": 0.20,
      "rationale": "Core US broad-market equity"
    },
    {
      "instrument": "VOO",
      "assetClass": "EQUITY",
      "targetWeight": 0.18,
      "rationale": "S&P 500 — large-cap exposure"
    },
    {
      "instrument": "QQQ",
      "assetClass": "EQUITY",
      "targetWeight": 0.15,
      "rationale": "Nasdaq-100 tech tilt"
    },
    {
      "instrument": "IXUS",
      "assetClass": "EQUITY",
      "targetWeight": 0.12,
      "rationale": "Broad ex-US equity"
    },
    {
      "instrument": "VWO",
      "assetClass": "EQUITY",
      "targetWeight": 0.10,
      "rationale": "Emerging markets equity"
    },
    {
      "instrument": "ARKK",
      "assetClass": "EQUITY",
      "targetWeight": 0.10,
      "rationale": "Disruptive innovation thematic"
    },
    {
      "instrument": "BND",
      "assetClass": "FIXED_INCOME",
      "targetWeight": 0.10,
      "rationale": "Bond ballast for volatility control"
    },
    {
      "instrument": "BIL",
      "assetClass": "CASH",
      "targetWeight": 0.05,
      "rationale": "T-bill ETF — dry powder"
    }
  ],
  "totalExposure": 1.0,
  "equityWeight": 0.85,
  "riskMetrics": {
    "concentrationRisk": 0.22,
    "sectorDiversity": 0.65,
    "largestPositionWeight": 0.20
  },
  "confidence": 0.84
}`;

interface ModeEnvelope {
  readonly schemaShape: string;
  readonly equityRule: string;
  readonly largestEquityRule: string;
  readonly countRule: string;
}

const modeEnvelopes: Record<OperatingMode, ModeEnvelope> = {
  CONSERVATIVE: {
    schemaShape: conservativeShape,
    equityRule: 'equityWeight MUST be ≤ 0.30 (the rest in fixed income / cash).',
    largestEquityRule: 'The largest single EQUITY position (max targetWeight across allocations whose assetClass is EQUITY) MUST be ≤ 0.10. Bond and cash positions may exceed this cap because they are diversified by construction.',
    countRule: 'allocations.length MUST be between 3 and 5 inclusive.',
  },
  BALANCED: {
    schemaShape: balancedShape,
    equityRule: 'equityWeight MUST be in [0.50, 0.70].',
    largestEquityRule: 'The largest single EQUITY position (max targetWeight across allocations whose assetClass is EQUITY) MUST be ≤ 0.15. Bond and cash positions may exceed this cap because they are diversified by construction.',
    countRule: 'allocations.length MUST be between 5 and 8 inclusive.',
  },
  AGGRESSIVE: {
    schemaShape: aggressiveShape,
    equityRule: 'equityWeight MUST be in [0.70, 0.90].',
    largestEquityRule: 'The largest single EQUITY position (max targetWeight across allocations whose assetClass is EQUITY) MUST be ≤ 0.25. Bond and cash positions may exceed this cap because they are diversified by construction.',
    countRule: 'allocations.length MUST be between 6 and 12 inclusive.',
  },
};

export function buildPortfolioConstructionPrompt(mode: OperatingMode): string {
  const env = modeEnvelopes[mode];
  return formatStructuredOutputPrompt({
    role: 'portfolio construction specialist',
    task: `Design target allocations based on the investor profile, risk assessment, and market analysis. The investor is in ${mode} mode — the worked example above and the rules below are tuned to that mode and MUST be honoured. Use fund prospectus and instrument data from the knowledge base when available.`,
    schemaShape: env.schemaShape,
    rules: [
      `OPERATING MODE: ${mode}. ${env.equityRule}`,
      env.largestEquityRule,
      env.countRule,
      'Every allocation MUST include assetClass as one of EQUITY | FIXED_INCOME | REIT | COMMODITY | CASH | CRYPTO | OTHER so the downstream pipeline can derive equity weight from individual positions.',
      'Total of allocations.targetWeight values MUST equal totalExposure (typically 1.0).',
      'equityWeight MUST be the sum of targetWeight across allocations whose assetClass is EQUITY. riskMetrics.largestPositionWeight MUST be the maximum targetWeight across allocations whose assetClass is EQUITY (NOT across all allocations — bond and cash positions are excluded from this metric).',
      'Every allocation MUST include a non-empty rationale string explaining why the position is selected and sized at that weight.',
      'confidence MUST be a number in [0, 1] reflecting the model\'s confidence in this allocation given the investor profile and market analysis.',
    ],
  });
}

const rebalancePlannerSchemaShape = `{
  "trades": [
    {
      "action": "BUY",
      "instrument": "VTI",
      "targetWeight": 0.55,
      "currentWeight": 0.40,
      "quantity": 12,
      "rationale": "Increase US equity exposure to reach target weight"
    },
    {
      "action": "SELL",
      "instrument": "AGG",
      "targetWeight": 0.00,
      "currentWeight": 0.10,
      "quantity": 8,
      "rationale": "Exit overlapping bond fund in favour of BND"
    }
  ],
  "estimatedTurnover": 0.15,
  "confidence": 0.83
}`;

export const rebalancePlannerPrompt = formatStructuredOutputPrompt({
  role: 'rebalance planning specialist',
  task: 'Given current portfolio holdings and target allocations, plan specific trades to reach the target state. Minimise turnover and transaction costs; consider tax-loss harvesting opportunities and trade execution constraints.',
  schemaShape: rebalancePlannerSchemaShape,
  rules: [
    'Every trade MUST include an action of BUY | SELL | REBALANCE.',
    'Every trade MUST include both targetWeight and currentWeight (each a number) so the downstream pipeline can size the order delta.',
    'quantity MAY be null if the lot-level quantity cannot be derived deterministically; in that case the rationale MUST explain why.',
    'Every trade MUST include a non-empty rationale string explaining the trade intent (rebalance, tax-loss, drift correction, etc.).',
    'estimatedTurnover MUST be a number in [0, 1] approximating the fraction of portfolio value moved by the planned trades.',
    'confidence MUST be a number in [0, 1] reflecting the model\'s confidence in this trade plan.',
    'If no trades are required because the portfolio already matches the target, return an empty trades array with estimatedTurnover=0 and a high confidence — but only when current and target allocations match within tolerance.',
  ],
});
```

- [ ] **Step 4: Run the prompts test and verify it passes**

Run:

```bash
pnpm nx run portfolio-engine-ctrl:test --testPathPattern=prompts.test
```

Expected: all assertions PASS.

- [ ] **Step 5: Run the full portfolio-engine-ctrl unit suite**

Run:

```bash
pnpm nx run portfolio-engine-ctrl:test
```

Expected: all suites green. (Tasks 3 and 4 will fix consumers of the removed `portfolioConstructionPrompt` export — until then this step may surface compile errors in `portfolio-construction.config.ts`. If so, that's the expected breakage; proceed to Task 3.)

- [ ] **Step 6: Commit Task 2**

```bash
git add services/advisory/portfolio-engine-ctrl/src/agents/prompts.ts \
        services/advisory/portfolio-engine-ctrl/test/unit/prompts.test.ts
git commit -m "$(cat <<'EOF'
feat(advisory): add per-mode prompt builder for portfolio-construction

buildPortfolioConstructionPrompt(mode) replaces the single mode-agnostic
prompt with three mode-specific worked examples. Schema-example shape is
the dominant anchor for Bedrock structured-output models; mode-correct
example numbers stop the model from regressing to a BALANCED-shaped output
regardless of mode.

rebalancePlannerPrompt unchanged — turnover minimization is mode-orthogonal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Replace `portfolioConstructionConfig` constant with `buildPortfolioConstructionConfig(mode)` factory

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config.ts`

This is a surgical 5-line file change that wires the new `buildPortfolioConstructionPrompt` into a per-mode `AgentConfig`.

- [ ] **Step 1: Replace the constant export with a factory**

Replace the entire contents of `services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config.ts` with:

```ts
import type { AgentConfig } from '@nestfolio/agent-orchestrator';
import { PortfolioConstructionSchema } from './schemas';
import { buildPortfolioConstructionPrompt, type OperatingMode } from './prompts';

export function buildPortfolioConstructionConfig(
  mode: OperatingMode,
): AgentConfig<typeof PortfolioConstructionSchema> {
  return {
    modelId: 'us.anthropic.claude-opus-4-6-v1',
    maxTokens: 4096,
    temperature: 0.1,
    schema: PortfolioConstructionSchema,
    promptTemplate: buildPortfolioConstructionPrompt(mode),
  };
}
```

- [ ] **Step 2: Run the type-check and unit suite**

Run:

```bash
pnpm nx run portfolio-engine-ctrl:test
```

Expected: graph.test.ts may still fail because it imports `portfolioConstructionConfig` (constant) via `agents/portfolio-engine/graph.ts`. Note any failures — Task 4 is the fix. Other suites (prompts.test, schemas, etc.) green.

- [ ] **Step 3: Commit Task 3**

```bash
git add services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config.ts
git commit -m "$(cat <<'EOF'
feat(advisory): buildPortfolioConstructionConfig(mode) factory

AgentConfig now built per mode via the buildPortfolioConstructionPrompt
factory landed in the previous commit. Co-located with the prompt because
the two move together — graph.ts (next commit) consumes both.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Lazy per-mode orchestrator with cache in `agents/portfolio-engine/graph.ts`

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/test/unit/graph.test.ts`

This is the largest behavioral change of the plan. We move `createOrchestrator` from module-load to lazy per-mode invocation, cached in a `Map`. The 3-test suite update is paired into the same task because the failing tests gate the implementation.

- [ ] **Step 1: Update graph.test.ts to drive `invokePortfolioEngine` for the orchestrator-shape assertion + add a cache-reuse test**

Replace `services/advisory/portfolio-engine-ctrl/test/unit/graph.test.ts` with:

```ts
// services/advisory/portfolio-engine-ctrl/test/unit/graph.test.ts
const mockCreateOrchestrator = jest.fn();
const mockInvokeOrchestrator = jest.fn();
const mockKBRetrieve = jest.fn();
const mockMemorySession = {
  writeAgentOutput: jest.fn(),
  readUpstreamOutput: jest.fn().mockResolvedValue([]),
  searchLongTermMemory: jest.fn().mockResolvedValue([]),
};

jest.mock('@nestfolio/agent-orchestrator', () => ({
  createOrchestrator: mockCreateOrchestrator,
  invokeOrchestrator: mockInvokeOrchestrator,
  createKBClient: jest.fn().mockReturnValue({ retrieve: mockKBRetrieve }),
  createMemoryClient: jest.fn().mockReturnValue({
    openDecisionSession: jest.fn().mockReturnValue(mockMemorySession),
  }),
  createNoOpMemoryClient: jest.fn().mockReturnValue({
    openDecisionSession: jest.fn().mockReturnValue(mockMemorySession),
  }),
  formatStructuredOutputPrompt: jest.requireActual('@nestfolio/agent-orchestrator').formatStructuredOutputPrompt,
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({}) },
}));

jest.mock('../../src/agents/tools/portfolio-lookup', () => ({
  createPortfolioLookup: jest.fn().mockReturnValue(async () => null),
}));

describe('portfolio-engine-ctrl orchestrator graph', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateOrchestrator.mockReturnValue({ invoke: jest.fn() });
    mockInvokeOrchestrator.mockResolvedValue({
      'portfolio-construction': { allocations: [] },
      'rebalance-planner': { trades: [] },
    });
    process.env['KNOWLEDGE_BASE_ID'] = 'kb-test';
    process.env['MEMORY_ID'] = 'mem-test';
    process.env['TABLE_NAME'] = 'test-table';
  });
  afterEach(() => {
    delete process.env['KNOWLEDGE_BASE_ID'];
    delete process.env['MEMORY_ID'];
    delete process.env['TABLE_NAME'];
  });

  it('builds an orchestrator with 2 parallel agents on first invocation', async () => {
    mockKBRetrieve.mockResolvedValue([]);

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/portfolio-engine/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({ tenantId: 't1', decisionId: 'd1', upstreamOutputs: {} });

    expect(mockCreateOrchestrator).toHaveBeenCalledTimes(1);
    const config = mockCreateOrchestrator.mock.calls[0][0];
    expect(Object.keys(config.agents)).toEqual(['portfolio-construction', 'rebalance-planner']);
    expect(config.waves).toHaveLength(1);
    expect(config.waves[0].agents).toEqual(['portfolio-construction', 'rebalance-planner']);
  });

  it('caches the orchestrator per mode — same mode invoked twice rebuilds once', async () => {
    mockKBRetrieve.mockResolvedValue([]);

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/portfolio-engine/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({
      tenantId: 't1', decisionId: 'd1',
      upstreamOutputs: { operatingMode: 'CONSERVATIVE' },
    });
    await invokePortfolioEngine!({
      tenantId: 't1', decisionId: 'd2',
      upstreamOutputs: { operatingMode: 'CONSERVATIVE' },
    });

    expect(mockCreateOrchestrator).toHaveBeenCalledTimes(1);
  });

  it('builds a separate orchestrator per mode', async () => {
    mockKBRetrieve.mockResolvedValue([]);

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/portfolio-engine/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({
      tenantId: 't1', decisionId: 'd1',
      upstreamOutputs: { operatingMode: 'CONSERVATIVE' },
    });
    await invokePortfolioEngine!({
      tenantId: 't1', decisionId: 'd2',
      upstreamOutputs: { operatingMode: 'AGGRESSIVE' },
    });

    expect(mockCreateOrchestrator).toHaveBeenCalledTimes(2);
  });

  it('invokePortfolioEngine enriches input with KB context', async () => {
    mockKBRetrieve.mockResolvedValue([
      { text: 'VTI expense ratio 0.03%, tracks CRSP Total Market', score: 0.9 },
    ]);

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/portfolio-engine/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({ tenantId: 't1', decisionId: 'd1', upstreamOutputs: {} });

    expect(mockKBRetrieve).toHaveBeenCalled();
    expect(mockInvokeOrchestrator).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ input: expect.stringContaining('VTI expense ratio') }),
      undefined,
    );
  });

  it('invokePortfolioEngine injects portfolio snapshot into enriched input', async () => {
    mockKBRetrieve.mockResolvedValue([]);

    const snapshot = {
      tenantId: 't1',
      snapshot: { totalValue: 50000, holdings: [{ instrument: 'VTI', weight: 0.6 }] },
    };

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      jest.doMock('../../src/agents/tools/portfolio-lookup', () => ({
        createPortfolioLookup: () => async () => snapshot,
      }));
      const mod = require('../../agents/portfolio-engine/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({ tenantId: 't1', decisionId: 'd1', upstreamOutputs: {} });

    const passedInput = mockInvokeOrchestrator.mock.calls[0][1].input as string;
    expect(passedInput).toContain('Portfolio snapshot:');
    expect(passedInput).toContain('"totalValue": 50000');
  });

  it('writes output to memory when every wave-node entry is ok:true', async () => {
    mockKBRetrieve.mockResolvedValue([]);
    mockInvokeOrchestrator.mockResolvedValue({
      'portfolio-construction': { ok: true, output: { allocations: [{ instrument: 'VTI' }] } },
      'rebalance-planner': { ok: true, output: { trades: [] } },
    });

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/portfolio-engine/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({ tenantId: 't1', decisionId: 'd1', upstreamOutputs: {} });

    expect(mockMemorySession.writeAgentOutput).toHaveBeenCalledWith({
      'portfolio-construction': { allocations: [{ instrument: 'VTI' }] },
      'rebalance-planner': { trades: [] },
    });
  });

  it('skips Memory write when any wave-node entry is ok:false (Phase β fail-fast)', async () => {
    mockKBRetrieve.mockResolvedValue([]);
    mockInvokeOrchestrator.mockResolvedValue({
      'portfolio-construction': { ok: true, output: { allocations: [{ instrument: 'VTI' }] } },
      'rebalance-planner': { ok: false, reason: 'Error: timeout', fallback: { trades: [] } },
    });

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/portfolio-engine/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({ tenantId: 't1', decisionId: 'd1', upstreamOutputs: {} });

    expect(mockMemorySession.writeAgentOutput).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
pnpm nx run portfolio-engine-ctrl:test --testPathPattern=graph.test
```

Expected: FAIL — `graph.ts` still imports the removed `portfolioConstructionConfig` constant; the new lazy/cached orchestrator construction does not exist.

- [ ] **Step 3: Restructure graph.ts to lazy per-mode orchestrator with cache**

Replace `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts` with:

```ts
// services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts
import {
  createOrchestrator,
  invokeOrchestrator,
  createKBClient,
  createMemoryClient,
  createNoOpMemoryClient,
  type AgentInvocation,
  type CompiledGraph,
  type KBClient,
  type MemoryClient,
  type TraceEmitter,
} from '@nestfolio/agent-orchestrator';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createPortfolioLookup } from '../../src/agents/tools/portfolio-lookup';
import { formatToolContext } from '../../src/agents/tools/format-context';
import { buildPortfolioConstructionConfig } from '../../src/agents/portfolio-construction.config';
import { rebalancePlannerConfig } from '../../src/agents/rebalance-planner.config';
import { portfolioValidationRule, rebalanceValidationRule } from '../../src/agents/validation';
import { portfolioConstructionFallback, rebalancePlannerFallback } from '../../src/agents/fallbacks';
import { PortfolioEngineState } from '../../src/agents/state';
import type { OperatingMode } from '../../src/agents/prompts';

const graphCache = new Map<OperatingMode, CompiledGraph>();

function getGraphForMode(mode: OperatingMode): CompiledGraph {
  const cached = graphCache.get(mode);
  if (cached) return cached;
  const built = createOrchestrator({
    agents: {
      'portfolio-construction': buildPortfolioConstructionConfig(mode),
      'rebalance-planner': rebalancePlannerConfig,
    },
    waves: [
      { agents: ['portfolio-construction', 'rebalance-planner'] },
    ],
    stateAnnotation: PortfolioEngineState,
    validationRules: {
      'portfolio-construction': portfolioValidationRule,
      'rebalance-planner': rebalanceValidationRule,
    },
    fallbacks: {
      'portfolio-construction': portfolioConstructionFallback,
      'rebalance-planner': rebalancePlannerFallback,
    },
    retryOptions: { maxAttempts: 3 },
  });
  graphCache.set(mode, built);
  return built;
}

function buildKBClient(): KBClient | null {
  const kbId = process.env['KNOWLEDGE_BASE_ID'];
  if (!kbId) return null;
  return createKBClient({ knowledgeBaseId: kbId, region: process.env['AWS_REGION'] ?? 'us-east-1' });
}

function buildMemoryClient(): MemoryClient {
  const memoryId = process.env['MEMORY_ID'];
  if (!memoryId) return createNoOpMemoryClient();
  return createMemoryClient({
    memoryId,
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    serviceName: 'portfolio-engine-ctrl',
  });
}

function buildTools() {
  const tableName = process.env['TABLE_NAME'];
  if (!tableName) throw new Error('TABLE_NAME is required for portfolio-engine tools');
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return {
    portfolioLookup: createPortfolioLookup({ docClient, tableName }),
  };
}

const tools = buildTools();

export async function invokePortfolioEngine(
  payload: AgentInvocation,
  emitter?: TraceEmitter,
): Promise<Record<string, unknown>> {
  const memory = buildMemoryClient();
  const session = memory.openDecisionSession(payload.tenantId, payload.decisionId);
  const kb = buildKBClient();

  const seed = JSON.stringify(payload.upstreamOutputs);
  let kbContext = '';
  if (kb) {
    const kbResults = await kb.retrieve(seed, 5);
    if (kbResults.length > 0) {
      kbContext = `\n\nFund & instrument data from knowledge base:\n${kbResults.map((r) => r.text).join('\n')}`;
    }
  }

  const upstreamRecords = await session.readUpstreamOutput('advisory-ctrl');
  const upstreamContext = upstreamRecords.length > 0
    ? `\n\nUpstream context:\n${upstreamRecords.map((r) => r.content).join('\n')}`
    : '';

  const portfolioSnapshot = await tools.portfolioLookup({ tenantId: payload.tenantId });
  const toolContext = formatToolContext({ 'Portfolio snapshot': portfolioSnapshot });

  // Detect operating mode and select the per-mode orchestrator. The
  // mode-specific worked example baked into each orchestrator's
  // portfolio-construction prompt is the dominant anchor for Bedrock
  // structured-output models — so the modeContext rules below are now
  // belt-and-braces rather than load-bearing. See
  // docs/superpowers/specs/2026-05-06-portfolio-engine-mode-anchored-examples-design.md.
  const upstreams = (payload.upstreamOutputs ?? {}) as Record<string, unknown>;
  const investorProfile = (upstreams['investorProfile'] as Record<string, unknown> | undefined) ?? {};
  const operatingModeRaw = (upstreams['operatingMode'] as string)
    ?? (investorProfile['operatingMode'] as string)
    ?? 'BALANCED';
  const operatingMode: OperatingMode =
    operatingModeRaw === 'CONSERVATIVE' || operatingModeRaw === 'AGGRESSIVE'
      ? operatingModeRaw
      : 'BALANCED';

  const modeGuidance: Record<OperatingMode, string> = {
    CONSERVATIVE: 'OPERATING MODE: CONSERVATIVE. THESE ARE HARD RULES FOR THIS INVOCATION — every clause MUST be honoured exactly. (1) equityWeight MUST be ≤ 0.30 (the rest in fixed income / cash). (2) the largest single EQUITY position (max targetWeight across allocations whose assetClass is EQUITY) MUST be ≤ 0.10 — bond and cash positions may be larger. (3) allocations.length MUST be between 3 and 5 inclusive. (4) Prefer broad-market ETFs over single names. (5) Prioritise capital preservation over growth. Producing equityWeight > 0.30, an equity position > 10%, or fewer than 3 / more than 5 positions is a HARD FAILURE.',
    BALANCED: 'OPERATING MODE: BALANCED. THESE ARE HARD RULES FOR THIS INVOCATION — every clause MUST be honoured exactly. (1) equityWeight MUST be in [0.50, 0.70]. (2) the largest single EQUITY position (max targetWeight across allocations whose assetClass is EQUITY) MUST be ≤ 0.15 — bond and cash positions may be larger. (3) allocations.length MUST be between 5 and 8 inclusive. (4) Mix broad ETFs with measured sector tilts. (5) Balance growth and stability. Producing equityWeight outside [0.50, 0.70], an equity position > 15%, or fewer than 5 / more than 8 positions is a HARD FAILURE.',
    AGGRESSIVE: 'OPERATING MODE: AGGRESSIVE. THESE ARE HARD RULES FOR THIS INVOCATION — every clause MUST be honoured exactly. (1) equityWeight MUST be in [0.70, 0.90]. (2) the largest single EQUITY position (max targetWeight across allocations whose assetClass is EQUITY) MUST be ≤ 0.25 — bond and cash positions may be larger. (3) allocations.length MUST be between 6 and 12 inclusive. (4) Sector and thematic concentrations allowed. (5) Prioritise long-term growth and accept higher volatility. Producing equityWeight outside [0.70, 0.90], an equity position > 25%, or fewer than 6 / more than 12 positions is a HARD FAILURE.',
  };
  const modeContext = `\n\n${modeGuidance[operatingMode]}\n` +
    `Reflect adherence in your output: PortfolioConstruction.equityWeight, PortfolioConstruction.riskMetrics.largestPositionWeight, allocations.length must all fall within the envelope above. ` +
    `Each allocation MUST include assetClass (EQUITY | FIXED_INCOME | REIT | COMMODITY | CASH | CRYPTO | OTHER) so the downstream pipeline can derive equity weight from individual positions. ` +
    `Compute equityWeight as the sum of targetWeight across allocations whose assetClass is EQUITY; compute riskMetrics.largestPositionWeight as the maximum targetWeight across allocations whose assetClass is EQUITY (NOT across all allocations).`;

  const graph = getGraphForMode(operatingMode);
  const enrichedInput = `Decision ${payload.decisionId} context: ${seed}` + modeContext + kbContext + upstreamContext + toolContext;
  const result = await invokeOrchestrator(
    graph,
    { input: enrichedInput },
    emitter
      ? {
          agent: 'portfolio-engine',
          correlationId: payload.decisionId,
          tenantId: payload.tenantId,
          emitter,
        }
      : undefined,
  );

  // Persist to memory — Phase β (Spec 4, 2026-05-06): only write when every
  // agent's wave-node entry is `ok: true`. A partial-degraded cycle no longer
  // poisons AgentCore Memory for downstream agents. The discriminant is
  // stripped before writing because Memory consumers expect raw outputs.
  if (!('serviceUnavailable' in result)) {
    const entries = Object.entries(result);
    const allOk = entries.every(
      ([, v]) => typeof v === 'object' && v !== null && (v as { ok?: boolean }).ok === true,
    );
    if (allOk) {
      const stripped = Object.fromEntries(
        entries.map(([k, v]) => [k, (v as { output: Record<string, unknown> }).output]),
      );
      await session.writeAgentOutput(stripped);
    }
  }

  return result;
}
```

Note the `export { graph };` line from the previous version is intentionally removed — `test/unit/graph.test.ts` accesses only `mod.invokePortfolioEngine` (verified via grep before this plan was written).

- [ ] **Step 4: Run the test and confirm it passes**

Run:

```bash
pnpm nx run portfolio-engine-ctrl:test --testPathPattern=graph.test
```

Expected: all 7 assertions PASS.

- [ ] **Step 5: Run the full portfolio-engine-ctrl unit + lint suite**

Run:

```bash
pnpm nx run portfolio-engine-ctrl:test && pnpm nx run portfolio-engine-ctrl:lint
```

Expected: all suites green, zero lint violations.

- [ ] **Step 6: Commit Task 4**

```bash
git add services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts \
        services/advisory/portfolio-engine-ctrl/test/unit/graph.test.ts
git commit -m "$(cat <<'EOF'
feat(advisory): lazy per-mode portfolio-engine orchestrator with cache

Build the orchestrator lazily inside getGraphForMode(mode), cached in a
Map<OperatingMode, CompiledGraph> at module scope (3 graphs ever; Opus
rebalance-planner stays constant). The mode-specific worked example baked
into each orchestrator's portfolio-construction prompt is now the dominant
anchor for the Bedrock model — so the modeContext rules in the enriched
input become belt-and-braces rather than load-bearing.

Also: upgrades the modeGuidance rules in graph.ts to match the equity-only
largestPositionWeight semantic established in the previous Fix 1 commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Validation gate — deploy and run e2e

This task contains no code changes; it is the validation contract for the spec's "done-when". Run sequentially.

- [ ] **Step 1: Run lint + unit + integration smoke for the affected projects**

Run:

```bash
pnpm nx affected -t test lint --base=HEAD~5
```

Expected: all green. The integration suite for portfolio-engine-ctrl has not been touched by this workstream and should pass against deployed dev unchanged.

- [ ] **Step 2: Build the AgentRuntime bundle**

Run:

```bash
pnpm nx run portfolio-engine-ctrl:build-agent
```

Expected: produces `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/dist/bundle.js`. Bundle warnings about Bedrock SDKs are normal and may be ignored.

- [ ] **Step 3: Deploy portfolio-engine-ctrl to dev**

Run:

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=portfolio-engine-ctrl
```

Expected: CDK synth + ARM64 Docker build for the AgentCore Runtime + CloudFormation update of `dev-portfolio-engine-ctrl` stack. Watch for the AgentCore Runtime version bump in the output.

- [ ] **Step 4: Run the operating-mode e2e gate (single-shot)**

Run:

```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev \
  pnpm nx run e2e-feature-tests:test-e2e-features \
  --testPathPatterns=operating-mode-recommendation-shape
```

Expected outcome:
- `agents respect CONSERVATIVE envelope`: PASS — count ≤ 5, equityWeight ≤ 0.30, largest equity position ≤ 0.10.
- `agents respect AGGRESSIVE envelope`: PASS — count ≥ 6, equityWeight ≥ 0.70, largest equity position ≤ 0.25.
- `agents respect BALANCED envelope`: TIMEOUT (out of scope — Vestigial MemoryStrategy entry, `docs/BACKLOG.md:67`).

Per spec § Validation gate: if a tail-mode flake on the first run, re-run once before declaring failure. Two consecutive failures of CONSERVATIVE or AGGRESSIVE → escalate by promoting Approach B from PARKING LOT (mode-aware validation rule + retry-feedback loop).

- [ ] **Step 5: Update BACKLOG ACTIVE → Recently shipped on success**

If Steps 1-4 succeed, update `docs/BACKLOG.md`:
- Move the `[α-tune]` block from `## ACTIVE` to the `## Recently shipped` table with the commit SHA range and gate result (e.g., "CONSERVATIVE PASS, AGGRESSIVE PASS, BALANCED OOS-blocked").
- Empty the ACTIVE section and add a one-line `Updated YYYY-MM-DD (α-tune SHIPPED): ...` header note.
- Promote the operating-mode Phase 2 status in user memory `MEMORY.md` from SHIPPED-PENDING-VALIDATION to SHIPPED.

- [ ] **Step 6: Commit BACKLOG closure**

```bash
git add docs/BACKLOG.md
git commit -m "$(cat <<'EOF'
docs(backlog): ship α-tune portfolio-engine mode-anchored examples

E2E gate: CONSERVATIVE PASS + AGGRESSIVE PASS against deployed dev.
BALANCED out-of-scope blocked on Vestigial MemoryStrategy (separately filed).
Operating Mode Phase 2 promoted SHIPPED-PENDING-VALIDATION → SHIPPED.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist (run after plan complete)

- **Spec coverage:** Fix 1 (envelope clarification) covered by Task 1; Fix 2 (per-mode prompts + cached orchestrator) covered by Tasks 2-4; validation gate covered by Task 5. All seven file changes from the spec's "Code changes" section are addressed.
- **Placeholder scan:** None. Every code step shows actual code; every test shows actual assertions; every command shows expected output.
- **Type consistency:** `OperatingMode` is exported from `prompts.ts` (Task 2 Step 3) and imported by `portfolio-construction.config.ts` (Task 3) and `graph.ts` (Task 4). `buildPortfolioConstructionPrompt(mode)` and `buildPortfolioConstructionConfig(mode)` accept the same union type. The cache map key type matches.
- **Test references:** `prompts.test.ts` is created in Task 2; `graph.test.ts` is rewritten in Task 4 (paired with the implementation that gates it). No test references a symbol defined later in the plan.
