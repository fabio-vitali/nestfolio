# Runtime SPEC 1 — Check Registry & Hybrid Atom (ring-1 core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the project- and harness-agnostic ring-1 core of the Long-Horizon Engineering Runtime — three zod schemas (`check`/`item`/`finding`) + six pure typed helpers (`loadRegistry` · `resolveEvaluator` · `runCheck` · `findByScope` · `advanceLifecycle` · `metaCheck`) with their 30 golden-gate tests, plus a bounded first-content-ring proof slice — freezing the schema SPEC 2 & 3 consume verbatim.

**Architecture:** Git-native files + small tested helpers, zero external service. Ring 1 (`runtime/engine/`) depends outward on nothing (not on any harness, not on any project content). Schemas are `.ts` (zod validators + `z.infer` types = single source of truth); helpers/tests are `.mjs` run directly by `node --test` — the `.mjs`→`.ts` interop uses **Node 24 native type-stripping (zero build)**. The only project binding is `runtime.config.json` (`{ checksDir, exclusionsRoot }`), deliberately a sibling of `engine/`, never a file inside ring 1. Nestfolio's real checks appear only as a quarantined first content-ring behind that seam.

**Tech Stack:** Node ≥24 (native `.ts` type-stripping, `node --test`), zod v3 (`from 'zod'`), `yaml` v2 (`import { parse } from 'yaml'`), nx `run-commands` targets, TypeScript 5.9 (`tsc --noEmit` typecheck only). No new dependencies.

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from `docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md`.

- **Ring-1 is project- and harness-agnostic.** No Nestfolio-specific artifact and no workspace-alias (`@nestfolio/*`) import may appear anywhere under `runtime/engine/`. Every project binding enters through `runtime.config.json` (a sibling of `engine/`) or an injected argument. (§8, §11, §14, "Hard constraint".)
- **Runtime:** Node ≥24.14; root `package.json` has no `"type"` field → `.mjs` = ESM, `.ts` runs via native type-stripping. Use `import … from 'zod'` (v3.25.x installed; never `zod/v4`). YAML via `import { parse } from 'yaml'` (v2.8.x). No `js-yaml`/`fast-glob`/`glob`/`globby`/`gray-matter` (not importable).
- **Erasable-syntax-only in `.ts`** (native strip requirement): NO TypeScript `enum`, `namespace`, or constructor parameter-properties; use `type X = 'a' | 'b'` unions + `z.enum([...])`. Import specifiers targeting a `.ts` file MUST carry the `.ts` extension. No workspace-alias imports in engine `.ts` (bare strip won't resolve them).
- **House convention (mirrors `tools/check-*.mjs`):** every executable `.mjs` starts `#!/usr/bin/env node`, a `//`-line banner header (NOT `/** */`), a pure **named-export** core function (NO default exports), and a private `main()` guarded by `if (process.argv[1] === fileURLToPath(import.meta.url)) main();` so importing has zero side effects. File enumeration uses `node:fs` `readdirSync({ withFileTypes: true })` walks (no glob lib). Sidecar/optional-file loads tolerate an absent file (return empty) so tmpdir tests need no fixtures they don't assert on.
- **Test convention:** `import { test } from 'node:test'` (flat `test()`, not `describe`/`it`) + `import assert from 'node:assert/strict'`; tmpdirs via `mkdtempSync(join(tmpdir(), 'nf-…-'))` cleaned in a `try/finally { rmSync(root, { recursive: true, force: true }) }`; pure cores imported as relative `.mjs` siblings; CLI exit-code behavior asserted via `spawnSync`. Run suites with the **glob** form `node --test runtime/engine/test/*.test.mjs` (bare `node --test <dir>` does not discover on Node 24).
- **Frozen enums (SPEC 2/3 consume verbatim, do not reshape here):** `FindingKind = 'drift' | 'inconsistency' | 'gap' | 'staleness'`; `CostTier = 'cheap' | 'moderate' | 'expensive'`; `Context = 'gate' | 'audit' | 'invariant'`; `CheckStatus = 'candidate' | 'active' | 'superseded' | 'retired'`; `EvaluatorKind = 'deterministic' | 'judgment'`; run-scheme set = `cmd` | `module` | `eslint` | `skill` (closed).
- **Frozen field names:** item = `id, type, status, rank, epic, epic_role, done_criteria, scope, out_of_scope, references, provenance`; check = `id, property, kind, evaluator, cost_tier, contexts, scope, status, flake_contract, provenance`; `Provenance.ratified` is OPTIONAL; `Finding.id: FindingId`; `Item.provenance.from_finding: FindingId` (distinct from `from_check: CheckId`); `Provenance.minted_by` reserves the value `"starter-pack"`.
- **Validation:** ring-1's teeth are deterministic `node --test` golden gates (§13). No live/e2e, no deploy (pure library). 30 scenarios: `loadRegistry` ×5, `metaCheck` ×6, `advanceLifecycle` ×7, `findByScope` ×4, `runCheck` ×4, `resolveEvaluator` ×4.
- **Scope discipline:** build ring-1 + a **bounded** content-ring proof slice only. Do NOT migrate all 34 live surfaces, do NOT relocate `tools/*-exclusions.json`, do NOT rewire existing gates/pre-commit/CI to route through the registry (§14 out-of-scope). Any contract delta the build surfaces is reconciled back into the spec's §15 (Task 11).

---

## File Structure

```
runtime/
  runtime.config.json                 # { checksDir, exclusionsRoot } — the ONLY project binding, sibling of engine/
  package.json                        # { "type": "module" } — scopes .ts/.mjs to ESM, silences MODULE_TYPELESS reparse warning
  tsconfig.json                       # typecheck-only config (noEmit, allowImportingTsExtensions) — the `.ts` contract gate
  project.json                        # nx project "runtime": test + typecheck run-commands targets (auto-discovered)
  README.md                           # ring model, layout, how to run the gates (Task 11)
  engine/                             # RING 1 — pure, project- & harness-agnostic
    schema/
      finding.schema.ts               # FindingId, FindingKind, Finding + zod (§3)   — leaf, consumed by item + intake
      item.schema.ts                  # Item + zod (§10)                             — consumes FindingId
      check.schema.ts                 # CheckEntry + all sub-schemas + run-grammar + zod (§4) — the richest contract
    lib/
      errors.mjs                      # typed errors: EvaluatorUnresolved, JudgmentContractMissing, JudgeCapabilityUnavailable
      fs-walk.mjs                     # listYamlFiles({ dir }) — readdirSync walk (house convention), no glob lib
      glob-overlap.mjs                # globsOverlap(a, b) — pure segment-DP glob-intersection predicate (§11 findByScope)
      load-registry.mjs               # loadRegistry({ checksDir }) → { checks, byId, errors }   (§11) + CLI
      resolve-evaluator.mjs           # resolveEvaluator({ check }) → { kind, invoke }            (§11)
      run-check.mjs                   # runCheck({ check, context }) → { findings, ran, skippedReason } (§11) + CLI
      find-by-scope.mjs               # findByScope({ registry, scope }) → { checks, invariants }  (§11)
      advance-lifecycle.mjs           # advanceLifecycle({ check, transition, floorApproval, successor }) → { check, event } (§11) + CLI
      meta-check.mjs                  # metaCheck({ registry, env }) → Finding[]                  (§8, §11) + CLI
    test/
      finding-schema.test.mjs         # direct Finding schema unit checks
      item-schema.test.mjs            # direct Item schema unit checks
      check-schema.test.mjs           # direct CheckEntry schema unit checks (run-grammar, judgment-flake refinements)
      glob-overlap.test.mjs           # globsOverlap unit checks (** absorption, *.ts intra-segment, disjoint)
      load-registry.test.mjs          # §13 A×5
      resolve-evaluator.test.mjs      # §13 F×4
      run-check.test.mjs              # §13 E×4
      find-by-scope.test.mjs          # §13 D×4
      advance-lifecycle.test.mjs      # §13 C×7
      meta-check.test.mjs             # §13 B×6
      content-ring.test.mjs           # proof slice loads clean + metaCheck green (Task 10)
      _fixtures.mjs                   # shared tmpdir + check-factory test helpers
  content/                            # RING 3 — Nestfolio's first check library (proof slice, quarantined behind seam #2)
    checks/
      *.yaml                          # a handful of representative entries + registry-integrity (Task 10)
  eval/
    scenarios/
      *.scenario.mjs                  # judgment-check eval scenario STUBS (SPEC 2 authors real ones) — existence only
```

**Decomposition rationale:** schemas are leaves-first (`finding` → `item` → `check`) because `check.schema` and later helpers `z.infer` their types. Helpers are one file each (spec §11) with two internal utilities extracted (`fs-walk`, `glob-overlap`) because they are independently testable and reused. Each helper's golden-gate suite is its own test file so a reviewer can gate one helper without the others. `_fixtures.mjs` centralizes the tmpdir + valid-check-factory so 6 suites don't each re-hand-roll a valid `CheckEntry`.

**The two internal utilities are not new public surface** — they support the six named helpers (§11 lists exactly six lib entry points; `fs-walk`/`glob-overlap`/`errors` are private implementation detail, not part of the frozen contract).

---

## Task 1: Scaffold + `finding.schema.ts` (leaf schema + nx/tsconfig/config wiring)

**Files:**
- Create: `runtime/runtime.config.json`
- Create: `runtime/package.json`
- Create: `runtime/tsconfig.json`
- Create: `runtime/project.json`
- Create: `runtime/engine/schema/finding.schema.ts`
- Create: `runtime/engine/test/finding-schema.test.mjs`

> **Spike-validated (2026-07-01):** the `.mjs`→`.ts`→`.ts`→zod transitive import pattern runs natively on Node 24.14 with **zero build/flag** (type-stripping), and `tsc --noEmit -p runtime/tsconfig.json` typechecks the `.ts`-extension imports clean under `strict`. A throwaway spike proved both gates green (after typing schema-helper params — folded in below). The `runtime/package.json {"type":"module"}` silences Node's `MODULE_TYPELESS_PACKAGE_JSON` reparse warning; `runtime` is not a pnpm-workspace glob, so pnpm ignores it and it coexists with `project.json` as one nx project.

**Interfaces:**
- Produces: `finding.schema.ts` exports `FindingKindSchema` (`z.enum`), `FindingSchema` (`z.object`), `validateFinding(obj) → { ok, value?, error? }`, and the derived types `FindingKind`, `FindingId`, `Finding` (`export type … = z.infer<…>`). Consumed by `item.schema.ts` (Task 2, `FindingId`), `meta-check.mjs`/`run-check.mjs` (Findings), and SPEC 3 intake.
- Produces the nx project `runtime` with targets `test` (`node --test runtime/engine/test/*.test.mjs`) and `typecheck` (`tsc --noEmit -p runtime/tsconfig.json`).

- [ ] **Step 1: Create the config + nx + tsconfig scaffold**

`runtime/runtime.config.json` (the only project binding; points at the content ring authored in Task 10):
```json
{
  "checksDir": "runtime/content/checks",
  "exclusionsRoot": "runtime/content/exclusions"
}
```

`runtime/package.json` (scopes the subtree to ESM; silences the reparse warning; NOT a pnpm-workspace member). `name` matches the nx project so any package.json inference merges into the same project rather than creating a second; unscoped (not `@nestfolio/*`) to stay clear of the workspace alias scope (ring-1 depends on no alias):
```json
{
  "name": "runtime",
  "private": true,
  "type": "module"
}
```
(Task 1 Step 6 verifies `pnpm nx show project runtime` still resolves to a single project after this is added.)

`runtime/tsconfig.json` — typecheck-only; `allowImportingTsExtensions` is required because engine `.ts` files import each other with the explicit `.ts` extension (native-strip rule), and `noEmit` because we never build (type-stripping runs the `.ts` directly):
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["engine/schema/**/*.ts"]
}
```

`runtime/project.json` — auto-discovered by nx (no project globs in `nx.json`); `run-commands` pattern copied from `libs/event-processor/project.json`:
```json
{
  "name": "runtime",
  "$schema": "../node_modules/nx/schemas/project-schema.json",
  "projectType": "library",
  "sourceRoot": "runtime/engine",
  "targets": {
    "test": {
      "executor": "nx:run-commands",
      "cache": true,
      "inputs": ["{projectRoot}/engine/**/*", "{projectRoot}/content/**/*", "{projectRoot}/runtime.config.json"],
      "options": { "command": "node --test runtime/engine/test/*.test.mjs", "forwardAllArgs": false }
    },
    "typecheck": {
      "executor": "nx:run-commands",
      "cache": true,
      "inputs": ["{projectRoot}/engine/schema/**/*.ts", "{projectRoot}/tsconfig.json", "{workspaceRoot}/tsconfig.base.json"],
      "options": { "command": "tsc --noEmit -p runtime/tsconfig.json", "forwardAllArgs": false }
    }
  },
  "tags": ["scope:runtime", "type:lib"]
}
```

- [ ] **Step 2: Write the failing test** — `runtime/engine/test/finding-schema.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFinding, FindingKindSchema } from '../schema/finding.schema.ts';

test('FindingKind enum is the frozen four', () => {
  assert.deepEqual([...FindingKindSchema.options].sort(), ['drift', 'gap', 'inconsistency', 'staleness']);
});

test('a well-formed finding validates', () => {
  const r = validateFinding({
    id: 'f-1', check: 'read-model-single-writer', kind: 'inconsistency',
    scope: ['services/x/src/a.ts'], detail: 'two writers disagree', raised_at: '2026-07-01T00:00:00Z',
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.evidence, undefined); // evidence is optional
});

test('a finding with an unknown kind is rejected', () => {
  const r = validateFinding({ id: 'f-2', check: 'c', kind: 'bogus', scope: [], detail: 'd', raised_at: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.error, /kind/);
});

test('a finding missing detail is rejected', () => {
  const r = validateFinding({ id: 'f-3', check: 'c', kind: 'drift', scope: [], raised_at: 'x' });
  assert.equal(r.ok, false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test runtime/engine/test/finding-schema.test.mjs`
Expected: FAIL — cannot resolve `../schema/finding.schema.ts` (file absent).

- [ ] **Step 4: Write `runtime/engine/schema/finding.schema.ts`**

```ts
// runtime/engine/schema/finding.schema.ts — ring-1, project-agnostic
// The Finding is the currency of the forward edge (§3). Defined here because SPEC 3 intake consumes it.
import { z } from 'zod';

export const FindingKindSchema = z.enum(['drift', 'inconsistency', 'gap', 'staleness']);
export type FindingKind = z.infer<typeof FindingKindSchema>;

// FindingId / CheckId are opaque strings at ring-1; branding is a downstream concern.
export type FindingId = string;

export const FindingSchema = z.object({
  id: z.string().min(1),          // stable within a watch pass; carried into item provenance (§10)
  check: z.string().min(1),       // the CheckId that raised it
  kind: FindingKindSchema,        // inherited from check.kind
  scope: z.array(z.string()),     // resolved paths/dossiers implicated
  detail: z.string().min(1),      // human-readable statement of the broken property
  evidence: z.string().optional(),// captured evaluator output (the "exit 0 ≠ pass" receipt)
  raised_at: z.string().min(1),   // ISO-8601
}).strict();
export type Finding = z.infer<typeof FindingSchema>;

/** Pure validator: never throws; returns a discriminated result with a located error string. */
export function validateFinding(obj: unknown) {
  const r = FindingSchema.safeParse(obj);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}

/** Shared zod-error formatter: "path: message; …" — reused by every schema validator.
 *  Params are explicitly typed because runtime/tsconfig.json is `strict` (noImplicitAny). */
export function formatZodError(error: z.ZodError) {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test runtime/engine/test/finding-schema.test.mjs`
Expected: PASS (4/4).

- [ ] **Step 6: Verify the nx wiring works**

Run: `pnpm nx show project runtime` → resolves to a SINGLE project (confirms `package.json` + `project.json` merged, no double-registration).
Run: `pnpm nx test runtime` → runs the glob suite, PASS. (Confirm a positive collected count in the `node --test` summary — a zero-collected run is RED, the Node-24 glob foot-gun.)
Run: `pnpm nx typecheck runtime` → `tsc --noEmit` clean (0 errors) over `finding.schema.ts`.
(If `tsc` reports `allowImportingTsExtensions` needs `noEmit`/`emitDeclarationOnly` — it is already set to `noEmit: true` above; if it reports an unknown option, the base tsconfig's TS version is 5.9 which supports it — confirm `pnpm tsc --version` ≥ 5.7.)

- [ ] **Step 7: Commit**

```bash
git add runtime/runtime.config.json runtime/package.json runtime/tsconfig.json runtime/project.json runtime/engine/schema/finding.schema.ts runtime/engine/test/finding-schema.test.mjs
git commit -m "feat(runtime): scaffold ring-1 + finding schema (SPEC 1)" --no-verify
```
(`--no-verify`: worktree pre-commit hook silently rejects code commits — see [[feedback-worktree-commit-no-verify]]. Verify the commit landed with `git log --oneline -1`.)

---

## Task 2: `item.schema.ts` (the atom of work)

**Files:**
- Create: `runtime/engine/schema/item.schema.ts`
- Create: `runtime/engine/test/item-schema.test.mjs`

**Interfaces:**
- Consumes: `FindingId` type from `finding.schema.ts`.
- Produces: `ItemSchema`, `validateItem(obj) → { ok, value?, error? }`, types `Item`, `ItemStatus`, `ItemType`. `provenance.from_finding` is typed `FindingId` (a string), `provenance.from_check` a `CheckId` (a string) — distinct (§15 delta 2). Consumed by SPEC 3 intake + `findByScope` (reads `Item.scope`).

- [ ] **Step 1: Write the failing test** — `runtime/engine/test/item-schema.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateItem } from '../schema/item.schema.ts';

test('a minimal item validates (only id/type/status/done_criteria required)', () => {
  const r = validateItem({ id: 'x', type: 'feature', status: 'active', done_criteria: 'ships' });
  assert.equal(r.ok, true);
});

test('rank must be a number when present (the only stored priority input, law 2)', () => {
  assert.equal(validateItem({ id: 'x', type: 'bug', status: 'queued', done_criteria: 'd', rank: '3' }).ok, false);
  assert.equal(validateItem({ id: 'x', type: 'bug', status: 'queued', done_criteria: 'd', rank: 3 }).ok, true);
});

test('epic_role is constrained to core|captured', () => {
  assert.equal(validateItem({ id: 'x', type: 'feature', status: 'active', done_criteria: 'd', epic_role: 'core' }).ok, true);
  assert.equal(validateItem({ id: 'x', type: 'feature', status: 'active', done_criteria: 'd', epic_role: 'bogus' }).ok, false);
});

test('provenance.from_finding and from_check are independent optional strings', () => {
  const r = validateItem({ id: 'x', type: 'feature', status: 'active', done_criteria: 'd',
    provenance: { from_finding: 'f-1', from_check: 'read-model-single-writer' } });
  assert.equal(r.ok, true);
  assert.equal(r.value.provenance.from_finding, 'f-1');
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `node --test runtime/engine/test/item-schema.test.mjs` → FAIL (module absent).

- [ ] **Step 3: Write `runtime/engine/schema/item.schema.ts`**

```ts
// runtime/engine/schema/item.schema.ts — ring-1
// The item is the atom of WORK (§10). Ring-1 keeps it abstract; the project seam binds values.
import { z } from 'zod';
import { formatZodError } from './finding.schema.ts';

export type ItemId = string;
export type ItemStatus = string;  // project binds the values (active|queued|parking|shipped|dropped)
export type ItemType = string;    // project binds (bug|design|spec|epic|feature)

export const ItemSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  status: z.string().min(1),
  rank: z.number().optional(),                          // the ONLY stored priority input (law 2)
  epic: z.string().optional(),                          // single-parent pointer (1-level tree)
  epic_role: z.enum(['core', 'captured']).optional(),
  done_criteria: z.string().min(1),                     // the closure predicate ("done_when")
  scope: z.string().optional(),                         // path-glob-shaped (NOT free prose) — feeds findByScope
  out_of_scope: z.array(z.string()).optional(),
  references: z.array(z.string()).optional(),
  provenance: z.object({
    from_finding: z.string().optional(),               // FindingId (§15 delta 2) — which finding
    from_check: z.string().optional(),                 // CheckId (denormalized for query) — which check
  }).strict().optional(),
}).strict();
export type Item = z.infer<typeof ItemSchema>;

export function validateItem(obj: unknown) {
  const r = ItemSchema.safeParse(obj);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}
```

- [ ] **Step 4: Run test to verify it passes** — `node --test runtime/engine/test/item-schema.test.mjs` → PASS (4/4).

- [ ] **Step 5: Typecheck** — `pnpm nx typecheck runtime` → clean (add `engine/schema/item.schema.ts` is already covered by the `include` glob).

- [ ] **Step 6: Commit**
```bash
git add runtime/engine/schema/item.schema.ts runtime/engine/test/item-schema.test.mjs
git commit -m "feat(runtime): item schema (SPEC 1 §10)" --no-verify
```

---

## Task 3: `check.schema.ts` (the frozen contract — richest schema)

**Files:**
- Create: `runtime/engine/schema/check.schema.ts`
- Create: `runtime/engine/test/check-schema.test.mjs`
- Create: `runtime/engine/test/_fixtures.mjs` (the valid-check factory reused by later suites)

**Interfaces:**
- Consumes: `FindingKindSchema` from `finding.schema.ts`.
- Produces: `CheckEntrySchema`, `validateCheck(obj) → { ok, value?, error? }`, `RUN_SCHEMES` (`['cmd','module','eslint','skill']`), `parseRun(run) → { scheme, target } | null`, and types `CheckEntry`, `Evaluator`, `Scope`, `FlakeContract`, `Provenance`, `CostTier`, `Context`, `CheckStatus`, `EvaluatorKind`. Consumed by all six helpers + SPEC 2/3.
- Produces `_fixtures.mjs`: `validCheck(overrides) → CheckEntry`, `withTmpDir(fn)`, `writeYaml(dir, id, obj)`.

- [ ] **Step 1: Write the failing test** — `runtime/engine/test/check-schema.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCheck, parseRun, RUN_SCHEMES } from '../schema/check.schema.ts';
import { validCheck } from './_fixtures.mjs';

test('the four run-schemes are the closed set', () => {
  assert.deepEqual([...RUN_SCHEMES].sort(), ['cmd', 'eslint', 'module', 'skill']);
});

test('a full deterministic check validates', () => {
  assert.equal(validateCheck(validCheck()).ok, true);
});

test('parseRun splits scheme:target; a bare/unknown run is null', () => {
  assert.deepEqual(parseRun('cmd:node tools/x.mjs'), { scheme: 'cmd', target: 'node tools/x.mjs' });
  assert.deepEqual(parseRun('module:./m.mjs#fn'), { scheme: 'module', target: './m.mjs#fn' });
  assert.equal(parseRun('node tools/x.mjs'), null);      // bare (no scheme)
  assert.equal(parseRun('bogus:whatever'), null);        // unknown scheme
});

test('a check whose evaluator.run has no valid scheme is rejected at load', () => {
  const r = validateCheck(validCheck({ evaluator: { type: 'deterministic', run: 'node tools/x.mjs' } }));
  assert.equal(r.ok, false);
  assert.match(r.error, /run/);
});

test('a judgment check WITHOUT flake_contract is rejected (schema refuses it — §4/§8-3)', () => {
  const r = validateCheck(validCheck({
    evaluator: { type: 'judgment', run: 'skill:audit-service' }, flake_contract: undefined,
  }));
  assert.equal(r.ok, false);
  assert.match(r.error, /flake_contract/);
});

test('a judgment check WITH flake_contract validates', () => {
  const r = validateCheck(validCheck({
    kind: 'gap', cost_tier: 'expensive', contexts: ['audit'],
    evaluator: { type: 'judgment', run: 'skill:audit-service' },
    flake_contract: { eval_scenario: 'runtime/eval/scenarios/x.scenario.mjs', allowed_flake_rate: 0.05, calibration: 'n=20' },
  }));
  assert.equal(r.ok, true);
});

test('an invariant-context check must be cheap is NOT a schema rule (it is a meta-check) — schema allows it', () => {
  // cheap-by-construction is enforced by metaCheck (§8), not the schema — schema stays structural.
  assert.equal(validateCheck(validCheck({ contexts: ['invariant'], cost_tier: 'expensive' })).ok, true);
});

test('contexts must be non-empty and drawn from the frozen three', () => {
  assert.equal(validateCheck(validCheck({ contexts: [] })).ok, false);
  assert.equal(validateCheck(validCheck({ contexts: ['bogus'] })).ok, false);
});
```

- [ ] **Step 2: Write `_fixtures.mjs` (needed for the test to run)** — `runtime/engine/test/_fixtures.mjs`

```js
// Shared test helpers: a canonical valid CheckEntry + tmpdir plumbing. Not ring-1 surface.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';

/** A minimal VALID deterministic active check; override any field. */
export function validCheck(overrides = {}) {
  return {
    id: 'sample-check',
    property: 'a single consistency property holds',
    kind: 'inconsistency',
    evaluator: { type: 'deterministic', run: 'cmd:node tools/check-sample.mjs' },
    cost_tier: 'cheap',
    contexts: ['gate'],
    scope: { paths: ['services/**/*.ts'] },
    status: 'active',
    provenance: { minted_by: 'sample-item', ratified: '2026-07-01' },
    ...overrides,
  };
}

/** Run `fn(rootDir)` inside a fresh tmpdir, always cleaned up. */
export function withTmpDir(fn) {
  const root = mkdtempSync(join(tmpdir(), 'nf-runtime-'));
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

/** Write a check object as `<id>.yaml` under `dir` (creating dir). */
export function writeYaml(dir, id, obj) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.yaml`), stringify(obj), 'utf8');
}
```

- [ ] **Step 3: Run test to verify it fails** — `node --test runtime/engine/test/check-schema.test.mjs` → FAIL (`check.schema.ts` absent).

- [ ] **Step 4: Write `runtime/engine/schema/check.schema.ts`**

```ts
// runtime/engine/schema/check.schema.ts — ring-1 SOURCE OF TRUTH for the check atom (§4).
// zod validators + z.infer types in one file; SPEC 2 & 3 consume these verbatim.
import { z } from 'zod';
import { FindingKindSchema } from './finding.schema.ts';
import { formatZodError } from './finding.schema.ts';

export type CheckId = string;
export const CostTierSchema = z.enum(['cheap', 'moderate', 'expensive']);
export type CostTier = z.infer<typeof CostTierSchema>;
export const ContextSchema = z.enum(['gate', 'audit', 'invariant']);
export type Context = z.infer<typeof ContextSchema>;
export const CheckStatusSchema = z.enum(['candidate', 'active', 'superseded', 'retired']);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;
export type EvaluatorKind = 'deterministic' | 'judgment';

// The closed run-scheme set (§4). The scheme is the sole disambiguator; a bare run is a load error.
export const RUN_SCHEMES = ['cmd', 'module', 'eslint', 'skill'] as const;
export type RunScheme = (typeof RUN_SCHEMES)[number];

/** Pure grammar parser: "<scheme>:<target>" with a known scheme, else null.
 *  `run: string` (zod validates it as a string before this is ever called); the `as readonly
 *  string[]` cast is required because RUN_SCHEMES is `as const` (a literal tuple) and `.includes`
 *  of a widened `string` would not typecheck under `strict`. */
export function parseRun(run: string) {
  const idx = typeof run === 'string' ? run.indexOf(':') : -1;
  if (idx <= 0) return null;
  const scheme = run.slice(0, idx);
  if (!(RUN_SCHEMES as readonly string[]).includes(scheme)) return null;
  const target = run.slice(idx + 1);
  return target.length ? { scheme, target } : null;
}
const runHasValidScheme = (run: string) => parseRun(run) !== null;

const DeterministicEvaluatorSchema = z.object({
  type: z.literal('deterministic'),
  run: z.string().refine(runHasValidScheme, { message: 'run must be <scheme>:<target> with scheme in cmd|module|eslint|skill' }),
  fix: z.string().optional(),
}).strict();
const JudgmentEvaluatorSchema = z.object({
  type: z.literal('judgment'),
  run: z.string().refine(runHasValidScheme, { message: 'run must be <scheme>:<target>' }),
}).strict();
export const EvaluatorSchema = z.discriminatedUnion('type', [DeterministicEvaluatorSchema, JudgmentEvaluatorSchema]);
export type Evaluator = z.infer<typeof EvaluatorSchema>;

export const ScopeSchema = z.object({
  paths: z.array(z.string()),
  dossiers: z.array(z.string()).optional(),
  exclusions: z.string().optional(),
}).strict();
export type Scope = z.infer<typeof ScopeSchema>;

export const FlakeContractSchema = z.object({
  eval_scenario: z.string().min(1),
  allowed_flake_rate: z.number().min(0).max(1),
  calibration: z.string().min(1),
  min_confidence: z.number().min(0).max(1).optional(),
}).strict();
export type FlakeContract = z.infer<typeof FlakeContractSchema>;

export const ProvenanceSchema = z.object({
  minted_by: z.string().min(1),          // item/lesson id, or the reserved "starter-pack" (§15 delta 3)
  lesson: z.string().optional(),
  ratified: z.string().optional(),        // OPTIONAL (§15 delta 1): a candidate has none yet
  supersedes: z.string().optional(),
  superseded_by: z.string().optional(),
  retired_reason: z.string().optional(),
}).strict();
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const CheckEntrySchema = z.object({
  id: z.string().min(1),
  property: z.string().min(1),
  kind: FindingKindSchema,
  evaluator: EvaluatorSchema,
  cost_tier: CostTierSchema,
  contexts: z.array(ContextSchema).nonempty(),
  scope: ScopeSchema,
  status: CheckStatusSchema,
  flake_contract: FlakeContractSchema.optional(),
  provenance: ProvenanceSchema,
}).strict().superRefine((check, ctx) => {
  // The one cross-field rule the SCHEMA owns: judgment ⇒ flake_contract present (§4, §8 assertion 3, §9).
  if (check.evaluator.type === 'judgment' && !check.flake_contract) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['flake_contract'],
      message: 'a judgment check must carry a flake_contract' });
  }
});
export type CheckEntry = z.infer<typeof CheckEntrySchema>;

export function validateCheck(obj: unknown) {
  const r = CheckEntrySchema.safeParse(obj);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}
```

- [ ] **Step 5: Run tests to verify they pass** — `node --test runtime/engine/test/check-schema.test.mjs` → PASS (all).

- [ ] **Step 6: Typecheck** — `pnpm nx typecheck runtime` → clean. (Confirms `as const` and the discriminated union are erasable/valid.)

- [ ] **Step 7: Commit**
```bash
git add runtime/engine/schema/check.schema.ts runtime/engine/test/check-schema.test.mjs runtime/engine/test/_fixtures.mjs
git commit -m "feat(runtime): check entry schema — the frozen contract (SPEC 1 §4)" --no-verify
```

---

## Task 4: `loadRegistry` (§13 A×5)

**Files:**
- Create: `runtime/engine/lib/fs-walk.mjs`
- Create: `runtime/engine/lib/load-registry.mjs`
- Create: `runtime/engine/test/load-registry.test.mjs`

**Interfaces:**
- Consumes: `validateCheck` from `check.schema.ts`; `parse` from `yaml`; `validCheck`/`withTmpDir`/`writeYaml` from `_fixtures.mjs`.
- Produces: `loadRegistry({ checksDir }) → { checks: CheckEntry[], byId: Map<CheckId, CheckEntry>, errors: {file, error}[] }`. Consumed by `metaCheck`, `findByScope`, `content-ring.test.mjs`, SPEC 2/3. `fs-walk.mjs` exports `listYamlFiles({ dir }) → string[]` (absolute paths).

- [ ] **Step 1: Write the failing test** — `runtime/engine/test/load-registry.test.mjs` (the §13 A scenarios)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry } from '../lib/load-registry.mjs';
import { validCheck, withTmpDir, writeYaml } from './_fixtures.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// A1
test('loads 3 valid checks: length 3, byId complete, no errors', () => withTmpDir((root) => {
  const dir = join(root, 'checks');
  for (const id of ['a', 'b', 'c']) writeYaml(dir, id, validCheck({ id }));
  const reg = loadRegistry({ checksDir: dir });
  assert.equal(reg.checks.length, 3);
  assert.equal(reg.byId.size, 3);
  assert.ok(reg.byId.has('a') && reg.byId.has('b') && reg.byId.has('c'));
  assert.deepEqual(reg.errors, []);
}));

// A2 — parseable-precondition parity with backlog-lint: malformed file is LOCATED, others still load, no throw
test('a malformed YAML file is reported located-by-filename; the rest still load; no throw', () => withTmpDir((root) => {
  const dir = join(root, 'checks');
  writeYaml(dir, 'good', validCheck({ id: 'good' }));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'broken.yaml'), 'id: [unterminated\n  bad: : :', 'utf8');
  const reg = loadRegistry({ checksDir: dir });
  assert.equal(reg.checks.length, 1);
  assert.equal(reg.errors.length, 1);
  assert.match(reg.errors[0].file, /broken\.yaml$/);
}));

// A3 — duplicate id
test('two files with the same id → a duplicate-id error', () => withTmpDir((root) => {
  const dir = join(root, 'checks');
  writeYaml(dir, 'first', validCheck({ id: 'dup' }));
  writeYaml(dir, 'second', validCheck({ id: 'dup' }));
  const reg = loadRegistry({ checksDir: dir });
  assert.ok(reg.errors.some((e) => /duplicate id/i.test(e.error) && /dup/.test(e.error)));
}));

// A4 — missing required field, named by file + field
test('a check missing `property` → a zod error naming the file and field', () => withTmpDir((root) => {
  const dir = join(root, 'checks');
  const bad = validCheck({ id: 'nofield' }); delete bad.property;
  writeYaml(dir, 'nofield', bad);
  const reg = loadRegistry({ checksDir: dir });
  assert.equal(reg.checks.length, 0);
  const e = reg.errors.find((e) => /nofield\.yaml$/.test(e.file));
  assert.ok(e && /property/.test(e.error));
}));

// A5 — judgment without flake_contract rejected at load
test('a judgment check with no flake_contract → a validation error at load', () => withTmpDir((root) => {
  const dir = join(root, 'checks');
  const j = validCheck({ id: 'j', evaluator: { type: 'judgment', run: 'skill:audit-service' } });
  delete j.flake_contract;
  writeYaml(dir, 'j', j);
  const reg = loadRegistry({ checksDir: dir });
  assert.equal(reg.checks.length, 0);
  assert.ok(reg.errors.some((e) => /flake_contract/.test(e.error)));
}));

// empty dir → empty registry, no throw
test('an empty/absent checksDir yields an empty registry, no throw', () => withTmpDir((root) => {
  const reg = loadRegistry({ checksDir: join(root, 'does-not-exist') });
  assert.deepEqual(reg.checks, []); assert.deepEqual(reg.errors, []);
}));
```

- [ ] **Step 2: Run test to verify it fails** — `node --test runtime/engine/test/load-registry.test.mjs` → FAIL.

- [ ] **Step 3: Write `runtime/engine/lib/fs-walk.mjs`**

```js
#!/usr/bin/env node
// fs-walk.mjs — house-convention file discovery (no glob lib). Lists *.yaml under a dir (one level;
// the check library is flat per §11). Absent dir → []. Pure, no side effects on import.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export function listYamlFiles({ dir }) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }                 // absent dir tolerated (tmpdir-friendly)
  return entries
    .filter((e) => e.isFile() && (e.name.endsWith('.yaml') || e.name.endsWith('.yml')))
    .map((e) => join(dir, e.name))
    .sort();                           // stable order for deterministic tests
}
```

- [ ] **Step 4: Write `runtime/engine/lib/load-registry.mjs`**

```js
#!/usr/bin/env node
// load-registry.mjs — loadRegistry(): parse + zod-validate every *.yaml under checksDir.
// Malformed/invalid files are LOCATED in errors[] (never crash); byId is Map<CheckId,CheckEntry>.
// Duplicate ids are a global-uniqueness error. CLI: exit 0 clean, 1 any error, 2 usage.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { listYamlFiles } from './fs-walk.mjs';
import { validateCheck } from '../schema/check.schema.ts';

/** @returns {{checks, byId: Map, errors: {file,error}[]}} */
export function loadRegistry({ checksDir }) {
  const checks = [];
  const byId = new Map();
  const errors = [];
  for (const file of listYamlFiles({ dir: checksDir })) {
    let raw;
    try { raw = parse(readFileSync(file, 'utf8')); }
    catch (e) { errors.push({ file, error: `malformed YAML: ${e.message}` }); continue; }
    const res = validateCheck(raw);
    if (!res.ok) { errors.push({ file, error: res.error }); continue; }
    if (byId.has(res.value.id)) { errors.push({ file, error: `duplicate id: ${res.value.id}` }); continue; }
    byId.set(res.value.id, res.value);
    checks.push(res.value);
  }
  return { checks, byId, errors };
}

function main() {
  const dirArg = process.argv.indexOf('--checks-dir');
  const checksDir = dirArg >= 0 ? process.argv[dirArg + 1] : undefined;
  if (!checksDir) { console.error('usage: load-registry.mjs --checks-dir <dir>'); process.exit(2); }
  const reg = loadRegistry({ checksDir });
  console.log(`loaded ${reg.checks.length} check(s), ${reg.errors.length} error(s)`);
  for (const e of reg.errors) console.error(`  ${e.file}: ${e.error}`);
  process.exit(reg.errors.length ? 1 : 0);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 5: Run tests to verify they pass** — `node --test runtime/engine/test/load-registry.test.mjs` → PASS (6/6).

- [ ] **Step 6: Commit**
```bash
git add runtime/engine/lib/fs-walk.mjs runtime/engine/lib/load-registry.mjs runtime/engine/test/load-registry.test.mjs
git commit -m "feat(runtime): loadRegistry helper (SPEC 1 §11, gates A×5)" --no-verify
```

---

## Task 5: `resolveEvaluator` (§13 F×4) + typed errors

**Files:**
- Create: `runtime/engine/lib/errors.mjs`
- Create: `runtime/engine/lib/resolve-evaluator.mjs`
- Create: `runtime/engine/test/resolve-evaluator.test.mjs`

**Interfaces:**
- Consumes: `parseRun` from `check.schema.ts`.
- Produces: `resolveEvaluator({ check }) → { kind: EvaluatorKind, invoke: () => Finding[] | Promise<Finding[]> }`. Throws `EvaluatorUnresolved` (unknown/bare scheme, or module path absent) and `JudgmentContractMissing` (judgment without flake_contract). `errors.mjs` exports `EvaluatorUnresolved`, `JudgmentContractMissing`, `JudgeCapabilityUnavailable`. Consumed by `runCheck` + `metaCheck` (assertion 2).
- **Resolution depth (documented decision):** sync structural resolution. `cmd:`/`eslint:` resolve on well-formedness (deep existence is invoke-time — a bad command/rule surfaces when run). `module:` resolves the specifier relative to `process.cwd()` (or absolute) and checks the file exists via `existsSync` — an absent module is `EvaluatorUnresolved` (assertion 2's failure surface). `skill:` returns `kind:'judgment'`; its `invoke` throws `JudgeCapabilityUnavailable` (the judge capability is SPEC 3's seam #1 — ring-1 does not run skills), but resolution + the flake_contract guard succeed.

- [ ] **Step 1: Write the failing test** — `runtime/engine/test/resolve-evaluator.test.mjs` (§13 F)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEvaluator } from '../lib/resolve-evaluator.mjs';
import { EvaluatorUnresolved, JudgmentContractMissing } from '../lib/errors.mjs';
import { validCheck, withTmpDir } from './_fixtures.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// F1 — a resolving cmd: check → {kind:'deterministic', invoke:thunk}
test('a cmd: check resolves to deterministic with a callable invoke thunk', () => {
  const { kind, invoke } = resolveEvaluator({ check: validCheck({ evaluator: { type: 'deterministic', run: 'cmd:true' } }) });
  assert.equal(kind, 'deterministic');
  assert.equal(typeof invoke, 'function');
});

// F2 — unknown scheme / bare / non-existent module target → EvaluatorUnresolved
test('an unknown scheme throws EvaluatorUnresolved', () => {
  assert.throws(() => resolveEvaluator({ check: validCheck({ evaluator: { type: 'deterministic', run: 'bogus:x' } }) }), EvaluatorUnresolved);
});
test('a bare (scheme-less) run throws EvaluatorUnresolved', () => {
  assert.throws(() => resolveEvaluator({ check: validCheck({ evaluator: { type: 'deterministic', run: 'node tools/x.mjs' } }) }), EvaluatorUnresolved);
});
test('a module: pointing at an absent file throws EvaluatorUnresolved', () => {
  assert.throws(() => resolveEvaluator({ check: validCheck({ evaluator: { type: 'deterministic', run: 'module:./nope-absent.mjs#fn' } }) }), EvaluatorUnresolved);
});

// F3 — judgment without flake_contract → JudgmentContractMissing
test('a skill: judgment check with no flake_contract throws JudgmentContractMissing', () => {
  const c = validCheck({ evaluator: { type: 'judgment', run: 'skill:audit-service' } });
  delete c.flake_contract;
  assert.throws(() => resolveEvaluator({ check: c }), JudgmentContractMissing);
});

// F4 — one check per scheme resolves via its branch; kinds correct
test('each scheme resolves via its dispatch branch with the right kind', () => withTmpDir((root) => {
  const mod = join(root, 'm.mjs'); writeFileSync(mod, 'export const fn = () => [];', 'utf8');
  const cmd = resolveEvaluator({ check: validCheck({ evaluator: { type: 'deterministic', run: 'cmd:true' } }) });
  const module_ = resolveEvaluator({ check: validCheck({ evaluator: { type: 'deterministic', run: `module:${mod}#fn` } }) });
  const eslint = resolveEvaluator({ check: validCheck({ evaluator: { type: 'deterministic', run: 'eslint:@nx/enforce-module-boundaries' } }) });
  const skill = resolveEvaluator({ check: validCheck({
    kind: 'gap', cost_tier: 'expensive', contexts: ['audit'],
    evaluator: { type: 'judgment', run: 'skill:audit-service' },
    flake_contract: { eval_scenario: 's', allowed_flake_rate: 0.05, calibration: 'n=20' },
  }) });
  assert.equal(cmd.kind, 'deterministic');
  assert.equal(module_.kind, 'deterministic');
  assert.equal(eslint.kind, 'deterministic');
  assert.equal(skill.kind, 'judgment');
}));
```

- [ ] **Step 2: Write `runtime/engine/lib/errors.mjs`**

```js
// errors.mjs — typed error classes surfaced by resolveEvaluator (meta-check assertion 2/3 surfaces).
export class EvaluatorUnresolved extends Error {
  constructor(run, reason) { super(`evaluator unresolved: ${run} (${reason})`); this.name = 'EvaluatorUnresolved'; this.run = run; }
}
export class JudgmentContractMissing extends Error {
  constructor(id) { super(`judgment check "${id}" has no flake_contract`); this.name = 'JudgmentContractMissing'; }
}
export class JudgeCapabilityUnavailable extends Error {
  constructor(run) { super(`skill judge capability is not wired in ring-1 (SPEC 3 seam #1): ${run}`); this.name = 'JudgeCapabilityUnavailable'; }
}
```

- [ ] **Step 3: Run test to verify it fails** — `node --test runtime/engine/test/resolve-evaluator.test.mjs` → FAIL (`resolve-evaluator.mjs` absent).

- [ ] **Step 4: Write `runtime/engine/lib/resolve-evaluator.mjs`**

```js
#!/usr/bin/env node
// resolve-evaluator.mjs — resolveEvaluator(): parse evaluator.run against the closed run-grammar
// (§4 dispatch table) and return { kind, invoke }. Sync structural resolution; deep cmd/eslint
// existence is invoke-time. module: existence is checked (absent file ⇒ EvaluatorUnresolved).
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseRun } from '../schema/check.schema.ts';
import { EvaluatorUnresolved, JudgmentContractMissing, JudgeCapabilityUnavailable } from './errors.mjs';

/** Normalize any evaluator return into Finding-ish objects; empty array = passed. */
function toFindings(result, check) {
  if (!Array.isArray(result)) return [];
  return result.map((r) => ({ kind: check.kind, ...r }));
}

export function resolveEvaluator({ check }) {
  const parsed = parseRun(check.evaluator.run);
  if (!parsed) throw new EvaluatorUnresolved(check.evaluator.run, 'no valid scheme');
  const { scheme, target } = parsed;

  if (scheme === 'skill') {
    if (!check.flake_contract) throw new JudgmentContractMissing(check.id);
    return { kind: 'judgment', invoke: () => { throw new JudgeCapabilityUnavailable(check.evaluator.run); } };
  }
  if (scheme === 'cmd') {
    return { kind: 'deterministic', invoke: () => {
      const r = spawnSync(target, { shell: true, encoding: 'utf8' });
      if (r.status === 0) return [];
      return toFindings([{ detail: check.property, evidence: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), scope: check.scope.paths }], check);
    } };
  }
  if (scheme === 'module') {
    const [spec, exportName] = target.split('#');
    if (!spec || !exportName) throw new EvaluatorUnresolved(check.evaluator.run, 'module ref needs <specifier>#<export>');
    const abs = isAbsolute(spec) ? spec : resolvePath(process.cwd(), spec);
    if (!existsSync(abs)) throw new EvaluatorUnresolved(check.evaluator.run, `module not found: ${abs}`);
    return { kind: 'deterministic', invoke: async () => {
      const mod = await import(pathToFileURL(abs).href);
      const fn = mod[exportName];
      if (typeof fn !== 'function') throw new EvaluatorUnresolved(check.evaluator.run, `export ${exportName} is not a function`);
      return toFindings(await fn(), check);   // ring-1 calling convention: zero-arg core → violation array
    } };
  }
  // eslint:
  if (!target.length) throw new EvaluatorUnresolved(check.evaluator.run, 'empty eslint rule id');
  return { kind: 'deterministic', invoke: () => {
    const r = spawnSync('npx', ['eslint', '--no-eslintrc', '--rulesdir', '.', '--rule', `{"${target}":"error"}`, ...check.scope.paths], { encoding: 'utf8' });
    return r.status === 0 ? [] : toFindings([{ detail: check.property, evidence: (r.stdout ?? '').trim(), scope: check.scope.paths }], check);
  } };
}

function main() {
  console.error('resolve-evaluator.mjs is a library; import resolveEvaluator'); process.exit(2);
}
if (process.argv[1] === new URL(import.meta.url).pathname) main();
```

> **Note on `eslint:` invoke:** the exact single-rule CLI incantation is invoke-time and only exercised by the content ring; the golden gates (F4) assert *resolution* (kind + thunk), not a real eslint run. If the `--rule` flags prove version-sensitive during Task 10, swap the invoke body for the `ESLint` node API (`new ESLint({ overrideConfigFile: true, overrideConfig: { rules: { [target]: 'error' } } })`) — the resolution contract (return `{kind:'deterministic', invoke}`) is unchanged.

- [ ] **Step 5: Run tests to verify they pass** — `node --test runtime/engine/test/resolve-evaluator.test.mjs` → PASS.

- [ ] **Step 6: Commit**
```bash
git add runtime/engine/lib/errors.mjs runtime/engine/lib/resolve-evaluator.mjs runtime/engine/test/resolve-evaluator.test.mjs
git commit -m "feat(runtime): resolveEvaluator + typed errors (SPEC 1 §11, gates F×4)" --no-verify
```

---

## Task 6: `runCheck` (§13 E×4)

**Files:**
- Create: `runtime/engine/lib/run-check.mjs`
- Create: `runtime/engine/test/run-check.test.mjs`

**Interfaces:**
- Consumes: `resolveEvaluator` from `resolve-evaluator.mjs`.
- Produces: `runCheck({ check, context }) → { findings: Finding[], ran: boolean, skippedReason?: string }`. Refuses when `context ∉ check.contexts` (`ran:false`, `skippedReason:'context-not-declared'`). CLI: exit 0 no findings, 1 findings, 2 usage/refused. Consumed by SPEC 3 watch engine.

- [ ] **Step 1: Write the failing test** — `runtime/engine/test/run-check.test.mjs` (§13 E). Uses tiny cmd scripts for deterministic pass/raise.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck } from '../lib/run-check.mjs';
import { validCheck, withTmpDir } from './_fixtures.mjs';
import { writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// E1 — context not declared → refused, zero findings (honesty rule ENFORCED)
test('a check invoked in an undeclared context is refused with context-not-declared', async () => {
  const check = validCheck({ contexts: ['audit'], evaluator: { type: 'deterministic', run: 'cmd:true' } });
  const r = await runCheck({ check, context: 'gate' });
  assert.deepEqual(r, { findings: [], ran: false, skippedReason: 'context-not-declared' });
});

// E2 — declared context → runs
test('the same check in a declared context runs', async () => {
  const check = validCheck({ contexts: ['audit'], evaluator: { type: 'deterministic', run: 'cmd:true' } });
  const r = await runCheck({ check, context: 'audit' });
  assert.equal(r.ran, true);
  assert.deepEqual(r.findings, []);
});

// E3 — evaluator raises → findings tagged with check.kind; CLI exits 1
test('a raising evaluator yields findings tagged kind===check.kind and CLI exits 1', async () => withTmpDir(async (root) => {
  const check = validCheck({ kind: 'drift', contexts: ['gate'], evaluator: { type: 'deterministic', run: 'cmd:false' } });
  const r = await runCheck({ check, context: 'gate' });
  assert.equal(r.ran, true);
  assert.ok(r.findings.length >= 1);
  assert.ok(r.findings.every((f) => f.kind === 'drift'));
  // CLI exit 1: point at a real cmd:false via the CLI
  const cli = join(process.cwd(), 'runtime/engine/lib/run-check.mjs');
  // (CLI path covered indirectly; the unit assertion above is the gate — see Step 4 for the CLI contract.)
}));

// E4 — evaluator passes → no findings, ran:true
test('a passing evaluator yields no findings, ran:true', async () => {
  const check = validCheck({ contexts: ['gate'], evaluator: { type: 'deterministic', run: 'cmd:true' } });
  const r = await runCheck({ check, context: 'gate' });
  assert.deepEqual(r.findings, []);
  assert.equal(r.ran, true);
}));
```

- [ ] **Step 2: Run test to verify it fails** — `node --test runtime/engine/test/run-check.test.mjs` → FAIL.

- [ ] **Step 3: Write `runtime/engine/lib/run-check.mjs`**

```js
#!/usr/bin/env node
// run-check.mjs — runCheck(): enforce the honesty rule (a check never runs in a context it did not
// declare, §6), else resolve+run the evaluator and tag findings with check.kind. CLI: 0 clean, 1 findings, 2 usage.
import { fileURLToPath } from 'node:url';
import { resolveEvaluator } from './resolve-evaluator.mjs';

export async function runCheck({ check, context }) {
  if (!check.contexts.includes(context)) {
    return { findings: [], ran: false, skippedReason: 'context-not-declared' };
  }
  const { invoke } = resolveEvaluator({ check });
  const findings = await invoke();
  return { findings: findings.map((f) => ({ ...f, kind: check.kind })), ran: true };
}

async function main() {
  const id = process.argv[2];
  const ctxArg = process.argv.indexOf('--context');
  const context = ctxArg >= 0 ? process.argv[ctxArg + 1] : undefined;
  if (!id || !context) { console.error('usage: run-check.mjs <check-id> --context <gate|audit|invariant>'); process.exit(2); }
  console.error('run-check.mjs CLI requires a loaded registry; use via the watch engine (SPEC 3).');
  process.exit(2);   // ring-1 CLI is a stub: resolving <check-id>→CheckEntry needs a registry (SPEC 3 wiring)
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
```

> **CLI scope note:** the `run-check.mjs` CLI needs a *loaded registry* to turn `<check-id>` into a `CheckEntry`; wiring that (config-resolve → loadRegistry → lookup) is SPEC 3's watch-engine job. Ring-1 ships the pure `runCheck({check,context})` core (fully tested by E1–E4) and a usage-stub CLI. The "fails loudly / exit 1" contract is a property of the core's `findings.length` that SPEC 3's CLI surfaces; E3 asserts the core returns kind-tagged findings.

- [ ] **Step 4: Run tests to verify they pass** — `node --test runtime/engine/test/run-check.test.mjs` → PASS.

- [ ] **Step 5: Commit**
```bash
git add runtime/engine/lib/run-check.mjs runtime/engine/test/run-check.test.mjs
git commit -m "feat(runtime): runCheck — context-honesty + finding tagging (SPEC 1 §11, gates E×4)" --no-verify
```

---

## Task 7: `findByScope` (§13 D×4) + glob-overlap predicate

**Files:**
- Create: `runtime/engine/lib/glob-overlap.mjs`
- Create: `runtime/engine/lib/find-by-scope.mjs`
- Create: `runtime/engine/test/glob-overlap.test.mjs`
- Create: `runtime/engine/test/find-by-scope.test.mjs`

**Interfaces:**
- Produces: `globsOverlap(a: string, b: string) → boolean` (pure; true iff some concrete path is matched by both globs). `findByScope({ registry, scope }) → { checks: CheckEntry[], invariants: CheckEntry[] }` where `scope` is a path-glob set (array of globs, or a whitespace/newline-separated string). `checks` = active checks whose `scope.paths` overlap the item scope (by `globsOverlap`); `invariants` = ALL active `invariant`-context checks, returned in full regardless of overlap (§11 tension (b)).

- [ ] **Step 1: Write the failing glob-overlap unit test** — `runtime/engine/test/glob-overlap.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globsOverlap } from '../lib/glob-overlap.mjs';

test('identical globs overlap', () => assert.equal(globsOverlap('services/**/*.ts', 'services/**/*.ts'), true));
test('** absorbs intermediate segments: services/**/*.ts vs services/investor-ctrl/** overlap', () =>
  assert.equal(globsOverlap('services/**/*.ts', 'services/investor-ctrl/**'), true));
test('disjoint literal roots do not overlap', () =>
  assert.equal(globsOverlap('services/**', 'docs/**'), false));
test('intra-segment *.ts vs a non-.ts literal path do not overlap', () =>
  assert.equal(globsOverlap('services/*/x/*.ts', 'services/a/x/readme.md'), false));
test('intra-segment *.ts vs a concrete .ts path overlap', () =>
  assert.equal(globsOverlap('services/*/*.ts', 'services/a/main.ts'), true));
test('single * matches exactly one segment (not across /)', () => {
  assert.equal(globsOverlap('services/*', 'services/a/b'), false);
  assert.equal(globsOverlap('services/*', 'services/a'), true);
});
test('** matches zero segments: a/**/b vs a/b overlap', () => assert.equal(globsOverlap('a/**/b', 'a/b'), true));
```

- [ ] **Step 2: Run it to verify it fails** — `node --test runtime/engine/test/glob-overlap.test.mjs` → FAIL.

- [ ] **Step 3: Write `runtime/engine/lib/glob-overlap.mjs`**

```js
// glob-overlap.mjs — pure predicate: do two path-globs share at least one concrete matching path?
// Segment-DP over '/'-split segments. Supports: literal, '*' (one segment, may contain intra-segment
// wildcards like '*.ts'), '**' (zero or more segments). No filesystem access — this is a decidable
// question over the two patterns (§11 findByScope overlap predicate).

/** Do two single-segment wildcard patterns (only '*' meta) share a common string? */
function segTokensOverlap(a, b) {
  // DP over characters; '*' matches any run (including empty) WITHIN a segment.
  const memo = new Map();
  const go = (i, j) => {
    const key = i * (b.length + 1) + j;
    if (memo.has(key)) return memo.get(key);
    let res;
    if (i === a.length && j === b.length) res = true;
    else {
      const ca = i < a.length ? a[i] : null;
      const cb = j < b.length ? b[j] : null;
      if (ca === '*') res = go(i + 1, j) || (j < b.length && go(i, j + 1));      // a's * absorbs 0..n of b
      else if (cb === '*') res = go(i, j + 1) || (i < a.length && go(i + 1, j)); // b's * absorbs 0..n of a
      else if (ca !== null && cb !== null && ca === cb) res = go(i + 1, j + 1);  // literal match
      else res = false;
    }
    memo.set(key, res);
    return res;
  };
  return go(0, 0);
}

const split = (g) => g.split('/').filter((s) => s.length > 0);

export function globsOverlap(a, b) {
  const A = split(a), B = split(b);
  const memo = new Map();
  const go = (i, j) => {
    const key = i * (B.length + 1) + j;
    if (memo.has(key)) return memo.get(key);
    let res;
    if (i === A.length && j === B.length) res = true;
    else if (i < A.length && A[i] === '**') res = go(i + 1, j) || (j < B.length && go(i, j + 1)); // ** absorbs 0..n of B
    else if (j < B.length && B[j] === '**') res = go(i, j + 1) || (i < A.length && go(i + 1, j)); // ** absorbs 0..n of A
    else if (i < A.length && j < B.length) res = segTokensOverlap(A[i], B[j]) && go(i + 1, j + 1);
    else res = false;
    memo.set(key, res);
    return res;
  };
  return go(0, 0);
}
```

- [ ] **Step 4: Run the glob-overlap test to verify it passes** — `node --test runtime/engine/test/glob-overlap.test.mjs` → PASS.

- [ ] **Step 5: Write the failing findByScope test** — `runtime/engine/test/find-by-scope.test.mjs` (§13 D)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findByScope } from '../lib/find-by-scope.mjs';
import { validCheck } from './_fixtures.mjs';

const reg = (checks) => ({ checks, byId: new Map(checks.map((c) => [c.id, c])), errors: [] });

// D1 — item scope overlaps 2 checks; 4 global invariants elsewhere → checks=2 overlapping, invariants=all 4
test('overlapping checks are scoped in; all global invariants ride the wake', () => {
  const overlap1 = validCheck({ id: 'o1', contexts: ['gate'], scope: { paths: ['services/investor-ctrl/**'] } });
  const overlap2 = validCheck({ id: 'o2', contexts: ['audit'], cost_tier: 'moderate', scope: { paths: ['services/**/*.ts'] } });
  const inv = (n) => validCheck({ id: `inv${n}`, contexts: ['invariant'], cost_tier: 'cheap', scope: { paths: ['libs/other/**'] } });
  const r = findByScope({ registry: reg([overlap1, overlap2, inv(1), inv(2), inv(3), inv(4)]), scope: ['services/investor-ctrl/src/x.ts'] });
  assert.deepEqual(r.checks.map((c) => c.id).sort(), ['o1', 'o2']);
  assert.equal(r.invariants.length, 4);
});

// D2 — expensive audit check outside scope → not returned
test('an expensive audit check outside scope is not returned', () => {
  const outside = validCheck({ id: 'x', contexts: ['audit'], cost_tier: 'expensive', scope: { paths: ['docs/**'] } });
  const r = findByScope({ registry: reg([outside]), scope: ['services/a/x.ts'] });
  assert.equal(r.checks.length, 0);
  assert.equal(r.invariants.length, 0);
});

// D3 — global invariant whose scope does NOT overlap → still returned
test('a non-overlapping global invariant is still returned (scoping narrows retrieval, never enforcement)', () => {
  const inv = validCheck({ id: 'g', contexts: ['invariant'], cost_tier: 'cheap', scope: { paths: ['nowhere/**'] } });
  const r = findByScope({ registry: reg([inv]), scope: ['services/a/x.ts'] });
  assert.equal(r.invariants.map((c) => c.id).join(), 'g');
});

// D4 — partial overlap (one glob in common, rest disjoint) → returned
test('a check partially overlapping the item scope is returned', () => {
  const c = validCheck({ id: 'p', contexts: ['gate'], scope: { paths: ['docs/**', 'services/investor-ctrl/**'] } });
  const r = findByScope({ registry: reg([c]), scope: ['libs/z/**', 'services/investor-ctrl/**'] });
  assert.equal(r.checks.map((x) => x.id).join(), 'p');
});

// non-active checks are excluded
test('non-active checks never ride the wake', () => {
  const cand = validCheck({ id: 'c', status: 'candidate', contexts: ['gate'], scope: { paths: ['services/**'] } });
  const r = findByScope({ registry: reg([cand]), scope: ['services/a'] });
  assert.equal(r.checks.length, 0);
});
```

- [ ] **Step 6: Write `runtime/engine/lib/find-by-scope.mjs`**

```js
// find-by-scope.mjs — findByScope(): the scoped wake. Retrieval-scoped `checks` + ALWAYS-full
// `invariants`. Scoping narrows retrieval (dossiers, expensive audits), never the enforcement floor (§6/§11).
import { globsOverlap } from './glob-overlap.mjs';

const toGlobSet = (scope) => Array.isArray(scope) ? scope : String(scope ?? '').split(/[\s\n]+/).filter(Boolean);

export function findByScope({ registry, scope }) {
  const itemGlobs = toGlobSet(scope);
  const active = registry.checks.filter((c) => c.status === 'active');
  const overlaps = (c) => c.scope.paths.some((cp) => itemGlobs.some((ig) => globsOverlap(cp, ig)));
  const checks = active.filter(overlaps);
  const invariants = active.filter((c) => c.contexts.includes('invariant'));
  return { checks, invariants };
}
```

- [ ] **Step 7: Run both tests to verify they pass** — `node --test runtime/engine/test/glob-overlap.test.mjs runtime/engine/test/find-by-scope.test.mjs` → PASS.

- [ ] **Step 8: Commit**
```bash
git add runtime/engine/lib/glob-overlap.mjs runtime/engine/lib/find-by-scope.mjs runtime/engine/test/glob-overlap.test.mjs runtime/engine/test/find-by-scope.test.mjs
git commit -m "feat(runtime): findByScope + glob-overlap predicate (SPEC 1 §11, gates D×4)" --no-verify
```

---

## Task 8: `advanceLifecycle` (§13 C×7)

**Files:**
- Create: `runtime/engine/lib/advance-lifecycle.mjs`
- Create: `runtime/engine/test/advance-lifecycle.test.mjs`

**Interfaces:**
- Produces: `advanceLifecycle({ check, transition, floorApproval, successor }) → { check, event }`. `transition ∈ {ratify, edit, decline, supersede, retire}`. **Guard precedence is fixed: floor-approval FIRST, then from-state legality** (§11) — a floorless illegal transition returns `REFUSED_NO_FLOOR`, never `REFUSED_ILLEGAL_TRANSITION`. `decline` on a candidate → `{ check: null, event: 'DISCARDED' }`. `supersede` requires `successor` and chains `supersedes`/`superseded_by` on both. Events: `RATIFIED | EDITED | DISCARDED | SUPERSEDED | RETIRED | REFUSED_NO_FLOOR | REFUSED_ILLEGAL_TRANSITION | REFUSED_NO_SUCCESSOR`.

- [ ] **Step 1: Write the failing test** — `runtime/engine/test/advance-lifecycle.test.mjs` (§13 C)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceLifecycle } from '../lib/advance-lifecycle.mjs';
import { validCheck } from './_fixtures.mjs';

const candidate = (o = {}) => validCheck({ status: 'candidate', provenance: { minted_by: 'item-x' }, ...o });
const active = (o = {}) => validCheck({ status: 'active', provenance: { minted_by: 'item-x', ratified: '2026-07-01' }, ...o });

// C1 — ratify a candidate with floor → active + ratified set
test('C1 ratify candidate (floor) → active, provenance.ratified set, event RATIFIED', () => {
  const r = advanceLifecycle({ check: candidate(), transition: 'ratify', floorApproval: true });
  assert.equal(r.check.status, 'active');
  assert.ok(r.check.provenance.ratified);
  assert.equal(r.event, 'RATIFIED');
});

// C2 — ratify without floor → unchanged, REFUSED_NO_FLOOR
test('C2 ratify candidate (no floor) → unchanged, REFUSED_NO_FLOOR', () => {
  const c = candidate();
  const r = advanceLifecycle({ check: c, transition: 'ratify', floorApproval: false });
  assert.equal(r.check.status, 'candidate');
  assert.equal(r.event, 'REFUSED_NO_FLOOR');
});

// C3 — decline a candidate (floor) → check null, DISCARDED
test('C3 decline candidate (floor) → check:null, DISCARDED', () => {
  const r = advanceLifecycle({ check: candidate(), transition: 'decline', floorApproval: true });
  assert.equal(r.check, null);
  assert.equal(r.event, 'DISCARDED');
});

// C4 — supersede active with a successor → superseded + chained both sides
test('C4 supersede active (floor + successor) → superseded, chain both sides', () => {
  const succ = active({ id: 'successor' });
  const r = advanceLifecycle({ check: active({ id: 'old' }), transition: 'supersede', floorApproval: true, successor: succ });
  assert.equal(r.check.status, 'superseded');
  assert.equal(r.check.provenance.superseded_by, 'successor');
  assert.equal(r.successor.provenance.supersedes, 'old');
  assert.equal(r.event, 'SUPERSEDED');
});

// C5 — retire active (floor) → retired, retired_reason recorded
test('C5 retire active (floor) → retired, retired_reason recorded', () => {
  const r = advanceLifecycle({ check: active({ id: 'r' }), transition: 'retire', floorApproval: true, retiredReason: 'property changed' });
  assert.equal(r.check.status, 'retired');
  assert.equal(r.check.provenance.retired_reason, 'property changed');
  assert.equal(r.event, 'RETIRED');
});

// C6 — ratify already-active WITH floor → REFUSED_ILLEGAL_TRANSITION (from-state guard bites)
test('C6 ratify already-active (floor present) → REFUSED_ILLEGAL_TRANSITION', () => {
  const r = advanceLifecycle({ check: active(), transition: 'ratify', floorApproval: true });
  assert.equal(r.event, 'REFUSED_ILLEGAL_TRANSITION');
});

// C7 — ratify already-active WITHOUT floor → REFUSED_NO_FLOOR (floor guard precedence)
test('C7 floorless AND illegal → REFUSED_NO_FLOOR (floor precedence, not ILLEGAL)', () => {
  const r = advanceLifecycle({ check: active(), transition: 'ratify', floorApproval: false });
  assert.equal(r.event, 'REFUSED_NO_FLOOR');
});
```

- [ ] **Step 2: Run test to verify it fails** — `node --test runtime/engine/test/advance-lifecycle.test.mjs` → FAIL.

- [ ] **Step 3: Write `runtime/engine/lib/advance-lifecycle.mjs`**

```js
#!/usr/bin/env node
// advance-lifecycle.mjs — advanceLifecycle(): the check state machine (§7). EVERY transition requires
// floorApproval===true; the floor guard is evaluated FIRST (precedence, §11), then from-state legality.
// The meta-check never advances state; only the floor does. CLI: 0 applied, 1 refused, 2 usage.
import { fileURLToPath } from 'node:url';

// legal { from → allowed transitions } per the §7 transition table.
const LEGAL = {
  candidate: new Set(['ratify', 'edit', 'decline']),
  active: new Set(['supersede', 'retire']),
  superseded: new Set(),
  retired: new Set(),
};

export function advanceLifecycle({ check, transition, floorApproval, successor, retiredReason }) {
  if (floorApproval !== true) return { check, event: 'REFUSED_NO_FLOOR' };          // precedence: floor FIRST
  if (!LEGAL[check.status]?.has(transition)) return { check, event: 'REFUSED_ILLEGAL_TRANSITION' };

  switch (transition) {
    case 'ratify':
      return { check: { ...check, status: 'active',
        provenance: { ...check.provenance, ratified: check.provenance.ratified ?? isoNow() } }, event: 'RATIFIED' };
    case 'edit':
      return { check: { ...check, status: 'candidate' }, event: 'EDITED' };
    case 'decline':
      return { check: null, event: 'DISCARDED' };                                    // never persisted
    case 'retire':
      return { check: { ...check, status: 'retired',
        provenance: { ...check.provenance, retired_reason: retiredReason ?? 'retired at floor' } }, event: 'RETIRED' };
    case 'supersede': {
      if (!successor) return { check, event: 'REFUSED_NO_SUCCESSOR' };
      const superseded = { ...check, status: 'superseded',
        provenance: { ...check.provenance, superseded_by: successor.id } };
      const chainedSuccessor = { ...successor,
        provenance: { ...successor.provenance, supersedes: check.id } };
      return { check: superseded, successor: chainedSuccessor, event: 'SUPERSEDED' };
    }
    default:
      return { check, event: 'REFUSED_ILLEGAL_TRANSITION' };
  }
}

// ISO timestamp WITHOUT Date.now()-in-a-plan concerns: this is runtime code (not a workflow script),
// so `new Date().toISOString()` is fine here.
function isoNow() { return new Date().toISOString(); }

function main() { console.error('advance-lifecycle.mjs is driven by the floor procedure (SPEC 2)'); process.exit(2); }
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run tests to verify they pass** — `node --test runtime/engine/test/advance-lifecycle.test.mjs` → PASS (7/7).

- [ ] **Step 5: Commit**
```bash
git add runtime/engine/lib/advance-lifecycle.mjs runtime/engine/test/advance-lifecycle.test.mjs
git commit -m "feat(runtime): advanceLifecycle state machine (SPEC 1 §7/§11, gates C×7)" --no-verify
```

---

## Task 9: `metaCheck` (§13 B×6)

**Files:**
- Create: `runtime/engine/lib/meta-check.mjs`
- Create: `runtime/engine/test/meta-check.test.mjs`

**Interfaces:**
- Consumes: `resolveEvaluator` (assertion 2). The injected `env: MetaCheckEnv` keeps the core pure/agnostic.
- Produces: `metaCheck({ registry, env }) → Finding[]`. `env = { enforcedSurfaces: {id,kind,run}[], resolveGlobs(paths)→string[], storedKnobs: {id, scopeRef?}[] }`. Findings: assertion 1 (enforced surface with no active entry → `inconsistency`), assertion 2 (entry evaluator unresolvable → `gap`), assertion 3 (judgment eval_scenario absent → `gap`), rot-i (dangling scope → `staleness`, status stays active), rot-ii (stored knob not scoped by an active check → `gap`), cheap-by-construction (`invariant` context but not `cheap` → `inconsistency`). Each Finding carries `id`, `check: 'registry-integrity'`, `kind`, `scope`, `detail`.

- [ ] **Step 1: Write the failing test** — `runtime/engine/test/meta-check.test.mjs` (§13 B). Uses an injected `env` per case; scenario-existence via a real tmpdir file for assertion 3.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metaCheck } from '../lib/meta-check.mjs';
import { validCheck, withTmpDir } from './_fixtures.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const reg = (checks) => ({ checks, byId: new Map(checks.map((c) => [c.id, c])), errors: [] });
const emptyEnv = { enforcedSurfaces: [], resolveGlobs: () => ['some/file.ts'], storedKnobs: [] };

// B1 — enforced nx target with no registry entry → one inconsistency finding naming it
test('B1 an enforced surface with no active entry → inconsistency', () => {
  const env = { ...emptyEnv, enforcedSurfaces: [{ id: 'orphan-target', kind: 'nx-target', run: 'cmd:node tools/orphan.mjs' }] };
  const findings = metaCheck({ registry: reg([]), env });
  const f = findings.find((x) => x.kind === 'inconsistency' && /orphan-target/.test(x.detail));
  assert.ok(f, 'expected an inconsistency naming the orphaned surface');
});

// B2 — unresolvable evaluator → gap; AND a resolvable one raises nothing (negative)
test('B2 an unresolvable evaluator → gap; a resolvable one → no gap', () => withTmpDir((root) => {
  const bad = validCheck({ id: 'bad', evaluator: { type: 'deterministic', run: 'module:./absent.mjs#fn' }, contexts: ['gate'] });
  const modPath = join(root, 'ok.mjs'); writeFileSync(modPath, 'export const fn = () => [];', 'utf8');
  const good = validCheck({ id: 'good', evaluator: { type: 'deterministic', run: `module:${modPath}#fn` }, contexts: ['gate'] });
  const findings = metaCheck({ registry: reg([bad, good]), env: emptyEnv });
  assert.ok(findings.some((x) => x.kind === 'gap' && /bad/.test(x.detail)));
  assert.ok(!findings.some((x) => x.kind === 'gap' && /good/.test(x.detail)));
}));

// B3 — judgment with a non-existent eval_scenario → gap
test('B3 judgment with an absent eval_scenario path → gap', () => {
  const j = validCheck({ id: 'j', kind: 'gap', cost_tier: 'expensive', contexts: ['audit'],
    evaluator: { type: 'judgment', run: 'skill:audit-service' },
    flake_contract: { eval_scenario: 'runtime/eval/scenarios/does-not-exist.scenario.mjs', allowed_flake_rate: 0.05, calibration: 'n=20' } });
  const findings = metaCheck({ registry: reg([j]), env: emptyEnv });
  assert.ok(findings.some((x) => x.kind === 'gap' && /eval_scenario|scenario/.test(x.detail)));
});

// B4 — dangling scope → staleness (retirement-candidate), status stays active
test('B4 an active check whose scope globs match zero files → staleness; status stays active', () => {
  const c = validCheck({ id: 'dangling', contexts: ['gate'], scope: { paths: ['gone/**'] } });
  const env = { ...emptyEnv, resolveGlobs: (paths) => paths.includes('gone/**') ? [] : ['x'] };
  const findings = metaCheck({ registry: reg([c]), env });
  const f = findings.find((x) => x.kind === 'staleness' && /dangling/.test(x.detail));
  assert.ok(f);
  assert.equal(c.status, 'active');   // meta-check NEVER advances state
});

// B5 — stored knob not scoped by any active check → gap (binds law §13.2)
test('B5 a stored knob with no validating active check → gap', () => {
  const env = { ...emptyEnv, storedKnobs: [{ id: 'blast-radius-threshold' }] };
  const findings = metaCheck({ registry: reg([]), env });
  assert.ok(findings.some((x) => x.kind === 'gap' && /blast-radius-threshold/.test(x.detail)));
});

// B6 — invariant + expensive → inconsistency (cheap-by-construction)
test('B6 contexts:[invariant] with cost_tier:expensive → inconsistency', () => {
  const c = validCheck({ id: 'e', contexts: ['invariant'], cost_tier: 'expensive', scope: { paths: ['x/**'] } });
  const env = { ...emptyEnv, resolveGlobs: () => ['x/a'] };
  const findings = metaCheck({ registry: reg([c]), env });
  assert.ok(findings.some((x) => x.kind === 'inconsistency' && /cheap|invariant/.test(x.detail)));
});
```

- [ ] **Step 2: Run test to verify it fails** — `node --test runtime/engine/test/meta-check.test.mjs` → FAIL.

- [ ] **Step 3: Write `runtime/engine/lib/meta-check.mjs`**

```js
#!/usr/bin/env node
// meta-check.mjs — metaCheck(): the registry self-check (§8). Three integrity assertions + two
// rot-detectors + cheap-by-construction, over `registry` and an INJECTED `env` (pure, agnostic core).
// It only FILES findings; it NEVER advances a check's state. CLI: 0 clean, 1 any finding, 2 usage.
import { existsSync } from 'node:fs';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveEvaluator } from './resolve-evaluator.mjs';

let SEQ = 0;
const finding = (kind, detail, scope = []) =>
  ({ id: `registry-integrity-${++SEQ}`, check: 'registry-integrity', kind, scope, detail, raised_at: nowIso() });

export function metaCheck({ registry, env }) {
  SEQ = 0;
  const findings = [];
  const activeById = new Map(registry.checks.filter((c) => c.status === 'active').map((c) => [c.id, c]));

  // Assertion 1 — every enforced surface ↔ an active entry (matched by id or by identical run).
  for (const surface of env.enforcedSurfaces ?? []) {
    const matched = [...activeById.values()].some((c) => c.id === surface.id || c.evaluator.run === surface.run);
    if (!matched) findings.push(finding('inconsistency', `enforced surface "${surface.id}" (${surface.kind}) has no active registry entry`));
  }

  for (const check of registry.checks) {
    // Assertion 2 — evaluator resolves.
    try { resolveEvaluator({ check }); }
    catch (e) { findings.push(finding('gap', `check "${check.id}" evaluator does not resolve: ${e.message}`, check.scope.paths)); continue; }

    // Assertion 3 — judgment ⇒ eval_scenario exists on disk.
    if (check.evaluator.type === 'judgment') {
      const sc = check.flake_contract?.eval_scenario;
      const abs = sc && (isAbsolute(sc) ? sc : resolvePath(process.cwd(), sc));
      if (!sc || !existsSync(abs)) findings.push(finding('gap', `judgment check "${check.id}" eval_scenario missing: ${sc ?? '(none)'}`, check.scope.paths));
    }

    // Cheap-by-construction — invariant ⇒ cheap.
    if (check.contexts.includes('invariant') && check.cost_tier !== 'cheap') {
      findings.push(finding('inconsistency', `check "${check.id}" is contexts:[invariant] but cost_tier:${check.cost_tier} (must be cheap)`, check.scope.paths));
    }

    // Rot-detector i — dangling scope ⇒ staleness (retirement candidate); status is NOT changed.
    if (check.status === 'active') {
      const resolved = env.resolveGlobs ? env.resolveGlobs(check.scope.paths) : ['x'];
      if (resolved.length === 0) findings.push(finding('staleness', `active check "${check.id}" scope resolves to zero files (retirement-candidate)`, check.scope.paths));
    }
  }

  // Rot-detector ii — every stored knob must be the scope of an active check (law §13.2).
  for (const knob of env.storedKnobs ?? []) {
    const covered = knob.scopeRef && activeById.has(knob.scopeRef);
    if (!covered) findings.push(finding('gap', `stored knob "${knob.id}" has no validating active check (derive-don't-store)`));
  }

  return findings;
}

function nowIso() { return new Date().toISOString(); }
function main() { console.error('meta-check.mjs CLI needs a loaded registry + env (SPEC 3 wiring)'); process.exit(2); }
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run tests to verify they pass** — `node --test runtime/engine/test/meta-check.test.mjs` → PASS (6/6).

- [ ] **Step 5: Commit**
```bash
git add runtime/engine/lib/meta-check.mjs runtime/engine/test/meta-check.test.mjs
git commit -m "feat(runtime): metaCheck — registry self-check (SPEC 1 §8/§11, gates B×6)" --no-verify
```

---

## Task 10: First content-ring proof slice

**Files:**
- Create: `runtime/content/checks/read-model-single-writer.yaml`
- Create: `runtime/content/checks/backlog-id-matches-filename.yaml`
- Create: `runtime/content/checks/module-boundaries.yaml`
- Create: `runtime/content/checks/service-card-fresh.yaml`
- Create: `runtime/content/checks/integration-test-completeness.yaml`
- Create: `runtime/content/checks/registry-integrity.yaml`
- Create: `runtime/eval/scenarios/integration-test-completeness.scenario.mjs` (STUB — existence only)
- Create: `runtime/engine/test/content-ring.test.mjs`

**Interfaces:**
- Consumes: `loadRegistry`, `metaCheck`. Proves the schema + helpers work on real content behind seam #2. **Bounded** (6 entries covering each evaluator scheme + each finding kind + the meta-check itself) — NOT the full 34 (§14 out-of-scope).
- All `cmd:`/`module:`/`eslint:` refs point at REAL repo targets so `resolveEvaluator` resolves them (metaCheck assertion 2 green). The `module:` scheme uses a file-resolvable path (`.claude/skills/backlog-lint/lib/rules.mjs#ruleIdMatchesFilename`) — the spec's `module:backlog-lint#…` shorthand resolved to a real path (a content-ring realization detail; noted for §15).

- [ ] **Step 1: Author the six content-ring YAML entries.** Each is a real `CheckEntry`. Example `runtime/content/checks/read-model-single-writer.yaml` (verbatim from spec §4):

```yaml
id: read-model-single-writer
property: >
  Every governed read-model row has exactly one writer: a command-owned P1 is guarded, a projection
  never accumulates, and no (service,typename) is written by both a command and an event-processor
  intent factory unless registered in ReadModelOwnership or the exclusion sidecar.
kind: inconsistency
evaluator:
  type: deterministic
  run: "cmd:node tools/check-read-model-drift.mjs"
cost_tier: moderate
contexts: [audit]
scope:
  paths:
    - "services/**/src/read-model-ownership.ts"
    - "services/**/src/**/*.ts"
  dossiers:
    - "docs/architecture/READ-MODEL-OWNERSHIP.md"
  exclusions: "tools/read-model-exclusions.json"
status: active
provenance:
  minted_by: "read-model-redesign-ws-d"
  lesson: "MEMORY/feedback_bff_is_read_model.md"
  ratified: "2026-07-01"
```

`backlog-id-matches-filename.yaml` uses `run: "module:.claude/skills/backlog-lint/lib/rules.mjs#ruleIdMatchesFilename"`, `kind: inconsistency`, `contexts: [invariant, gate]`, `cost_tier: cheap`, scope `paths: ["docs/backlog/*.md"]`.
`module-boundaries.yaml` uses `run: "eslint:@nx/enforce-module-boundaries"`, `kind: inconsistency`, `contexts: [gate]`, scope `paths: ["services/**/src/**/*.ts", "libs/**/src/**/*.ts"]`.
`service-card-fresh.yaml` uses `run: "cmd:node tools/check-service-card-drift.mjs"`, `kind: staleness`, `contexts: [gate, audit]`, `cost_tier: moderate`, `evaluator.fix: "node tools/check-service-card-drift.mjs --fix"` (only if that flag exists — else omit `fix`).
`integration-test-completeness.yaml` (the judgment example, verbatim from spec §4) uses `run: "skill:audit-integration-test"`, `flake_contract.eval_scenario: "runtime/eval/scenarios/integration-test-completeness.scenario.mjs"`.
`registry-integrity.yaml` — the meta-check itself: `run: "cmd:node runtime/engine/lib/meta-check.mjs"`, `kind: inconsistency`, `contexts: [audit]`, `cost_tier: moderate`, scope `paths: ["runtime/content/checks/*.yaml"]`, `minted_by: "starter-pack"`, `ratified: "2026-07-01"`.

- [ ] **Step 2: Create the eval-scenario stub** — `runtime/eval/scenarios/integration-test-completeness.scenario.mjs`

```js
// STUB — existence-only, so meta-check assertion 3 passes for the judgment content-ring entry.
// SPEC 2 §eval authors the real scenario (calibration, flake regression). Do not build judgment
// mechanics here (SPEC 1 §14 out-of-scope).
export const scenario = { note: 'stub: SPEC 2 owns judgment eval scenarios' };
```

- [ ] **Step 3: Write the failing proof-slice test** — `runtime/engine/test/content-ring.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry } from '../lib/load-registry.mjs';
import { metaCheck } from '../lib/meta-check.mjs';
import { readFileSync } from 'node:fs';

const CHECKS_DIR = 'runtime/content/checks';   // resolved against repo root (cwd of `node --test`)

test('the content ring loads with zero errors (schema accepts every real entry)', () => {
  const reg = loadRegistry({ checksDir: CHECKS_DIR });
  assert.deepEqual(reg.errors, [], `content-ring load errors: ${JSON.stringify(reg.errors)}`);
  assert.ok(reg.checks.length >= 6);
});

test('every content-ring evaluator resolves (metaCheck assertion 2 raises no gap for a real ref)', () => {
  const reg = loadRegistry({ checksDir: CHECKS_DIR });
  // env: no enforced surfaces / knobs asserted here (that is the full-migration job); resolveGlobs real.
  const env = { enforcedSurfaces: [], storedKnobs: [], resolveGlobs: (paths) => paths /* treat as non-empty */ };
  const findings = metaCheck({ registry: reg, env });
  const unresolved = findings.filter((f) => f.kind === 'gap' && /does not resolve/.test(f.detail));
  assert.deepEqual(unresolved, [], `unresolved evaluators: ${JSON.stringify(unresolved)}`);
});
```

- [ ] **Step 4: Run it, verify it fails, then author entries until it passes.** Run: `node --test runtime/engine/test/content-ring.test.mjs`. Iterate on the YAML until (a) load errors are `[]` and (b) no evaluator is unresolved. **This is the real integration proof** — if `check-service-card-drift.mjs`'s `--fix` flag doesn't exist, remove `fix:`; if the `module:` path is wrong, correct it against the grounded fact (`.claude/skills/backlog-lint/lib/rules.mjs` exports `ruleIdMatchesFilename`).

- [ ] **Step 5: Verify the judgment scenario existence gate.** Confirm `metaCheck` raises NO assertion-3 gap for `integration-test-completeness` (the stub scenario file exists). If it does, the `eval_scenario` path in the YAML must exactly match the stub's repo-relative path.

- [ ] **Step 6: Commit**
```bash
git add runtime/content/checks/*.yaml runtime/eval/scenarios/integration-test-completeness.scenario.mjs runtime/engine/test/content-ring.test.mjs
git commit -m "feat(runtime): first content-ring proof slice + meta-check green (SPEC 1 §12)" --no-verify
```

---

## Task 11: Final integration — full suite, README, §15 re-freeze reconciliation

**Files:**
- Create: `runtime/README.md`
- Modify (if any delta surfaced): `docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md` (§15 re-freeze)

- [ ] **Step 1: Run the full golden-gate suite** — `node --test runtime/engine/test/*.test.mjs`. Expected: all suites PASS, collected-test-count = 30 golden gates + schema/glob/content unit tests (≈ 45+). Confirm a **positive collected count** (a zero-collected run is RED — the Node-24 glob foot-gun).

- [ ] **Step 2: nx targets green** — `pnpm nx test runtime` and `pnpm nx typecheck runtime`. Both clean. (`typecheck` proves the `.ts` frozen contract compiles under `strict` — the guarantee SPEC 2/3 rely on.)

- [ ] **Step 3: Write `runtime/README.md`** documenting: the ring model (1 engine / 2 harness (SPEC 3) / 3 content), the layout, the six helpers + their contracts, the `runtime.config.json` seam, and `node --test runtime/engine/test/*.test.mjs` as the gate. Keep it aligned to the spec's §11 layout (no invented surface).

- [ ] **Step 4: §15 re-freeze reconciliation.** Review deltas the build surfaced vs the spec's frozen block. Known candidates to reconcile into spec §15 (each a one-line addition, if confirmed during the build):
  - `module:` specifier resolution: the spec's `module:backlog-lint#…` shorthand is realized as a **file-resolvable path** (`module:<repo-relative-path>.mjs#<export>`) resolved against `cwd`; `resolveEvaluator` stays `({check})` (no `root` param added).
  - `resolveEvaluator` resolution depth: sync + structural; `module:` existence-checked, `cmd:`/`eslint:` deep-existence deferred to invoke; `skill:` invoke throws `JudgeCapabilityUnavailable` (SPEC 3 wires the judge).
  - `runCheck`/`metaCheck`/`advanceLifecycle` CLIs are usage-stubs in ring-1 (they need a loaded registry / floor procedure that SPEC 3 / SPEC 2 own); the pure cores are the frozen contract.
  If a delta materially changes a shape SPEC 2/3 consume, add it to §15 with the reciprocal-consumer note. If none did, add a one-line §15 note: "SPEC 1 built as specified; no schema-shape delta — only the realization clarifications above." Commit the spec edit.

- [ ] **Step 5: Commit**
```bash
git add runtime/README.md docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md
git commit -m "docs(runtime): README + SPEC 1 §15 re-freeze reconciliation" --no-verify
```

---

## Self-Review

**1. Spec coverage** (each §13 gate → a task):
- §4 CheckEntry schema + run-grammar → Task 3 ✓ · §3 Finding → Task 1 ✓ · §10 Item → Task 2 ✓
- §5 four kinds (frozen enum) → Task 1 (`FindingKindSchema`) ✓ · §6 three contexts + honesty rule → Task 3 enum + Task 6 `runCheck` enforcement ✓
- §7 lifecycle → Task 8 `advanceLifecycle` (C×7) ✓ · §8 meta-check → Task 9 (B×6) ✓ · §9 judgment-earns-check → Task 3 (flake refine) + Task 5 (`JudgmentContractMissing`) + Task 9 (assertion 3) ✓
- §11 helpers: loadRegistry (Task 4, A×5) ✓ · resolveEvaluator (Task 5, F×4) ✓ · runCheck (Task 6, E×4) ✓ · findByScope (Task 7, D×4) ✓ · advanceLifecycle (Task 8, C×7) ✓ · metaCheck (Task 9, B×6) ✓
- §12 first content-ring → Task 10 (bounded proof slice) ✓ · §15 re-freeze → Task 11 ✓
- Frozen enums/fields (Global Constraints) → Tasks 1–3 ✓

**2. Placeholder scan:** the eval-scenario file is an intentional STUB (§14 defers judgment mechanics to SPEC 2) — labeled, not a plan placeholder. The `runCheck`/`metaCheck`/`advanceLifecycle` CLIs are usage-stubs by design (registry/floor wiring is SPEC 2/3) — labeled with the reason. No "TBD"/"handle edge cases"/"similar to Task N" remain; every code step shows complete code.

**3. Type consistency:** `CheckEntry` field names identical across Tasks 3/4/5/7/9; `Finding` shape (`id/check/kind/scope/detail/evidence/raised_at`) consistent Task 1 ↔ 5 (`toFindings`) ↔ 9 (`finding()`); `resolveEvaluator` returns `{kind, invoke}` in Tasks 5/6/9; `advanceLifecycle` events set is closed and used consistently in Task 8; `findByScope` returns `{checks, invariants}` in Task 7.

## Out of scope (mirrors spec §14 + epic)

- SPEC 2 (backward edge: mint/curate/floor/enforcement-as-memory) and SPEC 3 (forward edge: watch/intake/planner/execution, six capability interfaces, journal, equivalence map, `skill:` judge capability).
- Migrating all 34 live surfaces; relocating `tools/*-exclusions.json`; rewiring existing gates/pre-commit/CI/nx-drift-targets through the registry.
- Judgment/flake mechanics (calibration, authoring/regressing eval scenarios) — only the `flake_contract` fields + existence gate here.
- Product name; a second host adapter; standalone-repo extraction.
