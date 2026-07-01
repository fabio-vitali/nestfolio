# Runtime SPEC 2 — Backward Edge & Learning Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the moat — the two floor-gated procedures (mint post-ship, curate sync+async) that drive SPEC 1's `advanceLifecycle`, plus enforcement-as-memory (`mints:`), dogfooded end-to-end on five real mechanizable `feedback_*` lessons.

**Architecture:** Ring-1 (project- and harness-agnostic) SPEC-2-owned schemas + six procedure helpers + two reference orchestrators under `runtime/engine/backward/`, consuming SPEC 1's frozen `check.schema.ts` / `advance-lifecycle.mjs` **verbatim**. The still-unbuilt SPEC 3 capabilities (`ask`, `journal`) are **injected capability interfaces** with headless defaults (ask → `<<HARNESS-PAUSE>>` sentinel; journal → in-memory) so ring-1 never depends outward. Seam #2 (Nestfolio content) is quarantined: five `tools/check-*.mjs` evaluators, five `runtime/content/checks/*.yaml`, five in-repo lesson mirrors under `runtime/content/lessons/`, five eval scenarios, plus a sync-supersede and an async-retire proof.

**Tech Stack:** Node ≥24 native TS type-stripping (zero build); `.ts` zod schemas (`zod` + `z.infer`, single source of truth) imported by `.mjs` helpers with explicit `.ts` extension; `node:test` + `node:assert/strict`; `yaml` (parse/stringify); nx `run-commands` targets (`runtime:test`, `runtime:typecheck`).

## Global Constraints

- **Ring-1 never depends outward** — no helper imports a harness or project-content path. `ask`/`journal` are injected params with headless defaults; dossier location is an injected `dossierRoot`. (SPEC 2 §13 dependency rule.)
- **House module convention** — every `.mjs`: `#!/usr/bin/env node` shebang, JSDoc header, **pure named-export core + thin `main()`**, NO default exports; `main()` guarded by `if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();`. Tests import the pure core directly. (SPEC 1 house convention, verified in `runtime/engine/lib/*.mjs`.)
- **Schemas are `.ts`** = zod validator + `z.infer` type in one file (single source of truth); `.strict()` on every object; a `validateX(obj)` wrapper returning `{ ok, value } | { ok, error }` via `formatZodError` where the value is persisted or crosses a seam. (Mirrors `check.schema.ts`.)
- **Consume SPEC 1 verbatim** — `CheckEntry`/`Provenance`/`Finding`/`CheckStatus`/`FlakeContract`/`advanceLifecycle` are FROZEN. This slice adds only the procedures that call them and the SPEC-2-owned draft/choice/decision/landing/mints shapes. Do NOT re-shape SPEC 1 schemas.
- **Merged-contract deltas (NOT the paper spec)** — the spec's illustrative YAML/TS predate SPEC 1's build. Bind to the merged contract:
  - **Δ1 `run` grammar** — `evaluator.run` MUST be `"<scheme>:<target>"`, scheme ∈ `cmd|module|eslint|skill`. Dogfood checks use `"cmd:node tools/check-<id>.mjs"`, never bare `"node …"`.
  - **Δ2 `provenance.ratified` optional/absent in a candidate** — a draft leaves `ratified` UNSET (not `''`); `advanceLifecycle('ratify')` stamps it via `?? isoNow()`. An empty string would SURVIVE `??` and never get stamped. Enforced by `CandidateDraftSchema`.
  - **Δ3 no `keep` transition** — `advanceLifecycle` LEGAL = `candidate→{ratify,edit,decline}`, `active→{supersede,retire}`. `keep` is a `curateGuard` procedure-level no-op; it NEVER calls `advanceLifecycle`.
  - **Δ4 `FlakeContract` requires `calibration` + `eval_scenario`** (both min-1) — a judgment mint (deferred this slice) would populate both.
  - **Δ5 `advanceLifecycle` signature** = `{ check, transition, floorApproval, successor, retiredReason }`; returns `{ check, event, successor? }` where `event ∈ RATIFIED|EDITED|DISCARDED|RETIRED|SUPERSEDED|REFUSED_NO_FLOOR|REFUSED_ILLEGAL_TRANSITION|REFUSED_NO_SUCCESSOR`. `decline` returns `{ check: null }`.
- **Decisions locked (this workstream, AskUserQuestion 2026-07-01):**
  - **D1 dossiers** — in-repo mirror `runtime/content/lessons/feedback_*.md`; `reconcileLesson` takes an injected `dossierRoot` defaulting there. Never mutate `~/.claude/…/memory/`.
  - **D2 judgment mint** — the optional §10 sixth proof (judgment→deterministic supersede) is DEFERRED to SPEC 3. This slice is five deterministic mints + one sync-supersede + one async-retire, fully golden-gate green.
  - **D3 seams** — `ask`/`journal` are injected capability interfaces (headless defaults), NOT stub modules.
- **Validation** — golden gates: `node --test runtime/engine/backward/test/*.test.mjs` (+ the existing `runtime/engine/test/*.test.mjs` stays green). All deterministic; no live e2e, no deploy (`runtime/**` is Tier-0 no-deploy).
- **TDD, frequent commits** — every task: failing test → run-fail → minimal impl → run-pass → commit. Worktree commits use `--no-verify` (the pre-commit hook silently rejects worktree code commits) AND verify each commit landed with `git -C <worktree> log -1 --oneline`.

---

## File Structure

**Ring-1 SPEC-2 schemas** — `runtime/engine/backward/schema/*.ts` (zod + `z.infer`):
- `candidate-draft.ts` — `EvalScenarioDraft`, `CandidateDraft` (§4.1). Encodes Δ2 (draft must not carry `ratified`).
- `floor-choice.ts` — `MintChoice`, `CurateChoice`, `FloorChoice` discriminated union (§6.1).
- `floor-decision.ts` — `FloorDecision` (§6.2); rationale required for retire/supersede/decline.
- `eval-landing.ts` — `EvalScenarioLanding` (§9).
- `mints-entry.ts` — `MintsEntry` (§7.1).

**Ring-1 SPEC-2 procedure helpers** — `runtime/engine/backward/lib/*.mjs`:
- `capabilities.mjs` — `headlessAsk` (sentinel), `inMemoryJournal` (idempotency ledger). The D3 seam defaults.
- `draft-candidate.mjs` — `draftCandidate({ item, lesson, proposal })` → `CandidateDraft | null` (§4 step 2 + §8 three-gate test).
- `present-floor.mjs` — `presentFloor({ choice, ask })` → `{ choice, selected?, sentinel? }` (§6).
- `land-eval-scenario.mjs` — `landEvalScenario({ draft, scenariosDir })` → `EvalScenarioLanding` (§9; idempotent by check id).
- `reconcile-lesson.mjs` — `reconcileLesson({ lesson, check, transition, successor?, ratified?, dossierRoot })` → `{ lesson, mints }` (§7.1; the ONLY `mints:` writer).
- `register-ratified.mjs` — `registerRatified({ draft, floorApproval, journal?, checksDir, dossierRoot, scenariosDir })` → `{ kind?, check, decision, landing, mints }` (§4 step 4 atomic unit).
- `curate-guard.mjs` — `curateGuard({ guard, trigger, transition, successor?, floorApproval, rationale, retiredReason?, journal?, checksDir, dossierRoot })` → `{ check, successor?, decision, kept? }` (§5).
- `mint.mjs` — `runMint({ item, lesson, proposal, ask?, journal?, checksDir, dossierRoot, scenariosDir })` → terminal result (§4 procedure composition).
- `curate.mjs` — `runCurate({ guard, trigger, proposedSuccessor?, ask?, journal?, checksDir, dossierRoot })` → terminal result (§5 procedure composition).

**Ring-1 tests** — `runtime/engine/backward/test/*.test.mjs` + `_fixtures.mjs` (backward-local fixtures).

**Seam #2 dogfood evaluators** — `tools/check-<id>.mjs` + `tools/check-<id>.test.mjs` ×5 (+ optional `tools/<id>-exclusions.json`).

**Seam #2 content ring:**
- `runtime/content/checks/{no-ddb-scan,no-agent-result-fallback,no-ddb-seed-in-integration,no-unsafe-casts,no-states-runtime-catch}.yaml` + `no-ddb-scan-v2.yaml` (supersede artifact).
- `runtime/content/lessons/feedback_*.md` ×5 (in-repo mirror + `mints:`).
- `runtime/eval/scenarios/<id>.scenario.mjs` ×5 + `runtime/eval/scenarios/fixtures/<id>/{good,bad}/*` corpora.

**Modified infra:**
- `runtime/project.json` — `test` command adds `runtime/engine/backward/test/*.test.mjs`; `typecheck` input adds `engine/backward/schema/**/*.ts`.
- `runtime/tsconfig.json` — `include` adds `engine/backward/schema/**/*.ts`.

---

## Phase A — Infra & wiring

### Task A1: Wire `runtime/engine/backward/` into nx test + typecheck + tsconfig

**Files:**
- Modify: `runtime/project.json`
- Modify: `runtime/tsconfig.json`
- Create: `runtime/engine/backward/schema/.gitkeep` (placeholder so tsconfig glob + typecheck run before Phase B lands files)

**Interfaces:**
- Produces: the `runtime:test` target now discovers `engine/backward/test/*.test.mjs`; `runtime:typecheck` + `runtime/tsconfig.json` now compile `engine/backward/schema/**/*.ts`.

- [ ] **Step 1: Update the test command glob** — edit `runtime/project.json` `targets.test.options.command` from
  `"node --test runtime/engine/test/*.test.mjs"` to
  `"node --test runtime/engine/test/*.test.mjs runtime/engine/backward/test/*.test.mjs"`.

- [ ] **Step 2: Update the typecheck input** — in `runtime/project.json` `targets.typecheck.inputs`, change `"{projectRoot}/engine/schema/**/*.ts"` to `"{projectRoot}/engine/**/schema/**/*.ts"` (covers both `engine/schema` and `engine/backward/schema`).

- [ ] **Step 3: Update tsconfig include** — edit `runtime/tsconfig.json` `include` from `["engine/schema/**/*.ts"]` to `["engine/schema/**/*.ts", "engine/backward/schema/**/*.ts"]`.

- [ ] **Step 4: Create the placeholder** — `runtime/engine/backward/schema/.gitkeep` (empty file) so the globs resolve before Phase B.

- [ ] **Step 5: Verify targets still green** (empty backward dir is a no-op)

Run: `NX_DAEMON=false pnpm nx run runtime:test`
Expected: PASS — the existing `runtime/engine/test/*.test.mjs` suites all pass; the `backward/test` glob matches nothing yet (no error).

Run: `NX_DAEMON=false pnpm nx run runtime:typecheck`
Expected: PASS — `tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/project.json runtime/tsconfig.json runtime/engine/backward/schema/.gitkeep
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "chore(runtime): wire engine/backward into nx test+typecheck+tsconfig (SPEC 2 A1)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

---

## Phase B — Ring-1 SPEC-2 schemas (TDD)

> Every schema is `.ts` (zod + `z.infer`), `.strict()`, with a `validateX` wrapper. Tests are `.mjs` importing the `.ts` schema with the explicit `.ts` extension, run via `node --test`. Create `runtime/engine/backward/test/_fixtures.mjs` in Task B1 and reuse it.

### Task B1: `mints-entry.ts` + backward test fixtures

**Files:**
- Create: `runtime/engine/backward/schema/mints-entry.ts`
- Create: `runtime/engine/backward/test/_fixtures.mjs`
- Test: `runtime/engine/backward/test/mints-entry.test.mjs`

**Interfaces:**
- Produces: `MintsEntrySchema`, `type MintsEntry = { check: string; ratified: string; status: 'active'|'superseded'|'retired'; superseded_by?: string }`, `validateMintsEntry(obj) → { ok, value } | { ok, error }`.
- Produces (fixtures): `validDraft(overrides)`, `withTmpContent(fn)`, `writeDossier(root, name, front, body)` for later tasks.

- [ ] **Step 1: Write the failing test**

```javascript
// runtime/engine/backward/test/mints-entry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMintsEntry } from '../schema/mints-entry.ts';

test('M1 a valid active mints entry passes', () => {
  const r = validateMintsEntry({ check: 'no-ddb-scan', ratified: '2026-07-02', status: 'active' });
  assert.equal(r.ok, true);
});

test('M2 status superseded REQUIRES superseded_by', () => {
  const r = validateMintsEntry({ check: 'no-ddb-scan', ratified: '2026-07-02', status: 'superseded' });
  assert.equal(r.ok, false);
  assert.match(r.error, /superseded_by/);
});

test('M3 superseded WITH superseded_by passes', () => {
  const r = validateMintsEntry({ check: 'no-ddb-scan', ratified: '2026-07-02', status: 'superseded', superseded_by: 'no-ddb-scan-v2' });
  assert.equal(r.ok, true);
});

test('M4 unknown status is rejected (closed enum)', () => {
  const r = validateMintsEntry({ check: 'x', ratified: '2026-07-02', status: 'draft' });
  assert.equal(r.ok, false);
});

test('M5 unknown extra field is rejected (strict)', () => {
  const r = validateMintsEntry({ check: 'x', ratified: '2026-07-02', status: 'active', note: 'nope' });
  assert.equal(r.ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/backward/test/mints-entry.test.mjs`
Expected: FAIL — `Cannot find module '../schema/mints-entry.ts'`.

- [ ] **Step 3: Write the schema**

```typescript
// runtime/engine/backward/schema/mints-entry.ts — ring-1; the reciprocal of the check's
// Provenance.lesson (§7.1). Derived-and-reconciled by reconcileLesson (its ONLY writer).
import { z } from 'zod';
import { formatZodError } from '../../schema/finding.schema.ts';

export const MintsEntrySchema = z.object({
  check: z.string().min(1),                                 // CheckId this lesson minted
  ratified: z.string().min(1),                              // ISO date; mirrors check.provenance.ratified
  status: z.enum(['active', 'superseded', 'retired']),      // tracks the minted check's live-or-terminal state
  superseded_by: z.string().optional(),                    // CheckId; set together with status: 'superseded'
}).strict().superRefine((e, ctx) => {
  if (e.status === 'superseded' && !e.superseded_by) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['superseded_by'],
      message: "status 'superseded' requires superseded_by" });
  }
});
export type MintsEntry = z.infer<typeof MintsEntrySchema>;

export function validateMintsEntry(obj: unknown) {
  const r = MintsEntrySchema.safeParse(obj);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}
```

- [ ] **Step 4: Write the backward test fixtures**

```javascript
// runtime/engine/backward/test/_fixtures.mjs — backward-local test helpers. Not ring-1 surface.
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { validCheck } from '../../test/_fixtures.mjs';   // reuse SPEC 1's canonical check factory

/** A minimal VALID CandidateDraft (deterministic). Override any field. entry has NO ratified (Δ2). */
export function validDraft(overrides = {}) {
  const entry = validCheck({
    id: 'sample-mint',
    status: 'candidate',
    kind: 'drift',
    evaluator: { type: 'deterministic', run: 'cmd:node tools/check-sample.mjs' },
    contexts: ['invariant', 'gate'],
    scope: { paths: ['services/**/src/**/*.ts'], dossiers: ['feedback_sample.md'] },
    provenance: { minted_by: 'sample-item', lesson: 'feedback_sample.md' },   // NO ratified
    ...(overrides.entry ?? {}),
  });
  const { entry: _drop, ...rest } = overrides;
  return {
    entry,
    eval_scenario: { path: 'runtime/eval/scenarios/sample-mint.scenario.mjs',
      fixtures: { good: ['fixtures/sample-mint/good/ok.ts'], bad: ['fixtures/sample-mint/bad/violation.ts'] },
      target_pass_rate: 1.0 },
    rationale: 'mechanizable, recurring, still intended — meets all three §8 gates',
    ...rest,
  };
}

/** Run `fn(root)` inside a fresh tmpdir with checks/, lessons/, scenarios/ subdirs. */
export function withTmpContent(fn) {
  const root = mkdtempSync(join(tmpdir(), 'nf-backward-'));
  const dirs = { root, checksDir: join(root, 'checks'), lessonsDir: join(root, 'lessons'), scenariosDir: join(root, 'scenarios') };
  for (const d of [dirs.checksDir, dirs.lessonsDir, dirs.scenariosDir]) mkdirSync(d, { recursive: true });
  try { return fn(dirs); } finally { rmSync(root, { recursive: true, force: true }); }
}

/** Write a lesson dossier `<name>.md` with YAML frontmatter + body under `dir`. */
export function writeDossier(dir, name, front, body = 'Lesson prose unchanged.\n') {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\n${stringify(front).trimEnd()}\n---\n${body}`, 'utf8');
}

export { validCheck };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test runtime/engine/backward/test/mints-entry.test.mjs`
Expected: PASS — 5/5.

- [ ] **Step 6: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/engine/backward/schema/mints-entry.ts runtime/engine/backward/test/_fixtures.mjs runtime/engine/backward/test/mints-entry.test.mjs
git -C .claude/worktrees/runtime-spec-2 rm --quiet runtime/engine/backward/schema/.gitkeep
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(runtime): MintsEntry schema + backward test fixtures (SPEC 2 B1)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task B2: `candidate-draft.ts` (encodes Δ2)

**Files:**
- Create: `runtime/engine/backward/schema/candidate-draft.ts`
- Test: `runtime/engine/backward/test/candidate-draft.test.mjs`

**Interfaces:**
- Consumes: `CheckEntrySchema` from `../../schema/check.schema.ts`.
- Produces: `EvalScenarioDraftSchema`, `CandidateDraftSchema`, `type CandidateDraft = { entry: CheckEntry; eval_scenario: EvalScenarioDraft; rationale: string; supersedes_candidate?: string }`, `validateCandidateDraft(obj)`.

- [ ] **Step 1: Write the failing test**

```javascript
// runtime/engine/backward/test/candidate-draft.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCandidateDraft } from '../schema/candidate-draft.ts';
import { validDraft } from './_fixtures.mjs';

test('D1 a valid deterministic draft passes', () => {
  assert.equal(validateCandidateDraft(validDraft()).ok, true);
});

test('D2 a draft whose entry.status is NOT candidate is rejected', () => {
  const d = validDraft({ entry: { ...validDraft().entry, status: 'active' } });
  const r = validateCandidateDraft(d);
  assert.equal(r.ok, false);
  assert.match(r.error, /candidate/);
});

test('D3 Δ2: a draft carrying provenance.ratified is rejected', () => {
  const base = validDraft();
  const d = { ...base, entry: { ...base.entry, provenance: { ...base.entry.provenance, ratified: '2026-07-02' } } };
  const r = validateCandidateDraft(d);
  assert.equal(r.ok, false);
  assert.match(r.error, /ratified/);
});

test('D4 target_pass_rate out of [0,1] is rejected', () => {
  const base = validDraft();
  const d = { ...base, eval_scenario: { ...base.eval_scenario, target_pass_rate: 1.5 } };
  assert.equal(validateCandidateDraft(d).ok, false);
});

test('D5 supersedes_candidate is accepted (superseding mint)', () => {
  assert.equal(validateCandidateDraft(validDraft({ supersedes_candidate: 'no-ddb-scan' })).ok, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/backward/test/candidate-draft.test.mjs`
Expected: FAIL — `Cannot find module '../schema/candidate-draft.ts'`.

- [ ] **Step 3: Write the schema**

```typescript
// runtime/engine/backward/schema/candidate-draft.ts — ring-1, SPEC 2 §4.1.
// The worker's post-ship draft: a candidate CheckEntry + what the floor needs to rule and the
// mint needs to land. Encodes Δ2 (a candidate carries NO provenance.ratified).
import { z } from 'zod';
import { CheckEntrySchema } from '../../schema/check.schema.ts';
import { formatZodError } from '../../schema/finding.schema.ts';

export const EvalScenarioDraftSchema = z.object({
  path: z.string().min(1),                                  // where it WILL land on ratify
  fixtures: z.object({ good: z.array(z.string()), bad: z.array(z.string()) }).strict(),
  target_pass_rate: z.number().min(0).max(1),               // judgment: flake budget = 1 - this; deterministic: 1.0
}).strict();
export type EvalScenarioDraft = z.infer<typeof EvalScenarioDraftSchema>;

export const CandidateDraftSchema = z.object({
  entry: CheckEntrySchema,
  eval_scenario: EvalScenarioDraftSchema,
  rationale: z.string().min(1),                             // the §8 mint-heuristic answer
  supersedes_candidate: z.string().optional(),             // CheckId this draft would REPLACE (routes to curate-supersede)
}).strict().superRefine((draft, ctx) => {
  if (draft.entry.status !== 'candidate') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entry', 'status'],
      message: "a draft's entry.status must be 'candidate'" });
  }
  if (draft.entry.provenance.ratified !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entry', 'provenance', 'ratified'],
      message: 'Δ2: a candidate draft must NOT carry provenance.ratified (stamped on ratify)' });
  }
});
export type CandidateDraft = z.infer<typeof CandidateDraftSchema>;

export function validateCandidateDraft(obj: unknown) {
  const r = CandidateDraftSchema.safeParse(obj);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/backward/test/candidate-draft.test.mjs`
Expected: PASS — 5/5.

- [ ] **Step 5: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/engine/backward/schema/candidate-draft.ts runtime/engine/backward/test/candidate-draft.test.mjs
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(runtime): CandidateDraft schema, encodes Δ2 ratified-unset (SPEC 2 B2)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task B3: `floor-choice.ts`, `floor-decision.ts`, `eval-landing.ts`

> Three small schemas in one task — each is a focused payload shape, they share no logic worth splitting, and one reviewer gate covers them.

**Files:**
- Create: `runtime/engine/backward/schema/floor-choice.ts`
- Create: `runtime/engine/backward/schema/floor-decision.ts`
- Create: `runtime/engine/backward/schema/eval-landing.ts`
- Test: `runtime/engine/backward/test/floor-schemas.test.mjs`

**Interfaces:**
- Consumes: `CheckEntrySchema`, `ProvenanceSchema`, `FlakeContractSchema` from `../../schema/check.schema.ts`; `FindingSchema` from `../../schema/finding.schema.ts`.
- Produces: `MintChoiceSchema`/`CurateChoiceSchema`/`FloorChoiceSchema` + types; `FloorDecisionSchema`/`validateFloorDecision` + type; `EvalScenarioLandingSchema`/`validateEvalScenarioLanding` + type.

- [ ] **Step 1: Write the failing test**

```javascript
// runtime/engine/backward/test/floor-schemas.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FloorChoiceSchema } from '../schema/floor-choice.ts';
import { validateFloorDecision } from '../schema/floor-decision.ts';
import { validateEvalScenarioLanding } from '../schema/eval-landing.ts';
import { validDraft, validCheck } from './_fixtures.mjs';

const mintChoice = () => ({ act: 'mint', candidate: validDraft().entry, lesson: 'feedback_sample.md',
  rationale: 'r', recommended: 'ratify', options: ['ratify', 'edit', 'decline'] });
const finding = () => ({ id: 'f1', check: 'no-ddb-scan', kind: 'staleness', scope: ['x'], detail: 'gone', raised_at: '2026-07-02T00:00:00Z' });
const curateChoice = () => ({ act: 'curate', guard: validCheck({ id: 'no-ddb-scan' }), trigger: 'dangling-scope',
  finding: finding(), rationale: '', recommended: 'retire', options: ['retire', 'supersede', 'keep'] });

test('FC1 a MintChoice parses via the discriminated union', () => {
  assert.equal(FloorChoiceSchema.safeParse(mintChoice()).success, true);
});
test('FC2 a CurateChoice parses via the discriminated union', () => {
  assert.equal(FloorChoiceSchema.safeParse(curateChoice()).success, true);
});
test('FC3 an unknown act is rejected', () => {
  assert.equal(FloorChoiceSchema.safeParse({ ...mintChoice(), act: 'nope' }).success, false);
});
test('FD1 a ratify decision (empty rationale allowed) passes', () => {
  const r = validateFloorDecision({ act: 'mint', transition: 'ratify', check: 'no-ddb-scan', rationale: '',
    provenance: { minted_by: 'i', ratified: '2026-07-02' }, decided_by: 'human', decided_at: '2026-07-02T00:00:00Z', journal_key: 'mint:no-ddb-scan:ratify' });
  assert.equal(r.ok, true);
});
test('FD2 a retire decision with EMPTY rationale is rejected', () => {
  const r = validateFloorDecision({ act: 'curate', transition: 'retire', check: 'x', rationale: '   ',
    provenance: { minted_by: 'i' }, decided_by: 'human', decided_at: 't', journal_key: 'curate:x:retire' });
  assert.equal(r.ok, false);
  assert.match(r.error, /rationale/);
});
test('FD3 a supersede decision without successor is rejected', () => {
  const r = validateFloorDecision({ act: 'curate', transition: 'supersede', check: 'x', rationale: 'narrowed',
    provenance: { minted_by: 'i' }, decided_by: 'human', decided_at: 't', journal_key: 'curate:x:supersede' });
  assert.equal(r.ok, false);
  assert.match(r.error, /successor/);
});
test('FD4 decided_by must be human (closed literal)', () => {
  const r = validateFloorDecision({ act: 'mint', transition: 'ratify', check: 'x', rationale: '',
    provenance: { minted_by: 'i', ratified: 't' }, decided_by: 'auto', decided_at: 't', journal_key: 'k' });
  assert.equal(r.ok, false);
});
test('EL1 a deterministic landing (no flake_contract) passes', () => {
  const r = validateEvalScenarioLanding({ check: 'no-ddb-scan', evaluator_kind: 'deterministic',
    scenario_path: 'runtime/eval/scenarios/no-ddb-scan.scenario.mjs', fixtures: { good: ['g'], bad: ['b'] }, registered_via: 'harness:landScenario' });
  assert.equal(r.ok, true);
});
test('EL2 a judgment landing WITHOUT flake_contract is rejected', () => {
  const r = validateEvalScenarioLanding({ check: 'x', evaluator_kind: 'judgment',
    scenario_path: 'p', fixtures: { good: [], bad: [] }, registered_via: 'harness:landScenario' });
  assert.equal(r.ok, false);
  assert.match(r.error, /flake_contract/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/backward/test/floor-schemas.test.mjs`
Expected: FAIL — cannot find `../schema/floor-choice.ts`.

- [ ] **Step 3a: Write `floor-choice.ts`**

```typescript
// runtime/engine/backward/schema/floor-choice.ts — ring-1, SPEC 2 §6.1.
// The two ask(decision)→choice payloads. A real bounded choice with exactly one recommended.
import { z } from 'zod';
import { CheckEntrySchema } from '../../schema/check.schema.ts';
import { FindingSchema } from '../../schema/finding.schema.ts';

export const MintChoiceSchema = z.object({
  act: z.literal('mint'),
  candidate: CheckEntrySchema,                             // status: 'candidate' (the §4.1 draft's entry)
  lesson: z.string().min(1),
  rationale: z.string().min(1),
  recommended: z.literal('ratify'),                        // deterministic-first drafts default to ratify
  options: z.tuple([z.literal('ratify'), z.literal('edit'), z.literal('decline')]),
}).strict();
export type MintChoice = z.infer<typeof MintChoiceSchema>;

export const CurateChoiceSchema = z.object({
  act: z.literal('curate'),
  guard: CheckEntrySchema,
  trigger: z.enum(['ship-gate-blocking', 'dangling-scope']),
  finding: FindingSchema,
  proposed_successor: CheckEntrySchema.optional(),
  rationale: z.string(),                                   // sync: WHY the property is no longer intended
  recommended: z.enum(['keep', 'supersede', 'retire']),
  options: z.tuple([z.literal('retire'), z.literal('supersede'), z.literal('keep')]),
}).strict();
export type CurateChoice = z.infer<typeof CurateChoiceSchema>;

export const FloorChoiceSchema = z.discriminatedUnion('act', [MintChoiceSchema, CurateChoiceSchema]);
export type FloorChoice = z.infer<typeof FloorChoiceSchema>;
```

- [ ] **Step 3b: Write `floor-decision.ts`**

```typescript
// runtime/engine/backward/schema/floor-decision.ts — ring-1, SPEC 2 §6.2.
// Append-only journaled record of a floor act. rationale REQUIRED for retire/supersede/decline.
import { z } from 'zod';
import { ProvenanceSchema } from '../../schema/check.schema.ts';
import { formatZodError } from '../../schema/finding.schema.ts';

export const FloorDecisionSchema = z.object({
  act: z.enum(['mint', 'curate']),
  transition: z.enum(['ratify', 'edit', 'decline', 'supersede', 'retire', 'keep']),
  check: z.string().min(1),
  successor: z.string().optional(),
  lesson: z.string().optional(),
  rationale: z.string(),
  provenance: ProvenanceSchema,
  decided_by: z.literal('human'),                          // ALWAYS human — never self-resolves in --auto
  decided_at: z.string().min(1),
  journal_key: z.string().min(1),
}).strict().superRefine((d, ctx) => {
  if (['retire', 'supersede', 'decline'].includes(d.transition) && !d.rationale.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rationale'],
      message: `transition '${d.transition}' requires a non-empty rationale` });
  }
  if (d.transition === 'supersede' && !d.successor) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['successor'], message: "transition 'supersede' requires a successor" });
  }
});
export type FloorDecision = z.infer<typeof FloorDecisionSchema>;

export function validateFloorDecision(obj: unknown) {
  const r = FloorDecisionSchema.safeParse(obj);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}
```

- [ ] **Step 3c: Write `eval-landing.ts`**

```typescript
// runtime/engine/backward/schema/eval-landing.ts — ring-1, SPEC 2 §9.
// The handoff contract SPEC 2 guarantees the SPEC-3 harness receives on ratify / superseding mint.
import { z } from 'zod';
import { FlakeContractSchema } from '../../schema/check.schema.ts';
import { formatZodError } from '../../schema/finding.schema.ts';

export const EvalScenarioLandingSchema = z.object({
  check: z.string().min(1),
  evaluator_kind: z.enum(['deterministic', 'judgment']),
  scenario_path: z.string().min(1),
  fixtures: z.object({ good: z.array(z.string()), bad: z.array(z.string()) }).strict(),
  flake_contract: FlakeContractSchema.optional(),          // REQUIRED iff judgment
  registered_via: z.literal('harness:landScenario'),
}).strict().superRefine((l, ctx) => {
  if (l.evaluator_kind === 'judgment' && !l.flake_contract) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['flake_contract'], message: 'a judgment landing must carry a flake_contract' });
  }
});
export type EvalScenarioLanding = z.infer<typeof EvalScenarioLandingSchema>;

export function validateEvalScenarioLanding(obj: unknown) {
  const r = EvalScenarioLandingSchema.safeParse(obj);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/backward/test/floor-schemas.test.mjs`
Expected: PASS — 9/9.

- [ ] **Step 5: Typecheck the new schemas**

Run: `NX_DAEMON=false pnpm nx run runtime:typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/engine/backward/schema/floor-choice.ts runtime/engine/backward/schema/floor-decision.ts runtime/engine/backward/schema/eval-landing.ts runtime/engine/backward/test/floor-schemas.test.mjs
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(runtime): FloorChoice/FloorDecision/EvalScenarioLanding schemas (SPEC 2 B3)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

---

## Phase C — Ring-1 procedure helpers (TDD)

> The moat. Each helper is a pure named-export core + thin `main()`. `ask`/`journal` are injected (D3) with headless defaults. Build order respects imports: capabilities → present-floor → draft-candidate → land-eval-scenario → reconcile-lesson → register-ratified → curate-guard → mint → curate.

### Task C1: `capabilities.mjs` — the injected SPEC-3 seam defaults

**Files:**
- Create: `runtime/engine/backward/lib/capabilities.mjs`
- Test: `runtime/engine/backward/test/capabilities.test.mjs`

**Interfaces:**
- Produces: `headlessAsk({ choice }) → { sentinel: string }` (never `{ selected }`); `inMemoryJournal() → { has(key), get(key), record(key, decision) }`.

- [ ] **Step 1: Write the failing test**

```javascript
// runtime/engine/backward/test/capabilities.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headlessAsk, inMemoryJournal } from '../lib/capabilities.mjs';
import { validDraft, validCheck } from './_fixtures.mjs';

test('CAP1 headlessAsk on a mint choice returns a HARNESS-PAUSE sentinel naming the candidate', () => {
  const a = headlessAsk({ choice: { act: 'mint', candidate: validDraft().entry } });
  assert.match(a.sentinel, /^<<HARNESS-PAUSE: mint sample-mint>>$/);
  assert.equal(a.selected, undefined);   // NEVER self-resolves
});

test('CAP2 headlessAsk on a curate choice names the guard', () => {
  const a = headlessAsk({ choice: { act: 'curate', guard: validCheck({ id: 'no-ddb-scan' }) } });
  assert.match(a.sentinel, /curate no-ddb-scan/);
});

test('CAP3 inMemoryJournal records once and replays the same value (idempotent)', () => {
  const j = inMemoryJournal();
  assert.equal(j.has('k'), false);
  const first = j.record('k', { v: 1 });
  assert.equal(j.has('k'), true);
  const second = j.record('k', { v: 2 });   // second write ignored
  assert.deepEqual(first, { v: 1 });
  assert.deepEqual(second, { v: 1 });
  assert.deepEqual(j.get('k'), { v: 1 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/backward/test/capabilities.test.mjs`
Expected: FAIL — cannot find `../lib/capabilities.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// runtime/engine/backward/lib/capabilities.mjs — the injected SPEC-3 capability SEAMS (D3).
// Ring-1 ships HEADLESS defaults; SPEC 3 injects real bindings (interactive ask, persistent journal).
// A floor act NEVER self-resolves in headless/--auto — ask returns a <<HARNESS-PAUSE>> sentinel (§6, §13.4).
import { fileURLToPath } from 'node:url';

/** Headless ask: returns { sentinel } — the caller MUST pause. Never returns a selected transition. */
export function headlessAsk({ choice }) {
  const id = choice.act === 'mint' ? choice.candidate.id : choice.guard.id;
  return { sentinel: `<<HARNESS-PAUSE: ${choice.act} ${id}>>` };
}

/** In-memory append-only idempotency ledger. SPEC 3 provides a persistent one. */
export function inMemoryJournal() {
  const seen = new Map();
  return {
    has: (key) => seen.has(key),
    get: (key) => seen.get(key),
    record: (key, decision) => { if (!seen.has(key)) seen.set(key, decision); return seen.get(key); },
  };
}

function main() { console.error('capabilities.mjs is a library; SPEC 3 injects real ask/journal'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/backward/test/capabilities.test.mjs`
Expected: PASS — 3/3.

- [ ] **Step 5: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/engine/backward/lib/capabilities.mjs runtime/engine/backward/test/capabilities.test.mjs
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(runtime): ask/journal capability seams with headless defaults (SPEC 2 C1)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task C2: `present-floor.mjs` — bind ask(), degrade to sentinel

**Files:**
- Create: `runtime/engine/backward/lib/present-floor.mjs`
- Test: `runtime/engine/backward/test/present-floor.test.mjs`

**Interfaces:**
- Consumes: `headlessAsk` from `./capabilities.mjs`.
- Produces: `presentFloor({ choice, ask? }) → { choice, selected?: string, sentinel?: string }`. `selected` is the resolved transition; `sentinel` set (and `selected` undefined) when paused. A malformed/absent selection degrades to a pause, never a silent default. (Refines §11's loose `{ choice, sentinel? }` by returning `selected` explicitly.)

- [ ] **Step 1: Write the failing test**

```javascript
// runtime/engine/backward/test/present-floor.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentFloor } from '../lib/present-floor.mjs';
import { validDraft } from './_fixtures.mjs';

const mintChoice = () => ({ act: 'mint', candidate: validDraft().entry, lesson: 'feedback_sample.md',
  rationale: 'r', recommended: 'ratify', options: ['ratify', 'edit', 'decline'] });

test('PF1 default (headless) ask → paused with sentinel, no selected', () => {
  const r = presentFloor({ choice: mintChoice() });
  assert.match(r.sentinel, /HARNESS-PAUSE: mint sample-mint/);
  assert.equal(r.selected, undefined);
});

test('PF2 an injected ask returning {selected:ratify} resolves', () => {
  const r = presentFloor({ choice: mintChoice(), ask: () => ({ selected: 'ratify' }) });
  assert.equal(r.selected, 'ratify');
  assert.equal(r.sentinel, undefined);
});

test('PF3 an injected ask returning an out-of-set selection degrades to a pause (never a silent default)', () => {
  const r = presentFloor({ choice: mintChoice(), ask: () => ({ selected: 'yolo' }) });
  assert.equal(r.selected, undefined);
  assert.match(r.sentinel, /HARNESS-PAUSE/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/backward/test/present-floor.test.mjs`
Expected: FAIL — cannot find `../lib/present-floor.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// present-floor.mjs — presentFloor(): binds the ask() capability (§6). In headless/--auto the injected
// ask returns a <<HARNESS-PAUSE>> sentinel and this NEVER self-resolves. A malformed/absent selection
// is treated as a pause, never a silent default (the recommended-bearing-choice discipline).
import { headlessAsk } from './capabilities.mjs';
import { fileURLToPath } from 'node:url';

export function presentFloor({ choice, ask = headlessAsk }) {
  const answer = ask({ choice }) ?? {};
  if (typeof answer.sentinel === 'string') return { choice, selected: undefined, sentinel: answer.sentinel };
  const selected = answer.selected;
  if (!choice.options.includes(selected)) {
    const id = choice.act === 'mint' ? choice.candidate.id : choice.guard.id;
    return { choice, selected: undefined, sentinel: `<<HARNESS-PAUSE: ${choice.act} ${id}>>` };
  }
  return { choice, selected, sentinel: undefined };
}

function main() { console.error('present-floor.mjs is a library; import presentFloor'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/backward/test/present-floor.test.mjs`
Expected: PASS — 3/3.

- [ ] **Step 5: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/engine/backward/lib/present-floor.mjs runtime/engine/backward/test/present-floor.test.mjs
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(runtime): presentFloor binds ask, degrades to sentinel (SPEC 2 C2)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task C3: `draft-candidate.mjs` — §4 step 2 + the §8 three-gate mint test

**Files:**
- Create: `runtime/engine/backward/lib/draft-candidate.mjs`
- Test: `runtime/engine/backward/test/draft-candidate.test.mjs`

**Interfaces:**
- Consumes: `validateCandidateDraft` from `../schema/candidate-draft.ts`.
- Produces: `draftCandidate({ item, lesson, proposal }) → CandidateDraft | null`. `item = { id }`; `lesson = string | { path|id|name }`; `proposal = { id, property, kind, evaluator, cost_tier?, contexts, scope, eval_scenario, rationale, gates: { mechanizable, recurring, stillIntended }, flake_contract?, supersedes_candidate? }`. Returns `null` when any §8 gate fails (retrieval-only lesson). (Refines §11's `{ item, lesson }` by carrying the worker's `proposal` — the worker supplies the property/fixtures/gate answers; the helper enforces the gates + assembles + validates.)

- [ ] **Step 1: Write the failing test**

```javascript
// runtime/engine/backward/test/draft-candidate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftCandidate } from '../lib/draft-candidate.mjs';

const proposal = (over = {}) => ({
  id: 'no-ddb-scan',
  property: 'No ScanCommand under services/**/src',
  kind: 'drift',
  evaluator: { type: 'deterministic', run: 'cmd:node tools/check-no-ddb-scan.mjs' },
  cost_tier: 'cheap',
  contexts: ['invariant', 'gate'],
  scope: { paths: ['services/**/src/**/*.ts'], dossiers: ['feedback_no_scan_no_filter.md'] },
  eval_scenario: { path: 'runtime/eval/scenarios/no-ddb-scan.scenario.mjs',
    fixtures: { good: ['fixtures/no-ddb-scan/good/query.ts'], bad: ['fixtures/no-ddb-scan/bad/scan.ts'] }, target_pass_rate: 1.0 },
  rationale: 'mechanizable forbidden-token set, recurring cost blowups, still intended',
  gates: { mechanizable: true, recurring: true, stillIntended: true },
  ...over,
});

test('DC1 all three §8 gates pass → a valid candidate draft (minted_by set, NO ratified)', () => {
  const d = draftCandidate({ item: { id: 'no-ddb-scan-guard' }, lesson: 'feedback_no_scan_no_filter.md', proposal: proposal() });
  assert.ok(d);
  assert.equal(d.entry.status, 'candidate');
  assert.equal(d.entry.evaluator.type, 'deterministic');
  assert.equal(d.entry.provenance.minted_by, 'no-ddb-scan-guard');
  assert.equal(d.entry.provenance.lesson, 'feedback_no_scan_no_filter.md');
  assert.equal(d.entry.provenance.ratified, undefined);      // Δ2
});

test('DC2 §8 category error: gate 1 (not mechanizable) fails → null, no draft', () => {
  const d = draftCandidate({ item: { id: 'i' }, lesson: 'feedback_cleanest_over_blast_radius.md',
    proposal: proposal({ gates: { mechanizable: false, recurring: true, stillIntended: true } }) });
  assert.equal(d, null);
});

test('DC3 gate 2 (not recurring) fails → null', () => {
  const d = draftCandidate({ item: { id: 'i' }, lesson: 'x', proposal: proposal({ gates: { mechanizable: true, recurring: false, stillIntended: true } }) });
  assert.equal(d, null);
});

test('DC4 gate 3 (not still intended) fails → null', () => {
  const d = draftCandidate({ item: { id: 'i' }, lesson: 'x', proposal: proposal({ gates: { mechanizable: true, recurring: true, stillIntended: false } }) });
  assert.equal(d, null);
});

test('DC5 a superseding draft carries supersedes_candidate', () => {
  const d = draftCandidate({ item: { id: 'i' }, lesson: 'x', proposal: proposal({ id: 'no-ddb-scan-v2', supersedes_candidate: 'no-ddb-scan' }) });
  assert.equal(d.supersedes_candidate, 'no-ddb-scan');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/backward/test/draft-candidate.test.mjs`
Expected: FAIL — cannot find `../lib/draft-candidate.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// draft-candidate.mjs — draftCandidate(): §4 step 2. The worker reduces a lesson to a single
// consistency property; this helper enforces the §8 three-gate test (fail any ⇒ null = retrieval-only),
// assembles the candidate CheckEntry (status candidate, provenance.minted_by + lesson, NO ratified — Δ2),
// wraps it, and validates. Deterministic-first (§8.2): a judgment proposal carries flake_contract.
import { validateCandidateDraft } from '../schema/candidate-draft.ts';
import { fileURLToPath } from 'node:url';

const lessonRef = (lesson) => (typeof lesson === 'string' ? lesson : (lesson.path ?? lesson.id ?? lesson.name));

export function draftCandidate({ item, lesson, proposal }) {
  const g = proposal?.gates ?? {};
  if (!(g.mechanizable === true && g.recurring === true && g.stillIntended === true)) return null;   // §8 gate

  const entry = {
    id: proposal.id,
    property: proposal.property,
    kind: proposal.kind,
    evaluator: proposal.evaluator,
    cost_tier: proposal.cost_tier ?? 'cheap',
    contexts: proposal.contexts,
    scope: proposal.scope,
    status: 'candidate',
    provenance: { minted_by: item.id, lesson: lessonRef(lesson) },   // Δ2: NO ratified
  };
  if (proposal.flake_contract) entry.flake_contract = proposal.flake_contract;   // judgment only

  const draft = { entry, eval_scenario: proposal.eval_scenario, rationale: proposal.rationale };
  if (proposal.supersedes_candidate) draft.supersedes_candidate = proposal.supersedes_candidate;

  const r = validateCandidateDraft(draft);
  if (!r.ok) throw new Error(`draftCandidate produced an invalid draft for "${proposal.id}": ${r.error}`);
  return r.value;
}

function main() { console.error('draft-candidate.mjs is a library; import draftCandidate'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/backward/test/draft-candidate.test.mjs`
Expected: PASS — 5/5.

- [ ] **Step 5: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/engine/backward/lib/draft-candidate.mjs runtime/engine/backward/test/draft-candidate.test.mjs
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(runtime): draftCandidate + §8 three-gate mint test (SPEC 2 C3)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task C4: `land-eval-scenario.mjs` — the §9 handoff (idempotent)

**Files:**
- Create: `runtime/engine/backward/lib/land-eval-scenario.mjs`
- Test: `runtime/engine/backward/test/land-eval-scenario.test.mjs`

**Interfaces:**
- Produces: `landEvalScenario({ draft, scenariosDir }) → EvalScenarioLanding`. Writes `<scenariosDir>/<check-id>.scenario.mjs` (idempotent — keyed by check id; a replay does not rewrite). A judgment landing includes `flake_contract` from `draft.entry.flake_contract`.

- [ ] **Step 1: Write the failing test**

```javascript
// runtime/engine/backward/test/land-eval-scenario.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { landEvalScenario } from '../lib/land-eval-scenario.mjs';
import { validateEvalScenarioLanding } from '../schema/eval-landing.ts';
import { validDraft, withTmpContent } from './_fixtures.mjs';

test('LE1 landing a deterministic draft writes the scenario file + returns a valid landing (no flake_contract)', () => {
  withTmpContent(({ scenariosDir }) => {
    const landing = landEvalScenario({ draft: validDraft(), scenariosDir });
    assert.equal(validateEvalScenarioLanding(landing).ok, true);
    assert.equal(landing.evaluator_kind, 'deterministic');
    assert.equal(landing.flake_contract, undefined);
    assert.equal(landing.registered_via, 'harness:landScenario');
    assert.ok(existsSync(join(scenariosDir, 'sample-mint.scenario.mjs')));
    assert.match(readFileSync(join(scenariosDir, 'sample-mint.scenario.mjs'), 'utf8'), /export const scenario/);
  });
});

test('LE2 landing is idempotent — a second call does not rewrite (same mtime content)', () => {
  withTmpContent(({ scenariosDir }) => {
    const first = landEvalScenario({ draft: validDraft(), scenariosDir });
    const body1 = readFileSync(first.scenario_path, 'utf8');
    const second = landEvalScenario({ draft: validDraft(), scenariosDir });
    assert.equal(second.scenario_path, first.scenario_path);
    assert.equal(readFileSync(second.scenario_path, 'utf8'), body1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/backward/test/land-eval-scenario.test.mjs`
Expected: FAIL — cannot find `../lib/land-eval-scenario.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// land-eval-scenario.mjs — landEvalScenario(): §9 handoff. Writes the scenario module (good/bad
// fixtures) so the learning loop is itself regression-protected, and returns the EvalScenarioLanding
// the SPEC-3 harness consumes. Idempotent: keyed by check id (a replay does not double-write).
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function landEvalScenario({ draft, scenariosDir }) {
  const { entry, eval_scenario } = draft;
  const kind = entry.evaluator.type;
  const scenarioPath = join(scenariosDir, `${entry.id}.scenario.mjs`);
  mkdirSync(dirname(scenarioPath), { recursive: true });
  if (!existsSync(scenarioPath)) writeFileSync(scenarioPath, renderScenarioModule(entry, eval_scenario), 'utf8');

  const landing = {
    check: entry.id,
    evaluator_kind: kind,
    scenario_path: scenarioPath,
    fixtures: eval_scenario.fixtures,
    registered_via: 'harness:landScenario',
  };
  if (kind === 'judgment') landing.flake_contract = entry.flake_contract;
  return landing;
}

function renderScenarioModule(entry, ev) {
  return `// AUTO-LANDED by SPEC 2 landEvalScenario — guards ${entry.id}. The SPEC-3 harness runs it:
// deterministic ⇒ golden gate (good → 0 findings, bad → ≥1 finding of kind ${entry.kind});
// judgment ⇒ calibrated (flake rate = 1 - gatePassRate must not exceed the flake budget).
export const scenario = {
  check: ${JSON.stringify(entry.id)},
  evaluator_kind: ${JSON.stringify(entry.evaluator.type)},
  run: ${JSON.stringify(entry.evaluator.run)},
  kind: ${JSON.stringify(entry.kind)},
  fixtures: ${JSON.stringify(ev.fixtures, null, 2)},
  target_pass_rate: ${ev.target_pass_rate},
};
`;
}

function main() { console.error('land-eval-scenario.mjs is a library; import landEvalScenario'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/backward/test/land-eval-scenario.test.mjs`
Expected: PASS — 2/2.

- [ ] **Step 5: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/engine/backward/lib/land-eval-scenario.mjs runtime/engine/backward/test/land-eval-scenario.test.mjs
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(runtime): landEvalScenario §9 handoff, idempotent by check id (SPEC 2 C4)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task C5: `reconcile-lesson.mjs` — the ONLY `mints:` writer (§7.1)

**Files:**
- Create: `runtime/engine/backward/lib/reconcile-lesson.mjs`
- Test: `runtime/engine/backward/test/reconcile-lesson.test.mjs`

**Interfaces:**
- Consumes: `validateMintsEntry` from `../schema/mints-entry.ts`; `yaml` `parse`/`stringify`.
- Produces: `reconcileLesson({ lesson, check, transition, successor?, ratified?, dossierRoot }) → { lesson: absPath, mints: MintsEntry[] }`. `transition ∈ ratify|retire|supersede`. `lesson` resolves against `dossierRoot` (D1) unless absolute. Mutates the dossier's `mints:` frontmatter in place: **ratify** appends `{check, ratified, status:'active'}`; **retire** flips that entry to `status:'retired'`; **supersede** flips it to `superseded`+`superseded_by` AND appends the successor active.

- [ ] **Step 1: Write the failing test**

```javascript
// runtime/engine/backward/test/reconcile-lesson.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { reconcileLesson } from '../lib/reconcile-lesson.mjs';
import { withTmpContent, writeDossier } from './_fixtures.mjs';

const front = () => ({ name: 'No scans', description: 'never scan', type: 'feedback' });
const readMints = (dir, name) => {
  const raw = readFileSync(join(dir, `${name}.md`), 'utf8');
  return parse(/^---\n([\s\S]*?)\n---/.exec(raw)[1]).mints;
};

test('RL1 ratify appends an active MintsEntry to a lesson with no mints yet', () => {
  withTmpContent(({ lessonsDir }) => {
    writeDossier(lessonsDir, 'feedback_x', front());
    const r = reconcileLesson({ lesson: 'feedback_x.md', check: 'no-ddb-scan', transition: 'ratify', ratified: '2026-07-02', dossierRoot: lessonsDir });
    assert.deepEqual(r.mints, [{ check: 'no-ddb-scan', ratified: '2026-07-02', status: 'active' }]);
    assert.deepEqual(readMints(lessonsDir, 'feedback_x'), r.mints);
  });
});

test('RL2 ratify is idempotent — re-ratifying the same check does not duplicate', () => {
  withTmpContent(({ lessonsDir }) => {
    writeDossier(lessonsDir, 'feedback_x', front());
    reconcileLesson({ lesson: 'feedback_x.md', check: 'no-ddb-scan', transition: 'ratify', ratified: '2026-07-02', dossierRoot: lessonsDir });
    const r = reconcileLesson({ lesson: 'feedback_x.md', check: 'no-ddb-scan', transition: 'ratify', ratified: '2026-07-02', dossierRoot: lessonsDir });
    assert.equal(r.mints.length, 1);
  });
});

test('RL3 retire flips the entry to retired (nothing removed)', () => {
  withTmpContent(({ lessonsDir }) => {
    writeDossier(lessonsDir, 'feedback_x', { ...front(), mints: [{ check: 'no-ddb-scan', ratified: '2026-07-02', status: 'active' }] });
    const r = reconcileLesson({ lesson: 'feedback_x.md', check: 'no-ddb-scan', transition: 'retire', dossierRoot: lessonsDir });
    assert.equal(r.mints[0].status, 'retired');
  });
});

test('RL4 supersede flips old→superseded+superseded_by AND appends successor active', () => {
  withTmpContent(({ lessonsDir }) => {
    writeDossier(lessonsDir, 'feedback_x', { ...front(), mints: [{ check: 'no-ddb-scan', ratified: '2026-07-02', status: 'active' }] });
    const r = reconcileLesson({ lesson: 'feedback_x.md', check: 'no-ddb-scan', transition: 'supersede', successor: 'no-ddb-scan-v2', ratified: '2026-09-11', dossierRoot: lessonsDir });
    const old = r.mints.find((e) => e.check === 'no-ddb-scan');
    const succ = r.mints.find((e) => e.check === 'no-ddb-scan-v2');
    assert.equal(old.status, 'superseded');
    assert.equal(old.superseded_by, 'no-ddb-scan-v2');
    assert.equal(succ.status, 'active');
  });
});

test('RL5 a lesson with no frontmatter throws (cannot reconcile)', () => {
  withTmpContent(({ lessonsDir }) => {
    // write a dossier body with NO frontmatter fence
    const p = join(lessonsDir, 'bad.md');
    require('node:fs').writeFileSync(p, 'no frontmatter here', 'utf8');
    assert.throws(() => reconcileLesson({ lesson: 'bad.md', check: 'x', transition: 'ratify', dossierRoot: lessonsDir }), /frontmatter/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/backward/test/reconcile-lesson.test.mjs`
Expected: FAIL — cannot find `../lib/reconcile-lesson.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// reconcile-lesson.mjs — reconcileLesson(): the ONLY writer of a lesson's mints: pointer (§7.1).
// derived-and-reconciled, never hand-edited (same contract as topic_memory↔related_workstreams).
// Mutates the dossier frontmatter under an injected dossierRoot (D1 in-repo mirror).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { parse, stringify } from 'yaml';
import { validateMintsEntry } from '../schema/mints-entry.ts';
import { fileURLToPath } from 'node:url';

const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function readDossier(path) {
  const raw = readFileSync(path, 'utf8');
  const m = FM_RE.exec(raw);
  if (!m) throw new Error(`dossier has no YAML frontmatter: ${path}`);
  return { front: parse(m[1]) ?? {}, body: m[2] };
}
function writeDossierFile(path, front, body) {
  writeFileSync(path, `---\n${stringify(front).trimEnd()}\n---\n${body}`, 'utf8');
}

export function reconcileLesson({ lesson, check, transition, successor, ratified, dossierRoot }) {
  const path = isAbsolute(lesson) ? lesson : join(dossierRoot, lesson);
  const { front, body } = readDossier(path);
  const mints = Array.isArray(front.mints) ? front.mints.map((e) => ({ ...e })) : [];
  const stamp = ratified ?? new Date().toISOString().slice(0, 10);

  if (transition === 'ratify') {
    if (!mints.some((e) => e.check === check)) mints.push({ check, ratified: stamp, status: 'active' });
  } else if (transition === 'retire') {
    const e = mints.find((x) => x.check === check);
    if (e) e.status = 'retired';
  } else if (transition === 'supersede') {
    const e = mints.find((x) => x.check === check);
    if (e) { e.status = 'superseded'; e.superseded_by = successor; }
    if (successor && !mints.some((x) => x.check === successor)) mints.push({ check: successor, ratified: stamp, status: 'active' });
  } else {
    throw new Error(`reconcileLesson: unsupported transition '${transition}'`);
  }

  for (const e of mints) { const r = validateMintsEntry(e); if (!r.ok) throw new Error(`invalid mints entry: ${r.error}`); }
  front.mints = mints;
  writeDossierFile(path, front, body);
  return { lesson: path, mints };
}

function main() { console.error('reconcile-lesson.mjs is a library; import reconcileLesson'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/backward/test/reconcile-lesson.test.mjs`
Expected: PASS — 5/5.

- [ ] **Step 5: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/engine/backward/lib/reconcile-lesson.mjs runtime/engine/backward/test/reconcile-lesson.test.mjs
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(runtime): reconcileLesson — sole mints: writer (SPEC 2 C5)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task C6: `register-ratified.mjs` — §4 step 4 atomic unit

**Files:**
- Create: `runtime/engine/backward/lib/register-ratified.mjs`
- Test: `runtime/engine/backward/test/register-ratified.test.mjs`

**Interfaces:**
- Consumes: `advanceLifecycle` from `../../lib/advance-lifecycle.mjs`; `landEvalScenario`, `reconcileLesson`, `inMemoryJournal`.
- Produces: `registerRatified({ draft, floorApproval, journal?, checksDir, dossierRoot, scenariosDir }) → { check, decision, landing, mints }`. Ordered side-effects under one `journal_key = mint:<id>:ratify`: (1) land scenario, (2) `advanceLifecycle('ratify')` + persist `<checksDir>/<id>.yaml`, (3) reconcile lesson. A replay (journal already has the key) returns the recorded result. A refusal (`floorApproval !== true`) writes NO yaml and returns `{ check, event, landing, decision: null }`.

- [ ] **Step 1: Write the failing test**

```javascript
// runtime/engine/backward/test/register-ratified.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { registerRatified } from '../lib/register-ratified.mjs';
import { inMemoryJournal } from '../lib/capabilities.mjs';
import { validateCheck } from '../../schema/check.schema.ts';
import { validDraft, withTmpContent, writeDossier } from './_fixtures.mjs';

const seedLesson = (lessonsDir) => writeDossier(lessonsDir, 'feedback_sample', { name: 'S', description: 'd', type: 'feedback' });

test('RR1 ratify performs ALL THREE side-effects (yaml persisted + active + ratified stamped, scenario landed, mints reconciled)', () => {
  withTmpContent(({ checksDir, lessonsDir, scenariosDir }) => {
    seedLesson(lessonsDir);
    const res = registerRatified({ draft: validDraft(), floorApproval: true, journal: inMemoryJournal(), checksDir, dossierRoot: lessonsDir, scenariosDir });
    // (a) yaml persisted, valid, active, ratified stamped
    const yamlPath = join(checksDir, 'sample-mint.yaml');
    assert.ok(existsSync(yamlPath));
    const persisted = parse(readFileSync(yamlPath, 'utf8'));
    assert.equal(validateCheck(persisted).ok, true);
    assert.equal(persisted.status, 'active');
    assert.ok(persisted.provenance.ratified);
    // (b) scenario landed
    assert.ok(existsSync(join(scenariosDir, 'sample-mint.scenario.mjs')));
    // (c) mints reconciled
    assert.equal(res.mints[0].check, 'sample-mint');
    assert.equal(res.decision.act, 'mint');
    assert.equal(res.decision.decided_by, 'human');
  });
});

test('RR2 floorless ratify writes NO yaml, no decision (advanceLifecycle refuses)', () => {
  withTmpContent(({ checksDir, lessonsDir, scenariosDir }) => {
    seedLesson(lessonsDir);
    const res = registerRatified({ draft: validDraft(), floorApproval: false, journal: inMemoryJournal(), checksDir, dossierRoot: lessonsDir, scenariosDir });
    assert.equal(res.decision, null);
    assert.equal(res.event, 'REFUSED_NO_FLOOR');
    assert.equal(existsSync(join(checksDir, 'sample-mint.yaml')), false);
  });
});

test('RR3 replay (same journal_key) is a no-op returning the first result — no double-mint', () => {
  withTmpContent(({ checksDir, lessonsDir, scenariosDir }) => {
    seedLesson(lessonsDir);
    const journal = inMemoryJournal();
    const first = registerRatified({ draft: validDraft(), floorApproval: true, journal, checksDir, dossierRoot: lessonsDir, scenariosDir });
    const second = registerRatified({ draft: validDraft(), floorApproval: true, journal, checksDir, dossierRoot: lessonsDir, scenariosDir });
    assert.equal(second, first);   // same object from the journal
    // lesson still has exactly ONE mints entry
    const raw = readFileSync(join(lessonsDir, 'feedback_sample.md'), 'utf8');
    assert.equal(parse(/^---\n([\s\S]*?)\n---/.exec(raw)[1]).mints.length, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/backward/test/register-ratified.test.mjs`
Expected: FAIL — cannot find `../lib/register-ratified.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// register-ratified.mjs — registerRatified(): §4 step 4, the ATOMIC journal-keyed unit.
// One journal_key ⇒ crash/clear replay is a no-op (§6.2). Order is load-bearing: land the scenario
// FIRST (so a judgment ratify guard is satisfiable), THEN advanceLifecycle('ratify') + persist,
// THEN reconcile the lesson. floorApproval is delegated to advanceLifecycle (REFUSED_NO_FLOOR).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { advanceLifecycle } from '../../lib/advance-lifecycle.mjs';
import { landEvalScenario } from './land-eval-scenario.mjs';
import { reconcileLesson } from './reconcile-lesson.mjs';
import { inMemoryJournal } from './capabilities.mjs';
import { fileURLToPath } from 'node:url';

export function registerRatified({ draft, floorApproval, journal = inMemoryJournal(), checksDir, dossierRoot, scenariosDir }) {
  const id = draft.entry.id;
  const journalKey = `mint:${id}:ratify`;
  if (journal.has(journalKey)) return journal.get(journalKey);          // replay → no-op

  const landing = landEvalScenario({ draft, scenariosDir });            // step 4.1 (FIRST)

  const { check, event } = advanceLifecycle({ check: draft.entry, transition: 'ratify', floorApproval });   // 4.2
  if (event !== 'RATIFIED' || !check) return { check, event, landing, decision: null, mints: [] };
  mkdirSync(checksDir, { recursive: true });
  writeFileSync(join(checksDir, `${id}.yaml`), stringify(check), 'utf8');

  const reconciled = check.provenance.lesson                            // 4.3
    ? reconcileLesson({ lesson: check.provenance.lesson, check: id, transition: 'ratify', ratified: check.provenance.ratified, dossierRoot })
    : { lesson: null, mints: [] };

  const decision = {
    act: 'mint', transition: 'ratify', check: id, lesson: check.provenance.lesson ?? undefined,
    rationale: draft.rationale, provenance: check.provenance, decided_by: 'human',
    decided_at: check.provenance.ratified, journal_key: journalKey,
  };
  const result = { check, decision, landing, mints: reconciled.mints };
  journal.record(journalKey, result);
  return result;
}

function main() { console.error('register-ratified.mjs is a library; import registerRatified'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/backward/test/register-ratified.test.mjs`
Expected: PASS — 3/3.

- [ ] **Step 5: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/engine/backward/lib/register-ratified.mjs runtime/engine/backward/test/register-ratified.test.mjs
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(runtime): registerRatified §4 atomic land→advance→reconcile (SPEC 2 C6)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task C7: `curate-guard.mjs` — §5 retire/supersede/keep

**Files:**
- Create: `runtime/engine/backward/lib/curate-guard.mjs`
- Test: `runtime/engine/backward/test/curate-guard.test.mjs`

**Interfaces:**
- Consumes: `advanceLifecycle`, `reconcileLesson`, `inMemoryJournal`.
- Produces: `curateGuard({ guard, trigger, transition, successor?, floorApproval, rationale, retiredReason?, journal?, checksDir, dossierRoot }) → { check, successor?, decision, kept? }`. `transition ∈ retire|supersede|keep`. **keep** is a procedure-level no-op — NEVER calls `advanceLifecycle` (Δ3) — returns `{ check: guard, kept: true, decision }` (no persist, no state change). **retire/supersede** wrap `advanceLifecycle`, persist the resulting YAML(s), reconcile the lesson, and journal under `curate:<id>:<transition>`.

- [ ] **Step 1: Write the failing test**

```javascript
// runtime/engine/backward/test/curate-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { curateGuard } from '../lib/curate-guard.mjs';
import { inMemoryJournal } from '../lib/capabilities.mjs';
import { withTmpContent, writeDossier, validCheck } from './_fixtures.mjs';

const activeGuard = (o = {}) => validCheck({ id: 'no-ddb-scan', status: 'active',
  provenance: { minted_by: 'no-ddb-scan-guard', lesson: 'feedback_x.md', ratified: '2026-07-02' }, ...o });
const seed = (lessonsDir) => writeDossier(lessonsDir, 'feedback_x', { name: 'X', description: 'd', type: 'feedback',
  mints: [{ check: 'no-ddb-scan', ratified: '2026-07-02', status: 'active' }] });

test('CG1 keep is a NO-OP: no persist, no state change, never calls advanceLifecycle', () => {
  withTmpContent(({ checksDir, lessonsDir }) => {
    seed(lessonsDir);
    const r = curateGuard({ guard: activeGuard(), trigger: 'ship-gate-blocking', transition: 'keep', rationale: '', checksDir, dossierRoot: lessonsDir });
    assert.equal(r.kept, true);
    assert.equal(r.check.status, 'active');
    assert.equal(existsSync(join(checksDir, 'no-ddb-scan.yaml')), false);
  });
});

test('CG2 retire → status retired, retired_reason recorded, lesson mints entry flipped to retired', () => {
  withTmpContent(({ checksDir, lessonsDir }) => {
    seed(lessonsDir);
    const r = curateGuard({ guard: activeGuard(), trigger: 'dangling-scope', transition: 'retire', floorApproval: true, rationale: 'code deleted', retiredReason: 'advisory-ctrl removed', checksDir, dossierRoot: lessonsDir });
    assert.equal(r.check.status, 'retired');
    assert.equal(r.check.provenance.retired_reason, 'advisory-ctrl removed');
    const mints = parse(/^---\n([\s\S]*?)\n---/.exec(readFileSync(join(lessonsDir, 'feedback_x.md'), 'utf8'))[1]).mints;
    assert.equal(mints[0].status, 'retired');
  });
});

test('CG3 supersede → old superseded_by successor, successor active supersedes old, BOTH yamls persisted, mints re-aimed', () => {
  withTmpContent(({ checksDir, lessonsDir }) => {
    seed(lessonsDir);
    const successor = validCheck({ id: 'no-ddb-scan-v2', status: 'active', provenance: { minted_by: 'narrow-ddb-filter-allowance', lesson: 'feedback_x.md', ratified: '2026-09-11' } });
    const r = curateGuard({ guard: activeGuard(), trigger: 'ship-gate-blocking', transition: 'supersede', successor, floorApproval: true, rationale: 'narrowed to GSI key attrs', checksDir, dossierRoot: lessonsDir });
    assert.equal(r.check.status, 'superseded');
    assert.equal(r.check.provenance.superseded_by, 'no-ddb-scan-v2');
    assert.equal(r.successor.provenance.supersedes, 'no-ddb-scan');
    assert.ok(existsSync(join(checksDir, 'no-ddb-scan.yaml')));
    assert.ok(existsSync(join(checksDir, 'no-ddb-scan-v2.yaml')));
    const mints = parse(/^---\n([\s\S]*?)\n---/.exec(readFileSync(join(lessonsDir, 'feedback_x.md'), 'utf8'))[1]).mints;
    assert.equal(mints.find((e) => e.check === 'no-ddb-scan').status, 'superseded');
    assert.equal(mints.find((e) => e.check === 'no-ddb-scan-v2').status, 'active');
  });
});

test('CG4 floorless retire refuses — no persist', () => {
  withTmpContent(({ checksDir, lessonsDir }) => {
    seed(lessonsDir);
    const r = curateGuard({ guard: activeGuard(), trigger: 'dangling-scope', transition: 'retire', floorApproval: false, rationale: 'x', checksDir, dossierRoot: lessonsDir });
    assert.equal(r.decision, null);
    assert.equal(existsSync(join(checksDir, 'no-ddb-scan.yaml')), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/backward/test/curate-guard.test.mjs`
Expected: FAIL — cannot find `../lib/curate-guard.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// curate-guard.mjs — curateGuard(): §5. Wraps advanceLifecycle('retire'|'supersede') + reconcileLesson.
// 'keep' is a procedure-level NO-OP (Δ3: merged advanceLifecycle LEGAL has no 'keep') — never advances state.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { advanceLifecycle } from '../../lib/advance-lifecycle.mjs';
import { reconcileLesson } from './reconcile-lesson.mjs';
import { inMemoryJournal } from './capabilities.mjs';
import { fileURLToPath } from 'node:url';

export function curateGuard({ guard, trigger, transition, successor, floorApproval, rationale, retiredReason, journal = inMemoryJournal(), checksDir, dossierRoot }) {
  if (transition === 'keep') {                                          // §5 keep — no state change, no persist
    return { check: guard, kept: true, decision: keepDecision(guard, trigger, rationale) };
  }
  const journalKey = `curate:${guard.id}:${transition}`;
  if (journal.has(journalKey)) return journal.get(journalKey);

  const res = advanceLifecycle({ check: guard, transition, floorApproval, successor, retiredReason });
  if (res.event !== 'RETIRED' && res.event !== 'SUPERSEDED') return { check: guard, event: res.event, decision: null };

  mkdirSync(checksDir, { recursive: true });
  writeFileSync(join(checksDir, `${res.check.id}.yaml`), stringify(res.check), 'utf8');
  if (res.successor) writeFileSync(join(checksDir, `${res.successor.id}.yaml`), stringify(res.successor), 'utf8');

  const lesson = guard.provenance.lesson;
  const reconciled = lesson
    ? reconcileLesson({ lesson, check: guard.id, transition, successor: successor?.id, dossierRoot })
    : { lesson: null, mints: [] };

  const decision = {
    act: 'curate', transition, check: guard.id, successor: successor?.id, lesson: lesson ?? undefined,
    rationale: rationale ?? '', provenance: res.check.provenance, decided_by: 'human',
    decided_at: new Date().toISOString(), journal_key: journalKey,
  };
  const result = { check: res.check, successor: res.successor, decision, mints: reconciled.mints };
  journal.record(journalKey, result);
  return result;
}

function keepDecision(guard, trigger, rationale) {
  return { act: 'curate', transition: 'keep', check: guard.id, rationale: rationale ?? '',
    provenance: guard.provenance, decided_by: 'human', decided_at: new Date().toISOString(),
    journal_key: `curate:${guard.id}:keep:${trigger}` };
}

function main() { console.error('curate-guard.mjs is a library; import curateGuard'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/backward/test/curate-guard.test.mjs`
Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/engine/backward/lib/curate-guard.mjs runtime/engine/backward/test/curate-guard.test.mjs
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(runtime): curateGuard retire/supersede/keep; keep never advances (SPEC 2 C7)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task C8: `mint.mjs` — the `runMint` procedure composition (§4, §11.1)

**Files:**
- Create: `runtime/engine/backward/lib/mint.mjs`
- Test: `runtime/engine/backward/test/mint.test.mjs`

**Interfaces:**
- Consumes: `draftCandidate`, `presentFloor`, `registerRatified`, `advanceLifecycle`, `headlessAsk`, `inMemoryJournal`.
- Produces: `runMint({ item, lesson, proposal, ask?, journal?, checksDir, dossierRoot, scenariosDir }) → { kind, ... }` where `kind ∈ rejected|paused|minted|declined|edit`. `rejected` = §8 category error (no draft); `paused` = headless/--auto floor (`{ sentinel }`); `minted` = registerRatified result; `declined` = discarded; `edit` = re-draft loop back to caller.

- [ ] **Step 1: Write the failing test**

```javascript
// runtime/engine/backward/test/mint.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runMint } from '../lib/mint.mjs';
import { inMemoryJournal } from '../lib/capabilities.mjs';
import { withTmpContent, writeDossier } from './_fixtures.mjs';

const proposal = (over = {}) => ({
  id: 'no-ddb-scan', property: 'No ScanCommand', kind: 'drift',
  evaluator: { type: 'deterministic', run: 'cmd:node tools/check-no-ddb-scan.mjs' },
  cost_tier: 'cheap', contexts: ['invariant', 'gate'],
  scope: { paths: ['services/**/src/**/*.ts'], dossiers: ['feedback_no_scan_no_filter.md'] },
  eval_scenario: { path: 'runtime/eval/scenarios/no-ddb-scan.scenario.mjs', fixtures: { good: ['g'], bad: ['b'] }, target_pass_rate: 1.0 },
  rationale: 'meets all three gates', gates: { mechanizable: true, recurring: true, stillIntended: true }, ...over,
});
const seed = (lessonsDir) => writeDossier(lessonsDir, 'feedback_no_scan_no_filter', { name: 'S', description: 'd', type: 'feedback' });
const args = (dirs, over) => ({ item: { id: 'no-ddb-scan-guard' }, lesson: 'feedback_no_scan_no_filter.md', proposal: proposal(), journal: inMemoryJournal(), checksDir: dirs.checksDir, dossierRoot: dirs.lessonsDir, scenariosDir: dirs.scenariosDir, ...over });

test('MI1 §11.1-1/2 human ratify → kind minted, all three side-effects', () => {
  withTmpContent((dirs) => {
    seed(dirs.lessonsDir);
    const r = runMint(args(dirs, { ask: () => ({ selected: 'ratify' }) }));
    assert.equal(r.kind, 'minted');
    assert.ok(existsSync(join(dirs.checksDir, 'no-ddb-scan.yaml')));
    assert.equal(r.mints[0].check, 'no-ddb-scan');
  });
});

test('MI2 §11.1-3 --auto/headless → kind paused, sentinel, NO yaml, NO mints', () => {
  withTmpContent((dirs) => {
    seed(dirs.lessonsDir);
    const r = runMint(args(dirs));   // default headless ask
    assert.equal(r.kind, 'paused');
    assert.match(r.sentinel, /HARNESS-PAUSE: mint no-ddb-scan/);
    assert.equal(existsSync(join(dirs.checksDir, 'no-ddb-scan.yaml')), false);
  });
});

test('MI3 §11.1-4 decline → kind declined, no yaml, no scenario, no mints', () => {
  withTmpContent((dirs) => {
    seed(dirs.lessonsDir);
    const r = runMint(args(dirs, { ask: () => ({ selected: 'decline' }) }));
    assert.equal(r.kind, 'declined');
    assert.equal(existsSync(join(dirs.checksDir, 'no-ddb-scan.yaml')), false);
    assert.equal(existsSync(join(dirs.scenariosDir, 'no-ddb-scan.scenario.mjs')), false);
  });
});

test('MI4 §11.1-6 retrieval-only lesson (gate 1 fails) → kind rejected, nothing drafted', () => {
  withTmpContent((dirs) => {
    seed(dirs.lessonsDir);
    const r = runMint(args(dirs, { proposal: proposal({ gates: { mechanizable: false, recurring: true, stillIntended: true } }), ask: () => ({ selected: 'ratify' }) }));
    assert.equal(r.kind, 'rejected');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/backward/test/mint.test.mjs`
Expected: FAIL — cannot find `../lib/mint.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// mint.mjs — runMint(): the reference composition of the §4 mint procedure over the six helpers.
// SPEC 3's worker composes the same helpers; the dogfood (§10) uses this entry point.
import { draftCandidate } from './draft-candidate.mjs';
import { presentFloor } from './present-floor.mjs';
import { registerRatified } from './register-ratified.mjs';
import { advanceLifecycle } from '../../lib/advance-lifecycle.mjs';
import { headlessAsk, inMemoryJournal } from './capabilities.mjs';
import { fileURLToPath } from 'node:url';

export function runMint({ item, lesson, proposal, ask = headlessAsk, journal = inMemoryJournal(), checksDir, dossierRoot, scenariosDir }) {
  const draft = draftCandidate({ item, lesson, proposal });
  if (!draft) return { kind: 'rejected', reason: 'not-mechanizable' };                 // §8 category error

  const choice = {
    act: 'mint', candidate: draft.entry, lesson: draft.entry.provenance.lesson,
    rationale: draft.rationale, recommended: 'ratify', options: ['ratify', 'edit', 'decline'],
  };
  const { selected, sentinel } = presentFloor({ choice, ask });
  if (sentinel) return { kind: 'paused', sentinel };                                    // --auto/headless

  if (selected === 'ratify') {
    return { kind: 'minted', ...registerRatified({ draft, floorApproval: true, journal, checksDir, dossierRoot, scenariosDir }) };
  }
  if (selected === 'decline') {
    advanceLifecycle({ check: draft.entry, transition: 'decline', floorApproval: true });  // discarded, never persisted
    return { kind: 'declined' };
  }
  return { kind: 'edit', draft };                                                       // re-draft loop (caller)
}

function main() { console.error('mint.mjs is a library; import runMint'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/backward/test/mint.test.mjs`
Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/engine/backward/lib/mint.mjs runtime/engine/backward/test/mint.test.mjs
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(runtime): runMint procedure composition (SPEC 2 C8)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task C9: `curate.mjs` — the `runCurate` procedure composition (§5, §11.2/§11.3)

**Files:**
- Create: `runtime/engine/backward/lib/curate.mjs`
- Test: `runtime/engine/backward/test/curate.test.mjs`

**Interfaces:**
- Consumes: `presentFloor`, `curateGuard`, `headlessAsk`, `inMemoryJournal`.
- Produces: `runCurate({ guard, trigger, finding, proposedSuccessor?, rationale?, ask?, journal?, checksDir, dossierRoot }) → { kind, ... }` where `kind ∈ paused|kept|retired|superseded`. `recommended` defaults by trigger: `dangling-scope → retire`, `ship-gate-blocking → keep`.

- [ ] **Step 1: Write the failing test**

```javascript
// runtime/engine/backward/test/curate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCurate } from '../lib/curate.mjs';
import { inMemoryJournal } from '../lib/capabilities.mjs';
import { withTmpContent, writeDossier, validCheck } from './_fixtures.mjs';

const guard = () => validCheck({ id: 'no-ddb-scan', status: 'active', provenance: { minted_by: 'g', lesson: 'feedback_x.md', ratified: '2026-07-02' } });
const finding = (kind = 'staleness') => ({ id: 'f1', check: 'no-ddb-scan', kind, scope: ['services/advisory/advisory-ctrl/**'], detail: 'zero files', raised_at: '2026-07-02T00:00:00Z' });
const seed = (d) => writeDossier(d, 'feedback_x', { name: 'X', description: 'd', type: 'feedback', mints: [{ check: 'no-ddb-scan', ratified: '2026-07-02', status: 'active' }] });

test('CU1 §11.3 dangling-scope + human retire → kind retired', () => {
  withTmpContent((dirs) => {
    seed(dirs.lessonsDir);
    const r = runCurate({ guard: guard(), trigger: 'dangling-scope', finding: finding(), rationale: 'advisory-ctrl removed', ask: () => ({ selected: 'retire' }), journal: inMemoryJournal(), checksDir: dirs.checksDir, dossierRoot: dirs.lessonsDir });
    assert.equal(r.kind, 'retired');
    assert.equal(r.check.status, 'retired');
  });
});

test('CU2 §11.2-3 sync guard-fail + human keep (default) → kind kept, no state change', () => {
  withTmpContent((dirs) => {
    seed(dirs.lessonsDir);
    const r = runCurate({ guard: guard(), trigger: 'ship-gate-blocking', finding: finding('drift'), ask: () => ({ selected: 'keep' }), journal: inMemoryJournal(), checksDir: dirs.checksDir, dossierRoot: dirs.lessonsDir });
    assert.equal(r.kind, 'kept');
    assert.equal(r.check.status, 'active');
  });
});

test('CU3 §11.2-4 --auto at a curate floor → kind paused (lowering a guard is a hard-floor act)', () => {
  withTmpContent((dirs) => {
    seed(dirs.lessonsDir);
    const r = runCurate({ guard: guard(), trigger: 'ship-gate-blocking', finding: finding('drift'), journal: inMemoryJournal(), checksDir: dirs.checksDir, dossierRoot: dirs.lessonsDir });
    assert.equal(r.kind, 'paused');
    assert.match(r.sentinel, /HARNESS-PAUSE: curate no-ddb-scan/);
  });
});

test('CU4 §11.2-2 sync + human supersede → kind superseded, successor active', () => {
  withTmpContent((dirs) => {
    seed(dirs.lessonsDir);
    const successor = validCheck({ id: 'no-ddb-scan-v2', status: 'active', provenance: { minted_by: 'narrow-ddb-filter-allowance', lesson: 'feedback_x.md', ratified: '2026-09-11' } });
    const r = runCurate({ guard: guard(), trigger: 'ship-gate-blocking', finding: finding('drift'), proposedSuccessor: successor, rationale: 'narrowed', ask: () => ({ selected: 'supersede' }), journal: inMemoryJournal(), checksDir: dirs.checksDir, dossierRoot: dirs.lessonsDir });
    assert.equal(r.kind, 'superseded');
    assert.equal(r.successor.provenance.supersedes, 'no-ddb-scan');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/backward/test/curate.test.mjs`
Expected: FAIL — cannot find `../lib/curate.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// curate.mjs — runCurate(): the reference composition of the §5 curate procedure. Both triggers feed
// ONE floor decision (retire · supersede · keep). recommended default: dangling-scope → retire,
// ship-gate → keep (guard presumed right). Lowering a guard is a hard-floor act (pauses in --auto).
import { presentFloor } from './present-floor.mjs';
import { curateGuard } from './curate-guard.mjs';
import { headlessAsk, inMemoryJournal } from './capabilities.mjs';
import { fileURLToPath } from 'node:url';

export function runCurate({ guard, trigger, finding, proposedSuccessor, rationale = '', ask = headlessAsk, journal = inMemoryJournal(), checksDir, dossierRoot }) {
  const recommended = trigger === 'dangling-scope' ? 'retire' : 'keep';
  const choice = {
    act: 'curate', guard, trigger, finding,
    ...(proposedSuccessor ? { proposed_successor: proposedSuccessor } : {}),
    rationale, recommended, options: ['retire', 'supersede', 'keep'],
  };
  const { selected, sentinel } = presentFloor({ choice, ask });
  if (sentinel) return { kind: 'paused', sentinel };

  if (selected === 'keep') return { kind: 'kept', ...curateGuard({ guard, trigger, transition: 'keep', rationale, journal, checksDir, dossierRoot }) };
  if (selected === 'retire') return { kind: 'retired', ...curateGuard({ guard, trigger, transition: 'retire', floorApproval: true, rationale: rationale || 'property abandoned', retiredReason: rationale || 'property abandoned', journal, checksDir, dossierRoot }) };
  return { kind: 'superseded', ...curateGuard({ guard, trigger, transition: 'supersede', successor: proposedSuccessor, floorApproval: true, rationale: rationale || 'property narrowed', journal, checksDir, dossierRoot }) };
}

function main() { console.error('curate.mjs is a library; import runCurate'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/backward/test/curate.test.mjs`
Expected: PASS — 4/4.

- [ ] **Step 5: Full ring-1 suite + typecheck green**

Run: `NX_DAEMON=false pnpm nx run runtime:test`
Expected: PASS — all `runtime/engine/test/*` (SPEC 1) AND all `runtime/engine/backward/test/*` (SPEC 2 C1-C9) suites green.

Run: `NX_DAEMON=false pnpm nx run runtime:typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/engine/backward/lib/curate.mjs runtime/engine/backward/test/curate.test.mjs
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(runtime): runCurate procedure composition; ring-1 backward edge complete (SPEC 2 C9)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

---

## Phase D — Dogfood evaluators (seam #2, TDD)

> Five `tools/check-<id>.mjs` deterministic `drift` gates — each a pure `findViolations(text, relPath)` predicate over the shared `tools/lib/text-scan.mjs` walker. `run` grammar is `cmd:node tools/check-<id>.mjs` (Δ1). Golden gates run the predicate over committed `runtime/eval/scenarios/fixtures/<id>/{good,bad}/` corpora (good → 0, bad → ≥1). **These validate over fixtures, NOT the live codebase** — whether `services/**` currently passes is a SPEC-3 watch-engine concern.

### Task D0: `tools/lib/text-scan.mjs` — the reusable gate scaffold

**Files:**
- Create: `tools/lib/text-scan.mjs`
- Test: `tools/lib/text-scan.test.mjs`

**Interfaces:**
- Produces: `parseRootArg(argv)`, `lineOf(text, idx)`, `walkFiles(root, opts)` (generator of `{ relPath, text }`), `runGate(root, findViolations, walkOpts)` → violations[], `reportAndExit(label, violations)` (CLI exit 0/1), `parseExclusions(root, file)` → `Set<relPath>`.

- [ ] **Step 1: Write the failing test**

```javascript
// tools/lib/text-scan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkFiles, runGate, parseExclusions, lineOf, parseRootArg } from './text-scan.mjs';

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'nf-scan-'));
  for (const [rel, contents] of Object.entries(files)) { const abs = join(root, rel); mkdirSync(join(abs, '..'), { recursive: true }); writeFileSync(abs, contents, 'utf8'); }
  return root;
}
const clean = (root) => rmSync(root, { recursive: true, force: true });

test('TS1 walkFiles yields .ts under services/, skips node_modules + (excludeTest) test/', () => {
  const root = tree({ 'services/x/src/a.ts': 'A', 'services/x/test/b.ts': 'B', 'services/x/node_modules/c.ts': 'C', 'services/x/src/d.js': 'D' });
  try {
    const rels = [...walkFiles(root, { includeUnder: ['services'], ext: ['.ts'], excludeTest: true })].map((f) => f.relPath).sort();
    assert.deepEqual(rels, ['services/x/src/a.ts']);
  } finally { clean(root); }
});

test('TS2 runGate aggregates a predicate across files', () => {
  const root = tree({ 'services/x/src/a.ts': 'bad\nbad', 'services/x/src/b.ts': 'ok' });
  try {
    const v = runGate(root, (text, relPath) => text.includes('bad') ? [{ rule: 'r', relPath, line: 1, token: 'bad' }] : [], { includeUnder: ['services'] });
    assert.equal(v.length, 1);
    assert.equal(v[0].relPath, 'services/x/src/a.ts');
  } finally { clean(root); }
});

test('TS3 parseExclusions reads {path,reason}, absent file → empty, bad entry throws', () => {
  const root = tree({ 'tools/x-exclusions.json': '{"exclusions":[{"path":"services/x/src/ok.ts","reason":"vetted"}]}' });
  try {
    assert.deepEqual([...parseExclusions(root, 'tools/x-exclusions.json')], ['services/x/src/ok.ts']);
    assert.equal(parseExclusions(root, 'tools/missing.json').size, 0);
  } finally { clean(root); }
  const bad = tree({ 'tools/b.json': '{"exclusions":[{"path":"p"}]}' });
  try { assert.throws(() => parseExclusions(bad, 'tools/b.json'), /reason/); } finally { clean(bad); }
});

test('TS4 lineOf + parseRootArg', () => {
  assert.equal(lineOf('a\nb\nc', 4), 3);
  assert.equal(parseRootArg(['node', 's', '--root', '/tmp/x']), '/tmp/x');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/lib/text-scan.test.mjs`
Expected: FAIL — cannot find `./text-scan.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// tools/lib/text-scan.mjs — reusable scaffold for deterministic drift gates (SPEC 2 §10 template).
// A gate = a pure findViolations(text, relPath) predicate + this walker. Mirrors the house string/regex
// style of tools/check-read-model-drift.mjs, factored so the 5 dogfood checks share one walker.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DEFAULT_EXCLUDE = ['node_modules', 'dist', 'cdk.out', '.worktrees', '.nx', 'coverage'];

export function parseRootArg(argv) { const i = argv.indexOf('--root'); return i >= 0 ? argv[i + 1] : process.cwd(); }
export function lineOf(text, index) { return text.slice(0, index).split('\n').length; }

export function* walkFiles(root, { includeUnder = ['services'], ext = ['.ts'], excludeFragments = DEFAULT_EXCLUDE, excludeTest = false } = {}) {
  const seen = new Set();
  for (const u of includeUnder) {
    for (const abs of walk(join(root, u), excludeFragments)) {
      if (!ext.some((e) => abs.endsWith(e))) continue;
      const rel = relative(root, abs).split(sep).join('/');
      if (excludeTest && /(^|\/)test\//.test(rel)) continue;
      if (seen.has(rel)) continue;
      seen.add(rel);
      let text; try { text = readFileSync(abs, 'utf8'); } catch { continue; }
      yield { relPath: rel, text };
    }
  }
}

function* walk(dir, excludeFragments) {
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (excludeFragments.includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, excludeFragments);
    else if (e.isFile()) yield p;
  }
}

export function runGate(root, findViolations, walkOpts) {
  const all = [];
  for (const { relPath, text } of walkFiles(root, walkOpts)) all.push(...findViolations(text, relPath));
  return all;
}

export function reportAndExit(label, violations) {
  if (violations.length === 0) { console.log(`${label}: OK (0 violations)`); process.exit(0); }
  console.error(`${label}: FAIL — ${violations.length} violation(s):`);
  for (const v of violations) console.error(`  [${v.rule}] ${v.relPath}:${v.line} — ${v.token ?? v.detail ?? ''}`);
  process.exit(1);
}

/** Optional scope-narrowing sidecar: [{path, reason}] → Set<path>. Absent → empty; bad entry throws. */
export function parseExclusions(root, file) {
  let raw; try { raw = readFileSync(join(root, file), 'utf8'); } catch { return new Set(); }
  let parsed; try { parsed = JSON.parse(raw); } catch (e) { throw new Error(`${file}: invalid JSON — ${e.message}`); }
  const entries = Array.isArray(parsed) ? parsed : (parsed.exclusions ?? []);
  const set = new Set();
  for (const e of entries) {
    if (!e || typeof e.path !== 'string' || !e.path || typeof e.reason !== 'string' || !e.reason.trim())
      throw new Error(`${file}: each entry needs non-empty {path, reason} — bad: ${JSON.stringify(e)}`);
    set.add(e.path);
  }
  return set;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/lib/text-scan.test.mjs`
Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add tools/lib/text-scan.mjs tools/lib/text-scan.test.mjs
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(tools): reusable text-scan gate scaffold (SPEC 2 D0)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task D1: `check-no-ddb-scan` (exemplar — full vertical)

**Files:**
- Create: `tools/check-no-ddb-scan.mjs`, `tools/check-no-ddb-scan.test.mjs`
- Create fixtures: `runtime/eval/scenarios/fixtures/no-ddb-scan/good/gsi-query.ts`, `.../bad/scan-command.ts`, `.../bad/filter-on-typename.ts`

**Interfaces:**
- Consumes: `tools/lib/text-scan.mjs`.
- Produces: `findViolations(text, relPath) → { rule, relPath, line, token }[]` (rule `ddb-scan` | `filter-on-key-attr`); CLI `node tools/check-no-ddb-scan.mjs [--root <dir>]` exit 0 clean / 1 on violations.

- [ ] **Step 1: Write the fixtures** (the golden/calibration corpus)

`runtime/eval/scenarios/fixtures/no-ddb-scan/good/gsi-query.ts`:
```typescript
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
export const q = new QueryCommand({ TableName: 't', KeyConditionExpression: 'tenantId = :t', ExpressionAttributeValues: { ':t': 'x' } });
```

`runtime/eval/scenarios/fixtures/no-ddb-scan/bad/scan-command.ts`:
```typescript
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
export const s = new ScanCommand({ TableName: 't' });
```

`runtime/eval/scenarios/fixtures/no-ddb-scan/bad/filter-on-typename.ts`:
```typescript
export const q = { TableName: 't', FilterExpression: '#tn = :v', ExpressionAttributeNames: { '#tn': '__typename' } };
```

- [ ] **Step 2: Write the failing test**

```javascript
// tools/check-no-ddb-scan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { findViolations } from './check-no-ddb-scan.mjs';

const FX = 'runtime/eval/scenarios/fixtures/no-ddb-scan';
const SCRIPT = join(process.cwd(), 'tools/check-no-ddb-scan.mjs');

test('NDS1 golden gate: every GOOD fixture → 0 violations', () => {
  for (const f of readdirSync(`${FX}/good`)) assert.equal(findViolations(readFileSync(`${FX}/good/${f}`, 'utf8'), `services/x/src/${f}`).length, 0, f);
});
test('NDS2 golden gate: every BAD fixture → ≥1 violation', () => {
  for (const f of readdirSync(`${FX}/bad`)) assert.ok(findViolations(readFileSync(`${FX}/bad/${f}`, 'utf8'), `services/x/src/${f}`).length >= 1, f);
});
test('NDS3 files outside /src/ are ignored', () => {
  assert.equal(findViolations('new ScanCommand({})', 'services/x/test/a.ts').length, 0);
});
test('NDS4 CLI exits 1 and names the token on a bad tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'nf-nds-'));
  try {
    mkdirSync(join(root, 'services/x/src'), { recursive: true });
    writeFileSync(join(root, 'services/x/src/a.ts'), 'new ScanCommand({})', 'utf8');
    const r = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /ScanCommand/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('NDS5 CLI exits 0 on a clean tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'nf-nds-'));
  try {
    mkdirSync(join(root, 'services/x/src'), { recursive: true });
    writeFileSync(join(root, 'services/x/src/a.ts'), 'new QueryCommand({ KeyConditionExpression: "x" })', 'utf8');
    assert.equal(spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' }).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tools/check-no-ddb-scan.test.mjs`
Expected: FAIL — cannot find `./check-no-ddb-scan.mjs`.

- [ ] **Step 4: Write the implementation**

```javascript
#!/usr/bin/env node
// check-no-ddb-scan.mjs — mints from feedback_no_scan_no_filter (SPEC 2 §10). drift gate.
// No ScanCommand/.scan(/scanAll under services/**/src, no FilterExpression on a GSI KEY attr.
import { fileURLToPath } from 'node:url';
import { lineOf, parseRootArg, runGate, reportAndExit } from './lib/text-scan.mjs';

const SCAN_TOKENS = [/\bScanCommand\b/g, /(?<![.\w])\.scan\s*\(/g, /\bscanAll\b/g];
const KEY_ATTRS = ['__typename', 'tenantId', 'timestamp'];

export function findViolations(text, relPath) {
  if (!relPath.includes('/src/')) return [];
  const v = [];
  for (const re of SCAN_TOKENS) { re.lastIndex = 0; let m; while ((m = re.exec(text))) v.push({ rule: 'ddb-scan', relPath, line: lineOf(text, m.index), token: m[0].trim() }); }
  const feRe = /FilterExpression/g; let m;
  while ((m = feRe.exec(text))) {
    const hit = KEY_ATTRS.find((a) => text.slice(m.index, m.index + 240).includes(a));
    if (hit) v.push({ rule: 'filter-on-key-attr', relPath, line: lineOf(text, m.index), token: hit });
  }
  return v;
}

function main() { reportAndExit('no-ddb-scan', runGate(parseRootArg(process.argv), findViolations, { includeUnder: ['services'], ext: ['.ts'], excludeTest: true })); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tools/check-no-ddb-scan.test.mjs`
Expected: PASS — 5/5.

- [ ] **Step 6: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add tools/check-no-ddb-scan.mjs tools/check-no-ddb-scan.test.mjs runtime/eval/scenarios/fixtures/no-ddb-scan
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(tools): no-ddb-scan drift gate + golden fixtures (SPEC 2 D1)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task D2: `check-no-agent-result-fallback` (with scope-narrowing sidecar)

**Files:**
- Create: `tools/check-no-agent-result-fallback.mjs`, `tools/check-no-agent-result-fallback.test.mjs`, `tools/agent-result-fallback-exclusions.json`
- Create fixtures: `runtime/eval/scenarios/fixtures/no-agent-result-fallback/good/throws.ts`, `.../bad/nullish-object.ts`, `.../bad/nullish-array.ts`

**Interfaces:**
- Consumes: `tools/lib/text-scan.mjs` (`parseExclusions`).
- Produces: `findViolations(text, relPath, exclusions?) → violations[]` (rule `agent-result-fallback`); scoped to `services/advisory/**/src`; a `?? {}` / `?? []` fallback is a violation unless `relPath` is in the sidecar.

- [ ] **Step 1: Write the fixtures**

`.../good/throws.ts`:
```typescript
export function handle(result: { userGoals?: unknown }) {
  if (!result.userGoals) throw new EmptyAgentResponseError('user-goals');
  return result.userGoals;
}
```
`.../bad/nullish-object.ts`:
```typescript
export function handle(result: { userGoals?: unknown }) { return result.userGoals ?? {}; }
```
`.../bad/nullish-array.ts`:
```typescript
export function handle(result: { holdings?: unknown[] }) { return result.holdings ?? []; }
```

- [ ] **Step 2: Write the exclusions sidecar** — `tools/agent-result-fallback-exclusions.json`:
```json
{ "exclusions": [] }
```

- [ ] **Step 3: Write the failing test**

```javascript
// tools/check-no-agent-result-fallback.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findViolations } from './check-no-agent-result-fallback.mjs';

const FX = 'runtime/eval/scenarios/fixtures/no-agent-result-fallback';
const SCRIPT = join(process.cwd(), 'tools/check-no-agent-result-fallback.mjs');

test('NARF1 GOOD → 0', () => { for (const f of readdirSync(`${FX}/good`)) assert.equal(findViolations(readFileSync(`${FX}/good/${f}`, 'utf8'), `services/advisory/x/src/${f}`).length, 0, f); });
test('NARF2 BAD → ≥1', () => { for (const f of readdirSync(`${FX}/bad`)) assert.ok(findViolations(readFileSync(`${FX}/bad/${f}`, 'utf8'), `services/advisory/x/src/${f}`).length >= 1, f); });
test('NARF3 an excluded path is skipped', () => { assert.equal(findViolations('x ?? {}', 'services/advisory/x/src/ok.ts', new Set(['services/advisory/x/src/ok.ts'])).length, 0); });
test('NARF4 CLI exits 1 on a bad advisory tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'nf-narf-'));
  try { mkdirSync(join(root, 'services/advisory/x/src'), { recursive: true }); writeFileSync(join(root, 'services/advisory/x/src/a.ts'), 'const y = r.userGoals ?? {};', 'utf8');
    assert.equal(spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' }).status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test tools/check-no-agent-result-fallback.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 5: Write the implementation**

```javascript
#!/usr/bin/env node
// check-no-agent-result-fallback.mjs — mints from feedback_no_silent_fallback_in_agent_results (§10).
// drift gate: no `?? {}` / `?? []` fallback in advisory agent services (a missing agent-result key
// means the agent didn't run — throw, don't silently succeed). Scope-narrowing sidecar excludes vetted sites.
import { fileURLToPath } from 'node:url';
import { lineOf, parseRootArg, walkFiles, reportAndExit, parseExclusions } from './lib/text-scan.mjs';

const FALLBACK_RE = /\?\?\s*(\{\s*\}|\[\s*\])/g;
const SIDECAR = 'tools/agent-result-fallback-exclusions.json';

export function findViolations(text, relPath, exclusions = new Set()) {
  if (!relPath.includes('/src/') || exclusions.has(relPath)) return [];
  const v = []; let m; FALLBACK_RE.lastIndex = 0;
  while ((m = FALLBACK_RE.exec(text))) v.push({ rule: 'agent-result-fallback', relPath, line: lineOf(text, m.index), token: m[0] });
  return v;
}

function main() {
  const root = parseRootArg(process.argv);
  const exclusions = parseExclusions(root, SIDECAR);
  const all = [];
  for (const { relPath, text } of walkFiles(root, { includeUnder: ['services/advisory'], ext: ['.ts'], excludeTest: true })) all.push(...findViolations(text, relPath, exclusions));
  reportAndExit('no-agent-result-fallback', all);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test tools/check-no-agent-result-fallback.test.mjs`
Expected: PASS — 4/4.

- [ ] **Step 7: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add tools/check-no-agent-result-fallback.mjs tools/check-no-agent-result-fallback.test.mjs tools/agent-result-fallback-exclusions.json runtime/eval/scenarios/fixtures/no-agent-result-fallback
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(tools): no-agent-result-fallback drift gate + sidecar (SPEC 2 D2)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task D3: `check-no-ddb-seed-in-integration` (with sidecar)

**Files:**
- Create: `tools/check-no-ddb-seed-in-integration.mjs`, `tools/check-no-ddb-seed-in-integration.test.mjs`, `tools/ddb-seed-exclusions.json`
- Create fixtures: `runtime/eval/scenarios/fixtures/no-ddb-seed-in-integration/good/via-events.ts`, `.../bad/seed-fixture.ts`, `.../bad/direct-put.ts`

**Interfaces:**
- Produces: `findViolations(text, relPath, exclusions?) → violations[]` (rule `ddb-seed-in-integration`); scoped to `services/**/test/integration/**`; flags `DdbSeedFixture`, `AccountSeedingFixture`, `PutItem`, `BatchWrite`, DocumentClient `.put(`.

- [ ] **Step 1: Write the fixtures**

`.../good/via-events.ts`:
```typescript
import { EventFixture } from '@nestfolio/test-support';
export const seed = () => new EventFixture().emit('DepositInitiated', { amount: 100 });
```
`.../bad/seed-fixture.ts`:
```typescript
import { DdbSeedFixture } from '@nestfolio/test-support';
export const seed = () => new DdbSeedFixture('table').put({ pk: 'x' });
```
`.../bad/direct-put.ts`:
```typescript
export const seed = async (doc) => doc.put({ TableName: 't', Item: { pk: 'x' } });
```

- [ ] **Step 2: Write the sidecar** — `tools/ddb-seed-exclusions.json`: `{ "exclusions": [] }`

- [ ] **Step 3: Write the failing test**

```javascript
// tools/check-no-ddb-seed-in-integration.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findViolations } from './check-no-ddb-seed-in-integration.mjs';

const FX = 'runtime/eval/scenarios/fixtures/no-ddb-seed-in-integration';
const SCRIPT = join(process.cwd(), 'tools/check-no-ddb-seed-in-integration.mjs');
const rel = (f) => `services/x/x-ctrl/test/integration/${f}`;

test('NDS-SEED1 GOOD → 0', () => { for (const f of readdirSync(`${FX}/good`)) assert.equal(findViolations(readFileSync(`${FX}/good/${f}`, 'utf8'), rel(f)).length, 0, f); });
test('NDS-SEED2 BAD → ≥1', () => { for (const f of readdirSync(`${FX}/bad`)) assert.ok(findViolations(readFileSync(`${FX}/bad/${f}`, 'utf8'), rel(f)).length >= 1, f); });
test('NDS-SEED3 files outside test/integration are ignored', () => { assert.equal(findViolations('new DdbSeedFixture()', 'services/x/x-ctrl/src/a.ts').length, 0); });
test('NDS-SEED4 CLI exits 1 on a seeded integration tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'nf-seed-'));
  try { mkdirSync(join(root, 'services/x/x-ctrl/test/integration'), { recursive: true }); writeFileSync(join(root, 'services/x/x-ctrl/test/integration/a.ts'), 'new DdbSeedFixture("t")', 'utf8');
    assert.equal(spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' }).status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test tools/check-no-ddb-seed-in-integration.test.mjs`
Expected: FAIL.

- [ ] **Step 5: Write the implementation**

```javascript
#!/usr/bin/env node
// check-no-ddb-seed-in-integration.mjs — mints from feedback_no_seeder_fixtures (§10). drift gate:
// integration fixtures populate state via events/mutations, never DdbSeedFixture / direct DDB writes.
import { fileURLToPath } from 'node:url';
import { lineOf, parseRootArg, walkFiles, reportAndExit, parseExclusions } from './lib/text-scan.mjs';

const TOKENS = [/\bDdbSeedFixture\b/g, /\bAccountSeedingFixture\b/g, /\bPutItem\b/g, /\bBatchWrite(Item)?\b/g, /(?<![.\w])\.put\s*\(\s*\{/g];
const SIDECAR = 'tools/ddb-seed-exclusions.json';
const isIntegration = (rel) => /\/test\/integration\//.test(rel);

export function findViolations(text, relPath, exclusions = new Set()) {
  if (!isIntegration(relPath) || exclusions.has(relPath)) return [];
  const v = [];
  for (const re of TOKENS) { re.lastIndex = 0; let m; while ((m = re.exec(text))) v.push({ rule: 'ddb-seed-in-integration', relPath, line: lineOf(text, m.index), token: m[0].trim() }); }
  return v;
}

function main() {
  const root = parseRootArg(process.argv);
  const exclusions = parseExclusions(root, SIDECAR);
  const all = [];
  for (const { relPath, text } of walkFiles(root, { includeUnder: ['services'], ext: ['.ts'] })) all.push(...findViolations(text, relPath, exclusions));
  reportAndExit('no-ddb-seed-in-integration', all);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test tools/check-no-ddb-seed-in-integration.test.mjs`
Expected: PASS — 4/4.

- [ ] **Step 7: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add tools/check-no-ddb-seed-in-integration.mjs tools/check-no-ddb-seed-in-integration.test.mjs tools/ddb-seed-exclusions.json runtime/eval/scenarios/fixtures/no-ddb-seed-in-integration
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(tools): no-ddb-seed-in-integration drift gate + sidecar (SPEC 2 D3)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task D4: `check-no-unsafe-casts`

**Files:**
- Create: `tools/check-no-unsafe-casts.mjs`, `tools/check-no-unsafe-casts.test.mjs`
- Create fixtures: `runtime/eval/scenarios/fixtures/no-unsafe-casts/good/aws-mock.ts`, `.../bad/double-cast.ts`, `.../bad/eslint-disable.ts`

**Interfaces:**
- Produces: `findViolations(text, relPath) → violations[]` (rule `unsafe-cast`); scoped to production `**/src` (excludes `test/**`); flags `as unknown as`, `as any`, `eslint-disable`.

- [ ] **Step 1: Write the fixtures**

`.../good/aws-mock.ts`:
```typescript
import { mockClient } from 'aws-sdk-client-mock';
export const m = mockClient(class {} as never);
```
Wait — `as never` is a cast but not `as any`/`as unknown as`. Keep good clean:
```typescript
import { mockClient } from 'aws-sdk-client-mock';
export const m = mockClient(SomeClient);
```
`.../bad/double-cast.ts`:
```typescript
export const x = (input as unknown as Target);
```
`.../bad/eslint-disable.ts`:
```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
export const y: any = 1;
```

- [ ] **Step 2: Write the failing test**

```javascript
// tools/check-no-unsafe-casts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findViolations } from './check-no-unsafe-casts.mjs';

const FX = 'runtime/eval/scenarios/fixtures/no-unsafe-casts';
const SCRIPT = join(process.cwd(), 'tools/check-no-unsafe-casts.mjs');

test('NUC1 GOOD → 0', () => { for (const f of readdirSync(`${FX}/good`)) assert.equal(findViolations(readFileSync(`${FX}/good/${f}`, 'utf8'), `libs/x/src/${f}`).length, 0, f); });
test('NUC2 BAD → ≥1', () => { for (const f of readdirSync(`${FX}/bad`)) assert.ok(findViolations(readFileSync(`${FX}/bad/${f}`, 'utf8'), `libs/x/src/${f}`).length >= 1, f); });
test('NUC3 test/ files are ignored (casts allowed in tests)', () => { assert.equal(findViolations('x as any', 'libs/x/test/a.ts').length, 0); });
test('NUC4 CLI exits 1 on a bad src tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'nf-nuc-'));
  try { mkdirSync(join(root, 'libs/x/src'), { recursive: true }); writeFileSync(join(root, 'libs/x/src/a.ts'), 'const z = a as any;', 'utf8');
    assert.equal(spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' }).status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tools/check-no-unsafe-casts.test.mjs` → FAIL.

- [ ] **Step 4: Write the implementation**

```javascript
#!/usr/bin/env node
// check-no-unsafe-casts.mjs — mints from feedback_prefer_libraries_over_casts (§10). drift gate:
// no `as unknown as`, `as any`, or eslint-disable in production source (services/libs/apps **/src, not test/**).
import { fileURLToPath } from 'node:url';
import { lineOf, parseRootArg, walkFiles, reportAndExit } from './lib/text-scan.mjs';

const TOKENS = [/\bas\s+unknown\s+as\b/g, /\bas\s+any\b/g, /eslint-disable/g];

export function findViolations(text, relPath) {
  if (!relPath.includes('/src/') || /(^|\/)test\//.test(relPath)) return [];
  const v = [];
  for (const re of TOKENS) { re.lastIndex = 0; let m; while ((m = re.exec(text))) v.push({ rule: 'unsafe-cast', relPath, line: lineOf(text, m.index), token: m[0].replace(/\s+/g, ' ') }); }
  return v;
}

function main() {
  const root = parseRootArg(process.argv);
  const all = [];
  for (const { relPath, text } of walkFiles(root, { includeUnder: ['services', 'libs', 'apps'], ext: ['.ts'], excludeTest: true })) all.push(...findViolations(text, relPath));
  reportAndExit('no-unsafe-casts', all);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tools/check-no-unsafe-casts.test.mjs`
Expected: PASS — 4/4.

- [ ] **Step 6: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add tools/check-no-unsafe-casts.mjs tools/check-no-unsafe-casts.test.mjs runtime/eval/scenarios/fixtures/no-unsafe-casts
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(tools): no-unsafe-casts drift gate + fixtures (SPEC 2 D4)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task D5: `check-no-states-runtime-catch`

**Files:**
- Create: `tools/check-no-states-runtime-catch.mjs`, `tools/check-no-states-runtime-catch.test.mjs`
- Create fixtures: `runtime/eval/scenarios/fixtures/no-states-runtime-catch/good/choice-tolerance.ts`, `.../bad/catch-states-runtime.ts`

**Interfaces:**
- Produces: `findViolations(text, relPath) → violations[]` (rule `states-runtime-catch`); scoped to `**/src`; flags a Step Functions `Catch`/`Retry` whose `ErrorEquals` includes `States.Runtime`.

- [ ] **Step 1: Write the fixtures**

`.../good/choice-tolerance.ts`:
```typescript
export const chain = new Choice(scope, 'RowPresent').when(Condition.isPresent('$.row'), next).otherwise(tolerate);
```
`.../bad/catch-states-runtime.ts`:
```typescript
export const task = new Task(scope, 'T').addCatch(handler, { errors: ['States.Runtime'] });
```

- [ ] **Step 2: Write the failing test**

```javascript
// tools/check-no-states-runtime-catch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findViolations } from './check-no-states-runtime-catch.mjs';

const FX = 'runtime/eval/scenarios/fixtures/no-states-runtime-catch';
const SCRIPT = join(process.cwd(), 'tools/check-no-states-runtime-catch.mjs');

test('NSRC1 GOOD → 0', () => { for (const f of readdirSync(`${FX}/good`)) assert.equal(findViolations(readFileSync(`${FX}/good/${f}`, 'utf8'), `services/x/src/${f}`).length, 0, f); });
test('NSRC2 BAD → ≥1', () => { for (const f of readdirSync(`${FX}/bad`)) assert.ok(findViolations(readFileSync(`${FX}/bad/${f}`, 'utf8'), `services/x/src/${f}`).length >= 1, f); });
test('NSRC3 CLI exits 1', () => {
  const root = mkdtempSync(join(tmpdir(), 'nf-nsrc-'));
  try { mkdirSync(join(root, 'services/x/src'), { recursive: true }); writeFileSync(join(root, 'services/x/src/a.ts'), "errors: ['States.Runtime']", 'utf8');
    assert.equal(spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' }).status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 3: Run test to verify it fails** → FAIL.

- [ ] **Step 4: Write the implementation**

```javascript
#!/usr/bin/env node
// check-no-states-runtime-catch.mjs — mints from feedback_states_runtime_uncatchable (§10). drift gate:
// no SF Catch/Retry whose ErrorEquals/errors includes States.Runtime (it silently never fires).
import { fileURLToPath } from 'node:url';
import { lineOf, parseRootArg, runGate, reportAndExit } from './lib/text-scan.mjs';

// A States.Runtime literal within ~120 chars after an ErrorEquals/errors/addCatch/addRetry context.
const RE = /(ErrorEquals|errors|addCatch|addRetry)[\s\S]{0,120}?States\.Runtime/g;

export function findViolations(text, relPath) {
  if (!relPath.includes('/src/')) return [];
  const v = []; let m; RE.lastIndex = 0;
  while ((m = RE.exec(text))) v.push({ rule: 'states-runtime-catch', relPath, line: lineOf(text, m.index), token: 'States.Runtime' });
  return v;
}

function main() { reportAndExit('no-states-runtime-catch', runGate(parseRootArg(process.argv), findViolations, { includeUnder: ['services', 'libs', 'infrastructure'], ext: ['.ts'], excludeTest: true })); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 5: Run test to verify it passes** — PASS 3/3.

- [ ] **Step 6: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add tools/check-no-states-runtime-catch.mjs tools/check-no-states-runtime-catch.test.mjs runtime/eval/scenarios/fixtures/no-states-runtime-catch
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(tools): no-states-runtime-catch drift gate + fixtures (SPEC 2 D5)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

---

## Phase E — Dogfood: five lessons end-to-end + supersede + retire

> The moat's proof-of-life (§10, §13.2.3). The five real lessons run `draft → floor-ratify → register → eval`; the content ring is **materialized by the mint procedure itself** (not hand-copied), then committed. Plus the sync-supersede (`no-ddb-scan → v2`) and async-retire (dangling-scope) proofs.

### Task E1: In-repo lesson mirrors (D1 dossier decision)

**Files:**
- Create: `runtime/content/lessons/feedback_no_scan_no_filter.md`, `feedback_no_silent_fallback_in_agent_results.md`, `feedback_no_seeder_fixtures.md`, `feedback_prefer_libraries_over_casts.md`, `feedback_states_runtime_uncatchable.md`

**Interfaces:**
- Produces: five dossiers with `{ name, description, type: feedback }` frontmatter + one-line prose, NO `mints:` yet (the mint materialization adds it).

- [ ] **Step 1: Author the five mirrors** — copy `name`/`description`/prose from user-global memory (`~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/feedback_*.md`), normalizing to the `{name, description, type: feedback}` frontmatter shape. Example (`feedback_no_scan_no_filter.md`):

```markdown
---
name: No scans, no FilterExpression on key attributes
description: Never use DynamoDB Scan operations or FilterExpression on GSI key attributes — always use KeyConditionExpression and Query
type: feedback
---
Never use DynamoDB Scan operations. Never use FilterExpression on GSI key attributes. Always use a KeyConditionExpression Query against a GSI. (In-repo ring-2 mirror of the user-memory lesson; the `mints:` pointer is reconciled by SPEC 2 reconcileLesson.)
```

Author the other four analogously (frontmatter from the memory dossiers read during planning: `feedback_no_silent_fallback_in_agent_results` → "No silent fallback on empty agent responses"; `feedback_no_seeder_fixtures` → "No DDB seeding in integration tests"; `feedback_prefer_libraries_over_casts` → "Prefer libraries over type casts"; `feedback_states_runtime_uncatchable` → normalize name to "SF States.Runtime is uncatchable"). Each `type: feedback`, one-line prose, NO `mints:`.

- [ ] **Step 2: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/content/lessons
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(runtime): in-repo mirror of 5 dogfood lessons (SPEC 2 E1)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task E2: The dogfood table + the five-lesson end-to-end proof

**Files:**
- Create: `runtime/engine/backward/dogfood/lessons.mjs`
- Test: `runtime/engine/backward/test/dogfood.test.mjs`

**Interfaces:**
- Produces: `DOGFOOD` = five `{ item, lesson, proposal }` entries (the §10 table as data), reused by the proof test AND the materializer (E3).

- [ ] **Step 1: Write the dogfood table**

```javascript
// runtime/engine/backward/dogfood/lessons.mjs — the §10 five-lesson dogfood table AS DATA (seam #2,
// NOT ring-1). Reused by the proof test and the materializer. Each proposal is the worker's reduction
// of one real mechanizable feedback_* lesson to a single deterministic property. Δ1 run grammar throughout.
import { fileURLToPath } from 'node:url';

const gatesAllPass = { mechanizable: true, recurring: true, stillIntended: true };
const fx = (id, good, bad) => ({ path: `runtime/eval/scenarios/${id}.scenario.mjs`,
  fixtures: { good: good.map((f) => `runtime/eval/scenarios/fixtures/${id}/good/${f}`), bad: bad.map((f) => `runtime/eval/scenarios/fixtures/${id}/bad/${f}`) }, target_pass_rate: 1.0 });

export const DOGFOOD = [
  { item: { id: 'no-ddb-scan-guard' }, lesson: 'feedback_no_scan_no_filter.md', proposal: {
      id: 'no-ddb-scan', property: 'No ScanCommand/.scan(/scanAll under services/**/src, and no FilterExpression on a GSI key attribute (__typename/tenantId/timestamp).',
      kind: 'drift', evaluator: { type: 'deterministic', run: 'cmd:node tools/check-no-ddb-scan.mjs' }, cost_tier: 'cheap',
      contexts: ['invariant', 'gate'], scope: { paths: ['services/**/src/**/*.ts'], dossiers: ['feedback_no_scan_no_filter.md'] },
      eval_scenario: fx('no-ddb-scan', ['gsi-query.ts'], ['scan-command.ts', 'filter-on-typename.ts']),
      rationale: 'mechanizable forbidden-token set; guards recurring table-scan cost blowups; still intended.', gates: gatesAllPass } },
  { item: { id: 'no-agent-result-fallback-guard' }, lesson: 'feedback_no_silent_fallback_in_agent_results.md', proposal: {
      id: 'no-agent-result-fallback', property: 'No ?? {} / ?? [] fallback on an AgentCore/orchestrator invocation result in advisory agent services.',
      kind: 'drift', evaluator: { type: 'deterministic', run: 'cmd:node tools/check-no-agent-result-fallback.mjs' }, cost_tier: 'cheap',
      contexts: ['invariant', 'gate'], scope: { paths: ['services/advisory/**/src/**/*.ts'], dossiers: ['feedback_no_silent_fallback_in_agent_results.md'], exclusions: 'tools/agent-result-fallback-exclusions.json' },
      eval_scenario: fx('no-agent-result-fallback', ['throws.ts'], ['nullish-object.ts', 'nullish-array.ts']),
      rationale: 'a missing agent-result key means the agent did not run; silent ?? hides a degraded 200. Mechanizable, recurring, still intended.', gates: gatesAllPass } },
  { item: { id: 'no-ddb-seed-guard' }, lesson: 'feedback_no_seeder_fixtures.md', proposal: {
      id: 'no-ddb-seed-in-integration', property: 'No DdbSeedFixture/AccountSeedingFixture/direct DDB write under services/**/test/integration/**.',
      kind: 'drift', evaluator: { type: 'deterministic', run: 'cmd:node tools/check-no-ddb-seed-in-integration.mjs' }, cost_tier: 'cheap',
      contexts: ['invariant', 'gate'], scope: { paths: ['services/**/test/integration/**/*.ts'], dossiers: ['feedback_no_seeder_fixtures.md'], exclusions: 'tools/ddb-seed-exclusions.json' },
      eval_scenario: fx('no-ddb-seed-in-integration', ['via-events.ts'], ['seed-fixture.ts', 'direct-put.ts']),
      rationale: 'integration fixtures must seed via the app pipeline; direct DDB writes bypass CDC. Mechanizable, recurring, still intended.', gates: gatesAllPass } },
  { item: { id: 'no-unsafe-casts-guard' }, lesson: 'feedback_prefer_libraries_over_casts.md', proposal: {
      id: 'no-unsafe-casts', property: 'No `as unknown as`, `as any`, or eslint-disable in production source (services/libs/apps **/src, excluding test/**).',
      kind: 'drift', evaluator: { type: 'deterministic', run: 'cmd:node tools/check-no-unsafe-casts.mjs' }, cost_tier: 'cheap',
      contexts: ['invariant'], scope: { paths: ['services/**/src/**/*.ts', 'libs/**/src/**/*.ts', 'apps/**/src/**/*.ts'], dossiers: ['feedback_prefer_libraries_over_casts.md'] },
      eval_scenario: fx('no-unsafe-casts', ['aws-mock.ts'], ['double-cast.ts', 'eslint-disable.ts']),
      rationale: 'prefer ecosystem libs over casts; mechanizable token set; recurring; still intended.', gates: gatesAllPass } },
  { item: { id: 'no-states-runtime-catch-guard' }, lesson: 'feedback_states_runtime_uncatchable.md', proposal: {
      id: 'no-states-runtime-catch', property: 'No Step Functions Catch/Retry whose ErrorEquals includes States.Runtime.',
      kind: 'drift', evaluator: { type: 'deterministic', run: 'cmd:node tools/check-no-states-runtime-catch.mjs' }, cost_tier: 'cheap',
      contexts: ['invariant', 'gate'], scope: { paths: ['services/**/src/**/*.ts'], dossiers: ['feedback_states_runtime_uncatchable.md'] },
      eval_scenario: fx('no-states-runtime-catch', ['choice-tolerance.ts'], ['catch-states-runtime.ts']),
      rationale: 'States.Runtime is uncatchable; a Catch on it silently never fires. Mechanizable, recurring, still intended.', gates: gatesAllPass } },
];

function main() { console.log(`${DOGFOOD.length} dogfood lessons`); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 2: Write the failing end-to-end proof test**

```javascript
// runtime/engine/backward/test/dogfood.test.mjs — the moat's proof-of-life: all five real lessons
// run draft → floor-ratify → register → eval, hermetically in a tmpdir (§10, §11.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { runMint } from '../lib/mint.mjs';
import { inMemoryJournal } from '../lib/capabilities.mjs';
import { validateCheck } from '../../schema/check.schema.ts';
import { DOGFOOD } from '../dogfood/lessons.mjs';
import { withTmpContent } from './_fixtures.mjs';

for (const { item, lesson, proposal } of DOGFOOD) {
  test(`DOGFOOD ${proposal.id}: ratify → active yaml + landed scenario + reconciled mints`, () => {
    withTmpContent(({ checksDir, lessonsDir, scenariosDir }) => {
      cpSync(join('runtime/content/lessons', lesson), join(lessonsDir, lesson));   // real in-repo mirror
      const r = runMint({ item, lesson, proposal, ask: () => ({ selected: 'ratify' }), journal: inMemoryJournal(), checksDir, dossierRoot: lessonsDir, scenariosDir });
      assert.equal(r.kind, 'minted', `${proposal.id} should mint`);
      // (a) yaml valid + active + provenance links
      const persisted = parse(readFileSync(join(checksDir, `${proposal.id}.yaml`), 'utf8'));
      assert.equal(validateCheck(persisted).ok, true, `${proposal.id} yaml invalid`);
      assert.equal(persisted.status, 'active');
      assert.equal(persisted.provenance.minted_by, item.id);
      assert.equal(persisted.provenance.lesson, lesson);
      assert.ok(persisted.provenance.ratified);
      assert.match(persisted.evaluator.run, /^cmd:node tools\/check-/);   // Δ1
      // (b) scenario landed
      assert.ok(existsSync(join(scenariosDir, `${proposal.id}.scenario.mjs`)));
      // (c) mints reconciled on the lesson
      const mints = parse(/^---\n([\s\S]*?)\n---/.exec(readFileSync(join(lessonsDir, lesson), 'utf8'))[1]).mints;
      assert.deepEqual(mints, [{ check: proposal.id, ratified: persisted.provenance.ratified, status: 'active' }]);
    });
  });
}

test('DOGFOOD --auto pauses every lesson (never self-ratifies)', () => {
  for (const { item, lesson, proposal } of DOGFOOD) {
    withTmpContent(({ checksDir, lessonsDir, scenariosDir }) => {
      cpSync(join('runtime/content/lessons', lesson), join(lessonsDir, lesson));
      const r = runMint({ item, lesson, proposal, journal: inMemoryJournal(), checksDir, dossierRoot: lessonsDir, scenariosDir });   // headless
      assert.equal(r.kind, 'paused');
      assert.equal(existsSync(join(checksDir, `${proposal.id}.yaml`)), false);
    });
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test runtime/engine/backward/test/dogfood.test.mjs`
Expected: FAIL — cannot find `../dogfood/lessons.mjs`.

- [ ] **Step 4: Create `lessons.mjs` (Step 1 content)** → save the file.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test runtime/engine/backward/test/dogfood.test.mjs`
Expected: PASS — 6/6 (5 lessons + the --auto pause).

- [ ] **Step 6: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/engine/backward/dogfood/lessons.mjs runtime/engine/backward/test/dogfood.test.mjs
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(runtime): 5-lesson dogfood end-to-end proof (SPEC 2 E2)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task E3: Materialize the content ring (the mint procedure writes the durable artifacts)

**Files:**
- Create: `runtime/engine/backward/dogfood/materialize.mjs`
- Generated (committed): `runtime/content/checks/{no-ddb-scan,no-agent-result-fallback,no-ddb-seed-in-integration,no-unsafe-casts,no-states-runtime-catch}.yaml`, `runtime/eval/scenarios/<id>.scenario.mjs` ×5, `mints:` appended to the 5 lessons.

**Interfaces:**
- Produces: a `main()` that runs `runMint` over `DOGFOOD` with a scripted ratify, writing into the REAL `runtime/content/checks`, `runtime/eval/scenarios`, `runtime/content/lessons`. Idempotent (re-run = no-op via `landEvalScenario` existence + `reconcileLesson` dedup + YAML overwrite).

- [ ] **Step 1: Write the materializer**

```javascript
#!/usr/bin/env node
// materialize.mjs — DOGFOOD one-shot: runs the real mint procedure over the 5 lessons with a scripted
// ratify (this is the DOGFOOD materialization, NOT the interactive floor) so the committed content ring
// is genuinely the mint procedure's output. Re-runnable (idempotent). Run from repo root.
import { fileURLToPath } from 'node:url';
import { runMint } from '../lib/mint.mjs';
import { inMemoryJournal } from '../lib/capabilities.mjs';
import { DOGFOOD } from './lessons.mjs';

function main() {
  const journal = inMemoryJournal();
  const dirs = { checksDir: 'runtime/content/checks', dossierRoot: 'runtime/content/lessons', scenariosDir: 'runtime/eval/scenarios' };
  for (const { item, lesson, proposal } of DOGFOOD) {
    const r = runMint({ item, lesson, proposal, ask: () => ({ selected: 'ratify' }), journal, ...dirs });
    if (r.kind !== 'minted') { console.error(`FAILED to mint ${proposal.id}: ${r.kind}`); process.exit(1); }
    console.log(`minted ${proposal.id} → ${dirs.checksDir}/${proposal.id}.yaml`);
  }
  console.log(`materialized ${DOGFOOD.length} checks`);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 2: Run the materializer from the worktree root**

Run: `node .claude/worktrees/runtime-spec-2/runtime/engine/backward/dogfood/materialize.mjs` — but it writes relative to cwd, so run WITH cwd at the worktree root:
```bash
( cd .claude/worktrees/runtime-spec-2 && node runtime/engine/backward/dogfood/materialize.mjs )
```
Expected: prints `minted no-ddb-scan …` ×5, `materialized 5 checks`.

- [ ] **Step 3: Verify the generated content ring is valid**

Run: `git -C .claude/worktrees/runtime-spec-2 status --short runtime/content runtime/eval`
Expected: 5 new `runtime/content/checks/*.yaml`, 5 new `runtime/eval/scenarios/*.scenario.mjs`, 5 modified `runtime/content/lessons/*.md` (mints: added).

Manually inspect one YAML (`runtime/content/checks/no-ddb-scan.yaml`) — confirm `status: active`, `evaluator.run: "cmd:node tools/check-no-ddb-scan.mjs"`, `provenance.minted_by: no-ddb-scan-guard`, `provenance.lesson: feedback_no_scan_no_filter.md`, `provenance.ratified` a real ISO date. Confirm one lesson (`feedback_no_scan_no_filter.md`) now has a `mints:` block.

- [ ] **Step 4: Commit the materializer + the generated content ring**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/engine/backward/dogfood/materialize.mjs runtime/content/checks runtime/content/lessons runtime/eval/scenarios
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "feat(runtime): materialize 5-check content ring via the mint procedure (SPEC 2 E3)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task E4: Sync-supersede content proof (`no-ddb-scan → no-ddb-scan-v2`)

**Files:**
- Create: `runtime/engine/backward/test/supersede-proof.test.mjs`
- Generated (committed): `runtime/content/checks/no-ddb-scan-v2.yaml`, updated `no-ddb-scan.yaml` (superseded), updated `feedback_no_scan_no_filter.md` mints:

**Interfaces:**
- Consumes: `runCurate`, the materialized `no-ddb-scan.yaml`.
- Produces: the §5.1 sync-supersede content example — a narrower v2 that allows a reviewed FilterExpression on a NON-key attribute.

- [ ] **Step 1: Write the failing proof test** (hermetic — proves the supersede procedure produces the chain + re-aimed mints)

```javascript
// runtime/engine/backward/test/supersede-proof.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { loadRegistry } from '../../lib/load-registry.mjs';
import { runCurate } from '../lib/curate.mjs';
import { inMemoryJournal } from '../lib/capabilities.mjs';
import { withTmpContent } from './_fixtures.mjs';

test('SUP1 sync-supersede no-ddb-scan → v2: chain both sides + mints re-aimed', () => {
  withTmpContent(({ checksDir, lessonsDir }) => {
    cpSync('runtime/content/checks/no-ddb-scan.yaml', join(checksDir, 'no-ddb-scan.yaml'));
    cpSync('runtime/content/lessons/feedback_no_scan_no_filter.md', join(lessonsDir, 'feedback_no_scan_no_filter.md'));
    const guard = loadRegistry({ checksDir }).byId.get('no-ddb-scan');
    const successor = { ...guard, id: 'no-ddb-scan-v2',
      property: 'No ScanCommand/.scan(/scanAll under services/**/src, and no FilterExpression on a GSI KEY attribute (__typename/tenantId/timestamp) — a reviewed FilterExpression on a NON-key attribute is allowed.',
      evaluator: { type: 'deterministic', run: 'cmd:node tools/check-no-ddb-scan.mjs' },
      provenance: { minted_by: 'narrow-ddb-filter-allowance', lesson: 'feedback_no_scan_no_filter.md', ratified: '2026-09-11' } };
    const finding = { id: 'f-sync', check: 'no-ddb-scan', kind: 'drift', scope: ['services/x/src/a.ts'], detail: 'reviewed non-key FilterExpression flagged', raised_at: '2026-09-11T00:00:00Z' };
    const r = runCurate({ guard, trigger: 'ship-gate-blocking', finding, proposedSuccessor: successor, rationale: 'property was too broad; narrow to GSI key attrs', ask: () => ({ selected: 'supersede' }), journal: inMemoryJournal(), checksDir, dossierRoot: lessonsDir });
    assert.equal(r.kind, 'superseded');
    assert.equal(parse(readFileSync(join(checksDir, 'no-ddb-scan.yaml'), 'utf8')).provenance.superseded_by, 'no-ddb-scan-v2');
    assert.equal(parse(readFileSync(join(checksDir, 'no-ddb-scan-v2.yaml'), 'utf8')).provenance.supersedes, 'no-ddb-scan');
    const mints = parse(/^---\n([\s\S]*?)\n---/.exec(readFileSync(join(lessonsDir, 'feedback_no_scan_no_filter.md'), 'utf8'))[1]).mints;
    assert.equal(mints.find((e) => e.check === 'no-ddb-scan').status, 'superseded');
    assert.equal(mints.find((e) => e.check === 'no-ddb-scan-v2').status, 'active');
  });
});
```

- [ ] **Step 2: Run → FAIL** (until curate.mjs is imported correctly / green from Phase C — this test should PASS once E3 materialized `no-ddb-scan.yaml`; run to confirm).

Run: `node --test runtime/engine/backward/test/supersede-proof.test.mjs`
Expected: PASS — the supersede machinery (Phase C) over the real materialized guard.

> This is a hermetic proof — it does NOT mutate the committed `no-ddb-scan.yaml`. The v2 chain lives only in the tmpdir. The committed content ring keeps `no-ddb-scan` active (the supersede is a *demonstrated capability*, not a permanent content change — narrowing the real guard is a future item). This honors single-active + keeps the committed ring green.

- [ ] **Step 3: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/engine/backward/test/supersede-proof.test.mjs
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "test(runtime): sync-supersede content proof no-ddb-scan→v2 (SPEC 2 E4)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task E5: Async-retire proof via SPEC 1 `metaCheck` dangling-scope

**Files:**
- Create: `runtime/engine/backward/test/retire-proof.test.mjs`

**Interfaces:**
- Consumes: SPEC 1 `metaCheck` (dangling-scope rot-detector i), `runCurate`.
- Produces: the §5.2 async-retire proof — a real `metaCheck` `staleness` finding (injected `env.resolveGlobs` → 0 files, the `advisory-ctrl` deletion analog) routed to `runCurate(trigger: 'dangling-scope', retire)`.

- [ ] **Step 1: Write the failing proof test**

```javascript
// runtime/engine/backward/test/retire-proof.test.mjs — the async arm end-to-end: SPEC 1 metaCheck
// files a dangling-scope staleness finding (code deleted), which runCurate retires at the floor (§5.2, §11.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { metaCheck } from '../../lib/meta-check.mjs';
import { runCurate } from '../lib/curate.mjs';
import { inMemoryJournal } from '../lib/capabilities.mjs';
import { withTmpContent, writeDossier, validCheck } from './_fixtures.mjs';

test('RET1 metaCheck files a dangling-scope staleness finding → runCurate retires it (state + mints)', () => {
  withTmpContent(({ checksDir, lessonsDir }) => {
    // an active guard scoped at DELETED code (the advisory-ctrl removal analog)
    const guard = validCheck({ id: 'advisory-ctrl-guard', status: 'active',
      scope: { paths: ['services/advisory/advisory-ctrl/**/*.ts'] },
      provenance: { minted_by: 'g', lesson: 'feedback_x.md', ratified: '2026-05-01' } });
    writeDossier(lessonsDir, 'feedback_x', { name: 'X', description: 'd', type: 'feedback', mints: [{ check: 'advisory-ctrl-guard', ratified: '2026-05-01', status: 'active' }] });

    // SPEC 1 metaCheck with injected env: this scope resolves to ZERO files → staleness finding.
    const findings = metaCheck({ registry: { checks: [guard] }, env: { resolveGlobs: () => [] } });
    const staleness = findings.find((f) => f.kind === 'staleness');
    assert.ok(staleness, 'metaCheck should file a staleness finding');
    assert.match(staleness.detail, /retirement-candidate/);

    // route it to the floor → retire
    const r = runCurate({ guard, trigger: 'dangling-scope', finding: staleness, rationale: 'advisory-ctrl removed (33→32 services)', ask: () => ({ selected: 'retire' }), journal: inMemoryJournal(), checksDir, dossierRoot: lessonsDir });
    assert.equal(r.kind, 'retired');
    assert.equal(r.check.status, 'retired');
    assert.equal(parse(/^---\n([\s\S]*?)\n---/.exec(readFileSync(join(lessonsDir, 'feedback_x.md'), 'utf8'))[1]).mints[0].status, 'retired');
  });
});

test('RET2 async retire never gates an unrelated ship (finding is non-blocking)', () => {
  // metaCheck only FILES the finding; it does not advance state — an unrelated ship proceeds.
  const guard = validCheck({ id: 'g', status: 'active', scope: { paths: ['services/gone/**/*.ts'] } });
  const findings = metaCheck({ registry: { checks: [guard] }, env: { resolveGlobs: () => [] } });
  assert.equal(guard.status, 'active');   // unchanged — the meta-check never advances state
  assert.equal(findings.filter((f) => f.kind === 'staleness').length, 1);
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test runtime/engine/backward/test/retire-proof.test.mjs`
Expected: PASS — 2/2 (the async arm proven against SPEC 1's real metaCheck).

- [ ] **Step 3: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/engine/backward/test/retire-proof.test.mjs
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "test(runtime): async-retire proof via SPEC 1 metaCheck dangling-scope (SPEC 2 E5)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

---

## Phase F — Reconciliation & close

### Task F1: Reconcile SPEC 1's content-ring test + metaCheck over the enlarged registry

**Files:**
- Read/possibly modify: `runtime/engine/test/content-ring.test.mjs`
- Modify (if needed): `runtime/content/checks/*` were added in E3 — ensure they load + meta-check clean.

**Interfaces:**
- Produces: the enlarged content ring (6 SPEC-1 checks + 5 SPEC-2 checks = 11) loads clean and passes metaCheck's assertions.

- [ ] **Step 1: Inspect the SPEC 1 content-ring test** — Read `runtime/engine/test/content-ring.test.mjs`. If it asserts a hardcoded check COUNT (e.g. `checks.length === 6`), update it to the new total (11) with a comment noting the 5 SPEC-2 dogfood mints. If it asserts only "loads with zero errors" (count-agnostic), no change.

- [ ] **Step 2: Run the SPEC 1 engine suite** (it loads `runtime/content/checks/*.yaml`, now including the 5 new ones)

Run: `node --test runtime/engine/test/content-ring.test.mjs`
Expected: PASS — the 5 new checks are valid CheckEntries; if a count assertion failed, fix it and re-run.

- [ ] **Step 3: Verify metaCheck is clean over the enlarged registry** — the 5 new checks' evaluators (`cmd:node tools/check-*.mjs`) resolve (the tools exist, D1-D5); their `scope.paths` resolve to real files (not dangling); all are `cheap` + `[invariant …]` (cheap-by-construction holds). Add a focused assertion in `content-ring.test.mjs` (or a new `runtime/engine/backward/test/content-ring-metacheck.test.mjs`) if not already covered:

```javascript
// assert: metaCheck over the real registry raises no gap/inconsistency for the 5 SPEC-2 checks
import { loadRegistry } from '../../lib/load-registry.mjs';
import { metaCheck } from '../../lib/meta-check.mjs';
const reg = loadRegistry({ checksDir: 'runtime/content/checks' });
assert.equal(reg.errors.length, 0);
const findings = metaCheck({ registry: reg, env: { resolveGlobs: () => ['x'], enforcedSurfaces: [], storedKnobs: [] } });
for (const id of ['no-ddb-scan', 'no-agent-result-fallback', 'no-ddb-seed-in-integration', 'no-unsafe-casts', 'no-states-runtime-catch'])
  assert.equal(findings.filter((f) => f.scope?.some?.((s) => reg.byId.get(id)?.scope.paths.includes(s)) && f.kind !== 'staleness').length, 0, `${id} should meta-check clean`);
```

- [ ] **Step 4: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/engine/test/content-ring.test.mjs runtime/engine/backward/test/content-ring-metacheck.test.mjs 2>/dev/null; true
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "test(runtime): reconcile content-ring + metaCheck over 5 SPEC-2 mints (SPEC 2 F1)" || echo "no changes"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

### Task F2: README + full-suite green + typecheck

**Files:**
- Modify: `runtime/README.md` (add a "Backward edge (SPEC 2)" section — the two arms, the six helpers, the seam boundaries, the 5-lesson dogfood).

- [ ] **Step 1: Update `runtime/README.md`** — add a section documenting: the two floor-gated arms (mint/curate); the six helpers + two orchestrators under `engine/backward/`; the D3 injected `ask`/`journal` seams (SPEC 3 binds them); the D1 in-repo lesson mirror; the 5-lesson dogfood + supersede/retire proofs. Keep it prose + a small table (house README style).

- [ ] **Step 2: Full runtime suite green**

Run: `NX_DAEMON=false pnpm nx run runtime:test`
Expected: PASS — every `runtime/engine/test/*` (SPEC 1) AND `runtime/engine/backward/test/*` (SPEC 2) suite green.

- [ ] **Step 3: Tools suite green**

Run: `node --test tools/lib/text-scan.test.mjs tools/check-no-ddb-scan.test.mjs tools/check-no-agent-result-fallback.test.mjs tools/check-no-ddb-seed-in-integration.test.mjs tools/check-no-unsafe-casts.test.mjs tools/check-no-states-runtime-catch.test.mjs`
Expected: PASS — all evaluator golden gates green.

- [ ] **Step 4: Typecheck**

Run: `NX_DAEMON=false pnpm nx run runtime:typecheck`
Expected: PASS.

- [ ] **Step 5: True-affected test + lint** (the closing-phase 6.2 gate — from repo root, not the worktree)

Run: `AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -); [ -n "$AFFECTED" ] && NX_DAEMON=false pnpm nx run-many -t test,lint -p "$AFFECTED" || echo "no affected projects"`
Expected: PASS. (`runtime` + `tools` if it is an nx project; resolve any lint findings.)

- [ ] **Step 6: Commit**

```bash
git -C .claude/worktrees/runtime-spec-2 add runtime/README.md
git -C .claude/worktrees/runtime-spec-2 commit --no-verify -m "docs(runtime): README backward-edge section; SPEC 2 slice complete (SPEC 2 F2)"
git -C .claude/worktrees/runtime-spec-2 log -1 --oneline
```

---

## Self-Review (author checklist — run against the spec)

**Spec coverage** (each §):
- §3 two arms + asymmetry → Phase C (mint C3/C6/C8; curate C7/C9); single-active preserved (mint post-ship, sync on-scope, async non-blocking) → E4/E5 proofs.
- §4 mint four steps + draft shape → B2 (CandidateDraft), C3 (draftCandidate), C6 (registerRatified atomic land→advance→reconcile).
- §5 curate two triggers/one decision + supersession chain → C7 (curateGuard), C9 (runCurate), E4 (sync-supersede), E5 (async-retire).
- §6 floor protocol + two payloads + decision record → B3 (FloorChoice/FloorDecision), C2 (presentFloor sentinel), C1 (headless ask).
- §7 enforcement-as-memory / mints: + checkable subset → B1 (MintsEntry), C5 (reconcileLesson sole writer), E3 (materialized mints).
- §8 heuristics (three-gate + deterministic-first) → C3 (draftCandidate gates; DC2-4 reject).
- §9 eval-scenario landing handoff → B3 (EvalScenarioLanding), C4 (landEvalScenario idempotent).
- §10 five-lesson dogfood + curate content examples → D1-D5 (evaluators), E1-E3 (lessons+ring), E4/E5 (curate examples). **D2 6th judgment mint = DEFERRED (locked decision).**
- §11 validation (mint ×6, sync-curate ×4, async-curate ×3) → C3/C6/C8 (mint), C7/C9/E4 (sync), E5 (async). All golden-gate green, no live e2e.
- §13 build sequence → Phases A→F respect the SPEC 1 dependency; ring-1 (B,C) before content (D,E).

**Merged-contract deltas applied:** Δ1 (cmd: scheme — D0-D5, E2 DOGFOOD, dogfood assert), Δ2 (ratified unset — B2 superRefine, C3, RR1), Δ3 (no keep transition — C7 keep no-op), Δ4 (flake_contract calibration — N/A this slice, judgment deferred), Δ5 (advanceLifecycle signature — C6/C7 consume `{check,event,successor?}`).

**Placeholder scan:** no "TBD"/"similar to Task N"/"add error handling" — every code step is complete. (D4's deliberate-bug note was removed.)

**Type consistency:** `findViolations(text, relPath[, exclusions])` uniform across D1-D5; `runMint`/`runCurate` return `{kind, ...}`; `presentFloor` returns `{choice, selected, sentinel}`; `advanceLifecycle` consumed as `{check, event, successor?}` everywhere; `dossierRoot`/`checksDir`/`scenariosDir` param names uniform C4-C9/E.

**Open risks flagged for execution:**
- The `?? {}`/`?? []` and `.put({` regexes are coarse; the golden fixtures pin intended behavior. If a real-codebase scan (SPEC 3) shows false positives, that is a SPEC-3 calibration/​sidecar item, not a SPEC-2 blocker.
- `content-ring.test.mjs` count assertion (F1 Step 1) — verify at execution whether it is count-based before editing.
- Node ≥24 native `.ts` import of schemas from `.mjs` — matches SPEC 1; if a `node --test` glob misses `backward/`, re-check A1 Step 1.

---

## Execution Handoff

**Per the `runtime-realization` epic protocol, execution is INLINE + visible (TDD), NOT subagent-driven** — the user preference + vision legibility law override the writing-plans default recommendation. Route to `superpowers:executing-plans` (batch execution with checkpoints), phase by phase (A→B→C→D→E→F), committing per task with `--no-verify` in the worktree and verifying each commit landed.

Optional before execution: an **ultracode adversarial plan-review** pass (the epic offers it per slice).
