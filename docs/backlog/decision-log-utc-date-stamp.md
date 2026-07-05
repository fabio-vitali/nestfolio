---
id: decision-log-utc-date-stamp
status: parking
type: bug
notes: "decision-log.mjs stamps the UTC date — evening-CET appends land under yesterday's date in an append-only audit log"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# decision-log.mjs stamps UTC dates in Decision-log headings

Evidence: `runtime-redteam-hardening` D1–D4 are headed `### D1 — 2026-07-04` though the session ran
2026-07-05 local (CET) — the appends happened before 00:00 UTC, so `decision-log.mjs` (backlog-next)
stamped the previous day. D5, appended mid-day, stamps correctly.

Cosmetic but misleading in an append-only audit section (F-6: entries are never edited, so the wrong
date is permanent). Cheapest fix: stamp the full ISO timestamp (or the local date) instead of the
UTC calendar date in the `### Dn — <date>` heading.
