# Derived-doc regeneration — path mapping

Used by `detect-doc-derivation.mjs`. Defines which changed paths require regenerating derived documentation BEFORE the source change is committed (or, in a multi-commit workstream, before the next phase begins).

## Mapping table

| Touched path | Regen actions |
|---|---|
| `services/<svc>/infrastructure/<svc>.stack.ts` (or any file under `services/<svc>/infrastructure/`) | `generate-c4-diagrams` (full pipeline) + `audit-service <svc>` |
| `services/<svc>/domain/events.ts` | Identify affected `flows/*.flow.yaml` (grep for `<svc>` references), regen via `generate-flow-spec`, then `validate-flow` |
| `services/<svc>/src/event-listener.ts` (subscription config changed) | Same as above — flow spec regen + validate |
| `services/<svc>/**` (any other file under the service) | `audit-service <svc>` |
| New service folder created (didn't exist on `origin/main`) | `generate-c4-diagrams` + `audit-service <svc>` + flow spec coverage + `audit-system` (cross-domain consistency) |
| Cross-domain adapter rules changed (`services/*-adpt/**`) | All affected `.flow.yaml` regen + `audit-domain` on the consumer-side domain |
| `apps/investor-web/<mfe>/**` (substantive change, not lockfile/style) | MFE service card regen (if present) |
| `flows/*.flow.yaml` (hand-edited) | `validate-flow` against current code — these ARE the spec, not derived from it |
| `libs/<lib>/**` | None automatic. Only the consumers' service cards if their behavior changed — agent judgment. |

## What does NOT require regen

- `docs/**` itself (these ARE the derived files, not their source)
- `apps/e2e-feature-tests/**`, `apps/nestfolio-e2e/**` (test code, no derived docs)
- `.claude/**` (skills regenerate manually when changed)
- Test files within services (`services/*/test/**`)
- Project config: `package.json`, `tsconfig.json`, `project.json`, `nx.json`

## Commit discipline

Source changes and their derived regen belong in the same workstream / PR. Two acceptable patterns:

1. **Pre-final-commit batch** (default): accumulate source changes, run derivation once before the ship commit. Single regen commit. Cleaner workstream rhythm.
2. **Per-commit regen**: regenerate after each source commit. Cleaner per-commit diffs; more work. Required if a mid-workstream deploy needs the regen to validate.

Either is fine — pick by context. The non-negotiable: source and derived must ship together (same PR). Splitting them across PRs lets the doc layer drift, which is exactly what these mappings exist to prevent.

## Honest limit

Derivation skills can surface inconsistencies the agent must resolve (e.g., `audit-service` flagging a service card section that no longer matches code). Do not auto-execute the skills blindly — run them, read the output, decide what to do with any flags raised, then commit.
