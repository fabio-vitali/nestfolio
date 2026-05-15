# ledger-ctrl simulated `ProposedTrade.quantity` alignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align ledger-ctrl's `ProposedTrade` reader with the canonical `proposedTrades[].quantityOrAmountCents` wire shape emitted by `decision-workflow-ctrl/assemble-packet.ts`, eliminating the 100% failure rate on simulated ORDER_FILLED writes.

**Architecture:** Two-file change in ledger-ctrl plus its tests. `ShadowFillService.simulateFill` derives a share count from the amount-in-cents and the per-share fill price (`derivedQuantity = (amountCents / 100) / fillPrice`) and returns it alongside `price`/`totalValue`. `event-listener.processSimulationEvent` reads `trade.quantityOrAmountCents`, writes the LedgerEntry payload with the derived `quantity` AND the source `amountCents` (audit trail). No producer changes (compliance-ctrl, assemble-packet, e2e fixtures all stay on the canonical shape they already publish).

**Tech Stack:** TypeScript, AWS Lambda, `@aws-sdk/client-dynamodb`, `@nestfolio/event-processor`, Jest. Tests via `pnpm nx test ledger-ctrl`.

---

## Out of scope

- Renaming `quantityOrAmountCents` to something cleaner like `amountCents` or splitting into a discriminated union (`{ quantity } | { amountCents }`). That is a cross-domain refactor touching 5+ services — distinct backlog item if surfaced.
- Adding an e2e assertion on simulated portfolios (`getSimulationComparison`). The current scenario suite doesn't exercise simulated-portfolio reads; this fix focuses on closing the 100% failure rate, not adding new coverage.
- Touching the `actual` stream path. `processActualEvent` reads `quantity` directly from broker fill events (literal `quantity: 10` in the test fixture and broker-sim adapter outputs), and is already healthy (~96% success rate excluding test-noise).
- Defensive `marshallOptions.removeUndefinedValues: true` on the DDB client. That would mask future schema drifts; the right defense is to type the consumer correctly. Leave the client strict.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `services/ledger/ledger-ctrl/src/services/shadow-fill.service.ts` | Modify | Rename `ProposedTrade.quantity` → `quantityOrAmountCents`. Add `derivedQuantity` to `FillResult` and compute it inside `simulateFill`. |
| `services/ledger/ledger-ctrl/src/handlers/event-listener.ts` | Modify | `processSimulationEvent` reads `trade.quantityOrAmountCents` and writes LedgerEntry payload with `quantity: fillResult.derivedQuantity` and `amountCents: trade.quantityOrAmountCents`. No actual-path change. |
| `services/ledger/ledger-ctrl/test/unit/services/shadow-fill.service.test.ts` | Create | Direct unit coverage on `simulateFill` for: derivedQuantity rounding semantics, fillPrice=fallback price (100.0), and the new return shape. |
| `services/ledger/ledger-ctrl/test/unit/handlers/event-listener.test.ts` | Modify | Update existing DECISION_PACKET_CREATED test fixtures from `quantity: 10` → `quantityOrAmountCents: NNN` and add assertions that the written LedgerEntry payload contains both `quantity` (derived) and `amountCents` (source). |

---

## Task 0: Workspace setup + clean baseline

**Files:** none

- [ ] **Step 0.1: Install dependencies in the worktree**

The worktree was created fresh; `node_modules` is empty. pnpm needs to wire workspace packages.

Run: `pnpm install --frozen-lockfile`
Expected: Lockfile not modified; install completes; `node_modules/` populated.

- [ ] **Step 0.2: Run ledger-ctrl test baseline**

Run: `pnpm nx test ledger-ctrl --skipNxCache`
Expected: ALL PASS. (If any pre-existing failure surfaces, STOP and report — do not bundle unrelated fixes into this workstream.)

- [ ] **Step 0.3: Confirm bug is reproducible by reading the failing test inputs**

Run: `grep -n "quantity: 10" services/ledger/ledger-ctrl/test/unit/handlers/event-listener.test.ts | head -3`
Expected: 3 hits at lines 142, 177, 193 — these are the simulation-path test fixtures that today encode the broken `quantity` shape and therefore mask the production bug.

No commit on this task.

---

## Task 1: ShadowFillService — TDD the derivedQuantity behavior

**Files:**
- Create: `services/ledger/ledger-ctrl/test/unit/services/shadow-fill.service.test.ts`
- Modify: `services/ledger/ledger-ctrl/src/services/shadow-fill.service.ts`

- [ ] **Step 1.1: Write the failing test file**

Create `services/ledger/ledger-ctrl/test/unit/services/shadow-fill.service.test.ts` with:

```ts
import { ShadowFillService, type ProposedTrade } from '../../../src/services/shadow-fill.service';

describe('ShadowFillService', () => {
  const service = new ShadowFillService();

  it('reads quantityOrAmountCents and returns derivedQuantity = amount / fillPrice', async () => {
    // VTI fallback price is 100.0; 500_000 cents = $5_000 → 50 shares
    const trade: ProposedTrade = {
      symbol: 'VTI',
      side: 'BUY',
      quantityOrAmountCents: 500_000,
    };
    const result = await service.simulateFill(trade);
    expect(result.price).toBe(100.0);
    expect(result.derivedQuantity).toBe(50);
    expect(result.totalValue).toBeCloseTo(5_000, 5);
  });

  it('handles fractional shares without losing the source amount', async () => {
    // 333_333 cents = $3_333.33 → 33.3333 shares at $100
    const trade: ProposedTrade = { symbol: 'UNKNOWN', side: 'BUY', quantityOrAmountCents: 333_333 };
    const result = await service.simulateFill(trade);
    expect(result.price).toBe(100.0);
    expect(result.derivedQuantity).toBeCloseTo(33.3333, 4);
  });
});
```

- [ ] **Step 1.2: Run the test and confirm it fails**

Run: `pnpm nx test ledger-ctrl --skipNxCache --testPathPatterns=shadow-fill.service`
Expected: FAIL — TypeScript compile error on `quantityOrAmountCents` (current type has `quantity`) AND on `result.derivedQuantity` (current return type lacks it).

- [ ] **Step 1.3: Update `shadow-fill.service.ts` to match**

Edit `services/ledger/ledger-ctrl/src/services/shadow-fill.service.ts` to:

```ts
import { StaticMarketDataProvider, CachedMarketDataProvider, type MarketDataProvider } from '@nestfolio/event-processor';

const provider: MarketDataProvider = new CachedMarketDataProvider(
  new StaticMarketDataProvider(),
  60_000,
);

export interface ProposedTrade {
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly quantityOrAmountCents: number;
}

export interface FillResult {
  readonly price: number;
  readonly derivedQuantity: number;
  readonly totalValue: number;
}

export class ShadowFillService {
  async simulateFill(trade: ProposedTrade): Promise<FillResult> {
    const price = await this.getPrice(trade.symbol);
    const totalValue = trade.quantityOrAmountCents / 100;
    const derivedQuantity = totalValue / price;
    return { price, derivedQuantity, totalValue };
  }

  async getPrice(symbol: string): Promise<number> {
    const quote = await provider.getQuote(symbol);
    return quote?.price ?? 100.0;
  }
}
```

- [ ] **Step 1.4: Run the test and confirm it passes**

Run: `pnpm nx test ledger-ctrl --skipNxCache --testPathPatterns=shadow-fill.service`
Expected: 2 PASS.

- [ ] **Step 1.5: Commit**

```bash
git add services/ledger/ledger-ctrl/src/services/shadow-fill.service.ts services/ledger/ledger-ctrl/test/unit/services/shadow-fill.service.test.ts
git commit -m "$(cat <<'EOF'
fix(ledger-ctrl): align ShadowFillService.ProposedTrade with canonical quantityOrAmountCents wire shape

Add derivedQuantity to FillResult, computed as (amountCents / 100) / fillPrice.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: event-listener.processSimulationEvent — TDD the integration

**Files:**
- Modify: `services/ledger/ledger-ctrl/test/unit/handlers/event-listener.test.ts`
- Modify: `services/ledger/ledger-ctrl/src/handlers/event-listener.ts`

- [ ] **Step 2.1: Update the existing simulation fixtures to the canonical shape**

In `services/ledger/ledger-ctrl/test/unit/handlers/event-listener.test.ts` change every occurrence of:

```ts
{ symbol: 'VTI', side: 'BUY', quantity: 10 },
{ symbol: 'SPY', side: 'BUY', quantity: 5 },
```

to:

```ts
{ symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 100_000 },  // $1_000 → 10 shares at $100
{ symbol: 'SPY', side: 'BUY', quantityOrAmountCents:  50_000 },  // $500   → 5  shares at $100
```

Then locate the assertions on the persisted LedgerEntry from the simulation path (around lines 145-170, 180+). For at least one DECISION_PACKET_CREATED test, ADD assertions that the persisted payload contains both `quantity` (derived) and `amountCents` (source). Use the existing repository fake or putLedgerEntry spy.

If the test currently asserts `payload.quantity === 10`, change to:

```ts
expect(written.payload.quantity).toBe(10);          // derived from 100_000 cents / $100/share
expect(written.payload.amountCents).toBe(100_000);  // audit trail of source
```

- [ ] **Step 2.2: Run tests, confirm they fail**

Run: `pnpm nx test ledger-ctrl --skipNxCache --testPathPatterns=handlers/event-listener`
Expected: FAIL — the production handler still reads `trade.quantity` and writes that single field, so the new `amountCents` assertion fails and `payload.quantity` is `undefined`.

- [ ] **Step 2.3: Update `event-listener.ts` `processSimulationEvent`**

In `services/ledger/ledger-ctrl/src/handlers/event-listener.ts`, replace the `for (const trade of proposedTrades)` block (currently lines ~85-109) with:

```ts
for (const trade of proposedTrades) {
  const fillResult = await deps.shadowFill.simulateFill(trade);
  const sequenceNo = await deps.repository.nextSequence(ctx.tenantId, 'simulated');

  const created = await deps.repository.putLedgerEntry({
    streamType: 'simulated',
    eventId: `${ctx.eventId}-sim-${trade.symbol}`,
    eventType: ExecutionCrossDomainEventTypes.ORDER_FILLED,
    payload: {
      orderId: `sim-${decisionPacketId}-${trade.symbol}`,
      symbol: trade.symbol,
      side: trade.side,
      quantity: fillResult.derivedQuantity,
      amountCents: trade.quantityOrAmountCents,
      fillPrice: fillResult.price,
      filledAt: now,
    },
    timestamp: now,
    sequenceNo,
    decisionId: decisionPacketId,
  }, pickRequestContext(ctx));

  if (!created) {
    logger.info('Duplicate simulation entry, skipping', { symbol: trade.symbol, eventId: ctx.eventId });
    continue;
  }
}
```

- [ ] **Step 2.4: Run tests, confirm they pass**

Run: `pnpm nx test ledger-ctrl --skipNxCache --testPathPatterns=handlers/event-listener`
Expected: ALL PASS.

- [ ] **Step 2.5: Commit**

```bash
git add services/ledger/ledger-ctrl/src/handlers/event-listener.ts services/ledger/ledger-ctrl/test/unit/handlers/event-listener.test.ts
git commit -m "$(cat <<'EOF'
fix(ledger-ctrl): processSimulationEvent reads quantityOrAmountCents, persists derived quantity + source amountCents

Resolves the 100% marshaller-failure rate on simulated ORDER_FILLED writes; trade.quantity was always undefined when reading the canonical advisory wire shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Regression sweep

**Files:** none

- [ ] **Step 3.1: Run the full ledger-ctrl test suite**

Run: `pnpm nx test ledger-ctrl --skipNxCache`
Expected: ALL PASS (no regressions in domain/, repositories/, transforms/, snapshot-publisher, tax-lot-manager).

- [ ] **Step 3.2: Run TypeScript check on the worktree**

Run: `pnpm nx run ledger-ctrl:typecheck` (or fallback: `pnpm nx build ledger-ctrl`)
Expected: 0 errors. If the project lacks a `typecheck` target, use `build` — it surfaces `tsc --noEmit`-class errors via esbuild's type-only pass.

- [ ] **Step 3.3: Search for any other `ProposedTrade.quantity` reader**

Run: `grep -rn "ProposedTrade\|trade\\.quantity" services/ledger 2>&1 | grep -v "trade\\.quantityOrAmountCents\|fillResult\\.derivedQuantity"`
Expected: No hits. Any hit means a reader still expects the old shape and must be fixed in this task (do NOT defer).

No commit on this task.

---

## Task 4: Deploy + CloudWatch validation

**Files:** none

- [ ] **Step 4.1: Capture pre-deploy baseline error count**

Run:

```bash
END=$(date +%s)000; START=$(($END - 1800000))
AWS_PROFILE=nestfolio-dev aws logs filter-log-events \
  --log-group-name '/aws/lambda/dev-ledger-ctrl-IngressHandler75095446-6klr79C6tQxk' \
  --start-time $START --end-time $END \
  --filter-pattern 'removeUndefinedValues' \
  --region us-east-1 --query 'length(events)' --output text
```

Expected: Non-zero (post-redeploy baseline still has the simulated-write failures we're about to fix). Record the number.

- [ ] **Step 4.2: Deploy ledger-ctrl to dev**

Run:

```bash
AWS_PROFILE=nestfolio-dev bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=ledger-ctrl
```

Expected: `Deployment complete. Tier: sandbox, Prefix: dev` at end of output. Stack `dev-ledger-ctrl` shows ✅.

- [ ] **Step 4.3: Trigger a fresh decision packet via scenario 6 (now a healthy harness)**

Run:

```bash
AWS_PROFILE=nestfolio-dev NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns=accept-decision
```

Expected: PASS. (Bug 1 doesn't block scenario 6, but running it exercises a fresh DECISION_PACKET_CREATED → processSimulationEvent path against the new code.)

- [ ] **Step 4.4: Confirm zero new marshaller errors in the post-deploy window**

Wait 60 seconds after the e2e test completes, then run:

```bash
END=$(date +%s)000; START=$(($END - 300000))
AWS_PROFILE=nestfolio-dev aws logs filter-log-events \
  --log-group-name '/aws/lambda/dev-ledger-ctrl-IngressHandler75095446-6klr79C6tQxk' \
  --start-time $START --end-time $END \
  --filter-pattern 'removeUndefinedValues' \
  --region us-east-1 --query 'length(events)' --output text
```

Expected: `0`. (If non-zero, STOP — the fix is incomplete; capture a sample message and re-investigate.)

- [ ] **Step 4.5: Confirm a simulated LedgerEntry exists with the correct payload shape**

Run:

```bash
AWS_PROFILE=nestfolio-dev aws logs filter-log-events \
  --log-group-name '/aws/lambda/dev-ledger-ctrl-IngressHandler75095446-6klr79C6tQxk' \
  --start-time $START --end-time $END \
  --filter-pattern '{ $.message = "putLedgerEntry" && $.streamType = "simulated" }' \
  --region us-east-1 --query 'events[0].message' --output text | head -c 2000
```

Expected: A success log with `streamType: simulated` and a payload showing `quantity` (numeric, derived) and `amountCents` (numeric, source). If no logs match this pattern but the post-deploy error count is 0, also verify via DynamoDB:

```bash
AWS_PROFILE=nestfolio-dev aws dynamodb query \
  --table-name dev-ledger-ctrl \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values '{":pk":{"S":"Account#<tenantId>#simulated"}}' \
  --region us-east-1 --query 'Items[0].payload'
```

(Replace `<tenantId>` with the tenant from the just-run scenario.)

No commit on this task.

---

## Task 5: Ship + PR

**Files:**
- Modify: `docs/backlog/ledger-ctrl-simulated-trade-quantity-undefined.md`

- [ ] **Step 5.1: Mark workstream shipped + fill validation_gate**

Edit frontmatter of `docs/backlog/ledger-ctrl-simulated-trade-quantity-undefined.md`:

```yaml
status: shipped
validation_gate: "Pre-deploy: N marshaller errors in 30-min window. Post-deploy (ledger-ctrl only): 0 marshaller errors in 5-min window after a fresh accept-decision e2e run. New simulated LedgerEntry row verified with payload.quantity (derived) + payload.amountCents (source)."
```

Replace `N` with the number captured in Step 4.1.

- [ ] **Step 5.2: Append ship narrative to the dossier body**

Add at the top of the body (after the `# header`):

```markdown
## Resolution (SHIPPED 2026-05-15)

Two-file fix in ledger-ctrl: aligned `ProposedTrade.quantity` → `quantityOrAmountCents` (the canonical wire shape used by 5 other services) and added `derivedQuantity = (amountCents / 100) / fillPrice` to `ShadowFillService.simulateFill`. `processSimulationEvent` now persists both `quantity` (derived shares) and `amountCents` (source dollars) on the LedgerEntry payload for audit-trail clarity.

Validated against deployed dev: pre-deploy N marshaller errors in a 30-min window → 0 errors post-deploy in the 5-min window covering a fresh `accept-decision` e2e run.
```

Replace `N` with the captured baseline.

- [ ] **Step 5.3: Run backlog-lint --fix**

Run: `node .claude/skills/backlog-lint/lint.mjs --fix`
Expected: `✓ NNN backlog files; all 8 rules pass (with --fix applied)`.

- [ ] **Step 5.4: Commit the ship**

```bash
git add docs/backlog/ledger-ctrl-simulated-trade-quantity-undefined.md docs/BACKLOG.md
git commit -m "$(cat <<'EOF'
docs(backlog): ship ledger-ctrl-simulated-trade-quantity-undefined

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5.5: Push branch and open PR**

```bash
git push -u origin HEAD
gh pr create --title "fix(ledger-ctrl): align simulated ProposedTrade with canonical quantityOrAmountCents wire shape" --body "$(cat <<'EOF'
## Summary
- Resolves 100% failure rate on simulated ORDER_FILLED writes in ledger-ctrl
- Aligns ledger-ctrl's `ProposedTrade.quantity` with the canonical `quantityOrAmountCents` wire shape used by advisory's assemble-packet, compliance-ctrl, and e2e fixtures
- `ShadowFillService.simulateFill` now returns `derivedQuantity` computed from amount + fill price
- `processSimulationEvent` persists both derived `quantity` and source `amountCents` on simulated LedgerEntry rows

## Test plan
- [ ] `pnpm nx test ledger-ctrl` — full unit suite green
- [ ] Deployed to dev sandbox via `infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=ledger-ctrl`
- [ ] CloudWatch confirms zero `removeUndefinedValues` errors in the post-deploy 5-min window
- [ ] `accept-decision` e2e passes against deployed dev
- [ ] New simulated LedgerEntry row verified in DDB with `quantity` (derived) + `amountCents` (source)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

- **Spec coverage:** Bug 1 root cause = wire-shape mismatch + missing derived-quantity semantic. Task 1 handles the shape rename + derived-quantity. Task 2 handles the consumer wiring. Task 3 catches regressions. Task 4 validates against deployed dev. Task 5 ships.
- **Type consistency:** `ProposedTrade.quantityOrAmountCents` used identically in test fixture (Task 1.1), service (Task 1.3), and handler (Task 2.3). `FillResult.derivedQuantity` used in test (Task 1.1), service (Task 1.3), handler (Task 2.3).
- **No placeholders:** every code step has full code. Validation gate captures concrete numbers.
- **DRY/YAGNI:** No defensive code added (no `removeUndefinedValues` flag, no fallback to legacy `quantity` field). Per `feedback_no_deprecation`, dev is disposable — clean swap.
- **Frequent commits:** 1 commit per task. Tasks 3 and 4 are read-only (no commit).
