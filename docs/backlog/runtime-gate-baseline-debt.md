---
id: runtime-gate-baseline-debt
status: parking
type: epic
notes: "Theme epic (minted 2026-07-10 by backlog-themes from runtime-operationalization-leftovers). Root cause: item-gates run global invariants whole-scope, so pre-existing tree debt blocks every item's start gate. The interim blunt per-file exclusion ratchet holds 94 real service-violation paths; proper diff-aware gate semantics should subsume the ratchet and the debt it hides gets remediated. 2 core members."
done_when: "Both members resolved or dropped: the runtime item-gate attributes debt diff-aware ('the item made nothing worse') so pre-existing tree debt no longer blocks item starts, the blunt per-file exclusion ratchet is retired, and the real service violations it currently suppresses are remediated per their existing feedback_* dossiers. All members shipped or dropped."
scope: "The interim baseline-exclusion ratchet installed for the first live item-gate fire, and the debt it holds: (a) runtime-gate-baseline-semantics — design/implement baseline-relative (diff-aware) item gates that narrow attribution not selection (findings vs merge-base delta / per-line baselines), subsuming and then retiring the ratchet; (b) gate-surfaced-source-debt — remediate the pre-existing content-ring violations the ratchet suppresses (no-ddb-scan ×4, no-ddb-seed-in-integration ×11, no-states-runtime-catch ×1) per the existing feedback_* dossiers (GSI query + BatchGet; Choice-on-isPresent; fixtures via events/mutations)."
out_of_scope:
  - "The runtime's own internal-quality debt (runtime-self-hosting-debt) — self-hosting the engine, not gate attribution semantics."
  - "The commit-trigger diff-scoping already shipped in runtime-make-it-fire — this theme is the item-gate trigger, which never got the same treatment."
references:
  - docs/superpowers/specs/2026-07-03-runtime-gate-diff-scoping-design.md
  - docs/superpowers/specs/2026-07-03-runtime-seam-probe-design.md
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Runtime gate-baseline debt (blunt ratchet + the source debt it hides)

Minted by `/backlog-themes` (2026-07-10) from the `runtime-operationalization-leftovers` bucket. Two
findings are tightly coupled by one root cause: **item-gates run global invariants whole-scope, so no
item can start while any known debt exists anywhere.** The interim fix — a per-file exclusion ratchet —
is blunt (a listed file is exempt from that check entirely, even for new violations) and holds 94 real
service-violation paths. The proper diff-aware gate design supersedes the ratchet; the debt it hides is
genuine and gets remediated.

**Members (2, core):**

- `runtime-gate-baseline-semantics` (design) — baseline-relative item gates that assert *the item made
  nothing worse* (findings vs merge-base delta, or per-line baselines) while whole-tree cleanliness
  stays the watch engine's audit job. Mirrors the frozen diff-scoping principle: narrow **attribution**,
  never **selection**. Should subsume and then retire the exclusion ratchet.
- `gate-surfaced-source-debt` (bug) — the real, pre-existing content-ring violations the ratchet
  suppresses, surfaced when the runtime gate first fired: `no-ddb-scan` (4: FilterExpression on GSI key
  attrs), `no-ddb-seed-in-integration` (11: DdbSeedFixture / direct PutItem), `no-states-runtime-catch`
  (1: uncatchable SF Catch). Remediate each per its existing `feedback_*` dossier.

**Disposition:** durable root-cause bucket (`status: parking`). Promote to a delivery epic when the
item-gate baseline semantics are the active workstream; ships when both members are terminal.
