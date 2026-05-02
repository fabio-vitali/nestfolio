# Decision-update broadcast pipeline (Spec 5)

**Status:** Design ready for review.
**Active workstream:** Journey Steps 9-10 — advisory-mfe blockers (`docs/BACKLOG.md` ACTIVE).
**Origin:** Spec 3's 5-run e2e gate showed Steps 9-10 fail in 3/5 runs even after the eighth-session backend fixes shipped 2026-04-30.

---

## 1. Problem

`new-investor-happy-path.spec.ts` Steps 9-10 fail intermittently:
- `apps/nestfolio-e2e/src/pages/advisory.page.ts:34` — `confirm()` calls `getByRole('button', { name: /confirm|conferma/i }).click()` and times out at Playwright's default 30s.
- The Confirm button is gated by `canAct = decision.status === 'AWAITING_CONFIRMATION'` (`apps/advisory-mfe/src/app/stores/advisory.store.ts:123-126`).
- `AWAITING_CONFIRMATION` is projected onto `DecisionReadModel` only when SF emits `USER_CONFIRMATION_REQUESTED` after `WaitForCompliance` → `ComplianceChoice` → `RequestUserConfirmation` — a 30–90s pipeline.
- `services/advisory/advisory-bff/src/schema.graphql:15-17` — `onDecisionUpdate` is `@aws_subscribe(mutations: ["confirmDecision", "rejectDecision"])`. There is **no backend-driven WSS push** for status transitions. The MFE sees the new status only when the user reloads.

The e2e test is correctly exposing a production UX bug: a real user opening `/advisory/<id>` while the SF is still running sees no Confirm button until they reload.

The new project-level principle (`feedback_e2e_ui_assertions_only.md`, captured 2026-05-01) forbids POM-level workarounds. The fix is in production code.

## 2. Goal

When `DecisionReadModel.status` (or any UI-relevant field) changes, the change reaches every connected MFE client over WSS within seconds, with tenant isolation. Mirrors the dashboard-publisher pattern shipped 2026-04-30, but elevated to a first-class `event-processor` pipeline so the same primitive serves all current and future broadcast call sites.

**Done when:** `pnpm nx run nestfolio-e2e:e2e` runs `new-investor-happy-path.spec.ts` against deployed dev **5 consecutive times**, all 5 reach Step 11 (logout). Steps 9-10 (`goToFirstPendingDecision`, `confirm`, `waitForConfirmed`) pass without timeout in every run. **No POM changes.**

## 3. Out of scope (file-and-continue per CLAUDE.md backlog discipline)

- **Step 8 WSS dashboard sentinel bug** — separate QUEUED item; new evidence in `project_playwright_e2e_ui.md` supersedes the sixth-session "subscription never opens" diagnosis.
- **Generalising broadcast pipeline beyond AppSync** (e.g., Pusher, EventBridge-as-broadcast) — single-target by design.
- **Schema-level cross-tenant filter audit on other subscriptions** — note in `project_decision_workflow_stuck.md:116` mentions `advisory-bff onDecisionUpdate` had no args (this spec adds them); other subscriptions remain unaudited. File if surfaced during validation.
- **Vestigial MemoryStrategy declarations in decision-workflow-ctrl** — filed in PARKING LOT 2026-05-02. Unrelated to broadcast pipeline.
- **Operating-mode wiring into advisory behavior** — separate QUEUED item.

If a finding outside this list surfaces during execution, default to file-and-continue per `CLAUDE.md` § "Backlog Discipline". Do not pivot mid-flight unless the validation gate cannot complete.

## 4. Architecture

### 4.1 Library — `event-processor` broadcast primitives

Two new pipelines + one shared helper under `libs/event-processor/src/`, symmetric with the existing input-source split (`changeDataCapture` is DDB-stream-input; `resumeStateMachine` is SQS-input). Broadcast becomes a first-class lifecycle role peer to CDC, materialization, and SF resume.

**`pipelines/broadcast-from-stream.ts`** — DDB stream → AppSync mutation. For state-change-driven broadcasts (advisory-bff, dashboard-bff).

```ts
export interface BroadcastFromStreamConfig {
  serviceName: string;
  appsyncUrl: string;
  region?: string;
  broadcasts: Record<string, StreamBroadcastEntry>;  // keyed by __typename / sk
}

export interface StreamBroadcastEntry {
  mutation: string;                       // GraphQL mutation source
  whenChanged?: string[];                 // field list — broadcast iff strict-equality differs on at least one
  shouldBroadcast?: (newImage, oldImage, eventName) => boolean;  // escape-hatch predicate
  skipInsert?: boolean;                   // default false; INSERT events broadcast
  mapImage: (newImage) => Record<string, unknown>;  // builds mutation variables
}

export function broadcastFromStream(config: BroadcastFromStreamConfig): DynamoDBStreamHandler;
```

Composes `EgestionEngine` (the engine `changeDataCapture` already uses) for at-least-once handling, partial-batch responses, retry classification, structured logging.

**`whenChanged` semantics:** for each entry in the field list, the engine compares `OldImage[field] !== NewImage[field]` after `unmarshall`. Strict-equality means **arrays and objects always compare unequal** (different references) — for `proposedTrades`, this conservatively over-broadcasts on any DDB write that contains the field, which is the safer default. Callers that need value-equality semantics on collections supply `shouldBroadcast` instead.

**`pipelines/broadcast-from-queue.ts`** — SQS event → AppSync mutation. For inbound-event-driven broadcasts (investor-bff feature-flag flips on circuit events, deposit detection broadcasts).

```ts
export interface BroadcastFromQueueConfig {
  serviceName: string;
  appsyncUrl: string;
  region?: string;
  broadcasts: Record<string, QueueBroadcastEntry>;  // keyed by event detail-type
}

export interface QueueBroadcastEntry {
  mutation: string;
  // Returns either a single variables object (one mutation per event) or an
  // array (multiple mutations per event — needed for the circuit-breaker
  // case where one BROKER_CIRCUIT_OPEN event flips three feature flags).
  mapPayload: (payload: EventPayload, ctx: EventContext) =>
    Record<string, unknown> | Record<string, unknown>[];
}

export function broadcastFromQueue(config: BroadcastFromQueueConfig): SQSHandler;
```

Composes `createIngestionHandler` (the engine `resumeStateMachine` uses) for SQS at-least-once handling, eventId-based dedup, `NotRetryableError` classification on missing required subject fields. The `Record<string, unknown> | Record<string, unknown>[]` return type accommodates the BROKER_CIRCUIT_OPEN/CLOSED case where one inbound event triggers a broadcast per affected feature flag.

**`shared/post-appsync-mutation.ts`** — pure SigV4 + POST helper. Used internally by both pipelines. Captures the cross-cutting concern, including the AppSync filter-arg gotcha documented in `project_decision_workflow_stuck.md:118`:

```ts
export async function postAppSyncMutation(args: {
  appsyncUrl: string;
  region?: string;
  mutation: string;
  variables: Record<string, unknown>;
}): Promise<void>;
```

Behavior matches the existing `dashboard-publisher.ts:callAppSyncMutation` (warn-and-return on missing URL, log-and-skip on HTTP non-2xx, log-and-skip on GraphQL errors — broadcast loss is non-fatal). No throw; pipeline error budgets reserved for retryable transient cases the engines already handle. Exported from `@nestfolio/event-processor` for callers that compose broadcasts into existing pipelines (currently no such callers — both pipelines own the call).

### 4.2 advisory-bff broadcast wiring

**Schema changes** (`services/advisory/advisory-bff/src/schema.graphql`):

```graphql
type Mutation {
  confirmDecision(decisionId: ID!): DecisionPacket! @aws_cognito_user_pools
  rejectDecision(decisionId: ID!, reason: String!): DecisionPacket! @aws_cognito_user_pools
  recordExplanationView(decisionId: ID!): ViewReceipt! @aws_cognito_user_pools
  publishDecisionUpdate(
    decisionId: ID!
    tenantId: ID!
    status: DecisionStatus!
    explanation: String!
    proposedTrades: [ProposedTradeInput!]!
    version: Int!
    updatedAt: String!
  ): DecisionPacket! @aws_iam
}

type Subscription {
  onDecisionUpdate(tenantId: ID!): DecisionPacket!
  @aws_subscribe(mutations: ["confirmDecision", "rejectDecision", "publishDecisionUpdate"])
  @aws_cognito_user_pools
  @aws_iam
}

input ProposedTradeInput {
  symbol: String!
  assetClass: String!
  side: TradeSide!
  quantityOrAmountCents: Int!
  targetWeightPercent: Float!
  rationale: String!
}
```

`DecisionPacket` already has `tenantId: ID!` (line 55) — required for AppSync's filter-arg matching against the mutation RESPONSE. ✅

Defensive `@aws_iam` annotations added to fields the IAM caller will read in the mutation response (matches the dashboard-bff fix's defensive pattern: `PortfolioSummary`/`PositionSnapshot`/etc. were annotated for the same reason).

**Resolver** (`services/advisory/advisory-bff/src/graphql/js-function/publish-decision-update.fn.js`): pure echo, IAM-only, no DDB access.

```js
export function request(ctx) {
  return { payload: null };
}
export function response(ctx) {
  return ctx.arguments;  // echoes all arguments back unchanged
}
```

Wired via `noneDataSource: ['publishDecisionUpdate']` in `discoverJsResolvers` config.

**Stack changes** (`services/advisory/advisory-bff/src/service.stack.ts`):
- `Facade`: `enableIamAuth: true` (currently false implicit).
- New `NodejsFunction` `DecisionPublisher` wired via `DynamoEventSource` to `state.getTable()`, mirroring `dashboard-bff/src/service.stack.ts:53-69`.
- `addToRolePolicy({ actions: ['appsync:GraphQL'], resources: [`${facade.api.arn}/*`] })`.
- `environment: { APPSYNC_URL: facade.graphqlUrl }`.
- `addObservability` updated to include the new function.

**Handler** (`services/advisory/advisory-bff/src/handlers/decision-publisher.ts`):

```ts
import { broadcastFromStream } from '@nestfolio/event-processor';

const PUBLISH_DECISION_UPDATE = `
  mutation PublishDecisionUpdate(
    $decisionId: ID!, $tenantId: ID!, $status: DecisionStatus!,
    $explanation: String!, $proposedTrades: [ProposedTradeInput!]!,
    $version: Int!, $updatedAt: String!
  ) {
    publishDecisionUpdate(
      decisionId: $decisionId, tenantId: $tenantId, status: $status,
      explanation: $explanation, proposedTrades: $proposedTrades,
      version: $version, updatedAt: $updatedAt
    ) {
      decisionId tenantId status explanation proposedTrades version updatedAt
    }
  }
`;

export const handler = broadcastFromStream({
  serviceName: 'advisory-bff',
  appsyncUrl: process.env.APPSYNC_URL!,
  broadcasts: {
    DecisionReadModel: {
      mutation: PUBLISH_DECISION_UPDATE,
      whenChanged: ['status', 'explanation', 'proposedTrades', 'version'],
      // skipInsert: false (default) — initial PENDING state can land in clients
      // that subscribed early. Defence against subscribe-before-write race.
      mapImage: (item) => ({
        decisionId: item.decisionId,
        tenantId: item.tenantId,
        status: item.status,
        explanation: item.explanation ?? '',
        proposedTrades: item.proposedTrades ?? [],
        version: Number(item.version ?? 0),
        updatedAt: String(item.updatedAt ?? new Date().toISOString()),
      }),
    },
  },
});
```

The existing `event-publisher.ts` (`changeDataCapture()`) is **untouched**. CDC to EventBridge and broadcast to AppSync are independent post-commit side-effects, separate Lambdas, separate failure domains.

### 4.3 Frontend — subscribe-before-query (R1) + version guard

**`apps/advisory-mfe/src/app/services/advisory.service.ts`** — `subscribeToDecisionUpdates(tenantId, decisionId, onUpdate)` signature gains `tenantId` first arg, passed as the `$tenantId` GraphQL variable.

**`apps/advisory-mfe/src/app/graphql/advisory-bff.queries.ts`** —
- `ON_DECISION_UPDATE` becomes `subscription OnDecisionUpdate($tenantId: ID!) { onDecisionUpdate(tenantId: $tenantId) { ...DecisionFields } }`.
- `DECISION_FIELDS` fragment must include `tenantId` so `confirmDecision` / `rejectDecision` mutation responses carry it (AppSync's `@aws_subscribe` filter-arg matches the mutation RESPONSE, per §5.4).

**`apps/advisory-mfe/src/app/decision/decision-detail.component.ts:loadDecision`** — reorder:

```ts
private async loadDecision(decisionId: string): Promise<void> {
  this.store.setLoading(true);
  this.store.setError(null);

  // R1: attach subscription BEFORE the queries fire. Any frame that arrives
  // during query resolution is patched into the store via the version-guarded
  // handler; setDecision() from the query may overwrite if its version is >=.
  const tenantId = this.authStore.user()?.tenantId;
  if (!tenantId) {
    this.store.setError('errors.missingTenant');
    return;
  }
  this.advisoryService.subscribeToDecisionUpdates(tenantId, decisionId, (updated) => {
    const current = this.store.decision();
    if (!current || updated.version >= current.version) {
      this.store.setDecision(updated);
    }
  });

  try {
    const [decision, invocations, checks] = await Promise.all([
      this.advisoryService.getDecision(decisionId),
      this.advisoryService.getAgentInvocations(decisionId),
      this.advisoryService.getComplianceChecks(decisionId),
    ]);
    const current = this.store.decision();
    if (!current || decision.version >= current.version) {
      this.store.setDecision(decision);
    }
    this.store.setAgentInvocations(invocations);
    this.store.setComplianceChecks(checks);

    this.advisoryService.recordExplanationView(decisionId).catch(/* ... */);
  } catch (e: unknown) {
    this.store.setError(parseError(e, 'errors.decision'));
  } finally {
    this.store.setLoading(false);
  }
}
```

**Why version-guard on both branches:** without ordering guarantees, a late-arriving frame could clobber a newer image already in the store. The store always converges to the highest-versioned image. `version` is on the existing `DecisionPacket` schema (line 68).

### 4.4 Migrations (close PARKING LOT item: "Generalise AppSync IAM publisher pattern")

**`services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts`** — replace inline `callAppSyncMutation` + handler body with `broadcastFromStream` config:

```ts
export const handler = broadcastFromStream({
  serviceName: 'dashboard-bff',
  appsyncUrl: process.env.APPSYNC_URL!,
  broadcasts: {
    AdvisoryStatus: {
      mutation: PUBLISH_DASHBOARD_UPDATE,
      whenChanged: ['pendingDecisionsCount', 'lastRecommendationAt', 'lastDecisionStatus'],
      mapImage: (item) => {
        const tenantId = String(item.pk ?? '').slice(2);  // 'T#<tenantId>' → '<tenantId>'
        return {
          tenantId,
          advisoryStatus: {
            pendingDecisionsCount: Number(item.pendingDecisionsCount ?? 0),
            lastRecommendationAt: item.lastRecommendationAt ?? null,
            lastDecisionStatus: item.lastDecisionStatus ?? null,
            updatedAt: String(item.updatedAt ?? new Date().toISOString()),
          },
        };
      },
    },
  },
});
```

Net delete: ~60 lines of SigV4 boilerplate.

**investor-bff — Lambda split (3 broadcast call sites + 5 materialize handlers in one Lambda today; clean separation justified):**

The current `services/investor/investor-bff/src/handlers/event-listener.ts` mixes:
- Materialize handlers (USER_REGISTERED, NOTIFICATION_CREATED, BALANCE_UPDATED, ONBOARDING_COMPLETED, OPERATING_MODE_CHANGED, GO_LIVE_CONFIRMED) — each returns `WriteIntent` or `skip()`.
- Broadcast-only handlers that return `skip()`: BROKER_CIRCUIT_OPEN (3 `updateFeatureFlag` mutations), BROKER_CIRCUIT_CLOSED (3 `updateFeatureFlag` mutations), DEPOSIT_DETECTED (1 `publishDepositEvent` mutation).
- Inline `callAppSyncMutation` SigV4 helper (~40 lines).

Migration:

1. **Existing `event-listener.ts`** — drop the 3 broadcast-only handlers, drop the inline `callAppSyncMutation` helper, drop the SigV4 imports. Stays as the materialize-only Lambda. Net: ~80 lines deleted.
2. **New `services/investor/investor-bff/src/handlers/broadcast-listener.ts`** — runs `broadcastFromQueue` with a config object covering all three event types:

```ts
export const handler = broadcastFromQueue({
  serviceName: 'investor-bff',
  appsyncUrl: process.env.APPSYNC_URL!,
  broadcasts: {
    [InvestorBffEventTypes.BROKER_CIRCUIT_OPEN]: {
      mutation: UPDATE_FEATURE_FLAG,
      mapPayload: () => [
        { name: 'confirmDecision', enabled: false, reason: 'Broker connectivity issue' },
        { name: 'initiateDeposit', enabled: false, reason: 'Broker connectivity issue' },
        { name: 'requestWithdrawal', enabled: false, reason: 'Broker connectivity issue' },
      ],
    },
    [InvestorBffEventTypes.BROKER_CIRCUIT_CLOSED]: {
      mutation: UPDATE_FEATURE_FLAG,
      mapPayload: () => [
        { name: 'confirmDecision', enabled: true },
        { name: 'initiateDeposit', enabled: true },
        { name: 'requestWithdrawal', enabled: true },
      ],
    },
    [InvestorIngestEventTypes.DEPOSIT_DETECTED]: {
      mutation: PUBLISH_DEPOSIT_EVENT,
      mapPayload: (payload) => {
        const subject = payload.subject as { /* ... */ };
        return { input: { /* depositId, tenantId, userId, status: 'DETECTED', ... */ } };
      },
    },
  },
});
```

3. **CDK changes in `services/investor/investor-bff/src/service.stack.ts`** — add a second `Ingress` construct (mirroring the dual-Ingress pattern in `decision-workflow-ctrl`):

```ts
const broadcastIngress = new Ingress(this, 'BroadcastIngress', {
  state,
  handler: 'broadcast-listener.ts',
  eventTypes: [
    InvestorBffEventTypes.BROKER_CIRCUIT_OPEN,
    InvestorBffEventTypes.BROKER_CIRCUIT_CLOSED,
    InvestorIngestEventTypes.DEPOSIT_DETECTED,
  ],
});
broadcastIngress.lambda.addEnvironment('APPSYNC_URL', facade.graphqlUrl);
broadcastIngress.lambda.addToRolePolicy(new PolicyStatement({
  actions: ['appsync:GraphQL'],
  resources: [`${facade.api.arn}/*`],
}));
```

The existing `Ingress` (now broadcast-stripped) drops these three event types from its subscription list. `addObservability` updated to include both Ingresses.

**Why two Lambdas instead of composing in one:** the existing `materializeToTable` and the new `broadcastFromQueue` are independent pipeline contracts (one returns WriteIntents, the other fires HTTP side-effects). Composing them in a single Lambda would either require a new "multi-pipeline" abstraction (out of scope) or revert to the inline-broadcast-from-materialize-handler pattern this spec is removing. Two Lambdas is the standard nestfolio pattern when concerns differ — `decision-workflow-ctrl` already has two Ingress constructs (TriggerIngress + CallbackIngress) for the same reason.

**Idempotency note (BROKER_CIRCUIT_OPEN):** today's inline implementation fires three `updateFeatureFlag` mutations in a `for` loop; if mutation 2 fails, mutations 1 and 3 land but the SQS message retries and re-fires all three. Net effect: feature flags converge to disabled. The pipeline preserves this behaviour via `mapPayload` returning an array (broadcast pipeline iterates each, all-or-nothing per array; engine retries the message on any failure). Acceptable per the existing dev tolerance of feature-flag idempotency.

Net delete from event-listener.ts: ~80 lines (three handlers + SigV4 helper). Net add: one new handler file (~50 lines) + ~10 lines of CDK.

## 5. Idempotency, ordering, security

### 5.1 At-least-once delivery (engine-level)

Both pipelines inherit existing engine semantics:
- `broadcastFromStream` via `EgestionEngine` — DynamoDB Streams give at-least-once; per-record failure surfaced for retry, structured logging.
- `broadcastFromQueue` via `createIngestionHandler` — SQS at-least-once; `eventId`-based dedup; `NotRetryableError` classification on missing required subject fields.

### 5.2 Broadcast-side idempotency

`publishDecisionUpdate` resolver is a pure echo (`return ctx.arguments`) — no DDB write, no other side-effect. Re-firing the same mutation produces an identical broadcast payload. AppSync may broadcast twice; subscribers `setDecision` with the same payload — net no-op. The version-guard in §4.3 also prevents re-application from regressing newer state.

### 5.3 Stale-write protection (client-side)

Version-guard in `decision-detail.component.ts:loadDecision` (§4.3) — store accepts an image only if `incoming.version >= current.version`. Handles all four interleavings of `subscribe-attach`, `query-resolve`, and `broadcast-arrive`.

### 5.4 Tenant isolation (three layers — the AppSync filter-arg gotcha taught us 2026-04-30)

1. **Schema:** `onDecisionUpdate(tenantId: ID!)` — typed required arg.
2. **Mutation response selection:** every `publishDecisionUpdate` call selects `tenantId` (otherwise AppSync's filter-arg matching against the mutation RESPONSE never matches and broadcasts silently drop).
3. **Resolver echo:** `tenantId: ctx.arguments.tenantId` — single source of truth, not derived elsewhere.

`confirmDecision` and `rejectDecision` mutations also need `tenantId` in the **client-side** response selection so the same `onDecisionUpdate(tenantId)` filter matches when these mutations broadcast. `DecisionPacket` schema already includes `tenantId`; the fragment in `apps/advisory-mfe/src/app/graphql/advisory-bff.queries.ts` (`DECISION_FIELDS`) must select it. This is a frontend fragment change covered in §4.3.

### 5.5 IAM authorization

`publishDecisionUpdate` mutation is `@aws_iam` only — not exposed to Cognito clients. The `DecisionPublisher` Lambda calls it via SigV4-signed POST. Subscription supports both `@aws_cognito_user_pools` (clients) and `@aws_iam` (defensive — matches dashboard-bff precedent).

## 6. Testing

### 6.1 Library tests (`libs/event-processor/test/`)

- **`pipelines/broadcast-from-stream.test.ts`**:
  - Declarative dispatch: matched typename → matched mutation; unmatched typename → skip.
  - `whenChanged` field-diff: broadcasts when listed field changes; skips when only unlisted fields change.
  - `skipInsert` toggle: when `true`, INSERT events skipped; when `false` (default), INSERT broadcasts.
  - `shouldBroadcast` escape-hatch overrides `whenChanged` when supplied.
  - `mapImage` produces variables; falsy/missing fields handled defensively.
  - Partial-batch failure surfaced via engine response.
- **`pipelines/broadcast-from-queue.test.ts`**:
  - Declarative dispatch on event detail-type.
  - `mapPayload` single-object form: one mutation per event.
  - `mapPayload` array form: N mutations per event (BROKER_CIRCUIT_OPEN feature-flag fan-out).
  - `NotRetryableError` on missing required subject fields.
  - SQS retry on transient AppSync failure; eventId-dedup honoured.
- **`shared/post-appsync-mutation.test.ts`** (extracted from existing dashboard-publisher mocks):
  - SigV4 header presence (Authorization, X-Amz-Date, X-Amz-Content-Sha256).
  - Missing `appsyncUrl` warn-and-return (no throw).
  - HTTP non-2xx logged-and-skipped (no throw).
  - GraphQL `errors[]` logged-and-skipped (no throw).

### 6.2 Service tests

- **`services/advisory/advisory-bff/test/unit/handlers/decision-publisher.test.ts`** — wiring smoke: config matches `whenChanged` field set, `mapImage` projection matches schema fields, IAM grant + APPSYNC_URL env present in `service.stack.test.ts`.
- **`services/advisory/advisory-bff/test/unit/transforms/decision-status-changed.test.ts`** — unchanged (transform untouched).
- **`services/investor/dashboard-bff/test/unit/handlers/dashboard-publisher.test.ts`** — migration regression: same observable behaviour, now via pipeline.
- **`services/investor/investor-bff/test/unit/handlers/event-listener.test.ts`** — update: drops the 3 broadcast-handler test cases (now in broadcast-listener tests). Keeps materialize coverage.
- **`services/investor/investor-bff/test/unit/handlers/broadcast-listener.test.ts`** — new: covers all three broadcast paths (BROKER_CIRCUIT_OPEN/CLOSED → 3-flag fan-out via array `mapPayload`; DEPOSIT_DETECTED → single-mutation form). SigV4 mock recording verifies expected variables per call.
- **`services/investor/investor-bff/test/unit/service.stack.test.ts`** — assert second `Ingress` exists, broadcast-listener has `appsync:GraphQL` IAM grant + `APPSYNC_URL` env, broadcast event-type subscription list (BROKER_CIRCUIT_OPEN/CLOSED + DEPOSIT_DETECTED).

### 6.3 Integration tests

- **`services/advisory/advisory-bff/test/integration/decision-broadcast.integration.test.ts`** — emit `USER_CONFIRMATION_REQUESTED` → assert AppSync `publishDecisionUpdate` mutation called with expected variables (verify via SigV4 mock recording, per existing dashboard-publisher integration patterns). Additional assertion: status transition `PENDING → AWAITING_CONFIRMATION` triggers exactly one broadcast (whenChanged guard).

### 6.4 Frontend tests (`apps/advisory-mfe/test/`)

- `app/decision/decision-detail.component.spec.ts` — extend with:
  - subscribe attaches before query (R1 reorder).
  - tenantId passed to `subscribeToDecisionUpdates`.
  - version-guard drops stale frame.
  - version-guard accepts newer frame.
- `app/services/advisory.service.spec.ts` — `subscribeToDecisionUpdates(tenantId, decisionId, ...)` signature change.

## 7. Validation gate

**Primary (the only gate that decides ship-readiness):**

> `pnpm nx run nestfolio-e2e:e2e` runs `new-investor-happy-path.spec.ts` against deployed dev **5 consecutive times**. All 5 reach Step 11 (logout). Steps 9-10 pass without timeout. **No POM changes ship** (per `feedback_e2e_ui_assertions_only.md`).

**Negative-validation (regression checks):**
- `dashboard-bff` post-migration: `injectAdvisoryUpdate` sentinel still arrives on the dashboard counter via WSS (still currently broken per Step 8 QUEUED — but the migration must not make it worse). Track via the existing Step 8 instrumentation in `graphql.service.ts`.
- `investor-bff` post-migration: `DEPOSIT_DETECTED → publishDepositEvent` still fires; investor WSS subscription receives the frame (already verified working today; this is a regression check only, not a fix).

**Operational telemetry:** the `DecisionPublisher` Lambda emits CloudWatch logs with `eventId`, `tenantId`, `decisionId`, `oldStatus`, `newStatus`, `broadcastResult` per record. Aggregate `broadcastFailureCount` over the 5-run window must be 0.

## 8. Rollout

Single commit / single PR / single dev deploy. No staging gate; dev environment is disposable per `feedback_no_deprecation.md`.

Touched stacks:
- `dev-libs-event-processor` (no CDK; npm-only)
- `dev-advisory-bff` — schema + new function + IAM grants + `enableIamAuth`
- `dev-dashboard-bff` — handler refactor only, no CDK changes
- `dev-investor-bff` — handler refactor + new `BroadcastIngress` (second SQS queue + EB Rule + Lambda)

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `enableIamAuth` flip on advisory-bff Facade affects existing Cognito callers | All existing mutations/queries explicitly annotated `@aws_cognito_user_pools` (already true today); IAM is additive. Verified by full test pass before deploy. |
| Schema deploy reorders subscription auth, transient client disconnect | Existing clients reconnect via Apollo's standard reconnect logic. Acceptable for dev. |
| Migration regression in dashboard-bff Step-8 path | Negative-validation gate covers this; if regression detected, separate-revert path exists (each handler is independent). |
| investor-bff Lambda split: BROKER_CIRCUIT_OPEN now arrives twice (once at materialize Ingress that handles other events, once at new BroadcastIngress) and could double-process | Materialize Ingress drops BROKER_CIRCUIT_OPEN/CLOSED + DEPOSIT_DETECTED from its `eventTypes` list — these go ONLY to the BroadcastIngress. Each event lands at exactly one queue. Verified in `service.stack.test.ts`. |
| Feature-flag idempotency under SQS retry (BROKER_CIRCUIT_OPEN/CLOSED 3-flag fan-out) | All three flags converge to the target state on retry; existing dev tolerance preserved (no behaviour change vs. today's inline implementation). Operational follow-up: flip `updateFeatureFlag` resolver to use conditional writes if production exposure changes the calculus. |
| `whenChanged` semantics edge case: array-field deep equality | Pipeline uses shallow strict-equality on field values. `proposedTrades` arrays will broadcast on any insertion/update (DDB stream image diff naturally handles this — `OldImage[field] !== NewImage[field]` for array references). Test covers. |
| Pipeline failure swallows broadcast loss silently | `shared/post-appsync-mutation.ts` already logs structured errors; CloudWatch alarm on `broadcastFailureCount > 0` is operational follow-up (not in this spec). |

## 10. Observability

Each pipeline emits structured logs at INFO on broadcast, ERROR on failure:
- `serviceName`, `pipelineName` (`broadcast-from-stream` / `broadcast-from-queue`)
- `eventId`, `tenantId`, `decisionId` (or domain-equivalent identifiers)
- `mutationName`, `appsyncStatus` (HTTP code), `graphqlErrors[]` if any
- For `from-stream`: `oldStatus`, `newStatus`, `whenChangedTriggered: string[]`
- For `from-queue`: `inboundEventType`

CloudWatch dashboard widget (regression check, not in this spec): `broadcastFailureCount` per service, sum over 5-min window.

## 11. References

- `feedback_e2e_ui_assertions_only.md` — captured 2026-05-01; the principle that drove the architectural-fix-not-band-aid choice.
- `project_decision_workflow_stuck.md:100-118` — dashboard-bff WSS fix shipped 2026-04-30; the AppSync filter-arg gotcha; the `advisory-bff onDecisionUpdate` "no args at all" cross-tenant note this spec resolves.
- `project_playwright_e2e_ui.md` — full session-by-session journey of the e2e blocker chain.
- `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts` — the precedent for the broadcast pattern.
- `services/investor/investor-bff/src/handlers/event-listener.ts:2,27,76` — the precedent for the queue-side broadcast pattern.
- `libs/event-processor/src/pipelines/resume-state-machine.ts` — the SQS-input pipeline shape this spec mirrors.
- `libs/event-processor/src/pipelines/change-data-capture.ts` — the DDB-stream-input pipeline shape this spec mirrors.
- `docs/superpowers/specs/2026-04-30-advisory-pipeline-consolidation-design.md` (Spec 2) — context on the resolved Memory namespace alignment.
