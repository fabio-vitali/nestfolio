# backlog-next-epic — LESSONS (pitfalls log)

The *why* behind the non-obvious guardrails in `SKILL.md`. The procedure keeps a terse, load-bearing
guardrail inline at the step that needs it; the multi-sentence backstory explaining *why* it must be
done that way lives here, referenced from the step by tag (e.g. "see LESSONS F-24"). Entries are keyed
by F-number so the PR-review trail stays intact. **This file changes no behavior** — moving a lesson
here never removes the inline warning at its step.

Two lessons (**F-23**, **F-30**) are shared with `backlog-next` and canonically live in
[`../backlog-next/LESSONS.md`](../backlog-next/LESSONS.md); this skill's steps cross-reference them
there rather than re-narrating.

---

## F-4 — the agent cannot self-measure context, so `/clear` is gated on the member boundary

**Guardrail (SKILL.md E4.5):** in `--auto`, at *every* member boundary unconditionally recommend the
user `/clear` then resume — not only "heavy" ones.

**Why.** There is no tool for "%-of-context-used", so a literal "pause at X% full" is not implementable.
Gating the clear on a "was this member heavy?" judgment fails because that judgment is itself the
unreliable part — the agent under-calls "heavy" and the window creeps up. The per-member boundary is a
deterministic, principled proxy for context growth and a *provably safe* clear point: all epic state
lives on disk (run-state JSON + member frontmatter), so resuming re-derives progress and continues at
the next open member with zero duplication. A per-member clear is the default, not the exception. The
structural fix (run each member as a subagent so context barely grows) is the parked Tier-2 item
`backlog-next-epic-member-subagent-isolation`.

## F-5 — the scope-boundary floor is a decidable test, not "large blast radius"

**Guardrail (SKILL.md E5 hard floor):** pause for a scope-boundary fork ONLY when it (a) changes the
epic's `out_of_scope:`, (b) alters a contract/event/interface/shared-lib export consumed by a
not-yet-worked core member (`detect-fork-blast-radius.mjs` exits 1), or (c) forces rework of an
already-shipped member.

**Why.** This replaces an earlier over-broad "large downstream blast radius" clause that swallowed
*every* fork into a pause, defeating `--auto`. The three-pronged decidable test pauses on the forks
that can actually ripple while letting genuinely-local forks auto-resolve.

## F-6 — append-only decision log; shared-surface in-member forks escalate

**Guardrail (SKILL.md E5):** the `decisions[]` log is append-only (a reversal is a NEW entry that
references the superseded one by index); an in-member fork whose subject is a shared surface
(`detect-fork-blast-radius.mjs` exit 1) escalates to the floor instead of auto-resolving.

**Why.** Keeping the original (possibly wrong) call visible is what makes the log a trustworthy
PR-review trail — editing/deleting a prior entry would erase the reasoning under review. And a fork on
a shared surface can ripple into a member that hasn't been worked yet, so it is not safe to
auto-resolve locally.

## F-7 / F-33 — the floor surface MUST be AskUserQuestion; the agent never self-merges

**Guardrail (SKILL.md E5 + E8.1):** when the floor fires, surface an **AskUserQuestion** widget with a
`(Recommended)` option — a free-text "this is your call" prose pause is a skill violation. No option
ever runs `gh pr merge`; the agent never self-merges and never local-merges the epic branch.

**Why.** An ambiguous prose "go" once collapsed into a self-merge: a prose pause invites the agent to
read a bare "go" as authorization to act, including to merge. A structured widget forces an explicit
choice and keeps the merge unambiguously the user's.

## F-9 — the `--auto` debug budget is 3 cycles, then a floor pause

**Guardrail (SKILL.md E4.3):** in `--auto`, attempt a per-member test fix within at most 3
debug→re-run cycles; exceeding it is a named floor item → pause.

**Why.** Each cycle is an expensive dev deploy + integration run, and a fix that hasn't converged in
three attempts is almost always a missing decision or a wrong assumption (i.e. a floor pause), not a
fourth mechanical retry. Tune the number only with that cost/diagnosis trade-off in mind.

## F-10 — clear context before E6 (the heaviest boundary)

**Guardrail (SKILL.md E4.5):** once `epic-members.mjs` reports drainable, recommend a `/clear` *before*
running E6.

**Why.** The E4→E6 transition is the single largest context step in the whole epic — cumulative deploy
+ batched Jest e2e + Playwright. It must not run on a window already full from the member loop.

## F-11 / F-12 / F-13 — run-state only through the helper, never hand-authored

**Guardrail (SKILL.md Resume gate + E3 + E5):** read run-state with `runstate.mjs get` (never
`cat`/parse the raw file); write/mutate it only via `init` / `append-decision` / `set-e2e` / `set-e8`.

**Why.** A hand-written run-state file once drifted its schema and emitted malformed JSON. The helper
resolves the cwd-independent absolute path and self-heals a malformed file into a clean error (F-11/
F-13); every mutation is an atomic parse → mutate → `JSON.stringify` (F-12), so the file can never go
malformed and the closed 6-key schema can never drift (no `paused_at`, no per-member decision arrays).

## F-14 — e2e green must be FRESH (recorded sha == HEAD)

**Guardrail (SKILL.md E7.2):** before shipping, `runstate.mjs e2e-fresh <id>` must exit 0 — the
recorded `e2e.sha` equals current `HEAD`.

**Why.** A re-opened member during E6 recovery moves HEAD and invalidates the recorded green. Exit 10
(drainable) alone is necessary but not sufficient: a drainable epic whose batched e2e is red, never
ran, or is stale must not ship — it forces a return to E6.

## F-21 — cumulative branch typecheck on shared-surface touches

**Guardrail (SKILL.md E4.3):** when a member touched a shared surface (`detect-fork-blast-radius.mjs
<symbol>` exit 1), run a cheap cumulative typecheck across the whole branch diff at the member boundary
before advancing; a break is a per-member gate failure (debug, don't advance).

**Why.** Per-member integration tests only `tsc` the member's own affected projects, so a member that
renames a shared contract/event/shared-lib export (e.g. `quantity → amountCents`) ships green while
breaking a *not-yet-tested consumer* on the cumulative branch — which would otherwise surface only at
the expensive E6. Caveat: the two e2e apps have no `typecheck` target yet, so a contract break in e2e
specs still slips to E6 — making e2e specs type-checkable is e2e-app tooling, tracked separately.

## F-24 — a GREEN e2e verdict is prescriptive, not assembled

**Guardrail (SKILL.md E6):** a green verdict requires (1) a single execution of each suite on the
current tip SHA, (2) collected-test-count > 0 for every suite, (3) the tip SHA recorded in `e2e.sha`.

**Why.** Green must never be stitched together from runs across different SHAs — the order-execution
run once assembled "green" from 3 runs over 2 SHAs. If any member commit lands after a suite ran, that
suite is stale and must be re-run on the new tip. The collected-count assertion guards the nx
quote-strip foot-gun (a stripped regex matches nothing → exit 0 having run ZERO tests; a suite that
collected nothing is RED, not green). The only sanctioned partial re-verify is re-running the specific
failed/stale suite on the tip SHA and requiring it to pass on its own.

## F-25 — the epic PR predictably conflicts under `docs/backlog/`

**Guardrail (SKILL.md E8.1):** expect `docs/backlog/` merge conflicts and resolve two kinds
differently — `docs/BACKLOG.md` (the auto-index) mechanically take-branch + re-run `lint --fix`; the
epic/member `<id>.md` files take the **branch** side (it carries the shipped frontmatter). Resolve
frontmatter conflicts FIRST, then `lint --fix`.

**Why.** Both `main` (the E1 promotion marker + ongoing backlog edits) and the branch (the E7 ship
frontmatter) write under `docs/backlog/`, so conflicts there are expected, not a surprise. A wrong
resolution that keeps the epic file's `status: active` leaves the epic open and **rule-11-blocks the
next epic**. `lint --fix` repairs ONLY the index, never per-file frontmatter — so it will happily
render a *consistent index of the wrong state* if the frontmatter conflict was resolved wrong. That is
why frontmatter is resolved first.

## F-32 — list active epics with the canonical parser, not grep

**Guardrail (SKILL.md E1 rule-11 guard):** use `epic-members.mjs --active-epics`, never a hand-rolled
`grep`.

**Why.** A hand-rolled grep over frontmatter is brittle (multi-line YAML, comments, near-misses) and
the E0 preflight does not cover the rule-11 check, since at promotion time only 0-or-1 epics are
active. The canonical parser is the single source of truth for "which epics are active".

## F-23 — postflight/post-merge tail runs from `$MAIN` (shared — see backlog-next)

The E8.4 post-merge tail must run `postflight.mjs` from `$MAIN`, never the removed worktree. This is the
same lesson as `backlog-next` Step 7; its canonical entry is
[`../backlog-next/LESSONS.md`](../backlog-next/LESSONS.md) **F-23**.

---

## The Skill-tool seam — why the worker runs inline, not as a subagent

**Guardrail (SKILL.md E4.2):** drive each member by invoking `/backlog-next` **via the Skill tool**
with the epic context; do not expect a refusal and do not "recover" by some other path.

**Why.** `backlog-next` is intentionally **NOT** `disable-model-invocation` (unlike this orchestrator)
precisely so the orchestrator can drive it. The Skill tool loads the worker's SKILL.md **inline into
this orchestrator's own context** — that inline run (NOT a detached subagent) IS the intended execution
model, and is why member work accumulates in the orchestrator's context. That accumulation is exactly
what the E4.5 per-member context checkpoints and the parked Tier-2 subagent-isolation item address. The
Skill-tool call is the seam; there is no other handoff mechanism to look for.
