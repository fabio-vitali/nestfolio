---
name: backlog-add
description: File a side-finding into docs/backlog/ via the epic-aware hot-path router (fold into active epic, join a theme epic, suggest a new aggregation, or orphan) and refresh docs/BACKLOG.md. Use when an out-of-scope bug or future improvement surfaces during execution without pivoting from the active workstream.
---

## When this skill applies

Invoke when:
- An out-of-scope failure surfaces during validation of an active spec/plan.
- The user says "park this", "file this for later", "add to backlog".
- A side-finding deserves to be tracked but doesn't justify pivoting.

Do NOT invoke when:
- The finding actually blocks the active workstream's done-definition (then it IS in scope).
- The user is starting a new workstream — use `superpowers:brainstorming` and create the file with `status: queued` or `status: active`.

## What this skill does

Routes a side-finding to the **right home** (so the parking lot stays bounded — see `CLAUDE.md`
§ "Backlog Discipline" → Epics) and writes `docs/backlog/<id>.md`, then runs `backlog-lint --fix`
to regenerate the index.

## Runtime engine path (`RUNTIME_ENGINE`)

When `RUNTIME_ENGINE` is set (read via `usesRuntimeEngine(process.env)` — `runtime/engine/lib/path-provenance.mjs:13`), the **runtime engine drives intake** instead of the prose router below. Hard cutover — on a runtime-path failure, pause at the floor; do **not** silently fall back to the prose path (a deliberate legacy fallback is a human act that journals `path:legacy-fallback`).

1. Write the finding as JSON — the Finding shape `{id, check?, kind, scope, detail, raised_at}`. Omit `check` (or set the reserved `agent-observed` sentinel) for an agent-observed side-finding with no originating check.
2. Run `node runtime/adapters/claude-code/run-intake.mjs --finding <finding.json>`. It **parks** (exit 3) on the route-classification judgment with a pending key `execute:intake-<finding-id>`; the pre-computed decision context (active epic + `done_when`/`scope`, parking theme epics, parking orphans) is embedded in the parked task. Answer with the route JSON via `--fulfil execute:intake-<finding-id> --value '{"taskId":"intake-<id>","status":"done","summary":"{\"route\":\"…\",\"epic\":\"…\",\"epicRole\":\"…\"}"}'`.
3. On exit 0 the driver has written the item file(s), regenerated `docs/BACKLOG.md` (the `lint --fix` side-car), and journaled `path:runtime` + `intake:<id>:filed`. Then **commit** the written file(s) with the route-correct `docs(backlog):` message, staging ONLY the touched files.

When `RUNTIME_ENGINE` is unset, follow the legacy prose procedure below (retained byte-for-byte until P6 legacy retirement).

## The hot-path router (decide cheaply, then write)

This is the **cheap** routing pass; the heavy all-vs-all clustering lives in `/backlog-themes`.
First load context: is there an `active` epic? (`grep -l '^status: active' docs/backlog/*.md`
then check `type: epic`). Read its `scope:` / `out_of_scope:`. Then walk the finding down:

1. **Thematically near the active epic?** → fold in as a **member**: set `epic: <active-epic-id>`.
   Pick the role by the **closure-predicate test** — read the epic's `done_when:`, not just `scope:`:
   - leaving this finding undone would make a `done_when:` clause literally false (everything in
     `scope:` qualifies, plus anything else `done_when` requires) → `epic_role: core` (part of the
     done-definition; rule 9 drains it).
   - genuinely *orthogonal* to `done_when:` — near the theme but not required for the epic to be
     done → `epic_role: captured` (rides along, never blocks closure; spun out at close).
   - **When unsure whether it's load-bearing, choose `core`.** A captured member silently
     leftover-spins-out at close, so misfiling required work as captured drops it from the
     done-definition. Be generous folding things *in*; be conservative calling them *captured*.
   - **Atomicity — one item = one closure verdict.** If the finding's sub-parts split across the
     verdict (some required for `done_when`, others orthogonal or blocked on out-of-scope work),
     file them as **separate** homogeneous items — never one mixed item. A mixed item cannot carry
     a correct `epic_role` and hides its required half under the captured label.
2. **Else does it match an existing theme epic?** (`grep -l '^type: epic' docs/backlog/*.md` with
   `status: parking`, compare root cause) → join it: `epic: <theme-epic-id>`, `epic_role: core`.
3. **Else does it share a root cause with ≥1 existing parking orphans?** (quick scan of parking
   notes) → file the finding as a parking **orphan** now (the safe home that needs no agreement —
   branch 4's write) AND emit a **one-line, non-blocking suggestion** to mint a new theme epic
   aggregating it with the matching orphans (name them). **Do not pause / block to ask** —
   file-and-continue is the contract, and the actual mint is the sanctioned `/backlog-themes`
   cold-path job (or a later explicit user request). Interactively, if the user agrees in the same
   turn, you may mint on the spot — create the `type: epic` file (template below) and set `epic:` on
   this finding + the matching orphans; headless or mid-workstream, the suggestion is enough.
4. **Else** → plain parking **orphan** (no `epic:` pointer). The genuine residue; the next
   `/backlog-themes` sweep will try to cluster it.

Announce which branch fired and why (one line). The only judgment here is "near the active epic?"
— everything heavier defers to the cold-path sweep.

## Procedure

1. Take the one-liner from the user (or args). If unclear, ask once for: title, type (`bug` | `refactor` | `tooling` | `infra` | `design` | `spec`), and any file:line evidence to put in the body.
2. **Run the hot-path router above** to decide the home (`epic:` / `epic_role:` or orphan).
3. Compute the `id`: kebab-case slug from the title, ≤ 60 chars, must be unique. Verify with `ls docs/backlog/<id>.md` — if it exists, append `-2`, `-3`, etc.
4. Write `docs/backlog/<id>.md` using the template below (add `epic:` / `epic_role:` when routed to an epic).
5. Run `node .claude/skills/backlog-lint/lint.mjs --fix` to refresh `docs/BACKLOG.md` and verify the new file passes (incl. rule 10 — the `epic:` pointer must resolve to a real epic).
6. **Commit immediately.** Stage ONLY the file(s) you touched (`docs/backlog/<id>.md`, any new epic file, `docs/BACKLOG.md`). Do NOT use `git add .`. Commit with `docs(backlog): file <id>` (parking/member), `docs(backlog): mint epic <id>` (new theme epic), `docs(backlog): promote <id> to QUEUED` (queued), or `docs(backlog): ship <id>` (shipped).
7. Report the branch taken, e.g.: "Folded into active epic `<epic>` as `captured`: `<id>` (commit `<sha>`). Resuming active workstream." or "Filed as orphan: `<id>` — no theme match (commit `<sha>`)."

## File template (parking, default)

```markdown
---
id: <slug>
status: parking
type: bug
notes: "<one-line summary, ≤ 100 chars, shown in BACKLOG.md index>"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
# epic: <epic-id>          # set ONLY when routed to an epic (router branches 1–3)
# epic_role: core|captured # core = drives closure; captured = rides along
---

# <Title>

<Evidence: file:line refs, hypothesis, cheapest next step. Pointer to topic memory if one exists.>
```

> **Always emit `notes:` (and any free-text scalar) as a double-quoted string** — as templated above, never a bare value. A bare one-liner that begins with `-` or `:` parses as a YAML list/map, not a string. The lint read-side is now total (it locates such a file via the `frontmatter-parseable` gate rather than crashing), but quoting keeps the write correct at the source.

## File template (theme epic — router branch 3)

When minting a new theme epic to aggregate a root-cause cluster:

```markdown
---
id: <epic-slug>
status: parking          # a theme epic is a durable bucket; promote to active when you tackle it
type: epic
notes: "<one-line theme summary>"
done_when: "<closure narrative — e.g. all core members shipped/dropped>"
scope: "<what folds in as a core member — the shared root cause / debt / inconsistency>"
out_of_scope:
  - "<what NOT to absorb — the scope-creep guard>"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# <Theme Title>

<Root cause in one paragraph. List the members it aggregates by id. The fix pattern that drains them.>
```

Then set `epic: <epic-slug>` + `epic_role: core` on each member file. Membership is **derived**
from those pointers — never hand-list members on the epic.

## File template (active or queued)

For status `active`, also fill `out_of_scope:` (rule 4) and `references:` if `type ∈ {design, spec}` (rule 3).
For an **active epic**, also fill `done_when:` + `scope:` (rule 4 epic variant).
For status `queued`, also fill `rank:` (rule 6).
For status `shipped`, fill `validation_gate:` (rule 5). For a **shipped epic**, every `core` member must already be terminal and every open `captured` member re-homed (rule 9).

## Why auto-commit

Uncommitted backlog edits don't travel cleanly across worktrees, don't survive crashes, and accumulate as hidden todos. File-and-continue should be atomic. The `docs(backlog):` commit prefix is grep-able and squash-merge collapses on PRs.

## Examples of good entries

```markdown
- **`OnboardingRepository.updatePhase` ValidationException on non-mandate commits** — latent backend bug; non-blocking for onboarding e2e per Spec 3 ship.
- **BFF resolver region sweep** — advisory-bff + ledger-bff mutation resolvers likely missing `region` field.
```

## Examples of BAD entries (avoid)

- "TODO: investigate something" (no evidence)
- "Fix the bug we saw earlier" (no path to action)

If you can't be specific, ask one clarifying question before filing.
