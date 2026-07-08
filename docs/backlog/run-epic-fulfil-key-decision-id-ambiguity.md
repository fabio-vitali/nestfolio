---
id: run-epic-fulfil-key-decision-id-ambiguity
status: shipped
closed: 2026-07-08
type: bug
epic: runtime-operationalization
epic_role: core
notes: "run-epic --fulfil advances only on the STEP key (member.<id>) but pending prints decision execute:<id> too — fulfil-by-decision-id journals an orphan step and thrashes; SKILL wording ambiguous."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: "commit 1bb966c9 on main (resolveFulfilKey + wiring + SKILL wording + tests); node --test runtime suites 337/337 + backlog-skill suites 133/133 + pnpm nx run-many -t test,lint -p runtime,tools 397/397 all green; RE5 proves a decision-id fulfil (execute:m1) advances the member parked under member.m1 with no orphan step; detect-deploy exit 10 (Tier 0, nothing to deploy); ship-recheck clean (ship:run-epic-fulfil-key-decision-id-ambiguity:gate-clean journaled); driven end-to-end on the runtime engine (run-next.mjs exit 3→3→0, path:runtime provenance recorded — soak-gate evidence); ship floor + mint consideration (--none) user-approved via AskUserQuestion"
---

# run-epic.mjs production fulfil-key ambiguity (step key vs decision id)

The epic spine parks members under journal step key `member.<id>` with decision id `execute:<id>`
(`runtime/engine/loop/orchestrator.mjs:24` vs the worker's coinciding keys at
`runtime/engine/loop/worker.mjs:29`). `run-epic.mjs --fulfil <key>` only advances when given the
STEP key — `journal.fulfil` appends by key and `journal.step` replays only its own key
(`runtime/engine/lib/journal.mjs:49,65`). But the pending record prints both, and the
`backlog-next-epic` SKILL-style wording says "fulfil the printed decision key" — a real session
fulfilling by decision id (`execute:m1`) journals an orphan step and thrashes. This is exactly the
trap the oracle operator hit (fixed for the ORACLE in `parity-oracle-bne-live-red-fixes` via the
`OPERATOR_PROMPT` rewording); the production adapter + SKILL wording remain exposed.

**Fix candidates:** (a) `run-epic.mjs` (and `run-next.mjs` for symmetry) accept a fulfil key that
matches a pending step's `decision.id` and translate it to that step's key — adapter-ring
robustness, engine untouched; (b) one-line SKILL wording fix ("the pending key, exactly as
printed"). Discovered 2026-07-08 while fixing the two red bne parity pairs.

## Ship note (2026-07-08)

Shipped BOTH candidates plus the stale-comment fix, in commit `1bb966c9` on `main` (Simple lane):
`runtime/adapters/claude-code/fulfil-key.mjs` (`resolveFulfilKey(ledger, key)` — exact pending
step-key match wins; a UNIQUE pending `decision.id` match translates to that step's key; an
ambiguous match throws; no match passes through for pre-seeded choices) wired into both
`run-epic.mjs` and `run-next.mjs`; the trap wording fixed in `backlog-next` SKILL §5a ("fulfil the
printed decision key" → the pending KEY, exactly as printed) and `backlog-next-epic` SKILL (member
"PARKS on `execute:<member-id>`" → parks under step key `member.<member-id>` carrying that decision
id); `execute.mjs` header corrected (decision id is the WORKER spine's step key by construction, not
the epic spine's). Tests: `fulfil-key.test.mjs` FK1–FK7 + `run-epic.test.mjs` RE5 (decision-id
fulfil advances the member, no orphan step). The workstream itself was driven end-to-end on the
runtime engine (first post-replatform live workstream — soak-gate evidence).

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-08
- **Decision:** Named /backlog-next target run-epic-fulfil-key-decision-id-ambiguity was status: parking (member of parking theme epic runtime-operationalization; no trigger language). Promote and work now, or stop?
- **Options:** Promote to queued (rank 4) and work it now | Stop, leave it parking
- **Chosen:** Promote to queued (rank 4) and work it now
- **Rationale:** User-resolved via AskUserQuestion (parking refusal is a floor stop in --auto, never silently promoted). No unmet trigger language blocks it; theme-epic members drain as standalone PRs; working it via the runtime engine counts toward the soak-gate >=5-workstream clause.
- **Rejected:** Stop, leave it parking — user explicitly named the item; a dead-stop forcing a hand-edit + re-run adds friction without protecting any invariant.

### D2 — 2026-07-08
- **Decision:** Drive this workstream via the runtime engine (RUNTIME_ENGINE=1 run-next.mjs, SKILL 5a) or the legacy prose body?
- **Options:** Runtime engine drive (run-next.mjs) | Legacy SKILL body
- **Chosen:** Runtime engine drive (run-next.mjs)
- **Rationale:** The strangler direction the project already committed to (WS-3); accrues a path:runtime provenance record toward the soak-gate >=5-workstream clause (the epic 1s last open clause) and dogfoods the very fulfil seam this item fixes. Reversible — legacy fallback stays intact.
- **Rejected:** Legacy body — forfeits soak evidence for no benefit; flag-off path remains available if the drive fails (journaled as fallback).

### D3 — 2026-07-08
- **Decision:** Fix approach for the fulfil-key ambiguity: adapter-ring key translation, SKILL wording fix, or both?
- **Options:** (a) adapter translation only | (b) SKILL wording only | Both (a)+(b) + stale execute.mjs comment
- **Chosen:** Both (a)+(b) + stale execute.mjs comment
- **Rationale:** Blast-radius gate exit 0 on driveEpic/driveNext. The adapter-ring resolveFulfilKey helper is the reusable mechanism (any operator/driver advances regardless of which printed id it quotes; engine ring-1 untouched, per the item body candidate (a)); the SKILL wording fix removes the ambiguity at its source (mirrors the oracle OPERATOR_PROMPT prior art); the execute.mjs comment claiming the decision id is the spine step key by construction is false for the epic spine and gets corrected.
- **Rejected:** Single-sided fixes — (a) alone leaves the misleading instruction text; (b) alone leaves the production adapter brittle against the exact trap a real session already hit.

### D4 — 2026-07-08
- **Decision:** Ship floor: ship item run-epic-fulfil-key-decision-id-ambiguity?
- **Options:** Ship | Hold
- **Chosen:** Ship
- **Rationale:** User-approved via AskUserQuestion at the runtime ship floor (never auto-resolved). All gates green: runtime 337 + skills 133 + nx runtime,tools 397 tests pass; Tier-0 no-deploy; ship-recheck gate-clean.
- **Rejected:** Hold — no open findings or risk warranted deferral.

### D5 — 2026-07-08
- **Decision:** Mint consideration (6.4b): mechanizable recurring lesson from this ship?
- **Options:** Nothing mechanizable (--none) | Mint a check
- **Chosen:** Nothing mechanizable (--none)
- **Rationale:** User-confirmed via AskUserQuestion: the lesson was mechanized directly into the adapter (resolveFulfilKey + FK/RE5 regression tests) and the wording trap removed at source — no recurring check surface remains. consider --none recorded (key consider:run-epic-fulfil-key-decision-id-ambiguity, sha 1bb966c9).
- **Rejected:** Minting a check — would duplicate what the code fix + tests already enforce mechanically.
