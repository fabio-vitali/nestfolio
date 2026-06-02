---
id: bff-publisher-stream-dlq
status: queued
rank: 12
type: infra
notes: "BFF stream broadcast publishers (dashboard + deposit) lack a DLQ/bisect on their DynamoEventSource — best-effort today; harden consistently."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# BFF stream-broadcast publishers have no DLQ / bisectBatchOnError

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

**Cheapest next step:** add a shared DLQ + `bisectBatchOnError: true` to both publishers' event
sources (mirror the `Egress` construct's `SqsDlq`/`bisectBatchOnError` config in
`libs/cdk-constructs/src/core/egress.ts`), and a CloudWatch alarm on the DLQ depth. Do both
publishers in one pass for consistency. See [[project_read_model_redesign]].
