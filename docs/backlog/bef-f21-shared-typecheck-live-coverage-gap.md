---
id: bef-f21-shared-typecheck-live-coverage-gap
status: parking
type: tooling
notes: "The F-21 POSITIVE invariant (a shared-surface member touch triggers the cumulative branch-wide typecheck) has no deterministic LIVE corpus scenario. The detection predicate (detect-fork-blast-radius shared/non-shared) is already unit-tested; the gap is the orchestrator reliably EXECUTING the cumulative typecheck on a shared hit — a multi-step model behavior the eval sandbox can't deterministically elicit. bne-member-f21-shared-typecheck was dropped (it could not elicit the touch — the stub worker ships only frontmatter); the deterministic NEGATIVE twin bne-member-f21-nonshared-no-typecheck remains."
references: []
spec: null
plan: null
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
