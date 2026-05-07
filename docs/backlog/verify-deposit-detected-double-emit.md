---
id: verify-deposit-detected-double-emit
status: queued
rank: 4
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "10 min check whether the upstream is dup-emitting DEPOSIT_DETECTED."
---

# Verify whether `DEPOSIT_DETECTED` is double-emitted upstream

Diagnostic 2026-05-03 (tenant `e2e-1777762060562`) showed 2 distinct `DEPOSIT_DETECTED` events in 15s with different `depositId`s (`0ee4082f…` EUR 500 and `76b39b5f…` USD 5000). Could be intentional e2e (two test deposits) OR a real upstream double-emit (broker-sim/investor-bff fan-out). To verify: cross-check `apps/nestfolio-e2e/` test step that initiates deposit — does it call `initiateDeposit` once or twice? If once, the upstream is dup-emitting and is a real bug worth promoting. If twice, by-design and drop. ~10 min check.
