---
id: dwc-snapshot-projector-drop-skip
status: parking
type: bug
notes: "DWC snapshot-projector returns `undefined` for the drop case; HandlerFn wants skip() — latent TS2769, nothing in nx pipeline compiles src/handlers"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# DWC snapshot-projector uses `return undefined` for the absent-version drop instead of `skip()`

`services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts` returns
`undefined` for the absent-version drop case in `projectIpSnapshot` /
`projectMarketSnapshot` / `projectLedgerSnapshot` (all three `if (typeof version !== 'number') return undefined;`).
But event-processor's `HandlerFn` (libs/event-processor/src/types/handler-config.ts) is
`(payload, ctx) => WriteIntent | WriteIntent[] | Promise<...>` — it does NOT permit
`undefined`. The canonical drop intent is `skip()` (returns `{ _tag: 'skip' }`), which the
sibling `mandate-projector.ts` in the SAME service already uses.

## Evidence
- `npx tsc --noEmit -p services/advisory/decision-workflow-ctrl/tsconfig.json` →
  `snapshot-projector.ts(139,3): error TS2769: No overload matches this call`
  (the `materializeToTable({ handlers })` call: the handler union resolves to
  `Promise<WriteIntent | undefined>`, not assignable to `HandlerEntry`).

## Why it's latent (nothing catches it today)
- The service has **no `build` target** in project.json.
- `typecheck` only includes `src/read-model-ownership.ts` + `test/types/**` (tsconfig.type-test.json).
- `test` runs ts-jest with `diagnostics: false`.
- So no nx target compiles `src/handlers`. Pre-existing on HEAD; unrelated to the
  event-subject dry-payload change (the `return undefined` lines are unchanged on HEAD).

## Fix
- Replace the three `return undefined;` with `return skip();` (import `skip` from
  `@nestfolio/event-processor`, as mandate-projector.ts does); change the function return
  types from `WriteIntent | undefined` to `WriteIntent`.
- Update the two `expect(result).toBeUndefined()` assertions in
  `test/unit/snapshot-projector.test.ts` (IP-snapshot drop + MARKET_SNAPSHOT drop) to assert
  `(intent)._tag === 'skip'`.
- Consider adding a `typecheck`/`build` target that actually compiles `src/**` so this class
  of latent handler-contract error is caught in the pipeline.
