---
id: bff-publisher-stream-dlq
status: shipped
rank: 10
type: infra
notes: "BFF stream-broadcast publishers (dashboard + deposit) are the only stream-infra in the repo written as raw inline NodejsFunction + DynamoEventSource, bypassing the construct family — and they lack a DLQ/bisect. Extract a 7th first-class construct (Broadcaster) that encapsulates the publisher + DLQ + bisect + onFailure + AppSync IAM grant, refactor both stacks onto it, and auto-wire it into addObservability (typed broadcasters:[] option) so the DLQ-depth + Lambda alarms fall out for free."
references:
  - libs/cdk-constructs/src/core/egress.ts
  - libs/cdk-constructs/src/observability/monitoring.ts
  - libs/cdk-constructs/src/core/service-stack.ts
  - services/investor/dashboard-bff/src/service.stack.ts
  - services/investor/investor-bff/src/service.stack.ts
out_of_scope:
  - "Retrofitting Egress / Ingress / Orchestration (already encapsulated constructs with their own DLQs) — Broadcaster only absorbs the two inline publishers."
  - "Tuning alarm thresholds / SNS subscriptions beyond the existing Monitoring construct defaults (DLQ depth > 0, Lambda errors/throttles > 0)."
  - "Changing the broadcast handlers themselves (dashboard-publisher.ts, deposit-publisher.ts) or the @aws_subscribe transport contract — construct extraction only."
  - "Backfilling a literally-shared cross-stack DLQ — the two services own independent tables/streams, so one DLQ per stack (anti-pattern to share across stacks)."
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: |
  Shipped 2026-06-04 via the Broadcaster construct (7th first-class construct).
  Code: a43dcf05 (broadcaster.ts + addObservability broadcasters:[] + both BFF
  stacks refactored); cards/doc-sweep: 0a448cfc.
  - nx affected -t test,lint --base=origin/main → 37 projects green.
  - cdk-constructs unit: 21 suites / 349 tests (incl broadcaster.test.ts 13/13:
    DLQ 14d, bisectBatchOnError, onFailure SqsDlq, appsync grant present/absent, env).
  - Stack regression: dashboard-bff service.stack.test.ts 3/3 (1 stream consumer =
    DashboardBroadcaster, DLQ+bisect+onFailure); investor-bff 2/2 (2 stream consumers
    = Egress + DepositBroadcaster, every consumer DLQ+bisect).
  - Deploy (sandbox, prefix=dev): dev-dashboard-bff + dev-investor-bff UPDATE_COMPLETE;
    clean logical-ID replacement (old DashboardPublisher/DepositPublisher Lambda +
    EventSourceMapping deleted, new Broadcaster ones created); investor-bff momentary
    3-stream-consumer window rode through with no throttling.
  - Integration (live dev): dashboard-bff 21/21, investor-bff 20/20.
  - Involved e2e (live dev): funding fund-account + withdraw-cash 2/2 (DepositBroadcaster
    onDeposit/onWithdrawal live-push end-to-end).
  Follow-up filed: broadcaster-construct-doc-sweep (parking) — pattern-level 6→7 docs
  (cdk-patterns/create-service SKILL.md + root CLAUDE.md) blocked by auto-mode guard.
---

# BFF stream-broadcast publishers have no DLQ / bisectBatchOnError

> ⚠ **Read-model refactoring item.** Any side-finding required to call this refactoring complete must be **folded into a QUEUED read-model item, never parked in LATER** — see `CLAUDE.md` § "Backlog Discipline" (refactoring-completeness exception).


The two DynamoDB-stream broadcast publishers attach a `DynamoEventSource` with only
`retryAttempts: 3` — no `bisectBatchOnError`, no `onFailure` DLQ:

- `services/investor/dashboard-bff/src/service.stack.ts:53-63` (`DashboardPublisher`)
- `services/investor/investor-bff/src/service.stack.ts` (`DepositPublisher`, added in
  `bff-readmodel-w5-externally-settled-entities` Phase 6)

Consequence: a poison-pill record fails the whole batch and, after 3 retries, the batch is
dropped — and without `bisectBatchOnError`, a single bad record can take down good broadcasts in
the same batch.

**Why parking (not blocking):** these broadcasts are best-effort, post-commit side effects. The
projected read-model row (written by `projectVersioned`) is the persisted source of truth, and the
client recovers the current state via `getDeposit`/`getDashboard` on the next load/refresh. A
dropped broadcast = a missed *live* update, not lost data. This matches the deliberate dashboard-bff
precedent the Phase-6 transport mirrored.

**Re-scoped 2026-06-04 (architectural decision — own the pattern, don't rule-of-three it):**
The two publishers are the *only* stream-infra in the repo written as raw inline `NodejsFunction` +
`DynamoEventSource`, bypassing the construct family (State / Ingress / Egress / Facade / AgentRuntime
/ Orchestration). The faithful way to "mirror Egress" is not to copy 15 lines into two stacks — Egress
*is* a construct — but to make the publisher a construct too. So this promotes the documented
**6-construct pattern to 7** by adding a first-class **`Broadcaster`** construct.

**`Broadcaster`** (`libs/cdk-constructs/src/core/broadcaster.ts`) encapsulates:
- a per-stack SQS DLQ (14-day retention, `KMS_MANAGED` — mirrors `Egress`),
- the `NodejsFunction` publisher (`defaultLambdaProps`, `APPSYNC_URL` env from `facade.graphqlUrl`),
- the `DynamoEventSource` with `startingPosition: LATEST`, `bisectBatchOnError: true`,
  `retryAttempts: 3`, `onFailure: new SqsDlq(dlq)`,
- the conditional `appsync:GraphQL` IAM grant (when `facade.api` is present),
- and exposes `.handler` + `.dlq` exactly like `Egress`.

`addObservability` gains a typed `broadcasters?: Broadcaster[]` option (mirroring how it already
special-cases `ingress`/`egress`/`orchestration`) so the existing `Monitoring` construct
auto-creates the DLQ-depth alarm **and** the publisher Lambda error/throttle alarms (which the inline
publishers lack today). No net-new alarm code; the DLQ hardening falls out as a property of the
construct and can never be forgotten at the next call-site.

Both `dashboard-bff` and `investor-bff` stacks then shrink to a single
`new Broadcaster(this, '…', { state, entry, facade })`. See [[project_read_model_redesign]].
