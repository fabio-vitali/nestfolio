---
id: advisory-handler-type-narrowing-debt
status: parking
type: refactor
notes: "materializeToTable overload mismatch + intents missing on inferred handler return types across IP/MI/PE/AN advisory services"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: event-processor-api-hardening
epic_role: core
---

# Advisory handler type-narrowing debt (materializeToTable + intents)

Surfaced during Task 18 of `advisory-cycle-agent-precomputation-impl` (worktree HEAD `08140a8c`). The TS compiler reports real type errors in 4 advisory service handlers + their unit tests, but Jest's ts-jest runs in transpile-only mode so `pnpm nx test <project>` lets them through. `pnpm nx affected -t test,lint` was green in Task 17 despite these errors.

## Errors (verbatim from `pnpm tsc --noEmit -p services/advisory/<svc>/tsconfig.spec.json`)

**investor-profile-ctrl** (`event-listener.ts:136`):
```
error TS2769: No overload matches this call.
```
Plus 3 unit-test errors:
```
test/unit/event-listener.test.ts:103,197,232 — Property 'intents' does not exist on type 'SnapshotHandlerOutput'.
```

**market-intelligence-ctrl** (`event-listener.ts:141`):
```
error TS2769: No overload matches this call.
```
Plus 6 unit-test errors of the same `SnapshotHandlerOutput.intents` shape + 3 implicit-`any` on `i =>` arrow params.

**portfolio-engine-ctrl** (`event-listener.ts:189`):
```
error TS2769: No overload matches this call.
```

**advisory-narrative-ctrl** (`event-listener.ts:195`):
```
error TS2769: No overload matches this call.
```
Plus 3 unit-test errors `Property 'intents' does not exist on type 'GenerateNarrativeOutput'`.

## Why this isn't blocking the workstream ship

- Lambda handler files are bundled by **esbuild** (no typecheck) in `deploy.sh sandbox`; deploy succeeds.
- CDK synth only typechecks stack files (`service.stack.ts`), not handler files. The stack tests are green.
- Jest's ts-jest runs in transpile-only mode → unit tests run green at runtime; the assertions on `result.intents` work because the actual returned objects DO have `.intents`, even though the inferred return type narrows it away.
- Pre-existing baseline errors in `fallbacks.test.ts` + resilience tests are different from these — they were called out as baseline in Task 1.

## Cheapest next step

The `materializeToTable` call site needs the handler-map type to widen to `Promise<{ output, intents?: WriteIntent[] }>`. Likely fix:
1. Add an explicit return type annotation to `createHandlers` (or to each handler in the map): `Record<string, (p: EventPayload, c: EventContext) => Promise<{ output: Record<string, unknown>; intents?: WriteIntent[] }>>`.
2. OR: inspect `libs/event-processor/src/pipelines/materialize-to-table.ts:5-13` (the `MaterializeToTableConfig` shape) and widen the `handlers` field's expected handler return type.

The test-side fixes follow once the handler return type is widened — `result.intents` will then be defined-or-undefined per the union.

## Confirm before doing this
1. Whether `MaterializeToTableConfig` is the right place to widen, or whether the per-handler annotation is preferred (less invasive).
2. That widening doesn't break the pipeline runtime — the pipeline iterates `intents ?? []` so undefined is already handled.
3. The same fix lands cleanly across all 4 services (IP, MI, PE, AN) — they share the pattern.

## Why I didn't fix in-workstream

Workstream scope is "advisory cycle agent precomputation + callback symmetry". The type-narrowing issue exists across all 4 services because they all use the same `materializeToTable` pattern — a wider library-level cleanup. Doing it in-workstream would expand the blast radius and delay deploy. The validation gate (`pnpm nx affected -t test,lint`) is green because Jest doesn't typecheck; running the workstream's e2e tests on dev (Task 19) verifies runtime correctness independently.
