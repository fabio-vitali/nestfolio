---
name: backlog-next-epic
description: Epic orchestrator — runs a whole delivery epic as ONE branch / ONE PR. Promotes the epic, loops its core members through /backlog-next in epic-member mode, batches the expensive e2e at epic pre-done, runs the captured audit, and ships via a single PR. Optional --auto mode auto-resolves decisions (logging each, with a hard floor) for fire-and-forget.
disable-model-invocation: true
---

## When to invoke

User-triggered via `/backlog-next-epic [<epic-id>] [--auto]` only. `disable-model-invocation: true` blocks auto-invocation.

- `<epic-id>` — a `type: epic` backlog file. Without it, the orchestrator selects the epic by **impact** (default) or a `--like "<criteria>"` criterion — see § "Selecting the epic". A bare arg that isn't an epic id is treated as a criterion (so `/backlog-next-epic fix worst bug` works). Selection ALWAYS ends in an `AskUserQuestion` confirm.
- `--like "<criteria>"` — rank candidate epics by a free-text criterion instead of by impact (for fuzzy/thematic intents the rubric can't express). Still confirmed via `AskUserQuestion`.
- `--auto` — fire-and-forget: auto-resolve decisions and log each for PR review, pausing only on the hard floor (see § E5). Without it, the orchestrator pauses at every architectural fork.

This skill owns the **epic lifecycle**. It does NOT execute member work directly — it drives `/backlog-next` in **epic-member mode** (one member at a time, inside one shared worktree). For a single non-epic workstream, use `/backlog-next` directly.

## Relationship to `/backlog-next`

| Concern | Owner |
|---------|-------|
| Pick/execute one member workstream (lane, spec→plan→code, per-member integration tests, doc-derivation, member ship) | `/backlog-next` (epic-member mode) |
| Promote the epic, rule-11 guard, member ordering, the single worktree/branch | **this skill** |
| Batched expensive e2e (Jest e2e + Playwright) at epic pre-done | **this skill** |
| Captured audit, epic ship, single PR + cleanup, epic-level postflight | **this skill** |
| `--auto` decision policy + decision log + hard floor | **this skill** |

Member ordering is the tested helper `epic-members.mjs` (the deterministic pick that used to be inline bash in `/backlog-next` Step 1a).

## Procedure

### Resume gate (check FIRST, before E0)

`/backlog-next-epic <id>` is **resumable and idempotent**. Before anything else, read the run-state via the helper (never `cat`/parse the raw file — the helper resolves the cwd-independent absolute path and self-heals a malformed file into a clean error, F-11/F-13):

```bash
node .claude/skills/backlog-next-epic/runstate.mjs get <id>   # prints the JSON, or "FRESH" (exit 3) if absent, or a clean error (exit 2) if corrupt
```

Branch on the result:

- **Exists → this is a RESUME.** The epic is already promoted and the branch already exists. **Skip E0, E1 (promotion) and E3 (init).** Run E2 in its idempotent form (it no-ops / re-attaches the worktree if the branch exists but the worktree was pruned), re-enter the worktree as cwd, read (do not overwrite) the run-state, and **jump straight to E4** — the member loop re-derives the next open member from `epic-members.mjs`, so a half-finished run continues correctly (a member left `status: active` resumes in epic-member mode).
  - **Run-state `e8: PR_OPEN_AWAITING_MERGE` → the PR is already open, awaiting the USER's merge** (do NOT re-enter the member loop). Check the PR state (`gh pr view <n> --json state -q .state`): **`MERGED`** → run **only** the E8.4 post-merge tail (ff `main`, delete the merged branch, epic postflight, drop run-state) and finish; **still `OPEN`** → re-print the PR link and STOP — the merge remains the user's (never `gh pr merge`).
- **Absent → fresh run.** Proceed E0 → E1 → E2 → E3 → E4 normally.

A resume never re-promotes the epic, never re-creates the branch, and never overwrites the accumulated decision log / e2e evidence in run-state.

### Selecting the epic (no resume + no explicit `<epic-id>`)

The Resume gate handles an in-flight epic. Otherwise resolve WHICH epic to run from the invocation
form, then enter E0 with that epic id:

| Form | Resolve |
|---|---|
| `/backlog-next-epic <arg>` | `node .claude/skills/backlog-next-epic/epic-members.mjs --classify "<arg>"` → `epic-id=<id>` ⇒ use it directly (skip the menu, go to E0); `criterion` ⇒ fall to the criterion row. |
| `/backlog-next-epic --like "<criteria>"` | Criterion mode with `<criteria>` — an explicit `--like` is ALWAYS a criterion (skip `--classify`). |
| `/backlog-next-epic` (no arg) | Default — impact-ranked. |

**Build candidates → rank → confirm:**

1. `node .claude/skills/backlog-next-epic/epic-members.mjs --candidates` — every open epic
   (active / queued / parking) with its `core=open/total` count + notes, in baseline order.
2. **Rank:**
   - **Default (impact):** score each candidate against `.claude/skills/backlog-lint/lib/severity-rubric.md`
     (read it). Open each candidate's file for `scope:` / `done_when:`. **`queued` epics KEEP their
     `rank`; severity orders only the `parking` tail.** Show computed impact as context on all.
   - **Criterion (`--like`):** order by how well each candidate matches `<criteria>` (semantic).
3. **Confirm via AskUserQuestion** — surface the top candidates (≤4), one-line reason each, the
   highest-ranked marked `(Recommended)`. The user's pick is the epic id → proceed to E0. **Never
   skip this confirm** (E5 floor). Zero candidates → report "no epics to run — promote or mint one
   via `/backlog-themes`" and stop.

### E0. Epic-start preflight (once)

```bash
node .claude/skills/backlog-next/preflight.mjs
```

Standard lane: tree clean, `main` == `origin/main`, `backlog-lint` green, no stale worktrees. Do not bypass. This runs **once** for the whole epic; per-member preflight later uses `--lane=epic-member`.

### E1. Resolve + promote the epic

```bash
node .claude/skills/backlog-next-epic/epic-members.mjs <epic-id>   # roster + next core member (exit 10 = already drainable)
```

- **Rule 11 guard.** Before promoting, list the currently-active epics with the canonical parser (NOT a hand-rolled `grep` — F-32; and the E0 preflight does NOT cover this, since at promotion time only 0-or-1 epics are active):
  ```bash
  node .claude/skills/backlog-next-epic/epic-members.mjs --active-epics   # one id per line, or "(none)"
  ```
  If it prints any id *other than* the `<epic-id>` you are about to promote, a *different* epic is already `status: active` → stop and ask resume-vs-switch; never promote a second delivery epic. (If it prints the target itself, this is a resume — the resume gate already handled it.)
- **Promote.** Set the target epic `status: active`; ensure `done_when:` + `scope:` + `out_of_scope:` are present (rule 4). Commit this **promotion marker on `main`** and push (docs-backlog-on-main convention; makes the in-flight epic + its branch name visible for crash-recovery). `node .claude/skills/backlog-lint/lint.mjs --fix`, commit the index.
- If `epic-members.mjs` already reports the epic **drainable** (exit 10) before any work, still create the worktree (E2) and run the **E6 batched e2e gate on the cumulative state** before shipping — do NOT skip straight to E7 with an unproduced validation_gate. (If the epic genuinely touched no deployable code, E6's deploy/e2e detectors will no-op and E7.3's `validation_gate:` cites per-member evidence + the no-op note.)

### E2. Create the single epic worktree + branch

One worktree for the whole epic — every member commits here; `main` moves only at the single merge.

```bash
MAIN=$(git rev-parse --show-toplevel)
git -C "$MAIN" fetch origin main --quiet
# Idempotent — safe to re-run on resume (worktree and/or branch may already exist).
if ! git -C "$MAIN" worktree list | grep -q "worktrees/epic-<id>"; then
  if git -C "$MAIN" rev-parse --verify --quiet feat/epic-<id> >/dev/null; then
    git -C "$MAIN" worktree add .claude/worktrees/epic-<id> feat/epic-<id>            # branch exists (resume after a prune) → re-attach
  else
    git -C "$MAIN" worktree add -b feat/epic-<id> .claude/worktrees/epic-<id> origin/main   # fresh run
  fi
fi
[ -e .claude/worktrees/epic-<id>/node_modules ] || ln -s "$MAIN/node_modules" .claude/worktrees/epic-<id>/node_modules   # see [[feedback-worktree-deploy-friction]]
```

Branch from `origin/main` to bound drift. All subsequent member work happens with this worktree as cwd, on `feat/epic-<id>`. **Set that cwd with Bash — `cd .claude/worktrees/epic-<id>` — and use `git -C`/worktree-absolute paths for file edits; do NOT use `EnterWorktree`** (it is unreliable/forbidden in a cwd-pinned worker session — see [[feedback-worktree-entry-cwd-pinned]] / [[feedback-exitworktree-fails-cwd-pinned]]). The Resume gate's "re-enter the worktree as cwd" means exactly this `cd`.

### E3. Initialize run-state (fresh run only)

Write the run-state via the helper — **never hand-author the raw JSON** (a hand-written file drifted its schema and emitted malformed JSON, F-11/F-12). On a RESUME this file already exists; the resume gate read it — do NOT re-init.

```bash
node .claude/skills/backlog-next-epic/runstate.mjs init <id> --branch=feat/epic-<id> --worktree=.claude/worktrees/epic-<id> [--auto]
```

This writes the **closed 6-key schema** (anything else is rejected on write):

```json
{ "epic": "<id>", "branch": "feat/epic-<id>", "worktree": ".claude/worktrees/epic-<id>",
  "auto": false, "decisions": [], "e2e": null }
```

Every later mutation goes through the helper too (`append-decision`, `set-e2e`, `set-e8`) — each does an atomic parse → mutate → `JSON.stringify`, so the file can never go malformed and the schema can never drift (no `paused_at`, no per-member decision arrays — F-12).

**Member status is deliberately NOT stored here.** It is derived from each member file's frontmatter via `epic-members.mjs` — **frontmatter is the single source of truth; run-state is an append-only annotation.** Run-state's only jobs: (a) mark a run in flight (the resume gate keys off its existence), (b) carry `auto`, (c) accumulate the `decisions` log and `e2e` evidence across resumes. Keeping member state in exactly one place (frontmatter) avoids a drift-prone second copy.

The run-state also carries an optional `e8: PR_OPEN_AWAITING_MERGE` marker, set by E8.1 when the epic PR is open and awaiting the user's merge — the only sanctioned `e8` value (enforced by the closed schema in `runstate.mjs` — `validateRunState` rejects any other `e8` value or extra key).

### E4. Member loop

Repeat until `epic-members.mjs` reports drainable (exit 10):

1. **Pick** the next core member from `epic-members.mjs` (`next=<member-id>`).
2. **Run** `/backlog-next <member-id>` in **epic-member mode** — invoke it **via the Skill tool** and pass the epic context (active epic `<id>`, branch `feat/epic-<id>`, worktree). `backlog-next` is intentionally **NOT** `disable-model-invocation` (unlike this orchestrator) precisely so the orchestrator can drive it: the Skill tool loads the worker's SKILL.md **inline into this orchestrator's own context** — that inline run (NOT a detached subagent) IS the intended execution model, and is why member work accumulates in the orchestrator's context (the very growth E4.5 checkpoints and the parked Tier-2 subagent-isolation item address). Do not expect a refusal and do not "recover" by some other path; the Skill-tool call is the seam. The worker applies its § "Epic-member mode" deltas: preflight/postflight `--lane=epic-member`, work inside this worktree, commit on the branch, run **per-member integration tests** only, and **skip** the expensive e2e / finishing / cleanup / push. Critically, the worker drives any `executing-plans`/`subagent-driven-development` only through task-execution and **STOPS before their `finishing-a-development-branch` handoff** (worker Step 5 delta) — that handoff would otherwise merge/PR the epic branch mid-loop and destroy the one-PR invariant.
3. **Per-member gate.** The member's integration tests (and doc-derivation) must be green before advancing — a failure is NOT a decision: route to `superpowers:systematic-debugging`. In `--auto`, attempt the fix within a **bounded budget — at most 3 debug→re-run cycles** (3 because each cycle is an expensive dev deploy + integration run, and a fix that hasn't converged in three attempts is almost always a missing decision or a wrong assumption — i.e. a floor pause — not a fourth mechanical retry; tune the number only with that cost/diagnosis trade-off in mind — F-9); exceeding it is a named floor item (E5) → **pause** and surface to the user (never loop unbounded burning dev deploys + integration runs).
   - **Cumulative branch typecheck on shared-surface touches (F-21).** Per-member integration tests only `tsc` the member's own affected projects, so a member that renames a **shared contract / event / shared-lib export** (e.g. `quantity → amountCents`) ships green while breaking a *not-yet-tested consumer* on the cumulative branch — surfacing only at the expensive E6. When the member touched a shared surface (detect with `node .claude/skills/backlog-next-epic/detect-fork-blast-radius.mjs <symbol>` — exit 1 = shared hit), run a **cheap cumulative typecheck across the whole branch diff** at the member boundary before advancing: `pnpm nx run-many -t typecheck -p "$(node tools/affected-projects.mjs --base=origin/main --with-target=typecheck | paste -sd, -)"`. A break here is a per-member gate failure (debug, don't advance). _Caveat: the two e2e apps have no `typecheck` target yet, so a contract break in e2e specs still slips to E6 — making e2e specs type-checkable is e2e-app tooling, tracked separately (out of this epic's skill-workflow scope)._
4. **Record.** The member's own ship (its frontmatter `status: shipped`, committed on the branch) IS the state — the next loop re-derives progress from `epic-members.mjs`, so there is nothing to mirror into run-state. Append to the run-state `decisions` log only if a fork fired (E5).
5. **Context checkpoint (between members) — bounds `--auto` context growth.** After a member ships **and** its `--lane=epic-member` postflight passes (a clean, fully-committed state), emit a fixed **STABLE CHECKPOINT** block:

   > ✅ **Checkpoint — epic `<id>`:** member `<member-id>` shipped. `<k>`/`<n>` core members remaining. Worktree tree clean; all work committed on `feat/epic-<id>` (nothing pushed, no PR yet). Resume with `/backlog-next-epic <id> --auto`.

   Then decide whether to **pause for a context clear**. **Be honest about the constraint: the agent cannot read its own context-window size programmatically** — there is no tool for "%-used", so a literal "pause at X%" is not implementable by the skill. Use the **per-member boundary** instead: it is a deterministic, principled proxy for context growth and a *provably safe* clear point (all epic state lives on disk — run-state JSON + member frontmatter — so resuming re-derives progress and continues at the next open member with zero duplication). In `--auto`, **stop here and UNCONDITIONALLY recommend the user `/clear` (or restart the terminal) then resume with the command above — at every member boundary, not only "heavy" ones.** Do not gate the clear on a "was this member heavy?" judgment: that judgment is itself the unreliable part (F-4 — the agent cannot self-measure context, so it under-calls "heavy" and the window creeps up), the resume is cheap, and the boundary is provably safe. A per-member clear is the **default**, not the exception. **Also clear at the heaviest boundary of all — the E4→E6 transition (F-10):** once `epic-members.mjs` reports drainable, recommend a `/clear` *before* E6, because the cumulative deploy + batched Jest e2e + Playwright is the single largest context step in the whole epic and must not run on a window already full from the member loop. In non-`--auto` runs just print the block (the user is already interactive) and continue. (Tier-2 follow-up — running each member as a subagent so context barely grows — is the structural fix; tracked in the backlog standalone-parking item `backlog-next-epic-member-subagent-isolation`.)
6. **Loop.** The worker's STOP (its epic-member postflight passed; control returns here) is an honor-system handoff — there is **no callable "next" seam beyond re-running step 1**. That is by design: `epic-members.mjs` re-derives the next open core member from frontmatter on every iteration, so the loop is self-correcting (a member left `active` resumes; a just-shipped member drops out; a member split mid-run is picked up). Re-pick and continue.

### E5. Decision handling (default vs `--auto`)

A **decision** is an architectural/design fork. Test/build failures are NOT decisions (see E4.3). The canonical decision-log entry shape (referenced by E3 and the spec) is:
`{ member, decision, options, chosen, rationale (the reuse rationale), rejected }`. Append it **via the helper** — pipe the entry as JSON on stdin; it validates and does the atomic parse → mutate → stringify into the single `decisions[]` (F-12), so the file never goes malformed:

```bash
echo '{ "member": "<id>", "decision": "...", "options": ["..."], "chosen": "...", "rationale": "...", "rejected": "..." }' \
  | node .claude/skills/backlog-next-epic/runstate.mjs append-decision <epic-id>
```

The log is **append-only**: never edit or delete a prior entry — a later reversal is a NEW entry whose `rationale` references the superseded entry by index, so the original (possibly wrong) call stays visible in the PR-review trail (F-6). (The helper only ever appends — there is no edit/remove path by construction.)

**Where decisions actually come from.** Most forks are NOT raised by this orchestrator — they are raised **inside downstream sub-skills** (`brainstorming`, `finishing-a-development-branch`, or an AskUserQuestion the worker itself issues). `--auto` cannot magically intercept an arbitrary prompt buried in a sub-skill, so it must **decide each known sub-skill prompt in advance**, with a conservative catch-all for the rest.

- **Default mode (no `--auto`):** at every fork, **pause** — surface via AskUserQuestion (mark the recommended option per the project rule), take the user's choice, record it in the decision log, resume.

- **`--auto` mode** — explicit per-source handling:
  1. **`type: design` members → ALWAYS PAUSE.** A design slice routes to `superpowers:brainstorming`, whose hard approval gate requires explicit user sign-off on *every* design. `--auto` does **not** self-approve it — the design is the highest-leverage decision in the whole epic and must never be auto-resolved. Pause, get approval, record, resume. (Equivalently: `type: design` members are not `--auto`-eligible for their design approval.)
  2. **`finishing-a-development-branch` menu (E8) → governed by E8's merge-ownership rule.** Answer the menu by taking the **PR route** (push + create PR) — but the close does NOT end there: it **STOPS at an open PR via AskUserQuestion** for the user to merge. `--auto` **never** runs `gh pr merge` and never local-merges the epic branch (E8). (Per-member finishing menus don't arise — the worker Step 5 delta stops before them.)
  3. **In-member architectural forks the worker surfaces** (a non-design AskUserQuestion / mid-execution choice) → **before auto-resolving, run the blast-radius gate:** `node .claude/skills/backlog-next-epic/detect-fork-blast-radius.mjs <fork-subject-symbol>`. **Exit 1 (a shared-surface hit) → escalate to the floor** (the fork can ripple into a not-yet-worked member — F-6). **Exit 0** → resolve by selecting the option the project marks **(Recommended)** = the **most reusable / generalizable / cleanly-abstracted** one (`CLAUDE.md` § "Hard Constraints"; reusability breaks ties). **Append** to the decision log (append-only — see above). Continue.
  4. **Catch-all → treat as floor (PAUSE).** Any sub-skill prompt or fork **not** enumerated in 1–3 is unknown territory: do NOT guess — pause and ask. (Conservative by design; close the gap by adding the case here.)

  **Hard floor — pause even in `--auto`** (this is advisory prose, but the worst ops are ALSO mechanically gated by the harness / `CLAUDE.md` § "Still requires explicit confirmation", so the floor is not the sole defense):
  - **Irreversible / outward-facing actions** — staging/prod-account ops, real-money/broker actions, `git push --force`, `git reset --hard` on shared branches, `git branch -D`, destructive deletes, mutations outside `dev-*` naming, anything outside this repo.
  - **Scope-boundary fork (decidable test)** — pause ONLY when the fork (a) changes the epic's `out_of_scope:` boundary, (b) alters a contract / event / interface / shared-lib export consumed by a not-yet-worked core member (i.e. `detect-fork-blast-radius.mjs` exits 1 for it), or (c) forces rework of an already-shipped member. A genuinely balanced fork where reusability does not break the tie also still pauses. (This replaces the old over-broad "large downstream blast radius" clause that swallowed every fork — F-5.)
  - **Bounded-effort exceeded** — a member's `--auto` debug budget (E4.3, ≤3 cycles) is spent.
  - **Computed-selection pick (default impact-rank or `--like`)** — an epic chosen by a computed ordering MUST be confirmed by the user via the § "Selecting the epic" `AskUserQuestion`, **even in `--auto`**. `--auto` never auto-launches the top-ranked epic onto a whole branch/deploy/e2e budget. An explicit `<epic-id>` is a user pick and is unaffected.

  When the floor fires, the surface MUST be an **AskUserQuestion** widget with a `(Recommended)` option — a free-text "this is your call" prose pause is a **skill violation** (it is what let an ambiguous "go" collapse into a self-merge — F-7/F-33). Record the outcome (append-only), resume. The decision log is the **asynchronous-review surface** that replaces synchronous approval — it lands in the PR body (E8).

### E6. Epic pre-done — batched expensive e2e (the new gate)

Once `epic-members.mjs` reports drainable, validate the **cumulative** branch state as a unit:

```bash
# Deploy everything the epic touched (true-affected over the whole branch diff).
node .claude/skills/backlog-next/detect-deploy-needed.mjs          # services across the full branch vs origin/main
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=<from-detect>   # if deploy needed
```

Then run the expensive e2e **once**, scoped to the flows/journeys the epic touched:

```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features   # scoped Jest e2e
pnpm nx run nestfolio-e2e:e2e                                                # scoped Playwright journeys
```

- **Scoping.** The epic boundary is the right place to accept the **full** suites — the cost is amortized across all members, so running them unscoped is defensible. If you DO scope, scope **via env vars, never a `--testPathPatterns`/`--grep` regex argument** — the nx wrapper strips quotes around a regex and silently runs ZERO tests at exit 0 (false green). See [[feedback-e2e-nx-wrapper-strips-quotes]].
- Choose the **repeat count at epic-start** by risk; if it is ≥ the cost-conscious threshold (e.g. 5 consecutive runs), surface it via AskUserQuestion **even in `--auto`** (cost is floor-adjacent). See [[feedback-e2e-cost-conscious]].
- **Green is prescriptive, not assembled (F-24).** A "GREEN" verdict requires (1) **a single execution of each suite on the current tip SHA** — never stitch a green from runs across different SHAs (the order-execution run assembled "green" from 3 runs over 2 SHAs); if any member commit lands after a suite ran, that suite is stale → re-run it on the new tip. (2) **collected-test-count > 0** for every suite — assert it explicitly, because the nx quote-strip foot-gun (above) exits 0 having run ZERO tests; a suite that collected nothing is RED, not green. (3) Record the tip SHA in `e2e.sha` (above) so E7's freshness gate can prove the recorded green matches HEAD. The only sanctioned partial re-verify is: re-run the specific failed/stale suite on the tip SHA and require it to pass on its own — anything else means re-running all suites.
- A scenario that fails-then-passes is a real failure: pull CloudWatch evidence from the failing window and run a confirmation pass — never dismiss as flake ([[feedback-flake-means-broken]]).
- Record the e2e evidence via the helper, pinning the SHA to the validated HEAD (the `sha` is what E7/F-14 checks for freshness):

  ```bash
  echo "{ \"commands\": [\"jest e2e\", \"playwright\"], \"outcome\": \"green\", \"sha\": \"$(git rev-parse HEAD)\" }" \
    | node .claude/skills/backlog-next-epic/runstate.mjs set-e2e <epic-id>
  ```

**On a hard (reproducible) e2e failure — DO NOT ship.** The batched gate has lost per-member fault isolation, so recover deliberately:
1. Route to `superpowers:systematic-debugging` to find the root cause (confirm it's not a flake first, per above).
2. **If the cause maps to an already-shipped member:** re-open it (`status: active`), fix on the epic branch, re-run that member's per-member integration tests, then **return to E6** and re-run the batched e2e.
3. **If it's a genuinely new gap** (not any member's regression): file it `queued` via `backlog-add` as a member of this epic (`epic: <id>`), then **loop back to E4** to work it. An e2e gap that blocks the epic is `queued`, never parking ([[feedback-e2e-gaps-queued-not-parking]]).
4. Only a **green** batched run lets you proceed to E7. Never ship on red.

### E7. Captured audit + epic ship

1. **Captured audit.** `lint.mjs` prints the active epic's open captured members. Re-test each against `done_when` (closure-predicate test). Promote any load-bearing one to `core` — then it must be resolved/dropped (it does NOT spin out), which sends you back to E4 for that member.
2. **Ship preconditions (BOTH required).** (a) Rule 9 — every core member terminal (`epic-members.mjs` exit 10); **and** (b) the E6 batched e2e is **green AND fresh**. Exit 10 alone is necessary but **NOT sufficient** — a drainable epic whose batched e2e is red or never ran must not ship. **Freshness (F-14):** the recorded `e2e.sha` must equal current `HEAD` — a re-opened member (E6 recovery) moves HEAD and invalidates the recorded green, forcing a return to E6:
   ```bash
   node .claude/skills/backlog-next-epic/runstate.mjs e2e-fresh <epic-id>   # exit 0 = fresh; exit 1 = stale → re-run E6
   ```
3. **Spin out genuinely-orthogonal captured members FIRST (manual — `lint --fix` does NOT do this).** `lint --fix` only regenerates the index; `ruleEpicClosure` merely *blocks* the ship if any captured member is still open. So before shipping: if any captured member remains open after the audit, create `docs/backlog/<id>-leftovers.md` (a `type: epic`, `status: parking` theme bucket) and repoint each such member's `epic:` pointer to `<id>-leftovers`. (Skip entirely if there are no open captured members.)
4. **Ship the epic.** Edit `docs/backlog/<id>.md` → `status: shipped`, fill `validation_gate:` with the batched-e2e evidence + branch SHA (for an E1 short-circuit with no deployable code, cite per-member evidence + the no-op note), **and stamp `closed: <today>`** (the authoritative Recently-Shipped date — immune to across-midnight drift; see `/backlog-next` 6.6, F-30). Commit on the branch.
5. `node .claude/skills/backlog-lint/lint.mjs --fix` — regenerates `docs/BACKLOG.md` + dossiers and confirms rule 9 now passes. Commit.

### E8. Single PR + cleanup + epic postflight

1. **Open the PR (the close ALWAYS stops here — `--auto` AND interactive).** Route to `superpowers:finishing-a-development-branch` taking the **PR route** (push + create PR). **Compose the PR body yourself:** `finishing`'s push step does not author a body, so render the run-state `decisions[]` to markdown + a per-member commit summary and set it (`gh pr create`/`gh pr edit --body-file`); if the log is empty, state "no decisions auto-resolved". **Expect `docs/backlog/` merge conflicts** — both `main` and the branch write under `docs/backlog/` (F-25). Two distinct kinds, resolved differently:
     - **`docs/BACKLOG.md`** (the auto-index, written on both sides) → **mechanical, never by hand**: take the branch side, then re-run `node .claude/skills/backlog-lint/lint.mjs --fix` on the rebased branch so the index regenerates from the merged frontmatter.
     - **The epic file `docs/backlog/<id>.md`** → `main` has `status: active` + `closed:`-less (from the E1 promotion marker); the branch has `status: shipped` + `closed:` + `validation_gate:` (from E7.4). **Take the branch side** — a wrong resolution that keeps `active` leaves the epic open and **rule-11-blocks the next epic**. Same for any member file edited on both sides: take the branch side (it carries the shipped frontmatter).
     - **Caveat: `lint --fix` repairs ONLY the index, never the per-file frontmatter.** It regenerates `BACKLOG.md` from whatever frontmatter the conflict resolution left — so if you resolve a `<id>.md` conflict wrong, lint will happily render a *consistent index of the wrong state*. Resolve the frontmatter conflicts first (branch side), THEN `lint --fix`.

     Push so the PR is mergeable.
   - **Then STOP via AskUserQuestion — the merge is the user's.** Surface a structured AskUserQuestion (NOT prose): the `(Recommended)` option is *"PR #N is up at `<link>` — I'll review & merge it on GitHub myself; the agent stops here"*; other options cover *"keep iterating / inspect first"*. **No option runs `gh pr merge`; the agent NEVER self-merges and never local-merges the epic branch** (F-33). A bare "go" is not authorization to do anything but stop.
   - On the stop-and-hand-off confirmation, **clean up the worktree only** — `git worktree remove --force` + `git worktree prune` — **keeping the local + remote branch** so the PR stays mergeable (NO `git branch -d`, NO remote-branch delete). **Print the GitHub PR link.** Set the run-state hand-off marker via the helper (`node .claude/skills/backlog-next-epic/runstate.mjs set-e8 <id> PR_OPEN_AWAITING_MERGE` — the only sanctioned `e8` value) and STOP. The branch deletion + `main` fast-forward happen in the **post-merge tail** (item 4), on a later resume that detects the PR merged.
2. **Worktree cleanup at the stop (branch KEPT).** From the main repo root (NOT `ExitWorktree` — see [[feedback-exitworktree-fails-cwd-pinned]]). This runs at the E8.1 stop, BEFORE the user merges, so it must NOT delete the branch or the run-state:

```bash
MAIN=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
git -C "$MAIN" worktree remove ".claude/worktrees/epic-<id>" --force
git -C "$MAIN" worktree prune
# Branch is KEPT (local + remote) so the PR stays mergeable. Run-state is KEPT as e8: PR_OPEN_AWAITING_MERGE.
```

3. **Hand off and STOP.** The run ends here with run-state `e8: PR_OPEN_AWAITING_MERGE`. Everything below (the post-merge tail) runs on a LATER `/backlog-next-epic <id>` resume.

4. **Post-merge tail (resume only — after the user merges the PR).** The Resume gate (top of Procedure) detects `e8: PR_OPEN_AWAITING_MERGE` + the PR merged (`gh pr view <n> --json state -q .state` → `MERGED`) and runs ONLY this tail (no re-promotion, no member loop):

```bash
MAIN=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
git -C "$MAIN" checkout main && git -C "$MAIN" pull --ff-only         # fast-forward main to the merged PR
git -C "$MAIN" merge-base --is-ancestor feat/epic-<id> main && git -C "$MAIN" branch -d feat/epic-<id>
git -C "$MAIN" worktree prune
(cd "$MAIN" && node .claude/skills/backlog-next/postflight.mjs --lane=complex --branch=feat/epic-<id> --id=<id>)   # epic-level checks 4–7 — run from $MAIN (a guaranteed-live cwd, never the removed worktree — F-23)
rm -f "$(node "$MAIN/.claude/skills/backlog-next-epic/runstate.mjs" path <id>)"   # drop run-state (same absolute path the helper writes)
```

   Then a boundary review of `docs/BACKLOG.md` **once** (re-rank LATER, promote, check Parking health) — not per member. (The tail's robustness — postflight surviving a removed cwd, conflict-scope — is hardened by `ship-and-merge-mechanics`; this is the working contract.)

### E9. Resumability

If interrupted, re-invoke `/backlog-next-epic <id>` (add `--auto` to resume unattended). The orchestrator reads run-state + `epic-members.mjs`, re-enters the worktree, and continues at the next open member. Same-epic, same-branch — no duplicate promotion or merge.

This same machinery is what makes the **E4.5 context checkpoint** safe: an inter-member `/clear` (or terminal restart) loses only conversation context, never epic state — resuming with `/backlog-next-epic <id> --auto` re-derives everything from disk. Long `--auto` runs over many members are expected to clear at member boundaries; treat a checkpoint clear as routine, not a failure.

## Common mistakes

- **Merging members individually.** The whole point is one branch / one PR per epic. Members commit to `feat/epic-<id>`; only E8 merges, once.
- **Running the expensive e2e per member.** It is hoisted to E6 (epic pre-done) — members run only their cheap mocked integration tests. Running Playwright per member burns AgentCore budget N×.
- **`--auto` auto-resolving a floor decision.** Real-money / prod / force-push / destructive / out-of-repo actions and genuinely-balanced forks ALWAYS pause, `--auto` or not. The decision log is review-after, not a license to act irreversibly unattended.
- **Misfiling required work as captured.** Captured members spin out at close — if one is load-bearing for `done_when`, the E7 audit must promote it to core (else the epic ships with its done-definition silently unmet).
- **Skipping the epic-start preflight or the epic postflight.** Both are hard gates (E0, E8.3). The per-member `--lane=epic-member` gates are lighter on purpose; the branch-scope checks live at the epic boundary.
- **Promoting a second delivery epic.** Rule 11 — one active epic. Resume the in-flight one or finish it first.
- **Trying to self-measure context to decide when to clear.** The agent has no programmatic read of its own context-window usage, so a "%-used" trigger is not implementable — don't pretend it is. Use the deterministic **E4.5 per-member boundary** + good-faith judgment of member heaviness instead, and when unsure, pause (a resume is cheap; mid-member context exhaustion is not). Letting `--auto` accumulate across many heavy members without a checkpoint clear is how a long epic run degrades.

## Related

`backlog-next` (the member worker this skill drives in epic-member mode), `backlog-lint`, `backlog-add`, `backlog-themes`, `superpowers:finishing-a-development-branch` / `systematic-debugging` / `brainstorming`. Supporting files: `epic-members.mjs`, `runstate.mjs` (the closed-schema run-state read-modify-write helper), `detect-fork-blast-radius.mjs` (+ their `test/*.test.mjs`). Design: `docs/superpowers/specs/2026-06-21-backlog-next-epic-orchestrator-design.md`.

**Run the tests** (use the **glob** form — `node --test <dir>` does not discover suites on Node 24):

```bash
node --test .claude/skills/backlog-next-epic/test/*.test.mjs
```
