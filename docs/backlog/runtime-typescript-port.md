---
id: runtime-typescript-port
status: parking
type: refactor
notes: "Port runtime/** logic from untyped .mjs to full TypeScript (Node-24 zero-build); types at seams today, no compile-time check on 90 logic files."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
epic: runtime-self-hosting-debt
epic_role: core
---

# Port the runtime project to full TypeScript

**Current state (verified 2026-07-03):** `runtime/**` is a deliberate hybrid — **90 `.mjs`** logic files
(engine + adapters, untyped) + **24 `.ts`** files, of which only ~10 are the zod schema/contract files
(`engine/capabilities/index.ts`, `check/finding/journal/item.schema.ts`, the 5 backward schemas) that are
`strict`-checked via `tsc --noEmit`; the other ~14 `.ts` are `eval/` fixtures (intentional good/bad sample
data, correctly not checked). The `.mjs` logic imports the `.ts` schemas with explicit `.ts` extensions;
Node ≥24 strips types at runtime → **zero build**. Design rule today: *"types at the seams, plain JS in
the interior."*

**Why revisit:** the 90 logic files get **no compile-time type-checking** — wrong-arity/typo bugs are caught
only by `node --test`, not the compiler. The `backlog-id-matches-filename` crash fixed in
`runtime-make-it-fire` (a zero-arg call to a one-arg `ruleIdMatchesFilename(file)`) is the **poster child**
of exactly the bug class `tsc` would flag at the call site.

**Honest downside accounting (from the make-it-fire discussion):** the classic anti-TS arguments are mostly
**myths here** — full-TS under Node 24 is *also* zero-build, and liftability is ~identical (an erasable-syntax
`.ts` + zod runs build-free in any Node-24 repo; a tsconfig is only needed if the adopter wants to
type-check). The **REAL** remaining downsides are: (1) native-TS execution maturity/tooling (explicit `.ts`
import extensions, no runtime tsconfig path-aliases, coverage/debugger/eslint-parser config for stripped TS);
(2) the erasable-syntax constraint (no `enum`/`namespace`/param-properties); (3) one-time conversion churn +
bug-introduction risk on a working, test-covered layer; (4) mild `strict` friction at the dynamic seams
(argv parse, `spawnSync` results) — smaller than expected, since the parse-heavy code gets *nicer* with
`z.infer`. Counterweight: the rest of the repo (services/libs/CDK) is **already full TS**, so the runtime is
the odd `.mjs` island — converting is *consistency*, not divergence.

**Two candidate approaches (decide when promoted):**
- **Cheap middle path:** `// @ts-check` + JSDoc on the `.mjs` files + extend `tsc --noEmit` to cover them →
  compile-time checking of the logic, zero syntax churn, still zero build.
- **Full end-state:** convert `.mjs → .ts` (still zero-build under Node 24) → repo consistency + full typing,
  at the cost of the conversion churn + the erasable-subset discipline.

**Closure note:** captured member of `runtime-operationalization` — thematically the runtime subsystem, but
orthogonal to that epic's `done_when` (the runtime can be fully live/migrated/operational while `.mjs`), so
it rides along and never blocks epic closure. If still open at close, it spins out for reclustering.
