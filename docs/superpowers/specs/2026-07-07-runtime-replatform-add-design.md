# WS-1 — Re-platform `backlog-add` onto `intake.mjs`

- **Date:** 2026-07-07
- **Status:** design (WS-1 slice of the work-driver re-platform; implementation lands on this branch)
- **Backlog item:** `runtime-replatform-add` (core member of epic `runtime-operationalization`, drained standalone per D1)
- **Parent strategy spec:** `docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md` §8 (WS-1), §7 Hole #1, §14
- **Depends on (SHIPPED):** `runtime-replatform-prereqs` (Hole #1 `Finding.check` optional + `AGENT_OBSERVED`; `RUNTIME_ENGINE` flag + path-provenance; parity-oracle extension)

---

## 1. Context & the gap

The epic-aware router is already ported to `runtime/engine/lib/intake.mjs`: `shapeItems` is a pure
deterministic core over the six routes (`fold`/`join-theme`/`mint-aggregation`/`orphan`/`split`/`discard`),
and `selectRoute` is the judgment seam (`capabilities.execute`, route-as-JSON-in-`summary`). What the
runtime path does **not** yet do is the **procedural context-loading** the legacy `backlog-add` skill runs
before it classifies (`.claude/skills/backlog-add/SKILL.md:26-42`):

- grep the **active epic** (`status: active` + `type: epic`) and read its `done_when:` / `scope:` / `out_of_scope:`;
- run the **closure-predicate test** — a finding is `core` if leaving it undone would falsify a `done_when:`
  clause, else `captured` (default `core` when load-bearing is uncertain);
- consult the **parking theme epics** (for `join-theme` root-cause match) and **parking orphans**
  (for the `mint-aggregation` suggestion).

Today `selectRoute` (`intake.mjs:36`) hands the judge only `finding.detail`. Without the active epic's
`done_when:`, the judge cannot reliably distinguish `fold` core from captured — so the mapped parity
scenarios `rt-add-fold-core` / `rt-add-fold-captured` / `rt-add-commit-scope` are not dependably dominant.

## 2. Decision — deterministic context-loader → judgment seam

**Chosen:** a pure, project-agnostic loader computes the decision context deterministically; the judge still
makes the route + `epicRole` verdict on that pre-computed context.

- **Rejected — trust the judge** (hand it the whole backlog + a stronger prompt, let it grep): non-deterministic,
  unreproducible, nothing unit-testable, and the fold-core/captured scenarios become flake-prone.
- **Rejected — deterministic route** (compute route + core/captured mechanically, judge only the fuzzy cases):
  fossilizes a genuinely-semantic judgment (`CLAUDE.md` frames core-vs-captured as a judgment call) into brittle
  keyword matching → misclassifications; least faithful to the legacy skill.

**Rationale:** reusability breaks the tie (`CLAUDE.md` primary objective). "Load context deterministically,
judge decides" lifts cleanly to the audit intake and any future judgment surface, and it matches the runtime's
existing pure-core + seamed-judgment split. Context extraction becomes a pure unit-testable function; the judge
keeps the one call that is genuinely semantic.

## 3. Components

### 3.1 `loadIntakeContext` + `renderIntakePrompt` — new pure ring-1 module `runtime/engine/lib/intake-context.mjs`
```
loadIntakeContext({ backlog }) ->
  { activeEpic: { id, done_when, scope, out_of_scope } | null,   // status: active + type: epic
    themeEpics: [ { id, notes, scope, done_when } ],             // status: parking + type: epic
    orphans:    [ { id, notes } ] }                               // status: parking, non-epic, no epic: pointer
renderIntakePrompt({ finding, context }) -> string               // the route-classification prompt, context embedded
```
Pure — no LLM, no I/O; filters the already-threaded `backlog` array (`readItems()` output, threaded at
`run-intake.mjs:45`). `readItems` exposes **frontmatter only**, so the root-cause signal for theme epics / orphans
is their `notes:` field. Unit-tested independently. `activeEpic.done_when` is the material for the closure-predicate;
`themeEpics`/`orphans` feed join-theme / mint-aggregation. `null` active epic ⇒ fold is unavailable (matches the
legacy skill, whose fold branch only fires with an active epic). `renderIntakePrompt` embeds the context so the
judge runs the closure-predicate and root-cause matching without grepping the repo.

### 3.2 `selectRoute` enrichment (`intake.mjs:34-41`)
Build the context via `loadIntakeContext`, embed a **structured summary** in the judge prompt (active-epic id +
`done_when:` clauses + `scope:`; theme epics; orphans) and carry it in `task.payload`. The judge returns the same
`{route, epic?, epicRole?, splitInto?, rationale}` JSON-in-`summary`; `shapeItems` is untouched. The prompt is
extended to instruct the closure-predicate explicitly (core vs captured against the supplied `done_when:` clauses).

### 3.3 lint `--fix` index-regen side-car (`run-intake.mjs`, once after the `writeItemFile` loop ~:51)
After all items are written, shell out `node .claude/skills/backlog-lint/lint.mjs --fix` — the same command the
legacy skill runs (`backlog-add/SKILL.md:65`) — to regenerate `docs/BACKLOG.md` (`renderIndex`) and dossier
`related_workstreams:` (`syncDossiers`). Runs **once**, not per item. A non-zero exit surfaces as a run failure
(journaled, non-zero CLI exit) — never silently swallowed. This is doc-store materialization, which the migration
deliberately keeps as a skill/adapter side-car (strategy spec §2), so it lives in the adapter, not ring-1.

### 3.4 `RUNTIME_ENGINE` flag toggle (`.claude/skills/backlog-add/SKILL.md` entry)
Add a branch at skill entry: flag on (`usesRuntimeEngine(process.env)`, `path-provenance.mjs:13`) → invoke
`run-intake.mjs --finding <path>`; flag off → the legacy prose body, kept **byte-for-byte** (no-cleanup-during-migration;
legacy deletion is P6, user-triggered). `path:runtime` provenance already fires unconditionally on the runtime path
(`run-intake.mjs:34`), which is correct because the CLI only runs when the flag is on. A deliberate legacy fallback
is a human act that journals `path:legacy-fallback` (mechanism shipped in prereqs; not exercised here).

## 4. Tests & parity acceptance

- **Unit:** `loadIntakeContext` (pure — active-epic selection, done_when/scope extraction, theme/orphan
  partitioning, null-active-epic) and the enriched `selectRoute` (via `fakeCaps`, asserting the context reaches the
  prompt/payload). Harness: `node --test` under the `runtime` nx project.
- **Parity:** the **7 already-mapped `rt-add-*` scenarios** (`fold-core`, `fold-captured`, `join-theme`,
  `mint-aggregation`, `orphan`, `commit-scope`, `atomicity-split`) must be **dominant** in the live oracle sweep
  (`scripts/parity-oracle/run.mjs`, cost-gated — run at ship per strategy spec §6), each gated on a real
  `path:runtime` record (`runtime-grade.mjs:21`). No new scenarios are mapped by WS-1.

## 5. Out of scope

- The flag / soak-observer / parity-hole mechanism — `runtime-replatform-prereqs` (shipped).
- Deleting the legacy `backlog-add` body — P6, user-triggered.
- The **2 write-layer P5 scenarios** `add-id-collision-suffix` and `add-notes-scalar` — they stay
  `unmapped:'P5'` per the strategy-spec mapping (filename/notes prose the engine deliberately does not replicate
  in this slice). If the `writeItemFile` id-collision overwrite is judged a real defect, it is filed as a separate
  homogeneous item, not folded here.

## 6. Success criteria

1. `RUNTIME_ENGINE=1` routes a real `backlog-add` finding through `run-intake.mjs`, which classifies with the
   deterministic context, writes the item file(s), regenerates `docs/BACKLOG.md` via the side-car, and journals
   `path:runtime` + `intake:<id>:filed`.
2. Unit tests for `loadIntakeContext` and the enriched `selectRoute` pass.
3. The 7 mapped `rt-add-*` parity scenarios are dominant in a live oracle sweep.
4. The legacy prose body remains intact behind the flag-off branch.
