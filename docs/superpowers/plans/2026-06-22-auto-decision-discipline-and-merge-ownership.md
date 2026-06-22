# `--auto` decision discipline + merge ownership — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/backlog-next-epic` orchestrator's `--auto` floor a decidable, script-backed, AskUserQuestion-mandatory gate, and make the epic close always stop at an open PR (never self-merge).

**Architecture:** One new dependency-free helper script (`detect-fork-blast-radius.mjs`, TDD) backs the case-3 auto-resolve gate; the rest is precise prose surgery on `backlog-next-epic/SKILL.md` (E5/E8/resume gate/E3) + a self-contained floor bullet in `backlog-next/SKILL.md`. Prose edits are verified by grep-based acceptance checks against the spec's Done-when.

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert/strict`, `git ls-files` for surface discovery (no glob dep).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-22-auto-decision-discipline-and-merge-ownership-design.md`. Every task implements part of it.
- Scope: the **epic orchestrator** (`backlog-next-epic`) + the **worker epic-member floor** (`backlog-next`). Do NOT touch the standalone `/backlog-next` 6.7 finishing menu.
- All files `.mjs` / `.md` under `.claude/skills/`. Match existing 2-space-indent, single-quote, no-semicolon-omission style.
- Run an explicit test file with `node --test <path>` (never the bare-directory form). Commits use `git commit --no-verify` (worktree pre-commit hook); verify each landed with `git log --oneline -1`.
- Boundary: this member DEFINES the `e8: PR_OPEN_AWAITING_MERGE` marker + a working post-merge tail; the closed run-state schema is `runstate-write-contract-and-recovery` (#3) and the tail robustness is `ship-and-merge-mechanics` (#4). Do NOT implement #3/#4 work here.

---

### Task 1: `detect-fork-blast-radius.mjs` + test

**Files:**
- Create: `.claude/skills/backlog-next-epic/detect-fork-blast-radius.mjs`
- Test: `.claude/skills/backlog-next-epic/test/detect-fork-blast-radius.test.mjs`

**Interfaces:**
- Produces: `SURFACE_PATTERNS: RegExp[]`; `isSurfaceFile(path: string) -> boolean`; `scanSurfaces(patterns: string[], fileEntries: {path, content}[]) -> {path, line, pattern, text}[]`. CLI exit: `0` no hits, `1` hits, `2` usage error.

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/backlog-next-epic/test/detect-fork-blast-radius.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSurfaceFile, scanSurfaces } from '../detect-fork-blast-radius.mjs';

test('isSurfaceFile matches the curated shared/exported surfaces only', () => {
  assert.equal(isSurfaceFile('libs/event-types/src/names.ts'), true);
  assert.equal(isSurfaceFile('libs/ui/src/index.ts'), true);          // shared-lib export
  assert.equal(isSurfaceFile('flows/advisory-cycle.flow.yaml'), true);
  assert.equal(isSurfaceFile('libs/cdk-constructs/src/core/egress.ts'), true);
  // NON-surfaces:
  assert.equal(isSurfaceFile('libs/ui/src/lib/button.ts'), false);    // not the index barrel
  assert.equal(isSurfaceFile('services/investor-ctrl/src/handler.ts'), false);
  assert.equal(isSurfaceFile('apps/investor-web/src/main.ts'), false);
});

test('scanSurfaces finds a literal symbol across given entries, with location', () => {
  const entries = [
    { path: 'libs/event-types/src/names.ts', content: 'export const MANDATE_ISSUED = "MandateIssued";\nother' },
    { path: 'services/x/src/h.ts', content: 'no match here' },
  ];
  const hits = scanSurfaces(['MANDATE_ISSUED'], entries);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, 'libs/event-types/src/names.ts');
  assert.equal(hits[0].line, 1);
  assert.equal(hits[0].pattern, 'MANDATE_ISSUED');
});

test('scanSurfaces returns [] when no pattern matches or patterns are empty', () => {
  const entries = [{ path: 'libs/event-types/src/names.ts', content: 'nothing relevant' }];
  assert.deepEqual(scanSurfaces(['ZZZ_NOPE'], entries), []);
  assert.deepEqual(scanSurfaces([], entries), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/skills/backlog-next-epic/test/detect-fork-blast-radius.test.mjs`
Expected: FAIL — `Cannot find module '../detect-fork-blast-radius.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `.claude/skills/backlog-next-epic/detect-fork-blast-radius.mjs`:

```js
#!/usr/bin/env node
/**
 * Blast-radius gate for /backlog-next-epic E5 case-3 auto-resolve (F-5/F-6).
 * Greps a curated manifest of shared/exported surfaces for a fork's subject
 * symbol(s). Exit 0 = no shared-surface hit (safe to auto-resolve); exit 1 =
 * hits printed (escalate to the AskUserQuestion floor); exit 2 = usage error.
 *
 * Usage: node detect-fork-blast-radius.mjs <pattern> [<pattern>...]
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Curated shared / exported surfaces. A change to any of these can ripple into a
// not-yet-worked core member, so a fork touching one is NOT safe to auto-resolve.
// Extend this list as new shared surfaces appear; entries matching nothing are inert.
export const SURFACE_PATTERNS = [
  /^libs\/event-types\/src\/.*\.ts$/,     // event contracts / names
  /^libs\/[^/]+\/src\/index\.ts$/,        // shared-lib public exports (barrel)
  /^flows\/.*\.flow\.yaml$/,              // cross-domain flow specs
  /^libs\/cdk-constructs\/src\/.*\.ts$/,  // CDK construct public APIs
];

export const isSurfaceFile = (f) => SURFACE_PATTERNS.some((re) => re.test(f));

/** Pure: scan fileEntries [{path, content}] for any literal pattern. */
export function scanSurfaces(patterns, fileEntries) {
  const hits = [];
  for (const { path, content } of fileEntries) {
    content.split('\n').forEach((text, i) => {
      for (const p of patterns) {
        if (p && text.includes(p)) hits.push({ path, line: i + 1, pattern: p, text: text.trim() });
      }
    });
  }
  return hits;
}

function main() {
  const patterns = process.argv.slice(2).filter(Boolean);
  if (patterns.length === 0) {
    console.error('Usage: detect-fork-blast-radius.mjs <pattern> [<pattern>...]');
    process.exit(2);
  }
  const repoRoot = execSync('git rev-parse --show-toplevel').toString().trim();
  const files = execSync('git ls-files', { cwd: repoRoot })
    .toString().split('\n').filter(Boolean).filter(isSurfaceFile);
  const entries = files.map((f) => ({ path: f, content: readFileSync(join(repoRoot, f), 'utf8') }));
  const hits = scanSurfaces(patterns, entries);
  if (hits.length === 0) {
    console.log(`✓ no shared-surface references to [${patterns.join(', ')}] — safe to auto-resolve`);
    process.exit(0);
  }
  console.error(`✗ ${hits.length} shared-surface reference(s) — escalate to the AskUserQuestion floor:`);
  for (const h of hits) console.error(`  ${h.path}:${h.line}  [${h.pattern}]  ${h.text}`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test .claude/skills/backlog-next-epic/test/detect-fork-blast-radius.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: End-to-end CLI smoke (real exit codes)**

Run:
```bash
node .claude/skills/backlog-next-epic/detect-fork-blast-radius.mjs ThisSymbolDoesNotExistAnywhereXYZ ; echo "exit=$?"
node .claude/skills/backlog-next-epic/detect-fork-blast-radius.mjs index ; echo "exit=$?"
```
Expected: first → `✓ no shared-surface references … exit=0`; second → `✗ N shared-surface reference(s) … exit=1` (the literal `index` appears in barrel files). This confirms the 0/1 mapping end-to-end.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/backlog-next-epic/detect-fork-blast-radius.mjs .claude/skills/backlog-next-epic/test/detect-fork-blast-radius.test.mjs
git commit --no-verify -m "feat(backlog-next-epic): detect-fork-blast-radius.mjs — code backstop for E5 case-3 auto-resolve"
git log --oneline -1
```

---

### Task 2: E5 rewrite — decision floor + blast-radius gate + append-only log

**Files:**
- Modify: `.claude/skills/backlog-next-epic/SKILL.md` (E5, lines ~105–123)

**Interfaces:** Consumes `detect-fork-blast-radius.mjs` from Task 1.

- [ ] **Step 1: Add the append-only decision-log rule**

Edit the decision-log shape line (E5, ~line 106). Replace:
```
`{ member, decision, options, chosen, rationale (the reuse rationale), rejected }`.
```
with:
```
`{ member, decision, options, chosen, rationale (the reuse rationale), rejected }`. The log is **append-only**: never edit or delete a prior entry — a later reversal is a NEW entry whose `rationale` references the superseded entry by index, so the original (possibly wrong) call stays visible in the PR-review trail (F-6).
```

- [ ] **Step 2: Rewrite case 2 (the F-33 root)**

Replace E5 case-2 (line ~114):
```
  2. **`finishing-a-development-branch` menu (E8) → auto-pick Option 2 (Push + create PR).** Answer its 4-option menu without pausing; the PR is the review surface and is non-destructive. (Per-member finishing menus don't arise — the worker Step 5 delta stops before them.)
```
with:
```
  2. **`finishing-a-development-branch` menu (E8) → governed by E8's merge-ownership rule.** Answer the menu by taking the **PR route** (push + create PR) — but the close does NOT end there: it **STOPS at an open PR via AskUserQuestion** for the user to merge. `--auto` **never** runs `gh pr merge` and never local-merges the epic branch (E8). (Per-member finishing menus don't arise — the worker Step 5 delta stops before them.)
```

- [ ] **Step 3: Rewrite case 3 (blast-radius gate)**

Replace E5 case-3 (line ~115):
```
  3. **In-member architectural forks the worker surfaces** (a non-design AskUserQuestion / mid-execution choice) → resolve by selecting the option the project marks **(Recommended)** = the **most reusable / generalizable / cleanly-abstracted** one (`CLAUDE.md` § "Hard Constraints"; reusability breaks ties). Append to the decision log. Continue.
```
with:
```
  3. **In-member architectural forks the worker surfaces** (a non-design AskUserQuestion / mid-execution choice) → **before auto-resolving, run the blast-radius gate:** `node .claude/skills/backlog-next-epic/detect-fork-blast-radius.mjs <fork-subject-symbol>`. **Exit 1 (a shared-surface hit) → escalate to the floor** (the fork can ripple into a not-yet-worked member — F-6). **Exit 0** → resolve by selecting the option the project marks **(Recommended)** = the **most reusable / generalizable / cleanly-abstracted** one (`CLAUDE.md` § "Hard Constraints"; reusability breaks ties). **Append** to the decision log (append-only — see above). Continue.
```

- [ ] **Step 4: Rewrite the floor's decidable scope test (F-5)**

Replace the floor bullet (line ~120):
```
  - **No defensible recommended option** — a genuinely balanced fork where reusability does not break the tie, or one whose divergent choices carry large downstream blast radius across remaining members.
```
with:
```
  - **Scope-boundary fork (decidable test)** — pause ONLY when the fork (a) changes the epic's `out_of_scope:` boundary, (b) alters a contract / event / interface / shared-lib export consumed by a not-yet-worked core member (i.e. `detect-fork-blast-radius.mjs` exits 1 for it), or (c) forces rework of an already-shipped member. A genuinely balanced fork where reusability does not break the tie also still pauses. (This replaces the old over-broad "large downstream blast radius" clause that swallowed every fork — F-5.)
```

- [ ] **Step 5: Strengthen the floor-surface mandate (F-7)**

Replace the floor-fires line (line ~123):
```
  When the floor fires, surface via AskUserQuestion, record the outcome, resume. The decision log is the **asynchronous-review surface** that replaces synchronous approval — it lands in the PR body (E8).
```
with:
```
  When the floor fires, the surface MUST be an **AskUserQuestion** widget with a `(Recommended)` option — a free-text "this is your call" prose pause is a **skill violation** (it is what let an ambiguous "go" collapse into a self-merge — F-7/F-33). Record the outcome (append-only), resume. The decision log is the **asynchronous-review surface** that replaces synchronous approval — it lands in the PR body (E8).
```

- [ ] **Step 6: Verify the edits (grep acceptance) + commit**

Run:
```bash
F=.claude/skills/backlog-next-epic/SKILL.md
grep -q 'auto-pick Option 2' "$F" && echo "FAIL: old self-merge language remains" || echo "ok: case-2 rewritten"
grep -q 'detect-fork-blast-radius.mjs <fork-subject-symbol>' "$F" && echo "ok: blast-radius gate wired" || echo "FAIL: gate missing"
grep -q 'Scope-boundary fork (decidable test)' "$F" && echo "ok: decidable floor" || echo "FAIL: floor not rewritten"
grep -q 'append-only' "$F" && echo "ok: append-only log" || echo "FAIL: append-only missing"
grep -q 'MUST be an \*\*AskUserQuestion\*\*' "$F" && echo "ok: AskUserQuestion mandatory" || echo "FAIL: mandate missing"
```
Expected: all five `ok:` lines, no `FAIL`.

```bash
git add .claude/skills/backlog-next-epic/SKILL.md
git commit --no-verify -m "fix(backlog-next-epic): E5 — decidable floor + blast-radius gate + append-only log + AskUserQuestion-mandatory (F-5/F-6/F-7)"
git log --oneline -1
```

---

### Task 3: E8 rewrite — merge ownership (always stop at open PR) + resume tail + e8 marker

**Files:**
- Modify: `.claude/skills/backlog-next-epic/SKILL.md` (Resume gate ~30–35, E3 ~77–88, E8 ~161–181)

**Interfaces:** Defines run-state marker `e8: PR_OPEN_AWAITING_MERGE` (sanctioned value); consumed by the resume gate. Working post-merge tail (hardened later by #4).

- [ ] **Step 1: Rewrite E8.1 (own the merge as always-stop-at-PR)**

Replace E8 item 1 (line ~163), keeping the PR-body-composition + conflict-resolution guidance, and replacing the merge handling:
```
1. Route to `superpowers:finishing-a-development-branch` for the **one** epic PR (in `--auto`, pre-pick its Option 2 — see E5). Do not handle the merge manually. **Compose the PR body yourself:** `finishing`'s push step does not author a body, so render the run-state `decisions[]` to markdown + a per-member commit summary and set it (`gh pr create`/`gh pr edit --body-file`); if the log is empty, state "no decisions auto-resolved". **Expect a `docs/BACKLOG.md` merge conflict** — the auto-index is written on BOTH `main` (E1 promotion marker + any parallel doc/simple workstream `CLAUDE.md` permits) and the branch (E4/E7). Resolve it **mechanically, never by hand**: take the branch side, then re-run `node .claude/skills/backlog-lint/lint.mjs --fix` on the rebased branch so the index regenerates from the merged frontmatter.
```
with:
```
1. **Open the PR (the close ALWAYS stops here — `--auto` AND interactive).** Route to `superpowers:finishing-a-development-branch` taking the **PR route** (push + create PR). **Compose the PR body yourself:** `finishing`'s push step does not author a body, so render the run-state `decisions[]` to markdown + a per-member commit summary and set it (`gh pr create`/`gh pr edit --body-file`); if the log is empty, state "no decisions auto-resolved". **Expect a `docs/BACKLOG.md` merge conflict** — the auto-index is written on BOTH `main` (E1 promotion marker + any parallel doc/simple workstream `CLAUDE.md` permits) and the branch (E4/E7). Resolve it **mechanically, never by hand**: take the branch side, then re-run `node .claude/skills/backlog-lint/lint.mjs --fix` on the rebased branch so the index regenerates from the merged frontmatter, and push so the PR is mergeable.
   - **Then STOP via AskUserQuestion — the merge is the user's.** Surface a structured AskUserQuestion (NOT prose): the `(Recommended)` option is *"PR #N is up at `<link>` — I'll review & merge it on GitHub myself; the agent stops here"*; other options cover *"keep iterating / inspect first"*. **No option runs `gh pr merge`; the agent NEVER self-merges and never local-merges the epic branch** (F-33). A bare "go" is not authorization to do anything but stop.
   - On the stop-and-hand-off confirmation, **clean up the worktree only** — `git worktree remove --force` + `git worktree prune` — **keeping the local + remote branch** so the PR stays mergeable (NO `git branch -d`, NO remote-branch delete). **Print the GitHub PR link.** Set run-state `e8: PR_OPEN_AWAITING_MERGE` (the only sanctioned `e8` value) and STOP. The branch deletion + `main` fast-forward happen in the **post-merge tail** (item 4), on a later resume that detects the PR merged.
```

- [ ] **Step 2: Change E8.2 cleanup to keep the branch (move branch-delete to the tail)**

Replace the E8.2 cleanup block (lines ~164–173). Replace:
```
2. After merge, clean up from the main repo root (NOT `ExitWorktree` — see [[feedback-exitworktree-fails-cwd-pinned]]):

```bash
MAIN=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
git -C "$MAIN" merge-base --is-ancestor feat/epic-<id> main && echo SAFE-TO-REMOVE
git -C "$MAIN" worktree remove ".claude/worktrees/epic-<id>" --force
git -C "$MAIN" branch -d feat/epic-<id>
git -C "$MAIN" worktree prune
rm -f "$(git -C "$MAIN" rev-parse --path-format=absolute --git-common-dir)/backlog-next-epic-<id>.json"
```
```
with:
```
2. **Worktree cleanup at the stop (branch KEPT).** From the main repo root (NOT `ExitWorktree` — see [[feedback-exitworktree-fails-cwd-pinned]]). This runs at the E8.1 stop, BEFORE the user merges, so it must NOT delete the branch or the run-state:

```bash
MAIN=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
git -C "$MAIN" worktree remove ".claude/worktrees/epic-<id>" --force
git -C "$MAIN" worktree prune
# Branch is KEPT (local + remote) so the PR stays mergeable. Run-state is KEPT as e8: PR_OPEN_AWAITING_MERGE.
```
```

- [ ] **Step 3: Add the post-merge tail (E8.4) and renumber the epic-postflight/boundary-review**

After the (now branch-keeping) E8.2 block, the existing items 3 (epic postflight) and 4 (boundary review) become the **post-merge tail**. Replace the E8 items 3–4 (lines ~175–181):
```
3. **Epic-level postflight** (the full close — this is where checks 4–7 run, deferred from each member):

```bash
node .claude/skills/backlog-next/postflight.mjs --lane=complex --branch=feat/epic-<id> --id=<id>
```

4. Boundary review of `docs/BACKLOG.md` **once** (re-rank LATER, promote, check Parking health) — not per member.
```
with:
```
3. **Hand off and STOP.** The run ends here with run-state `e8: PR_OPEN_AWAITING_MERGE`. Everything below (the post-merge tail) runs on a LATER `/backlog-next-epic <id>` resume.

4. **Post-merge tail (resume only — after the user merges the PR).** The Resume gate (top of Procedure) detects `e8: PR_OPEN_AWAITING_MERGE` + the PR merged (`gh pr view <n> --json state -q .state` → `MERGED`) and runs ONLY this tail (no re-promotion, no member loop):

```bash
MAIN=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
git -C "$MAIN" checkout main && git -C "$MAIN" pull --ff-only         # fast-forward main to the merged PR
git -C "$MAIN" merge-base --is-ancestor feat/epic-<id> main && git -C "$MAIN" branch -d feat/epic-<id>
git -C "$MAIN" worktree prune
node .claude/skills/backlog-next/postflight.mjs --lane=complex --branch=feat/epic-<id> --id=<id>   # epic-level checks 4–7
rm -f "$(git -C "$MAIN" rev-parse --path-format=absolute --git-common-dir)/backlog-next-epic-<id>.json"   # drop run-state
```

   Then a boundary review of `docs/BACKLOG.md` **once** (re-rank LATER, promote, check Parking health) — not per member. (The tail's robustness — postflight surviving a removed cwd, conflict-scope — is hardened by `ship-and-merge-mechanics`; this is the working contract.)
```

- [ ] **Step 4: Add the resume-gate branch for PR_OPEN_AWAITING_MERGE**

In the "Resume gate" section (line ~30–35), append a bullet after the "Exists → this is a RESUME" bullet:
```
- **Run-state `e8: PR_OPEN_AWAITING_MERGE` → the PR is already open, awaiting the USER's merge.** Check the PR state (`gh pr view <n> --json state -q .state`): **`MERGED`** → run **only** the E8.4 post-merge tail (ff `main`, delete the merged branch, epic postflight, drop run-state) and finish; **still `OPEN`** → re-print the PR link and STOP — the merge remains the user's (never `gh pr merge`).
```

- [ ] **Step 5: Document the e8 marker in E3**

In E3 (run-state init, line ~77–88), append one sentence to the run-state description:
```
The run-state also carries an optional `e8: PR_OPEN_AWAITING_MERGE` marker, set by E8.1 when the epic PR is open and awaiting the user's merge — the only sanctioned `e8` value (the closed schema that formalizes it is `runstate-write-contract-and-recovery`).
```

- [ ] **Step 6: Verify (grep acceptance) + commit**

Run:
```bash
F=.claude/skills/backlog-next-epic/SKILL.md
grep -q 'agent NEVER self-merges and never local-merges' "$F" && echo "ok: never self-merge" || echo "FAIL"
grep -q 'PR_OPEN_AWAITING_MERGE' "$F" && echo "ok: e8 marker" || echo "FAIL"
grep -q 'keeping the local + remote branch' "$F" && echo "ok: branch kept" || echo "FAIL"
grep -q 'Post-merge tail' "$F" && echo "ok: tail" || echo "FAIL"
# branch-delete must NOT appear in the stop cleanup — only in the tail (exactly one occurrence):
test "$(grep -c 'branch -d feat/epic-<id>' "$F")" = "1" && echo "ok: branch-delete only in tail" || echo "FAIL: branch-delete count wrong"
```
Expected: all `ok:` lines.

```bash
git add .claude/skills/backlog-next-epic/SKILL.md
git commit --no-verify -m "fix(backlog-next-epic): E8 merge ownership — always stop at open PR, never self-merge; e8 marker + resume tail (F-33)"
git log --oneline -1
```

---

### Task 4: F-8 — worker epic-member self-contained floor

**Files:**
- Modify: `.claude/skills/backlog-next/SKILL.md` (Epic-member mode section, after the Step 5 bullet ~line 173)

**Interfaces:** none (prose).

- [ ] **Step 1: Add the self-contained floor bullet**

In `.claude/skills/backlog-next/SKILL.md`, immediately AFTER the `- **Step 5 (Downstream routing).** …` bullet in the "## Epic-member mode" section, insert:

```markdown
- **Floor (self-contained).** In `--auto` epic-member mode, a `type: design` brainstorming approval gate and any irreversible / outward-facing action (staging/prod ops, real-money/broker actions, `git push --force`, `git branch -D`, destructive deletes, anything outside `dev-*`) are **NEVER** auto-resolved — pause via **AskUserQuestion** (a prose pause is a skill violation) and surface to the orchestrator. (Mirrors orchestrator E5; restated here so the worker does not need E5 in view — F-8.)
```

- [ ] **Step 2: Verify + commit**

Run:
```bash
grep -q 'Floor (self-contained)' .claude/skills/backlog-next/SKILL.md && echo "ok: worker floor" || echo "FAIL"
```
Expected: `ok: worker floor`.

```bash
git add .claude/skills/backlog-next/SKILL.md
git commit --no-verify -m "fix(backlog-next): worker epic-member mode carries a self-contained floor rule (F-8)"
git log --oneline -1
```

---

### Task 5: Whole-change consistency review (Done-when proof)

**Files:** none (verification only).

- [ ] **Step 1: Re-run the script test + CLI smoke**

Run:
```bash
node --test .claude/skills/backlog-next-epic/test/detect-fork-blast-radius.test.mjs 2>&1 | grep -E "ℹ (tests|pass|fail)"
node .claude/skills/backlog-next-epic/detect-fork-blast-radius.mjs ZZZ_NOPE_XYZ ; echo "exit=$? (expect 0)"
```
Expected: 3/3 pass; exit 0.

- [ ] **Step 2: Done-when grep checklist across both skills**

Run:
```bash
E=.claude/skills/backlog-next-epic/SKILL.md ; W=.claude/skills/backlog-next/SKILL.md
echo "1 floor only resolvable via AskUserQuestion:"; grep -c 'MUST be an \*\*AskUserQuestion\*\*' "$E"
echo "2 --auto never self-merges (no auto-pick Option 2 left):"; grep -c 'auto-pick Option 2' "$E"  # expect 0
echo "3 blast-radius gate before auto-resolve:"; grep -c 'detect-fork-blast-radius.mjs <fork-subject-symbol>' "$E"
echo "4 append-only log:"; grep -c 'append-only' "$E"
echo "5 worker self-contained floor:"; grep -c 'Floor (self-contained)' "$W"
echo "6 always stop at open PR / e8 marker:"; grep -c 'PR_OPEN_AWAITING_MERGE' "$E"
```
Expected: line "2" prints `0`; all others print ≥1.

- [ ] **Step 3: Lint stays green (skills changed, no backlog frontmatter touched yet)**

Run: `node .claude/skills/backlog-lint/lint.mjs 2>&1 | tail -1`
Expected: `✓ 340 backlog files; all 11 rules pass`.

- [ ] **Step 4: Confirm clean tree**

Run: `git status --short`
Expected: empty.

## Self-Review

**Spec coverage:** §1 script → Task 1. §2 E5 (case-2/case-3/floor/floor-surface + append-only) → Task 2. §3 E8 merge ownership + resume tail + e8 marker → Task 3. §5 F-8 worker floor → Task 4. §6 testing → Task 1 (script test) + Task 5 (prose consistency review). §4 boundary handoffs → enforced by NOT implementing #3/#4 (the e8 marker is defined, not schema-formalized; the tail is working, not hardened). No gaps.

**Placeholder scan:** Every prose edit shows the exact old anchor + the exact new text; every code step shows complete code; every run step shows the command + expected output. No TBD/TODO.

**Type consistency:** `scanSurfaces`/`isSurfaceFile`/`SURFACE_PATTERNS` names identical in Task 1 impl + test. The marker string `PR_OPEN_AWAITING_MERGE`, the script path `detect-fork-blast-radius.mjs`, and the grep acceptance strings are identical across Tasks 1–5. The branch-delete-only-in-tail invariant (Task 3 Step 6) matches the E8.2/E8.4 split.
