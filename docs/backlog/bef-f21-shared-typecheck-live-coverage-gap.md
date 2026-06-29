---
id: bef-f21-shared-typecheck-live-coverage-gap
status: shipped
closed: 2026-06-30
type: tooling
notes: "The F-21 POSITIVE invariant (a shared-surface member touch triggers the cumulative branch-wide typecheck) has no deterministic LIVE corpus scenario. The detection predicate (detect-fork-blast-radius shared/non-shared) is already unit-tested; the gap is the orchestrator reliably EXECUTING the cumulative typecheck on a shared hit — a multi-step model behavior the eval sandbox can't deterministically elicit. bne-member-f21-shared-typecheck was dropped (it could not elicit the touch — the stub worker ships only frontmatter); the deterministic NEGATIVE twin bne-member-f21-nonshared-no-typecheck remains."
out_of_scope:
  - "The orchestrator reliably EXECUTING the multi-step cumulative typecheck once a shared hit is detected — that is high-variance model behavior under headless `claude -p`, un-gateable by deterministic teeth; if it proves unreliable the fix is F-21 skill-PROSE prominence, which routes to backlog-skills-simplification, not this corpus-determinism epic (epic out_of_scope #3)."
  - "A `BEF_WORKER_SHARED_FILE` worker knob to elicit the shared-surface touch in the live corpus (disposition option a) — charter-disqualified: a stub fixture still rides a `claude -p` drive, re-introducing the model-behavior dependency this epic eliminates."
references: []
spec: null
plan: null
validation_gate: "SHIPPED via b67a840d on epic branch feat/epic-bef-deterministic-coverage-gaps. Extracted a pure exported BLAST_EXIT + blastExitCode helper in detect-fork-blast-radius.mjs and added 7 CLI exit-code-contract tests (detect-fork-blast-radius.test.mjs 10/10 pass; full backlog-next-epic suite 56/56 pass) gating the deterministic SEAM the orchestrator F-21 / E5 case-3 routing reads: exit 0 = no shared hit (safe to auto-resolve), 1 = shared-surface hit (escalate to the floor), 2 = usage. Pins the values + polarity, the real scanSurfaces→exit-code seam, and a 3-arm CLI wiring smoke (no-args→2 hermetic, no-match→0, present-symbol→1). Code verification corrected the member's stale premise: only the pure isSurfaceFile/scanSurfaces helpers were tested, NOT the exit-code mapping the routing keys off. Tier-0 skill change — detect-deploy-needed + detect-doc-derivation both exit 10 (no deploy, no derived-doc regen); the model-behavior execution half is documented out_of_scope. Mirrors the shipped bef-closing-detector detect-cli-exit-contract pattern."
topic_memory: [project_backlog_eval_framework.md]
epic: bef-deterministic-coverage-gaps
epic_role: core
---

# F-21 shared-surface positive: no deterministic live corpus coverage

Surfaced during the `backlog-eval-corpus-hardening` E6-recovery (the live full-corpus baseline). The
F-21 invariant pair is: a member touching a **shared surface** must trigger the cumulative branch-wide
typecheck (`pnpm nx run-many -t typecheck`); a member touching only a non-shared surface must **skip** it.

- **Negative half** — `bne-member-f21-nonshared-no-typecheck` — was de-flaked to a deterministic
  `neverCalled: ['nx run-many -t typecheck']` tooth (a non-shared member produces no cumulative
  typecheck). Green, kept.
- **Positive half** — `bne-member-f21-shared-typecheck` — was **dropped**. The eval stub worker ships a
  member by writing only its backlog frontmatter; it never touches the seeded shared file, so the
  orchestrator (correctly) detects no shared-surface touch and skips F-21. Live evidence (stubs.log):
  `backlog-next-worker beta-3` → straight to `nx run e2e-...`, **no `nx run-many -t typecheck`** →
  rubric 1/5. Making it elicit the touch needs a `BEF_WORKER_SHARED_FILE` worker env (mirroring the
  shipped `BEF_WORKER_DEPLOY_FILE`) **and** the orchestrator to reliably execute the multi-step F-21
  path (notice the shared touch → `detect-fork-blast-radius.mjs <symbol>` → `nx run-many -t typecheck`).
  That last part is high-variance model behavior; if it proves unreliable the scenario would expose a
  **skill-prose** weakness (F-21 prominence), whose fix is out of this epic's corpus-hardening scope.

## Where the deterministic coverage already lives / should live

- The **detection predicate** is already unit-tested: `.claude/skills/backlog-next-epic/test/detect-fork-blast-radius.test.mjs`
  (exit 1 = shared hit, exit 0 = non-shared). This is the deterministic core of "is the surface shared?".
- The **uncovered part** is the orchestrator's reliable *execution* of the cumulative typecheck once a
  shared hit is detected — a model behavior, not unit-testable. Options when picked up: (a) build the
  `BEF_WORKER_SHARED_FILE` knob + re-measure whether the orchestrator reliably runs F-21 (and, if not,
  file the skill-prose-prominence fix as `backlog-skills-simplification`-adjacent work); or (b) accept
  the negative twin + the detection unit test as sufficient and leave the positive as documented-only.

Mirrors the disposition of [[bne-e71-chained-gate-unit-coverage]] (another invariant whose premise is a
model judgment uncountable by the corpus's deterministic teeth).

## Resolution (shipped 2026-06-30, member of [[bef-deterministic-coverage-gaps]])

Code verification corrected the premise above. The detection helpers `isSurfaceFile` / `scanSurfaces`
were unit-tested, but the **CLI exit-code contract** the orchestrator's F-21 / E5 case-3 routing
*actually* keys off (`detect-fork-blast-radius.mjs <symbol>` → exit `0` safe / `1` shared hit / `2`
usage) was **not** — exactly the gap [[bef-closing-detector-live-coverage-gap]] found for the closing
detectors. So the deterministic signal had a real, un-gated seam after all.

Fix (mirrors the closing-detector disposition, option **c**): extracted the hit-count→exit-code mapping
into a pure exported helper `blastExitCode` + `BLAST_EXIT` constants, routed `main()`'s exits through it,
and added CLI exit-code-contract tests — value/polarity pins, the real `scanSurfaces`→exit-code seam, and
a 3-arm CLI wiring smoke (`no-args→2` hermetic; no-match→`0`; a symbol present in shared surfaces→`1`).
This is the epic's sanctioned *"unit test of the orchestrator predicate the live corpus cannot gate"* and
a liftable pattern for any `detect-*.mjs` orchestrator predicate.

**Genuinely un-addable (out_of_scope):** the orchestrator reliably *executing* the multi-step cumulative
typecheck once a shared hit is detected stays high-variance model behavior under headless `claude -p`; the
deterministic NEGATIVE twin `bne-member-f21-nonshared-no-typecheck` (a `neverCalled` tooth) plus this
exit-code-contract suite are the deterministic coverage. If the execution proves unreliable in practice the
fix is F-21 skill-PROSE prominence → `backlog-skills-simplification`, not this corpus-determinism epic.
