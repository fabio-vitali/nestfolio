---
id: decision-log-utc-date-stamp
status: queued
rank: 4
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

**Blocker (discovered 2026-07-19):** `decision-log.mjs` and its test are among the 19 SHA-256-pinned
assets in the Continuity Level-1 locked pack (`continuity/level-1/pack-lock.json`) — read-only under
the SD-001 standing rules. A session attempted this fix directly on the locked file; `continuity:verify`
correctly flagged `ASSET_DIGEST_MISMATCH` and the change was reverted (commits `81400ec0`/`57cd130b`).
Do not re-attempt this fix by editing the locked file directly — it requires either an explicit pack-lock
version bump (an owner-authorized Packs/bindings change, out of scope for a standalone `/backlog-next`
workstream) or an alternative fix location outside the locked asset set. Flag to the owner before retrying.
