# w6 Governance Freeze — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, this session). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Land enforcement layers 3 (skill guidance) + 4 (audit drift-checker) of the read-model ownership model, scoped to the surface the model governs **today** (the migrated BFFs), so it runs green and prevents regression. The producer/cross-service surface is closed by the separate `read-model-ownership-producer-aggregates` program.

**Architecture:** A standalone static drift-checker (`tools/check-read-model-drift.mjs`, ESM, house style of `tools/check-no-appsync-literals.mjs`) parses the `ReadModelOwnership` augmentations into a typename→tag registry, scans intent-factory call sites + AppSync JS-resolver `__typename` writes, and errors on four drift classes over the **registered** surface. Exposed as an nx `read-model-drift` target on `event-processor`; invoked by the three audit skills. Layer-3 is doc edits to `create-*`, `testing-patterns`, and a `CLAUDE.md` pointer.

**Tech Stack:** Node 20 ESM, regex/string scanning (no AST dep — matches house style), nx `run-commands`, markdown skills.

**Scope guard:** w6 governs the **registered** surface only. Unregistered factory-written typenames are reported as a non-failing INFO list (visibility), NOT errored — they are the successor program's job. Structural-zero (schema field never written) stays prose guidance in the audit skills, not a scripted check.

---

## Task 1: Drift-checker — registry parse (TDD)

**Files:**
- Create: `tools/check-read-model-drift.mjs`
- Test: `tools/check-read-model-drift.test.mjs`

- [ ] **Step 1: Write failing test for registry parse.** A fixture dir with one `read-model-ownership.ts` containing `interface ReadModelOwnership { Foo: Projection<'P1'>; Bar: CommandOwned; Baz: Projection<'P2'>; }`. Assert `parseRegistry(root)` returns `{Foo:{tag:'P1'}, Bar:{tag:'CommandOwned'}, Baz:{tag:'P2'}}`.
- [ ] **Step 2: Run test, verify fails** (`node tools/check-read-model-drift.test.mjs`) — `parseRegistry is not a function`.
- [ ] **Step 3: Implement `parseRegistry`.** Find every `*.ts` containing `interface ReadModelOwnership`. For each `Typename: Projection<'Pn'>` capture tag `Pn`; for `Typename: CommandOwned` capture `CommandOwned`. Record source file per typename. Return map + a `conflicts` list (same typename, different tag, different file).
- [ ] **Step 4: Run test, verify passes.**
- [ ] **Step 5: Commit** (`feat(tools): read-model drift-checker — registry parse`).

## Task 2: Drift-checker — call-site + command scans (TDD)

**Files:** modify `tools/check-read-model-drift.mjs` + test.

- [ ] **Step 1: Write failing tests.** (a) `scanIntentCalls(root)` finds `projectVersioned('Foo', …)` but NOT `this.update(`, `z.record(`, `createHash().update(`, `.record(`. (b) `scanCommandWrites(root)` finds `__typename: 'DepositIntent'` in a `*.fn.js`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** `scanIntentCalls`: regex `/(?<![.\w])(projectVersioned|project|accumulate|update|updateOrRetry|record)\s*\(\s*['"]([A-Za-z0-9_]+)['"]/g` over `services/**/src/**/*.ts` excluding `**/test/**`. `scanCommandWrites`: regex `/__typename:\s*['"]([A-Za-z0-9_]+)['"]/g` over `services/**/src/graphql/js-function/**/*.fn.js`. Each yields `{typename, factory?, file, line}`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** (`feat(tools): read-model drift-checker — call-site + command scans`).

## Task 3: Drift-checker — the four rules (TDD)

**Files:** modify checker + test.

- [ ] **Step 1: Write failing tests**, one per rule, each a tiny fixture:
  - R1 accumulate-on-Projection: `accumulate('Foo'…)` + `Foo: Projection<'P1'>` → 1 error.
  - R2 P1-without-version-guard: `project('Foo'…)` + `Foo: Projection<'P1'>` → 1 error (P1 must use `projectVersioned`).
  - R3 dual-writer: `__typename:'Foo'` in a `.fn.js` + `update('Foo'…)` in a handler → 1 error; BUT `__typename:'Bar'` + only `record('Bar'…)` with `Bar: CommandOwned` → 0 errors (legit seed).
  - R4 registry conflict: `Foo` registered P1 in one file and P2 in another → 1 error.
  - clean fixture → 0 errors.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `evaluate(registry, calls, commands)`** returning `{errors:[], info:[]}`:
  - R1: `calls.filter(c => c.factory==='accumulate' && isProjection(registry[c.typename]))`.
  - R2: `calls.filter(c => registry[c.typename]?.tag==='P1' && c.factory!=='projectVersioned')`.
  - R3: for each typename in `commands`, if any `calls` entry has factory ∈ {project,projectVersioned,accumulate,update,updateOrRetry} → error (ongoing dual-authority). `record`-only event writes are the allowed seed path → no error.
  - R4: `registry.conflicts`.
  - INFO: factory-written typenames absent from `registry` (visibility for the successor program).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** (`feat(tools): read-model drift-checker — four drift rules`).

## Task 4: Drift-checker — CLI entry + nx target

**Files:** modify checker (add `main()` + `--root`), `libs/event-processor/project.json`.

- [ ] **Step 1: Add `main()`** that runs all scans over `--root` (default cwd), prints errors (red, `file:line — rule — typename`) and the INFO list, exits 1 on any error else 0. Mirror `check-no-appsync-literals.mjs` output style.
- [ ] **Step 2: Add nx target** to `libs/event-processor/project.json`:
  ```json
  "read-model-drift": {
    "executor": "nx:run-commands",
    "cache": true,
    "inputs": [
      "{workspaceRoot}/services/**/src/read-model-ownership.ts",
      "{workspaceRoot}/services/**/src/**/*.ts",
      "{workspaceRoot}/services/**/src/graphql/js-function/**/*.fn.js",
      "{workspaceRoot}/tools/check-read-model-drift.mjs"
    ],
    "options": { "command": "node tools/check-read-model-drift.mjs" }
  }
  ```
- [ ] **Step 3: Run `node tools/check-read-model-drift.mjs`** against the real repo. EXPECTED: 0 errors (audit confirms the registered surface is clean); INFO list shows the unregistered producer typenames (TimeTravelAvailability, LedgerSnapshot, DWC snapshots, Order, etc.).
- [ ] **Step 4: Run `pnpm nx run event-processor:read-model-drift`** — verify it wraps green.
- [ ] **Step 5: Commit** (`feat(tools): read-model-drift CLI + nx target`).

## Task 5: Layer-3 skill guidance

**Files:** `.claude/skills/{create-service,create-feature,create-event}/SKILL.md`, `.claude/skills/testing-patterns/SKILL.md`, `CLAUDE.md`.

- [ ] **Step 1: create-service / create-feature / create-event** — add a Checklist step: classify any new read row / event-written row as command-owned vs projection (P1/P2/P3) per `docs/architecture/READ-MODEL-OWNERSHIP.md`; register the typename in the service's `ReadModelOwnership` augmentation; use the matching intent factory (`projectVersioned` for P1, `record` for P2, `update`/`record`-seed for command-owned); never `accumulate` a projection.
- [ ] **Step 2: testing-patterns** — add a "Version-guard & stale-drop tests" subsection: use `expectVersionedWrite` / `expectStaleDrop` from `@nestfolio/test-support` to assert a P1 projection stamps `__version` and drops a stale/equal version (deduplicated, not redriven).
- [ ] **Step 3: CLAUDE.md** — under "Canonical Architecture References", add a pointer to `docs/architecture/READ-MODEL-OWNERSHIP.md` (the single source of truth for read-model ownership; consult before any BFF transform/projection or new read row).
- [ ] **Step 4: Commit** (`docs(skills): layer-3 read-model ownership guidance`).

## Task 6: Layer-4 audit hooks

**Files:** `.claude/skills/{audit-service,audit-domain,audit-system}/SKILL.md`.

- [ ] **Step 1: audit-service** — add a "Read-model ownership drift" verification check: run `node tools/check-read-model-drift.mjs` (or `pnpm nx run event-processor:read-model-drift`); additionally, prose check for structural-zero (a schema field in the BFF SDL that no transform/factory ever writes).
- [ ] **Step 2: audit-domain / audit-system** — add the same drift-checker invocation to their checklist (system-level: run once across all services; flag the INFO list of unregistered typenames as coverage gaps tracked by `read-model-ownership-producer-aggregates`).
- [ ] **Step 3: Commit** (`docs(skills): layer-4 audit drift-checker hooks`).

## Task 7: Validate + ship

- [ ] **Step 1:** `pnpm nx affected -t test,lint --base=origin/main` — green.
- [ ] **Step 2:** `node tools/check-read-model-drift.mjs` — 0 errors (the freeze runs clean over the migrated BFFs = w6 done-definition).
- [ ] **Step 3:** Set `docs/backlog/bff-readmodel-w6-governance-freeze.md` → `status: shipped`, fill `validation_gate`. `backlog-lint --fix`. Commit.
- [ ] **Step 4:** Route to `superpowers:finishing-a-development-branch` (merge to main), then `ExitWorktree`.

## Self-review notes
- No deploy / e2e: w6 is tooling+docs only — `detect-deploy-needed` should report skip. The drift-checker is static.
- Type-consistency: checker fn names — `parseRegistry`, `scanIntentCalls`, `scanCommandWrites`, `evaluate`, `main` — used consistently across tasks 1-4.
- The two zero-dependency fixes (TimeTravelAvailability, LedgerSnapshot) are NOT in w6 — they belong to `read-model-ownership-producer-aggregates` Tier 0; the checker surfaces them as INFO.
