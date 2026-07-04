# Runtime backward edge live — mint and curate in anger (design)

**Workstream:** `runtime-backward-edge-live` (P2 of `runtime-operationalization`)
**Date:** 2026-07-04 · **Approach:** A — adapter drivers + journaled ritual evidence (approved)
**Predecessors:** SPEC 2 (backward edge, shipped), SPEC 3 (capability seams + git-native journal, shipped),
`runtime-make-it-fire` (live diff-scoped pre-commit gate, shipped), `runtime-seam-probe` (park/fulfil
proven as the interactive binding, shipped), `runtime-design-redteam` (the four p2 backward deltas).

## 1. Problem

The backward edge has only run in vitro (hermetic 5-lesson dogfood). Meanwhile the live pre-commit
gate's only bypass is `RUNTIME_GATE_SKIP=1` — untracked, and advertised in the gate's own block
message. With no curate-at-the-floor in the workflow, the skip hatch is de-facto curation: exactly the
silent drift design law 5 forbids. Additionally the red team confirmed four procedural holes in the
backward edge itself (torn curate, epoch-less journal keys, unvalidated supersede successor,
sight-unseen floor Decisions). The ~23-surface check migration must not start until this ships
(anti-moat must not precede the moat).

**Binding decisions (floor-approved during brainstorming):**

| Decision | Choice |
|---|---|
| Mint-in-anger lesson source | Self-ship: this workstream's own close runs the new ritual; fallback = `feedback_pipe_masks_exit_code` |
| Skip-hatch enforcement | Ship-boundary adjudication (journal skips at the gate; diff-scoped recheck at close; postflight verifies) |
| Mint-offer teeth | Enforced consideration on complex + simple lanes (journaled evidence; "none" is a legal answer); doc-layer exempt |
| Architecture | Approach A: ring-1 deltas + one park/fulfil driver + gate changes + ritual evidence checks |

## 2. Ring-1 deltas (`runtime/engine/backward/`)

### 2.1 Torn curate → reconcile-before-write (`curate-guard.mjs`)

Inside the `journal.step` for retire/supersede, the order flips: `reconcileLesson` FIRST, then the
YAML `writeFileSync`s. Failure analysis:

- reconcile throws → nothing touched disk → clean retry.
- write throws after reconcile → dossier ahead of YAML, but retry re-reads an **active** guard from
  disk (`advanceLifecycle` legal) and every `reconcileLesson` branch is idempotent (push guarded by
  `some()`, status flips re-apply) → retry converges.

The `retired→retire` refusal can no longer arise from a torn step. Mint (`register-ratified.mjs`)
keeps its current order — scenario-first is load-bearing and its retry already converges (draft is
in-memory, never re-read from disk).

### 2.2 Supersede successor gets full mint guarantees (`curate-guard.mjs`, `curate.mjs`)

`proposedSuccessor` grows from a bare entry to a draft-shaped `{entry, eval_scenario, rationale}`.
In the supersede path, after `advanceLifecycle` chains provenance:

1. The chained successor is validated against `CheckEntrySchema` — a refusal returns **before** the
   journal step (no record, no disk writes), the same discipline as ratify.
2. `landEvalScenario({draft: successorDraft, scenariosDir})` lands the successor's scenario inside
   the step — identical guarantees to a minted check, reusing the existing helpers (no parallel path).

`runCurate` and the driver pass `scenariosDir` through to `curateGuard` (new parameter).

### 2.3 Floor Decision renders the full act (`present-floor.mjs`)

`toDecision` serializes the complete payload into `Decision.context`: for mint the full candidate
`CheckEntry` as YAML + the rationale; for curate the current guard YAML, the trigger, the finding,
and (when superseding) the full successor YAML. The session-side ritual renders this as the
AskUserQuestion option preview — the human never ratifies sight-unseen.

### 2.4 Lifecycle epoch (`draft-candidate.mjs`, `register-ratified.mjs`, `curate-guard.mjs`, `present-floor.mjs`, `reconcile-lesson.mjs`, `schema/mints-entry.ts`, `schema/check.schema.ts`)

- `provenance.generation` (int, optional, default 1). When a mint targets an id whose on-disk YAML
  in `checksDir` is terminal (`retired`/`superseded`), the draft gets
  `generation = (prior.provenance.generation ?? 1) + 1`. The driver derives this; `draftCandidate`
  accepts it via the proposal.
- Journal keys gain the epoch: `mint:<id>:g<N>:ratify`, `curate:<id>:g<N>:<transition>`.
- `Decision.id` gains it too: `mint-<id>-g<N>` / `curate-<id>-g<N>` — a fulfilled gen-1 choice can
  never replay into gen-2.
- `reconcileLesson` learns re-mint: the prior terminal mints entry stays as history; a **new** entry
  `{check, ratified, status: active, generation: N}` is appended. Entries are keyed by
  (check, generation); `mints-entry.ts` gains the optional `generation` field (absent = 1).
  Existing entry-lookup guards (`some(e => e.check === check)`) become generation-aware.

## 3. Ring-2: the floor driver + gate (`runtime/adapters/`)

### 3.1 `runtime/adapters/claude-code/run-backward.mjs` (new)

One driver, `run-item.mjs`'s park/fulfil pattern verbatim: exit 0 done / 3 parked / 1 refused-or-
failed / 2 usage; runId `backward`; paths from `runtime.config.json`, which gains
`lessonsDir: "runtime/content/lessons"` and `scenariosDir: "runtime/eval/scenarios"`.
`ask` is bound through `askStep({journal, runId, decision, ask})` — headless ask parks; the driver
prints `pendingDecisions` (full Decision incl. §2.3 payload) and exits 3; the session surfaces the
real AskUserQuestion; `--fulfil <decision-id> --value '<choice-json>'` → `journal.fulfil` → replay
advances through the act.

- **`mint --item <id> --lesson <file> --proposal <proposal.json>`** — mirrors the lesson into
  `lessonsDir` first if absent (frontmatter intact; the mirror is the reconcile target, per the
  dogfood's D1 convention). Derives `generation` (§2.4), runs `runMint`. `edit` fulfilment returns
  the draft for re-proposal; `decline` discards (never persisted).
- **`curate --check <id> --trigger <ship-gate|dangling-scope> [--successor <draft.json>] [--reason …]`**
  — loads the guard YAML from `checksDir`, runs `runCurate`. On retire/supersede the guard is
  lowered on disk in §2.1's safe order; re-running the blocked commit then passes legitimately.
- **`consider --item <id> (--minted <check-id> | --none) --reason '…'`** — writes
  `journal.record('backward', 'consider:<item-id>', {outcome, reason, sha, ts})`. Deliberately NOT a
  hard-floor park: the AskUserQuestion happens session-side in the ritual; only guard-raising/
  -lowering acts get park/fulfil. The record is the postflight evidence.

### 3.2 `runtime/adapters/git/pre-commit-gate.mjs` (changes)

- Block message: per failing check, print the sanctioned path —
  `node runtime/adapters/claude-code/run-backward.mjs curate --check <id> --trigger ship-gate` —
  with `RUNTIME_GATE_SKIP=1` demoted to a last-resort line stating the skip is journaled and
  adjudicated at ship.
- Skip branch journals BEFORE honoring: `journal.record('gate-skips', 'skip:<iso-ts>', {sha, staged})`,
  then exit 0. **Fail-closed on the ledger**: if the append throws, the skip is NOT honored (exit 2)
  — skip evidence is total. Journal root = git-common-dir: shared across worktrees, survives
  worktree removal.

### 3.3 `runtime/adapters/git/ship-recheck.mjs` (new)

Ring-2 sibling of the gate: same `loadRegistry` + `runWatch`, scoped to the branch delta
(`git diff --name-only --diff-filter=ACMR <base>..HEAD`) instead of the staged set.

- `--item <id> --base <ref>` (default `origin/main`).
- Findings → exit 1, each with its curate command (as §3.2).
- Green → `journal.record('backward', 'ship:<item>:gate-clean', {sha, base, ts})`, exit 0.

This is the single adjudication point: it catches what `RUNTIME_GATE_SKIP` bypassed AND what
`--no-verify` worktree commits (project SOP) never ran. Skip debt is **cleared** when the latest
gate-clean postdates the latest skip.

## 4. Ritual wiring (`.claude/skills/backlog-next/`)

### 4.1 Closing phase (SKILL.md, new step between 6.4 and 6.5; simple + complex lanes; doc-layer exempt)

1. **Ship recheck:** run `ship-recheck.mjs`; fix or curate until green (exact commands in the SKILL
   text).
2. **Mint consideration:** the session asks the human via AskUserQuestion — "did this ship surface a
   mechanizable, recurring, still-intended lesson?" If yes: draft the proposal JSON, drive
   `run-backward.mjs mint` (park → floor with candidate-YAML preview → fulfil). Either way, record
   via `run-backward.mjs consider`.

Epic close inherits both: the orchestrator's close runs the complex-lane postflight, and
`backlog-next-epic` SKILL.md gets the same step documented at its epic-pre-done phase (batched over
the epic's members, one consideration for the epic's ship).

### 4.2 Postflight (`postflight.mjs`, two new checks; complex + simple lanes; doc-layer and epic-member exempt — epic-member defers to the epic close)

- **`ship-gate-evidence`** — `ship:<item>:gate-clean` exists on runId `backward` with
  `ts > preflight snapshot.timestamp`, AND no `gate-skips` record in the window postdates it.
  Fails on missing evidence or unadjudicated skip.
- **`mint-considered`** — `consider:<item>` exists in the window, any outcome. "Nothing
  mechanizable" passes; silence fails.
- Postflight reads the ledger via `makeJournal({root: gitCommonDir()})` — project-side scripts
  importing `engine/lib` is the allowed dependency direction (ring-1 imports nothing back).
- Missing snapshot (resumed workstream): degrade to existence-only with a warning; the hard
  requirement (records exist) stays.

## 5. Mint-in-anger (deliverable 1 = this workstream's validation gate)

This item ships through the ritual it builds: its own close runs §4.1 for real, with the human at
the floor via AskUserQuestion. Primary lesson: whatever this workstream itself surfaces. Fallback
(pre-selected): `feedback_pipe_masks_exit_code` — deterministically checkable (piped `tee`/`tail`
without `pipefail` in repo scripts); exact property drafted at mint time for floor review. The
validation gate records the full draft → floor → register → land-eval traversal, the journal keys
produced, and the check id registered in `runtime/content/checks/`.

## 6. Error handling

- **Curate retry convergence** — the red-team scenario becomes a regression test (§7).
- **Replay discipline** — fulfilled ratify short-circuits by `decision.id`; a completed act step
  short-circuits by its epoch key; re-invoking after success reprints the recorded result. Gen-2
  can never consume gen-1 records.
- **Skip ledger fail-closed** — can't journal ⇒ skip not honored (exit 2).
- **`curate keep` at a gate block** — no disk change (existing semantics); the commit stays blocked;
  ship-recheck still requires green, so keep cannot become a stealth bypass.
- **Refusals before journal steps** — extended to successor validation: a refused act leaves no
  record and no partial disk state.

## 7. Testing

`node:test`; run via the direct globs + `npx tsc --noEmit -p runtime/tsconfig.json` (nx cannot run
in a worktree).

- **Ring-1** (`engine/backward/test/`): torn-curate regression (throwing reconcile → retry
  converges); successor goldens (invalid → refusal before journal; valid → YAML + scenario +
  chained provenance); `toDecision` full-render; epoch suite (re-mint after retire executes fresh,
  appends gen-2 mints entry, gen-1 records untouched; Decision ids distinct).
- **Ring-2** (`adapters/claude-code/test/`, `adapters/git/test/`): driver park→fulfil→replay over
  `inMemoryJournal` with scripted ask, all three subcommands; gate skip (record appended + exit 0;
  append throws → exit 2; block message names curate); ship-recheck goldens (dirty delta → exit 1
  with curate hints; clean → sha-stamped evidence).
- **Ritual** (`.claude/skills/backlog-next/test/`): postflight matrix for both new checks
  (present / absent / stale-window / unadjudicated-skip).
- **Existing suites stay green**: dogfood, content-ring (mints-entry change is additive), 64-test
  backward suite, gate tests.

## 8. Out of scope (per the backlog file)

The ~23-surface bulk migration (`runtime-check-migration-completion`); mechanical hardening deltas
(`runtime-redteam-hardening` — incl. `--diff-filter=ACMR` on the *gate*, journal locking, atomic
meta.json); baseline/diff-aware item-gate semantics (`runtime-gate-baseline-semantics`); parity
oracle, work-driver re-platform, operator surface, TS port; any ring-1 contract redesign beyond the
four deltas above.
