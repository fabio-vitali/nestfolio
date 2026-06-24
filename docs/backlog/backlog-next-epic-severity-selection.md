---
id: backlog-next-epic-severity-selection
status: active
type: tooling
notes: "/backlog-next-epic ranks its candidate list by impact (default) or free-text --like criterion, computed AT SELECTION TIME (no stored severity field), surfaced ranked-with-reasons for human confirm."
references:
  - "docs/superpowers/specs/2026-06-24-backlog-next-epic-severity-selection-design.md"
out_of_scope:
  - "Any PERSISTED severity/urgency frontmatter field, and any lint/index/run-state-schema change."
  - "The /backlog-recalibrate sweep skill (only needed to fight drift of a stored field — moot here)."
  - "The /backlog-next single-item mirror of --like / severity-ranking (epic-level only for now)."
  - "Auto-launching an epic from a computed ordering without human confirmation (E5 floor forbids it)."
  - "Changing existing backlog behaviour beyond candidate ordering + the new arg forms, or any of the 11 lint invariants."
  - "The separate backlog-skills-simplification epic (β + γ) — already filed, unrelated."
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# `/backlog-next-epic` severity-aware selection

Let `/backlog-next-epic` pick the next epic by **impact** (default) or a **free-text criterion**
(`--like "..."`), instead of only by fixed lifecycle order. The ranking is **computed at selection
time** against a shared read-time `severity-rubric.md` — **persisted nowhere** — and is always
surfaced ranked-with-reasons via `AskUserQuestion` for the user to confirm (even under `--auto`, per
the E5 floor). `rank` stays authoritative: an `active` epic resumes, `queued` epics keep their
`rank`, and severity orders only the otherwise-unordered `parking` theme-epic tail.

**Why no stored field** (the decisive call): a persisted `severity` is an *assessment of code reality*
that drifts and that no routine re-derives — the one category the backlog's "store-pointers,
derive-everything-else" architecture avoids — and it would add "High" complexity across 5–6 skills on
a suite already carrying 19 hard-won F-fixes. Computing at selection time dissolves both the drift and
complexity worries. Full rationale + rejected alternatives in the design doc.

**Design:** `docs/superpowers/specs/2026-06-24-backlog-next-epic-severity-selection-design.md`

**Shape of the work (small):** a `--candidates` gather mode on `epic-members.mjs` (+ `node --test`),
a shared `severity-rubric.md` under `backlog-lint/lib/`, arg-parsing + the rank→confirm step + the E5
floor update in `backlog-next-epic/SKILL.md`.
