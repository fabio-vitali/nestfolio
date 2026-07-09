---
id: runtime-legacy-retirement
status: active
type: tooling
notes: "P6: legacy work-driver retirement — delete flag-off prose bodies, strangler seams, RUNTIME_ENGINE flag. Pre-removal gate: FINAL full parity-oracle sweep (user decision 2026-07-09). Comparator retires; deterministic differential survives as runtime-only regression suite. Filed as core + done_when clause (7) per user decision 2026-07-08; trigger fired 2026-07-09."
references: []
out_of_scope:
  - "Re-designing ring-1 engine contracts (schemas/helpers) — frozen by runtime-realization; deltas re-freeze into SPEC 1, not here."
  - "Net-new checks beyond the retirement itself — new lessons flow through the backward edge / backlog-add."
  - "Runtime engine behavior changes beyond collapsing the strangler seams — the loop/gates/floors stay as-shipped."
  - "Epic closure (captured audit + ship of runtime-operationalization) — a separate act after this member ships."
  - "The epic's captured members (e.g. from-intake-join-theme-cannot-express-epic-role) — audited at epic close, not resolved here."
  - "The gh-PR-state probe / worktree-ops binding deferred within WS-4 (spec §10) — stays deferred."
spec: docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md
plan: docs/superpowers/plans/2026-07-09-runtime-legacy-retirement.md
topic_memory: [project_runtime_realization.md]
validation_gate: null
epic: runtime-operationalization
epic_role: core
---

# P6 — legacy work-driver retirement (user-triggered)

The final act of the strangler migration ([strategy spec](../superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md)
§10/§12: "legacy-path deletion is a separate, user-triggered act, never bundled" with the soak gate).
The soak gate closed 2026-07-08 (`runtime-replatform-soak-gate`: 6 fallback-free runtime workstreams,
0 fallbacks, oracle green) — retirement is unblocked. User-directed filing at that ship boundary, as a
**core** member with the epic's `done_when` amended (clause 7) so epic closure literally means the
migration is complete.

**Retirement checklist (the scope):**

- **Legacy prose bodies kept "until P6"** — delete the flag-off legacy bodies: `backlog-next`
  SKILL.md §5a's legacy closing-phase prose, `backlog-next-epic` E4's legacy body, `backlog-add`'s
  prose router ("retained byte-for-byte until P6"), `backlog-lint`'s legacy invocation path. The
  runtime drive subsections become the only body.
- **Strangler seams collapse to runtime-only** — `backlog-gate.mjs`, `next-driver.mjs`,
  `epic-driver.mjs` lose their flag branch; `usesRuntimeEngine` / `RUNTIME_ENGINE` flag removed;
  `path-provenance.mjs` fallback instrumentation (`FALLBACK_RUN_ID`, `PATH_LEGACY_FALLBACK`) retired
  with it (decide: keep `path:runtime` journaling as plain provenance, or drop).
- **verify-structure.sh #1–10** — retire in favor of `scripts/check-service-structure.sh` + the
  runtime gate; reinstall the refactored pre-commit hook (the post-merge reinstall deferred by
  `runtime-check-migration-completion`'s hook footgun).
- **Parity-oracle / bef disposition** — the legacy comparator disappears with the legacy skills;
  decide what survives: archive the oracle (its go/no-go job is done), keep the deterministic
  differential as a runtime-only regression suite, or retire `scripts/benchmark-backlog/` wholesale.
  `soak-observer.mjs`'s purpose also ends here.
- **Doc layer** — CLAUDE.md skill-routing table, `docs/superpowers` references, dossier update.
  **`runtime/GUIDE.md` + `runtime/README.md` are first-class deliverables** (explicit user
  requirement 2026-07-09): both must describe the post-retirement runtime-only world — no
  strangler/flag/legacy-fallback language left.

**Pre-removal gate (user requirement 2026-07-09 — "all must be BETTER than legacy before
removal"):** before ANY deletion, run the FINAL full parity-oracle sweep (all 17 mapped pairs,
legacy vs runtime, headless Opus + judge) — the last run ever possible, since the oracle needs the
legacy bodies alive; the last green sweep (2026-07-08) predates the `8dafc83c` driver-main changes.
Gate = fresh sweep green + live soak verdict (12 runtime workstreams / 0 fallbacks) + deterministic
differential green + capability-coverage audit mapping every legacy-body feature to its runtime
equivalent. Deletion only proceeds on a fully green gate.

**Trigger fired 2026-07-09:** the user explicitly triggered retirement (this file's parking
condition was "explicit user trigger after `runtime-operational-surface` ships" — the operator
surface shipped 2026-07-08, the soak gate closed 2026-07-08, and the user directed the run on
2026-07-09 with three requirements: prove-better-first, ALL legacy content removed, GUIDE/README
updated). Promoted parking → queued rank 4.

**Capability-coverage audit (2026-07-09, gate clause 4 — PASSED):** every capability the legacy
flag-off bodies provide is either **runtime-owned** (deploy detect + deploy-gate batch, ship floor
never-auto, backward-edge ship-recheck/curate/mint, epic member loop + sha-conditional pre-done
batch, intake routing fold/join/mint/orphan with atomicity + epicRole, all 11 lint rules via
run-watch, operator visibility via run-view/operational-surface) or **deliberately host-retained
prose that survives retirement** (§6.1 doc-derivation regen, §6.2 pre-deploy unit tests+lint,
§6.5 frontmatter write, §6.6 index regen / `lint.mjs --fix` side-car, §6.7/§6.8 finishing+cleanup,
E0–E3/E7 captured audit/E8 single PR — declared host-side in the strangler prose itself). Zero
undischarged gaps. Full inventory + matrix in the plan doc.

Topic dossier: `project_runtime_realization.md`.

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-09
- **Decision:** Pre-removal BETTER-than-legacy evidence standard
- **Options:** Full final oracle sweep + soak verdict + coverage audit | Deterministic differential + prior-sweep evidence | Soak evidence only
- **Chosen:** Full final oracle sweep + soak verdict + coverage audit
- **Rationale:** User decision via AskUserQuestion 2026-07-09. Last possible oracle run (needs legacy alive); driver mains changed since the 2026-07-08 green sweep (8dafc83c), so parity is re-proven on current code. Strangler retirement gated on full parity evidence is the reusable pattern.
- **Rejected:** Evidence-only options assert LLM-path parity from a sweep that predates the latest driver-main changes.

### D2 — 2026-07-09
- **Decision:** Legacy comparator tooling disposition
- **Options:** Retire comparator, keep deterministic differential as runtime-only regression suite | Retire wholesale | Archive directory
- **Chosen:** Retire comparator, keep deterministic differential as runtime-only regression suite
- **Rationale:** User decision via AskUserQuestion 2026-07-09. Aligns with ALL-legacy-removed while preserving a reusable regression harness: r1-r11 bad/good fixtures re-pointed to assert the runtime gate alone.
- **Rejected:** Wholesale loses live regression fixtures; archive dir contradicts the ALL-removed instruction.

### D3 — 2026-07-09
- **Decision:** path-provenance disposition
- **Options:** Keep plain path:runtime journaling, retire fallback instrumentation | Drop path-provenance entirely
- **Chosen:** Keep plain path:runtime journaling, retire fallback instrumentation
- **Rationale:** User decision via AskUserQuestion 2026-07-09. Near-zero cost, journal stays self-describing, and any future strangler migration gets its soak instrument back for free (reusable observability pattern).
- **Rejected:** Dropping saves trivial noise but forces a rebuild for the next engine-path migration.

### D4 — 2026-07-09
- **Decision:** Final pre-removal gate evidence after the self-containment fix
- **Options:** Re-run all 17 pairs on post-fix HEAD (one coherent artifact) | Accept split evidence (13 pre-fix + 4 post-fix)
- **Chosen:** Re-run all 17 pairs on post-fix HEAD
- **Rationale:** User decision via AskUserQuestion 2026-07-09. First full sweep found a real self-containment bug (audit-procedures crashed every driver main in runtime-only trees); the fix (23c32a1e) landed after 13 pairs had already run. A split artifact leaves the 13 greens on stale code plus an unresolved passing-pair/crashing-main contradiction. Re-running all 17 on HEAD produces one coherent green artifact on the exact code that exists at deletion time, matching the be-sure-ALL-better mandate and D1s fresh-full-sweep standard, before irreversible deletion.
- **Rejected:** Split evidence saves the full-sweep quota but does not meet fresh-full-sweep and leaves a reasoning gap unresolved.
