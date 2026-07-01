# runtime/engine/backward — the backward edge (SPEC 2, the moat)

Two floor-gated procedures that turn a **lesson** into an enforced **check**, and retire a check when the
world moves on. This is the learning loop: the system's guards are grown and pruned by ratified decisions,
never by a silent heuristic. It **drives** SPEC 1's `advanceLifecycle` — it never re-implements lifecycle.

> Design: `docs/superpowers/specs/2026-07-01-runtime-spec-2-backward-edge.md` ·
> Plan: `docs/superpowers/plans/2026-07-01-runtime-spec-2-backward-edge-impl.md` ·
> Consumes SPEC 1 verbatim: `../schema/check.schema.ts`, `../lib/advance-lifecycle.mjs`, `../lib/meta-check.mjs`.

## The two procedures

- **mint** (`lib/mint.mjs` → `runMint`) — post-ship, a lesson that is *mechanizable · recurring · still-intended*
  is reduced to one deterministic property, **drafted** as a `candidate` check (`draft-candidate.mjs`),
  presented at the **floor** (`present-floor.mjs`), and on human **ratify** atomically **registered**
  (`register-ratified.mjs`): the eval scenario is landed, `advanceLifecycle('ratify')` flips it `active`,
  the YAML is persisted, and the lesson's `mints:` pointer is reconciled.
- **curate** (`lib/curate.mjs` → `runCurate`) — an obsolete guard is **retired** or **superseded** (or
  **kept**) at the floor (`curate-guard.mjs`). Triggered synchronously (a guard blocks a legitimate ship)
  or asynchronously (SPEC 1 `metaCheck` files a dangling-scope staleness finding). `keep` is a
  procedure-level **no-op** — it never touches `advanceLifecycle` (whose legal transitions have no `keep`).

Both procedures are **hard-floor**: in headless/`--auto` they **pause** (`<<HARNESS-PAUSE>>` sentinel) and
never self-ratify — lowering or raising a guard is always a human decision.

## Enforcement-as-memory

A lesson dossier carries a `mints:` list (`schema/mints-entry.ts`); each entry `{check, ratified, status}`
points at the check it grew. `reconcile-lesson.mjs` keeps it bidirectionally true with the registry:
ratify appends, retire flips to `retired`, supersede flips the old to `superseded` and appends the
successor `active`. The pointer is *first-ratified-wins* — the original ratification date is historical
truth, so re-touching an entry preserves its `ratified`. `test/content-ring.test.mjs` asserts the loop
closes both ways over the committed ring.

## Capability seams (`lib/capabilities.mjs`)

Two injected interfaces, headless-safe by default; SPEC 3 binds the real host-backed ones:

- **`ask`** — the floor. Headless default returns the pause sentinel and **never resolves a decision**.
- **`journal`** — an idempotency ledger. Atomic acts are keyed (`mint:<id>:ratify`, `curate:<id>:<transition>`)
  so a replayed procedure returns the recorded result instead of double-writing.

## Layout

```
backward/
  schema/     mints-entry · candidate-draft (leaves `ratified` UNSET) · floor-choice · floor-decision · eval-landing   (zod + z.infer)
  lib/        capabilities · present-floor · draft-candidate · land-eval-scenario · reconcile-lesson
              register-ratified (the atomic ratify unit) · curate-guard · mint (runMint) · curate (runCurate)
  dogfood/    lessons.mjs (the 5-lesson table, seam #2) · materialize.mjs (one-shot: runs the real mint over all 5)
  test/       node:test golden gates per helper + dogfood/supersede/retire proofs + content-ring reconciliation
```

## Ring discipline

`lib/` + `schema/` are **ring-1** (project- & harness-agnostic): they name no Nestfolio path. The Nestfolio
content — the 5 dogfood lessons, their generated checks (`../../content/checks/*.yaml`), scenarios
(`../../eval/scenarios/`), and the `tools/check-*.mjs` evaluators — is **ring-3, quarantined behind seam #2**
under `dogfood/`. The evaluators share one reusable walker (`tools/lib/text-scan.mjs`); each check is a thin
`findViolations` predicate + golden good/bad fixtures.

## Run

```
pnpm nx run runtime:test        # SPEC 1 + SPEC 2 (this subtree) golden gates
pnpm nx run runtime:typecheck   # .ts contract gate (noEmit, strict)
node runtime/engine/backward/dogfood/materialize.mjs   # re-emit the content ring from the mint procedure (idempotent)
```
