# Decouple `onboarded()` e2e fixture from AgentCore — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the 360s agent-gated `InvestorProfileSnapshot` poll out of `onboarded()` into a new composable fixture `withProfileSnapshot()`, so the ~12 e2e scenarios that never read the snapshot stop paying IP-agent latency in `beforeEach`.

**Architecture:** `onboarded()` keeps its two event emits and the fast `getProfile` GraphQL wait. The agent-gated DDB poll becomes a separate `Fixture` (`withProfileSnapshot()`) composed only by the 3 scenarios that drive a real decision-workflow-ctrl cycle. Read-only poll relocation — no DDB seeding, no service/CDK change, no deploy.

**Tech Stack:** TypeScript, Jest 30, `@nestfolio/test-support`, AWS SDK v3 DynamoDB DocumentClient, Nx.

**Spec:** `docs/superpowers/specs/2026-05-21-e2e-fixture-agentcore-decoupling-design.md`

---

### Task 1: Add `withProfileSnapshot()` fixture and slim `onboarded()`

**Files:**
- Modify: `apps/e2e-feature-tests/src/helpers/fixtures.ts` (`onboarded()` body ~lines 100-145; new fixture inserted after `onboarded()`)
- Modify: `apps/e2e-feature-tests/src/index.ts:4-16` (re-export block)

- [ ] **Step 1: Remove the snapshot poll from `onboarded()`**

In `fixtures.ts`, `onboarded()` currently ends with the `getProfile` wait
followed by the `InvestorProfileSnapshot` poll block. Replace everything from
the end of the `waitForGraphQL(...)` call through the closing `};` of the
returned async function so the function ends right after the GraphQL wait.

The returned async function should now end exactly like this:

```ts
    // Poll getProfile to confirm the composite InvestorProfile row has been materialized
    // by onboarding-completed's Put. Downstream fixtures (funded, withDecision, etc.) can
    // race against this if the profile isn't ready, and any test asserting on
    // mandate/operatingMode shape needs a materialized row.
    await waitForGraphQL<{ getProfile: { tenantId: string } }>(
      bff.investor,
      `query { getProfile { tenantId } }`,
      {},
      (r) => !!r.getProfile?.tenantId,
      { timeoutMs: 60_000 },
    );
    return {};
  };
}
```

Delete the block that started with the comment
`// Poll for InvestorProfileSnapshot materialisation in investor-profile-ctrl's`
and contained the `ipTableName` / `ddbClient` / 360s `while` loop / `finally`.

- [ ] **Step 2: Add the `withProfileSnapshot()` fixture**

Immediately after the closing `}` of `onboarded()` in `fixtures.ts`, insert:

```ts
/**
 * Waits for the InvestorProfileSnapshot row that IP-ctrl's Bedrock AgentCore
 * agent writes after onboarding (user-goals Haiku + risk-assessment Sonnet).
 *
 * Compose this AFTER onboarded() ONLY in scenarios that drive a real
 * decision-workflow-ctrl cycle: the DWC per-cycle Step Function reads the
 * DWC-local mirror of this snapshot (materialised by SnapshotProjectorIngress
 * CDC), so the snapshot must exist before the cycle triggers. Scenarios that
 * just need an onboarded tenant — or use the synthetic withDecision() that
 * short-circuits the SF — must NOT compose this: it costs agent-invoke latency.
 */
export function withProfileSnapshot(): Fixture {
  return async (ctx, tenant, _eb, _bff) => {
    const ipTableName = await ctx.ssm.tableName('investor-profile-ctrl');
    const ddbClient = new DynamoDBClient({ region: ctx.region });
    const ddbDoc = DynamoDBDocumentClient.from(ddbClient);
    try {
      // 360s budget: the IP-ctrl AgentCore invoke can hit the account maxVms
      // quota; when it does, the event-processor (with quota errors now
      // retryable) lets SQS redrive the message. One full native redrive is
      // IP-ctrl ingress visibility timeout (240s) + agent invoke (~90s p99) +
      // CDC/EB/adapter (~20s). See
      // docs/superpowers/specs/2026-05-21-agentcore-invocation-resilience-design.md
      const deadline = Date.now() + 360_000;
      while (Date.now() < deadline) {
        const r = await ddbDoc.send(new GetCommand({
          TableName: ipTableName,
          Key: {
            pk: `InvestorProfileSnapshot#${tenant.tenantId}#${tenant.userId}`,
            sk: 'InvestorProfileSnapshot',
          },
        }));
        if (r.Item) return {};
        await new Promise(res => setTimeout(res, 2_000));
      }
      throw new Error('withProfileSnapshot(): InvestorProfileSnapshot not materialised within 360s');
    } finally {
      ddbClient.destroy();
    }
  };
}
```

No import changes are needed in `fixtures.ts`: `DynamoDBClient`,
`DynamoDBDocumentClient` and `GetCommand` remain in use (by `funded()` and the
new fixture); `PutCommand`/`UpdateCommand` remain in use by the breaker fixtures.

- [ ] **Step 3: Re-export `withProfileSnapshot` from `index.ts`**

In `apps/e2e-feature-tests/src/index.ts`, the fixtures re-export block lists
`onboarded, funded, withDecision, withLiveDecision, withNotification, ...`.
Add `withProfileSnapshot,` on its own line, immediately after `withLiveDecision,`:

```ts
export {
  applyFixtures,
  onboarded,
  funded,
  withDecision,
  withLiveDecision,
  withProfileSnapshot,
  withNotification,
  withHoldings,
  withBreakerOpen,
  closeBreakerFixture,
  type Fixture,
  type FixtureResult,
} from './helpers/fixtures';
```

- [ ] **Step 4: Type-check / lint the e2e app**

Run: `pnpm nx lint e2e-feature-tests`
Expected: PASS, no errors. (This compiles the TypeScript and verifies the new
export resolves and `onboarded()` still returns `Promise<FixtureResult>`.)

- [ ] **Step 5: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/fixtures.ts apps/e2e-feature-tests/src/index.ts
git commit -m "refactor(e2e): extract withProfileSnapshot() from onboarded() fixture"
```

---

### Task 2: Compose `withProfileSnapshot()` into the 3 live-decision scenarios

**Files:**
- Modify: `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts:5-12,24-28`
- Modify: `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts:6-16,29-42`
- Modify: `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts:5-11,98-104`

- [ ] **Step 1: Wire `first-decision.e2e.test.ts`**

Add `withProfileSnapshot,` to the import block (after `onboarded,`):

```ts
import {
  freshTenant,
  applyFixtures,
  onboarded,
  withProfileSnapshot,
  withLiveDecision,
  type FreshTenant,
} from '..';
```

Update the `beforeEach` comment and the `applyFixtures` call. The comment block
currently reads `… Their snapshot rows are pre-\n    // materialised by onboarded() (waits for InvestorProfileSnapshot) and by\n    // MarketSnapshot bootstrap CR on stack create.` Change the
`onboarded() (waits for InvestorProfileSnapshot)` phrase to
`withProfileSnapshot()`. Then change the fixture call:

```ts
    // ... Their snapshot rows are pre-
    // materialised by withProfileSnapshot() and by
    // MarketSnapshot bootstrap CR on stack create.
    advisoryNarrativeTrap = await AgentTraceTrap.arm(ctx, 'advisoryNarrative');
    await applyFixtures(ctx, tenant, [onboarded(), withProfileSnapshot()]);
```

- [ ] **Step 2: Wire `rebalance-on-drift.e2e.test.ts`**

Add `withProfileSnapshot,` to the import block (after `onboarded,`):

```ts
import {
  freshTenant,
  applyFixtures,
  onboarded,
  withProfileSnapshot,
  funded,
  withHoldings,
  withLiveDecision,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';
```

Insert `withProfileSnapshot(),` into the `applyFixtures` array, immediately
after `onboarded(),`:

```ts
    await applyFixtures(ctx, tenant, [
      onboarded(),
      withProfileSnapshot(),
      funded({ cashBalanceCents: 2_000_000 }),
      withHoldings([
        { symbol: 'VTI', quantity: 50, fillPrice: 200 },
        { symbol: 'BND', quantity: 10, fillPrice: 80 },
      ]),
      // Drive the first decision cycle to completion so the MandateSnapshot
      // projection materialises before the test body emits PORTFOLIO_DRIFT_DETECTED.
      // Without this, decision-workflow-ctrl's SF hits LookupMandateSnapshot
      // before the projector has written the row and fails the
      // $.Item.operatingMode.S JSONPath extraction.
      withLiveDecision(),
    ]);
```

- [ ] **Step 3: Wire `operating-mode-recommendation-shape.e2e.test.ts`**

Add `withProfileSnapshot,` to the import block (after `onboarded,`):

```ts
import {
  freshTenant,
  applyFixtures,
  onboarded,
  withProfileSnapshot,
  bffClient,
  type FreshTenant,
} from '..';
```

Insert `withProfileSnapshot(),` into the `applyFixtures` array, immediately
after the `onboarded({ ... })` entry:

```ts
    await applyFixtures(ctx, tenant, [
      onboarded({
        operatingMode: testCase.mode,
        capitalAmount: 100_000,
        mandateLevel: 'DISCRETIONARY',
      }),
      withProfileSnapshot(),
    ]);
```

The `it()` body publishes `MANDATE_ISSUED` and drives the cycle — the snapshot
materialised here in `beforeEach` is present before that trigger.

- [ ] **Step 4: Lint the e2e app**

Run: `pnpm nx lint e2e-feature-tests`
Expected: PASS, no errors — confirms all three imports resolve.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts
git commit -m "test(e2e): compose withProfileSnapshot() into live-decision scenarios"
```

---

### Task 3: Scoped e2e validation against deployed dev

This task runs the validation gate. No code changes. It doubles as the
`/backlog-next` closing-phase e2e gate. No deploy is required — the change is
test-code only (`detect-deploy-needed` will report skip).

**Files:** none modified.

- [ ] **Step 1: Run the 3 live-decision scenarios**

These must still pass with `withProfileSnapshot()` composed in — proving the
snapshot wait was correctly relocated, not lost.

Run:
```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns 'first-decision|rebalance-on-drift|operating-mode-recommendation-shape'
```
Expected: 3 scenario files PASS.

- [ ] **Step 2: Run a fast-path sample**

`accept-decision` (uses synthetic `withDecision()`) and `fund-account` (no
decision cycle) must pass without the snapshot wait — proving the decoupling is
correct and the `beforeEach` no longer blocks on the IP agent.

Run:
```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns 'accept-decision|fund-account'
```
Expected: 2 scenario files PASS. Note their `beforeEach` wall-clock time — it
should no longer include a multi-second-to-minute IP-agent wait.

- [ ] **Step 3: Handle any flake**

If any scenario fails then passes on rerun, do NOT dismiss it. Pull CloudWatch
evidence from the failing window (`/aws/lambda/dev-investor-profile-ctrl-*`,
`/aws/states/dev-decision-workflow-ctrl-*`) and run a second confirmation pass
before continuing. A flake is a real failure — see `feedback_flake_means_broken`.

- [ ] **Step 4: No commit** — validation only. Evidence (command output, pass
counts) is recorded in the backlog file's `validation_gate:` during the
`/backlog-next` closing phase.

---

## Out of scope

- Reducing decision-cycle latency inside `withLiveDecision` (180s budget).
- Retuning the 360s native-retry poll budget.
- Direct-DDB seeding of the `InvestorProfileSnapshot` row.
- Other fixtures (`funded`, `withDecision`, `withHoldings`, etc.).
