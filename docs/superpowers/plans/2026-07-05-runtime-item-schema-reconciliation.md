# Runtime Item-Schema Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile `runtime/engine/schema/item.schema.ts` with the real `docs/backlog` frontmatter and wire `validateItem` into the `readItems()` read path, so `docs/backlog` IS a validated runtime item store.

**Architecture:** Ring-1's `ItemSchema` adopts the store's real field names and shapes (identity binding — no mapping layer): `done_criteria` → `done_when` (optional; requiredness stays a project rule, lint rule 4b), `rank` becomes nullable, `.strict()` → `.passthrough()` so project-local extension keys ride through preserved. `readItems()` (scope-gate.mjs) validates every parsed file and fails CLOSED with an aggregate error — matching the fail-closed registry precedent from runtime-redteam-hardening. The delta re-freezes into SPEC 1 §10.

**Tech Stack:** Node 24 zero-build (`.mjs` importing `.ts` via type-stripping), zod v3 (`^3.24.0`), `node --test`.

## Global Constraints

- Ring-1 (`runtime/engine/**`) stays project- and harness-agnostic: no imports from `.claude/skills`, `tools/`, or project services (enforced by `import-boundary.test.mjs` + the `module-boundaries` content check).
- `docs/backlog` data is NEVER edited to fit the schema — the schema moves to the data (419 files are the acceptance corpus).
- Tests live in `runtime/engine/test/*.test.mjs` (libs use flat `test/**`), run via `node --test runtime/engine/test/*.test.mjs` (glob form — dir form doesn't discover on Node 24).
- Empirical store facts (census 2026-07-05, 419 files): all have `id`/`status`/`type`; 53 carry `rank: null`; 52 have `done_when`; extension keys in the wild: `spec` (null|string), `plan` (null|string), `topic_memory` (array), `validation_gate` (string|null), `closed` (string), `notes` (string), `requires_deploy` (boolean), `shipped`, `shipped_at`, `dropped_reason` (strings); `epic_role` is always `core`|`captured`; `provenance` appears in zero real files.
- Worktree commits: verify each commit landed (`git log --oneline -1`) — the pre-commit hook can reject silently; use `--no-verify` only if a commit is rejected for worktree-environment reasons, never to bypass a genuine gate finding.

---

### Task 1: Reconcile `ItemSchema` (rename, relax, passthrough)

**Files:**
- Modify: `runtime/engine/schema/item.schema.ts`
- Test: `runtime/engine/test/item-schema.test.mjs`

**Interfaces:**
- Produces: `ItemSchema` (zod object, `.passthrough()`), `validateItem(obj: unknown): { ok: boolean, value?, error? }` — signature unchanged; field `done_when?: string` replaces `done_criteria: string`; `rank?: number | null`.

- [ ] **Step 1: Rewrite the test file to the reconciled contract**

Replace the full contents of `runtime/engine/test/item-schema.test.mjs` with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateItem } from '../schema/item.schema.ts';

test('a minimal item validates (only id/type/status required — done_when requiredness is a project rule, lint 4b)', () => {
  assert.equal(validateItem({ id: 'x', type: 'feature', status: 'active' }).ok, true);
});

test('done_when is the closure predicate (reconciled 2026-07-05: identity with the store key; done_criteria is gone)', () => {
  const r = validateItem({ id: 'x', type: 'epic', status: 'active', done_when: 'ships' });
  assert.equal(r.ok, true);
  assert.equal(r.value.done_when, 'ships');
});

test('rank must be a number OR null when present (53 real files carry rank: null)', () => {
  assert.equal(validateItem({ id: 'x', type: 'bug', status: 'queued', rank: '3' }).ok, false);
  assert.equal(validateItem({ id: 'x', type: 'bug', status: 'queued', rank: 3 }).ok, true);
  assert.equal(validateItem({ id: 'x', type: 'bug', status: 'parking', rank: null }).ok, true);
});

test('epic_role is constrained to core|captured', () => {
  assert.equal(validateItem({ id: 'x', type: 'feature', status: 'active', epic_role: 'core' }).ok, true);
  assert.equal(validateItem({ id: 'x', type: 'feature', status: 'active', epic_role: 'bogus' }).ok, false);
});

test('project-local extension keys pass through PRESERVED — never stripped, never rejected', () => {
  const r = validateItem({ id: 'x', type: 'bug', status: 'shipped', spec: null, plan: 'docs/p.md',
    topic_memory: ['t.md'], validation_gate: 'evidence', closed: '2026-07-05', notes: 'n', requires_deploy: false });
  assert.equal(r.ok, true);
  assert.equal(r.value.validation_gate, 'evidence');
  assert.equal(r.value.closed, '2026-07-05');
  assert.equal(r.value.spec, null);
});

test('provenance stays strict — ring-1 owns that sub-object (minted by intake, never hand-authored)', () => {
  const r = validateItem({ id: 'x', type: 'feature', status: 'active',
    provenance: { from_finding: 'f-1', from_check: 'read-model-single-writer' } });
  assert.equal(r.ok, true);
  assert.equal(r.value.provenance.from_finding, 'f-1');
  assert.equal(validateItem({ id: 'x', type: 'feature', status: 'active', provenance: { bogus: 'k' } }).ok, false);
});
```

- [ ] **Step 2: Run to verify the new expectations fail against the old schema**

Run: `node --test runtime/engine/test/item-schema.test.mjs`
Expected: FAIL — minimal item without `done_criteria` rejected; `rank: null` rejected; extension keys rejected by `.strict()`.

- [ ] **Step 3: Implement the reconciled schema**

Replace lines 10–26 of `runtime/engine/schema/item.schema.ts` (the `ItemSchema` object and `Item` type) with:

```ts
export const ItemSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  status: z.string().min(1),
  rank: z.number().nullish(),                           // the ONLY stored priority input (law 2); real store carries rank: null
  epic: z.string().optional(),                          // single-parent pointer (1-level tree)
  epic_role: z.enum(['core', 'captured']).optional(),
  done_when: z.string().min(1).optional(),              // the closure predicate — identity with the store key (re-freeze
                                                        //   2026-07-05); requiredness is a project rule (lint 4b), not ring-1's
  scope: z.string().optional(),                         // path-glob-shaped (NOT free prose) — feeds findByScope
  out_of_scope: z.array(z.string()).optional(),
  references: z.array(z.string()).optional(),
  provenance: z.object({
    from_finding: z.string().optional(),               // FindingId (§15 delta 2) — which finding
    from_check: z.string().optional(),                 // CheckId (denormalized for query) — which check
  }).strict().optional(),
}).passthrough();                                       // project-local extensions (spec/plan/notes/closed/…) ride through
export type Item = z.infer<typeof ItemSchema>;
```

Also update the file-head comment (line 2) to note the re-freeze: append ` Re-frozen 2026-07-05 (runtime-item-schema-reconciliation): done_when identity binding, passthrough extensions.`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test runtime/engine/test/item-schema.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/schema/item.schema.ts runtime/engine/test/item-schema.test.mjs
git commit -m "refactor(runtime): reconcile ItemSchema with the real item store (done_when, nullable rank, passthrough)"
```

---

### Task 2: Align `intake.mjs` and `worker.mjs` to the reconciled field name

**Files:**
- Modify: `runtime/engine/lib/intake.mjs:10`
- Modify: `runtime/engine/loop/worker.mjs:34`
- Test: existing `runtime/engine/test/intake.test.mjs`, `runtime/engine/test/*.test.mjs`

**Interfaces:**
- Consumes: `ItemSchema` field `done_when` from Task 1.
- Produces: `shapeItems()` mints items with `done_when`; worker ship-ask `Decision.context = item.done_when` (schema-legal when undefined — `journal.schema.ts:30` has `context: z.string().optional()`).

- [ ] **Step 1: Rename the minted field in intake**

In `runtime/engine/lib/intake.mjs` line 10, change:

```js
  done_criteria: `resolve: ${finding.detail}`,
```

to:

```js
  done_when: `resolve: ${finding.detail}`,
```

- [ ] **Step 2: Drop the drift fallback in the worker**

In `runtime/engine/loop/worker.mjs` line 34, change:

```js
    context: item.done_when ?? item.done_criteria };
```

to:

```js
    context: item.done_when };
```

- [ ] **Step 3: Run the full engine + adapter suites**

Run: `node --test runtime/engine/test/*.test.mjs runtime/adapters/*/test/*.test.mjs`
Expected: PASS. If `intake.test.mjs` asserts `done_criteria` on shaped items, update those assertions to `done_when` (same values otherwise).

- [ ] **Step 4: Commit**

```bash
git add runtime/engine/lib/intake.mjs runtime/engine/loop/worker.mjs runtime/engine/test/intake.test.mjs
git commit -m "refactor(runtime): intake mints done_when; worker drops the done_criteria drift fallback"
```

---

### Task 3: Wire `validateItem` into the `readItems()` read path (fail-closed)

**Files:**
- Modify: `runtime/engine/lib/scope-gate.mjs:33-41` (readItems) + import
- Test: `runtime/engine/test/scope-gate.test.mjs`

**Interfaces:**
- Consumes: `validateItem` from Task 1.
- Produces: `readItems(backlogDir): Item[]` — same signature; now every returned item is schema-validated (extensions preserved); an invalid file throws `Error` whose message lists every offending `file: reason` (fail-closed, like the registry — redteam item 2).

- [ ] **Step 1: Add failing tests for validated reads**

In `runtime/engine/test/scope-gate.test.mjs`, append:

```js
// readItems is the production read path (run-item.mjs + both CLI modes) — reconciled 2026-07-05:
// every item is schema-validated on read; an invalid file fails CLOSED (registry precedent, redteam item 2).
test('readItems validates each item — an invalid file fails CLOSED with an aggregate error naming it', () => {
  const d = mkdtempSync(join(tmpdir(), 'bl-inv-'));
  writeFileSync(join(d, 'good.md'), '---\nid: good\nstatus: queued\ntype: bug\n---\n');
  writeFileSync(join(d, 'bad.md'), '---\nid: bad\nstatus: queued\ntype: bug\nepic_role: bogus\n---\n');
  assert.throws(() => readItems(d), /bad\.md/);
});

test('readItems preserves project-local extension keys and nullable rank on validated items', () => {
  const d = mkdtempSync(join(tmpdir(), 'bl-ext-'));
  writeFileSync(join(d, 'a.md'), '---\nid: a\nstatus: shipped\ntype: bug\nvalidation_gate: "evidence"\nclosed: "2026-07-05"\nrank: null\n---\n');
  const [a] = readItems(d);
  assert.equal(a.validation_gate, 'evidence');
  assert.equal(a.rank, null);
});
```

Also fix the pre-existing fixtures that now (correctly) fail validation for missing `type`:
- Line 33: `'---\nid: a\nstatus: active\nscope: "src/**"\n---\nbody'` → `'---\nid: a\nstatus: active\ntype: feature\nscope: "src/**"\n---\nbody'`
- Line 34: `'---\nid: b\nstatus: queued\n---\nbody'` → `'---\nid: b\nstatus: queued\ntype: bug\n---\nbody'`
- Line 51 helper: `const md = (id, status, type) => ...` → give it a default: `const md = (id, status, type = 'bug') => ...` (existing epic-type call sites keep passing `'epic'`).

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test runtime/engine/test/scope-gate.test.mjs`
Expected: FAIL — `readItems` doesn't throw on the invalid fixture yet (no validation).

- [ ] **Step 3: Implement validated reads**

In `runtime/engine/lib/scope-gate.mjs`: add to the imports:

```js
import { validateItem } from '../schema/item.schema.ts';
```

Replace the `readItems` function (lines 33–41) with:

```js
/** The production item-store read (seam #1: dir injected, ring-1 imports no project files). Every item is
 *  schema-validated on read; an invalid file fails CLOSED with an aggregate error (registry precedent). */
export function readItems(backlogDir) {
  if (!existsSync(backlogDir)) return [];
  const items = []; const errors = [];
  for (const f of readdirSync(backlogDir).filter((n) => n.endsWith('.md'))) {
    const m = readFileSync(join(backlogDir, f), 'utf8').match(/^---\n([\s\S]*?)\n---/);
    const fm = m ? yaml.parse(m[1]) : {};
    const r = validateItem({ id: fm?.id ?? f.replace(/\.md$/, ''), ...fm });
    if (r.ok) items.push(r.value); else errors.push(`${f}: ${r.error}`);
  }
  if (errors.length) throw new Error(`item store ${backlogDir} failed validation (${errors.length} invalid):\n${errors.join('\n')}`);
  return items;
}
```

- [ ] **Step 4: Run the scope-gate suite, then everything**

Run: `node --test runtime/engine/test/scope-gate.test.mjs` → PASS.
Run: `node --test runtime/engine/test/*.test.mjs runtime/adapters/*/test/*.test.mjs` → PASS (catches any other fixture minting invalid items).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/scope-gate.mjs runtime/engine/test/scope-gate.test.mjs
git commit -m "feat(runtime): validate items on read — readItems fails closed on an invalid store"
```

---

### Task 4: Real-store binding sweep — `docs/backlog` validates end-to-end

**Files:**
- Create: `runtime/engine/test/item-store-binding.test.mjs`

**Interfaces:**
- Consumes: `readItems` from Task 3.

- [ ] **Step 1: Write the binding sweep test**

Create `runtime/engine/test/item-store-binding.test.mjs` (project-binding test, same precedent as `content-ring.test.mjs` — it reads the repo's own content ring):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readItems } from '../lib/scope-gate.mjs';

// The reconciliation's acceptance criterion, kept as a regression guard: the REAL store validates.
// (Runs from the repo root, like content-ring.test.mjs. 419 files at reconciliation time.)
test('the real docs/backlog store validates through readItems — docs/backlog IS the runtime item store', () => {
  const items = readItems('docs/backlog');
  assert.ok(items.length >= 400, `expected the full store, got ${items.length}`);
  for (const i of items) { assert.ok(i.id && i.status && i.type, `incomplete item: ${i.id}`); }
});
```

- [ ] **Step 2: Run it**

Run: `node --test runtime/engine/test/item-store-binding.test.mjs`
Expected: PASS with 419 items. If ANY real file fails: the schema is still wrong — fix the schema (never the data), re-run Task 1/3.

- [ ] **Step 3: Commit**

```bash
git add runtime/engine/test/item-store-binding.test.mjs
git commit -m "test(runtime): real-store binding sweep — all docs/backlog items validate on read"
```

---

### Task 5: Re-freeze SPEC 1 §10 + fix the SPEC 3 prose mention

**Files:**
- Modify: `docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md` (§10: interface block ~line 377, binding table ~line 400, frozen-names line ~409)
- Modify: `docs/superpowers/specs/2026-07-01-runtime-spec-3-forward-edge-and-capability-seams.md:491`

- [ ] **Step 1: Update SPEC 1 §10**

Three edits:

1. Interface block line `done_criteria: string;      // the closure predicate ("done_when" in the backlog binding)` →

```ts
  done_when?: string;         // the closure predicate — identity with the backlog binding key (re-frozen
                              //   2026-07-05); requiredness is a project rule (lint 4b), not ring-1's
```

and the `rank?: number;` line's comment gains `; nullable in the store binding`.

2. Binding-table row `| \`done_criteria\` | \`done_when\` | required for active epics (rule 4b) |` →

```markdown
| `done_when` | `done_when` | identity (re-freeze 2026-07-05); required for active epics (rule 4b) |
```

and the extensions row note `project-local extensions; ring-1 ignores them` → `project-local extensions; ring-1 passes them through PRESERVED (.passthrough())`.

3. Frozen-names line →

```markdown
Frozen item-schema field names: `id, type, status, rank, epic, epic_role, done_when, scope, out_of_scope, references, provenance`.

> **Re-freeze delta 2026-07-05 (`runtime-item-schema-reconciliation`):** `done_criteria` → `done_when` (identity
> with the store key — the worker's `done_when ?? done_criteria` drift fallback was the smell), `done_when` and
> `rank` relaxed to match the real store (optional / nullable), `.strict()` → `.passthrough()`, and `validateItem`
> wired into `readItems()` (fail-closed) — `docs/backlog` is now a validated runtime item store.
```

- [ ] **Step 2: Update SPEC 3 line 491**

`the item's \`done_criteria\`-derived gates` → `the item's \`done_when\`-derived gates`.

- [ ] **Step 3: Verify no live straggler references remain**

Run: `grep -rn "done_criteria" runtime/ docs/superpowers/specs/`
Expected: zero hits in `runtime/`; zero in `specs/`. (Historical plan docs under `docs/superpowers/plans/2026-07-01-*` and `2026-07-03-runtime-seam-probe.md` keep their mentions — they are shipped-workstream artifacts, not living contracts.)

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md docs/superpowers/specs/2026-07-01-runtime-spec-3-forward-edge-and-capability-seams.md
git commit -m "docs(runtime): re-freeze SPEC 1 §10 with the item-schema reconciliation delta"
```

---

## Out of scope

Mirrors the backlog file's `out_of_scope:`: no migration of backlog-lint's 11 invariants into content-ring checks (P4 member); no parity-oracle work (separate P3 member); no ring-1 redesign beyond this delta; no edits to `docs/backlog` data to fit the schema; no forward-edge behavior changes beyond the field rename.

## Self-review notes

- Spec coverage: item body's three clauses → Task 1 (rename/relax), Task 1+3 (real-key tolerance), Task 3+4 (validated read path); epic's re-freeze requirement → Task 5.
- Type consistency: `done_when?: string`, `rank: number|null|undefined`, `validateItem` signature unchanged across Tasks 1–4.
- Known consumers all covered: `intake.mjs`, `worker.mjs` (Task 2), `scope-gate.mjs` CLI ×2 + `run-item.mjs` (Task 3 — `run-item.test.mjs` fixtures already carry `type:`, verified).
