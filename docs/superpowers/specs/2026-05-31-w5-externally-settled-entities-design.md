# w5 — Externally-settled entities (deposits / withdrawals): implementation design

**Status:** draft for review
**Date:** 2026-05-31
**Backlog:** `bff-readmodel-w5-externally-settled-entities` (effort: xhigh)
**Parent spec:** `docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md` (§"Externally-settled entities", §"Decisions")
**Topic memory:** `project_read_model_redesign.md`

This document settles the implementation-level choices the parent spec deliberately
left open for w5. The parent spec is frozen; this doc does not re-litigate it.

---

## 1. Problem & current state (verified against code)

Deposits and withdrawals are **started** by the user but **finished** by an outside
system (the broker), so the BFF is not their owner. Today they are mis-modeled as
command-owned BFF rows, with two structural defects:

**Dual-writer anti-pattern.** The `Deposit` read-row is written by two writers:
- `initiate-deposit.fn.js` inserts `Deposit#<tid>#<id>` (status `INITIATED`) → CDC emits `DEPOSIT_INITIATED`.
- `broadcast-listener.ts` consumes `DEPOSIT_DETECTED` and calls `publishDepositEvent` to **update** the same row to `DETECTED`.

Same shape for `WithdrawalRequest` (`request-withdrawal.fn.js`).

**Deposit-settlement-never-persisted (latent bug #1).** broker-ctrl's normalizer
(`deposit-withdrawal-normalizer.ts:7-22`) writes `timestamp` but **not** `depositedAt`.
ledger-ctrl's `RecordDeposit` (`record-deposit.ts:5-9`) requires `depositedAt: z.string().min(1)`,
so `applyCommand` fails validation and `cashBalanceCents` is **never incremented**
(`account.reducer.ts:18-23`). Withdrawal has the symmetric `withdrawnAt` exposure.

**Current event flow (deposit, sim path):**
```
initiateDeposit → Deposit row (INITIATED) → CDC DEPOSIT_INITIATED
  → broker-ctrl router → SIM_DEPOSIT_INITIATED → broker-sim-adpt
  → SIM_DEPOSIT_COMPLETED → broker-ctrl normalizer → NormalizedEvent(sk=DEPOSIT_DETECTED)
  → CDC DEPOSIT_DETECTED
       ├→ ledger-ctrl RecordDeposit  ✗ fails (no depositedAt) → cash NOT updated
       └→ investor-bff broadcast-listener → publishDepositEvent → Deposit row = DETECTED ✓
```

---

## 2. Target ownership topology

`broker-ctrl` (Execution) becomes the **funding-lifecycle aggregate owner**. It is the
single writer of a per-transfer aggregate and the single emitter of versioned lifecycle
events. `investor-bff` `Deposit`/`WithdrawalRequest` rows become **pure P1 projections**.
`ledger-ctrl` consumes the **settled** terminal to adjust cash (it records the effect; it
does not own the funding rail). Consistent with Execution already owning the Order lifecycle.

```
                 intent (outbox→CDC)            versioned lifecycle events
 investor-bff  ───────────────────────▶  broker-ctrl  ──────────────────────▶  investor-bff (P1 projection)
 (DepositIntent row)   DEPOSIT_INITIATED   (Funding#<id> aggregate,            DEPOSIT_REQUESTED/DETECTED/
                                            status ordinal __version)          SETTLED/FAILED → Deposit row
                                                          │
                                                          └────────────────▶  ledger-ctrl (cash on *_SETTLED)
```

No new service. Orders stay as-is (already Execution-owned); w5 only aligns the funding
path to the same pattern.

---

## 3. Event taxonomy (consistency-checked against the codebase)

Per the system's dominant convention — confirmed across w3 DecisionPacket
(`DECISION_PACKET_CREATED/_UPDATED`, projected verbatim via `projectVersioned`), w1 ledger,
and broker-ctrl's own Order lifecycle (`ORDER_FILLED/REJECTED/…`) — lifecycle events use
**distinct semantic names, each carrying the full aggregate snapshot + `__version`**. We do
NOT collapse to a single `*_LIFECYCLE_UPDATED` event with a status field.

**Intent events (investor-bff outbox → broker-ctrl):**

| Event | Origin | Replaces |
|---|---|---|
| `DEPOSIT_INITIATED` | CDC on `DepositIntent` outbox row | (was: CDC on command-owned `Deposit` row) |
| `WITHDRAWAL_INITIATED` | CDC on `WithdrawalIntent` outbox row | renamed from `WITHDRAWAL_REQUESTED` (see D1) |

**Lifecycle events (broker-ctrl funding aggregate → investor-bff P1 + ledger-ctrl):**

| Event | Status ordinal (`__version`) | Carries | Consumed by |
|---|---|---|---|
| `DEPOSIT_REQUESTED` | 1 | full Funding snapshot | investor-bff (P1) |
| `DEPOSIT_DETECTED` | 2 | full snapshot | investor-bff (P1) |
| `DEPOSIT_SETTLED` | 3 | full snapshot incl. `settledAt` | investor-bff (P1) **+ ledger-ctrl (cash)** |
| `DEPOSIT_FAILED` | 3 | full snapshot incl. `reason` | investor-bff (P1) |
| `WITHDRAWAL_REQUESTED` | 1 | full snapshot | investor-bff (P1) |
| `WITHDRAWAL_SETTLED` | 3 | full snapshot incl. `settledAt` | investor-bff (P1) **+ ledger-ctrl (cash)** |
| `WITHDRAWAL_FAILED` | 3 | full snapshot incl. `reason` | investor-bff (P1) |

Withdrawal has no `detected` state (no external money-arrival step); deposit keeps `detected`
as the "funds visible at broker" step (sim emits it instantly before `settled`). See D2.

---

## 4. broker-ctrl — funding-lifecycle aggregate (the new owner)

**Aggregate row.** A mutable per-transfer row `Funding#<tid>#<transferId>` (sk `'Deposit'` or
`'Withdrawal'`), `__typename: 'Funding'`. Fields: `transferId`, `tenantId`, `userId`, `region`,
`direction` (`DEPOSIT|WITHDRAWAL`), `amountCents`, `currency`, `executionMode`, `status`
(`requested|detected|settled|failed`), `requestedAt`, `detectedAt?`, `settledAt?`, `failedAt?`,
`reason?`, and `__version` (status ordinal).

**Transitions (each is a single-writer update on the aggregate, then CDC emits the
matching semantic event carrying the full row):**
1. **Intent received** (existing `deposit-withdrawal-router` ingress on `DEPOSIT_INITIATED`/
   `WITHDRAWAL_INITIATED`): upsert `Funding` at `status=requested`, `__version=1`, then route to
   sim/alpaca as today → emits `DEPOSIT_REQUESTED`/`WITHDRAWAL_REQUESTED`.
2. **Detected** (deposit only; `deposit-withdrawal-normalizer` on `SIM_DEPOSIT_COMPLETED`/
   `ALPACA_TRANSFER_COMPLETED` incoming): update `status=detected`, `detectedAt`, `__version=2`
   → emits `DEPOSIT_DETECTED`.
3. **Settled** (terminal success): update `status=settled`, `settledAt = ctx.timestamp`,
   `__version=3` → emits `DEPOSIT_SETTLED`/`WITHDRAWAL_SETTLED`. **`settledAt` is the field
   ledger reads as `depositedAt`/`withdrawnAt` — latent bug #1 fixed by construction.**
   For the sim path, detected and settled fire in the same handler invocation (sim completes
   instantly); the version guard keeps them ordered (2 then 3).
4. **Failed** (terminal failure; `ALPACA_TRANSFER_FAILED`, or a sim failure): `status=failed`,
   `failedAt`, `reason`, `__version=3` → emits `DEPOSIT_FAILED`/`WITHDRAWAL_FAILED`.

**CDC.** Replace the throwaway `NormalizedEvent`-passthrough egress for the funding `sk`s with a
`Funding`-row egress mapping insert/modify transitions to the seven lifecycle event names
(Order events stay on the existing `NormalizedEvent` egress, untouched). The aggregate carries
`__version` so consumers can `projectVersioned`.

---

## 5. investor-bff — Deposit/WithdrawalRequest as P1 projections

1. **Ownership registry** (`read-model-ownership.ts`): flip
   `Deposit: CommandOwned` → `Projection<'P1'>`, `WithdrawalRequest: CommandOwned` → `Projection<'P1'>`.
2. **Intent/outbox separation.** `initiate-deposit.fn.js` / `request-withdrawal.fn.js` stop writing
   the `Deposit`/`WithdrawalRequest` read-rows. They write a transient outbox row
   `DepositIntent#<tid>#<id>` / `WithdrawalIntent#<tid>#<id>` (own `__typename`), whose CDC-insert
   emits `DEPOSIT_INITIATED`/`WITHDRAWAL_INITIATED`. The mutations still return a synthetic
   `Deposit`/`WithdrawalRequest` payload (status `INITIATED`/`REQUESTED`) so the client has an
   immediate optimistic value (see §7).
3. **Projection transforms.** A single transform per entity (mirroring w3's
   `decision-snapshot.ts`) handles all of that entity's lifecycle events and projects the full
   snapshot verbatim into the read-row via `projectVersioned('Deposit', {...}, { version: __version, overrides: { pk, sk } })`.
   Status maps from the event's `status` field; `detectedAt`/`failedAt`/`reason` flow through.
4. **Egress** (`service.stack.ts`): remove the `Deposit`/`WithdrawalRequest` insert→intent CDC
   mappings (the read-rows no longer originate intents); add the `DepositIntent`/`WithdrawalIntent`
   insert→intent mappings.
5. **Retire the dual-writer.** Delete the `broadcast-listener` `publishDepositEvent` UPDATE path
   and the `publish-deposit-event.fn.js` resolver — superseded by the projection. The Ingress now
   feeds the projection transforms (consuming the broker-ctrl lifecycle events) instead.
6. **GraphQL schema.** `Deposit`/`WithdrawalRequest` types are unchanged in shape; ensure
   `detectedAt`/`failedAt`/`reason`/`settledAt` are present where the UI needs them. Onboarding's
   `onboarding-completed.ts` deposit-seed path (today it command-writes a `Deposit` row) is
   re-pointed to emit a deposit **intent** instead, so the seeded deposit flows the same
   single-owner path (see D6).

---

## 6. ledger-ctrl — cash on settlement

1. **Move the cash-affecting subscription** from the detected/completed terminal to settled:
   `account.reducer.ts` event keys `DEPOSIT_DETECTED → DEPOSIT_SETTLED`,
   `WITHDRAWAL_COMPLETED → WITHDRAWAL_SETTLED`; update the ingress `eventTypes`
   (`event-listener.ts`) to subscribe to the `*_SETTLED` events.
2. **Source the timestamps from the settled event:** `depositedAt ← settledAt`,
   `withdrawnAt ← settledAt`. `RecordDeposit`/`RecordWithdrawal` schemas are unchanged; they now
   receive a present value, so cash is applied. (Optional hardening: keep the field names but read
   `p.settledAt ?? p.depositedAt` for back-compat — not required in dev.)
3. ledger-ctrl does **not** consume `*_REQUESTED`/`*_DETECTED` (no cash effect there).

---

## 7. Optimistic UI (client-side only)

Per the parent spec, the BFF never pre-writes the projected row. The MFE shows
"submitting…/pending" from the mutation's synthetic return value until the P1 projection
catches up (first `*_REQUESTED` projection, then `DETECTED`/`SETTLED`/`FAILED` arrive via the
existing subscription). This is the same read-your-own-writes-via-optimistic-cache approach the
parent spec prescribes for all intent-driven entities; no new transport. Exact MFE wiring
(Apollo optimisticResponse vs local pending flag) is settled in the plan, not here.

---

## 8. Decisions made in this doc (review-gate vetoable)

- **D1 — Rename withdrawal intent `WITHDRAWAL_REQUESTED` → `WITHDRAWAL_INITIATED`.** Frees
  `WITHDRAWAL_REQUESTED` for the lifecycle "requested" state (a fact emitted by the owner) and is
  symmetric with `DEPOSIT_INITIATED`. Breaking changes are free in dev.
- **D2 — Deposit lifecycle = requested→detected→settled→failed; withdrawal = requested→settled→failed.**
  Withdrawal has no external arrival step, so no `detected`.
- **D3 — Cash-affecting terminal is `*_SETTLED` (spec-faithful naming), not the legacy
  `DEPOSIT_DETECTED`/`WITHDRAWAL_COMPLETED`.** ledger migrates its subscription.
- **D4 — Intent transport = dedicated outbox row + CDC** (`DepositIntent`/`WithdrawalIntent`),
  not AppSync→EventBridge — reuses the codebase's dominant durable CDC pattern.
- **D5 — `__version` = status ordinal** (requested=1, detected=2, settled/failed=3), stamped by
  broker-ctrl on the `Funding` aggregate, carried in every lifecycle event.
- **D6 — Onboarding deposit seed re-pointed to the intent path** so there is exactly one funding
  owner, including the onboarding-originated deposit.
- **D7 — Resolve the withdrawal cash-debit double-count.** Today `request-withdrawal.fn.js`
  debits `CashBalance` synchronously inside a `TransactWriteItems` at *request* time (with an
  `attribute_exists(pk) AND cashBalanceCents >= :amount` guard for the insufficient-funds UX),
  while §6 also has ledger-ctrl debit cash on `WITHDRAWAL_SETTLED`. That is a **double-debit**.
  Chosen resolution: the resolver keeps an **optimistic client-side hold only** and stops writing
  the authoritative debit — but note `CashBalance` is a **P1 projection owned by ledger** (w4), so
  the resolver must NOT mutate it regardless (that write would already violate w4 ownership).
  Authoritative cash movement for *both* deposit and withdrawal happens once, in ledger-ctrl, on
  `*_SETTLED`. The insufficient-funds precondition moves to broker-ctrl at intent acceptance
  (reject the withdrawal → `WITHDRAWAL_FAILED` with reason), surfaced to the UI via the projection.
  Deposit has no symmetric issue (it only ever credited via ledger). The exact insufficient-funds
  UX (synchronous resolver error vs async `WITHDRAWAL_FAILED`) is finalized in the plan.

---

## 9. Testing strategy

- **broker-ctrl (unit):** aggregate transitions stamp the right status + ordinal `__version`;
  each transition emits the correct semantic event carrying the full snapshot incl. `settledAt`.
  CDK assertion: `Funding` egress maps the seven lifecycle event names; Order egress untouched.
- **investor-bff (unit):** `version-guard`-style tests (`expectVersionedWrite`/`expectStaleDrop`)
  on the Deposit/Withdrawal projections; out-of-order lifecycle events never regress `__version`;
  ownership registry compiles with the two rows as `Projection<'P1'>`.
- **ledger-ctrl (unit):** `account.reducer` applies cash on `*_SETTLED` with `settledAt` present;
  ignores `*_REQUESTED`/`*_DETECTED`; regression test for the depositedAt-missing bug.
- **Integration (auto-run, mocked agents):** investor-bff + broker-ctrl + ledger-ctrl integration
  suites assert the deposit/withdrawal flows end-to-end through the bus, incl. `__version` on the
  materialized rows and a non-zero cash balance after settlement (the bug-fix gate).
- **Scoped e2e (deploy-gated):** the deposit/funding scenario(s) in `apps/e2e-feature-tests`
  touching investor + execution + ledger. NOT the full suite, NOT Playwright.

---

## 10. Out of scope

- w6 governance/freeze enforcement (layers 3+4) — `bff-readmodel-w6-governance-freeze`.
- Real-broker (Alpaca) funding rails — lifecycle is modeled on the existing broker-sim path; the
  `ALPACA_*` handlers are kept wired but real-money funding is not implemented or validated.
- Re-touching w1–w4 rows except where the deposit/withdrawal/cash path requires it.
- Creating any new service; re-architecting Orders.
- Weight-drift / rebalance detection and the deferred `dashboard-live-push-*` transport items.

---

## 11. Risks & mitigations

- **Detected→settled same-invocation ordering (sim).** Two writes (v2 then v3) in one handler;
  rely on the version guard + sequential writes. Mitigation: write detected then settled in order;
  the projection's `projectVersioned` guard makes a reordered delivery a safe stale-drop.
- **Migration of in-flight rows.** Dev is disposable (no-deprecation policy); no data migration —
  existing dev rows are abandoned. Stale-self-heal clause on `projectVersioned` covers legacy rows.
- **Consumer fan-out on rename (D1/D3).** Grep-verify every subscriber of the renamed events
  (ledger ingress, any adapter `$or` rules, e2e fixtures) is updated atomically in the plan.
- **Withdrawal double-debit (D7).** The current synchronous resolver debit must be removed in the
  same change that adds ledger's settlement debit, or cash is debited twice. The plan treats these
  as one atomic step and adds an integration assertion that a withdrawal moves cash exactly once.
- **Insufficient-funds UX regression (D7).** Removing the resolver-side `cashBalanceCents >= :amount`
  precondition loses the synchronous "Insufficient funds" error. broker-ctrl must reject at intent
  acceptance (→ `WITHDRAWAL_FAILED`); the plan must preserve a usable UX for this path.
