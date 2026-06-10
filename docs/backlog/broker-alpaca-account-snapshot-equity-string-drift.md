---
id: broker-alpaca-account-snapshot-equity-string-drift
status: parking
type: bug
notes: "broker-alpaca AlpacaAccountSnapshot stores equity/buyingPower as RAW Alpaca API strings (event-listener processAccountCheck writes `account.data.equity`/`buying_point` verbatim), NOT Number()-converted like positions (which use Number(p.qty)). The typed-subject-contracts-execution slice corrected the contract to z.string().nullable() to match reality — but the asymmetry (positions numeric, equity/buyingPower string) is a latent producer inconsistency. Promote when touching broker-alpaca account-snapshot or when a consumer needs numeric equity/buyingPower."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# broker-alpaca AlpacaAccountSnapshot equity/buyingPower string drift

Surfaced 2026-06-10 during `typed-subject-contracts-execution` (slice 3) — typing the
`processAccountCheck` emission against the new `AlpacaAccountSnapshotSchema` revealed the
mismatch (the textbook [[event-subject-contracts]] trap: the old `z.number()` schema was
co-wrong with a fixture and never validated).

## What

`services/execution/broker-alpaca-adpt/src/handlers/event-listener.ts` `processAccountCheck`
writes the `AlpacaAccountSnapshot` row with:
- `equity: account.data.equity` — a **string** (`AlpacaAccountApiResponse.equity: string`, raw Alpaca API)
- `buyingPower: account.data.buying_power` — a **string**
- `positions: (positions.data ?? []).map(p => ({ ..., qty: Number(p.qty), marketValue: Number(p.market_value) }))` — **Number()-converted**

So positions are numeric but equity/buyingPower are raw strings. The slice corrected the
contract (`equity`/`buyingPower` → `z.string().nullable()`) to match the REAL stored row,
and the e2e gate confirmed it against the real Alpaca paper account.

## Impact

Latent / low — reconciliation-ctrl (the cross-domain consumer of `ALPACA_ACCOUNT_SNAPSHOT`)
compares `positions` (numeric), not equity/buyingPower today. No crash, no current consumer
breakage. The inconsistency would bite a future consumer that reads equity/buyingPower
expecting a number.

## Fix direction

Convert in the producer: `equity: Number(account.data.equity)`, `buyingPower: Number(account.data.buying_power)`
(consistent with positions), then tighten the contract back to `z.number().nullable()`. This
is a runtime emission change (out of scope for the type-only contracts slice) — needs the
e2e gate to re-validate against the real Alpaca emission.

See [[project_event_subject_contracts]].
