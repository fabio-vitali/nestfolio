---
id: e2e-jest-modulenamemapper-auto-derive
status: parking
type: tooling
notes: "Surfaced 2026-06-10 by typed-subject-contracts-advisory (the advisory-contract-emission gate failed to LOAD until 12 advisory <svc>/contracts maps were hand-added to apps/e2e-feature-tests/jest.config.js). The e2e jest config uses a STATIC moduleNameMapper that must be hand-edited for every new `@nestfolio/<svc>/contracts` (or `/events`, `/domain`) subpath. lint + `tsc --noEmit` do NOT catch a missing map (they resolve via tsconfig.base.json `paths`, a different mechanism than jest's runtime moduleNameMapper), so the gap only surfaces at e2e RUN time — after a deploy. This recurred across the ledger/investor/execution/advisory typed-subject slices. Fix: derive the e2e jest moduleNameMapper from tsconfig.base.json `paths` via ts-jest's `pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/../../' })` so every `@nestfolio/*` subpath resolves automatically (the integration-testing jest configs may have the same static-list issue — sweep them too). Consider a create-e2e-test / create-event skill note flagging the jest-mapper step until auto-derive lands."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# e2e jest moduleNameMapper should auto-derive from tsconfig.base.json paths

`apps/e2e-feature-tests/jest.config.js` hand-lists each `@nestfolio/<svc>/contracts` (and
`/events`, `/domain`) module map. Adding a new subpath requires a manual edit there; `lint`
and `tsc --noEmit` pass without it (they use tsconfig `paths`), so a missing map only fails
at e2e RUN time — post-deploy, the most expensive place to discover it. This has bitten every
typed-subject slice.

Replace the static map with `pathsToModuleNameMapper(compilerOptions.paths, …)` from ts-jest
so all `@nestfolio/*` subpaths resolve from the single source of truth. Sweep the
integration-testing jest configs for the same pattern.

Promote when next touching the e2e/integration jest config, or when a new `/contracts`
subpath is being added (do it then to stop the recurrence).
