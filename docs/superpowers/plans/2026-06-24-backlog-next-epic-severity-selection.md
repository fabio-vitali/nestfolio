# `/backlog-next-epic` severity-aware selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `/backlog-next-epic` rank its candidate epic list by impact (default) or a free-text `--like` criterion, computed at selection time and always human-confirmed — with no persisted severity field.

**Architecture:** Add two pure, unit-tested functions + two thin CLI modes to the existing `epic-members.mjs` helper: `candidateEpics()` (deterministic gather of open epics + core-member counts) and `classifyPositional()` (the one ambiguous arg case, id-vs-criterion). The *ranking itself* stays model judgment in the SKILL prose, fed by the helper output and a shared read-time `severity-rubric.md`; selection always ends in an `AskUserQuestion` confirm (E5 floor). Nothing is written back to frontmatter.

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert/strict`, the existing `backlog-lint/lib/frontmatter.mjs` loader. Markdown for the rubric + SKILL prose. No nx, no deploy, no AWS — pure local tooling.

## Global Constraints

- Tests live in `.claude/skills/backlog-next-epic/test/` (NOT `src/__tests__/`). Extend the existing `epic-members.test.mjs`.
- Run tests with the **glob** form: `node --test .claude/skills/backlog-next-epic/test/*.test.mjs` (`node --test <dir>` does not discover suites on Node 24).
- Pure functions take hand-built `records` arrays of `{ id, fm }` (the established test style); filesystem cases use `loadRecords(dir)` with a temp dir.
- No behaviour change beyond candidate ordering + the new arg forms; do NOT touch any of the 11 lint invariants or any frontmatter schema.
- No persisted `severity`/`urgency` field anywhere. The rubric is consulted at read time only.
- Commit messages: `feat(backlog-next-epic): …`. This is tooling on the active workstream `backlog-next-epic-severity-selection`; commit small and frequently.
- Spec: `docs/superpowers/specs/2026-06-24-backlog-next-epic-severity-selection-design.md`.

---

## File Structure

- **Modify** `.claude/skills/backlog-next-epic/epic-members.mjs` — add `candidateEpics()` + `classifyPositional()` exports + module-local `candidateOrder` + `--candidates` / `--classify` CLI modes in `main()`.
- **Modify** `.claude/skills/backlog-next-epic/test/epic-members.test.mjs` — add tests for the two new functions (extend the import + append cases).
- **Create** `.claude/skills/backlog-lint/lib/severity-rubric.md` — the shared 4-level impact rubric (read-time scoring guide; persisted-nowhere).
- **Modify** `.claude/skills/backlog-next-epic/SKILL.md` — new "Selecting the epic" section, the 3-form surface in "When to invoke", and the E5 floor bullet.

---

## Task 1: Candidate-gather helper (`candidateEpics` + `classifyPositional`)

**Files:**
- Modify: `.claude/skills/backlog-next-epic/epic-members.mjs`
- Test: `.claude/skills/backlog-next-epic/test/epic-members.test.mjs`

**Interfaces:**
- Consumes: existing exports `coreMembers(records, epicId)`, `openMembers(members)`, and the module constant `OPEN_STATUSES` (already in `epic-members.mjs`).
- Produces:
  - `candidateEpics(records) -> Array<{ id, status, rank: number|undefined, openCore: number, totalCore: number, notes: string }>` — every `type:epic` record whose `status ∈ {active,queued,parking}`, annotated and ordered (active, then queued-by-rank, then parking-by-id).
  - `classifyPositional(records, phrase) -> { kind: 'epic-id', id } | { kind: 'criterion', text }`.
  - CLI: `node epic-members.mjs --candidates` and `node epic-members.mjs --classify "<phrase>"`.

- [ ] **Step 1: Write the failing tests**

Add to the import block at the top of `.claude/skills/backlog-next-epic/test/epic-members.test.mjs`:

```js
import {
  coreMembers,
  openMembers,
  isDrainable,
  selectNextMember,
  loadRecords,
  activeEpics,
  candidateEpics,
  classifyPositional,
} from '../epic-members.mjs';
```

Append these cases to the end of the file:

```js
const epicRecords = [
  { id: 'E-active', fm: { type: 'epic', status: 'active', notes: 'in flight' } },
  { id: 'E-q2', fm: { type: 'epic', status: 'queued', rank: 2 } },
  { id: 'E-q1', fm: { type: 'epic', status: 'queued', rank: 1 } },
  { id: 'E-parkB', fm: { type: 'epic', status: 'parking' } },
  { id: 'E-parkA', fm: { type: 'epic', status: 'parking' } },
  { id: 'E-shipped', fm: { type: 'epic', status: 'shipped' } },
  { id: 'not-epic', fm: { type: 'bug', status: 'parking' } },
  // members of E-active: 1 open core + 1 shipped core + 1 captured (excluded from core)
  { id: 'm1', fm: { epic: 'E-active', status: 'queued', rank: 1, epic_role: 'core' } },
  { id: 'm2', fm: { epic: 'E-active', status: 'shipped', epic_role: 'core' } },
  { id: 'm3', fm: { epic: 'E-active', status: 'parking', epic_role: 'captured' } },
];

test('candidateEpics: open epics only, ordered active → queued-by-rank → parking-by-id', () => {
  const cands = candidateEpics(epicRecords);
  assert.deepEqual(
    cands.map((c) => c.id),
    ['E-active', 'E-q1', 'E-q2', 'E-parkA', 'E-parkB'],
  );
});

test('candidateEpics: annotates open/total CORE counts (captured excluded, shipped not open)', () => {
  const active = candidateEpics(epicRecords).find((c) => c.id === 'E-active');
  assert.equal(active.openCore, 1); // m1 open; m2 shipped (not open); m3 captured (not core)
  assert.equal(active.totalCore, 2); // m1 + m2
  assert.equal(active.status, 'active');
});

test('candidateEpics: excludes shipped/dropped epics and non-epic files', () => {
  const ids = candidateEpics(epicRecords).map((c) => c.id);
  assert.ok(!ids.includes('E-shipped'));
  assert.ok(!ids.includes('not-epic'));
});

test('classifyPositional: matching type:epic id → epic-id; else criterion', () => {
  assert.deepEqual(classifyPositional(epicRecords, 'E-q1'), { kind: 'epic-id', id: 'E-q1' });
  assert.deepEqual(classifyPositional(epicRecords, 'fix worst bug'), {
    kind: 'criterion',
    text: 'fix worst bug',
  });
  // a non-epic file id is NOT an epic-id → criterion (only type:epic matches)
  assert.deepEqual(classifyPositional(epicRecords, 'not-epic'), {
    kind: 'criterion',
    text: 'not-epic',
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test .claude/skills/backlog-next-epic/test/*.test.mjs`
Expected: FAIL — `candidateEpics`/`classifyPositional` are `undefined` (not exported yet).

- [ ] **Step 3: Implement the two pure functions + ordering helper**

In `.claude/skills/backlog-next-epic/epic-members.mjs`, after the existing `activeEpics(...)` export (just before `selectNextMember`), add:

```js
const CANDIDATE_STATUS_ORDER = { active: 0, queued: 1, parking: 2 };

/** Deterministic base order for the candidate menu: active first, then queued by rank
 * (missing rank last), then parking alphabetically. The impact RANKING is applied on top
 * of this by the SKILL (model judgment) — this only gives a stable, reproducible baseline. */
function candidateOrder(a, b) {
  const sa = CANDIDATE_STATUS_ORDER[a.status];
  const sb = CANDIDATE_STATUS_ORDER[b.status];
  if (sa !== sb) return sa - sb;
  if (a.status === 'queued') {
    const ra = a.rank ?? Infinity;
    const rb = b.rank ?? Infinity;
    if (ra !== rb) return ra - rb;
  }
  return a.id.localeCompare(b.id);
}

/** Selection candidates: every `type:epic` record in an OPEN status (active|queued|parking),
 * annotated with its open/total CORE member counts (via the same coreMembers/openMembers logic
 * the member loop uses) and the fields a ranker needs. Shipped/dropped epics are excluded.
 * Feeds `--candidates` → the at-selection-time impact ranking. Persists nothing. */
export function candidateEpics(records) {
  return records
    .filter((r) => r.fm.type === 'epic' && OPEN_STATUSES.has(r.fm.status))
    .map((r) => {
      const core = coreMembers(records, r.id);
      return {
        id: r.id,
        status: r.fm.status,
        rank: r.fm.rank != null ? Number(r.fm.rank) : undefined,
        openCore: openMembers(core).length,
        totalCore: core.length,
        notes: r.fm.notes ?? '',
      };
    })
    .sort(candidateOrder);
}

/** Disambiguate a bare positional arg: an exact match against a `type:epic` file id is an
 * epic-id; anything else is a free-text criterion. The `--like` flag and the no-arg default
 * are decided by the caller — this resolves only the single ambiguous case. */
export function classifyPositional(records, phrase) {
  const hit = records.find((r) => r.id === phrase && r.fm.type === 'epic');
  return hit ? { kind: 'epic-id', id: phrase } : { kind: 'criterion', text: phrase };
}
```

- [ ] **Step 4: Add the two CLI modes**

In `main()`, immediately after the existing `if (args.includes('--active-epics')) { … }` block (around line 113), add:

```js
  // Selection gather: emit every open epic with its open/total core counts + notes, in the
  // deterministic baseline order. The SKILL ranks this by impact (default) or --like criterion.
  if (args.includes('--candidates')) {
    const cands = candidateEpics(records);
    console.log(`candidates (${cands.length}):`);
    for (const c of cands) {
      const note = c.notes ? `  — ${c.notes}` : '';
      console.log(`  ${c.status.padEnd(8)} rank=${c.rank ?? '-'}  core=${c.openCore}/${c.totalCore}  ${c.id}${note}`);
    }
    process.exit(0);
  }

  // Disambiguate a bare positional arg into an epic id or a free-text criterion.
  const classifyIdx = args.indexOf('--classify');
  if (classifyIdx !== -1) {
    const phrase = args[classifyIdx + 1];
    if (!phrase) {
      console.error('Usage: epic-members.mjs --classify "<phrase>"');
      process.exit(1);
    }
    const res = classifyPositional(records, phrase);
    console.log(res.kind === 'epic-id' ? `epic-id=${res.id}` : 'criterion');
    process.exit(0);
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test .claude/skills/backlog-next-epic/test/*.test.mjs`
Expected: PASS — all existing suites + the 4 new cases green.

- [ ] **Step 6: Smoke-test the CLI against the real backlog**

Run: `node .claude/skills/backlog-next-epic/epic-members.mjs --candidates`
Expected: a `candidates (N):` list including `parking ... backlog-skills-simplification` with a `core=2/2` count and its notes.
Run: `node .claude/skills/backlog-next-epic/epic-members.mjs --classify "backlog-skills-simplification"`
Expected: `epic-id=backlog-skills-simplification`.
Run: `node .claude/skills/backlog-next-epic/epic-members.mjs --classify "fix worst bug"`
Expected: `criterion`.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/backlog-next-epic/epic-members.mjs .claude/skills/backlog-next-epic/test/epic-members.test.mjs
git commit -m "feat(backlog-next-epic): candidateEpics + classifyPositional gather helpers"
```

---

## Task 2: Severity rubric doc + SKILL.md selection wiring

**Files:**
- Create: `.claude/skills/backlog-lint/lib/severity-rubric.md`
- Modify: `.claude/skills/backlog-next-epic/SKILL.md`

**Interfaces:**
- Consumes: `node epic-members.mjs --candidates` and `--classify "<phrase>"` from Task 1; the rubric file path.
- Produces: the user-facing selection behaviour (no code interface; verified by reading + a CLI smoke).

- [ ] **Step 1: Create the rubric doc**

Create `.claude/skills/backlog-lint/lib/severity-rubric.md`:

```markdown
# Severity / impact rubric (read-time scoring guide)

Used to make "impact" consistent across `/backlog-next-epic` selection runs. **Consulted at
selection time only — never written into frontmatter.** Four ordinal levels (impact *if left
undone*):

- **critical** — data loss / silent prod leak / real-money correctness / blocks all e2e.
- **high** — broken flow with no workaround / latent crash on a common path / blocks a domain's e2e.
- **medium** — degraded UX or correctness with a workaround / single-service latent bug.
- **low** — cosmetic / cleanup / docs drift / speculative hardening.

## Scoring an epic

An epic's impact is the **aggregate blast-radius of its theme** — the judgment `/backlog-themes`
already makes when it prints a cluster's blast radius. Weigh, in order:

1. The worst-level finding the epic's `scope:` / `done_when:` / member notes describe (an epic that
   contains a `critical` member is at least `high` at the epic level).
2. **Breadth** — how many services / domains / consumers the theme touches (more breadth raises it).
3. **Open core-member count** (`core=open/total` from `--candidates`) — a larger amount of unfinished
   load-bearing work raises urgency; a nearly-drained epic is lower.

Ties break toward the more **reusable / cross-cutting** theme (project rule: reusability breaks ties).
Output a single level per epic plus a one-line reason; this drives the menu order, not a stored value.
```

- [ ] **Step 2: Add the "Selecting the epic" section to SKILL.md**

In `.claude/skills/backlog-next-epic/SKILL.md`, insert this new section immediately **after** the "### Resume gate (check FIRST, before E0)" section and **before** "### E0. Epic-start preflight":

```markdown
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
```

- [ ] **Step 3: Update the "When to invoke" form bullets**

In `.claude/skills/backlog-next-epic/SKILL.md`, replace the existing `<epic-id>` bullet under "## When to invoke":

Find:
```markdown
- `<epic-id>` — a `type: epic` backlog file. Without it, list the candidate epics (active delivery epic first, then `queued`, then parking theme epics with open-core-member counts) and ask which to run.
```

Replace with:
```markdown
- `<epic-id>` — a `type: epic` backlog file. Without it, the orchestrator selects the epic by **impact** (default) or a `--like "<criteria>"` criterion — see § "Selecting the epic". A bare arg that isn't an epic id is treated as a criterion (so `/backlog-next-epic fix worst bug` works). Selection ALWAYS ends in an `AskUserQuestion` confirm.
- `--like "<criteria>"` — rank candidate epics by a free-text criterion instead of by impact (for fuzzy/thematic intents the rubric can't express). Still confirmed via `AskUserQuestion`.
```

- [ ] **Step 4: Add the E5 floor bullet**

In `.claude/skills/backlog-next-epic/SKILL.md`, in the "**Hard floor — pause even in `--auto`**" list under "### E5. Decision handling", add this bullet:

```markdown
  - **Computed-selection pick (default impact-rank or `--like`)** — an epic chosen by a computed ordering MUST be confirmed by the user via the § "Selecting the epic" `AskUserQuestion`, **even in `--auto`**. `--auto` never auto-launches the top-ranked epic onto a whole branch/deploy/e2e budget. An explicit `<epic-id>` is a user pick and is unaffected.
```

- [ ] **Step 5: Verify the wiring end-to-end (manual)**

Re-run the smoke from Task 1 Step 6 and read the new SKILL.md section back. Confirm:
- `--candidates` lists the real epics with counts (the data the rank step consumes exists).
- `--classify` returns `epic-id=…` for a real epic id and `criterion` for free text (the disambiguation the table relies on works).
- The "Selecting the epic" table, the two "When to invoke" bullets, and the E5 floor bullet are mutually consistent (default→impact, `--like`→criterion, both→confirm, `<epic-id>`→direct/unaffected).

Run the helper tests once more to be safe: `node --test .claude/skills/backlog-next-epic/test/*.test.mjs` → PASS.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/backlog-lint/lib/severity-rubric.md .claude/skills/backlog-next-epic/SKILL.md
git commit -m "feat(backlog-next-epic): impact-ranked / --like epic selection + severity rubric"
```

---

## Self-Review

**1. Spec coverage:**
- §4.1 three form surface → Task 2 Steps 2–3 (table + bullets). ✓
- §4.2 `rank` stays authoritative → Task 1 `candidateOrder` (queued-by-rank baseline) + Task 2 Step 2 ("queued KEEP rank; severity orders only parking tail"). ✓
- §4.3.1 `--candidates` gather helper → Task 1. ✓
- §4.3.2 `severity-rubric.md` → Task 2 Step 1. ✓
- §4.3.3 SKILL arg parsing + rank→confirm → Task 2 Steps 2–3. ✓
- §4.3.4 E5 floor update → Task 2 Step 4. ✓
- §4.4 data flow (resume → candidates → rank → confirm → E0) → Task 2 Step 2. ✓
- §5 rubric levels + epic blast-radius scoring → Task 2 Step 1. ✓
- §6 edge cases: no candidates (Task 2 Step 2 "Zero candidates → stop"); ambiguous arg (Task 1 `classifyPositional` + tests); `--auto` pauses (Task 2 Step 4 floor). ✓
- §7 testing: gather + disambiguation unit-tested (Task 1 Steps 1–5); ranking model-judged (not unit-tested, by design). ✓
- §9 out of scope: no persisted field / no lint/index/schema change / no `/backlog-recalibrate` / no `/backlog-next` mirror — none of the tasks add these. ✓

**2. Placeholder scan:** No TBD/TODO; every code + prose block is literal. ✓

**3. Type consistency:** `candidateEpics` returns `{id,status,rank,openCore,totalCore,notes}` — the same shape consumed by the `--candidates` printer (Task 1 Step 4) and referenced as `core=open/total` in the rubric (Task 2 Step 1) and SKILL table (Task 2 Step 2). `classifyPositional` returns `{kind:'epic-id',id}` / `{kind:'criterion',text}` — matched by the tests (Task 1 Step 1) and the `--classify` printer (`epic-id=<id>` / `criterion`, Task 1 Step 4) and the SKILL `--classify` table row (Task 2 Step 2). ✓

## Notes for execution

- **Lane:** tooling-only — a `.mjs` helper + tests + two docs. No services, no `nx`, no deploy, no e2e. Small, reversible, fully covered by `node --test`. Reasonable to execute on `main` (Simple lane) per the sole-dev "simple fixes stay on main" policy; upgrade to a worktree only if the SKILL edit grows. Decide at the execution handoff.
- After the final commit, run `node .claude/skills/backlog-lint/lint.mjs --fix` (should be a no-op for these files, but confirms the backlog index is still clean) and ship the active item `backlog-next-epic-severity-selection` → `status: shipped` with the commit SHAs + `node --test` output as the `validation_gate`.
