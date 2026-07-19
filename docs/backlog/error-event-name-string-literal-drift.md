---
id: error-event-name-string-literal-drift
status: parking
type: epic
notes: "Error/fail event names hand-typed as raw string literals instead of the typed <SERVICE>_FAILED convention constant, drifting silently. Theme epic, 2 members."
done_when: "Each in-scope error-event emission uses its service's typed <SERVICE>_FAILED constant instead of a raw string literal; both members shipped or dropped."
scope: "An error/failure event name emitted as a hand-typed raw string literal (or a copy-pasted wrong constant) instead of the service's own typed <SERVICE>_FAILED convention constant, so a rename of the convention constant would not update the emission site."
out_of_scope:
  - "Dead/unwired event-name declarations (event-name-integrity) — these emissions fire correctly at runtime; only the source-of-truth for the string is wrong"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Error-event-name string-literal drift

Root cause: the repo convention is that every service's error/failure event uses a typed `<SERVICE>_FAILED` constant, but two sites bypass it — `broker-sim-adpt`'s `event-listener.ts` uses the copy-pasted wrong constant `EXECUTION_ADPT_FAILED` (residue from the same copy-paste origin as the dead `ExecutionAdptEventTypes` block filed under `event-name-integrity`), and `ledger-ctrl`'s `snapshot-publisher.ts` uses a bare string literal `'LEDGER_SNAPSHOT_PUBLISHER_FAILED'` instead of importing a typed constant like its sibling `LEDGER_PROCESSING_FAILED`. Both emit the "right" event at runtime today, but neither is refactor-safe — a future rename of the convention constant silently leaves the literal stale. Fix pattern: replace each raw/wrong literal with the correct typed constant (adding one for ledger-ctrl if it doesn't yet exist).

Members (derived from `epic:` pointers):
- `broker-sim-adpt-error-event-type-naming-drift`
- `ledger-snapshot-publisher-failed-raw-string-literal`
