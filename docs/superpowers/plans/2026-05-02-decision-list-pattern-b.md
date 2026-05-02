# Decision-list Pattern B (Step 9 timing race) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts` Step 9 (`advisory.goToFirstPendingDecision()`) pass reliably (5/5 runs) without extending the 15s POM timeout, by making `DecisionListComponent` recover when the agent pipeline materialises a row *after* `/advisory` has already been mounted.

**Architecture:** Apply Pattern B (subscribe-on-navigation) to `decision-list.component.ts`, mirroring the shape that already ships in `decision-detail.component.ts`. The component attaches `onDecisionUpdate(tenantId)` in `ngOnInit` *before* it issues `getPendingDecisions`, then reconciles each broadcast frame against the current list (prepend-if-new-and-pending, update-in-place-if-known, remove-if-status-moved-out-of-pending). The Spec 5 broadcast pipeline (`services/advisory/advisory-bff/src/handlers/decision-publisher.ts`) already emits both INSERT and MODIFY frames per tenant, but its mutation payload omits `trigger` and `createdAt` — so Phase 1 extends the publisher to carry them, eliminating an asymmetry between `getPendingDecisions` (returns DECISION_LIST_FIELDS) and `onDecisionUpdate` (delivers a DecisionPacket whose subscription-projected fields depend on what the publishing mutation populated).

**Tech Stack:** Angular 21 (standalone, signals), `@nestfolio/shell` GraphqlService (Apollo + AppSync WSS), AWS AppSync (`@aws_subscribe`), AWS Lambda (`broadcastFromStream` from `@nestfolio/event-processor`), Jest (component + service unit), Playwright (e2e gate).

**Spec:** `docs/BACKLOG.md` § QUEUED entry "Journey Step 9 — decision-list empty on first query (timing race)" — already explicit on Done-when, mechanism, and chosen Pattern B fix; serves as the spec for this plan.

**Validation gate:** `pnpm nx run nestfolio-e2e:e2e --skip-nx-cache` against deployed dev — Step 9 reaches the rationale wait in **5 consecutive runs**. **No POM changes ship** (per `feedback_e2e_ui_assertions_only.md` — the 15s timeout is the contract; the UI must meet it).

---

## Out of scope

- **Step 8 dashboard WSS subscription bug** — separate QUEUED entry, separate failure mechanism (sentinel value not arriving via subscriber gating logic). Do not touch `dashboard-bff` / `AdvisoryAlertBar` in this plan.
- **`deposit-page.component.ts` Pattern A → B refactor** — already filed in PARKING LOT; touches a different MFE.
- **Decision-detail full-replace dropping null fields** (`confirmedAt`, `rejectedAt`, `rejectionReason`, `confirmationRequired` are missing from `publishDecisionUpdate` payload — same root cause as Phase 1 here). File a PARKING LOT entry during boundary review; do not address in this plan since decision-detail's e2e has been green.
- **Generalising the AppSync subscription pattern into a shared lib** — already a PARKING LOT item ("rule-of-three" — currently two callers in `advisory.service.ts`, third would trip the threshold). Not yet.
- **Adding `version` to `DecisionListFields`** — the BACKLOG entry explicitly says "no version-guard race-prevention needed" for tenant-scoped lists. Trust that decision; the reconciler does not depend on version at the list tier.
- **Polling fallback** — explicitly off the table per `feedback_e2e_ui_assertions_only.md`.

---

## File structure

**Create:** none.

**Modify:**

| Layer | File | Responsibility |
|---|---|---|
| Schema | `services/advisory/advisory-bff/src/schema.graphql` | Add `trigger: String!` + `createdAt: String!` to `publishDecisionUpdate` Mutation args |
| Backend handler | `services/advisory/advisory-bff/src/handlers/decision-publisher.ts` | Extend `PUBLISH_DECISION_UPDATE` mutation document + `mapImage` to project the two new fields |
| Backend test | `services/advisory/advisory-bff/test/unit/handlers/decision-publisher.test.ts` | Assert the new fields appear in the call variables |
| Frontend service | `apps/advisory-mfe/src/app/services/advisory.service.ts` | Add `subscribeToDecisionListUpdates(tenantId, callback)` + `unsubscribeFromDecisionListUpdates()` (no decisionId filter) |
| Frontend service test | `apps/advisory-mfe/test/app/services/advisory.service.spec.ts` | Cover new subscription method (subscribe / unsubscribe / reconnect) |
| Frontend component | `apps/advisory-mfe/src/app/decision-list/decision-list.component.ts` | Implement `OnDestroy`; attach subscription before query; reconcile frames; `PENDING_STATUSES` constant |
| Frontend component test | `apps/advisory-mfe/test/app/decision-list/decision-list.component.spec.ts` | Cover Pattern B behaviours (subscribe-before-query, prepend, update-in-place, terminal-removal, unsubscribe, no-tenant guard) |

The `apps/advisory-mfe/src/app/graphql/advisory-bff.queries.ts` `ON_DECISION_UPDATE` query already returns the full `DecisionFields` fragment — no GraphQL document changes needed; the schema-level addition in Phase 1 simply causes the existing fragment fields to be populated for IAM-published broadcasts.

---

## Phase 1 — Backend payload extension

### Task 1: Carry `trigger` + `createdAt` through `publishDecisionUpdate`

**Files:**
- Modify: `services/advisory/advisory-bff/src/schema.graphql:13-21`
- Modify: `services/advisory/advisory-bff/src/handlers/decision-publisher.ts:8-58`
- Modify: `services/advisory/advisory-bff/test/unit/handlers/decision-publisher.test.ts:44-72`

**Why:** `publishDecisionUpdate` is the IAM-only mutation the CDC publisher fires on every `DecisionReadModel` change. AppSync's `@aws_subscribe` projects to subscribers only the fields the publishing mutation populated. The existing payload omits `trigger` and `createdAt` — both required to render a `PendingDecisionListItem` for a brand-new row that arrives via subscription. The other two re-broadcast paths (`confirmDecision`, `rejectDecision`) already return full `DecisionPacket` because they read back through DDB, so this only affects the IAM-published broadcast.

- [ ] **Step 1: Update the unit test to assert the new fields**

In `services/advisory/advisory-bff/test/unit/handlers/decision-publisher.test.ts`, extend the first test case (line 44) to seed `trigger` + `createdAt` in both images and assert both come through in `call.variables`:

```ts
  it('broadcasts when DecisionReadModel.status flips to AWAITING_CONFIRMATION', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { sk: 'DecisionReadModel', decisionId: 'd1', tenantId: 't1', status: 'PENDING', explanation: '', version: 1, trigger: 'PORTFOLIO_DRIFT', createdAt: '2026-05-02T00:00:00Z' },
      newImage: { sk: 'DecisionReadModel', decisionId: 'd1', tenantId: 't1', status: 'AWAITING_CONFIRMATION', explanation: 'rationale', version: 2, updatedAt: '2026-05-02T00:00:01Z', trigger: 'PORTFOLIO_DRIFT', createdAt: '2026-05-02T00:00:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables).toMatchObject({
      decisionId: 'd1', tenantId: 't1', status: 'AWAITING_CONFIRMATION',
      explanation: 'rationale', version: 2,
      trigger: 'PORTFOLIO_DRIFT',
      createdAt: '2026-05-02T00:00:00Z',
    });
  });
```

Also extend the INSERT case (line 67) so the seeded image carries `trigger` + `createdAt` and add `expect(call.variables).toMatchObject({ trigger: 'PORTFOLIO_DRIFT', createdAt: '2026-05-02T00:00:00Z' });`:

```ts
  it('broadcasts on INSERT (initial materialisation visible to early subscribers)', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: { sk: 'DecisionReadModel', decisionId: 'd1', tenantId: 't1', status: 'PENDING', explanation: '', version: 1, updatedAt: '2026-05-02T00:00:00Z', trigger: 'PORTFOLIO_DRIFT', createdAt: '2026-05-02T00:00:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables).toMatchObject({ trigger: 'PORTFOLIO_DRIFT', createdAt: '2026-05-02T00:00:00Z' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run advisory-bff:test --testPathPattern decision-publisher`
Expected: FAIL — `expect(received).toMatchObject(expected)` reports `trigger`/`createdAt` missing on the actual call variables.

- [ ] **Step 3: Extend the schema**

In `services/advisory/advisory-bff/src/schema.graphql`, add the two new args to `publishDecisionUpdate`:

```graphql
  publishDecisionUpdate(
    decisionId: ID!
    tenantId: ID!
    status: DecisionStatus!
    trigger: String!
    explanation: String!
    proposedTrades: [ProposedTradeInput!]!
    version: Int!
    createdAt: String!
    updatedAt: String!
  ): DecisionPacket! @aws_iam
```

- [ ] **Step 4: Extend the publisher handler**

In `services/advisory/advisory-bff/src/handlers/decision-publisher.ts`, update the mutation document and `mapImage`:

```ts
const PUBLISH_DECISION_UPDATE = `
  mutation PublishDecisionUpdate(
    $decisionId: ID!
    $tenantId: ID!
    $status: DecisionStatus!
    $trigger: String!
    $explanation: String!
    $proposedTrades: [ProposedTradeInput!]!
    $version: Int!
    $createdAt: String!
    $updatedAt: String!
  ) {
    publishDecisionUpdate(
      decisionId: $decisionId
      tenantId: $tenantId
      status: $status
      trigger: $trigger
      explanation: $explanation
      proposedTrades: $proposedTrades
      version: $version
      createdAt: $createdAt
      updatedAt: $updatedAt
    ) {
      decisionId
      tenantId
      status
      trigger
      explanation
      proposedTrades { symbol assetClass side quantityOrAmountCents targetWeightPercent rationale }
      version
      createdAt
      updatedAt
    }
  }
`;

export const handler = broadcastFromStream({
  serviceName: 'advisory-bff',
  appsyncUrl: APPSYNC_URL,
  region: process.env['AWS_REGION'],
  broadcasts: {
    DecisionReadModel: {
      mutation: PUBLISH_DECISION_UPDATE,
      whenChanged: ['status', 'explanation', 'proposedTrades', 'version'],
      mapImage: (item) => ({
        decisionId: String(item['decisionId'] ?? ''),
        tenantId: String(item['tenantId'] ?? ''),
        status: String(item['status'] ?? ''),
        trigger: String(item['trigger'] ?? ''),
        explanation: String(item['explanation'] ?? ''),
        proposedTrades: Array.isArray(item['proposedTrades']) ? item['proposedTrades'] : [],
        version: Number(item['version'] ?? 0),
        createdAt: String(item['createdAt'] ?? ''),
        updatedAt: String(item['updatedAt'] ?? new Date().toISOString()),
      }),
    },
  },
});
```

`whenChanged` stays as-is — `trigger` and `createdAt` are immutable per row, so they should never trigger a broadcast on their own; they ride along on every broadcast as ambient context.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm nx run advisory-bff:test --testPathPattern decision-publisher`
Expected: PASS — both updated test cases green; the `skips MODIFY when no UI-relevant field changed` and `skips records with sk other than DecisionReadModel` cases unchanged.

- [ ] **Step 6: Verify CDK synth and the wider test suite**

Run: `pnpm nx run advisory-bff:test`
Expected: PASS — all advisory-bff unit tests green (no transform or repository test depends on the publisher).

Run: `pnpm nx run advisory-bff:synth`
Expected: PASS — the CDK template regenerates without errors. The schema asset hash will change.

- [ ] **Step 7: Commit**

```bash
git add services/advisory/advisory-bff/src/schema.graphql \
        services/advisory/advisory-bff/src/handlers/decision-publisher.ts \
        services/advisory/advisory-bff/test/unit/handlers/decision-publisher.test.ts
git commit -m "feat(advisory-bff): carry trigger + createdAt through publishDecisionUpdate broadcast"
```

---

## Phase 2 — Frontend service: list-tier subscription

### Task 2: Add `subscribeToDecisionListUpdates` / `unsubscribeFromDecisionListUpdates`

**Files:**
- Modify: `apps/advisory-mfe/src/app/services/advisory.service.ts:41-92`
- Modify: `apps/advisory-mfe/test/app/services/advisory.service.spec.ts` (append new `describe` block)

**Why:** The existing `subscribeToDecisionUpdates(tenantId, decisionId, callback)` filters frames by `decisionId` (line 64) — perfect for decision-detail, useless for the list. The list needs *every* tenant frame. Two parallel subscriptions to the same WSS channel are safe (AppSync multiplexes); the symmetry across two near-identical methods is a known cost flagged in the "rule-of-three" PARKING LOT entry. Defer DRY-up until a third caller appears.

- [ ] **Step 1: Write the failing tests**

Append to `apps/advisory-mfe/test/app/services/advisory.service.spec.ts` (after line 238, inside the existing `describe('AdvisoryService', ...)` block):

```ts
  describe('subscribeToDecisionListUpdates', () => {
    it('subscribes with tenantId as the GraphQL variable', () => {
      const mockUnsubscribe = jest.fn();
      const mockSubscribe = jest.fn().mockReturnValue({ unsubscribe: mockUnsubscribe });
      graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

      service.subscribeToDecisionListUpdates('t-abc', () => undefined);

      expect(graphql.subscribe).toHaveBeenCalledWith(expect.any(String), { tenantId: 't-abc' });
      expect(mockSubscribe).toHaveBeenCalled();
    });

    it('fires the callback for every frame (no decisionId filter)', () => {
      const cb = jest.fn();
      let nextHandler!: (data: { onDecisionUpdate: { decisionId: string; tenantId: string } }) => void;
      const mockSubscribe = jest.fn().mockImplementation((handlers: any) => {
        nextHandler = handlers.next;
        return { unsubscribe: jest.fn() };
      });
      graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

      service.subscribeToDecisionListUpdates('t-001', cb);

      nextHandler({ onDecisionUpdate: { decisionId: 'a', tenantId: 't-001' } as any });
      nextHandler({ onDecisionUpdate: { decisionId: 'b', tenantId: 't-001' } as any });

      expect(cb).toHaveBeenCalledTimes(2);
      expect(cb.mock.calls[0][0].decisionId).toBe('a');
      expect(cb.mock.calls[1][0].decisionId).toBe('b');
    });

    it('unsubscribes cleanly', () => {
      const mockUnsubscribe = jest.fn();
      const mockSubscribe = jest.fn().mockReturnValue({ unsubscribe: mockUnsubscribe });
      graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

      service.subscribeToDecisionListUpdates('t-001', jest.fn());
      service.unsubscribeFromDecisionListUpdates();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    it('does not throw when unsubscribing without an active list subscription', () => {
      expect(() => service.unsubscribeFromDecisionListUpdates()).not.toThrow();
    });

    it('reconnects with backoff after a subscription error', () => {
      jest.useFakeTimers();
      let errorHandler!: (err: Error) => void;
      const mockSubscribe = jest.fn().mockImplementation((handlers: any) => {
        errorHandler = handlers.error;
        return { unsubscribe: jest.fn() };
      });
      graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

      service.subscribeToDecisionListUpdates('t-001', jest.fn());
      expect(graphql.subscribe).toHaveBeenCalledTimes(1);

      errorHandler(new Error('connection lost'));
      jest.advanceTimersByTime(5000);
      expect(graphql.subscribe).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('list and detail subscriptions coexist independently', () => {
      const mockSubscribe = jest.fn().mockReturnValue({ unsubscribe: jest.fn() });
      graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

      service.subscribeToDecisionUpdates('t-001', 'dec-001', jest.fn());
      service.subscribeToDecisionListUpdates('t-001', jest.fn());

      // Two independent subscriptions on the same WSS channel.
      expect(graphql.subscribe).toHaveBeenCalledTimes(2);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx run advisory-mfe:test --testPathPattern advisory.service`
Expected: FAIL — `service.subscribeToDecisionListUpdates is not a function` (and matching for the unsubscribe).

- [ ] **Step 3: Add the new methods to AdvisoryService**

In `apps/advisory-mfe/src/app/services/advisory.service.ts`, add two new private fields next to the existing decisionId-coupled subscription state (after line 44, near `MAX_RECONNECT_ATTEMPTS`):

```ts
  private listSubscription: Subscription | null = null;
  private listReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private listReconnectAttempts = 0;
```

Then add the two new public methods + a private `doSubscribeToList` (insert immediately after the existing `unsubscribeFromDecisionUpdates()`, before line 94):

```ts
  subscribeToDecisionListUpdates(
    tenantId: string,
    onUpdate: (decision: Decision) => void,
  ): void {
    this.unsubscribeFromDecisionListUpdates();
    this.listReconnectAttempts = 0;
    this.doSubscribeToList(tenantId, onUpdate);
  }

  private doSubscribeToList(
    tenantId: string,
    onUpdate: (decision: Decision) => void,
  ): void {
    const obs = this.graphql.subscribe<{ onDecisionUpdate: Decision }>(ON_DECISION_UPDATE, { tenantId });
    this.listSubscription = obs.subscribe({
      next: (data) => {
        if (data.onDecisionUpdate) {
          this.listReconnectAttempts = 0;
          onUpdate(data.onDecisionUpdate);
        }
      },
      error: (err) => {
        // eslint-disable-next-line no-console
        console.error('Decision list subscription error', err);
        if (this.listReconnectAttempts < AdvisoryService.MAX_RECONNECT_ATTEMPTS) {
          this.listReconnectAttempts++;
          const delay = Math.min(5000 * Math.pow(2, this.listReconnectAttempts - 1), 30_000);
          this.listReconnectTimeout = setTimeout(() => this.doSubscribeToList(tenantId, onUpdate), delay);
        }
      },
    });
  }

  unsubscribeFromDecisionListUpdates(): void {
    if (this.listReconnectTimeout !== null) {
      clearTimeout(this.listReconnectTimeout);
      this.listReconnectTimeout = null;
    }
    this.listReconnectAttempts = 0;
    if (this.listSubscription) {
      this.listSubscription.unsubscribe();
      this.listSubscription = null;
    }
  }
```

No changes to `invalidateCaches` or any other method — the list subscription is independent of the per-decision query caches.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx run advisory-mfe:test --testPathPattern advisory.service`
Expected: PASS — all 6 new test cases green; existing 20+ AdvisoryService tests still pass (no regression because the new fields are net-additive).

- [ ] **Step 5: Commit**

```bash
git add apps/advisory-mfe/src/app/services/advisory.service.ts \
        apps/advisory-mfe/test/app/services/advisory.service.spec.ts
git commit -m "feat(advisory-mfe): add subscribeToDecisionListUpdates (no-decisionId-filter sibling)"
```

---

## Phase 3 — Frontend list component: Pattern B

### Task 3: Subscribe-before-query in `ngOnInit`

**Files:**
- Modify: `apps/advisory-mfe/src/app/decision-list/decision-list.component.ts:1-14, 123-144`
- Modify: `apps/advisory-mfe/test/app/decision-list/decision-list.component.spec.ts:25-50, 88-94`

**Why:** Same R1 invariant as decision-detail (`decision-detail.component.ts:373-382`): the subscription must be live before the query fires, so any frame that arrives during query resolution is captured rather than lost.

- [ ] **Step 1: Write the failing test**

Update the `beforeEach` in `apps/advisory-mfe/test/app/decision-list/decision-list.component.spec.ts` to provide `AuthStore` and the new mock methods, then add the subscribe-before-query test. Replace lines 1-50 with:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18nService } from '@nestfolio/shell/i18n';
import { AuthStore } from '@nestfolio/shell';
import { DecisionListComponent } from '../../../src/app/decision-list/decision-list.component';
import {
  AdvisoryService,
  PendingDecisionListItem,
} from '../../../src/app/services/advisory.service';
import type { Decision } from '../../../src/app/stores/advisory.store';

const mockItems: PendingDecisionListItem[] = [
  {
    decisionId: 'd0000000-0000-0000-0000-000000000001',
    status: 'AWAITING_CONFIRMATION',
    trigger: 'PORTFOLIO_DRIFT',
    createdAt: '2026-04-30T10:00:00Z',
  },
  {
    decisionId: 'd0000000-0000-0000-0000-000000000002',
    status: 'COMPLIANCE_REVIEW',
    trigger: 'DEPOSIT_DETECTED',
    createdAt: '2026-04-30T10:05:00Z',
  },
];

function frame(overrides: Partial<Decision>): Decision {
  return {
    decisionId: 'd-frame',
    tenantId: 'tenant-1',
    trigger: 'PORTFOLIO_DRIFT',
    status: 'COMPLIANCE_REVIEW',
    explanation: '',
    proposedTrades: [],
    confirmationRequired: false,
    confirmedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    version: 1,
    createdAt: '2026-04-30T10:10:00Z',
    updatedAt: '2026-04-30T10:10:00Z',
    ...overrides,
  };
}

describe('DecisionListComponent', () => {
  let fixture: ComponentFixture<DecisionListComponent>;
  let component: DecisionListComponent;
  let advisoryService: jest.Mocked<AdvisoryService>;

  beforeEach(async () => {
    advisoryService = {
      getPendingDecisions: jest.fn().mockResolvedValue(mockItems),
      subscribeToDecisionListUpdates: jest.fn(),
      unsubscribeFromDecisionListUpdates: jest.fn(),
    } as unknown as jest.Mocked<AdvisoryService>;

    await TestBed.configureTestingModule({
      imports: [DecisionListComponent],
      providers: [
        provideRouter([]),
        { provide: AdvisoryService, useValue: advisoryService },
        { provide: I18nService, useValue: { t: (k: string) => k } },
        {
          provide: AuthStore,
          useValue: { user: () => ({ tenantId: 'tenant-1', userId: 'u', username: 'u', email: 'e' }) },
        },
      ],
    })
      .overrideComponent(DecisionListComponent, {
        set: { template: '<div>test</div>', imports: [], styles: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DecisionListComponent);
    component = fixture.componentInstance;
  });
```

Then append (right after the existing `should map status to severity` test at line 94):

```ts
  it('attaches the list subscription BEFORE issuing getPendingDecisions', async () => {
    const callOrder: string[] = [];
    advisoryService.subscribeToDecisionListUpdates.mockImplementation(() => {
      callOrder.push('subscribe');
    });
    advisoryService.getPendingDecisions.mockImplementation(async () => {
      callOrder.push('getPendingDecisions');
      return mockItems;
    });

    await component.ngOnInit();

    const subIdx = callOrder.indexOf('subscribe');
    const queryIdx = callOrder.indexOf('getPendingDecisions');
    expect(subIdx).toBeGreaterThanOrEqual(0);
    expect(queryIdx).toBeGreaterThanOrEqual(0);
    expect(subIdx).toBeLessThan(queryIdx);
  });

  it('passes tenantId from authStore to subscribeToDecisionListUpdates', async () => {
    await component.ngOnInit();

    expect(advisoryService.subscribeToDecisionListUpdates).toHaveBeenCalledWith(
      'tenant-1',
      expect.any(Function),
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx run advisory-mfe:test --testPathPattern decision-list`
Expected: FAIL — `subscribeToDecisionListUpdates` is never called by the component, so the order assertion fails (`subIdx === -1`).

- [ ] **Step 3: Wire subscription-before-query in the component**

Replace the imports and class body of `apps/advisory-mfe/src/app/decision-list/decision-list.component.ts` (lines 1-14 + 123-144). New imports:

```ts
import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  EmptyStateComponent,
  LoadingSkeletonComponent,
  StatusBadgeComponent,
} from '@nestfolio/ui';
import { I18nService } from '@nestfolio/shell/i18n';
import { AuthStore, parseError } from '@nestfolio/shell';
import {
  AdvisoryService,
  type PendingDecisionListItem,
} from '../services/advisory.service';
import type { Decision } from '../stores/advisory.store';
```

Replace `implements OnInit` with `implements OnInit, OnDestroy`, add `private readonly authStore = inject(AuthStore);` next to the other `inject(...)` lines, then replace the entire `ngOnInit` body with:

```ts
  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    const tenantId = this.authStore.user()?.tenantId;
    if (tenantId) {
      // Pattern B (R1): attach subscription BEFORE the query fires so any frame
      // that arrives during query resolution is reconciled, not lost.
      this.advisoryService.subscribeToDecisionListUpdates(tenantId, (frame) =>
        this.reconcile(frame),
      );
    }

    try {
      const items = await this.advisoryService.getPendingDecisions();
      this.decisions.set(items);
      this.loaded.set(true);
    } catch (e: unknown) {
      this.error.set(parseError(e, 'errors.decision'));
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.advisoryService.unsubscribeFromDecisionListUpdates();
  }

  private reconcile(_frame: Decision): void {
    // Reconciliation logic added in Tasks 4-6.
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx run advisory-mfe:test --testPathPattern decision-list`
Expected: PASS — both new tests pass; existing 5 tests still pass (the existing `should load pending decisions on init` test still resolves because `getPendingDecisions` is still called).

- [ ] **Step 5: Commit**

```bash
git add apps/advisory-mfe/src/app/decision-list/decision-list.component.ts \
        apps/advisory-mfe/test/app/decision-list/decision-list.component.spec.ts
git commit -m "feat(advisory-mfe): decision-list subscribe-before-query (Pattern B scaffold)"
```

---

### Task 4: Reconcile — prepend on unknown decisionId in pending status

**Files:**
- Modify: `apps/advisory-mfe/src/app/decision-list/decision-list.component.ts` (extend `reconcile`)
- Modify: `apps/advisory-mfe/test/app/decision-list/decision-list.component.spec.ts` (append)

**Why:** This is the load-bearing branch for Step 9. The agent pipeline materialises a `DecisionReadModel` row after the user has already landed on `/advisory`; the broadcast frame for that row arrives via the WSS subscription; the list must prepend it.

- [ ] **Step 1: Write the failing test**

Append to `apps/advisory-mfe/test/app/decision-list/decision-list.component.spec.ts`:

```ts
  it('prepends a frame for an unknown decisionId in a pending status', async () => {
    let cb!: (d: Decision) => void;
    advisoryService.subscribeToDecisionListUpdates.mockImplementation(
      (_tenantId: string, fn: (d: Decision) => void) => {
        cb = fn;
      },
    );
    advisoryService.getPendingDecisions.mockResolvedValue([mockItems[0]]);

    await component.ngOnInit();
    expect(component.decisions()).toHaveLength(1);

    cb(frame({
      decisionId: 'd-new',
      status: 'COMPLIANCE_REVIEW',
      trigger: 'DEPOSIT_DETECTED',
      createdAt: '2026-04-30T10:20:00Z',
    }));

    expect(component.decisions().map((d) => d.decisionId)).toEqual(['d-new', mockItems[0].decisionId]);
    expect(component.decisions()[0]).toEqual({
      decisionId: 'd-new',
      status: 'COMPLIANCE_REVIEW',
      trigger: 'DEPOSIT_DETECTED',
      createdAt: '2026-04-30T10:20:00Z',
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run advisory-mfe:test --testPathPattern decision-list`
Expected: FAIL — `reconcile` is a no-op so `decisions()` length stays at 1.

- [ ] **Step 3: Implement the prepend branch + PENDING_STATUSES constant**

In `apps/advisory-mfe/src/app/decision-list/decision-list.component.ts`, add a static constant on the class (just below `readonly error = signal<string | null>(null);` near line 130) — **mirrors the backend filter set in `services/advisory/advisory-bff/src/graphql/js-function/get-pending-decisions.fn.js:23-29`**:

```ts
  // Mirrors services/advisory/advisory-bff/src/graphql/js-function/get-pending-decisions.fn.js
  // — keep in sync if backend filter changes.
  private static readonly PENDING_STATUSES = new Set<string>([
    'PENDING',
    'DRAFT',
    'PROPOSED',
    'COMPLIANCE_REVIEW',
    'APPROVED',
    'CONFIRMATION_REQUIRED',
    'AWAITING_CONFIRMATION',
  ]);
```

Replace the placeholder `reconcile` body with the prepend branch:

```ts
  private reconcile(frame: Decision): void {
    const current = this.decisions();
    const idx = current.findIndex((d) => d.decisionId === frame.decisionId);
    const isPending = DecisionListComponent.PENDING_STATUSES.has(frame.status);

    if (idx === -1 && isPending) {
      this.decisions.set([
        {
          decisionId: frame.decisionId,
          status: frame.status,
          trigger: frame.trigger,
          createdAt: frame.createdAt,
        },
        ...current,
      ]);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run advisory-mfe:test --testPathPattern decision-list`
Expected: PASS — the new prepend test passes; all earlier tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/advisory-mfe/src/app/decision-list/decision-list.component.ts \
        apps/advisory-mfe/test/app/decision-list/decision-list.component.spec.ts
git commit -m "feat(advisory-mfe): decision-list reconcile prepends new pending rows"
```

---

### Task 5: Reconcile — update in place when frame matches existing decisionId

**Files:**
- Modify: `apps/advisory-mfe/src/app/decision-list/decision-list.component.ts` (extend `reconcile`)
- Modify: `apps/advisory-mfe/test/app/decision-list/decision-list.component.spec.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
  it('updates in place when frame matches an existing decisionId still pending', async () => {
    let cb!: (d: Decision) => void;
    advisoryService.subscribeToDecisionListUpdates.mockImplementation(
      (_t: string, fn: (d: Decision) => void) => { cb = fn; },
    );
    advisoryService.getPendingDecisions.mockResolvedValue([
      { ...mockItems[0], status: 'COMPLIANCE_REVIEW' },
    ]);

    await component.ngOnInit();

    cb(frame({
      decisionId: mockItems[0].decisionId,
      status: 'AWAITING_CONFIRMATION',
      trigger: mockItems[0].trigger,
      createdAt: mockItems[0].createdAt,
    }));

    expect(component.decisions()).toHaveLength(1);
    expect(component.decisions()[0].status).toBe('AWAITING_CONFIRMATION');
    expect(component.decisions()[0].decisionId).toBe(mockItems[0].decisionId);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run advisory-mfe:test --testPathPattern decision-list`
Expected: FAIL — the existing branch only handles `idx === -1 && isPending`; the matching-decisionId case is silently dropped, so `status` stays at `COMPLIANCE_REVIEW`.

- [ ] **Step 3: Implement the update-in-place branch**

Extend `reconcile` in `apps/advisory-mfe/src/app/decision-list/decision-list.component.ts`:

```ts
  private reconcile(frame: Decision): void {
    const current = this.decisions();
    const idx = current.findIndex((d) => d.decisionId === frame.decisionId);
    const isPending = DecisionListComponent.PENDING_STATUSES.has(frame.status);

    if (idx === -1) {
      if (isPending) {
        this.decisions.set([
          {
            decisionId: frame.decisionId,
            status: frame.status,
            trigger: frame.trigger,
            createdAt: frame.createdAt,
          },
          ...current,
        ]);
      }
      // Terminal-status frame for an unknown decisionId — ignore.
      return;
    }

    if (isPending) {
      const next = [...current];
      next[idx] = {
        ...current[idx],
        status: frame.status,
        // trigger ride-along: defensive in case a partial frame ever leaks in.
        trigger: frame.trigger || current[idx].trigger,
      };
      this.decisions.set(next);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run advisory-mfe:test --testPathPattern decision-list`
Expected: PASS — both new tests pass; older tests stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/advisory-mfe/src/app/decision-list/decision-list.component.ts \
        apps/advisory-mfe/test/app/decision-list/decision-list.component.spec.ts
git commit -m "feat(advisory-mfe): decision-list reconcile updates in place"
```

---

### Task 6: Reconcile — remove on terminal status; ignore unknown terminal frames

**Files:**
- Modify: `apps/advisory-mfe/src/app/decision-list/decision-list.component.ts` (extend `reconcile`)
- Modify: `apps/advisory-mfe/test/app/decision-list/decision-list.component.spec.ts` (append)

**Why:** When the user (or anyone) confirms/rejects a decision elsewhere, the broadcast frame's `status` is `CONFIRMED`/`REJECTED`/`FILLED`/etc. The list must drop the row, mirroring the backend's `getPendingDecisions` filter.

- [ ] **Step 1: Write the failing tests**

```ts
  it('removes a row when its frame status moves to a terminal value', async () => {
    let cb!: (d: Decision) => void;
    advisoryService.subscribeToDecisionListUpdates.mockImplementation(
      (_t: string, fn: (d: Decision) => void) => { cb = fn; },
    );
    advisoryService.getPendingDecisions.mockResolvedValue([
      mockItems[0],
      mockItems[1],
    ]);

    await component.ngOnInit();
    expect(component.decisions().map((d) => d.decisionId))
      .toEqual([mockItems[0].decisionId, mockItems[1].decisionId]);

    cb(frame({ decisionId: mockItems[0].decisionId, status: 'CONFIRMED' }));

    expect(component.decisions().map((d) => d.decisionId)).toEqual([mockItems[1].decisionId]);
  });

  it('ignores a frame for an unknown decisionId in a terminal status', async () => {
    let cb!: (d: Decision) => void;
    advisoryService.subscribeToDecisionListUpdates.mockImplementation(
      (_t: string, fn: (d: Decision) => void) => { cb = fn; },
    );
    advisoryService.getPendingDecisions.mockResolvedValue([mockItems[0]]);

    await component.ngOnInit();

    cb(frame({ decisionId: 'never-seen', status: 'CONFIRMED' }));

    expect(component.decisions().map((d) => d.decisionId)).toEqual([mockItems[0].decisionId]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx run advisory-mfe:test --testPathPattern decision-list`
Expected: FAIL — the first new test (the removal one) fails because `reconcile` currently has no `idx >= 0 && !isPending` branch; the second test passes already (early return on unknown terminal) but include both for coverage symmetry.

- [ ] **Step 3: Implement the terminal-removal branch**

Extend `reconcile`:

```ts
  private reconcile(frame: Decision): void {
    const current = this.decisions();
    const idx = current.findIndex((d) => d.decisionId === frame.decisionId);
    const isPending = DecisionListComponent.PENDING_STATUSES.has(frame.status);

    if (idx === -1) {
      if (isPending) {
        this.decisions.set([
          {
            decisionId: frame.decisionId,
            status: frame.status,
            trigger: frame.trigger,
            createdAt: frame.createdAt,
          },
          ...current,
        ]);
      }
      return;
    }

    if (!isPending) {
      this.decisions.set(current.filter((_, i) => i !== idx));
      return;
    }

    const next = [...current];
    next[idx] = {
      ...current[idx],
      status: frame.status,
      trigger: frame.trigger || current[idx].trigger,
    };
    this.decisions.set(next);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx run advisory-mfe:test --testPathPattern decision-list`
Expected: PASS — all four reconcile tests (prepend, update-in-place, terminal-remove, unknown-terminal-ignore) green.

- [ ] **Step 5: Commit**

```bash
git add apps/advisory-mfe/src/app/decision-list/decision-list.component.ts \
        apps/advisory-mfe/test/app/decision-list/decision-list.component.spec.ts
git commit -m "feat(advisory-mfe): decision-list reconcile removes rows on terminal status"
```

---

### Task 7: Unsubscribe on destroy + tenant-missing guard

**Files:**
- Modify: `apps/advisory-mfe/test/app/decision-list/decision-list.component.spec.ts` (append)

**Why:** `unsubscribeFromDecisionListUpdates` was wired in Task 3; this task locks the lifecycle contract with explicit assertions. The tenant-missing guard test verifies the Task 3 implementation doesn't attempt to subscribe with `undefined` tenantId.

- [ ] **Step 1: Write the failing tests**

```ts
  it('unsubscribes from decision list updates on destroy', async () => {
    await component.ngOnInit();

    component.ngOnDestroy();

    expect(advisoryService.unsubscribeFromDecisionListUpdates).toHaveBeenCalled();
  });

  it('skips subscription when authStore has no tenantId (still issues query)', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [DecisionListComponent],
      providers: [
        provideRouter([]),
        { provide: AdvisoryService, useValue: advisoryService },
        { provide: I18nService, useValue: { t: (k: string) => k } },
        { provide: AuthStore, useValue: { user: () => null } },
      ],
    })
      .overrideComponent(DecisionListComponent, {
        set: { template: '<div>test</div>', imports: [], styles: [] },
      })
      .compileComponents();

    const f = TestBed.createComponent(DecisionListComponent);
    await f.componentInstance.ngOnInit();

    expect(advisoryService.subscribeToDecisionListUpdates).not.toHaveBeenCalled();
    expect(advisoryService.getPendingDecisions).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify state**

Run: `pnpm nx run advisory-mfe:test --testPathPattern decision-list`
Expected: PASS — both tests should already pass given Task 3's implementation. If either fails, the implementation needs adjusting (this is a regression net on the lifecycle contract, not a new feature).

- [ ] **Step 3: Run the full advisory-mfe unit suite**

Run: `pnpm nx run advisory-mfe:test`
Expected: PASS — full suite green; no decision-detail or store regressions.

- [ ] **Step 4: Lint + typecheck**

Run: `pnpm nx run advisory-mfe:lint`
Expected: PASS — no new lint warnings.

Run: `pnpm nx run advisory-mfe:build`
Expected: PASS — production bundle builds without TS errors.

- [ ] **Step 5: Commit**

```bash
git add apps/advisory-mfe/test/app/decision-list/decision-list.component.spec.ts
git commit -m "test(advisory-mfe): lock decision-list lifecycle + tenant-guard contract"
```

---

## Phase 4 — Validation

### Task 8: Deploy to dev + 5x e2e gate

**Files:**
- Run-only — no code changes.

**Why:** The Done-when in the BACKLOG entry is "5/5 runs without extending the 15s POM timeout". Per `feedback_e2e_ui_assertions_only.md`, e2e is the proof-of-life; unit tests alone are not sufficient.

- [ ] **Step 1: Deploy advisory-bff (Phase 1 schema + handler change)**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-bff`
Expected: CFN update completes; the new `publishDecisionUpdate` schema args + Lambda code are live. Watch CloudWatch `aws logs tail /aws/lambda/dev-advisory-bff-DecisionPublisher --follow` for one cycle to confirm healthy.

- [ ] **Step 2: Build + deploy investor-web (Phase 2 + 3 frontend changes ride in the shell host bundle)**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web`
Expected: CloudFront invalidation completes. Verify the new bundle is served:

```bash
curl -s https://<dev-host>/main-*.js | head -c 200
```

(The MFE host invalidates `/index.html` and `/main.*.js`; the advisory-mfe remoteEntry under `/mfe/advisory/` is republished by the same deploy because advisory-mfe has its own MFE bucket — verify with `aws s3 ls s3://771924376645-dev-nestfolio-mfe-advisory/`.)

- [ ] **Step 3: Run the e2e suite once for shake-out**

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm nx run nestfolio-e2e:e2e --skip-nx-cache --grep "new-investor-happy-path"`
Expected: PASS through Step 11. If Step 9 still times out, capture the page snapshot at `apps/nestfolio-e2e/test-results/**/error-context.md` and the CloudWatch tail of `dev-advisory-bff-DecisionPublisher` — the broadcast either didn't fire (publisher issue) or the frame didn't reach the WSS subscriber (MFE wiring issue).

- [ ] **Step 4: Run the e2e suite 4 more times back-to-back**

Run:

```bash
for i in 1 2 3 4; do
  echo "=== Run $i ==="
  NODE_OPTIONS='--experimental-vm-modules' pnpm nx run nestfolio-e2e:e2e --skip-nx-cache --grep "new-investor-happy-path" || exit 1
done
```

Expected: 4/4 PASS through Step 11. Combined with Step 3, this is the 5/5 gate. **If any run fails Step 9, do not ship — diagnose first.** Steps 10-11 may still fail for unrelated onboarding/decision-detail reasons (those are out of scope and tracked separately); Step 9 specifically must be 5/5.

- [ ] **Step 5: Update BACKLOG ship**

Move the QUEUED `[e2e] Journey Step 9` entry to "Recently shipped (last 14 days)" with date `2026-05-02` and the commit list. Also boundary-review PARKING LOT — promote the deposit-page Pattern A→B item if it's now the next highest-value e2e blocker.

```bash
git add docs/BACKLOG.md
git commit -m "docs(backlog): ship decision-list Pattern B (Step 9 5/5 gate green)"
```

- [ ] **Step 6: File a PARKING LOT entry for the symmetric decision-detail gap**

`publishDecisionUpdate` still omits `confirmedAt` / `rejectedAt` / `rejectionReason` / `confirmationRequired`. decision-detail has been green only because `confirmDecision`/`rejectDecision` re-broadcast full DecisionPacket via the readback resolver — but any IAM-published frame mid-cycle would currently land at decision-detail with those fields nulled and clobber prior state. Use the `backlog-add` skill:

```
- "publishDecisionUpdate omits decision-detail fields" — PUBLISH_DECISION_UPDATE in services/advisory/advisory-bff/src/handlers/decision-publisher.ts:8 sets only {decisionId, tenantId, status, trigger, explanation, proposedTrades, version, createdAt, updatedAt}. confirmedAt/rejectedAt/rejectionReason/confirmationRequired arrive as null at decision-detail's onDecisionUpdate handler, which calls store.setDecision(updated) (replace, not merge — apps/advisory-mfe/src/app/decision/decision-detail.component.ts:380). Latent: any IAM-published mid-cycle frame would erase those fields. Currently masked because confirmDecision/rejectDecision re-broadcast via DDB readback.
```

---

## Self-review pass

- ✅ Spec coverage: every line of the BACKLOG Step 9 fix prescription is implemented (Pattern B in ngOnInit ✓ Task 3; reconcile-by-decisionId with prepend/update-in-place/remove ✓ Tasks 4-6; unsubscribe in ngOnDestroy ✓ Task 3 + Task 7; no version-guard ✓ explicit no-op).
- ✅ No placeholders — every step shows real code.
- ✅ Type consistency — `reconcile(frame: Decision)` signature is identical across Tasks 3-6; `subscribeToDecisionListUpdates(tenantId, callback)` signature matches between service impl, service test, and component test.
- ✅ Mirrors existing patterns — service method shape mirrors `subscribeToDecisionUpdates` (Task 2 acknowledges the duplication and points at the rule-of-three PARKING LOT entry); component lifecycle mirrors decision-detail (Task 3); test fixtures use the same `frame()` helper shape as decision-detail spec.
- ✅ No POM changes — Phase 4 verifies the existing 15s timeout in `apps/nestfolio-e2e/src/pages/advisory.page.ts:20` is sufficient post-fix.
