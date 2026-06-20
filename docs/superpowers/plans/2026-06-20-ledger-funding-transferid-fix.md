# ledger-ctrl Funding Reducer transferId Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `DEPOSIT_SETTLED` / `WITHDRAWAL_SETTLED` credit/debit the ledger cash balance in production by reading the producer's real `transferId` (typed via `FundingSnapshotSchema`) instead of the absent `depositId` / `withdrawalId`.

**Architecture:** Single service (ledger-ctrl), single seam — the `account.reducer.ts` funding branches. They parse the persisted payload with the producer contract `FundingSnapshotSchema` and build the existing `RecordDeposit` / `RecordWithdrawal` commands (ledger vocabulary, unchanged) from typed fields. No producer, contract, or infra change.

**Tech Stack:** TypeScript, zod, `@nestfolio/event-processor/sourcing` (`applyCommand`, `EventReducer`), Jest, Nx, CDK (DynamoDB-stream reducer Lambda), AWS dev sandbox.

## Global Constraints

- Tests live in `test/` (here `test/unit/domain/`), never `src/__tests__/`. (CLAUDE.md)
- Run tasks through `pnpm nx`, never the underlying tool directly. (CLAUDE.md)
- No silent fallback on contract violations — use `.parse` (throw), not `.safeParse`-and-skip. (user memory: no-silent-fallback)
- Command schemas `RecordDeposit` / `RecordWithdrawal` keep ledger vocabulary (`depositId`/`depositedAt`, `withdrawalId`/`withdrawnAt`) — do NOT rename them.
- Worktree commits need `--no-verify`, and each commit must be verified as landed. (user memory)
- `FundingSnapshotSchema` import path: `@nestfolio/execution-adpt/domain` (already imported by `handlers/event-listener.ts`; resolves under ledger-ctrl jest).

---

### Task 1: Typed funding reducer fix + unit regression

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/domain/account.reducer.ts` (DEPOSIT_SETTLED / WITHDRAWAL_SETTLED branches + import)
- Test: `services/ledger/ledger-ctrl/test/unit/domain/account.reducer.test.ts`

**Interfaces:**
- Consumes: `FundingSnapshotSchema` from `@nestfolio/execution-adpt/domain` — fields used: `transferId: string`, `amountCents: number`, `settledAt?: string`, `timestamp: string`. Existing `RecordDeposit` (`{ depositId, amountCents, depositedAt }`) and `RecordWithdrawal` (`{ withdrawalId, amountCents, withdrawnAt }`) commands — signatures unchanged.
- Produces: behavioral change only — `accountReducer(state, entry)` now credits/debits `cashBalanceCents` on honest `FundingSnapshot` `DEPOSIT_SETTLED` / `WITHDRAWAL_SETTLED` entries. No new exported symbols.

- [ ] **Step 1: Correct the co-wrong fixtures + add regression assertions (write the failing tests)**

In `services/ledger/ledger-ctrl/test/unit/domain/account.reducer.test.ts`, replace the two existing
`applies DEPOSIT_SETTLED` / `applies WITHDRAWAL_SETTLED` blocks (lines 5-21) with honest-shape fixtures
and add a `settledAt`-absent fallback case. Leave every other test untouched (DEPOSIT_DETECTED hits the
default branch — no parse — so its `{ depositId, … }` payload stays valid).

```ts
  it('applies DEPOSIT_SETTLED (honest FundingSnapshot shape credits balance)', () => {
    const next = accountReducer(INITIAL_ACCOUNT_STATE, {
      eventId: 'e1', eventType: 'DEPOSIT_SETTLED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: {
        sk: 'DEPOSIT_SETTLED', direction: 'DEPOSIT', status: 'settled',
        transferId: 'd1', amountCents: 500_00, currency: 'USD', executionMode: 'simulation',
        initiatedAt: '2026-03-12T00:00:00Z', settledAt: '2026-03-12T00:00:00Z',
        timestamp: '2026-03-12T00:00:00Z',
      },
    });
    expect(next.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents + 500_00);
  });

  it('applies WITHDRAWAL_SETTLED (honest FundingSnapshot shape debits balance)', () => {
    const next = accountReducer(INITIAL_ACCOUNT_STATE, {
      eventId: 'e2', eventType: 'WITHDRAWAL_SETTLED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: {
        sk: 'WITHDRAWAL_SETTLED', direction: 'WITHDRAWAL', status: 'settled',
        transferId: 'w1', amountCents: 200_00, currency: 'USD', executionMode: 'simulation',
        initiatedAt: '2026-03-12T00:00:00Z', settledAt: '2026-03-12T00:00:00Z',
        timestamp: '2026-03-12T00:00:00Z',
      },
    });
    expect(next.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents - 200_00);
  });

  it('DEPOSIT_SETTLED with no settledAt falls back to timestamp (still credits)', () => {
    const next = accountReducer(INITIAL_ACCOUNT_STATE, {
      eventId: 'e1c', eventType: 'DEPOSIT_SETTLED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: {
        sk: 'DEPOSIT_SETTLED', direction: 'DEPOSIT', status: 'settled',
        transferId: 'd2', amountCents: 300_00, currency: 'USD', executionMode: 'simulation',
        initiatedAt: '2026-03-12T00:00:00Z', timestamp: '2026-03-12T00:00:00Z',
      },
    });
    expect(next.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents + 300_00);
  });
```

- [ ] **Step 2: Run the reducer unit suite to verify it fails (red)**

Run: `pnpm nx test ledger-ctrl -- --testPathPatterns account.reducer.test`
Expected: the three funding tests FAIL — current reducer reads `p['depositId']`/`p['withdrawalId']`
(absent on the honest shape) → `applyCommand` returns `{ ok: false }` → balance unchanged → assertions
`toBe(initial ± amount)` fail. (Non-funding tests still pass.)

- [ ] **Step 3: Implement the typed funding mapping**

In `services/ledger/ledger-ctrl/src/domain/account.reducer.ts`, add the import and replace the
DEPOSIT_SETTLED / WITHDRAWAL_SETTLED branches (lines 15-30). Leave ORDER_*, CORPORATE_ACTION, and
default branches untouched.

Add to the import block at the top:
```ts
import { FundingSnapshotSchema } from '@nestfolio/execution-adpt/domain';
```

Replace the two funding cases:
```ts
    case 'DEPOSIT_SETTLED': {
      const funding = FundingSnapshotSchema.parse(p);
      const result = applyCommand(RecordDeposit, {
        depositId: funding.transferId,
        amountCents: funding.amountCents,
        depositedAt: funding.settledAt ?? funding.timestamp,
      }, state);
      return result.ok ? result.value.nextState : state;
    }
    case 'WITHDRAWAL_SETTLED': {
      const funding = FundingSnapshotSchema.parse(p);
      const result = applyCommand(RecordWithdrawal, {
        withdrawalId: funding.transferId,
        amountCents: funding.amountCents,
        withdrawnAt: funding.settledAt ?? funding.timestamp,
      }, state);
      return result.ok ? result.value.nextState : state;
    }
```

- [ ] **Step 4: Run the reducer unit suite to verify it passes (green)**

Run: `pnpm nx test ledger-ctrl -- --testPathPatterns account.reducer.test`
Expected: all tests PASS, including the three funding tests.

- [ ] **Step 5: Run the full ledger-ctrl unit + lint to confirm no collateral breakage**

Run: `pnpm nx run-many -t test,lint -p ledger-ctrl`
Expected: PASS. (Confirms `record-deposit.test.ts` / `record-withdrawal.test.ts` — command contracts
unchanged — and the handler/snapshot tests are unaffected.)

- [ ] **Step 6: Commit**

```bash
git add services/ledger/ledger-ctrl/src/domain/account.reducer.ts \
        services/ledger/ledger-ctrl/test/unit/domain/account.reducer.test.ts
git commit --no-verify -m "fix(ledger-ctrl): credit balance on funding settlement via typed transferId

Read transferId (typed via FundingSnapshotSchema) instead of the absent
depositId/withdrawalId in the DEPOSIT_SETTLED/WITHDRAWAL_SETTLED reducer
branches, so deposits/withdrawals update the ledger-authoritative cash
balance and emit BALANCE_UPDATED. settledAt falls back to timestamp.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1   # verify the commit landed
```

---

### Task 2: Deploy + integration/e2e validation gate

This is the `/backlog-next` closing phase (Steps 6.2–6.4) for this workstream. It produces no code; it
proves the fixed path against the deployed dev sandbox using the already-honest integration CDC-chain
tests that are RED by design until Task 1 ships.

**Files:** none (validation only).

- [ ] **Step 1: Affected unit + lint gate**

Run:
```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
[ -n "$AFFECTED" ] && pnpm nx run-many -t test,lint -p "$AFFECTED" || echo "no affected projects"
```
Expected: PASS.

- [ ] **Step 2: Deploy ledger-ctrl to dev sandbox**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=ledger-ctrl`
Expected: deploy succeeds (reducer Lambda + handler bundles updated).

- [ ] **Step 3: Run ledger-ctrl integration — the authoritative gate**

Run: `pnpm nx run-many -t test-integration -p ledger-ctrl`
Expected: PASS, including `DEPOSIT_SETTLED → BALANCE_UPDATED` and `WITHDRAWAL_SETTLED → BALANCE_UPDATED`
(`test/integration/ledger-ctrl.integration.test.ts`) — these inject honest `transferId` fixtures and were
RED before Task 1.

- [ ] **Step 4: Involved e2e (only if a scenario covers funding settlement → balance)**

Identify any `apps/e2e-feature-tests` scenario that drives a deposit/withdrawal settlement and asserts the
dashboard cash balance. If one exists, run only that scenario (never the full suite, never Playwright):
```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev \
  pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPatterns <scenario>
```
If none exists, record that the integration CDC-chain tests (Step 3) are the direct authoritative
assertion of the fixed path, and note the gap (do not invent an e2e here). If a scenario fails then
passes on rerun, pull CloudWatch evidence from the failing window and run a confirmation pass before
proceeding (flake = real failure).

---

## Self-Review

**1. Spec coverage:**
- Reducer typed `transferId` mapping (both branches) → Task 1 Step 3. ✓
- `settledAt ?? timestamp` fallback → Task 1 Step 3 + regression test Step 1. ✓
- `.parse` not `.safeParse` → Task 1 Step 3 (Global Constraints). ✓
- Command schemas unchanged → not modified; asserted via Task 1 Step 5 (`record-deposit/withdrawal` tests pass untouched). ✓
- Correct co-wrong unit fixtures → Task 1 Step 1. ✓
- Integration `→ BALANCE_UPDATED` green after deploy → Task 2 Step 3. ✓
- Validation gate (unit/lint → deploy → integration → e2e) → Task 2. ✓

**2. Placeholder scan:** No TBD/TODO; all code shown verbatim; the only conditional is Task 2 Step 4's
"if a scenario exists", which has an explicit both-branch instruction. ✓

**3. Type consistency:** `funding.transferId` / `funding.amountCents` / `funding.settledAt` /
`funding.timestamp` match `FundingSnapshotSchema` (`execution-adpt/domain/contracts.ts:17`). Command
inputs `{ depositId, amountCents, depositedAt }` / `{ withdrawalId, amountCents, withdrawnAt }` match
`RecordDepositSchema` / `RecordWithdrawalSchema`. ✓
