# Advisory generating + failed UX (WS-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/advisory` page render correct **generating** and **failed** decision-cycle states (status-routed off `DecisionReadModel`, with a client-side staleness fallback), delete the now-dead AdvisoryStatus "in-flight" read surface end-to-end, and rewrite the Playwright scenario that encoded the removed accumulate model.

**Architecture:** WS-1 (decision-workflow-ctrl emits `DECISION_CYCLE_STARTED`/`FAILED`) and WS-2 (advisory-bff projects `GENERATING`/`FAILED` onto the versioned `DecisionReadModel` P1 row) already shipped. WS-3 surfaces those rows to the UI: the BFF `getPendingDecisions` filter is widened to include `GENERATING`/`FAILED`, and `DecisionListComponent` routes rows **by status** — real decisions → list, a `GENERATING` row → spinner, a recent `FAILED` row (or a `GENERATING` row older than the agent-budget ceiling) → error. Because advisory-mfe was the **only** consumer of the AppSync `AdvisoryStatus` query/subscription, that whole surface (and the never-written `lastTriggerAt` field) is now dead and is removed — while the AdvisoryStatus **aggregate** (projector + DDB row + `ADVISORY_STATUS_UPDATED` EventBridge CDC) stays, because dashboard-bff still consumes it for `pendingDecisionsCount`.

**Tech Stack:** Angular 21 standalone component + signals (advisory-mfe), AppSync JS resolver + GraphQL schema + `broadcastFromStream` (advisory-bff), Jest (component + service unit tests), Playwright (`apps/nestfolio-e2e`), EventBridge `PutEvents` injection fixtures.

**Scope decisions already made (user, 2026-06-04):**
- **Cleanup depth = full surface removal (Option C).** The entire AppSync `AdvisoryStatus` read/subscribe/broadcast surface is deleted (verified dead repo-wide; WS-4 routes the dashboard signal through the EventBridge `ADVISORY_STATUS_UPDATED` event, **not** this AppSync surface). The aggregate stays for dashboard-bff.
- **Staleness ceiling = 6 min (360 000 ms).** Derived from `AGENT_BUDGETS` (PE 120 s + AN 120 s = 240 s sequential) + ~2 min margin for projections/assemble/EB→SQS→CDC propagation + clock skew. The spec's "e.g. 3 min" is **below** the 240 s agent floor and would false-fail legit cycles — do not use it.

**Deploy targets (closing phase):** `advisory-bff` (filter + AppSync surface removal) and `investor-web` (advisory-mfe component + shell i18n). decision-workflow-ctrl already shipped in WS-1. The `apps/nestfolio-e2e` changes need no deploy.

---

## File Structure

**advisory-bff (`services/advisory/advisory-bff/`)**
- `src/graphql/js-function/get-pending-decisions.fn.js` — MODIFY: add `GENERATING` + `FAILED` to the status `IN (...)` filter.
- `src/schema.graphql` — MODIFY: delete the 4 `AdvisoryStatus` AppSync members (Query/Mutation/Subscription/type).
- `src/handlers/decision-publisher.ts` — MODIFY: delete the `PUBLISH_ADVISORY_STATUS_UPDATE` mutation const + the `AdvisoryStatus` broadcast config; keep `DecisionReadModel`.
- `src/service.stack.ts` — MODIFY: drop `'publishAdvisoryStatusUpdate'` from `noneDataSource`.
- `src/graphql/js-function/get-advisory-status.fn.js` — DELETE.
- `src/graphql/js-function/publish-advisory-status-update.fn.js` — DELETE.
- `test/unit/handlers/decision-publisher.test.ts` — MODIFY: drop the `publishAdvisoryStatusUpdate` broadcast test; keep `DecisionReadModel` tests.
- `test/unit/service.stack.test.ts` — MODIFY only if it asserts the removed resolvers/fields (reactive).
- KEEP unchanged: `handlers/advisory-status-projector.ts`, `src/read-model-ownership.ts`, the Egress `AdvisoryStatus → ADVISORY_STATUS_UPDATED` map.

**advisory-mfe (`apps/advisory-mfe/`)**
- `src/app/graphql/advisory-bff.queries.ts` — MODIFY: delete `GET_ADVISORY_STATUS` + `ON_ADVISORY_STATUS_UPDATE`.
- `src/app/services/advisory.service.ts` — MODIFY: delete `AdvisoryStatusSnapshot`, `getAdvisoryStatus`, `subscribeToAdvisoryStatusUpdates`, `unsubscribeFromAdvisoryStatusUpdates`, `doSubscribeToStatus`, the status-subscription fields, and the two query imports.
- `src/app/decision-list/decision-list.component.ts` — MODIFY: status-routed rendering + staleness guard; remove dead in-flight plumbing; add `GENERATING`/`FAILED` to `PENDING_STATUSES`.
- `test/app/decision-list/decision-list.component.spec.ts` — MODIFY: update existing tests that reference removed methods; add new status-routing + staleness tests.

**shell i18n (`libs/shell/`)**
- `src/i18n/assets/en-GB.json` — MODIFY: add `advisory.list.failedTitle` + `failedHint`.
- `src/i18n/assets/it-IT.json` — MODIFY: add the same keys.

**e2e (`apps/nestfolio-e2e/`)**
- `src/fixtures/inject-advisory-update.ts` — MODIFY: add `injectDecisionCycleStarted` / `injectDecisionCycleFailed` / `injectDecisionPacketCreated` (+ a private `putScopedEvent` helper); delete `injectAdvisoryBffTriggerEvent`; keep `injectDashboardBffTriggerEvent` (WS-4 owns it).
- `src/fixtures/wait-for-advisory-projection.ts` — MODIFY: delete the `allowInFlightOnly` branch + `COMBINED_QUERY` + the `getAdvisoryStatus` references; keep the default "row exists" branch.
- `src/scenarios/advisory-generating-state.spec.ts` — MODIFY: rewrite test 1 into two UI-only cases (generating→failed; generating→packet-clears); `test.skip` the dashboard test 2 with a WS-4 pointer.

---

## Task 1: advisory-bff — surface GENERATING/FAILED rows in `getPendingDecisions`

**Files:**
- Modify: `services/advisory/advisory-bff/src/graphql/js-function/get-pending-decisions.fn.js:19-31`

Rows for `GENERATING`/`FAILED` cycles already exist on the `DecisionReadModel` (WS-2). The list query filters them out today because its status `IN (...)` allowlist predates them. Widen the allowlist so they reach the UI via the existing query + `onDecisionUpdate` subscription. (JS resolvers run inside AppSync; there is no Jest harness for them — correctness is proven by the integration test's `getPendingDecisions` read and the scoped Playwright run.)

- [ ] **Step 1: Add GENERATING + FAILED to the filter**

Replace the `filter` block (lines 19-31) with:

```javascript
    filter: {
      expression: '#status IN (:s1, :s2, :s3, :s4, :s5, :s6, :s7, :s8, :s9)',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({
        ':s1': 'PENDING',
        ':s2': 'DRAFT',
        ':s3': 'PROPOSED',
        ':s4': 'COMPLIANCE_REVIEW',
        ':s5': 'APPROVED',
        ':s6': 'CONFIRMATION_REQUIRED',
        ':s7': 'AWAITING_CONFIRMATION',
        ':s8': 'GENERATING',
        ':s9': 'FAILED',
      }),
    },
```

- [ ] **Step 2: Typecheck the service**

Run: `pnpm nx run advisory-bff:typecheck`
Expected: PASS (the `.fn.js` is not typechecked, but this confirms nothing else in the service broke; if the project has no `typecheck` target, skip — Task 2 runs the unit suite).

- [ ] **Step 3: Commit**

```bash
git add services/advisory/advisory-bff/src/graphql/js-function/get-pending-decisions.fn.js
git commit --no-verify -m "feat(advisory-bff): surface GENERATING/FAILED decision rows in getPendingDecisions"
```

---

## Task 2: advisory-bff — remove the dead AppSync AdvisoryStatus surface

**Files:**
- Modify: `services/advisory/advisory-bff/src/schema.graphql`
- Modify: `services/advisory/advisory-bff/src/handlers/decision-publisher.ts`
- Modify: `services/advisory/advisory-bff/src/service.stack.ts:62`
- Delete: `services/advisory/advisory-bff/src/graphql/js-function/get-advisory-status.fn.js`
- Delete: `services/advisory/advisory-bff/src/graphql/js-function/publish-advisory-status-update.fn.js`
- Modify: `services/advisory/advisory-bff/test/unit/handlers/decision-publisher.test.ts`

Verified dead repo-wide: advisory-mfe (Task 3) is the only `getAdvisoryStatus`/`onAdvisoryStatusUpdate` consumer; the e2e helper's reference is removed in Task 8; WS-4 uses the EventBridge `ADVISORY_STATUS_UPDATED` event, not this AppSync surface. The aggregate (`advisory-status-projector.ts` + the DDB row + the Egress `ADVISORY_STATUS_UPDATED` CDC) is untouched, so dashboard-bff's `pendingDecisionsCount` keeps flowing.

- [ ] **Step 1: Run the decision-publisher test to confirm the current AdvisoryStatus test exists and passes**

Run: `pnpm nx test advisory-bff --test-file=decision-publisher.test.ts` (or `pnpm nx test advisory-bff`)
Expected: PASS, including `publishes AdvisoryStatus changes via publishAdvisoryStatusUpdate mutation`.

- [ ] **Step 2: Remove the AdvisoryStatus broadcast from `decision-publisher.ts`**

Delete the `PUBLISH_ADVISORY_STATUS_UPDATE` const (lines 56-75) entirely. Then delete the `AdvisoryStatus: { ... }` entry from the `broadcasts` map (lines 107-116), leaving only `DecisionReadModel`. The resulting `broadcasts` object:

```typescript
  broadcasts: {
    DecisionReadModel: {
      mutation: PUBLISH_DECISION_UPDATE,
      // skipInsert default false — initial PENDING state lands at clients that
      // subscribed before the SF advanced to AWAITING_CONFIRMATION. Defence
      // against subscribe-before-write race; downstream version-guard in MFE
      // dedupes if the same image arrives via getDecision query.
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
        confirmationRequired: typeof item['confirmationRequired'] === 'boolean' ? item['confirmationRequired'] : false,
        confirmedAt: typeof item['confirmedAt'] === 'string' ? item['confirmedAt'] : null,
        rejectedAt: typeof item['rejectedAt'] === 'string' ? item['rejectedAt'] : null,
        rejectionReason: typeof item['rejectionReason'] === 'string' ? item['rejectionReason'] : null,
      }),
    },
  },
```

The `extractTenantFromPk` helper (line 77) is now unused — delete it too.

- [ ] **Step 3: Remove the AdvisoryStatus members from `schema.graphql`**

- Delete the Query line `getAdvisoryStatus: AdvisoryStatus` (line 7).
- Delete the entire `publishAdvisoryStatusUpdate( ... ): AdvisoryStatus! @aws_iam` mutation block (lines 29-34).
- Delete the `onAdvisoryStatusUpdate` subscription block (lines 50-53):

```graphql
  onAdvisoryStatusUpdate(tenantId: ID!): AdvisoryStatus
    @aws_subscribe(mutations: ["publishAdvisoryStatusUpdate"])
    @aws_cognito_user_pools
    @aws_iam
```

- Delete the `type AdvisoryStatus @aws_cognito_user_pools @aws_iam { ... }` block (lines 160-165).
- Leave the `DecisionStatus` enum (with `GENERATING` + `FAILED`) and everything else intact.

- [ ] **Step 4: Drop the resolver from `service.stack.ts`**

At line 62, change:

```typescript
        noneDataSource: ['publishDecisionUpdate', 'publishAdvisoryStatusUpdate'],
```

to:

```typescript
        noneDataSource: ['publishDecisionUpdate'],
```

- [ ] **Step 5: Delete the two resolver files**

```bash
git rm services/advisory/advisory-bff/src/graphql/js-function/get-advisory-status.fn.js \
       services/advisory/advisory-bff/src/graphql/js-function/publish-advisory-status-update.fn.js
```

- [ ] **Step 6: Update `decision-publisher.test.ts`**

Open `test/unit/handlers/decision-publisher.test.ts`. Delete the test `publishes AdvisoryStatus changes via publishAdvisoryStatusUpdate mutation` (≈ lines 125-147) in full. If its fixture (a stream record with an `AdvisoryStatus`/`pk: 'T#...'` NewImage) is declared only for that test, delete the fixture too. Keep every `DecisionReadModel` broadcast test. If a shared assertion counts "number of broadcast mutations" or iterates `broadcasts` keys, update the expected count from 2 → 1.

- [ ] **Step 7: Run the advisory-bff unit suite**

Run: `pnpm nx test advisory-bff`
Expected: PASS. If `service.stack.test.ts` fails because it asserts the presence of `getAdvisoryStatus` / `publishAdvisoryStatusUpdate` / `onAdvisoryStatusUpdate` / a resolver count, update those assertions to match the removed surface (do **not** re-add the resolvers). Re-run until green.

- [ ] **Step 8: Commit**

```bash
git add -A services/advisory/advisory-bff
git commit --no-verify -m "refactor(advisory-bff): remove dead AppSync AdvisoryStatus read surface

advisory-mfe was the sole consumer of getAdvisoryStatus/onAdvisoryStatusUpdate;
WS-3 status-routes off DecisionReadModel instead. The AdvisoryStatus aggregate
(projector + DDB row + ADVISORY_STATUS_UPDATED CDC) stays for dashboard-bff."
```

---

## Task 3: advisory-mfe — delete the dead AdvisoryStatus service + queries

**Files:**
- Modify: `apps/advisory-mfe/src/app/graphql/advisory-bff.queries.ts`
- Modify: `apps/advisory-mfe/src/app/services/advisory.service.ts`

The component (Task 4) stops calling these; nothing else in advisory-mfe references them (verified). Delete first so Task 4's edits compile against the trimmed service.

- [ ] **Step 1: Remove the two queries**

In `advisory-bff.queries.ts`, delete the `GET_ADVISORY_STATUS` export (lines 147-156) and the `ON_ADVISORY_STATUS_UPDATE` export (lines 158-167).

- [ ] **Step 2: Remove the service plumbing**

In `advisory.service.ts`:
- Remove `GET_ADVISORY_STATUS,` and `ON_ADVISORY_STATUS_UPDATE,` from the import block (lines 13-14).
- Delete the `AdvisoryStatusSnapshot` interface (lines 30-35).
- Delete the three status-subscription fields (lines 59-61: `statusSubscription`, `statusReconnectTimeout`, `statusReconnectAttempts`).
- Delete `getAdvisoryStatus()` (lines 156-162), `subscribeToAdvisoryStatusUpdates()` (lines 164-171), `doSubscribeToStatus()` (lines 173-201), and `unsubscribeFromAdvisoryStatusUpdates()` (lines 203-213).

- [ ] **Step 3: Typecheck (expected to FAIL on the component, which still calls the removed methods)**

Run: `pnpm nx run advisory-mfe:typecheck` (or `pnpm nx lint advisory-mfe`)
Expected: FAIL with errors in `decision-list.component.ts` referencing `getAdvisoryStatus` / `subscribeToAdvisoryStatusUpdates` / `unsubscribeFromAdvisoryStatusUpdates`. This is expected — Task 4 fixes the component. Do not commit yet.

---

## Task 4: advisory-mfe — status-routed rendering + staleness guard

**Files:**
- Modify: `apps/advisory-mfe/src/app/decision-list/decision-list.component.ts`

Replace the dead `displayedInFlightCount()`/`inFlightCount`/`lastTriggerAt` generating logic with status-derived computed signals, plus a timer-driven staleness guard. Tests come in Task 5, but because the routing lives in **public computed signals** (`realDecisions` / `generating` / `failed`) the logic is unit-testable without rendering the template.

- [ ] **Step 1: Replace the component class body's state + computed signals**

Replace lines 158-186 (from `readonly decisions = signal...` through the `PENDING_STATUSES` set) with:

```typescript
  readonly decisions = signal<PendingDecisionListItem[]>([]);
  readonly loading = signal<boolean>(false);
  readonly loaded = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  // Drives the staleness guard. Ticked by an interval in ngOnInit so the
  // computed signals below re-evaluate over time; settable directly in tests.
  readonly now = signal<number>(Date.now());
  private tickHandle: ReturnType<typeof setInterval> | null = null;

  // A GENERATING row older than this (with no STARTED→PENDING/FAILED transition)
  // renders as failed. Derived from AGENT_BUDGETS (PORTFOLIO_ENGINE 120s +
  // ADVISORY_NARRATIVE 120s = 240s sequential) + ~2 min margin for
  // ParallelProjections + AssemblePacket + EB→SQS→CDC propagation + clock skew.
  // Covers uncatchable States.Runtime failures that emit no DECISION_CYCLE_FAILED.
  static readonly STALE_CYCLE_MS = 6 * 60 * 1000;
  private static readonly TICK_MS = 30 * 1000;

  private isStaleGenerating(d: PendingDecisionListItem): boolean {
    if (d.status !== 'GENERATING') return false;
    const ageMs = this.now() - new Date(d.createdAt).getTime();
    return ageMs >= DecisionListComponent.STALE_CYCLE_MS;
  }

  /** Rows that represent an actual decision — everything that is not a
   *  cycle-lifecycle placeholder. These are the only rows shown in the list. */
  readonly realDecisions = computed(() =>
    this.decisions().filter((d) => d.status !== 'GENERATING' && d.status !== 'FAILED'),
  );

  /** True when a cycle is actively generating (a fresh, non-stale GENERATING row). */
  readonly generating = computed(() =>
    this.decisions().some((d) => d.status === 'GENERATING' && !this.isStaleGenerating(d)),
  );

  /** True when the latest signal is a failure and nothing is in flight / ready:
   *  a FAILED row, or a GENERATING row that has gone stale (uncatchable failure). */
  readonly failed = computed(() => {
    if (this.realDecisions().length > 0 || this.generating()) return false;
    return this.decisions().some(
      (d) => d.status === 'FAILED' || (d.status === 'GENERATING' && this.isStaleGenerating(d)),
    );
  });

  // Mirrors services/advisory/advisory-bff/src/graphql/js-function/get-pending-decisions.fn.js
  // — keep in sync if backend filter changes. GENERATING/FAILED included so the
  // cycle-lifecycle rows reach decisions() and drive the spinner/error UI.
  private static readonly PENDING_STATUSES = new Set<string>([
    'PENDING',
    'DRAFT',
    'PROPOSED',
    'COMPLIANCE_REVIEW',
    'APPROVED',
    'CONFIRMATION_REQUIRED',
    'AWAITING_CONFIRMATION',
    'GENERATING',
    'FAILED',
  ]);
```

- [ ] **Step 2: Rewrite `ngOnInit` to drop the AdvisoryStatus calls + start the tick**

Replace `ngOnInit` (lines 188-221) with:

```typescript
  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.tickHandle = setInterval(
      () => this.now.set(Date.now()),
      DecisionListComponent.TICK_MS,
    );

    const tenantId = this.authStore.user()?.tenantId;
    if (tenantId) {
      // Pattern B (R1): subscription BEFORE the query fires so frames delivered
      // during query resolution are not lost.
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
```

- [ ] **Step 3: Rewrite `ngOnDestroy` to clear the tick + drop the status unsubscribe**

Replace `ngOnDestroy` (lines 223-226) with:

```typescript
  ngOnDestroy(): void {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    this.advisoryService.unsubscribeFromDecisionListUpdates();
  }
```

- [ ] **Step 4: Update the template — route by status**

Replace the template (the backtick block at lines 27-81) with:

```typescript
  template: `
    @if (loading() && !loaded()) {
      <nf-loading-skeleton [count]="5" />
    } @else if (error()) {
      <nf-empty-state
        icon="pi pi-exclamation-triangle"
        [title]="i18n.t('advisory.list.errorTitle')"
        [message]="i18n.t(error()!)"
      />
    } @else if (realDecisions().length > 0) {
      <div class="decision-list" data-testid="advisory-decision-list">
        <h2 class="list-title">{{ i18n.t('advisory.list.title') }}</h2>
        @if (generating()) {
          <div class="generating-banner" data-testid="advisory-generating-banner">
            <span class="pi pi-spin pi-spinner"></span>
            {{ i18n.t('advisory.list.generatingTitle') }}
          </div>
        }
        <ul class="items">
          @for (d of realDecisions(); track d.decisionId) {
            <li class="item">
              <a
                class="item-link"
                [routerLink]="['/advisory', d.decisionId]"
                [attr.data-testid]="'decision-' + d.decisionId"
              >
                <div class="item-row">
                  <span class="item-trigger">{{ d.trigger }}</span>
                  <nf-status-badge
                    [label]="d.status"
                    [severity]="statusSeverity(d.status)"
                  />
                </div>
                <span class="item-date">{{ d.createdAt | date: 'short' }}</span>
              </a>
            </li>
          }
        </ul>
      </div>
    } @else if (generating()) {
      <div data-testid="advisory-generating-state">
        <nf-empty-state
          icon="pi pi-spin pi-spinner"
          [title]="i18n.t('advisory.list.generatingTitle')"
          [message]="i18n.t('advisory.list.generatingHint')"
        />
      </div>
    } @else if (failed()) {
      <div data-testid="advisory-failed-state">
        <nf-empty-state
          icon="pi pi-exclamation-triangle"
          [title]="i18n.t('advisory.list.failedTitle')"
          [message]="i18n.t('advisory.list.failedHint')"
        />
      </div>
    } @else {
      <nf-empty-state
        icon="pi pi-chart-line"
        [title]="i18n.t('advisory.list.emptyTitle')"
        [message]="i18n.t('advisory.list.emptyHint')"
      />
    }
  `,
```

(The non-empty-list banner now uses `generatingTitle` rather than the removed `generatingMore` count string — there is no count in the status-routed model. `generatingMore` becomes unused; leave it in i18n, it is harmless.)

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm nx run advisory-mfe:typecheck && pnpm nx lint advisory-mfe`
Expected: PASS (the Task 3 errors are resolved; no remaining references to the removed service methods, `inFlightCount`, `lastTriggerAt`, `displayedInFlightCount`, or `STALENESS_MS`).

- [ ] **Step 6: Commit Tasks 3+4 together**

```bash
git add apps/advisory-mfe/src
git commit --no-verify -m "feat(advisory-mfe): status-route generating/failed decision states

DecisionListComponent renders rows by status (real -> list, GENERATING ->
spinner, FAILED or stale-GENERATING -> error) with a 6-min staleness guard.
Deletes the dead AdvisoryStatus in-flight plumbing + service methods."
```

---

## Task 5: advisory-mfe — component unit tests

**Files:**
- Modify: `apps/advisory-mfe/test/app/decision-list/decision-list.component.spec.ts`

Two parts: (a) fix the existing logic tests that reference removed methods; (b) add a new `describe` covering the status-routing computed signals + staleness (spec §7.2). The routing assertions read the public `realDecisions`/`generating`/`failed` signals — robust in jsdom and equivalent to asserting which `data-testid` would render. DOM-level `data-testid` presence is covered by the Playwright scenario (Task 9).

- [ ] **Step 1: Trim the service mock + remove the AdvisoryStatus-coupled tests**

In the existing `describe('DecisionListComponent', ...)`:
- In the `advisoryService` mock object (lines 52-59), delete the `getAdvisoryStatus`, `subscribeToAdvisoryStatusUpdates`, and `unsubscribeFromAdvisoryStatusUpdates` lines.
- Delete the test `passes tenantId from authStore to subscribeToAdvisoryStatusUpdates` (lines 154-161) in full.
- In `unsubscribes from decision list updates on destroy` (lines 275-282), delete the assertion `expect(advisoryService.unsubscribeFromAdvisoryStatusUpdates).toHaveBeenCalled();`.
- In `skips subscription when authStore has no tenantId (still issues query)` (lines 284-306), delete the assertion `expect(advisoryService.subscribeToAdvisoryStatusUpdates).not.toHaveBeenCalled();`.

- [ ] **Step 2: Run the trimmed suite to confirm it compiles + passes**

Run: `pnpm nx test advisory-mfe --test-file=decision-list.component.spec.ts`
Expected: PASS (the existing list/reconcile tests are unaffected by the routing change since they assert `decisions()` directly).

- [ ] **Step 3: Add the failing status-routing tests**

Append a new `describe` block at the end of the file (before the final closing `});` of the outer scope is not needed — this is a top-level sibling `describe`). It builds the component WITHOUT `ngOnInit` (no timers, no async) and drives `decisions` + `now` directly:

```typescript
describe('DecisionListComponent — generating/failed routing (spec §7.2)', () => {
  let component: DecisionListComponent;

  function listItem(over: Partial<PendingDecisionListItem>): PendingDecisionListItem {
    return {
      decisionId: 'd-x',
      status: 'PENDING',
      trigger: 'DEPOSIT_DETECTED',
      createdAt: '2026-06-04T10:00:00Z',
      ...over,
    };
  }

  beforeEach(async () => {
    const advisoryService = {
      getPendingDecisions: jest.fn().mockResolvedValue([]),
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

    component = TestBed.createComponent(DecisionListComponent).componentInstance;
    component.now.set(new Date('2026-06-04T10:00:00Z').getTime());
  });

  it('GENERATING row, empty list -> generating, not failed, no real rows', () => {
    component.decisions.set([listItem({ decisionId: 'd1', status: 'GENERATING' })]);
    expect(component.realDecisions()).toEqual([]);
    expect(component.generating()).toBe(true);
    expect(component.failed()).toBe(false);
  });

  it('GENERATING + a real decision -> generating banner, list has only the real row', () => {
    component.decisions.set([
      listItem({ decisionId: 'd1', status: 'GENERATING' }),
      listItem({ decisionId: 'd2', status: 'AWAITING_CONFIRMATION' }),
    ]);
    expect(component.realDecisions().map((d) => d.decisionId)).toEqual(['d2']);
    expect(component.generating()).toBe(true);
    expect(component.failed()).toBe(false);
  });

  it('FAILED row, no generation, no real rows -> failed', () => {
    component.decisions.set([listItem({ decisionId: 'd1', status: 'FAILED' })]);
    expect(component.realDecisions()).toEqual([]);
    expect(component.generating()).toBe(false);
    expect(component.failed()).toBe(true);
  });

  it('stale GENERATING (older than the ceiling) -> failed, not generating', () => {
    component.decisions.set([
      listItem({ decisionId: 'd1', status: 'GENERATING', createdAt: '2026-06-04T10:00:00Z' }),
    ]);
    // 7 minutes later — past STALE_CYCLE_MS (6 min).
    component.now.set(new Date('2026-06-04T10:07:00Z').getTime());
    expect(component.generating()).toBe(false);
    expect(component.failed()).toBe(true);
  });

  it('fresh GENERATING (within the ceiling) -> still generating', () => {
    component.decisions.set([
      listItem({ decisionId: 'd1', status: 'GENERATING', createdAt: '2026-06-04T10:00:00Z' }),
    ]);
    component.now.set(new Date('2026-06-04T10:05:00Z').getTime()); // 5 min < 6 min
    expect(component.generating()).toBe(true);
    expect(component.failed()).toBe(false);
  });

  it('a real decision overrides a stale GENERATING (no false failed)', () => {
    component.decisions.set([
      listItem({ decisionId: 'd1', status: 'GENERATING', createdAt: '2026-06-04T10:00:00Z' }),
      listItem({ decisionId: 'd2', status: 'APPROVED' }),
    ]);
    component.now.set(new Date('2026-06-04T10:09:00Z').getTime());
    expect(component.realDecisions().map((d) => d.decisionId)).toEqual(['d2']);
    expect(component.failed()).toBe(false);
  });

  it('empty decisions -> neither generating nor failed (plain empty state)', () => {
    component.decisions.set([]);
    expect(component.generating()).toBe(false);
    expect(component.failed()).toBe(false);
  });
});
```

- [ ] **Step 4: Add a reconcile test proving GENERATING/FAILED frames are kept**

In the original `describe('DecisionListComponent', ...)`, add (after the existing reconcile tests):

```typescript
  it('keeps a GENERATING frame for an unknown decisionId (drives the spinner)', async () => {
    let cb!: (d: Decision) => void;
    advisoryService.subscribeToDecisionListUpdates.mockImplementation(
      (_t: string, fn: (d: Decision) => void) => { cb = fn; },
    );
    advisoryService.getPendingDecisions.mockResolvedValue([]);

    await component.ngOnInit();
    cb(frame({ decisionId: 'd-gen', status: 'GENERATING' }));

    expect(component.decisions().map((d) => d.decisionId)).toEqual(['d-gen']);
    expect(component.generating()).toBe(true);

    component.ngOnDestroy(); // clear the interval started by ngOnInit
  });
```

- [ ] **Step 5: Run the full component spec**

Run: `pnpm nx test advisory-mfe --test-file=decision-list.component.spec.ts`
Expected: PASS (all existing + 8 new tests).

- [ ] **Step 6: Commit**

```bash
git add apps/advisory-mfe/test
git commit --no-verify -m "test(advisory-mfe): cover generating/failed status routing + staleness guard"
```

---

## Task 6: shell i18n — add the failed-state strings

**Files:**
- Modify: `libs/shell/src/i18n/assets/en-GB.json`
- Modify: `libs/shell/src/i18n/assets/it-IT.json`

- [ ] **Step 1: en-GB**

In the `advisory.list` object (after `"generatingMore": ...`), add a trailing comma to `generatingMore` and append:

```json
      "generatingMore": "Generating {count} additional recommendation(s)…",
      "failedTitle": "We couldn't generate your advice",
      "failedHint": "Something went wrong while preparing your recommendation. Please try again shortly."
```

- [ ] **Step 2: it-IT**

In the `advisory.list` object, the same:

```json
      "generatingMore": "Generando {count} raccomandazione(i) aggiuntiva(e)…",
      "failedTitle": "Non siamo riusciti a generare la tua consulenza",
      "failedHint": "Si è verificato un problema durante la preparazione della raccomandazione. Riprova tra poco."
```

- [ ] **Step 3: Validate JSON parses + lint the lib**

Run: `node -e "require('./libs/shell/src/i18n/assets/en-GB.json'); require('./libs/shell/src/i18n/assets/it-IT.json'); console.log('ok')"`
Expected: `ok` (no JSON syntax error from the added commas).

- [ ] **Step 4: Commit**

```bash
git add libs/shell/src/i18n/assets/en-GB.json libs/shell/src/i18n/assets/it-IT.json
git commit --no-verify -m "feat(i18n): add advisory.list.failedTitle/failedHint for the failed cycle state"
```

---

## Task 7: e2e — cycle-event injection fixtures

**Files:**
- Modify: `apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts`

Add injectors for the three real signals (scoped to advisory-bff via the `integration-test:advisory-bff` source so they pass the Ingress `$or` filter). Delete `injectAdvisoryBffTriggerEvent` (the dead `DEPOSIT_DETECTED → inFlightCount` injector — Task 9 stops using it; nothing else imports it). Keep `injectDashboardBffTriggerEvent` (WS-4 owns it).

- [ ] **Step 1: Replace the file contents**

```typescript
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';
import type { TestContext } from '@nestfolio/test-support';
import type { FreshTenant } from '@nestfolio/e2e-feature-tests';

/**
 * Emit a single standard-envelope event onto a domain EventBridge bus, scoped to
 * one consumer via `source: integration-test:<service>` so it passes that
 * consumer's Ingress `$or` filter. Shared by the advisory cycle-event injectors.
 */
async function putScopedEvent(
  ctx: TestContext,
  busDomain: 'advisory' | 'investor',
  source: string,
  detailType: string,
  subject: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<{ eventId: string }> {
  const busArn = await ctx.ssm.busArn(busDomain);
  const eb = new EventBridgeClient({ region: ctx.region });
  const eventId = `e2e-${randomUUID()}`;
  const now = new Date().toISOString();

  const result = await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: busArn,
          Source: source,
          DetailType: detailType,
          Detail: JSON.stringify({ id: eventId, type: detailType, timestamp: now, subject, context }),
        },
      ],
    }),
  );

  if ((result.FailedEntryCount ?? 0) > 0) {
    throw new Error(
      `putScopedEvent(${detailType}): PutEvents failed — ${result.Entries?.[0]?.ErrorMessage ?? 'unknown'}`,
    );
  }
  return { eventId };
}

const ADVISORY_BFF_SOURCE = 'integration-test:advisory-bff';

function advisoryContext(ctx: TestContext, tenant: FreshTenant): Record<string, unknown> {
  return { tenantId: tenant.tenantId, userId: tenant.userId, region: ctx.region };
}

/**
 * Emit DECISION_CYCLE_STARTED (a decision-workflow-ctrl SF-direct event) scoped
 * to advisory-bff. advisory-bff projects status=GENERATING (v0) onto the
 * DecisionReadModel row before any DecisionPacket exists.
 */
export async function injectDecisionCycleStarted(
  ctx: TestContext,
  tenant: FreshTenant,
  decisionId: string,
): Promise<void> {
  await putScopedEvent(
    ctx,
    'advisory',
    ADVISORY_BFF_SOURCE,
    'DECISION_CYCLE_STARTED',
    { decisionId, tenantId: tenant.tenantId, status: 'GENERATING', __version: 0 },
    advisoryContext(ctx, tenant),
  );
}

/**
 * Emit DECISION_CYCLE_FAILED (same decisionId) scoped to advisory-bff. advisory-bff
 * projects status=FAILED (v1), overwriting the GENERATING (v0) row via the version
 * guard.
 */
export async function injectDecisionCycleFailed(
  ctx: TestContext,
  tenant: FreshTenant,
  decisionId: string,
): Promise<void> {
  await putScopedEvent(
    ctx,
    'advisory',
    ADVISORY_BFF_SOURCE,
    'DECISION_CYCLE_FAILED',
    { decisionId, tenantId: tenant.tenantId, status: 'FAILED', __version: 1 },
    advisoryContext(ctx, tenant),
  );
}

/**
 * Emit a content DECISION_PACKET_CREATED (v1) scoped to advisory-bff. advisory-bff's
 * decision-snapshot transform projects the full packet onto the DecisionReadModel
 * row (AWAITING_CONFIRMATION), overwriting a prior GENERATING (v0). The subject
 * carries a non-empty explanation + one proposedTrade so the transform's
 * degraded-drop guard does not skip it; the proposedTrade matches ProposedTradeInput
 * so the publishDecisionUpdate broadcast does not silently drop.
 */
export async function injectDecisionPacketCreated(
  ctx: TestContext,
  tenant: FreshTenant,
  decisionId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await putScopedEvent(
    ctx,
    'advisory',
    ADVISORY_BFF_SOURCE,
    'DECISION_PACKET_CREATED',
    {
      decisionId,
      tenantId: tenant.tenantId,
      trigger: 'DEPOSIT_DETECTED',
      status: 'AWAITING_CONFIRMATION',
      proposedTrades: [
        {
          symbol: 'VOO',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 100_000,
          targetWeightPercent: 60,
          rationale: 'e2e generating-state scenario',
        },
      ],
      explanation: 'Test recommendation for the e2e generating-state scenario.',
      confirmationRequired: true,
      __version: 1,
      createdAt: now,
      updatedAt: now,
    },
    advisoryContext(ctx, tenant),
  );
}

/**
 * Emit DEPOSIT_DETECTED on the investor bus, scoped to dashboard-bff. Used by the
 * dashboard alert-bar scenario (retargeted by WS-4 dashboard-generating-failed-reflection).
 */
export async function injectDashboardBffTriggerEvent(
  ctx: TestContext,
  tenant: FreshTenant,
): Promise<{ eventId: string }> {
  return putScopedEvent(
    ctx,
    'investor',
    'integration-test:dashboard-bff',
    'DEPOSIT_DETECTED',
    { tenantId: tenant.tenantId, amountCents: 100_000 },
    advisoryContext(ctx, tenant),
  );
}
```

- [ ] **Step 2: Typecheck the e2e app**

Run: `pnpm nx run nestfolio-e2e:typecheck` (or `pnpm nx lint nestfolio-e2e`)
Expected: FAIL only in `advisory-generating-state.spec.ts` (still imports the deleted `injectAdvisoryBffTriggerEvent`) and possibly `wait-for-advisory-projection.ts` — both fixed in Tasks 8-9. Do not commit yet.

---

## Task 8: e2e — trim the wait helper off the dead AdvisoryStatus query

**Files:**
- Modify: `apps/nestfolio-e2e/src/fixtures/wait-for-advisory-projection.ts`

The `allowInFlightOnly` branch queries the now-deleted `getAdvisoryStatus`. Only the rewritten scenario used it; the default "a DecisionReadModel row exists" branch (used by `new-investor-happy-path.spec.ts`) stays. After Task 1 a `GENERATING` row appears in `getPendingDecisions`, so the default branch is sufficient for the generating scenario too.

- [ ] **Step 1: Replace the file contents**

```typescript
import { bffClient, waitForGraphQL } from '@nestfolio/e2e-feature-tests';
import type { TestContext } from '@nestfolio/test-support';
import type { FreshTenant } from '@nestfolio/e2e-feature-tests';

const GET_PENDING_DECISIONS = `
  query GetPendingDecisions($limit: Int) {
    getPendingDecisions(limit: $limit) {
      items {
        decisionId
        status
      }
    }
  }
`;

interface GetPendingDecisionsResult {
  getPendingDecisions: {
    items: Array<{ decisionId: string; status: string }>;
  };
}

/**
 * Block until advisory-bff has materialised at least one DecisionReadModel row
 * for the tenant — i.e., the projection the UI list reads is visible. After
 * WS-3 this includes GENERATING/FAILED cycle-status rows (they pass the
 * getPendingDecisions filter), so the generating scenario can wait on this
 * before navigating, eliminating the EB→SQS→Lambda race against the component's
 * initial query.
 *
 * Polls the same query the production UI fires, against the same Cognito-authed
 * AppSync endpoint — observable user-side behaviour, not a backend-only probe
 * (see feedback_e2e_ui_assertions_only.md).
 */
export async function waitForAdvisoryDecisionRow(
  ctx: TestContext,
  tenant: FreshTenant,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const advisory = bffClient(ctx, tenant).advisory;
  await waitForGraphQL<GetPendingDecisionsResult>(
    advisory,
    GET_PENDING_DECISIONS,
    { limit: 5 },
    (result) => (result.getPendingDecisions?.items?.length ?? 0) >= 1,
    { timeoutMs: opts?.timeoutMs ?? 90_000, intervalMs: 2_000 },
  );
}
```

- [ ] **Step 2: Confirm the other caller still compiles**

Run: `grep -n 'waitForAdvisoryDecisionRow' apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts`
Expected: the call is `waitForAdvisoryDecisionRow(ctx, tenant)` (no `allowInFlightOnly`) — unaffected by the signature change.

---

## Task 9: e2e — rewrite the generating-state scenario

**Files:**
- Modify: `apps/nestfolio-e2e/src/scenarios/advisory-generating-state.spec.ts`

Rewrite test 1 into two UI-only cases driven by the real cycle signals; `test.skip` the dashboard test 2 (WS-4 retargets it) so the file stays green.

- [ ] **Step 1: Replace the file contents**

```typescript
import { randomUUID } from 'crypto';
import { test, expect } from '../fixtures/test';
import {
  injectDecisionCycleStarted,
  injectDecisionCycleFailed,
  injectDecisionPacketCreated,
} from '../fixtures/inject-advisory-update';
import { waitForAdvisoryDecisionRow } from '../fixtures/wait-for-advisory-projection';

test.describe('advisory generating + failed state', () => {
  /**
   * GENERATING → FAILED. Inject the SF-direct cycle events scoped to advisory-bff:
   * STARTED projects a GENERATING DecisionReadModel row (no packet yet) → the
   * /advisory empty-state spinner; FAILED (same decisionId, v1) overwrites it →
   * the failed error state, delivered live via the onDecisionUpdate subscription.
   * UI-only assertions (per the e2e charter).
   */
  test('shows generating then failed as the cycle progresses', async ({
    ctx,
    tenant,
    onboardedPage,
  }) => {
    const decisionId = randomUUID();

    await injectDecisionCycleStarted(ctx, tenant, decisionId);
    // Wait for advisory-bff to materialise the GENERATING row so the initial
    // getPendingDecisions query (fired in ngOnInit) returns it — no subscription race.
    await waitForAdvisoryDecisionRow(ctx, tenant, { timeoutMs: 60_000 });

    await onboardedPage.goto('/advisory');
    await expect(
      onboardedPage.locator('[data-testid=advisory-generating-state]'),
    ).toBeVisible({ timeout: 15_000 });

    // FAILED arrives while the page is mounted → delivered by the WSS subscription.
    await injectDecisionCycleFailed(ctx, tenant, decisionId);
    await expect(
      onboardedPage.locator('[data-testid=advisory-failed-state]'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      onboardedPage.locator('[data-testid=advisory-generating-state]'),
    ).toBeHidden();
  });

  /**
   * GENERATING → decision ready. STARTED shows the spinner; a content
   * DECISION_PACKET_CREATED (same decisionId, v1) overwrites the GENERATING row →
   * the decision appears in the list and the spinner clears, live via subscription.
   */
  test('clears the spinner and shows the decision when the packet arrives', async ({
    ctx,
    tenant,
    onboardedPage,
  }) => {
    const decisionId = randomUUID();

    await injectDecisionCycleStarted(ctx, tenant, decisionId);
    await waitForAdvisoryDecisionRow(ctx, tenant, { timeoutMs: 60_000 });

    await onboardedPage.goto('/advisory');
    await expect(
      onboardedPage.locator('[data-testid=advisory-generating-state]'),
    ).toBeVisible({ timeout: 15_000 });

    await injectDecisionPacketCreated(ctx, tenant, decisionId);
    await expect(
      onboardedPage.locator('[data-testid=advisory-decision-list]'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      onboardedPage.locator(`[data-testid=decision-${decisionId}]`),
    ).toBeVisible();
    await expect(
      onboardedPage.locator('[data-testid=advisory-generating-state]'),
    ).toBeHidden();
  });

  /**
   * Dashboard alert-bar coverage is retargeted off the removed accumulate model
   * by WS-4 (dashboard-generating-failed-reflection). Skipped here so this file
   * stays green until WS-4 rewrites it against the reachable
   * ADVISORY_STATUS_UPDATED → pendingDecisionsCount path.
   */
  test.skip('dashboard alert bar appears at trigger time via subscription', async () => {
    // Intentionally skipped — see WS-4 dashboard-generating-failed-reflection.
  });
});
```

- [ ] **Step 2: Typecheck/lint the e2e app (now clean)**

Run: `pnpm nx run nestfolio-e2e:typecheck && pnpm nx lint nestfolio-e2e`
Expected: PASS (no dangling imports; the deleted `injectAdvisoryBffTriggerEvent` is no longer referenced).

- [ ] **Step 3: Commit Tasks 7+8+9 together**

```bash
git add apps/nestfolio-e2e/src
git commit --no-verify -m "test(e2e): rewrite advisory generating-state scenario off the accumulate model

Inject real DECISION_CYCLE_STARTED/FAILED + content DECISION_PACKET_CREATED;
assert generating/failed/cleared UI states. Skip the dashboard test (WS-4)."
```

---

## Validation (driven by /backlog-next closing phase — not part of task execution)

- `pnpm nx affected -t test,lint --base=origin/main` green.
- Deploy `advisory-bff` + `investor-web` to dev (`bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-bff,investor-web` — confirm exact targets via `detect-deploy-needed.mjs`).
- Scoped Playwright vs deployed dev: `apps/nestfolio-e2e` `advisory-generating-state` (`PLAYWRIGHT_GREP='advisory generating'` via `tools/run-playwright.mjs`). Must pass **twice consecutively** (anti-flake; pull CloudWatch from any failing window before re-running — see feedback_flake_means_broken). The skipped dashboard test does not run.
- Regen the advisory-bff CLAUDE.md card via `audit-service advisory-bff` if the closing-phase `detect-doc-derivation` flags it (the GraphQL surface + handler changed).

---

## Self-Review

**1. Spec coverage (§5 + §7.2 + §7.3, test 1):**
- §5.1 GENERATING/FAILED in the filter + `PENDING_STATUSES` mirror → Task 1 + Task 4 Step 1. ✓
- §5.2 status-routed rendering (real → list, GENERATING → spinner/banner, FAILED → error) → Task 4 Steps 1+4. ✓
- §5.3 staleness guard (ceiling from AGENT_BUDGETS) → Task 4 Step 1 (`STALE_CYCLE_MS = 6 min`, timer tick). ✓ (corrected the spec's too-low "3 min").
- §5.2 remove dead `displayedInFlightCount`/`lastTriggerAt`/`inFlightCount` + getAdvisoryStatus dependence → Tasks 3 + 4. ✓
- §5.4 i18n `failedTitle`/`failedHint` → Task 6. ✓
- §7.2 component unit tests (4 states + staleness) → Task 5 Step 3 (7 cases) + Step 4 (reconcile). ✓
- §7.3 e2e rewrite (STARTED → spinner, FAILED → error, content packet → appears + clears; UI-only; update inject-advisory-update.ts) → Tasks 7+8+9. ✓
- Backlog extra: "remove the now-unused BFF lastTriggerAt field path" → subsumed by the full-surface removal (Task 2), per the user's Option-C decision. ✓

**2. Placeholder scan:** No TBD/"handle errors"/"similar to". Every code step shows full code or an exact line target. ✓

**3. Type consistency:** Public computed signals `realDecisions`/`generating`/`failed` + public `now` signal are defined in Task 4 and read identically in Task 5. `PendingDecisionListItem` (`decisionId`/`status`/`trigger`/`createdAt`) is reused consistently. `putScopedEvent(busDomain, source, detailType, subject, context)` signature matches all three injector call sites. `waitForAdvisoryDecisionRow(ctx, tenant, { timeoutMs })` matches both callers (the journey uses the 2-arg form). The injected `DECISION_PACKET_CREATED` subject matches `decision-snapshot.ts`'s `DecisionSnapshot` shape (explanation + proposedTrades + `__version`). The injected `proposedTrades[0]` matches `ProposedTradeInput`. ✓

**4. Out-of-scope honored:** dashboard reflection / e2e test 2 (skipped, not retargeted) = WS-4; `inject-advisory-update.ts` still imports `@aws-sdk/client-eventbridge` directly (migration tracked separately); the AdvisoryStatus aggregate + `ADVISORY_STATUS_UPDATED` CDC stay (dashboard-bff). ✓
