# E2E Feature Tests — Design

**Date:** 2026-04-11
**Status:** Draft, pending user review
**Author:** brainstorming session (Claude + fabio-vitali)

## 1. Purpose

Validate **user-facing features** of the Nestfolio system end-to-end against a real deployed sandbox. The suite answers one question per test: *"when a user does X, do they see the expected Y?"*

It is **not** an event-topology regression suite, **not** a unit/integration test replacement, and **not** a UI test harness. It is a business-correctness suite that treats the system as a black box with GraphQL as its only surface.

## 2. Scope

### In scope
- 13 feature scenarios covering every user-facing mutation in `investor-bff` and `advisory-bff`, plus 3 internally-triggered features with observable outcomes (first advisory decision, portfolio rebalance on drift, reconciliation correction).
- Manual execution against any deployed sandbox via `NESTFOLIO_INTEG_PREFIX` env var.
- Reuse of all existing fixtures in `libs/integration-testing` (`createIntegrationContext`, `CognitoFixture`, `AppSyncClient`).
- Real third-party vendors (Alpaca paper, SEC EDGAR, Alpha Vantage, FRED, Marketwatch, Yahoo Finance).

### Out of scope
- **Onboarding** — `onboarding-bff` is agentic (LangGraph + CopilotKit) and has no GraphQL mutation surface. Onboarding is the **precondition** for every other scenario, never the trigger.
- **Market-data-ingestion** as a standalone scenario — it has no direct user-visible surface and is covered transitively by scenario 11 (advisory decision requires market data upstream).
- **Reconciliation** as a standalone data-flow test — it's covered by scenario 13 when it produces a user-visible corrective outcome.
- **Metrics / CloudWatch emission** — the project currently has zero metrics infrastructure; introducing it would be its own project.
- **Playwright / UI browser testing** — a separate concern for a future initiative.
- **Per-service integration tests** — completely untouched; this suite runs alongside them.
- **CI integration** — designed to be CI-ready with a one-line addition to `pr-deploy.yml`, but not wired to CI in this effort. Manual-first.

## 3. Test Philosophy — Black Box Only

Every test follows exactly one shape, enforced by convention:

1. **Setup** — create a fresh tenant and apply event-fixture preconditions (onboarded, funded, decision-available, notification-present, etc.).
2. **Trigger** — exactly one of:
   - A GraphQL mutation against `investor-bff` or `advisory-bff`, OR
   - A synthetic EventBridge publish (only when the feature has no mutation surface — e.g., scheduler- or cascade-triggered outcomes).
3. **Assert** — exclusively via GraphQL queries against the read-side BFFs (`dashboard-bff`, `ledger-bff`, `investor-bff`, `advisory-bff`), with polling to handle eventual consistency.

### Strict rules
- ❌ No `EventBusTrap` usage. Tests do not subscribe to or verify emitted events.
- ❌ No `TableAssertions` usage. Tests do not read DynamoDB directly.
- ❌ No direct SDK calls to AWS services for assertions.
- ✅ Events may be *published* as preconditions or as an explicit trigger. They are never *observed* as outputs.
- ✅ All assertions flow through the same AppSync GraphQL endpoints the real UI consumes.

### Why
DDB and event assertions couple the test to internal plumbing. The suite is intentionally immune to refactors that preserve user-facing behavior: if a resolver gets rewritten, a table is resharded, or a CDC mapping is renamed, these tests continue passing as long as the user still sees the right thing. When a test fails, diagnosis drops back to per-service integration tests and logs — this suite's job is to say "the product is broken," not "byte 47 of message 3 on queue 9 is wrong."

## 4. Scenario List — 13 Features

### Mutation-triggered (10)

| # | Feature | Preconditions | Mutation | Assertions |
|---|---|---|---|---|
| 1 | Investor funds their account | onboarded | `initiateDeposit` | `dashboard-bff`: cashBalance reflects pending deposit, activity contains entry, notifications contain deposit notification |
| 2 | Investor withdraws cash | onboarded + funded | `requestWithdrawal` | `dashboard-bff`: cashBalance reflects pending withdrawal, activity contains entry, notifications present |
| 3 | Investor updates investment goal | onboarded | `updateGoal` | `investor-bff`: `getGoal` returns updated values |
| 4 | Investor updates advisory mandate | onboarded | `updateMandate` | `investor-bff`: `getMandate` returns updated terms |
| 5 | Investor revokes advisory mandate | onboarded | `revokeMandate` | `investor-bff`: `getMandate` shows revoked status |
| 6 | Investor accepts advisory decision and sees it executed | onboarded + funded + decision fixture | `confirmDecision` → publish `ORDER_FILLED` | `advisory-bff`: decision status; `ledger-bff`: portfolio holdings updated (shape) |
| 7 | Investor rejects advisory decision | onboarded + decision fixture | `rejectDecision` | `advisory-bff`: decision status = REJECTED |
| 8 | Investor views decision explanation | decision fixture | `recordExplanationView` | `advisory-bff`: view receipt present |
| 9 | Investor marks notification as read | notification fixture | `markNotificationRead` | `investor-bff`: notification status = READ |
| 10 | Investor requests account closure | onboarded + funded | `requestAccountClosure` | `investor-bff`: closure request present |

### Event-triggered (3)

| # | Feature | Preconditions | Trigger (event publish) | Assertions |
|---|---|---|---|---|
| 11 | Investor sees first advisory decision after onboarding | onboarded with mandate | `MANDATE_CREATED` | `advisory-bff`: `getDecisions` eventually returns a non-empty decision matching expected shape |
| 12 | Portfolio drift surfaces a rebalance decision | onboarded + funded + holdings fixture | `PORTFOLIO_DRIFT_DETECTED` | `advisory-bff`: `getDecisions` eventually returns a REBALANCE-type decision |
| 13 | Reconciliation discrepancy surfaces a corrective outcome | onboarded + funded + positions fixture | reconciliation scheduler event | `advisory-bff` (corrective decision) OR `investor-bff` notifications (alert) |

Scenario 6 is intentionally multi-step (mutation + event publish) because the feature — "investor sees their confirmed decision actually executed" — cannot be verified from the mutation alone; it requires the downstream fill to surface in the portfolio view.

## 5. Architecture

### New Nx library: `libs/e2e-feature-tests`

```
libs/e2e-feature-tests/
├── project.json              # Nx target: test-e2e-features
├── jest.config.js            # maxWorkers: 1, testTimeout: 300000 (5 min), globalTeardown
├── jest.global-teardown.ts   # runs alpacaPaperReset() once at end of suite
├── tsconfig.json
├── tsconfig.spec.json
├── src/
│   └── helpers/
│       ├── fresh-tenant.ts       # freshTenant(ctx) → new Cognito user + tenantId
│       ├── fixtures.ts           # onboarded(), funded(), withHoldings(), withDecision(), withNotification()
│       ├── bff-client.ts         # thin wrapper over existing AppSyncClient fixture
│       ├── wait-for-graphql.ts   # polls query until predicate(result) === true
│       └── alpaca-paper-reset.ts # blanket cancel-all-orders + close-all-positions against paper endpoint
└── test/
    ├── funding/
    │   ├── fund-account.e2e.test.ts
    │   └── withdraw-cash.e2e.test.ts
    ├── advisory/
    │   ├── first-decision.e2e.test.ts           # event-triggered (scenario 11)
    │   ├── accept-decision.e2e.test.ts          # multi-step (scenario 6)
    │   ├── reject-decision.e2e.test.ts
    │   ├── view-decision-explanation.e2e.test.ts
    │   ├── rebalance-on-drift.e2e.test.ts       # event-triggered (scenario 12)
    │   └── reconciliation-correction.e2e.test.ts # event-triggered (scenario 13)
    ├── profile/
    │   ├── update-goal.e2e.test.ts
    │   ├── update-mandate.e2e.test.ts
    │   └── revoke-mandate.e2e.test.ts
    ├── notifications/
    │   └── mark-notification-read.e2e.test.ts
    └── account/
        └── request-closure.e2e.test.ts
```

### Reused from `libs/integration-testing`
- `createIntegrationContext(options?)` — reads `NESTFOLIO_INTEG_PREFIX`, provides clients and config
- `CognitoFixture` — creates fresh Cognito users for test tenants
- `AppSyncClient` — typed GraphQL client for BFF interactions

### New helpers (all live in `libs/e2e-feature-tests/src/helpers/`)

**`freshTenant(ctx): Promise<{ tenantId, userId, authToken }>`**
Creates a new Cognito user and tenant ID. Guaranteed unique per test.

**`applyFixtures(tenant, fixtures): Promise<void>`**
Applies a list of event-publish fixtures to bring a tenant to a desired precondition state. Fixtures are named, composable, and represent the *observable* preconditions a feature needs:
- `onboarded()` — publishes `ONBOARDING_COMPLETED` + CDC sibling events (Goal, RiskProfile, Mandate, OperatingMode, AccountMode)
- `funded(amount)` — publishes `DEPOSIT_INITIATED` + `DEPOSIT_SETTLED`
- `withHoldings(holdings)` — publishes synthetic `ORDER_FILLED` events to populate the ledger
- `withDecision(shape)` — publishes synthetic `DECISION_GENERATED` event
- `withNotification(payload)` — publishes synthetic `NOTIFICATION_CREATED` event

Fixtures bypass any upstream business logic — they plant observable state at the earliest event that materializes the condition. The goal is determinism, not realism.

**`waitForGraphQL<T>(client, query, variables, predicate, opts): Promise<T>`**
Polls a GraphQL query until `predicate(result) === true` or timeout. Defaults: 60 s timeout, 2 s interval. Used for every assertion that depends on CDC → read-model projection lag.

**`bffClient`** — Convenience wrapper exposing methods like `bff.investor.query(...)`, `bff.advisory.mutate(...)`. Thin; does not hide anything.

**`alpacaPaperReset(prefix: string): Promise<void>`** — Cleanup helper invoked once at end of suite via Jest `globalTeardown`. Reads the same SSM base-URL param (`/nestfolio/{prefix}-broker-alpaca-adpt/alpaca/baseUrl`) and Secrets Manager secret (`{prefix}-broker-alpaca-adpt/alpaca-api-keys`) the adapter uses — reusing the AWS credentials the test runner already has for AppSync/Cognito. Before doing anything, asserts the resolved baseUrl is in the paper allowlist; aborts with a loud error if not. Then fires two blanket calls against the Alpaca REST API:
- `DELETE /v2/orders` — cancels all open orders
- `DELETE /v2/positions?cancel_orders=true` — closes all open positions at market

Direct `fetch` calls, no production-client dependency, no new `alpaca.client.ts` methods. The helper is test-only. **It does not reset the starting balance** — realized/unrealized P&L still accumulates over many runs, which is why section 11 retains the periodic manual dashboard reset as an operational task.

## 6. Test Shape — Canonical Example

```ts
import { createIntegrationContext, freshTenant, applyFixtures, onboarded, funded, withDecision, waitForGraphQL, bffClient } from '@nestfolio/e2e-feature-tests';

describe('accept advisory decision and see execution', () => {
  let ctx: IntegrationContext;
  let tenant: { tenantId: string; authToken: string };
  let decisionId: string;

  beforeEach(async () => {
    ctx = await createIntegrationContext(); // reads NESTFOLIO_INTEG_PREFIX
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [
      onboarded(),
      funded({ amountCents: 1_000_000 }),
    ]);
    decisionId = await withDecision(ctx, tenant, { kind: 'INITIAL_ALLOCATION' });
  });

  it('investor sees confirmed decision reflected in portfolio', async () => {
    const bff = bffClient(ctx, tenant);

    // TRIGGER 1: user action
    await bff.advisory.mutate('confirmDecision', { decisionId });

    // TRIGGER 2: simulate the downstream fill that would otherwise take real broker time
    await ctx.eventBridge.publish('ExecutionBus', 'ORDER_FILLED', {
      tenantId: tenant.tenantId,
      decisionId,
      orderId: 'synthetic-order-1',
      fillPriceCents: 15000,
      quantity: 10,
    });

    // ASSERT: portfolio holdings eventually reflect the fill
    const portfolio = await waitForGraphQL(
      bff.ledger,
      'getPortfolio',
      { tenantId: tenant.tenantId },
      (result) => result.holdings.length > 0,
    );
    expect(portfolio.holdings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbol: expect.any(String), quantity: expect.any(Number) }),
      ]),
    );

    // ASSERT: decision status updated
    const decision = await bff.advisory.query('getDecision', { decisionId });
    expect(decision.status).toBe('CONFIRMED');
  });
});
```

## 7. Third-Party Strategy — Always Real

The suite always runs against the **real vendor endpoints configured for the target sandbox**. No mocking, no CDK context flags, no test-level mode switches.

### Why
- Real integration is the point. Mocks agreeing with mocks does not validate business features.
- Per-service integration tests already cover mocked paths via `SsmOverrideFixture` + `MockApiFixture`. This suite has a different job.
- All 5 advisory adapters (`alpha-vantage`, `fred`, `marketwatch`, `sec-edgar`, `yahoo-finance`) currently have their SSM base-URL params set to real vendor URLs in the dev sandbox — already working without any change.

### Assertion style
- **Deterministic values** (deposit amounts, event counts, state transitions, record presence, user-supplied input): assert exact values.
- **Vendor-variable values** (fill prices, LLM-generated rationale, market quotes, timestamps, vendor IDs): assert shape and bounds only (`expect.any(Number)`, `toBeGreaterThan(0)`, `toMatchObject({...})`).

### Timeouts
5 minutes per test (`testTimeout: 300_000`). Sufficient for:
- Advisory cycle: 4 LangGraph agents + compliance check, typically 60–90 s
- Alpaca paper fills: 1–10 s
- Cross-domain CDC cascades: a few seconds per hop

## 8. Alpaca Paper Trading — Infrastructure Already in Place

### Per-prefix credential and endpoint isolation

`broker-alpaca-adpt` already supports full per-environment isolation:

| Prefix | Secret | SSM base URL |
|---|---|---|
| `dev` | `dev-broker-alpaca-adpt/alpaca-api-keys` | `/nestfolio/dev-broker-alpaca-adpt/alpaca/baseUrl` |
| `prod` | `prod-broker-alpaca-adpt/alpaca-api-keys` | `/nestfolio/prod-broker-alpaca-adpt/alpaca/baseUrl` |
| `sandbox-pr-N` | `sandbox-pr-N-broker-alpaca-adpt/...` | `/nestfolio/sandbox-pr-N-broker-alpaca-adpt/...` |

The adapter (`src/clients/alpaca.client.ts:32-48`) is a `fetch`-based HTTP client that accepts `baseUrl` + `apiKeyId` + `apiKeySecret` via constructor and delegates to native `fetch`. No SDK. Paper and live use the same REST surface (`/v2/orders`, `/v2/account`, etc.) — the only distinction is URL and credentials.

### Operational setup requirements (for dev sandbox)

Before running the e2e suite against dev, the following must be provisioned manually in AWS:
1. Secret `dev-broker-alpaca-adpt/alpaca-api-keys` populated with **paper-trading** credentials (paper keys begin with `PK`).
2. SSM parameter `/nestfolio/dev-broker-alpaca-adpt/alpaca/baseUrl` set to `https://paper-api.alpaca.markets`.

### Prerequisite code change: cold-start safety guard

Add a cold-start assertion to `services/execution/broker-alpaca-adpt/src/clients/alpaca.client.ts` constructor:

```ts
const PAPER_BASE_URLS = new Set(['https://paper-api.alpaca.markets']);
const LIVE_ALLOWED_PREFIXES = new Set(['prod']);

function assertAlpacaSafe(baseUrl: string, prefix: string): void {
  if (PAPER_BASE_URLS.has(baseUrl)) return;
  if (LIVE_ALLOWED_PREFIXES.has(prefix)) return;
  throw new Error(
    `broker-alpaca-adpt refuses to start: non-paper baseUrl '${baseUrl}' ` +
    `is not allowed in prefix '${prefix}'. Only 'prod' may use live Alpaca.`,
  );
}
```

The `prefix` value is already available as a Lambda env var (set by CDK at synth time per `service.stack.ts:28-31`). This check turns a misconfigured SSM value into a deploy-time failure rather than a silent real-trade execution during a test run.

**This is the only code change prerequisite for the entire e2e suite.**

## 9. Running the Suite

```bash
# Default — dev sandbox
pnpm nx run e2e-feature-tests:test-e2e-features

# Any other sandbox
NESTFOLIO_INTEG_PREFIX=sandbox-pr-123 pnpm nx run e2e-feature-tests:test-e2e-features

# Single feature folder
pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPattern=funding

# Single test file
pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPattern=fund-account
```

`maxWorkers: 1` in `jest.config.js` — sequential execution avoids rate-limit contention with vendor APIs and simplifies tenant cleanup reasoning.

### CI integration (deferred)
When the team is ready, add one step to `pr-deploy.yml`'s `sandbox-e2e-features` job after `sandbox-deploy`:
```yaml
- run: pnpm nx run e2e-feature-tests:test-e2e-features
  env:
    NESTFOLIO_INTEG_PREFIX: sandbox-pr-${{ github.event.pull_request.number }}
```
No suite refactoring required.

## 10. Risks & Trade-offs

- **Diagnostic poverty on failure.** A failed test tells you "the product is broken," not which internal component broke. Diagnosis drops back to per-service integration tests + logs. *Accepted:* this is an intentional consequence of black-box testing, and per-service tests cover the diagnosis gap.
- **Vendor availability coupling.** If Alpaca paper is down, the suite fails. *Accepted:* this is signal, not noise — if real vendors are down, business flows are also actually broken.
- **Non-deterministic values from LLMs and vendor APIs.** Assertions on such values must use shape matchers, not exact values. *Mitigated:* explicit rule in section 7.
- **Synthetic event fixtures could drift from real event schemas.** If a real producer changes an event shape without updating the fixture, tests might publish stale payloads. *Mitigated:* use `@nestfolio/event-types` branded types in all fixtures so a schema change breaks the fixture at compile time.
- **Paper Alpaca account state accumulation.** Orders, transfers, and positions accrue in the paper account across runs. *Mitigated:* a Jest `globalTeardown` hook runs `alpacaPaperReset()` at the end of every suite invocation, blanket-cancelling all open orders and closing all open positions against the paper endpoint. Starting balance still drifts due to accumulated P&L over time — a periodic manual dashboard reset remains an operational task.

## 11. Future Work (Not This Effort)

- Onboarding coverage via a dedicated LangGraph-interface test harness
- Market-data-refresh timestamp visibility on dashboard (if/when a `marketDataAsOf` field is added to read schemas)
- Periodic manual paper Alpaca dashboard reset (operational, monthly or when equity drift crosses a threshold)
- CI integration in `pr-deploy.yml`
- Playwright UI smoke layer on top of the e2e feature suite

## 12. Prerequisite Work Summary

Single prerequisite, to land in its own PR before the first e2e test file:

1. **Add cold-start safety guard to `broker-alpaca-adpt`** — `src/clients/alpaca.client.ts` constructor asserts baseUrl is paper-only unless prefix is `prod`. ~15 lines of code + a unit test.

Operational setup (not code, verified once before first run):
1. Provision `dev-broker-alpaca-adpt/alpaca-api-keys` secret with paper credentials.
2. Set `/nestfolio/dev-broker-alpaca-adpt/alpaca/baseUrl` to `https://paper-api.alpaca.markets`.

## 13. Decision Log

- **Goal:** business correctness, not wiring regression
- **Entry point:** GraphQL mutations (primary) + event publish (fallback for cascades)
- **Scope organization:** 13 user-feature scenarios, not 10 flow specs
- **Assertion layer:** GraphQL queries only; no DDB, no event traps
- **Third-party mode:** always real, per-sandbox credentials
- **CI mode:** manual-first, CI-ready by design
- **Metrics:** none; Jest assertions only
- **Flow specs in `flows/`:** retained as documentation of internal event topology; no longer the test index
