---
name: backlog-next-epic
description: Epic orchestrator — runs a whole delivery epic as ONE branch / ONE PR. Promotes the epic, loops its core members through /backlog-next in epic-member mode, batches the expensive e2e at epic pre-done, runs the captured audit, and ships via a single PR. Optional --auto mode auto-resolves decisions (logging each, with a hard floor) for fire-and-forget.
disable-model-invocation: true
---

## When to invoke

User-triggered via `/backlog-next-epic [<epic-id>] [--auto]` only. `disable-model-invocation: true` blocks auto-invocation.

- `<epic-id>` — a `type: epic` backlog file. Without it, list the candidate epics (active delivery epic first, then `queued`, then parking theme epics with open-core-member counts) and ask which to run.
- `--auto` — fire-and-forget: auto-resolve decisions and log each for PR review, pausing only on the hard floor (see § E5). Without it, the orchestrator pauses at every architectural fork.

This skill owns the **epic lifecycle**. It does NOT execute member work directly — it **dispatches each member as a context-isolated `epic-member-worker` subagent** (Tier-2) that runs `/backlog-next` in **epic-member mode** (one member at a time, inside one shared worktree), and communicates with it by `SendMessage`. For a single non-epic workstream, use `/backlog-next` directly.

## Relationship to `/backlog-next`

| Concern | Owner |
|---------|-------|
| Pick/execute one member workstream (lane, spec→plan→code, per-member integration tests, doc-derivation, member ship) | `epic-member-worker` subagent → `/backlog-next` (epic-member mode) |
| Promote the epic, rule-11 guard, member ordering, the single worktree/branch | **this skill** |
| Batched expensive e2e (Jest e2e + Playwright) at epic pre-done | **this skill** |
| Captured audit, epic ship, single PR + cleanup, epic-level postflight | **this skill** |
| `--auto` decision policy + decision log + hard floor | **this skill** |

Member ordering is the tested helper `epic-members.mjs` (the deterministic pick that used to be inline bash in `/backlog-next` Step 1a).

## Procedure

### Resume gate (check FIRST, before E0)

`/backlog-next-epic <id>` is **resumable and idempotent**. **First acquire the §G concurrency lock** (atomic `wx` create at `<git-common-dir>/backlog-next-epic-<id>.lock`; a loser that finds a live lock refuses-and-asks — see §G). Then read the run-state via the helper (never `cat`/parse the raw file — the helper resolves the cwd-independent absolute path and self-heals a malformed file into a clean error, F-11/F-13):

```bash
node .claude/skills/backlog-next-epic/runstate.mjs get <id>   # prints the JSON, or "FRESH" (exit 3) if absent, or a clean error (exit 2) if corrupt
```

Branch on the result:

- **Exists → this is a RESUME.** The epic is already promoted and the branch already exists. **Skip E0, E1 (promotion) and E3 (init).** Run E2 in its idempotent form (it no-ops / re-attaches the worktree if the branch exists but the worktree was pruned), re-enter the worktree as cwd, read (do not overwrite) the run-state, and **jump straight to E4** — the member loop re-derives the next open member from `epic-members.mjs`, so a half-finished run continues correctly (a member left `status: active` resumes in epic-member mode).
  - **Run-state `e8: PR_OPEN_AWAITING_MERGE` → the PR is already open, awaiting the USER's merge** (do NOT re-enter the member loop). Check the PR state (`gh pr view <n> --json state -q .state`): **`MERGED`** → run **only** the E8.4 post-merge tail (ff `main`, delete the merged branch, epic postflight, drop run-state) and finish; **still `OPEN`** → re-print the PR link and STOP — the merge remains the user's (never `gh pr merge`).
- **Absent → fresh run.** Proceed E0 → E1 → E2 → E3 → E4 normally.

A resume never re-promotes the epic, never re-creates the branch, and never overwrites the accumulated decision log / e2e evidence in run-state.

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

Repeat until `epic-members.mjs` reports drainable (exit 10). **Each member runs as a context-isolated `epic-member-worker` subagent** (Tier-2) — the orchestrator's context grows only by the member's compact `SendMessage` payloads + the decision log, **never** by its file reads / test logs / debug loops. (If the §Risk spike had selected `TIER1-FALLBACK`, members would run inline and the E4.5 `/clear` fallback would be live; on `TIER2-GO` it is dormant.)

1. **Pick** the next core member from `epic-members.mjs` (`next=<member-id>`).
2. **Dispatch the member as a subagent — NOT an inline Skill-tool load.** Spawn it as a **named background teammate** (needs `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`):

   ```
   Agent({ subagent_type: "epic-member-worker", name: "member-<id>",
           prompt: <member-id; branch feat/epic-<id>; the worktree ABSOLUTE path; the --auto flag;
                    and ONLY the member's pre-decided (fork_key, chosen) pairs> })
   ```

   The worker `cd`s into the shared worktree, invokes `/backlog-next <member-id>` in epic-member mode there, does ALL heavy work (investigation, edits, per-member integration, doc-derivation) in **its own** context, and reaches you **only by `SendMessage` to `main`** — its plain turn output is invisible to you (spike-confirmed; a returned "final message" is NOT the channel). After dispatching, **YIELD**: do no other work, and in particular **touch nothing in the worktree / `.git/index` while the member is live** (§G concurrency-by-discipline). Pass only the *minimal* `(fork_key, chosen)` pairs already ruled for this member — never the whole decision log.
3. **Parse + branch on each payload the worker `SendMessage`s.** Write the received message text to a temp file and run `node .claude/skills/backlog-next-epic/member-summary.mjs parse <file>`; branch on its exit code:
   - **`0` — `needs-decision`** → resolve per **E5**; **persist the ruling at resolution time** (`append-decision`, with `fork_key`) BEFORE replying; then `SendMessage("member-<id>", <ruling>)` and yield for the next payload.
   - **`1` — `member-summary` / `shipped`** → emit a one-line progress note (lane + key files/services + auto-resolved decisions); `shutdown_request` the teammate; **then** (ordering invariant) consult `epic-members.mjs` for the next member.
   - **`2` — `member-summary` / `blocked`** → route per **§H** (AskUserQuestion: `abort-epic` / `file-follow-up-and-skip` / `split-and-retry`); `shutdown_request` the teammate.
   - **`3` — parse-failure** → `SendMessage` a repair request; on the **2nd consecutive** exit-3 the worker cannot even re-emit a clean payload → treat as **context-exhausted / too-large** and route to `split-and-retry` (§H), NOT a generic floor.

   **Two SEPARATE loop bounds:** (a) **repair counter** — ≤2 *consecutive* exit-3 parse-failures (any valid payload resets it); (b) **progress guard** — floor only on **non-progress** (a *repeated identical* `fork_key`, or consecutive parse-failures), **NEVER** on legitimate *distinct* interactive forks (a complex member may bubble many distinct forks — that is fine, §I; do not force-floor it). **Floor-pause / cap option set:** `retry-member-fresh` / `split-member` / `abort-epic`.

   **Drainable ordering invariant:** do NOT consult `epic-members.mjs` for a member until its summary is parsed — a member commits `status: shipped` mid-turn, so advancing before the summary would skip its progress note.
4. **Per-member gate (run INSIDE the worker; orchestrator confirms via the summary).** The worker runs the member's **integration tests + doc-derivation** in epic-member mode and reports the outcome in `validation_gate`. A failure the worker cannot resolve within its internal **bounded debug budget (≤3 debug→re-run cycles, E4.3-of-the-worker, F-9)** surfaces as a `needs-decision` `reason: bounded-effort-exceeded` (exit 0 → floor per E5) or `status: blocked` (exit 2 → §H) — never a silent advance. Advance only on `status: shipped` with a green gate.
   - **Cumulative branch typecheck on shared-surface touches (F-21) — between members.** After a member ships, if it touched a **shared contract / event / shared-lib export** (e.g. `quantity → amountCents`; detect with `node .claude/skills/backlog-next-epic/detect-fork-blast-radius.mjs <symbol>` — exit 1 = shared hit), run a **cheap cumulative typecheck across the whole branch diff between members** (a between-members build op is permitted under §G — the worker is terminal, nothing is live), before dispatching the next: `pnpm nx run-many -t typecheck -p "$(node tools/affected-projects.mjs --base=origin/main --with-target=typecheck | paste -sd, -)"`. A break re-opens the member (re-dispatch decision-aware). _Caveat: the two e2e apps have no `typecheck` target yet, so a contract break in e2e specs still slips to E6 — tracked separately (out of this epic's skill-workflow scope)._
5. **Record.** The member's own ship (frontmatter `status: shipped`, committed on the branch) IS the state — the next loop re-derives progress from `epic-members.mjs`. The **durable** decision record is **run-state**, written at resolution time by whoever resolved the fork (the **orchestrator** for floor/override; the **subagent itself** for `--auto` non-floor — it is in the worktree and calls `append-decision`); the summary's `decisions[]` is informational (it feeds the progress note, not the durable log).
6. **Loop.** Re-pick from `epic-members.mjs` and continue — the handoff is the worker's terminal summary (exit 1/2); there is **no callable "next" seam beyond re-running step 1**, by design (the loop is self-correcting: a member left `active` resumes; a just-shipped member drops out; a split member is picked up).

### E4.5 — Tier-1 `/clear` fallback (DORMANT on `TIER2-GO`)

> **This block is fallback-mode documentation, NOT the Tier-2 happy path.** On `TIER2-GO` (the §Risk spike's selected mode, 2026-06-23), member execution is isolated inside the subagent (E4.2), so the orchestrator's context no longer grows per member — there is **no per-member `/clear` and no per-member checkpoint pause.** Between members, emit only the compact one-line progress note (E4 step 3, exit 1).
>
> **Tier-1 fallback mode** — used ONLY if the §Risk spike had selected `TIER1-FALLBACK` (subagent dispatch unavailable). In that mode: after each member ships **and** its `--lane=epic-member` postflight passes, emit a STABLE CHECKPOINT block and, in `--auto`, UNCONDITIONALLY recommend the user `/clear` (or restart the terminal) then resume with `/backlog-next-epic <id> --auto` — at every member boundary, and also before the E4→E6 transition. The honest constraint that motivated Tier-1 still holds (the agent cannot read its own context-window size, so a "%-used" trigger is not implementable; the per-member boundary was its deterministic, provably-safe proxy — all epic state is on disk). This fallback block is **retained until 3 successful Tier-2 epics**, then removed by the `remove-tier1-fallback` backlog follow-up.

### E5. Decision handling (default vs `--auto`)

A **decision** is an architectural/design fork. Test/build failures are NOT decisions (a failed gate the worker cannot resolve surfaces as `bounded-effort-exceeded`/`blocked` — E4.4/§H). Decisions reach the orchestrator as **`needs-decision` payloads the member subagent `SendMessage`s** (exit 0) — the orchestrator no longer races to intercept a prompt buried in an inline sub-skill; the worker, having **no `AskUserQuestion` tool**, bubbles up every fork it cannot self-resolve.

The canonical decision-log entry shape (now carrying `fork_key`, **required**) is:
`{ member, fork_key, decision, options, chosen, rationale (the reuse rationale), rejected }`. Append it **via the helper** — it validates (rejects a missing `fork_key`/`member`), dedups a non-superseding `(member, fork_key)` collision, and does the atomic parse → mutate → stringify into the single `decisions[]` (F-12):

```bash
echo '{ "member": "<id>", "fork_key": "<k>", "decision": "...", "options": ["..."], "chosen": "...", "rationale": "...", "rejected": "..." }' \
  | node .claude/skills/backlog-next-epic/runstate.mjs append-decision <epic-id>
```

The log is **append-only-with-supersede**: never edit/delete a prior entry — a reversal/override is a NEW entry carrying `supersedes: <prior-index>` (EXEMPT from dedup; it intentionally re-uses the superseded `fork_key`), so the original (possibly wrong) call stays visible in the PR-review trail (F-6).

**Who resolves + persists which fork:**
- **Default mode (no `--auto`):** EVERY fork bubbles up. For each `needs-decision` payload: validate the payload's `(Recommended)` marking + `reason` (they come from a subagent — don't render them blindly), surface via **AskUserQuestion** (mark the recommended option per the project rule), take the user's choice, **`append-decision` the ruling at resolution time**, then `SendMessage("member-<id>", <ruling>)`. A complex member may bubble many *distinct* forks — that is expected (§I), never a loop to floor.
- **`--auto` mode** — explicit per-source handling:
  1. **`type: design` members → ALWAYS bubble + PAUSE.** A design slice routes to `superpowers:brainstorming`, whose hard approval gate requires explicit user sign-off on *every* design. The worker carries the `deliberation` (brainstorming summary + option reasoning, §I) in its `needs-decision` so the design is approved with its context. `--auto` does **not** self-approve it. Pause (AskUserQuestion), persist, `SendMessage`, resume.
  2. **`finishing-a-development-branch` menu (E8) → governed by E8's merge-ownership rule.** The epic close takes the **PR route** and STOPS at an open PR for the user to merge; `--auto` **never** runs `gh pr merge` or local-merges the epic branch (E8). (Per-member finishing menus don't arise — the worker stops before them.)
  3. **`--auto` non-floor forks NEVER reach the orchestrator.** The subagent classifies each (blast-radius gate `detect-fork-blast-radius.mjs`: exit 1 = shared surface = floor = bubble up; exit 0 = local), self-resolves the genuinely-non-floor ones by selecting the project-`(Recommended)` (most reusable/generalizable) option, **and self-persists each to run-state at resolution time** (it is in the worktree). They appear (informational) in the summary's `decisions[]`. The orchestrator only ever sees a `--auto` fork the worker escalated to the floor.
  4. **Catch-all → floor (PAUSE).** Anything the worker is unsure about it bubbles as `reason: catch-all` — the orchestrator pauses (AskUserQuestion). Conservative by design.

  **Hard floor — pause even in `--auto`** (the floor is the safety gate, NOT a context-management interruption like Tier-1's clear; it stays):
  - **Irreversible / outward-facing actions** — staging/prod-account ops, real-money/broker actions, `git push --force`, `git reset --hard` on shared branches, `git branch -D`, destructive deletes, mutations outside `dev-*` naming, anything outside this repo.
  - **Scope-boundary fork (decidable test)** — pause ONLY when the fork (a) changes the epic's `out_of_scope:` boundary, (b) alters a contract / event / interface / shared-lib export consumed by a not-yet-worked core member (i.e. `detect-fork-blast-radius.mjs` exits 1 for it), or (c) forces rework of an already-shipped member. A genuinely balanced fork where reusability does not break the tie also still pauses. (This replaces the old over-broad "large downstream blast radius" clause that swallowed every fork — F-5.)
  - **Bounded-effort exceeded** — a member's internal `--auto` debug budget (≤3 cycles) is spent (surfaces as `reason: bounded-effort-exceeded`).

  **Floor enforcement — the honest model (prompting is NOT a backstop).** `settings.local.json` carries a large `permissions.allow` list, and the spike confirmed a dispatched subagent runs destructive Bash **unprompted** — so the harness's default prompting is NOT a reliable mechanical floor gate. The floor's REAL gates are: (1) the tested **`detect-fork-blast-radius.mjs`** for scope-boundary forks; (2) the worker's explicit **irreversible-action checklist**, matched BEFORE acting (it bubbles up, never attempts); (3) **`AskUserQuestion`-exclusion** from the worker's allowlist (it cannot self-approve a pause) — spike-confirmed enforced. A `permissions.deny` / `PreToolUse` deny-hook for the irreversible set is the TRUE mechanical gate for **unattended** runs — a follow-up, not built here; attended dev `--auto` is acceptable because a human is present for floor pauses.

  When the floor fires, the surface MUST be an **AskUserQuestion** widget with a `(Recommended)` option — a free-text "this is your call" prose pause is a **skill violation** (it is what let an ambiguous "go" collapse into a self-merge — F-7/F-33). Record the outcome (append-only), `SendMessage` the ruling. The decision log is the **asynchronous-review surface** that replaces synchronous approval — it lands in the PR body (E8).

### E6. Epic pre-done — consistency audit (advisory) + batched expensive e2e (the new gate)

Once `epic-members.mjs` reports drainable, run the pre-done checks in order:

**E6.0 — Cross-member consistency audit (advisory, SUMMARY-ONLY).** The orchestrator is the only actor holding the cumulative decision log, so it runs a HEURISTIC pre-done consistency pass over the members' *summaries* — a scoped helper/grep that surfaces **new exported symbols per member + duplication flags** (NEVER pull the raw branch diff into the orchestrator's context — that would defeat Tier-2 isolation). This is an explicit model-judgment heuristic, **not** a tested detector: its failure mode is "may miss an inconsistency" (acceptable; additive — it never blocks an otherwise-clean epic). On a flagged inconsistency, **re-opening a member is user-confirmed in BOTH modes** (AskUserQuestion; in `--auto`, re-opening a shipped member is a floor action). The override path: `append-decision` a `supersedes` entry carrying the NEW imposed value → flip the member `status: active` → re-dispatch it **decision-aware** (the worker ADOPTS the imposed `chosen` via its pre-decided `(fork_key, chosen)` pairs, E4.2) → HEAD moves → `e2e-fresh` is invalidated → return here and re-run the batched gate.

**E6.1 — Deploy + batched e2e.** Validate the **cumulative** branch state as a unit:

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

1. **Open the PR (the close ALWAYS stops here — `--auto` AND interactive).** Route to `superpowers:finishing-a-development-branch` taking the **PR route** (push + create PR). **Compose the PR body yourself** from the two DURABLE sources (so E8 composes correctly even on a fresh-session resume) and set it (`gh pr create`/`gh pr edit --body-file`): (1) a **per-member commit summary** = `git log origin/main..HEAD` grouped by the **`[<member-id>]` commit-subject prefix** the worker stamps on every commit (§J); (2) a **decision section** = the run-state `decisions[]` (each entry's member / decision / chosen / reuse-rationale; flag `supersedes` overrides). If the log is empty, state "no decisions auto-resolved". **Expect `docs/backlog/` merge conflicts** — both `main` and the branch write under `docs/backlog/` (F-25). Two distinct kinds, resolved differently:
     - **`docs/BACKLOG.md`** (the auto-index, written on both sides) → **mechanical, never by hand**: take the branch side, then re-run `node .claude/skills/backlog-lint/lint.mjs --fix` on the rebased branch so the index regenerates from the merged frontmatter.
     - **The epic file `docs/backlog/<id>.md`** → `main` has `status: active` + `closed:`-less (from the E1 promotion marker); the branch has `status: shipped` + `closed:` + `validation_gate:` (from E7.4). **Take the branch side** — a wrong resolution that keeps `active` leaves the epic open and **rule-11-blocks the next epic**. Same for any member file edited on both sides: take the branch side (it carries the shipped frontmatter).
     - **Caveat: `lint --fix` repairs ONLY the index, never the per-file frontmatter.** It regenerates `BACKLOG.md` from whatever frontmatter the conflict resolution left — so if you resolve a `<id>.md` conflict wrong, lint will happily render a *consistent index of the wrong state*. Resolve the frontmatter conflicts first (branch side), THEN `lint --fix`.

     Push so the PR is mergeable.
   - **Then STOP via AskUserQuestion — the merge is the user's.** Surface a structured AskUserQuestion (NOT prose): the `(Recommended)` option is *"PR #N is up at `<link>` — I'll review & merge it on GitHub myself; the agent stops here"*; other options cover *"keep iterating / inspect first"*. **No option runs `gh pr merge`; the agent NEVER self-merges and never local-merges the epic branch** (F-33). A bare "go" is not authorization to do anything but stop.
   - **On the stop-and-hand-off confirmation (the hand-off branch):** **clean up the worktree only** — `git worktree remove --force` + `git worktree prune` — **keeping the local + remote branch** so the PR stays mergeable (NO `git branch -d`, NO remote-branch delete). **Print the GitHub PR link.** Set the run-state hand-off marker via the helper (`node .claude/skills/backlog-next-epic/runstate.mjs set-e8 <id> PR_OPEN_AWAITING_MERGE` — the only sanctioned `e8` value), **release the §G lock**, and STOP. The branch deletion + `main` fast-forward happen in the **post-merge tail** (item 4), on a later resume that detects the PR merged.
   - **"Keep iterating" is a DISTINCT branch (§J), NOT the hand-off.** If the user picks it, do NOT run the worktree-removal above, do NOT `set-e8`, and do NOT release the lock for hand-off: leave the worktree attached, keep the lock held, and re-enter **E4** (e.g. another member, or a pre-PR fix). `clear-e8` + worktree re-attach are needed only on the post-merge tail or a crashed-resume (§G/§J), never here.
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

   Then a boundary review of `docs/BACKLOG.md` **once** (re-rank LATER, promote, check Parking health) — not per member. (The tail's robustness — postflight surviving a removed cwd, conflict-scope — is hardened by `ship-and-merge-mechanics`; this is the working contract.) **`clear-e8`** (`runstate.mjs clear-e8 <id>`) is used only on a crashed-resume that decides to keep iterating after `e8` was set; the normal post-merge tail drops the whole run-state file anyway.

### §G. Concurrency lock — one orchestrator per epic (atomic `wx`, no heartbeat)

Two `/backlog-next-epic <id>` sessions on the same epic would double-dispatch members and corrupt the branch. A heartbeat lock is unworkable (the orchestrator **yields** while a member teammate is live — concurrency-by-discipline below — with no natural tick to refresh it), so the lock is **heartbeat-free**:

- **Atomic acquire (resume gate, FIRST action).** Create `<git-common-dir>/backlog-next-epic-<id>.lock` with an exclusive create — `writeFileSync(path, JSON.stringify({session, pid, start}), {flag:'wx'})` — recording `{session-id, pid, start-ts}`. The `wx` flag fails if the file already exists (atomic; no TOCTOU window). The winner owns the run.
- **Loser → refuse-and-ask (NO auto-reclaim on a staleness timer).** A session that finds an existing lock checks the recorded `pid`: **provably dead** → offer a user-confirmed reclaim (overwrite the lock); **alive or unknown** → refuse-and-ask (resume-vs-abort) — never silently steal it. (No timer-based reclaim — that reintroduces the TOCTOU race.)
- **Lifecycle vs E8.** **Release** the lock at the **E8.1 hand-off STOP** (the run genuinely yields to the user's unbounded merge window) and on any clean exit; **re-acquire** atomically on a later resume, the post-merge tail, or a crashed-resume / keep-iterating re-entry. The lock is **NOT** held across the human-merge window. A crash leaves a stale lock → the next resume's pid-liveness check handles it.
- **Intra-session: concurrency by DISCIPLINE (spike-corrected).** The member teammate runs **concurrently** with the orchestrator (the spike disproved the rev3 "synchronous / blocks" assumption). Safety is therefore a discipline rule, NOT "by construction": dispatch **ONE** member at a time, **yield** while it is live, and **never run worktree / `.git/index` ops during a live member turn** — the orchestrator's own git/build ops (the E4.4 cumulative typecheck, the E6.0 audit, the E6.1 deploy) run **only between members**, after a terminal summary. The spike confirmed a worker's mid-turn commit is durably visible the instant control returns.

### §H. Blocked-member routing + inferred-too-large

A member that ends `status: blocked` (exit 2) needs an epic-level disposition, NOT a prose halt — surface via **AskUserQuestion**: `abort-epic` / `file-follow-up-and-skip` (file a `queued` follow-up via `backlog-add`, `epic: <id>`, then advance) / `split-and-retry` (the member is mis-scoped/too-large — split it, then re-enter E4). **Context-exhaustion is INFERRED, not self-reported:** an exhausted subagent may be unable to emit a clean `blocked` payload, so a member that exit-3's AND still exit-3's after the ≤2 repair turns (cannot even re-emit a payload) is treated as **context-exhausted / too-large** → routed to `split-and-retry`, NOT a generic floor (splitting a too-large member is exactly backlog discipline — members must be context-sized).

### §I. Interactive-mode observability (the acknowledged cost)

Both modes isolate members, so a watching non-`--auto` user no longer sees a member's work scroll by live. Mitigations: (a) a `design-approval` `needs-decision` MUST carry `deliberation` (the brainstorming summary + the reasoning behind each option) so the user approves a design *with* its context; (b) the per-member progress note names the lane + key files/services + auto-resolved decisions. Acknowledged trade-off: reduced live visibility / mid-member interjection vs the old inline model — a user who wants full interactive drive uses standalone `/backlog-next`.

### §J. Per-member attribution + `e8` lifecycle

Durable per-member attribution: the worker **prefixes every commit subject with `[<member-id>]`**, so E8 groups `git log origin/main..HEAD` by it for the PR-body per-member summary (durable → composes on a fresh-session resume). The `e8: PR_OPEN_AWAITING_MERGE` marker is set ONLY on the E8.1 hand-off branch (never on keep-iterating); `clear-e8` + worktree re-attach are needed only on the post-merge tail or a crashed-resume. See E8 + §G.

### E9. Resumability

If interrupted, re-invoke `/backlog-next-epic <id>` (add `--auto` to resume unattended). The orchestrator re-acquires the §G lock, reads run-state + `epic-members.mjs`, re-enters the worktree, and continues at the next open member. Same-epic, same-branch — no duplicate promotion or merge.

Crash-resumability rests on **all epic state living on disk** (run-state JSON + member frontmatter + the on-branch commits + persisted `decisions[]`): a session death or interrupt loses only conversation context, never epic progress — and a decision persisted at resolution time (E4.3/E5) is not re-asked, because a re-dispatched member receives its `(fork_key, chosen)` pairs as pre-decided. **On `TIER2-GO` there is no routine per-member `/clear`** — the subagent isolates each member's context, so the orchestrator's window stays bounded across a long `--auto` run. (The per-member `/clear` survives only as the dormant E4.5 Tier-1 fallback.)

## Common mistakes

- **Merging members individually.** The whole point is one branch / one PR per epic. Members commit to `feat/epic-<id>`; only E8 merges, once.
- **Running the expensive e2e per member.** It is hoisted to E6 (epic pre-done) — members run only their cheap mocked integration tests. Running Playwright per member burns AgentCore budget N×.
- **`--auto` auto-resolving a floor decision.** Real-money / prod / force-push / destructive / out-of-repo actions and genuinely-balanced forks ALWAYS pause, `--auto` or not. The decision log is review-after, not a license to act irreversibly unattended.
- **Misfiling required work as captured.** Captured members spin out at close — if one is load-bearing for `done_when`, the E7 audit must promote it to core (else the epic ships with its done-definition silently unmet).
- **Skipping the epic-start preflight or the epic postflight.** Both are hard gates (E0, E8.3). The per-member `--lane=epic-member` gates are lighter on purpose; the branch-scope checks live at the epic boundary.
- **Promoting a second delivery epic.** Rule 11 — one active epic. Resume the in-flight one or finish it first.
- **Force-flooring a legitimately multi-fork interactive member.** In default (non-`--auto`) mode every fork bubbles, so a complex member may surface many *distinct* `needs-decision` payloads — that is expected (§I). The progress guard floors only on **non-progress** (a *repeated identical* `fork_key`, or consecutive parse-failures), NEVER on distinct forks.
- **Relying on permission-prompting as the floor gate.** The spike proved a dispatched subagent runs destructive Bash unprompted, and `settings.local.json`'s allow-list defeats prompting anyway. The floor's real gates are the blast-radius helper + the worker's irreversible-action checklist + `AskUserQuestion`-exclusion (E5); the deny-hook is a follow-up for unattended runs.
- **Touching the worktree while a member teammate is live.** The worker runs **concurrently** (§G). Run the orchestrator's own git/build ops (E4.4 typecheck, E6.0 audit, E6.1 deploy) ONLY between members, after a terminal summary — never during a live member turn.
- **Treating the worker's turn output as the channel.** A named teammate's plain output is invisible to the orchestrator — only its `SendMessage` payloads arrive. If you "got nothing back," you are waiting on a `SendMessage`, not reading a returned final message.
- **Trying to self-measure context to decide when to clear (Tier-1 fallback only).** The agent has no programmatic read of its own context-window usage, so a "%-used" trigger is not implementable. This mattered for the **E4.5 Tier-1 fallback** (per-member `/clear`); on `TIER2-GO` the subagent isolates each member, so there is no per-member clear to time and this concern is dormant.

## Related

`backlog-next` (the member worker this skill dispatches as an `epic-member-worker` subagent in epic-member mode), `backlog-lint`, `backlog-add`, `backlog-themes`, `superpowers:finishing-a-development-branch` / `systematic-debugging` / `brainstorming`. Supporting files: `epic-members.mjs`, `runstate.mjs` (the closed-schema run-state read-modify-write helper), `detect-fork-blast-radius.mjs`, `fork-key.mjs` (deterministic fork identity), `member-summary.mjs` (subagent-payload parser/validator, exit 0/1/2/3) (+ their `test/*.test.mjs`), and the `.claude/agents/epic-member-worker.md` custom agent type. Design: `docs/superpowers/specs/2026-06-21-backlog-next-epic-orchestrator-design.md` + the Tier-2 subagent-isolation design `docs/superpowers/specs/2026-06-23-backlog-next-epic-member-subagent-isolation-design.md`.

**Run the tests** (use the **glob** form — `node --test <dir>` does not discover suites on Node 24):

```bash
node --test .claude/skills/backlog-next-epic/test/*.test.mjs
```
