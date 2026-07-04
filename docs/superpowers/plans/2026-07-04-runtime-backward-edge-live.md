# Runtime Backward Edge Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the backward edge live-in-anger: epoch-safe mint/curate ring-1 deltas, a park/fulfil floor driver (`run-backward.mjs`), a journaled+adjudicated `RUNTIME_GATE_SKIP`, a ship-boundary recheck, and postflight evidence checks — then close this very workstream through the new ritual (mint-in-anger).

**Architecture:** Approach A from the spec (`docs/superpowers/specs/2026-07-04-runtime-backward-edge-live-design.md`): four ring-1 deltas inside `runtime/engine/backward/`, one new ring-2 driver in `runtime/adapters/claude-code/`, gate changes + a new recheck in `runtime/adapters/git/`, and ritual wiring in `.claude/skills/backlog-next{,-epic}/`. Ring discipline: ring-1 imports nothing from adapters; project-side scripts (postflight) MAY import `runtime/engine/lib` (allowed direction).

**Tech Stack:** Node 24 ESM (`.mjs` + type-stripped `.ts` zod schemas), `node:test`, `yaml` package, git-native NDJSON journal.

## Global Constraints

- Worktree: `/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/runtime-backward-edge-live`, branch `worktree-runtime-backward-edge-live`. Use this absolute prefix for every file operation; run all commands from this directory.
- **Commits MUST use `--no-verify`** (worktree pre-commit hook rejects code commits silently — project SOP) **and each commit must be verified with `git log --oneline -1`**. This is exactly the debt `ship-recheck.mjs` (Task 11) exists to adjudicate at close.
- Tests run via direct globs, never nx (nx cannot run in a worktree): `node --test <dir>/*.test.mjs`. Type check: `npx tsc --noEmit -p runtime/tsconfig.json`.
- Journal runIds are fixed strings: `backward` (floor acts + ship evidence), `gate-skips` (skip ledger). Journal root = git-common-dir (`makeJournal({})` default) — shared across worktrees, survives worktree removal.
- Epoch convention: `generation` absent ⇒ 1. Journal keys `mint:<id>:g<N>:ratify` / `curate:<id>:g<N>:<transition>`; Decision ids `mint-<id>-g<N>` / `curate-<id>-g<N>` (ALWAYS carry the epoch, including g1).
- Out of scope (do NOT touch): `--diff-filter=ACMR` on the *pre-commit gate* (stays ACM — redteam-hardening item), journal locking, atomic meta.json, registry-integrity CLI, baseline-relative gate semantics, the ~23-surface check migration.

## File Structure

| File | Change |
|---|---|
| `runtime/engine/schema/check.schema.ts` | `ProvenanceSchema` += optional `generation` |
| `runtime/engine/backward/schema/mints-entry.ts` | `MintsEntrySchema` += optional `generation` |
| `runtime/engine/backward/lib/reconcile-lesson.mjs` | generation-aware entry keying + gen-N append |
| `runtime/engine/backward/lib/draft-candidate.mjs` | accepts `proposal.generation` |
| `runtime/engine/backward/lib/present-floor.mjs` | epoch Decision ids + full-act `context` render |
| `runtime/engine/backward/lib/register-ratified.mjs` | epoch journal key + generation into reconcile |
| `runtime/engine/backward/lib/curate-guard.mjs` | reconcile-before-write, epoch key, draft-shaped successor w/ full mint guarantees, `scenariosDir` |
| `runtime/engine/backward/lib/curate.mjs` | `scenariosDir` threading, draft-shaped `proposedSuccessor` |
| `runtime/adapters/claude-code/run-backward.mjs` | **new** — mint/curate/consider park-fulfil driver |
| `runtime/adapters/git/pre-commit-gate.mjs` | curate-first block message; journaled fail-closed skip |
| `runtime/adapters/git/ship-recheck.mjs` | **new** — branch-delta recheck + gate-clean evidence |
| `runtime/runtime.config.json` | += `lessonsDir`, `scenariosDir` |
| `.claude/skills/backlog-next/postflight.mjs` | += `ship-gate-evidence` + `mint-considered` checks |
| `.claude/skills/backlog-next/SKILL.md` | += step 6.4b (ritual); epic-member delta |
| `.claude/skills/backlog-next-epic/SKILL.md` | += E6 step 5 (epic-batched ritual) |
| Tests | `runtime/engine/backward/test/{epoch,torn-curate,successor-goldens}` (new) + updates; `runtime/adapters/claude-code/test/run-backward.test.mjs` (new); `runtime/adapters/git/test/{pre-commit-gate,ship-recheck}.test.mjs`; `.claude/skills/backlog-next/test/backward-evidence.test.mjs` (new) |
| Close-phase (conditional) | `tools/check-pipe-mask.mjs`, `runtime/eval/scenarios/fixtures/no-pipe-exit-masking/**`, mint proposal JSON (Task 15) |

---

### Task 1: Epoch schema fields (`generation` on Provenance + MintsEntry)

**Files:**
- Modify: `runtime/engine/schema/check.schema.ts:60-68` (ProvenanceSchema)
- Modify: `runtime/engine/backward/schema/mints-entry.ts:6-16`
- Test: `runtime/engine/backward/test/mints-entry.test.mjs` (append), `runtime/engine/test/check-schema.test.mjs` (append)

**Interfaces:**
- Produces: `ProvenanceSchema` accepts optional `generation: int ≥ 1`; `MintsEntrySchema` accepts optional `generation: int ≥ 1`. All later tasks rely on `x.provenance.generation ?? 1` / `entry.generation ?? 1` semantics.

- [ ] **Step 1: Write failing tests**

Append to `runtime/engine/backward/test/mints-entry.test.mjs`:

```js
test('EPOCH: generation is accepted as an int ≥ 1 and optional (absent = 1)', () => {
  const ok = validateMintsEntry({ check: 'x', ratified: '2026-07-04', status: 'active', generation: 2 });
  assert.equal(ok.ok, true);
  const bad = validateMintsEntry({ check: 'x', ratified: '2026-07-04', status: 'active', generation: 0 });
  assert.equal(bad.ok, false);
});
```

Append to `runtime/engine/test/check-schema.test.mjs` (use that file's existing valid-check factory/import style — read its imports first):

```js
test('EPOCH: provenance.generation optional int ≥ 1', () => {
  const base = validCheck({});
  const ok = validateCheck({ ...base, provenance: { ...base.provenance, generation: 2 } });
  assert.equal(ok.ok, true);
  const bad = validateCheck({ ...base, provenance: { ...base.provenance, generation: 1.5 } });
  assert.equal(bad.ok, false);
});
```

- [ ] **Step 2: Run to verify both fail** — `node --test runtime/engine/backward/test/mints-entry.test.mjs runtime/engine/test/check-schema.test.mjs` → the two EPOCH tests FAIL (strict schema rejects unknown key `generation`).

- [ ] **Step 3: Implement.** In `check.schema.ts` add to `ProvenanceSchema` (after `retired_reason`):

```ts
  generation: z.number().int().min(1).optional(),   // lifecycle epoch (§2.4): absent = 1; re-mint of a terminal id bumps it
```

In `mints-entry.ts` add to `MintsEntrySchema` (after `superseded_by`):

```ts
  generation: z.number().int().min(1).optional(),   // epoch of the minted check (absent = 1); entries keyed by (check, generation)
```

- [ ] **Step 4: Re-run — both PASS.** Also `npx tsc --noEmit -p runtime/tsconfig.json`.
- [ ] **Step 5: Commit** — `git add -A runtime/engine && git commit --no-verify -m "feat(runtime): provenance + mints-entry gain optional lifecycle generation (epoch)" && git log --oneline -1`

---

### Task 2: `reconcileLesson` becomes generation-aware

**Files:**
- Modify: `runtime/engine/backward/lib/reconcile-lesson.mjs:22-45`
- Test: `runtime/engine/backward/test/reconcile-lesson.test.mjs` (append)

**Interfaces:**
- Produces: `reconcileLesson({ lesson, check, transition, successor, ratified, dossierRoot, generation = 1 })`. Entries matched by `(e.check === check && (e.generation ?? 1) === generation)`. A gen>1 ratify APPENDS `{check, ratified, status:'active', generation}` and leaves the prior terminal entry untouched.

- [ ] **Step 1: Write failing tests** (append; reuse the file's existing `writeDossier`/fixture style — read its imports first):

```js
test('EPOCH-R1 gen-2 ratify appends a second entry keyed (check, generation); gen-1 stays terminal', () =>
  withTmpContent(({ lessonsDir }) => {
    writeDossier(lessonsDir, 'feedback_g', { name: 'G', description: 'd', type: 'feedback',
      mints: [{ check: 'no-x', ratified: '2026-07-01', status: 'retired' }] });
    const { mints } = reconcileLesson({ lesson: 'feedback_g.md', check: 'no-x', transition: 'ratify',
      ratified: '2026-07-04', generation: 2, dossierRoot: lessonsDir });
    assert.equal(mints.length, 2);
    assert.equal(mints[0].status, 'retired');                       // gen-1 untouched
    assert.deepEqual(mints[1], { check: 'no-x', ratified: '2026-07-04', status: 'active', generation: 2 });
  }));

test('EPOCH-R2 retire targets only the matching generation', () =>
  withTmpContent(({ lessonsDir }) => {
    writeDossier(lessonsDir, 'feedback_g', { name: 'G', description: 'd', type: 'feedback',
      mints: [{ check: 'no-x', ratified: '2026-07-01', status: 'retired' },
              { check: 'no-x', ratified: '2026-07-04', status: 'active', generation: 2 }] });
    const { mints } = reconcileLesson({ lesson: 'feedback_g.md', check: 'no-x', transition: 'retire',
      generation: 2, dossierRoot: lessonsDir });
    assert.equal(mints[1].status, 'retired');
    assert.equal(mints[0].status, 'retired');                       // was already; untouched, not duplicated
  }));

test('EPOCH-R3 default generation=1 preserves existing behavior (idempotent ratify)', () =>
  withTmpContent(({ lessonsDir }) => {
    writeDossier(lessonsDir, 'feedback_g', { name: 'G', description: 'd', type: 'feedback',
      mints: [{ check: 'no-x', ratified: '2026-07-01', status: 'active' }] });
    const { mints } = reconcileLesson({ lesson: 'feedback_g.md', check: 'no-x', transition: 'ratify',
      ratified: '2026-07-04', dossierRoot: lessonsDir });
    assert.equal(mints.length, 1);                                  // no duplicate for (no-x, g1)
  }));
```

- [ ] **Step 2: Run to verify failure** — `node --test runtime/engine/backward/test/reconcile-lesson.test.mjs` (EPOCH-R1 fails: only 1 entry / no generation key).

- [ ] **Step 3: Implement.** Replace the transition block in `reconcile-lesson.mjs` (and add `generation = 1` to the destructured params):

```js
export function reconcileLesson({ lesson, check, transition, successor, ratified, dossierRoot, generation = 1 }) {
  const path = isAbsolute(lesson) ? lesson : join(dossierRoot, lesson);
  const { front, body } = readDossier(path);
  const mints = Array.isArray(front.mints) ? front.mints.map((e) => ({ ...e })) : [];
  const stamp = ratified ?? new Date().toISOString().slice(0, 10);
  const sameEpoch = (e) => e.check === check && (e.generation ?? 1) === generation;   // §2.4: keyed by (check, generation)

  if (transition === 'ratify') {
    if (!mints.some(sameEpoch)) mints.push({ check, ratified: stamp, status: 'active', ...(generation > 1 ? { generation } : {}) });
  } else if (transition === 'retire') {
    const e = mints.find(sameEpoch);
    if (e) e.status = 'retired';
  } else if (transition === 'supersede') {
    const e = mints.find(sameEpoch);
    if (e) { e.status = 'superseded'; e.superseded_by = successor; }
    if (successor && !mints.some((x) => x.check === successor)) mints.push({ check: successor, ratified: stamp, status: 'active' });
  } else {
    throw new Error(`reconcileLesson: unsupported transition '${transition}'`);
  }
  // …validation loop + write unchanged…
```

- [ ] **Step 4: Re-run — all reconcile-lesson tests PASS** (existing ones must stay green).
- [ ] **Step 5: Commit** — `git add -A runtime/engine/backward && git commit --no-verify -m "feat(runtime): reconcileLesson is generation-aware — re-mint appends a gen-N entry" && git log --oneline -1`

---

### Task 3: `draftCandidate` accepts `proposal.generation`

**Files:**
- Modify: `runtime/engine/backward/lib/draft-candidate.mjs:14-25`
- Test: `runtime/engine/backward/test/draft-candidate.test.mjs` (append)

**Interfaces:**
- Produces: a proposal with `generation: N` (N ≥ 2) yields `entry.provenance.generation === N`; absent ⇒ no `generation` key on provenance.

- [ ] **Step 1: Failing test** (append; mirror the file's existing proposal fixture — read it first, reuse its `proposal`/`item`/`lesson` factory):

```js
test('EPOCH-D1 proposal.generation lands on entry.provenance.generation; absent = no key', () => {
  const d2 = draftCandidate({ item, lesson, proposal: { ...proposal, generation: 2 } });
  assert.equal(d2.entry.provenance.generation, 2);
  const d1 = draftCandidate({ item, lesson, proposal });
  assert.equal('generation' in d1.entry.provenance, false);
});
```

- [ ] **Step 2: Run — FAILS** (`generation` undefined on provenance).
- [ ] **Step 3: Implement** — in `draft-candidate.mjs`, the `provenance` line becomes:

```js
    provenance: { minted_by: item.id, lesson: lessonRef(lesson),
      ...(proposal.generation != null && proposal.generation > 1 ? { generation: proposal.generation } : {}) },   // Δ2: NO ratified; §2.4 epoch
```

- [ ] **Step 4: Re-run — PASS.**
- [ ] **Step 5: Commit** — `git add -A runtime/engine/backward && git commit --no-verify -m "feat(runtime): draftCandidate carries the proposal's lifecycle generation" && git log --oneline -1`

---

### Task 4: `toDecision` — epoch ids + full-act render (§2.3)

**Files:**
- Modify: `runtime/engine/backward/lib/present-floor.mjs`
- Test: `runtime/engine/backward/test/present-floor.test.mjs` (update id assertions + append render tests)

**Interfaces:**
- Produces: `toDecision(choice)` → `Decision.id` = `mint-<id>-g<N>` / `curate-<id>-g<N>` (N from `entity.provenance.generation ?? 1`); `Decision.context` = full-act render (candidate YAML + rationale for mint; guard YAML + trigger + finding + successor YAML for curate). `presentFloor` behavior otherwise unchanged.

- [ ] **Step 1: Update + append tests.** In `present-floor.test.mjs`: change the existing assertion `assert.equal(d.id, 'mint-no-x')` to `assert.equal(d.id, 'mint-no-x-g1')` (and any sibling id assertions — grep the file for `'mint-` / `'curate-`). Append:

```js
test('FULL-RENDER mint: context carries the complete candidate YAML + rationale', () => {
  const entry = validCheck({ id: 'no-x', status: 'candidate', provenance: { minted_by: 'i', lesson: 'l.md' } });
  const d = toDecision({ act: 'mint', candidate: entry, lesson: 'l.md', rationale: 'why', recommended: 'ratify', options: ['ratify', 'edit', 'decline'] });
  assert.match(d.context, /RATIONALE: why/);
  assert.match(d.context, /candidate check \(full YAML\)/);
  assert.match(d.context, /id: no-x/);
  assert.match(d.context, /property:/);
});

test('FULL-RENDER curate: context carries guard YAML, trigger, finding, successor YAML', () => {
  const guard = validCheck({ id: 'no-x', status: 'active', provenance: { minted_by: 'i', ratified: 't' } });
  const successor = { entry: validCheck({ id: 'no-x-v2', status: 'active', provenance: { minted_by: 'i', ratified: 't' } }),
    eval_scenario: { path: 'p', fixtures: { good: [], bad: [] }, target_pass_rate: 1 }, rationale: 'narrower' };
  const d = toDecision({ act: 'curate', guard, trigger: 'ship-gate', finding: { id: 'f#0', check: 'no-x', kind: 'drift', scope: ['a.ts'], detail: 'x', raised_at: 't' },
    proposed_successor: successor, rationale: 'r', recommended: 'keep', options: ['retire', 'supersede', 'keep'] });
  assert.match(d.context, /TRIGGER: ship-gate/);
  assert.match(d.context, /current guard \(full YAML\)/);
  assert.match(d.context, /id: no-x-v2/);
  assert.match(d.context, /finding/);
});

test('EPOCH-P1 Decision ids are distinct across generations', () => {
  const g1 = validCheck({ id: 'no-x', status: 'candidate', provenance: { minted_by: 'i' } });
  const g2 = validCheck({ id: 'no-x', status: 'candidate', provenance: { minted_by: 'i', generation: 2 } });
  const mk = (c) => toDecision({ act: 'mint', candidate: c, lesson: 'l', rationale: 'r', recommended: 'ratify', options: ['ratify'] }).id;
  assert.equal(mk(g1), 'mint-no-x-g1');
  assert.equal(mk(g2), 'mint-no-x-g2');
});
```

(Import `validCheck` from `./_fixtures.mjs` if not already imported.)

- [ ] **Step 2: Run — new tests FAIL, old id test FAILS against current code** (expected; you updated it to the new contract).
- [ ] **Step 3: Implement.** Replace `toDecision` in `present-floor.mjs` (add `import { stringify } from 'yaml';` at top):

```js
/** §2.3: the Decision renders the COMPLETE act — the human never ratifies sight-unseen. */
function renderContext(choice) {
  if (choice.act === 'mint') {
    return [`RATIONALE: ${choice.rationale ?? ''}`,
      '--- candidate check (full YAML) ---',
      stringify(choice.candidate).trimEnd()].join('\n');
  }
  const parts = [`TRIGGER: ${choice.trigger}`, `RATIONALE: ${choice.rationale ?? ''}`,
    '--- current guard (full YAML) ---', stringify(choice.guard).trimEnd()];
  if (choice.finding) parts.push('--- finding ---', stringify(choice.finding).trimEnd());
  if (choice.proposed_successor) parts.push('--- proposed successor (full YAML) ---',
    stringify(choice.proposed_successor.entry ?? choice.proposed_successor).trimEnd());
  return parts.join('\n');
}

export function toDecision(choice) {
  const entity = choice.act === 'mint' ? choice.candidate : choice.guard;
  const gen = entity.provenance?.generation ?? 1;                  // §2.4: gen-1 fulfilment can never replay into gen-2
  const question = choice.act === 'mint'
    ? `Ratify candidate check "${entity.id}" minted from lesson ${choice.lesson}?`
    : `Curate check "${entity.id}" (${choice.trigger})?`;
  return {
    id: `${choice.act}-${entity.id}-g${gen}`,
    question,
    options: choice.options.map((v) => ({ label: v, value: v, recommended: v === choice.recommended })),
    context: renderContext(choice),
  };
}
```

`presentFloor` itself is unchanged (its sentinel line uses the raw check id — fine).

- [ ] **Step 4: Run — `node --test runtime/engine/backward/test/present-floor.test.mjs` PASS.**
- [ ] **Step 5: Commit** — `git add -A runtime/engine/backward && git commit --no-verify -m "feat(runtime): floor Decision renders the full act + epoch-suffixed ids" && git log --oneline -1`

---

### Task 5: `registerRatified` — epoch journal key + generation into reconcile

**Files:**
- Modify: `runtime/engine/backward/lib/register-ratified.mjs:14-40`
- Test: `runtime/engine/backward/test/register-ratified.test.mjs` (append epoch suite)

**Interfaces:**
- Produces: journal key `mint:<id>:g<N>:ratify`; `reconcileLesson` called with `generation: N`. Re-mint (gen-2) of an id whose gen-1 key is complete executes FRESH (does not replay gen-1's record).

- [ ] **Step 1: Failing tests** (append; reuse the file's `validDraft`/`withTmpContent`/dossier seeding style — read it first):

```js
test('EPOCH-M1 gen-2 ratify executes fresh under its own key; gen-1 record untouched', () =>
  withTmpContent(async ({ checksDir, lessonsDir, scenariosDir }) => {
    writeDossier(lessonsDir, 'feedback_sample', { name: 'S', description: 'd', type: 'feedback',
      mints: [{ check: 'sample-mint', ratified: '2026-07-01', status: 'retired' }] });
    const journal = inMemoryJournal();
    journal.begin('backward', { runId: 'backward', auto: false });   // meta needed for journal.read below
    // seed a COMPLETE gen-1 record — a naive epoch-less key would replay this and write nothing
    journal.record('backward', 'mint:sample-mint:g1:ratify', { stale: true });
    const draft = validDraft({ entry: { provenance: { minted_by: 'sample-item', lesson: 'feedback_sample.md', generation: 2 } } });
    const r = await registerRatified({ draft, floorApproval: true, journal, checksDir, dossierRoot: lessonsDir, scenariosDir });
    assert.equal(r.event, 'RATIFIED');
    assert.ok(existsSync(join(checksDir, 'sample-mint.yaml')));                       // gen-2 actually wrote
    assert.deepEqual(journal.read('backward').steps.get('mint:sample-mint:g1:ratify').value, { stale: true });  // gen-1 untouched
    const mints = parse(/^---\n([\s\S]*?)\n---/.exec(readFileSync(join(lessonsDir, 'feedback_sample.md'), 'utf8'))[1]).mints;
    assert.equal(mints.length, 2);
    assert.equal(mints[1].generation, 2);
  }));
```

(Requires `journal.begin('backward', { runId: 'backward', auto: false })` before `record` if the in-memory journal's `read` returns null without meta — check `inMemoryJournal`: `record` appends without meta, but `read` needs meta; add the `begin` call in the test before `journal.record`.)

- [ ] **Step 2: Run — FAILS** (key is `mint:sample-mint:ratify`, no gen-2 mints entry).
- [ ] **Step 3: Implement** — in `register-ratified.mjs`:

```js
  const id = draft.entry.id;
  const gen = draft.entry.provenance.generation ?? 1;              // §2.4 epoch
  const journalKey = `mint:${id}:g${gen}:ratify`;
```

and pass `generation: gen` in the `reconcileLesson({ ... })` call.

- [ ] **Step 4: Run — PASS.** Also re-run `node --test runtime/engine/backward/test/mint.test.mjs` — if any test asserts the old `mint:<id>:ratify` key, update it to `mint:<id>:g1:ratify`.
- [ ] **Step 5: Commit** — `git add -A runtime/engine/backward && git commit --no-verify -m "feat(runtime): registerRatified journal key gains the lifecycle epoch" && git log --oneline -1`

---

### Task 6: `curateGuard` — reconcile-before-write (torn-curate fix) + epoch key

**Files:**
- Modify: `runtime/engine/backward/lib/curate-guard.mjs:20-37`
- Test: `runtime/engine/backward/test/curate-guard.test.mjs` (append torn-curate regression)

**Interfaces:**
- Produces: inside the journal step the order is reconcile → YAML writes; journal key `curate:<id>:g<N>:<transition>`. A reconcile failure leaves the guard ACTIVE on disk and NO journal record, so a retry converges. (Successor changes come in Task 7 — this task only flips the order + key for retire.)

- [ ] **Step 1: Failing regression test** (append to `curate-guard.test.mjs`):

```js
test('TORN-CURATE a throwing reconcile leaves the guard ACTIVE on disk and unrecorded — retry converges', () =>
  withTmpContent(async ({ checksDir, lessonsDir }) => {
    // NO dossier seeded → reconcileLesson throws ENOENT inside the step
    const journal = inMemoryJournal();
    const guard = activeGuard();
    await assert.rejects(() => curateGuard({ guard, trigger: 'dangling-scope', transition: 'retire',
      floorApproval: true, rationale: 'code deleted', retiredReason: 'gone', journal, checksDir, dossierRoot: lessonsDir }));
    assert.equal(existsSync(join(checksDir, 'no-ddb-scan.yaml')), false);   // guard NOT lowered on disk (the red-team hole)
    // retry after the operator fixes the dossier: same journal, same guard object — converges
    seed(lessonsDir);
    const r = await curateGuard({ guard, trigger: 'dangling-scope', transition: 'retire',
      floorApproval: true, rationale: 'code deleted', retiredReason: 'gone', journal, checksDir, dossierRoot: lessonsDir });
    assert.equal(r.check.status, 'retired');
    assert.ok(existsSync(join(checksDir, 'no-ddb-scan.yaml')));
  }));

test('EPOCH-C1 journal key carries the guard generation', () =>
  withTmpContent(async ({ checksDir, lessonsDir }) => {
    seed(lessonsDir);
    const journal = inMemoryJournal();
    const r = await curateGuard({ guard: activeGuard(), trigger: 'dangling-scope', transition: 'retire',
      floorApproval: true, rationale: 'x', retiredReason: 'x', journal, checksDir, dossierRoot: lessonsDir });
    assert.equal(r.decision.journal_key, 'curate:no-ddb-scan:g1:retire');
  }));
```

- [ ] **Step 2: Run — TORN-CURATE FAILS** (current order writes YAML first: file exists after the throw) and EPOCH-C1 FAILS (old key).
- [ ] **Step 3: Implement** — in `curate-guard.mjs`, change the key and flip the step body order:

```js
  const gen = guard.provenance.generation ?? 1;                    // §2.4 epoch
  const journalKey = `curate:${guard.id}:g${gen}:${transition}`;
  return await journal.step('backward', journalKey, async () => {
    // §2.1 order: reconcile FIRST, then the YAML writes. reconcile throws → nothing touched disk → clean
    // retry. A write-throw after reconcile leaves the guard ACTIVE on disk, so the retry re-runs
    // advanceLifecycle legally and every reconcile branch is idempotent → retry converges.
    const lesson = guard.provenance.lesson;
    const reconciled = lesson
      ? reconcileLesson({ lesson, check: guard.id, transition, successor: successor?.id, generation: gen, dossierRoot })
      : { lesson: null, mints: [] };

    mkdirSync(checksDir, { recursive: true });
    writeFileSync(join(checksDir, `${res.check.id}.yaml`), stringify(res.check), 'utf8');
    if (res.successor) writeFileSync(join(checksDir, `${res.successor.id}.yaml`), stringify(res.successor), 'utf8');

    const decision = {
      act: 'curate', transition, check: guard.id, successor: successor?.id, lesson: lesson ?? undefined,
      rationale: rationale ?? '', provenance: res.check.provenance, decided_by: 'human',
      decided_at: new Date().toISOString(), journal_key: journalKey,
    };
    return { check: res.check, successor: res.successor, decision, mints: reconciled.mints };
  });
```

(The `decision` literal is unchanged from today's file apart from `journal_key`; `successor?.id` becomes `successor?.entry?.id` in Task 7.)

- [ ] **Step 4: Run — `node --test runtime/engine/backward/test/curate-guard.test.mjs` PASS** (CG1–CG4 + new). `retire-proof.test.mjs` / `supersede-proof.test.mjs` may assert old keys — update to `g1` form if so.
- [ ] **Step 5: Commit** — `git add -A runtime/engine/backward && git commit --no-verify -m "fix(runtime): torn-curate — reconcile before guard-lowering writes; epoch journal keys" && git log --oneline -1`

---

### Task 7: Draft-shaped successor with FULL mint guarantees (`curate-guard.mjs` + `curate.mjs`)

**Files:**
- Modify: `runtime/engine/backward/lib/curate-guard.mjs`, `runtime/engine/backward/lib/curate.mjs`
- Test: `runtime/engine/backward/test/curate-guard.test.mjs` (successor goldens; update CG3), `runtime/engine/backward/test/supersede-proof.test.mjs` (update SUP1), `runtime/engine/backward/test/curate.test.mjs` (update supersede call sites)

**Interfaces:**
- Consumes: `validateCheck` (`runtime/engine/schema/check.schema.ts`), `EvalScenarioDraftSchema` (`runtime/engine/backward/schema/candidate-draft.ts`), `landEvalScenario` (Task-agnostic, existing), `formatZodError` (`runtime/engine/schema/finding.schema.ts`).
- Produces: `curateGuard({ …, successor, scenariosDir })` where **successor is draft-shaped `{ entry, eval_scenario, rationale }`**; on supersede the CHAINED successor is validated with `CheckEntrySchema` and its `eval_scenario` with `EvalScenarioDraftSchema` **before** the journal step (invalid → `{ check: guard, event: 'REFUSED_INVALID_SUCCESSOR', error, decision: null }`); the successor scenario is landed inside the step. `runCurate({ …, proposedSuccessor, scenariosDir })` passes both through. Success result gains `landing` (the EvalScenarioLanding) on supersede.

- [ ] **Step 1: Write failing successor goldens** (append to `curate-guard.test.mjs`):

```js
const successorDraft = (o = {}) => ({
  entry: validCheck({ id: 'no-ddb-scan-v2', status: 'active',
    provenance: { minted_by: 'narrow-ddb', lesson: 'feedback_x.md', ratified: '2026-07-04' }, ...(o.entry ?? {}) }),
  eval_scenario: { path: 'runtime/eval/scenarios/no-ddb-scan-v2.scenario.mjs',
    fixtures: { good: ['fixtures/no-ddb-scan-v2/good/ok.ts'], bad: ['fixtures/no-ddb-scan-v2/bad/violation.ts'] },
    target_pass_rate: 1.0 },
  rationale: 'narrowed to GSI key attrs',
  ...o.rest,
});

test('SUCC1 invalid successor entry → REFUSED_INVALID_SUCCESSOR before the journal step (no record, no disk)', () =>
  withTmpContent(async ({ checksDir, lessonsDir, scenariosDir }) => {
    seed(lessonsDir);
    const journal = inMemoryJournal();
    const bad = successorDraft(); delete bad.entry.property;                       // breaks CheckEntrySchema
    const r = await curateGuard({ guard: activeGuard(), trigger: 'ship-gate', transition: 'supersede',
      successor: bad, floorApproval: true, rationale: 'narrow', journal, checksDir, dossierRoot: lessonsDir, scenariosDir });
    assert.equal(r.event, 'REFUSED_INVALID_SUCCESSOR');
    assert.equal(r.decision, null);
    assert.equal(existsSync(join(checksDir, 'no-ddb-scan.yaml')), false);          // guard untouched
    assert.equal(existsSync(join(checksDir, 'no-ddb-scan-v2.yaml')), false);
    journal.begin('backward', { runId: 'backward', auto: false });
    assert.equal([...journal.read('backward').steps.keys()].length, 0);            // no journal record
  }));

test('SUCC2 valid successor → both YAMLs + landed scenario + chained provenance + mints re-aimed', () =>
  withTmpContent(async ({ checksDir, lessonsDir, scenariosDir }) => {
    seed(lessonsDir);
    const r = await curateGuard({ guard: activeGuard(), trigger: 'ship-gate', transition: 'supersede',
      successor: successorDraft(), floorApproval: true, rationale: 'narrow', checksDir, dossierRoot: lessonsDir, scenariosDir });
    assert.equal(r.check.provenance.superseded_by, 'no-ddb-scan-v2');
    assert.equal(r.successor.provenance.supersedes, 'no-ddb-scan');
    assert.ok(existsSync(join(checksDir, 'no-ddb-scan-v2.yaml')));
    assert.ok(existsSync(join(scenariosDir, 'no-ddb-scan-v2.scenario.mjs')));      // §2.2: full mint guarantees
    assert.equal(r.landing.check, 'no-ddb-scan-v2');
  }));

test('SUCC3 missing eval_scenario → refused (a successor without a scenario is a naked guard)', () =>
  withTmpContent(async ({ checksDir, lessonsDir, scenariosDir }) => {
    seed(lessonsDir);
    const noScenario = successorDraft(); delete noScenario.eval_scenario;
    const r = await curateGuard({ guard: activeGuard(), trigger: 'ship-gate', transition: 'supersede',
      successor: noScenario, floorApproval: true, rationale: 'narrow', checksDir, dossierRoot: lessonsDir, scenariosDir });
    assert.equal(r.event, 'REFUSED_INVALID_SUCCESSOR');
  }));
```

- [ ] **Step 2: Run — all three FAIL** (successor is treated as a bare entry today).
- [ ] **Step 3: Implement.** In `curate-guard.mjs` — new imports:

```js
import { validateCheck } from '../../schema/check.schema.ts';
import { EvalScenarioDraftSchema } from '../schema/candidate-draft.ts';
import { formatZodError } from '../../schema/finding.schema.ts';
import { landEvalScenario } from './land-eval-scenario.mjs';
```

Signature gains `scenariosDir`; the lifecycle call and refusal block become:

```js
  const res = advanceLifecycle({ check: guard, transition, floorApproval, successor: successor?.entry, retiredReason });
  if (res.event !== 'RETIRED' && res.event !== 'SUPERSEDED') return { check: guard, event: res.event, decision: null };

  // §2.2: the successor gets the FULL mint guarantees — refusal BEFORE the journal step (no record, no disk),
  // the same discipline as ratify.
  if (res.event === 'SUPERSEDED') {
    const v = validateCheck(res.successor);
    if (!v.ok) return { check: guard, event: 'REFUSED_INVALID_SUCCESSOR', error: v.error, decision: null };
    const s = EvalScenarioDraftSchema.safeParse(successor.eval_scenario);
    if (!s.success) return { check: guard, event: 'REFUSED_INVALID_SUCCESSOR', error: formatZodError(s.error), decision: null };
  }
```

Inside the journal step, before the reconcile (scenario landing is idempotent by check id — same convergence argument):

```js
    const landing = res.successor
      ? landEvalScenario({ draft: { entry: res.successor, eval_scenario: successor.eval_scenario }, scenariosDir })
      : undefined;
```

successor references in reconcile + decision become `successor?.entry?.id`; the step return gains `...(landing ? { landing } : {})`.

**Write order inside the step (floor decision 2026-07-04, supersedes the Task 6 snippet's order):** landing → reconcile → `mkdirSync` → **successor YAML first, guard YAML LAST** — the guard write is the commit point of the act. A crash between the two writes then leaves the guard ACTIVE on disk (plus a harmless already-active successor), so a disk-reloading retry re-runs `advanceLifecycle` legally and converges; guard-first would leave a superseded guard with no successor and a permanently-refused retry. Reusable pattern: the lifecycle-bearing write always goes last.

```js
    mkdirSync(checksDir, { recursive: true });
    if (res.successor) writeFileSync(join(checksDir, `${res.successor.id}.yaml`), stringify(res.successor), 'utf8');
    writeFileSync(join(checksDir, `${res.check.id}.yaml`), stringify(res.check), 'utf8');   // guard LAST = commit point
```

In `curate.mjs`: signature gains `scenariosDir`; pass it to both `curateGuard` calls (retire path too — harmless); the supersede call passes `successor: proposedSuccessor` (already draft-shaped now). No other logic change — `proposed_successor` in the choice now carries the envelope, which Task 4's render prints via `.entry`.

- [ ] **Step 4: Update existing call sites to the envelope shape:**
  - `curate-guard.test.mjs` CG3: wrap its bare successor: `successor: successorDraft()` (drop the local `validCheck` successor; assert the same outcomes).
  - `supersede-proof.test.mjs` SUP1: `proposedSuccessor: { entry: successor, eval_scenario: { path: 'runtime/eval/scenarios/no-ddb-scan-v2.scenario.mjs', fixtures: { good: [], bad: [] }, target_pass_rate: 1.0 }, rationale: 'narrowed' }` and pass `scenariosDir` to `runCurate` (destructure it from `withTmpContent`).
  - `curate.test.mjs`: same envelope for any supersede call; retire/keep calls just gain `scenariosDir` pass-through (optional param — only add where the test destructures it).
- [ ] **Step 5: Run — `node --test runtime/engine/backward/test/*.test.mjs` ALL PASS; `npx tsc --noEmit -p runtime/tsconfig.json` clean.**
- [ ] **Step 6: Commit** — `git add -A runtime/engine/backward && git commit --no-verify -m "feat(runtime): supersede successor gets full mint guarantees (schema-validated + scenario landed)" && git log --oneline -1`

---

### Task 8: Green checkpoint — full backward + engine suites

**Files:** none new — fallout fixes only (test expectation updates to epoch keys/ids/context, never behavior changes).

- [ ] **Step 1: Run everything ring-1:**

```bash
node --test runtime/engine/backward/test/*.test.mjs && \
node --test runtime/engine/test/*.test.mjs && \
node --test runtime/engine/loop/test/*.test.mjs && \
node --test runtime/eval/test/*.test.mjs && \
node --test runtime/content/test/*.test.mjs && \
npx tsc --noEmit -p runtime/tsconfig.json
```

- [ ] **Step 2: Fix any remaining fallout.** Known candidates: dogfood test (scripted asks key off `decision.id` values — ratify by `value`, unaffected), `mint.test.mjs` / `retire-proof.test.mjs` journal-key strings, `present-floor.test.mjs` context assertions (`context` was the bare rationale before Task 4). Update expectations only.
- [ ] **Step 3: Commit** — `git add -A runtime && git commit --no-verify -m "test(runtime): align suites with epoch keys + full-act floor render" && git log --oneline -1`

---

### Task 9: Config + `run-backward.mjs` driver — `mint` subcommand

**Files:**
- Modify: `runtime/runtime.config.json`
- Create: `runtime/adapters/claude-code/run-backward.mjs`
- Test: `runtime/adapters/claude-code/test/run-backward.test.mjs`

**Interfaces:**
- Consumes: `runMint` (`runtime/engine/backward/lib/mint.mjs`), `toDecision` (`present-floor.mjs`), `headlessAsk` (`backward/lib/capabilities.mjs`), `makeJournal, inMemoryJournal, askStep, PAUSE, pendingDecisions, gitHeadSha` (`engine/lib/journal.mjs`), `parse` from `yaml`.
- Produces (used by Tasks 10/12/14 and the SKILL text):
  - CLI: `node runtime/adapters/claude-code/run-backward.mjs mint --item <id> --lesson <file> --proposal <proposal.json> [--fulfil <decision-id> --value '<choice-json>']` — exit 0 done / 3 parked / 1 refused-or-failed / 2 usage.
  - Exports: `parseFlags(args) → object`, `makeJournaledAsk({journal, runId, ask}) → ask'`, `deriveGeneration({checksDir, id}) → {generation} | {error}`, `mirrorLesson({lessonFile, lessonsDir}) → relName`, `mintCommand({itemId, lessonFile, proposal, journal, ask, cfg}) → {exit, out}`. `RUN_ID = 'backward'`.

- [ ] **Step 1: Add config keys.** `runtime/runtime.config.json` becomes:

```json
{
  "checksDir": "runtime/content/checks",
  "exclusionsRoot": "runtime/content/exclusions",
  "triggersFile": "runtime/content/triggers.yaml",
  "lessonsDir": "runtime/content/lessons",
  "scenariosDir": "runtime/eval/scenarios"
}
```

- [ ] **Step 2: Write failing driver tests** — create `runtime/adapters/claude-code/test/run-backward.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { inMemoryJournal } from '../../../engine/lib/journal.mjs';
import { mintCommand, deriveGeneration, mirrorLesson, parseFlags } from '../run-backward.mjs';

function tmpCfg() {
  const root = mkdtempSync(join(tmpdir(), 'nf-bwd-'));
  const cfg = { checksDir: join(root, 'checks'), lessonsDir: join(root, 'lessons'), scenariosDir: join(root, 'scenarios') };
  for (const d of Object.values(cfg)) mkdirSync(d, { recursive: true });
  return { root, cfg };
}
const proposal = () => ({
  id: 'no-x', property: 'no X anywhere', kind: 'drift',
  evaluator: { type: 'deterministic', run: 'cmd:node tools/check-x.mjs' },
  cost_tier: 'cheap', contexts: ['gate', 'invariant'],
  scope: { paths: ['services/**/*.ts'], dossiers: ['feedback_x.md'] },
  eval_scenario: { path: 'runtime/eval/scenarios/no-x.scenario.mjs',
    fixtures: { good: ['fixtures/no-x/good/a.ts'], bad: ['fixtures/no-x/bad/b.ts'] }, target_pass_rate: 1.0 },
  rationale: 'mechanizable, recurring, still intended',
  gates: { mechanizable: true, recurring: true, stillIntended: true },
});
const seedLesson = (dir) => writeFileSync(join(dir, 'feedback_x.md'),
  '---\nname: X\ndescription: d\ntype: feedback\n---\nbody\n', 'utf8');

test('BWD1 fresh mint parks (exit 3) with the epoch decision id + full candidate render', async () => {
  const { root, cfg } = tmpCfg();
  try {
    seedLesson(cfg.lessonsDir);
    const j = inMemoryJournal();
    const r = await mintCommand({ itemId: 'ws-1', lessonFile: join(cfg.lessonsDir, 'feedback_x.md'), proposal: proposal(), journal: j, cfg });
    assert.equal(r.exit, 3);
    assert.equal(r.out.pending[0].decision.id, 'mint-no-x-g1');
    assert.match(r.out.pending[0].decision.context, /candidate check \(full YAML\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BWD2 fulfil ratify → registered check + landed scenario + reconciled lesson (exit 0); replay reprints (exit 0)', async () => {
  const { root, cfg } = tmpCfg();
  try {
    seedLesson(cfg.lessonsDir);
    const j = inMemoryJournal();
    const args = { itemId: 'ws-1', lessonFile: join(cfg.lessonsDir, 'feedback_x.md'), proposal: proposal(), journal: j, cfg };
    await mintCommand(args);                                                     // parks
    j.fulfil('backward', 'mint-no-x-g1', { decisionId: 'mint-no-x-g1', value: 'ratify' });
    const r2 = await mintCommand(args);
    assert.equal(r2.exit, 0);
    assert.equal(parse(readFileSync(join(cfg.checksDir, 'no-x.yaml'), 'utf8')).status, 'active');
    assert.ok(existsSync(join(cfg.scenariosDir, 'no-x.scenario.mjs')));
    const mints = parse(/^---\n([\s\S]*?)\n---/.exec(readFileSync(join(cfg.lessonsDir, 'feedback_x.md'), 'utf8'))[1]).mints;
    assert.equal(mints[0].check, 'no-x');
    const r3 = await mintCommand(args);                                          // replay — journal short-circuits
    assert.equal(r3.exit, 0);
    assert.equal(parse(readFileSync(join(cfg.lessonsDir, 'feedback_x.md'), 'utf8').match(/^---\n([\s\S]*?)\n---/)[1]).mints.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BWD3 edit fulfilment returns the draft AND re-opens the floor (next invoke parks, not stuck on edit)', async () => {
  const { root, cfg } = tmpCfg();
  try {
    seedLesson(cfg.lessonsDir);
    const j = inMemoryJournal();
    const args = { itemId: 'ws-1', lessonFile: join(cfg.lessonsDir, 'feedback_x.md'), proposal: proposal(), journal: j, cfg };
    await mintCommand(args);
    j.fulfil('backward', 'mint-no-x-g1', { decisionId: 'mint-no-x-g1', value: 'edit' });
    const r2 = await mintCommand(args);
    assert.equal(r2.exit, 0);
    assert.equal(r2.out.result.kind, 'edit');
    assert.equal(r2.out.result.draft.entry.id, 'no-x');
    const r3 = await mintCommand(args);                                          // revised proposal would go here
    assert.equal(r3.exit, 3);                                                    // asks fresh — not replaying 'edit'
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BWD4 generation derivation: terminal on-disk id → g2 decision; ACTIVE on-disk id → exit 1', async () => {
  const { root, cfg } = tmpCfg();
  try {
    seedLesson(cfg.lessonsDir);
    // deriveGeneration only reads status + provenance.generation — a minimal YAML stub is enough
    writeFileSync(join(cfg.checksDir, 'no-x.yaml'), stringify({ id: 'no-x', status: 'retired',
      provenance: { minted_by: 'old', ratified: 't', retired_reason: 'r' } }), 'utf8');
    const j = inMemoryJournal();
    const r = await mintCommand({ itemId: 'ws-1', lessonFile: join(cfg.lessonsDir, 'feedback_x.md'), proposal: proposal(), journal: j, cfg });
    assert.equal(r.exit, 3);
    assert.equal(r.out.pending[0].decision.id, 'mint-no-x-g2');
    writeFileSync(join(cfg.checksDir, 'no-x.yaml'), stringify({ id: 'no-x', status: 'active',
      provenance: { minted_by: 'old', ratified: 't' } }), 'utf8');
    const r2 = await mintCommand({ itemId: 'ws-1', lessonFile: join(cfg.lessonsDir, 'feedback_x.md'), proposal: proposal(), journal: inMemoryJournal(), cfg });
    assert.equal(r2.exit, 1);                                                    // re-mint of a LIVE check → curate instead
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BWD5 mirrorLesson copies an external dossier once, frontmatter intact', async () => {
  const { root, cfg } = tmpCfg();
  try {
    const ext = join(root, 'feedback_ext.md');
    writeFileSync(ext, '---\nname: E\ndescription: d\ntype: feedback\n---\nbody\n', 'utf8');
    assert.equal(mirrorLesson({ lessonFile: ext, lessonsDir: cfg.lessonsDir }), 'feedback_ext.md');
    const mirrored = readFileSync(join(cfg.lessonsDir, 'feedback_ext.md'), 'utf8');
    assert.match(mirrored, /^---\nname: E/);
    writeFileSync(join(cfg.lessonsDir, 'feedback_ext.md'), mirrored + 'LOCAL EDIT\n', 'utf8');
    mirrorLesson({ lessonFile: ext, lessonsDir: cfg.lessonsDir });               // second call: absent-only, no clobber
    assert.match(readFileSync(join(cfg.lessonsDir, 'feedback_ext.md'), 'utf8'), /LOCAL EDIT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BWD6 parseFlags: value flags, boolean flags, missing values', () => {
  assert.deepEqual(parseFlags(['--item', 'x', '--none', '--reason', 'r']), { item: 'x', none: true, reason: 'r' });
  assert.deepEqual(parseFlags(['--fulfil', '--value']), { fulfil: true, value: true });   // degenerate → caller treats as usage error
});
```

- [ ] **Step 3: Run — FAILS** (module doesn't exist).
- [ ] **Step 4: Implement** — create `runtime/adapters/claude-code/run-backward.mjs`:

```js
#!/usr/bin/env node
// runtime/adapters/claude-code/run-backward.mjs — the backward-edge floor driver (ring-2, §3.1).
// run-item.mjs's park/fulfil pattern verbatim: this process runs until the first unfulfilled floor park,
// prints the pending Decision (FULL §2.3 payload) and exits 3; the session surfaces the real
// AskUserQuestion and re-invokes with --fulfil <decision-id> --value '<choice-json>'; replay advances.
// Exit: 0 done / 3 parked / 1 refused-or-failed / 2 usage. runId 'backward' (one shared floor ledger).
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parse } from 'yaml';
import { runMint } from '../../engine/backward/lib/mint.mjs';
import { runCurate } from '../../engine/backward/lib/curate.mjs';
import { toDecision } from '../../engine/backward/lib/present-floor.mjs';
import { headlessAsk } from '../../engine/backward/lib/capabilities.mjs';
import { validateCheck } from '../../engine/schema/check.schema.ts';
import { makeJournal, askStep, PAUSE, pendingDecisions, gitHeadSha } from '../../engine/lib/journal.mjs';

export const RUN_ID = 'backward';

export function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue;
    const k = args[i].slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) out[k] = true;
    else { out[k] = next; i++; }
  }
  return out;
}

/** ask bound through askStep (§3.1): a fulfilled Choice replays; a PAUSE parks as awaiting. */
export function makeJournaledAsk({ journal, runId = RUN_ID, ask = headlessAsk }) {
  return async (decision) =>
    (await askStep({ journal, runId, decision, ask })) ?? { decisionId: decision.id, value: PAUSE };
}

/** §2.4: a mint targeting an id whose on-disk YAML is terminal gets generation = prior + 1.
 *  A LIVE (active/candidate) on-disk id is a category error — curate, don't re-mint. */
export function deriveGeneration({ checksDir, id }) {
  const p = join(checksDir, `${id}.yaml`);
  if (!existsSync(p)) return { generation: 1 };
  const prior = parse(readFileSync(p, 'utf8'));
  if (prior?.status === 'retired' || prior?.status === 'superseded')
    return { generation: (prior.provenance?.generation ?? 1) + 1 };
  return { error: `check "${id}" is ${prior?.status} on disk — curate (retire/supersede) it instead of re-minting` };
}

/** Mirror an external lesson into lessonsDir if absent (frontmatter intact) — the mirror IS the
 *  reconcile target (dogfood D1 convention). Returns the dossier name relative to lessonsDir. */
export function mirrorLesson({ lessonFile, lessonsDir }) {
  const rel = basename(lessonFile);
  const dest = join(lessonsDir, rel);
  if (!existsSync(dest)) { mkdirSync(lessonsDir, { recursive: true }); copyFileSync(lessonFile, dest); }
  return rel;
}

const paused = (journal, result) => ({ exit: 3, out: { result, pending: pendingDecisions(journal.read(RUN_ID)) } });

export async function mintCommand({ itemId, lessonFile, proposal, journal, ask = headlessAsk, cfg }) {
  journal.begin(RUN_ID, { runId: RUN_ID, auto: false });
  const gen = deriveGeneration({ checksDir: cfg.checksDir, id: proposal.id });
  if (gen.error) return { exit: 1, out: { error: gen.error } };
  const p = gen.generation > 1 ? { ...proposal, generation: gen.generation } : proposal;
  const lessonRel = mirrorLesson({ lessonFile, lessonsDir: cfg.lessonsDir });
  const r = await runMint({ item: { id: itemId }, lesson: lessonRel, proposal: p,
    ask: makeJournaledAsk({ journal, ask }), journal,
    checksDir: cfg.checksDir, dossierRoot: cfg.lessonsDir, scenariosDir: cfg.scenariosDir });
  if (r.kind === 'paused') return paused(journal, r);
  if (r.kind === 'rejected') return { exit: 1, out: { result: r } };
  if (r.kind === 'edit') {
    // Re-open the floor (last-write-wins): the revised proposal must ask fresh, not replay 'edit'.
    const choice = { act: 'mint', candidate: r.draft.entry, lesson: r.draft.entry.provenance.lesson,
      rationale: r.draft.rationale, recommended: 'ratify', options: ['ratify', 'edit', 'decline'] };
    journal.awaiting(RUN_ID, toDecision(choice).id, toDecision(choice));
    return { exit: 0, out: { result: r } };
  }
  if (r.kind === 'minted') return { exit: r.decision ? 0 : 1, out: { result: r } };
  return { exit: 0, out: { result: r } };                          // declined
}

export async function curateCommand({ checkId, trigger, successorDraft, reason = '', journal, ask = headlessAsk, cfg }) {
  journal.begin(RUN_ID, { runId: RUN_ID, auto: false });
  const guardPath = join(cfg.checksDir, `${checkId}.yaml`);
  if (!existsSync(guardPath)) return { exit: 1, out: { error: `no such check on disk: ${guardPath}` } };
  const v = validateCheck(parse(readFileSync(guardPath, 'utf8')));
  if (!v.ok) return { exit: 1, out: { error: `invalid guard YAML for "${checkId}": ${v.error}` } };
  const r = await runCurate({ guard: v.value, trigger, proposedSuccessor: successorDraft, rationale: reason,
    ask: makeJournaledAsk({ journal, ask }), journal,
    checksDir: cfg.checksDir, dossierRoot: cfg.lessonsDir, scenariosDir: cfg.scenariosDir });
  if (r.kind === 'paused') return paused(journal, r);
  return { exit: r.decision ? 0 : 1, out: { result: r } };         // refusals carry decision: null
}

export function considerCommand({ itemId, minted, none, reason, journal, sha, ts }) {
  if (!itemId || !reason || (!minted && !none) || (minted && none)) {
    return { exit: 2, out: { error: "usage: consider --item <id> (--minted <check-id> | --none) --reason '…'" } };
  }
  journal.begin(RUN_ID, { runId: RUN_ID, auto: false });
  const value = { outcome: minted ?? 'none', reason, sha, ts };
  journal.record(RUN_ID, `consider:${itemId}`, value);
  return { exit: 0, out: { recorded: { key: `consider:${itemId}`, ...value } } };
}

function usage() {
  console.error(`usage: run-backward.mjs <mint|curate|consider> …
  mint     --item <id> --lesson <file> --proposal <proposal.json> [--fulfil <decision-id> --value '<choice-json>']
  curate   --check <id> --trigger <ship-gate|dangling-scope> [--successor <draft.json>] [--reason '…'] [--fulfil <decision-id> --value '<choice-json>']
  consider --item <id> (--minted <check-id> | --none) --reason '…'`);
  process.exit(2);
}

async function main() {
  const cmd = process.argv[2];
  const f = parseFlags(process.argv.slice(3));
  if ((f.fulfil !== undefined) !== (f.value !== undefined) || f.fulfil === true || f.value === true) usage();
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  const journal = makeJournal({});                                 // root = git-common-dir (shared across worktrees)
  journal.begin(RUN_ID, { runId: RUN_ID, auto: false });
  if (f.fulfil) journal.fulfil(RUN_ID, f.fulfil, JSON.parse(f.value));
  let r;
  if (cmd === 'mint') {
    if (typeof f.item !== 'string' || typeof f.lesson !== 'string' || typeof f.proposal !== 'string') usage();
    r = await mintCommand({ itemId: f.item, lessonFile: f.lesson, proposal: JSON.parse(readFileSync(f.proposal, 'utf8')), journal, cfg });
  } else if (cmd === 'curate') {
    if (typeof f.check !== 'string' || typeof f.trigger !== 'string') usage();
    const successorDraft = typeof f.successor === 'string' ? JSON.parse(readFileSync(f.successor, 'utf8')) : undefined;
    r = await curateCommand({ checkId: f.check, trigger: f.trigger, successorDraft, reason: typeof f.reason === 'string' ? f.reason : '', journal, cfg });
  } else if (cmd === 'consider') {
    r = considerCommand({ itemId: f.item, minted: typeof f.minted === 'string' ? f.minted : undefined,
      none: f.none === true, reason: typeof f.reason === 'string' ? f.reason : undefined,
      journal, sha: gitHeadSha(), ts: new Date().toISOString() });
  } else usage();
  console.log(JSON.stringify(r.out, null, 2));
  process.exit(r.exit);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 5: Run — `node --test runtime/adapters/claude-code/test/run-backward.test.mjs` → BWD1–BWD6 PASS.**
- [ ] **Step 6: Commit** — `git add -A runtime && git commit --no-verify -m "feat(runtime): run-backward.mjs floor driver — mint via park/fulfil, epoch derivation, lesson mirroring" && git log --oneline -1`

---

### Task 10: Driver `curate` + `consider` subcommand tests

**Files:**
- Test: `runtime/adapters/claude-code/test/run-backward.test.mjs` (append — implementation landed in Task 9)

**Interfaces:**
- Consumes: `curateCommand`, `considerCommand` from Task 9; `validCheck` shape (build inline).

- [ ] **Step 1: Append tests** (these exercise the Task-9 implementations — expected to pass immediately; if any fails, fix the driver, not the test):

```js
import { curateCommand, considerCommand } from '../run-backward.mjs';

const guardYaml = () => ({ id: 'no-x', property: 'no X', kind: 'drift',
  evaluator: { type: 'deterministic', run: 'cmd:node tools/check-x.mjs' }, cost_tier: 'cheap',
  contexts: ['gate', 'invariant'], scope: { paths: ['services/**/*.ts'], dossiers: ['feedback_x.md'] },
  status: 'active', provenance: { minted_by: 'ws-0', lesson: 'feedback_x.md', ratified: '2026-07-01' } });
const seedGuard = (cfg) => writeFileSync(join(cfg.checksDir, 'no-x.yaml'), stringify(guardYaml()), 'utf8');
const seedMintedLesson = (cfg) => writeFileSync(join(cfg.lessonsDir, 'feedback_x.md'),
  '---\nname: X\ndescription: d\ntype: feedback\nmints:\n  - check: no-x\n    ratified: "2026-07-01"\n    status: active\n---\nbody\n', 'utf8');

test('BWD7 curate parks with the full guard render; fulfil retire lowers the guard on disk', async () => {
  const { root, cfg } = tmpCfg();
  try {
    seedGuard(cfg); seedMintedLesson(cfg);
    const j = inMemoryJournal();
    const args = { checkId: 'no-x', trigger: 'ship-gate', reason: 'property abandoned', journal: j, cfg };
    const r1 = await curateCommand(args);
    assert.equal(r1.exit, 3);
    assert.equal(r1.out.pending[0].decision.id, 'curate-no-x-g1');
    assert.match(r1.out.pending[0].decision.context, /current guard \(full YAML\)/);
    j.fulfil('backward', 'curate-no-x-g1', { decisionId: 'curate-no-x-g1', value: 'retire' });
    const r2 = await curateCommand(args);
    assert.equal(r2.exit, 0);
    assert.equal(parse(readFileSync(join(cfg.checksDir, 'no-x.yaml'), 'utf8')).status, 'retired');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BWD8 curate keep: no disk change, exit 0', async () => {
  const { root, cfg } = tmpCfg();
  try {
    seedGuard(cfg); seedMintedLesson(cfg);
    const j = inMemoryJournal();
    const args = { checkId: 'no-x', trigger: 'ship-gate', journal: j, cfg };
    await curateCommand(args);
    j.fulfil('backward', 'curate-no-x-g1', { decisionId: 'curate-no-x-g1', value: 'keep' });
    const r = await curateCommand(args);
    assert.equal(r.exit, 0);
    assert.equal(r.out.result.kind, 'kept');
    assert.equal(parse(readFileSync(join(cfg.checksDir, 'no-x.yaml'), 'utf8')).status, 'active');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BWD9 curate unknown check → exit 1', async () => {
  const { root, cfg } = tmpCfg();
  try {
    const r = await curateCommand({ checkId: 'ghost', trigger: 'ship-gate', journal: inMemoryJournal(), cfg });
    assert.equal(r.exit, 1);
    assert.match(r.out.error, /no such check/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BWD10 consider records outcome+reason+sha+ts under consider:<item>; usage errors exit 2', () => {
  const j = inMemoryJournal();
  const r = considerCommand({ itemId: 'ws-1', none: true, reason: 'nothing mechanizable', journal: j, sha: 'abc', ts: 'T' });
  assert.equal(r.exit, 0);
  const rec = j.read('backward').steps.get('consider:ws-1');
  assert.deepEqual(rec.value, { outcome: 'none', reason: 'nothing mechanizable', sha: 'abc', ts: 'T' });
  assert.equal(considerCommand({ itemId: 'ws-1', journal: j, sha: 'a', ts: 't' }).exit, 2);              // no outcome/reason
  assert.equal(considerCommand({ itemId: 'ws-1', minted: 'c', none: true, reason: 'r', journal: j, sha: 'a', ts: 't' }).exit, 2);  // both
});
```

- [ ] **Step 2: Run — all BWD tests PASS.** Also re-run `node --test runtime/adapters/claude-code/test/*.test.mjs` (run-item + adapter suites stay green).
- [ ] **Step 3: Commit** — `git add -A runtime/adapters && git commit --no-verify -m "test(runtime): run-backward curate/consider subcommand coverage" && git log --oneline -1`

---

### Task 11: Pre-commit gate — curate-first block message + journaled fail-closed skip

**Files:**
- Modify: `runtime/adapters/git/pre-commit-gate.mjs`
- Test: `runtime/adapters/git/test/pre-commit-gate.test.mjs` (append)

**Interfaces:**
- Produces: `CURATE_CMD(checkId) → string` (imported by Task 12), `formatBlockLines(findings) → string[]`, `journalSkip({journal, sha, staged, ts})` (throws on ledger failure — caller exits 2). Skip branch: journal FIRST, then exit 0; append-throw ⇒ exit 2 (skip NOT honored). Gate runId: `gate-skips`, key `skip:<iso-ts>`.

- [ ] **Step 1: Failing tests** (append to `pre-commit-gate.test.mjs`):

```js
import { formatBlockLines, journalSkip, CURATE_CMD } from '../pre-commit-gate.mjs';
import { inMemoryJournal } from '../../../engine/lib/journal.mjs';

test('SKIP1 journalSkip appends a skip record with sha+staged under gate-skips', () => {
  const j = inMemoryJournal();
  journalSkip({ journal: j, sha: 'abc123', staged: ['a.ts'], ts: '2026-07-04T10:00:00Z' });
  const rec = j.read('gate-skips').steps.get('skip:2026-07-04T10:00:00Z');
  assert.deepEqual(rec.value, { sha: 'abc123', staged: ['a.ts'], ts: '2026-07-04T10:00:00Z' });
});

test('SKIP2 a failing ledger append propagates (fail-closed: caller must NOT honor the skip)', () => {
  const broken = { begin() {}, record() { throw new Error('disk full'); } };
  assert.throws(() => journalSkip({ journal: broken, sha: 's', staged: [], ts: 't' }), /disk full/);
});

test('MSG1 block message names curate as the sanctioned path and demotes the skip hatch', () => {
  const lines = formatBlockLines([{ id: 'no-x#0', check: 'no-x', kind: 'drift', scope: ['a.ts'], detail: 'X found', raised_at: 't' }]);
  const text = lines.join('\n');
  assert.match(text, /run-backward\.mjs curate --check no-x --trigger ship-gate/);
  assert.match(text, /last resort/i);
  assert.match(text, /journaled and adjudicated at ship/);
  assert.equal(CURATE_CMD('y'), 'node runtime/adapters/claude-code/run-backward.mjs curate --check y --trigger ship-gate');
});
```

- [ ] **Step 2: Run — FAIL** (exports missing).
- [ ] **Step 3: Implement** — in `pre-commit-gate.mjs` add imports `makeJournal, gitHeadSha` from `'../../engine/lib/journal.mjs'`, then:

```js
export const CURATE_CMD = (check) =>
  `node runtime/adapters/claude-code/run-backward.mjs curate --check ${check} --trigger ship-gate`;

/** §3.2 block message: curate is the sanctioned path; the skip hatch is a journaled last resort. */
export function formatBlockLines(findings) {
  const lines = [];
  for (const f of findings) {
    lines.push(`  ✖ ${f.check}  ${(f.scope ?? []).join(',')}  ${f.detail}`);
    lines.push(`      deliberate property change? → ${CURATE_CMD(f.check)}`);
  }
  lines.push(`runtime gate: ${findings.length} finding(s) — commit blocked. Fix the code, or curate the check at the floor (commands above).`);
  lines.push('  last resort: RUNTIME_GATE_SKIP=1 — the skip is journaled and adjudicated at ship (ship-recheck must pass before the item closes).');
  return lines;
}

/** §3.2 skip ledger — throws on append failure; the caller must then NOT honor the skip (exit 2). */
export function journalSkip({ journal, sha, staged, ts }) {
  journal.begin('gate-skips', { runId: 'gate-skips', auto: false });
  journal.record('gate-skips', `skip:${ts}`, { sha, staged, ts });
}
```

Replace the `main()` skip branch and finding print:

```js
async function main() {
  try {
    if (shouldSkip(process.env)) {
      try {
        journalSkip({ journal: makeJournal({}), sha: gitHeadSha(), staged: readStaged(), ts: new Date().toISOString() });
      } catch (e) {
        console.error(`runtime gate: RUNTIME_GATE_SKIP requested but the skip ledger append FAILED — skip NOT honored (fail-closed): ${e.message}`);
        process.exit(2);
      }
      console.error('runtime gate: skipped (RUNTIME_GATE_SKIP) — journaled for ship adjudication');
      process.exit(0);
    }
    const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
    const registry = loadRegistry({ checksDir: cfg.checksDir });
    const trigger = loadTriggers(cfg.triggersFile).find((t) => t.on === 'commit');
    if (!trigger) { console.error('runtime gate: no "commit" trigger in triggers.yaml'); process.exit(2); }
    const { exitCode, findings } = await runPreCommitGate({ stagedFiles: readStaged(), registry, trigger });
    if (findings.length) for (const line of formatBlockLines(findings)) console.error(line);
    process.exit(exitCode);
  } catch (e) {
    console.error(`runtime gate: crashed, blocking commit (fail-closed): ${e.message}`);
    process.exit(2);
  }
}
```

- [ ] **Step 4: Run — `node --test runtime/adapters/git/test/pre-commit-gate.test.mjs` ALL PASS** (existing 6 + new 3).
- [ ] **Step 5: Commit** — `git add -A runtime/adapters/git && git commit --no-verify -m "feat(runtime): gate block message routes to curate; RUNTIME_GATE_SKIP journaled fail-closed" && git log --oneline -1`

---

### Task 12: `ship-recheck.mjs` — branch-delta adjudication + gate-clean evidence

**Files:**
- Create: `runtime/adapters/git/ship-recheck.mjs`
- Test: `runtime/adapters/git/test/ship-recheck.test.mjs`

**Interfaces:**
- Consumes: `loadRegistry`, `runWatch`/`loadTriggers`, `makeJournal`/`gitHeadSha`, `CURATE_CMD` (Task 11).
- Produces: CLI `node runtime/adapters/git/ship-recheck.mjs --item <id> [--base <ref>]` (default `origin/main`); findings → exit 1 with per-finding curate hint; clean → `journal.record('backward', 'ship:<item>:gate-clean', {sha, base, ts})`, exit 0. Exports `runShipRecheck({changedFiles, registry, trigger, watch})`, `readBranchDelta(base, exec)`, `recordGateClean({journal, item, sha, base, ts})`.

- [ ] **Step 1: Failing tests** — create `runtime/adapters/git/test/ship-recheck.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runShipRecheck, readBranchDelta, recordGateClean } from '../ship-recheck.mjs';
import { inMemoryJournal } from '../../../engine/lib/journal.mjs';

const trigger = { on: 'commit', contexts: ['invariant', 'gate'], cost_ceiling: 'cheap' };
const registry = { checks: [], byId: new Map(), errors: [] };
const fakeWatch = async ({ changedScope }) => changedScope.some((p) => p.includes('bad'))
  ? [{ id: 'no-x#0', check: 'no-x', kind: 'drift', scope: ['bad.ts'], detail: 'X', raised_at: 't' }] : [];

test('SR1 dirty branch delta → exit 1 with findings', async () => {
  const r = await runShipRecheck({ changedFiles: ['services/x/bad.ts'], registry, trigger, watch: fakeWatch });
  assert.equal(r.exitCode, 1);
  assert.equal(r.findings[0].check, 'no-x');
});

test('SR2 clean delta → exit 0, no findings', async () => {
  const r = await runShipRecheck({ changedFiles: ['services/x/good.ts'], registry, trigger, watch: fakeWatch });
  assert.equal(r.exitCode, 0);
});

test('SR3 recordGateClean stamps sha+base+ts under ship:<item>:gate-clean on runId backward', () => {
  const j = inMemoryJournal();
  recordGateClean({ journal: j, item: 'ws-1', sha: 'deadbeef', base: 'origin/main', ts: 'T' });
  assert.deepEqual(j.read('backward').steps.get('ship:ws-1:gate-clean').value, { sha: 'deadbeef', base: 'origin/main', ts: 'T' });
});

test('SR4 readBranchDelta uses ACMR diff-filter against <base>..HEAD', () => {
  let cmd;
  const out = readBranchDelta('origin/main', (c) => { cmd = c; return 'a.ts\nb.ts\n\n'; });
  assert.deepEqual(out, ['a.ts', 'b.ts']);
  assert.match(cmd, /--diff-filter=ACMR origin\/main\.\.HEAD/);
});
```

- [ ] **Step 2: Run — FAILS** (module missing).
- [ ] **Step 3: Implement** — create `runtime/adapters/git/ship-recheck.mjs`:

```js
#!/usr/bin/env node
// runtime/adapters/git/ship-recheck.mjs — ring-2 ship-boundary adjudication (§3.3): the gate's sibling,
// scoped to the BRANCH delta instead of the staged set. The single adjudication point: catches what
// RUNTIME_GATE_SKIP bypassed AND what --no-verify worktree commits (project SOP) never ran. Skip debt
// is cleared when the latest gate-clean postdates the latest skip (postflight verifies).
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadRegistry } from '../../engine/lib/load-registry.mjs';
import { runWatch, loadTriggers } from '../../engine/lib/run-watch.mjs';
import { makeJournal, gitHeadSha } from '../../engine/lib/journal.mjs';
import { CURATE_CMD } from './pre-commit-gate.mjs';

export function readBranchDelta(base, exec = (c) => execSync(c, { encoding: 'utf8' })) {
  return exec(`git diff --name-only --diff-filter=ACMR ${base}..HEAD`).split('\n').filter(Boolean);
}

export async function runShipRecheck({ changedFiles, registry, trigger, watch = runWatch }) {
  const findings = await watch({ registry, trigger, changedScope: changedFiles, stagedFiles: changedFiles });
  return { exitCode: findings.length ? 1 : 0, findings };
}

export function recordGateClean({ journal, item, sha, base, ts }) {
  journal.begin('backward', { runId: 'backward', auto: false });
  journal.record('backward', `ship:${item}:gate-clean`, { sha, base, ts });
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
    const item = val('--item');
    const base = val('--base') ?? 'origin/main';
    if (!item || item.startsWith('--')) { console.error('usage: ship-recheck.mjs --item <id> [--base <ref>]'); process.exit(2); }
    const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
    const registry = loadRegistry({ checksDir: cfg.checksDir });
    const trigger = loadTriggers(cfg.triggersFile).find((t) => t.on === 'commit');
    if (!trigger) { console.error('ship-recheck: no "commit" trigger in triggers.yaml'); process.exit(2); }
    const { exitCode, findings } = await runShipRecheck({ changedFiles: readBranchDelta(base), registry, trigger });
    for (const f of findings) {
      console.error(`  ✖ ${f.check}  ${(f.scope ?? []).join(',')}  ${f.detail}`);
      console.error(`      deliberate property change? → ${CURATE_CMD(f.check)}`);
    }
    if (findings.length) { console.error(`ship-recheck: ${findings.length} finding(s) on ${base}..HEAD — fix or curate before shipping.`); process.exit(1); }
    recordGateClean({ journal: makeJournal({}), item, sha: gitHeadSha(), base, ts: new Date().toISOString() });
    console.log(`ship-recheck: clean on ${base}..HEAD — journaled ship:${item}:gate-clean`);
    process.exit(0);
  } catch (e) {
    console.error(`ship-recheck: crashed (fail-closed): ${e.message}`);
    process.exit(2);
  }
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run — SR1–SR4 PASS.** Sanity-run the real thing once: `node runtime/adapters/git/ship-recheck.mjs --item runtime-backward-edge-live` — expect exit 0 or genuine findings (report either; a finding here is REAL adjudication input for the close, not a test failure).
- [ ] **Step 5: Commit** — `git add -A runtime/adapters/git && git commit --no-verify -m "feat(runtime): ship-recheck — branch-delta adjudication + gate-clean evidence" && git log --oneline -1`

---

### Task 13: Postflight — `ship-gate-evidence` + `mint-considered`

**Files:**
- Modify: `.claude/skills/backlog-next/postflight.mjs`
- Test: `.claude/skills/backlog-next/test/backward-evidence.test.mjs` (new)

**Interfaces:**
- Consumes: `makeJournal` from `runtime/engine/lib/journal.mjs` (static top-level import — project→engine is the allowed direction; a broken engine import failing postflight is fail-closed and correct).
- Produces: `export function backwardEvidenceFailures({ backwardLedger, skipsLedger, id, snapshotTimestamp }) → { failures, warnings }`, wired into `main()` for lanes `simple`+`complex` when `--id` given (doc-layer + epic-member exempt — epic-member defers to the epic close).

- [ ] **Step 1: Failing matrix tests** — create `.claude/skills/backlog-next/test/backward-evidence.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backwardEvidenceFailures } from '../postflight.mjs';

const SNAP = '2026-07-04T10:00:00.000Z';
const ledger = (recs) => ({ meta: { runId: 'backward', auto: false }, steps: new Map(recs.map((r) => [r.key, r])) });
const clean = (ts) => ({ key: 'ship:ws-1:gate-clean', status: 'complete', value: { sha: 's', base: 'origin/main', ts }, ts });
const consider = (ts) => ({ key: 'consider:ws-1', status: 'complete', value: { outcome: 'none', reason: 'r', sha: 's', ts }, ts });
const skip = (ts) => ({ key: `skip:${ts}`, status: 'complete', value: { sha: 's', staged: [], ts }, ts });

test('PF1 both records fresh → no failures', () => {
  const r = backwardEvidenceFailures({ backwardLedger: ledger([clean('2026-07-04T11:00:00Z'), consider('2026-07-04T11:01:00Z')]),
    skipsLedger: null, id: 'ws-1', snapshotTimestamp: SNAP });
  assert.deepEqual(r.failures, []);
});

test('PF2 missing gate-clean → ship-gate-evidence fails', () => {
  const r = backwardEvidenceFailures({ backwardLedger: ledger([consider('2026-07-04T11:00:00Z')]), skipsLedger: null, id: 'ws-1', snapshotTimestamp: SNAP });
  assert.equal(r.failures.some((f) => f.rule === 'ship-gate-evidence'), true);
});

test('PF3 missing consider → mint-considered fails', () => {
  const r = backwardEvidenceFailures({ backwardLedger: ledger([clean('2026-07-04T11:00:00Z')]), skipsLedger: null, id: 'ws-1', snapshotTimestamp: SNAP });
  assert.equal(r.failures.some((f) => f.rule === 'mint-considered'), true);
});

test('PF4 stale records (predate the snapshot) → both fail', () => {
  const r = backwardEvidenceFailures({ backwardLedger: ledger([clean('2026-07-04T09:00:00Z'), consider('2026-07-04T09:01:00Z')]),
    skipsLedger: null, id: 'ws-1', snapshotTimestamp: SNAP });
  assert.equal(r.failures.length, 2);
});

test('PF5 a skip postdating gate-clean → unadjudicated-skip failure', () => {
  const r = backwardEvidenceFailures({ backwardLedger: ledger([clean('2026-07-04T11:00:00Z'), consider('2026-07-04T11:01:00Z')]),
    skipsLedger: ledger([skip('2026-07-04T12:00:00Z')]), id: 'ws-1', snapshotTimestamp: SNAP });
  assert.equal(r.failures.some((f) => f.rule === 'ship-gate-evidence' && /skip/i.test(f.message)), true);
});

test('PF6 a skip BEFORE gate-clean is adjudicated → no failure', () => {
  const r = backwardEvidenceFailures({ backwardLedger: ledger([clean('2026-07-04T11:00:00Z'), consider('2026-07-04T11:01:00Z')]),
    skipsLedger: ledger([skip('2026-07-04T10:30:00Z')]), id: 'ws-1', snapshotTimestamp: SNAP });
  assert.deepEqual(r.failures, []);
});

test('PF7 no snapshot (resumed workstream) → existence-only + warning', () => {
  const r = backwardEvidenceFailures({ backwardLedger: ledger([clean('2020-01-01T00:00:00Z'), consider('2020-01-01T00:00:00Z')]),
    skipsLedger: null, id: 'ws-1', snapshotTimestamp: null });
  assert.deepEqual(r.failures, []);
  assert.equal(r.warnings.length, 1);
  const r2 = backwardEvidenceFailures({ backwardLedger: null, skipsLedger: null, id: 'ws-1', snapshotTimestamp: null });
  assert.equal(r2.failures.length, 2);                                           // records must still EXIST
});
```

- [ ] **Step 2: Run — FAILS** (`backwardEvidenceFailures` not exported). `node --test .claude/skills/backlog-next/test/backward-evidence.test.mjs`
- [ ] **Step 3: Implement.** In `postflight.mjs`: add top import `import { makeJournal } from '../../../runtime/engine/lib/journal.mjs';`. Add the exported helper (below `runsComplexChecks`):

```js
/** Backward-edge ritual evidence (§4.2, runtime-backward-edge-live) — pure, so the matrix test can
 * feed synthetic ledgers. Missing snapshot ⇒ degrade to existence-only with a warning; the hard
 * requirement (records exist) stays. */
export function backwardEvidenceFailures({ backwardLedger, skipsLedger, id, snapshotTimestamp }) {
  const failures = [];
  const warnings = [];
  const windowed = Boolean(snapshotTimestamp);
  if (!windowed) warnings.push('no preflight snapshot found — backward-edge evidence checks degraded to existence-only');
  const steps = backwardLedger?.steps ?? new Map();

  const clean = steps.get(`ship:${id}:gate-clean`);
  if (!clean || clean.status !== 'complete') {
    failures.push({ rule: 'ship-gate-evidence',
      message: `no ship:${id}:gate-clean record on runId 'backward'. Run: node runtime/adapters/git/ship-recheck.mjs --item ${id}` });
  } else if (windowed && !(clean.ts > snapshotTimestamp)) {
    failures.push({ rule: 'ship-gate-evidence',
      message: `ship:${id}:gate-clean (${clean.ts}) predates the preflight snapshot (${snapshotTimestamp}) — stale evidence; re-run ship-recheck.` });
  } else {
    const skips = [...(skipsLedger?.steps?.values() ?? [])].filter((r) => r.key.startsWith('skip:') && r.ts > clean.ts);
    if (skips.length) failures.push({ rule: 'ship-gate-evidence',
      message: `${skips.length} RUNTIME_GATE_SKIP use(s) postdate the last gate-clean — unadjudicated skip debt; re-run ship-recheck.`,
      detail: skips.map((s) => s.key).join('\n') });
  }

  const considered = steps.get(`consider:${id}`);
  if (!considered || considered.status !== 'complete') {
    failures.push({ rule: 'mint-considered',
      message: `no consider:${id} record on runId 'backward'. Record the mint consideration ("none" is a legal answer): node runtime/adapters/claude-code/run-backward.mjs consider --item ${id} (--minted <check-id> | --none) --reason '…'` });
  } else if (windowed && !(considered.ts > snapshotTimestamp)) {
    failures.push({ rule: 'mint-considered',
      message: `consider:${id} (${considered.ts}) predates the preflight snapshot — record THIS workstream's consideration.` });
  }
  return { failures, warnings };
}
```

Wire into `main()` right after the check-3 block (shipped frontmatter), reusing the already-computed git-common-dir (refactor: the `snapshotPath` block computes it — hoist `const gitCommonDirAbs = sh('git rev-parse --path-format=absolute --git-common-dir');` above the snapshot load and reuse in both places):

```js
  // 3b. Backward-edge ritual evidence (simple + complex; doc-layer exempt; epic-member defers to epic close).
  if (args.id && (lane === 'simple' || lane === 'complex')) {
    try {
      const journal = makeJournal({ root: gitCommonDirAbs });
      const r = backwardEvidenceFailures({ backwardLedger: journal.read('backward'),
        skipsLedger: journal.read('gate-skips'), id: args.id, snapshotTimestamp: snapshot.timestamp });
      failures.push(...r.failures);
      warnings.push(...r.warnings);
    } catch (e) {
      failures.push({ rule: 'ship-gate-evidence', message: `could not read the backward journal: ${e.message}` });
    }
  }
```

NOTE: `warnings` is declared AFTER the snapshot block in the current file — move the `const warnings = [];` declaration up next to `const failures = [];` so both blocks can push to it. The warning print loop stays where it is.

- [ ] **Step 4: Run — PF1–PF7 PASS**, plus the whole skill suite: `node --test .claude/skills/backlog-next/test/*.test.mjs`.
- [ ] **Step 5: Commit** — `git add -A .claude/skills/backlog-next && git commit --no-verify -m "feat(ritual): postflight verifies ship-gate-evidence + mint-considered from the backward journal" && git log --oneline -1`

---

### Task 14: Ritual wiring — SKILL.md step 6.4b + epic E6 step 5 + backlog pointer

**Files:**
- Modify: `.claude/skills/backlog-next/SKILL.md` (insert 6.4b between 6.4 and 6.5; epic-member delta line)
- Modify: `.claude/skills/backlog-next-epic/SKILL.md` (E6 new step 5)
- Modify: `docs/backlog/runtime-backward-edge-live.md` (`plan:` frontmatter)

- [ ] **Step 1: Insert into `.claude/skills/backlog-next/SKILL.md`** after the 6.4 block (after the paragraph ending "Dev-account operations need no confirmation — see [[feedback-sole-dev-no-shared-caution]].") and before "**6.5 Ship the backlog file.**":

```markdown
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
```

- [ ] **Step 2: Epic-member delta** — in the same file's "Epic-member mode" section, extend the Step 6.4 bullet: after "the expensive Jest e2e + Playwright run once at epic pre-done, batched by the orchestrator." append: `Also SKIP Step 6.4b — the backward-edge ritual (ship-recheck + mint consideration) runs once at the epic pre-done gate with --item <epic-id>; the epic-member postflight lane does not check backward evidence.`

- [ ] **Step 3: Insert into `.claude/skills/backlog-next-epic/SKILL.md`** — in "### E6. Epic pre-done — batched expensive e2e (the new gate)", after the numbered item "4. Only a **green** batched run lets you proceed to E7. Never ship on red.", add:

```markdown
5. **Backward-edge ritual (epic-batched).** Members skipped Step 6.4b; the epic runs it ONCE here over the whole branch delta:
   `node runtime/adapters/git/ship-recheck.mjs --item <epic-id>` — findings → fix or curate at the floor (`node runtime/adapters/claude-code/run-backward.mjs curate --check <check-id> --trigger ship-gate`, park → AskUserQuestion → `--fulfil`; in `--auto`, curate is a guard-lowering act — ALWAYS floor-paused, never auto-resolved). Repeat until green (journals `ship:<epic-id>:gate-clean`). Then ONE mint consideration for the epic's ship (AskUserQuestion over the epic's lessons; "none" is legal): `node runtime/adapters/claude-code/run-backward.mjs consider --item <epic-id> (--minted <check-id> | --none) --reason '…'`. The epic postflight (complex lane, `--id=<epic-id>`) enforces both records.
```

Verify E8.3's postflight invocation passes `--id=<epic-id>` (read that section; if it doesn't, note it in the PR body — do NOT widen scope by changing E8 semantics).

- [ ] **Step 4: Backlog pointer** — verify `docs/backlog/runtime-backward-edge-live.md` frontmatter has `plan: docs/superpowers/plans/2026-07-04-runtime-backward-edge-live.md` (set at plan commit — no edit expected).
- [ ] **Step 5: Lint + skill tests** — `node .claude/skills/backlog-lint/lint.mjs && node --test .claude/skills/backlog-next/test/*.test.mjs && node --test .claude/skills/backlog-next-epic/test/*.test.mjs` (if the epic skill has a test dir; skip if absent).
- [ ] **Step 6: Commit** — `git add -A .claude/skills docs/backlog && git commit --no-verify -m "docs(ritual): 6.4b backward-edge ritual in backlog-next + epic E6 batch step" && git log --oneline -1`

---

### Task 15: Full verification sweep

- [ ] **Step 1: Everything, one pass:**

```bash
node --test runtime/engine/backward/test/*.test.mjs && \
node --test runtime/engine/test/*.test.mjs && \
node --test runtime/engine/loop/test/*.test.mjs && \
node --test runtime/adapters/claude-code/test/*.test.mjs && \
node --test runtime/adapters/git/test/*.test.mjs && \
node --test runtime/eval/test/*.test.mjs && \
node --test runtime/content/test/*.test.mjs && \
node --test .claude/skills/backlog-next/test/*.test.mjs && \
npx tsc --noEmit -p runtime/tsconfig.json && \
echo ALL-GREEN
```

Expected: `ALL-GREEN` (capture the test counts — they go in `validation_gate`). If any suite fails: fix, re-run the full block (never a subset), commit the fix.

- [ ] **Step 2: Commit any stragglers** — `git status --short` must be clean.

---

### Task 16 (CLOSE PHASE — runs during Step 6.4b of THIS workstream's close, not before): Mint-in-anger

This workstream ships through the ritual it builds (spec §5) — deliverable 1 IS the validation gate. During the closing phase:

- [ ] **Step 1: Ship recheck (real):** `node runtime/adapters/git/ship-recheck.mjs --item runtime-backward-edge-live`. Findings → fix or curate at the floor via real AskUserQuestion (this adjudicates the branch's `--no-verify` commits). Repeat until green.
- [ ] **Step 2: Pick the lesson.** Primary: whatever THIS workstream surfaced (check the session for a mechanizable, recurring, still-intended lesson). Fallback (pre-selected at brainstorming): `feedback_pipe_masks_exit_code` — the user-memory lesson at `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/feedback_pipe_masks_exit_code.md`. Surface the choice via AskUserQuestion.
- [ ] **Step 3 (fallback path only): create the evaluator + fixtures.** Create `tools/check-pipe-mask.mjs`:

```js
#!/usr/bin/env node
// check-pipe-mask.mjs — deterministic evaluator for no-pipe-exit-masking (minted from
// feedback_pipe_masks_exit_code): a shell script that pipes into tee/tail without pipefail/PIPESTATUS
// reports the LAST stage's exit code, masking the real command's failure. Honors RUNTIME_STAGED_PATHS
// (diff-scoped gate); falls back to git-tracked scripts. Exit 0 clean / 1 findings.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const staged = process.env.RUNTIME_STAGED_PATHS?.split('\n').filter(Boolean);
const files = (staged ?? execSync("git ls-files 'scripts/*.sh' 'scripts/**/*.sh' 'infrastructure/scripts/*.sh' 'infrastructure/scripts/**/*.sh'", { encoding: 'utf8' }).split('\n').filter(Boolean))
  .filter((f) => f.endsWith('.sh'));

const violations = [];
for (const f of files) {
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  const pipesToMasker = /\|\s*(tee|tail)\b/.test(text);
  const guarded = /pipefail|PIPESTATUS/.test(text);
  if (pipesToMasker && !guarded) violations.push(f);
}
if (violations.length) {
  for (const f of violations) console.error(`pipe-exit-masking: ${f} pipes into tee/tail without pipefail/PIPESTATUS`);
  process.exit(1);
}
process.exit(0);
```

Fixtures — create `runtime/eval/scenarios/fixtures/no-pipe-exit-masking/bad/tee-no-pipefail.sh`:

```bash
#!/bin/bash
npm test | tee /tmp/test.log | tail -5
```

and `runtime/eval/scenarios/fixtures/no-pipe-exit-masking/good/with-pipefail.sh`:

```bash
#!/bin/bash
set -euo pipefail
npm test | tee /tmp/test.log | tail -5
```

**Pre-check before proposing:** run `node tools/check-pipe-mask.mjs` — if existing repo scripts violate, surface that at the floor (fix them in this close, or the gate will fire on the next .sh commit; that consequence is part of what the human ratifies).

- [ ] **Step 4: Write the proposal** to the scratchpad (`<scratchpad>/no-pipe-exit-masking.proposal.json`):

```json
{
  "id": "no-pipe-exit-masking",
  "property": "Shell scripts that pipe a command into tee/tail must set pipefail (or capture PIPESTATUS) so the pipeline exit code reflects the real command, not the last stage",
  "kind": "drift",
  "evaluator": { "type": "deterministic", "run": "cmd:node tools/check-pipe-mask.mjs" },
  "cost_tier": "cheap",
  "contexts": ["gate", "invariant"],
  "scope": { "paths": ["scripts/**/*.sh", "infrastructure/scripts/**/*.sh"], "dossiers": ["feedback_pipe_masks_exit_code.md"] },
  "eval_scenario": {
    "path": "runtime/eval/scenarios/no-pipe-exit-masking.scenario.mjs",
    "fixtures": {
      "good": ["runtime/eval/scenarios/fixtures/no-pipe-exit-masking/good/with-pipefail.sh"],
      "bad": ["runtime/eval/scenarios/fixtures/no-pipe-exit-masking/bad/tee-no-pipefail.sh"]
    },
    "target_pass_rate": 1.0
  },
  "rationale": "Mechanizable (pure grep over .sh files), recurring (the tee/tail masking bit real deploys and test runs — see feedback_pipe_masks_exit_code), still intended (pipe-to-log is the repo's standard capture pattern).",
  "gates": { "mechanizable": true, "recurring": true, "stillIntended": true }
}
```

- [ ] **Step 5: Drive the mint** — `node runtime/adapters/claude-code/run-backward.mjs mint --item runtime-backward-edge-live --lesson /Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/feedback_pipe_masks_exit_code.md --proposal <scratchpad>/no-pipe-exit-masking.proposal.json` → exit 3 → surface the printed Decision (full candidate YAML) via a REAL **AskUserQuestion** (ratify (Recommended) / edit / decline) → `--fulfil mint-no-pipe-exit-masking-g1 --value '{"decisionId":"mint-no-pipe-exit-masking-g1","value":"ratify"}'` → verify `runtime/content/checks/no-pipe-exit-masking.yaml` + `runtime/eval/scenarios/no-pipe-exit-masking.scenario.mjs` + the `mints:` entry in `runtime/content/lessons/feedback_pipe_masks_exit_code.md`. Commit the minted artifacts.
- [ ] **Step 6: Record the consideration** — `node runtime/adapters/claude-code/run-backward.mjs consider --item runtime-backward-edge-live --minted no-pipe-exit-masking --reason 'first in-anger mint: draft → floor → register → land-eval'` (or `--none` + reason if the human declined — still a valid gate for deliverable 1? NO: the spec's validation gate REQUIRES a completed traversal; on decline, return to Step 2 with a different lesson).
- [ ] **Step 7: Validation gate evidence.** Record in the backlog file's `validation_gate:` the journal keys produced (`mint:no-pipe-exit-masking:g1:ratify` or the real lesson's), the registered check id, the `ship:runtime-backward-edge-live:gate-clean` record, and the postflight pass line.

---

## Self-Review Notes

- **Spec coverage:** §2.1→Task 6; §2.2→Task 7; §2.3→Task 4; §2.4→Tasks 1-3,5-7; §3.1→Tasks 9-10; §3.2→Task 11; §3.3→Task 12; §4.1→Task 14; §4.2→Task 13; §5→Task 16; §6 error paths→SUCC1/SUCC3, SKIP2, TORN-CURATE, BWD2 replay, BWD8 keep; §7 test matrix→Tasks 1-13 tests.
- **Known judgment calls (flag in PR body):** (a) mint on a LIVE on-disk id refuses (exit 1) — spec only defines terminal-id derivation; refusal is the safe complement. (b) `edit` fulfilment re-opens the floor via a fresh `awaiting` append (last-write-wins) — required for the spec's re-proposal loop to converge; `decline` deliberately KEEPS replay semantics (§6 "reprints the recorded result"). (c) The gate keeps `--diff-filter=ACM` (ACMR is the *gate*'s redteam-hardening delta, out of scope here); ship-recheck uses ACMR per §3.3. (d) **Floor decision 2026-07-04:** supersede writes successor YAML first, guard YAML last (commit point) — Task 6's review showed guard-first violates the §2.1 torn-retry invariant on the two-write path (superseded guard + missing successor + disk-reloading retry refused forever).
- **Type consistency spot-checks:** `successor?.entry` everywhere in curate-guard after Task 7 (advanceLifecycle gets `.entry`, reconcile gets `.entry.id`, decision gets `.entry.id`); `generation ?? 1` never stored when 1 (provenance via draftCandidate, mints via reconcileLesson) but ALWAYS rendered in ids/keys as `g1`.
