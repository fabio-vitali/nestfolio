# Plan F: BFF AppSync Query Test Rewrite — PK Alignment + Seeder Elimination

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Investigate and fix the pk/sk mismatches between event materializations and AppSync resolvers in all 4 BFF services, then rewrite every `DdbSeedFixture`/`AccountSeedingFixture`-based AppSync query test to use event-driven fixtures. After this plan, ZERO tests use direct DDB writes.

**Architecture:** BFF services have two data paths: (1) event materializations via `materializeToTable` pipelines that write DDB items, and (2) AppSync JS/Lambda resolvers that read DDB items. Currently some resolvers read from different pk/sk keys than what event materializations write. This plan first aligns the pk/sk patterns, then rewrites the query tests to populate state via events.

**Tech Stack:** Jest, `@nestfolio/integration-testing`, AppSync JS resolvers, DynamoDB

**Prerequisite:** Plan E completed (all ingestion tests pass, mutation seeders eliminated)

**Known pk/sk mismatches:**
| Service | Transform writes | Resolver reads | Mismatch |
|---------|-----------------|----------------|----------|
| dashboard-bff | `T#<tenantId>` | `Dashboard#<tenantId>` | PK prefix |
| ledger-bff | `sk: Balance` | `sk: Latest` | SK value |
| investor-bff | `T#<tenantId>` (event-listener) | `InvestorProfile#<tenantId>#<userId>` | PK pattern |
| advisory-bff | `T#<tenantId>` (event-listener) | `Decision#<tenantId>#<decisionId>` | PK pattern |

---

## File Map

| Action | File |
|--------|------|
| Investigate+Modify | `services/investor/dashboard-bff/src/graphql/js-function/*.fn.js` |
| Modify | `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts` |
| Investigate+Modify | `services/ledger/ledger-bff/src/transforms/*.ts` OR `src/repositories/*.ts` |
| Modify | `services/ledger/ledger-bff/test/integration/ledger-bff.integration.test.ts` |
| Investigate+Modify | `services/investor/investor-bff/src/graphql/js-function/*.fn.js` |
| Modify | `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts` |
| Investigate | `services/advisory/advisory-bff/src/graphql/js-function/*.fn.js` |
| Modify | `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts` |

---

### Task 1: Dashboard-BFF — Investigate and fix pk alignment

**Files:**
- Investigate: `services/investor/dashboard-bff/src/graphql/js-function/*.fn.js`
- Investigate: `services/investor/dashboard-bff/src/transforms/*.ts`

**Context:** Transforms write to `pk: T#<tenantId>`. Resolvers read from `pk: Dashboard#<tenantId>`. These are different DDB partitions — events CANNOT populate what resolvers read.

- [ ] **Step 1: Read all resolver files to confirm the pk pattern**

```bash
grep -r "Dashboard#" services/investor/dashboard-bff/src/graphql/ --include="*.js" --include="*.ts"
grep -r "T#" services/investor/dashboard-bff/src/graphql/ --include="*.js" --include="*.ts"
```

Map every resolver's pk/sk → document which pk it actually uses.

- [ ] **Step 2: Decide the fix direction**

Two options (use `AskUserQuestion` to confirm with the user):

**Option A — Change resolvers to read from `T#` (recommended):**
- Pros: Resolvers read materialized data → full event-driven query path
- Cons: Requires deploying updated resolvers

**Option B — Change transforms to write to `Dashboard#`:**
- Pros: Preserves existing resolver code
- Cons: Existing event materialization tests use `T#` — all assertions need updating

The recommended option is **A** — change resolvers to read from `T#<tenantId>` instead of `Dashboard#<tenantId>`.

- [ ] **Step 3: Fix each resolver (Option A)**

For each JS resolver file, replace `Dashboard#` with `T#`:

```javascript
// Before (in get-dashboard.fn.js, get-position-snapshots.fn.js, etc.)
const pk = `Dashboard#${ctx.stash.tenantId}`;

// After
const pk = `T#${ctx.stash.tenantId}`;
```

Also fix sk values if they differ from transform output:
- `get-time-travel-availability.fn.js`: verify sk matches transform output (`TimeTravelAvailability` vs `TimeTravel`)
- `get-simulation-summary.fn.js`: verify sk matches transform output

Files to modify (verify each):
- `get-dashboard.fn.js` — pk: `Dashboard#` → `T#`
- `get-position-snapshots.fn.js` — pk: `Dashboard#` → `T#`
- `get-recent-activity.fn.js` — pk: `Dashboard#` → `T#`
- `get-time-travel-availability.fn.js` — pk: `Dashboard#` → `T#`, verify sk
- `get-simulation-summary.fn.js` — pk: `Dashboard#` → `T#`, verify sk

- [ ] **Step 4: Run dashboard-bff unit tests to verify resolver changes**

```bash
pnpm nx run dashboard-bff:test --verbose
```

Fix any unit test assertions that reference the old pk pattern.

- [ ] **Step 5: Deploy dashboard-bff to update resolvers in AppSync**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev -- -c services=dashboard-bff
```

- [ ] **Step 6: Commit resolver fixes**

```bash
git add services/investor/dashboard-bff/src/
git commit -m "fix(dashboard-bff): align resolver pk to T# matching event materializations

All JS resolvers now read from pk: T#<tenantId> instead of Dashboard#<tenantId>,
aligning with materializeToTable transform output. Enables event-driven query tests."
```

---

### Task 2: Dashboard-BFF — Rewrite AppSync query tests with event-driven fixtures

**Files:**
- Modify: `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts`

After the pk alignment fix (Task 1), event materializations and resolvers use the same pk. Replace the `seeder.seed()` block (lines 281-356) with event publishing.

- [ ] **Step 1: Replace seeder beforeAll with event-driven fixture**

Replace the entire `beforeAll` in the `AppSync queries` describe block:

```typescript
  describe('AppSync queries', () => {
    // Event-driven fixture: publish all events needed to populate resolver data
    // Replaces seeder.seed() — state is populated through the event pipeline
    beforeAll(async () => {
      // InvestorSnapshot — via GOAL_CREATED
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'GOAL_CREATED',
        detail: {
          objective: 'GROWTH',
          targetAmountCents: 500_000_00,
          targetDate: '2030-01-01',
        },
      });

      // InvestorSnapshot — add riskLevel via RISK_PROFILE_CREATED
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'RISK_PROFILE_CREATED',
        detail: { score: 7, category: 'MODERATE' },
      });

      // InvestorSnapshot — add operatingMode via OPERATING_MODE_SELECTED
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'OPERATING_MODE_SELECTED',
        detail: { mode: 'BALANCED' },
      });

      // PortfolioSummary — via PORTFOLIO_UPDATED with driftPercent
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'PORTFOLIO_UPDATED',
        detail: { driftPercent: 2.5 },
      });

      // AdvisoryStatus — via DECISION_PACKET_CREATED
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          decisionId: `query-test-dp-${Date.now()}`,
          trigger: 'REBALANCE',
          proposedTrades: [],
          explanation: 'Query test fixture',
          confirmationRequired: false,
        },
      });

      // PositionSnapshot — via PORTFOLIO_UPDATED with symbol
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'PORTFOLIO_UPDATED',
        detail: {
          symbol: 'AAPL',
          filledQuantity: 10,
          averageFillPrice: 150,
          quantity: 10,
          avgCostBasis: 150,
          currentPrice: 160,
          marketValue: 1600,
          weightPercent: 15,
          unrealizedPnl: 100,
          assetClass: 'EQUITY',
        },
      });

      // Activity — via BALANCE_UPDATED (recentActivity transform)
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'BALANCE_UPDATED',
        detail: { amountCents: 50_000_00, currency: 'USD' },
      });

      // TimeTravelAvailability — via LEDGER_ENTRY_RECORDED
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        detail: {
          snapshotAt: '2025-01-01T00:00:00.000Z',
          entryType: 'TRADE',
        },
      });

      // Wait for all materializations to complete
      // Check the last item we expect (TimeTravelAvailability)
      await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'TimeTravelAvailability',
        timeoutMs: 90_000,
      });

      // Also verify PositionSnapshot exists
      await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'PositionSnapshot#AAPL',
        timeoutMs: 30_000,
      });
    }, 120_000);
```

- [ ] **Step 2: Update query assertions to match event-driven data**

The query assertions may need adjustment because event-driven data has different field values than seeded data. Update each test's `expect()` calls to match what the transforms actually produce.

For example, `getDashboard` should verify:
```typescript
    it('should return Dashboard via getDashboard', async () => {
      const result = await appsync.query<{
        getDashboard: {
          portfolioSummary: { driftPercent: number } | null;
          advisoryStatus: { pendingDecisions: number } | null;
          investorSnapshot: { goalType: string | null; riskLevel: string | null; operatingMode: string | null } | null;
        };
      }>(`
        query GetDashboard {
          getDashboard {
            portfolioSummary { driftPercent }
            advisoryStatus { pendingDecisions }
            investorSnapshot { goalType riskLevel operatingMode }
          }
        }
      `, {});

      expect(result.getDashboard).toBeDefined();
      expect(result.getDashboard.portfolioSummary).not.toBeNull();
      expect(result.getDashboard.portfolioSummary!.driftPercent).toBe(2.5);
      expect(result.getDashboard.investorSnapshot).not.toBeNull();
      expect(result.getDashboard.investorSnapshot!.goalType).toBe('GROWTH');
      expect(result.getDashboard.investorSnapshot!.operatingMode).toBe('BALANCED');
      expect(result.getDashboard.advisoryStatus).not.toBeNull();
      expect(result.getDashboard.advisoryStatus!.pendingDecisions).toBeGreaterThanOrEqual(1);
    }, 60_000);
```

Adjust ALL query tests similarly — match assertions to what events produce, not what was seeded.

**Note on SimulationSummary:** The null test for `getSimulationSummary` should still pass because no simulation events are published.

- [ ] **Step 3: Remove DdbSeedFixture from dashboard-bff test**

Remove the `seeder` variable, `DdbSeedFixture` import, and initialization:
```typescript
// Remove from imports: DdbSeedFixture
// Remove: let seeder: DdbSeedFixture;
// Remove: seeder = new DdbSeedFixture(ctx);
```

- [ ] **Step 4: Run dashboard-bff integration tests**

```bash
pnpm nx run dashboard-bff:test-integration --verbose
```

Expected: All tests pass — both event materializations and AppSync queries use event-driven data.

- [ ] **Step 5: Commit**

```bash
git add services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts
git commit -m "test(dashboard-bff): rewrite AppSync query tests with event-driven fixtures

Replace DdbSeedFixture.seed() in AppSync queries describe block with
EventBridge events. All state populated through materializeToTable pipeline.
Zero direct DDB writes in entire test file."
```

---

### Task 3: Ledger-BFF — Investigate sk alignment (Balance vs Latest)

**Files:**
- Investigate: `services/ledger/ledger-bff/src/transforms/balance-updated.ts`
- Investigate: `services/ledger/ledger-bff/src/repositories/portfolio.repository.ts`

**Context:** The `balance-updated` transform writes `sk: Balance`. The `getLatest()` repository method reads `sk: Latest`. The `upsertBalance()` method writes `sk: Latest`. These are separate DDB items at different sort keys.

- [ ] **Step 1: Investigate who calls upsertBalance()**

```bash
grep -r "upsertBalance" services/ledger/ledger-bff/src/ --include="*.ts"
```

Determine: Is `upsertBalance()` called by the event-listener pipeline? Or only by the graphql-resolver?

If the event-listener pipeline (balance-updated transform) calls `upsertBalance()` in addition to the `project()` UoW, then `sk: Latest` IS populated by events — the test just needs to check the right sk.

If `upsertBalance()` is only called by the graphql-resolver Lambda, then `sk: Latest` is NOT populated by events and we need to fix the pipeline.

- [ ] **Step 2: Decide the fix direction**

**If upsertBalance is called by event pipeline:** No code change needed. The test should wait for `sk: Latest` after publishing events.

**If upsertBalance is NOT called by event pipeline:** Add an `sk: Latest` write to the balance-updated transform, or have the event-listener call `upsertBalance()` after the transform. Then deploy.

- [ ] **Step 3: Investigate other seeded items**

The seeder populates: PortfolioLatest (`sk: Latest`), Positions, HistoryEntries, Checkpoints, SnapshotAt, SimulationLatest, SimulationPositions.

Map each to its event source:
- `sk: Latest` (PortfolioLatest) → needs investigation (see step 1-2)
- `sk: Position#<symbol>` → `PORTFOLIO_UPDATED` event → transform writes this ✓
- `sk: Entry#<seqNo>` → `LEDGER_ENTRY_RECORDED` event → transform writes this ✓
- `Checkpoint#<tenantId>` → written by checkpoint Lambda (periodic, not event-driven) — may need seeding or a different approach
- `SnapshotAt#<tenantId>#actual` → written by balance-updated transform's secondary write ✓
- `Simulation#<tenantId>` → written by simulation events (if they exist)

**Items that MAY require alternative fixture strategies:**
- Checkpoints — periodic Lambda, not event-triggered. May need a CHECKPOINT_CREATED event or accept seeding for this one.
- SimulationLatest/Position — may need SIM_* events or accept that simulation comparison test returns null.

- [ ] **Step 4: Document findings and plan resolution**

Create a brief comment in the test file documenting which items can be event-driven and which need alternative approaches. Proceed to implementation based on findings.

- [ ] **Step 5: Commit investigation findings**

```bash
git add services/ledger/ledger-bff/
git commit -m "refactor(ledger-bff): investigate sk alignment for event-driven query tests

Document which AppSync query data paths are event-driven vs checkpoint/simulation
paths that require alternative fixture strategies."
```

---

### Task 4: Ledger-BFF — Rewrite event-driven query tests

**Files:**
- Modify: `services/ledger/ledger-bff/test/integration/ledger-bff.integration.test.ts`

Based on Task 3 findings, rewrite the AppSync query `beforeAll` to use events where possible.

- [ ] **Step 1: Replace seeder with events for verifiable items**

```typescript
  describe('AppSync queries', () => {
    beforeAll(async () => {
      // Event-driven fixtures — populate DDB through the event pipeline

      // 1. BALANCE_UPDATED → PortfolioBalance (sk: Balance)
      //    Also writes SnapshotAt record for time-travel
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'BALANCE_UPDATED',
        detail: {
          cashBalanceCents: 1_000_000,
          deltaCents: 50_000,
        },
      });

      // 2. PORTFOLIO_UPDATED → Position#AAPL, Position#MSFT
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'PORTFOLIO_UPDATED',
        detail: {
          positions: {
            AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 150.0, totalCostBasis: 1500.0, lastFillPrice: 155.0 },
          },
        },
      });
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'PORTFOLIO_UPDATED',
        detail: {
          positions: {
            MSFT: { symbol: 'MSFT', quantity: 5, averageCostBasis: 300.0, totalCostBasis: 1500.0, lastFillPrice: 310.0 },
          },
        },
      });

      // 3. LEDGER_ENTRY_RECORDED → HistoryEntry records
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        detail: {
          eventId: `integ-hist-query-001`,
          eventType: 'ORDER_FILLED',
          payload: { orderId: 'order-001', symbol: 'AAPL', quantity: 5, fillPrice: 150.0 },
          timestamp: new Date().toISOString(),
          sequenceNo: 99001,
        },
      });
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        detail: {
          eventId: `integ-hist-query-002`,
          eventType: 'BALANCE_UPDATED',
          payload: { cashBalanceCents: 1000000 },
          timestamp: new Date().toISOString(),
          sequenceNo: 99002,
        },
      });

      // Wait for materializations
      await table.waitForItem({
        table: 'ledger-bff',
        pk: `Portfolio#${ctx.tenantId}`,
        sk: 'Balance',
        timeoutMs: 90_000,
      });
      await table.waitForItem({
        table: 'ledger-bff',
        pk: `Portfolio#${ctx.tenantId}`,
        sk: 'Position#AAPL',
        timeoutMs: 30_000,
      });
      await table.waitForItem({
        table: 'ledger-bff',
        pk: `History#${ctx.tenantId}`,
        sk: 'Entry#99001',
        timeoutMs: 30_000,
      });

      // NOTE: Checkpoint items and sk: Latest items may NOT be populated
      // by events — see Task 3 investigation. If getBalance uses sk: Latest
      // and it's not event-driven, that test needs the code fix from Task 3
      // before it can be event-driven.
    }, 120_000);
```

- [ ] **Step 2: Update query assertions based on investigation**

Adjust each test's assertions to match event-driven data. For tests that depend on items not populated by events (Checkpoint, Simulation, sk: Latest), either:
1. Skip them with a `// TODO: enable after sk alignment fix` comment
2. Use a minimal seed for ONLY those items that truly cannot come from events

- [ ] **Step 3: Run ledger-bff integration tests**

```bash
pnpm nx run ledger-bff:test-integration --verbose
```

- [ ] **Step 4: Commit**

```bash
git add services/ledger/ledger-bff/test/integration/ledger-bff.integration.test.ts
git commit -m "test(ledger-bff): rewrite AppSync query tests with event-driven fixtures

Replace DdbSeedFixture with EventBridge events for Balance, Positions,
and HistoryEntry items. Items without event paths documented."
```

---

### Task 5: Investor-BFF — Rewrite AppSync query tests

**Files:**
- Modify: `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`

**Context:** The query tests seed InvestorProfile at `pk: InvestorProfile#<tenantId>#<userId>, sk: InvestorProfile` and Goal at `sk: Goal#seeded-goal-1`.

The USER_REGISTERED event creates InvestorProfile via `record()` at `pk: T#<tenantId>` — DIFFERENT from the resolver pk `InvestorProfile#<tenantId>#<userId>`.

BUT: the `onboardingCompleted` handler writes InvestorProfile at `pk: InvestorProfile#<tenantId>#<userId>` (it uses a repository transactWrite, not a transform). So the ONBOARDING_COMPLETED event populates the CORRECT pk for resolvers.

**Strategy:** Use USER_REGISTERED + ONBOARDING_COMPLETED event chain to populate InvestorProfile and Goal.

- [ ] **Step 1: Replace query seeder with event chain**

Replace the `beforeAll` in the `AppSync queries` describe block:

```typescript
  describe('AppSync queries', () => {
    const profilePk = () => `InvestorProfile#${ctx.tenantId}#${cognitoSub}`;

    beforeAll(async () => {
      // Event-driven fixture: USER_REGISTERED + ONBOARDING_COMPLETED
      // creates InvestorProfile + Goal at the pk resolvers expect

      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'USER_REGISTERED',
        detail: {
          tenantId: ctx.tenantId,
          userId: cognitoSub,
          email: 'tester@integ-test.example',
        },
      });

      // Wait for InvestorProfile to exist at T#<tenantId> (event-listener record)
      await table.waitForItem({
        table: 'investor-bff',
        pk: `T#${ctx.tenantId}`,
        timeoutMs: 60_000,
      });

      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'ONBOARDING_COMPLETED',
        detail: {
          tenantId: ctx.tenantId,
          userId: cognitoSub,
          goal: { objective: 'Retirement' },
          horizonYears: 20,
          accountMode: 'simulation',
          capitalAmount: 0,
          currency: 'USD',
          riskTolerance: 7,
          riskExperience: 5,
          operatingMode: 'BALANCED',
          mandateAccepted: true,
        },
      });

      // Wait for Goal to be created (ONBOARDING_COMPLETED transactWrite)
      const deadline = Date.now() + 60_000;
      let found = false;
      while (Date.now() < deadline && !found) {
        const items = await table.queryItems({
          table: 'investor-bff',
          pk: profilePk(),
          skPrefix: 'Goal#',
        });
        if (items.length > 0) found = true;
        else await new Promise(r => setTimeout(r, 2_000));
      }
      expect(found).toBe(true);
    }, 120_000);
```

- [ ] **Step 2: Update getProfile assertion**

```typescript
    it('should return InvestorProfile via getProfile', async () => {
      const result = await appsync.query<{
        getProfile: {
          tenantId: string;
          userId: string;
          email: string;
          operatingMode: string;
          currency: string;
        };
      }>(`
        query GetProfile {
          getProfile {
            tenantId
            userId
            email
            operatingMode
            currency
          }
        }
      `, {});

      expect(result.getProfile.tenantId).toBe(ctx.tenantId);
      expect(result.getProfile.userId).toBe(cognitoSub);
      // Note: email comes from USER_REGISTERED, may be overwritten by ONBOARDING_COMPLETED
      expect(result.getProfile.operatingMode).toBe('BALANCED');
    }, 60_000);
```

- [ ] **Step 3: Update getGoals assertion**

```typescript
    it('should return goals via getGoals', async () => {
      const result = await appsync.query<{
        getGoals: Array<{ goalId: string; objective: string; currency: string }>;
      }>(`
        query GetGoals {
          getGoals {
            goalId
            objective
            currency
          }
        }
      `, {});

      expect(Array.isArray(result.getGoals)).toBe(true);
      expect(result.getGoals.length).toBeGreaterThanOrEqual(1);
      const goal = result.getGoals[0];
      expect(goal.objective).toBe('Retirement');
      expect(goal.currency).toBe('USD');
    }, 60_000);
```

- [ ] **Step 4: Remove DdbSeedFixture from investor-bff test (if no other usages remain)**

After Plan E removed mutation seeders and this task removes query seeders:
```typescript
// Remove from imports: DdbSeedFixture
// Remove: let seeder: DdbSeedFixture;
// Remove: seeder = new DdbSeedFixture(ctx);
```

- [ ] **Step 5: Run investor-bff integration tests**

```bash
pnpm nx run investor-bff:test-integration --verbose
```

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-bff/test/integration/investor-bff.integration.test.ts
git commit -m "test(investor-bff): rewrite AppSync query tests with event-driven fixtures

Replace DdbSeedFixture with USER_REGISTERED + ONBOARDING_COMPLETED event chain.
InvestorProfile and Goal populated through application logic.
DdbSeedFixture fully removed from test file."
```

---

### Task 6: Run all BFF tests in parallel — final verification

- [ ] **Step 1: Run all 4 BFF services' integration tests**

```bash
pnpm nx run-many -t test-integration -p dashboard-bff investor-bff advisory-bff ledger-bff --parallel=4 --verbose
```

Expected: All tests pass. Zero `DdbSeedFixture` usage in dashboard-bff, investor-bff, advisory-bff. Ledger-bff may retain minimal seeding for items without event paths.

- [ ] **Step 2: Verify no seeder imports remain**

```bash
grep -r "DdbSeedFixture\|AccountSeedingFixture\|seeder\.seed" \
  services/investor/dashboard-bff/test/integration/ \
  services/investor/investor-bff/test/integration/ \
  services/advisory/advisory-bff/test/integration/ \
  services/ledger/ledger-bff/test/integration/
```

Expected: Zero matches (except ledger-bff if checkpoints/simulation items still need seeding).

- [ ] **Step 3: Commit final verification**

```bash
git add -A
git commit -m "test: verify all BFF integration tests pass with event-driven fixtures"
```

---

## Handoff

**Plan F complete.** The next plan to execute is:

**Plan G: Controller Integration Test Completion** — Completes advisory-ctrl, decision-workflow-ctrl, investor-ctrl, and execution-ctrl integration tests with full ingress event coverage.

**Prompt to start Plan G:**

> Clear the context and start a new conversation. Read the plan at `docs/superpowers/plans/2026-04-08-integration-test-G-controllers.md` and execute it using superpowers:subagent-driven-development.
