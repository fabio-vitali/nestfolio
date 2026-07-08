---
name: backlog-next
description: Workstream router for starting the next backlog item. Picks from docs/BACKLOG.md, classifies complexity (doc-layer / simple / complex), enforces preflight/postflight gates, and routes the closing phase to deploy + true-affected-resolver validation + finishing-a-development-branch. Optional --auto mode auto-resolves decisions unattended (logging each into the workstream file's Decision log, with the same hard floor as the epic orchestrator).
---

## When to invoke

Two sanctioned entry points: a user typing `/backlog-next` (standalone), **or** the `/backlog-next-epic` orchestrator driving this skill in epic-member mode. This skill is deliberately **NOT** `disable-model-invocation` (unlike `/backlog-next-epic`) — that key was removed on purpose so the orchestrator can invoke it via the Skill tool, which loads this SKILL.md **inline into the orchestrator's own context** (not a detached subagent; that inline-execution model is what the seam, the E4.5 checkpoint, and the parked Tier-2 subagent-isolation item all reason about). Outside those two paths, do not auto-fire it: the Step-1 active-in-flight guard + the epic-member guard below are the runtime backstops against a stray invocation.

Accepts an optional `<id>` argument (`/backlog-next <id>`) that overrides the deterministic rank pick in Step 1. Without an argument, the default rule applies (resume single ACTIVE, else top-ranked QUEUED). The argument does NOT bypass any status rules — see Step 1 for the per-status dispatch.

Also accepts `--auto` (`/backlog-next [<id>] --auto`) — fire-and-forget for ONE standalone
workstream: auto-resolve decisions per § "Standalone `--auto` mode" and log each into the
workstream file's `## Decision log`, pausing only on the hard floor. Without it, pause at every
architectural fork as usual. (In epic-member mode `--auto` is not read from the prompt — the
orchestrator's run-state carries it and E5 governs the policy; this skill's § floor still applies.)

**This skill works one member/standalone workstream — it does NOT orchestrate epics.** If `<id>` is a `type: epic`, stop and tell the user: *"epics are orchestrated by `/backlog-next-epic` — run `/backlog-next-epic <id>`."* Do not promote the epic or pick a member here. (Epic lifecycle — promote, member loop, batched e2e, single-PR close, `--auto` — lives in `/backlog-next-epic`; see [[backlog-next-epic]].)

If `/backlog-next` fires while an ACTIVE workstream is already in flight, report that state and ask whether to resume or switch — do NOT silently start a second workstream. Side-findings mid-execution go through `backlog-add`, never this skill.
In `--auto`: RESUMING the single active workstream is deterministic — proceed with it (log the
resume as a decision entry). But a named `<id>` that CONFLICTS with a different in-flight active
item is a genuine fork — pause via AskUserQuestion even in `--auto`.

**Epic-member mode (invoked by `/backlog-next-epic`).** When the orchestrator drives this skill, it passes a member `<id>` **plus an epic-member context signal** (the active epic + its worktree/branch). In that mode the worker runs the member *inside the already-active epic worktree* and hoists branch-level concerns to the epic. See § "Epic-member mode" below for the per-step deltas.

## Procedure

### 0. Preflight (enforced)

```bash
node .claude/skills/backlog-next/preflight.mjs
```

Hard-fails if: working tree is dirty, local `main` is ahead of `origin/main`, `backlog-lint` violates a rule, or stale worktrees exist. **Do not bypass.** Fix the surfaced state first — that mess is exactly what would otherwise contaminate the new workstream. See [[feedback-worktree-first-no-commits-on-main]].

### 1. Pick the item

**Default (no argument).** Read `docs/BACKLOG.md` and pick in this order:

1. A **non-epic** item with `status: active` → resume it (the standalone workstream). _(An in-flight epic member is also a non-epic active file, but you do NOT resume it via a bare `/backlog-next` — epic members are resumed by re-invoking `/backlog-next-epic <epic-id>`, which drives this worker in epic-member mode. See the epic-member guard below.)_
2. Else the **top-ranked QUEUED item** (lowest `rank`). Read `docs/backlog/<id>.md`. **Redirect to `/backlog-next-epic` and stop if** it is `type: epic` (run `/backlog-next-epic <id>`), **or** it carries an `epic:` pointer whose target epic is `status: active` (run `/backlog-next-epic <epic-id>` — it's a member of the in-flight delivery epic; working it standalone here would break the one-branch/one-PR invariant). Otherwise proceed by status.

> **Epic-member guard.** A queued/active member of an *active* epic is a non-epic file, so the `type: epic` redirect alone won't catch it. Whenever a picked item (default rank-pick OR named `<id>`) has an `epic:` pointer to a `status: active` epic, **redirect to `/backlog-next-epic <epic-id>` and stop** — do not work it standalone. **Exception:** when *this* skill is invoked BY `/backlog-next-epic` in epic-member mode (the orchestrator passes the epic context), proceed with the member — that IS the intended path; the guard fires only for bare standalone `/backlog-next` calls.
3. Else **nothing is active and QUEUED is empty** → do NOT auto-promote (promotion is a manual boundary-review call — see Common mistakes). Report that QUEUED is empty and stop for the user to choose: either promote an item into QUEUED first, or — to work an epic — launch it with `/backlog-next-epic` (which lists the available delivery/theme epics).

**`--auto` pick rule.** The default pick order above is deterministic (resume the single ACTIVE,
else lowest `rank` — a hand-set, rule-6-unique prior user decision), so `--auto` LAUNCHES it
without a confirm and records the pick as the first decision entry (options = the top of QUEUED).
This deliberately differs from the epic orchestrator, whose selection is a COMPUTED ordering
(severity rubric / `--like` semantics) and therefore always confirms even in `--auto`. The
per-status rules are unaffected: `parking` still refuses, `shipped`/`dropped` still warns and asks
(a refusal/warning is a stop, not a decision `--auto` may take), not-found still stops.

**With `<id>` argument (`/backlog-next <id>`).** The argument overrides the rank pick. Locate `docs/backlog/<id>.md`. **Redirect to `/backlog-next-epic` and stop if** it is `type: epic` (run `/backlog-next-epic <id>`) **or** it has an `epic:` pointer to a `status: active` epic (run `/backlog-next-epic <epic-id>` — per the epic-member guard above; not worked standalone). Otherwise dispatch by status:

| Status | Action |
|---|---|
| `queued` | Proceed with this item regardless of `rank`. Rank stays as-is. |
| `active` | Fall back to the ACTIVE-in-flight guidance in "When to invoke" — report state, ask resume vs switch. |
| `parking` | **Refuse.** Rule 8: parking entries carry unmet trigger language. Tell the user to remove the trigger sentence, document why it fired, then promote via `backlog-add` (or hand-edit to `status: queued` with a `rank`) and re-run `/backlog-next <id>`. Do NOT silently promote. |
| `shipped` or `dropped` | Almost always a typo. Warn loudly with the file's `validation_gate:` (shipped) or drop reason, and ask for confirmation before doing anything. |
| not found | Warn, list close matches from `ls docs/backlog/` (use the closest filename stems), and ask for clarification. Do NOT fall back to the default rank pick. |

Then proceed to Step 2.

### 2. Verify references

`backlog-lint` confirms paths/anchors exist but not that cited sections still *mean* what the file claims. Re-read each `references:` target. If any is stale, fix the doc layer first. See [[feedback-verify-before-documenting]].

### 3. Classify complexity

| Lane | Triggers | Where to work |
|------|----------|---------------|
| **Doc-layer** | Only touches `docs/backlog/`, `MEMORY.md`, `BACKLOG.md`. | `main`. See [[feedback-docs-backlog-commits-go-to-main]]. |
| **Simple** | Single service or single MFE, no large blast radius. Multi-file/multi-line is fine. **Disqualifiers:** requires deploy + e2e validation gate, OR changes a public interface (event contract, CDK construct API, flow spec, shared lib export), OR introduces an architectural decision worth surfacing. | `main`. See [[feedback-simple-fixes-stay-on-main]]. |
| **Complex** | The workstream will produce **code or infra changes** (not just docs): `requires_deploy: true` in frontmatter, OR crosses services/domains, OR hits a Simple-lane disqualifier above, OR a `type: design`/`type: spec` workstream whose done-definition includes an implementation commit (not just the spec doc). | **Worktree FIRST**. See [[feedback-worktree-first-no-commits-on-main]]. |

**Edge case — spec-only design workstreams stay Doc-layer.** A `type: design` or `type: spec` workstream whose done-definition is "spec or design doc exists, reviewed, lands in `docs/superpowers/specs/`" produces only doc files. That ships on `main` as Doc-layer. The follow-up implementation workstream (which will produce code) gets its own backlog file and goes through Complex.

If midway you realize the lane was wrong (started Simple, architectural decision surfaces), STOP and upgrade. See [[feedback-pivot-to-worktree]].

### 4. Adopt to ACTIVE (Complex lane only)

1. `EnterWorktree` — branches from `origin/main`. **Do NOT commit on `main` first**; preflight already verified main is clean.
   - **Self-heal a phantom worktree session.** If `EnterWorktree` errors `Already in a worktree session`: confirm disk is clean (on `main`, `git status --short` empty, `git worktree list` shows no unexpected entry), `git worktree prune` if a stale registration shows, then `ExitWorktree action: "keep"` to clear the dead flag, then retry. Only stop and ask the user if there is genuine uncommitted work in a real leftover worktree. _(Why this happens and why `keep` is safe here: see [LESSONS.md](./LESSONS.md) "Phantom worktree session".)_
2. Inside the worktree: edit `docs/backlog/<id>.md` → `status: active`, fill `out_of_scope:` (rule 4). Commit. **Use the worktree's own path for every edit** — `EnterWorktree` switches the harness cwd but the Edit tool resolves absolute paths verbatim, so a path under the original repo root silently writes to `main`'s checkout instead of the worktree. After the first edit, `git status --short` in the worktree to confirm the change actually landed there.
3. `node .claude/skills/backlog-lint/lint.mjs --fix`. Commit the regenerated `docs/BACKLOG.md`.

Doc-layer and Simple lanes skip adoption — work the item directly on `main`.

### 5. Route to the downstream skill

| Item state | Skill |
|------------|-------|
| `type: design`, no spec yet | `superpowers:brainstorming` → produces spec |
| Has spec, no plan | `superpowers:writing-plans` |
| Has plan | `superpowers:executing-plans` |
| Architectural ambiguity surfaces | `superpowers:brainstorming` first |
| New service / feature / event / data flow / MFE | Matching `create-*` / `design-*` skill from `CLAUDE.md` routing table |

#### 5a. Runtime engine drive (behind `RUNTIME_ENGINE` — WS-3 strangler)

When the `RUNTIME_ENGINE` flag is set, the **execute + pre-ship + ship-floor drive** is performed by the
runtime worker rather than the legacy prose below: run `node runtime/adapters/claude-code/run-next.mjs <id>`.
The single decision site is [`next-driver.mjs`](./next-driver.mjs) (`nextDriver(env)` → `{cmd, mode}`,
mirroring [`backlog-gate.mjs`](./backlog-gate.mjs)); flag **off** → the legacy body in the sections below runs
**unchanged** (byte-for-byte, retained until P6). The runtime worker owns the **deploy-gate** at pre-ship (a
sha-conditional expensive `runWatch` batch — deploy + affected integration + involved e2e — gated by the
adapter-computed lane; doc-layer skips it) and always **parks at the ship floor** (never auto-ships). The
driver exits `0 done / 3 paused / 1 failed / 2 usage`; on a `3` park, fulfil the printed pending KEY
(`pending[].key`, exactly as printed — NOT the decision id; a unique `decision.id` is tolerated, translated
to its step key by `fulfil-key.mjs`) and re-invoke. Git-workflow preconditions (tree-clean, main-not-ahead,
no-stale-worktree) stay host preflight/postflight (§0, §7) — they are not engine concerns.

### 6. Closing phase

Run the steps in order. Each one is a single command; the agent reads the output and acts.

**6.1 Regen derived docs first.**

```bash
node .claude/skills/backlog-next/detect-doc-derivation.mjs
```

Exit 0 ⇒ derivation needed. The output lists which skills to run (`generate-c4-diagrams`, `audit-service <svc>`, `validate-flow <spec>`, etc.). Run them, resolve any inconsistencies they surface, and commit the regen **in the same workstream**. Source + derived must ship together. See `doc-derivation-paths.md` for the full mapping.

**6.2 Verify with the true-affected resolver.**

```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
[ -n "$AFFECTED" ] && pnpm nx run-many -t test,lint -p "$AFFECTED" || echo "no affected projects"
```

(`tools/affected-projects.mjs` replaces `nx affected`, which over-reports the
full event-processor closure for any single-service change.)

Must pass before any deploy fires. Auto-deploying broken code wastes a cycle.

**6.3 Detect deploy needs.**

```bash
node .claude/skills/backlog-next/detect-deploy-needed.mjs
```

Exit 0 ⇒ deploy needed (script prints the affected services). Exit 10 ⇒ skip 6.4 entirely. See `deploy-paths.md` for the mapping.

**6.4 Deploy + scoped validation (only if 6.3 said deploy).**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=<from-detect-output>
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main --with-target=test-integration | paste -sd, -)
[ -n "$AFFECTED" ] && pnpm nx run-many -t test-integration -p "$AFFECTED" || echo "no affected integration suites"
```

Then run only the **involved** `apps/e2e-feature-tests` scenarios — pick from the workstream's context (which flows/services it touched). **NEVER the full e2e suite. NEVER Playwright.** See [[feedback-always-rerun-e2e]]. If any scenario fails-then-passes on a rerun, pull CloudWatch evidence from the failing window before continuing and run a second confirmation pass — flakes are real failures, not noise. See [[feedback-flake-means-broken]]. Dev-account operations need no confirmation — see [[feedback-sole-dev-no-shared-caution]].

**6.4b Backward-edge ritual — ship recheck + mint consideration (simple + complex lanes; doc-layer exempt).**

1. **Ship recheck** — adjudicate the branch delta against the live checks. This is the single adjudication point: it catches what `RUNTIME_GATE_SKIP` bypassed and what `--no-verify` worktree commits never ran:

   ```bash
   node runtime/adapters/git/ship-recheck.mjs --item <id>        # --base defaults to origin/main
   ```

   Findings → fix the code, or — when the *property itself* is wrong — curate at the floor (the ONLY sanctioned path past a failing guard):

   ```bash
   node runtime/adapters/claude-code/run-backward.mjs curate --check <check-id> --trigger ship-gate [--reason '…']
   ```

   The curate parks (exit 3) printing the pending Decision with the full guard YAML — surface it via **AskUserQuestion** (retire / supersede / keep), then re-invoke with `--fulfil <decision-id> --value '{"decisionId":"<decision-id>","value":"<choice>"}'`. Supersede requires `--successor <draft.json>` (`{entry, eval_scenario, rationale}` — the successor gets full mint guarantees). Repeat ship-recheck until green — it journals `ship:<id>:gate-clean`, which postflight requires. `keep` leaves the guard up: the delta must then be fixed; keep can never become a stealth bypass.

2. **Mint consideration** — ask the human via **AskUserQuestion**: *"did this ship surface a mechanizable, recurring, still-intended lesson?"* If yes: write the proposal JSON (CandidateDraft fields + `gates`), then drive the mint floor:

   ```bash
   node runtime/adapters/claude-code/run-backward.mjs mint --item <id> --lesson <dossier.md> --proposal <proposal.json>
   ```

   (parks with the full candidate YAML in the Decision → AskUserQuestion ratify/edit/decline → `--fulfil`). **Either way**, record the consideration — "nothing mechanizable" is a legal answer, silence is not:

   ```bash
   node runtime/adapters/claude-code/run-backward.mjs consider --item <id> (--minted <check-id> | --none) --reason '…'
   ```

   Postflight enforces both records (`ship-gate-evidence`, `mint-considered`).

**6.5 Ship the backlog file.** Edit `docs/backlog/<id>.md` → `status: shipped`, fill `validation_gate:` with concrete evidence (commit SHA, deploy log line, integ/e2e command output), **and stamp `closed: <today>`** (the authoritative Recently-Shipped date — see the 6.6 note). Commit.

**6.6 Regen index.** `node .claude/skills/backlog-lint/lint.mjs --fix`. Commit.

> **Always stamp `closed: <today>` at ship (6.5)** — set a non-today date only when backfilling. _(Why the explicit stamp is the only across-midnight-safe date: see [LESSONS.md](./LESSONS.md) F-30.)_

**6.7 Complex lane only:** route to `superpowers:finishing-a-development-branch` for merge / PR / branch cleanup. Do NOT handle the merge manually. **If the local-merge option is chosen, push `main` afterward** — `git push origin main`. The local-merge path does NOT push, but postflight's `main-sync` check AND the next run's preflight both require local `main` == `origin/main` (a local-but-unpushed merge leaves `main` ahead and blocks the next workstream). Pushing the project's own `main` is the routine completion — prior shipped workstreams are already on `origin/main`; it is a dev-account op, not a production/real-money action ([[feedback-sole-dev-no-shared-caution]]). The PR option pushes as part of its own flow.

**In `--auto`:** answer the finishing menu by taking the **PR route** (push + create PR — log the
choice), render this workstream's `## Decision log` section into the PR body
(`node .claude/skills/backlog-next/decision-log.mjs render <id>`; `gh pr create`/`gh pr edit
--body-file`), then **STOP at the open PR via AskUserQuestion** — the merge is the user's;
`--auto` NEVER runs `gh pr merge` and never local-merges _(same merge-ownership rule as the epic
E8 — LESSONS F-7/F-33)_. Clean up the worktree only (`worktree-ops.mjs cleanup … --keep-branch`),
print the PR link, and end the run — Steps 6.8 and 7 belong to the post-merge tail. **Post-merge
tail (a LATER `/backlog-next <id> --auto` invocation):** when the named item is already
`status: shipped`, its feature branch still exists, and `gh pr view <branch> --json state` says
MERGED — do not warn-and-confirm; run the tail instead: ff `main` (`git checkout main && git pull
--ff-only`), `worktree-ops.mjs cleanup … --delete-branch`, then Step 7 postflight
(`--lane=complex`). If the PR is still open, re-print the link and stop.

**6.8 Complex lane only — clean up the worktree + branch (the `worktree-ops.mjs` helper, NOT `ExitWorktree`).** Clean up via the helper, which shells out to git from the **main repo root** — `ExitWorktree` reliably FAILS in a cwd-pinned session (the common case for `/backlog-next`), so do NOT call or retry it. The helper resolves the main root itself, so it is safe to run even when the worktree being removed is your pinned cwd. _(Why `ExitWorktree` fails and why `finishing-a-development-branch` leaves the cleanup here: see [LESSONS.md](./LESSONS.md) "`ExitWorktree` fails in cwd-pinned sessions".)_

```bash
node .claude/skills/backlog-next-epic/worktree-ops.mjs cleanup \
  --branch=<feature-branch> --worktree=.claude/worktrees/<name> --delete-branch   # remove worktree + prune; delete branch only if merged (safe -d, the 6.7 merge makes this true)
```

The helper resolves the main repo root itself (safe to run from the worktree cwd), removes the worktree, and deletes the branch **only** if it is merged into `main` (safe `git branch -d`, never `-D`) — if the branch is somehow unmerged it refuses the delete (exit 1) rather than destroying work.

Optionally `ExitWorktree action: "keep"` best-effort afterward to clear the flag; if it errors with the cwd-override message, **ignore it** — on-disk state is already correct and Step 7 postflight checks on-disk truth (worktree gone, branch deleted, `main` synced), not the harness session flag. _(Why this git cleanup is the durable fix and how it breaks the phantom-session leak cycle: see [LESSONS.md](./LESSONS.md) "`ExitWorktree` fails in cwd-pinned sessions".)_

### 7. Postflight (enforced)

```bash
# Complex lane: run from $MAIN (a guaranteed-live dir) — Step 6.8 may have removed your pinned cwd.
# Doc-layer/simple: cwd is fine. (Why $MAIN survives the removed worktree: see LESSONS.md F-23.)
MAIN=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel 2>/dev/null || pwd)
(cd "$MAIN" && node .claude/skills/backlog-next/postflight.mjs --lane=<doc-layer|simple|complex|epic-member> --id=<id> [--branch=<feat-branch>])
```

Hard-fails if: working tree is dirty, `backlog-lint` violates a rule, the shipped item's frontmatter is incomplete, the feature branch wasn't merged + deleted (Complex), or stale worktrees remain. Fix before declaring the job done. (`--lane=epic-member` runs only checks 1–3 — tree-clean, lint, shipped frontmatter — because the member stays on the epic branch; the merge/sync/branch-delete checks belong to the epic-level close run by `/backlog-next-epic`.)

## Standalone `--auto` mode

`/backlog-next [<id>] --auto` runs ONE workstream unattended. A **decision** is an
architectural/design fork; test/build failures are NOT decisions — route to
`superpowers:systematic-debugging` with a **bounded budget of at most 3 debug→re-run cycles**;
exceeding it is a floor item (pause). _(Same budget + rationale as the epic orchestrator E4.3 —
see [`../backlog-next-epic/LESSONS.md`](../backlog-next-epic/LESSONS.md) F-9.)_

**Decision log (mandatory for every auto-resolved fork).** Append via the helper — entry JSON on
stdin; it validates the closed shape `{decision, options, chosen, rationale, rejected}` and
appends to the `## Decision log` section of THIS workstream's `docs/backlog/<id>.md` (append-only
by construction — a reversal is a NEW entry referencing the superseded one; never hand-edit the
section):

```bash
echo '{ "decision": "...", "options": ["..."], "chosen": "...", "rationale": "...", "rejected": "..." }' \
  | node .claude/skills/backlog-next/decision-log.mjs append <id>
```

Commit the appended entry with the workstream's next commit (Simple/Doc-layer: on `main` with the
work; Complex: on the feature branch). The committed section is the asynchronous-review surface
that replaces synchronous approval — in the Complex lane it also lands verbatim in the PR body
(Step 6.7).

**Per-source policy** (mirrors epic E5 — decide each known fork in advance, conservative
catch-all for the rest):

1. **`type: design` items → ALWAYS PAUSE.** The `superpowers:brainstorming` approval gate
   requires explicit user sign-off on every design; `--auto` never self-approves it.
2. **Step 6.7 finishing menu → PR route, then STOP at the open PR.** See the Step 6.7 `--auto`
   rule — never `gh pr merge`, never a local merge.
3. **In-workstream architectural forks** → run the blast-radius gate first:
   `node .claude/skills/backlog-next-epic/detect-fork-blast-radius.mjs <fork-subject-symbol>`.
   **Exit 1 (shared-surface hit) → floor** (contracts/events/shared-lib exports ripple beyond this
   workstream). **Exit 0** → resolve by selecting the option the project marks **(Recommended)** =
   the most reusable / generalizable / cleanly-abstracted one (`CLAUDE.md` § "Hard Constraints";
   reusability breaks ties), append to the decision log, continue.
4. **Catch-all → PAUSE.** Any fork or sub-skill prompt not enumerated here is unknown territory:
   do not guess — pause and ask (close the gap by adding the case here).

**Hard floor — pause even in `--auto`** (self-contained on purpose, like the epic-member floor —
_(see [`../backlog-next-epic/LESSONS.md`](../backlog-next-epic/LESSONS.md) F-8)_; the worst ops
are ALSO mechanically gated by the harness / `CLAUDE.md` § "Still requires explicit
confirmation"):

- **Irreversible / outward-facing actions** — staging/prod ops, real-money/broker actions,
  `git push --force`, `git reset --hard` on shared branches, `git branch -D`, destructive
  deletes, mutations outside `dev-*`, anything outside this repo.
- **Scope-boundary fork** — the fork changes this workstream's `out_of_scope:` boundary, or
  `detect-fork-blast-radius.mjs` exits 1 for it, or it is genuinely balanced (reusability does
  not break the tie).
- **Bounded-effort exceeded** — the 3-cycle debug budget is spent.
- **Cost gates** — an e2e repeat count ≥ the cost-conscious threshold (Step 6.4) surfaces via
  AskUserQuestion even in `--auto` ([[feedback-e2e-cost-conscious]]).
- **Backward-edge ritual (6.4b)** — `curate` is a guard-lowering act: ALWAYS floor-paused. The
  mint consideration stays an AskUserQuestion ("nothing mechanizable" is a legal answer; silence
  is not).

When the floor fires, the surface MUST be an **AskUserQuestion** widget with a `(Recommended)`
option — a free-text "this is your call" prose pause is a skill violation _(see
[`../backlog-next-epic/LESSONS.md`](../backlog-next-epic/LESSONS.md) F-7/F-33)_. Record the
outcome in the decision log, resume.

## Epic-member mode (invoked by `/backlog-next-epic`)

When the `/backlog-next-epic` orchestrator drives this skill, it passes the member `<id>` **plus an epic-member context signal**: the active delivery epic, its branch `feat/epic-<id>`, and its already-checked-out worktree. The orchestrator owns the epic worktree, the single merge/PR, and the expensive e2e — so the worker runs the member *inside that worktree* and **hoists branch-level concerns to the epic**. Apply these deltas to the standard procedure:

- **Step 0 (Preflight).** Run `node .claude/skills/backlog-next/preflight.mjs --lane=epic-member` instead of the standard preflight. It checks only tree-clean (within the worktree) + `backlog-lint`; it skips the on-main / main-ahead / stale-worktree checks and the snapshot+daemon side-effects (the orchestrator already ran the full preflight once at epic-start).
- **Step 3 (Classify) + Step 4 (Adopt).** The member is **always** worked inside the existing epic worktree. Do **NOT** `EnterWorktree` (skip Step 4.1) — the epic branch is already checked out. **First capture the member-start HEAD** — `git rev-parse HEAD` *before* the adoption commit (it is the tip of all prior members' work, i.e. this member's source baseline); remember it for the resume-aware Step 6.1 base below. Then flip the member `docs/backlog/<id>.md` → `status: active`, fill `out_of_scope:`, and commit **on the epic branch** (4.2), then `backlog-lint --fix` + commit (4.3). Use the worktree's own path for every edit.
- **Step 5 (Downstream routing).** Route to the same downstream skill as usual, with ONE critical change: `superpowers:executing-plans` and `superpowers:subagent-driven-development` end with an **unconditional handoff to `superpowers:finishing-a-development-branch`** (their "complete development" step). In epic-member mode you must **drive only their task-execution phase and STOP before that finishing handoff** — the member is "done" at commit-on-branch + green per-member integration tests. Do NOT let the downstream skill open a PR, merge, or clean the branch; **return control to `/backlog-next-epic`**. This is what preserves the one-branch/one-PR invariant: the finishing handoff is the orchestrator's job at epic close (E8), never the member's. (If a member routes to `superpowers:brainstorming` for a `type: design` slice, see the orchestrator's E5 — in `--auto` such members do not auto-resolve the brainstorming approval gate.) Member-scoped fork decisions are appended to the MEMBER's own file — `decision-log.mjs append <member-id>` — committed on the epic branch; the orchestrator aggregates every member section into the PR body at E8.
- **Floor (self-contained).** In `--auto` (epic-member mode AND standalone — see § "Standalone `--auto` mode"), a `type: design` brainstorming approval gate and any irreversible / outward-facing action (staging/prod ops, real-money/broker actions, `git push --force`, `git branch -D`, destructive deletes, anything outside `dev-*`) are **NEVER** auto-resolved — pause via **AskUserQuestion** (a prose pause is a skill violation) and surface to the orchestrator. _(Why this floor is restated in the worker rather than referenced from E5: see [LESSONS.md](./LESSONS.md) F-8.)_
- **Step 6.1 (Regen derived docs).** Pass the **member-start HEAD** captured at Step 4 as the base — `node .claude/skills/backlog-next/detect-doc-derivation.mjs --base=<member-start-HEAD>` — so the detector reports only THIS member's source delta, not every earlier member's. Standalone/non-epic runs keep the default `origin/main` base (no prior member, so the cumulative diff IS the member delta). _(Why the default base falsely reports `derivation=true` on every resume: see [LESSONS.md](./LESSONS.md) F-2.)_
- **Step 6.4 (Deploy + validation).** Run the per-member **integration** tests (and a per-member deploy if 6.3 says so), but **SKIP the e2e block** — the expensive Jest e2e + Playwright run once at epic pre-done, batched by the orchestrator. Also SKIP Step 6.4b — the backward-edge ritual (ship-recheck + mint consideration) runs once at the epic pre-done gate with `--item <epic-id>`; the epic-member postflight lane does not check backward evidence.
- **Step 6.7 / 6.8 (Finish + cleanup).** **SKIP both.** Do NOT route to `finishing-a-development-branch`, do NOT clean up the worktree, do NOT push `main`. The orchestrator does one merge / one PR / one cleanup at epic close.
- **Step 7 (Postflight).** Run `node .claude/skills/backlog-next/postflight.mjs --lane=epic-member --id=<id>` (checks 1–3 only). Then **return control to `/backlog-next-epic`** — it advances to the next member or moves to the epic pre-done gate.

Everything else (Step 2 verify references, Steps 6.2–6.3, 6.5–6.6) runs unchanged. (Step 1 "Pick" does not run in epic-member mode — the orchestrator supplies the member id, so the worker starts at Step 2.)

## Common mistakes

- **Skipping preflight or postflight.** Both are hard gates, not advisory. The "just one quick frontmatter tweak on main before the worktree" is the start of every cascade; declaring shipped without postflight is how stale worktrees and unpushed main commits accumulate.
- **Reimplementing `finishing-a-development-branch`.** This skill routes to it — do NOT run `gh pr create` + `gh pr merge --squash` manually in the closing phase. The skill knows about branch deletion, fast-forward reconciliation, and `gh pr merge --delete-branch` ordering.
- **Auto-promoting LATER → QUEUED.** Promotion is a judgment call — do it manually at the boundary review.
- **Splitting source from derived across PRs.** Both ship in the same workstream. See `doc-derivation-paths.md`.
- **Dismissing flakes after one rerun.** See [[feedback-flake-means-broken]]. If a scoped e2e scenario fails-then-passes, pull evidence from the failing window before continuing; a confirmation rerun is required, not optional. E2E flakes are QUEUED, never parking — see [[feedback-e2e-gaps-queued-not-parking]].
- **Trying to `ExitWorktree` for cleanup in Step 6.8.** It reliably FAILS in a cwd-pinned session (`cannot be called from a subagent with a cwd override`). Use Step 6.8's **`worktree-ops.mjs cleanup … --delete-branch`** helper (it shells out to `worktree remove --force` + safe `branch -d` + `prune` from the main root) — that is the reliable path and it breaks the phantom-session leak cycle. Leaving the worktree on disk is what makes the next run launch pinned to it.
- **Local merge without pushing `main`.** `finishing-a-development-branch`'s local-merge path does not push; postflight `main-sync` and the next preflight both require `main` == `origin/main`. Push in 6.7.
- **`--auto` auto-resolving a floor decision.** Irreversible/outward ops, shared-surface forks, spent debug budgets, and 6.4b curate ALWAYS pause, `--auto` or not. The decision log is review-after, not a license to act irreversibly unattended.
- **Hand-editing the `## Decision log` section.** It is append-only via `decision-log.mjs` (F-6): a wrong call is superseded by a NEW entry, never edited away — the committed trail must stay honest.

## Related

`backlog-next-epic` (the epic orchestrator that drives this skill in epic-member mode), `backlog-add`, `backlog-lint`, `superpowers:brainstorming` / `writing-plans` / `using-git-worktrees` / `executing-plans` / `finishing-a-development-branch`. Supporting files in this skill: `deploy-paths.md`, `doc-derivation-paths.md`, `preflight.mjs`, `postflight.mjs`, `detect-deploy-needed.mjs`, `detect-doc-derivation.mjs`, `decision-log.mjs` (the append-only decision-log helper — the epic orchestrator (`backlog-next-epic`) consumes it for its own orchestrator-level decisions and the E8 PR-body aggregation).

**Run the tests** (use the **glob** form — `node --test <dir>` does not discover suites on Node 24):

```bash
node --test .claude/skills/backlog-next/test/*.test.mjs
```
