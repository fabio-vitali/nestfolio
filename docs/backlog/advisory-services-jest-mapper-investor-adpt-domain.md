---
id: advisory-services-jest-mapper-investor-adpt-domain
status: parking
type: bug
notes: "Pre-existing: advisory service.stack jest tests can't resolve @nestfolio/investor-adpt/domain (missing static moduleNameMapper entry); masked by nx cache / absent CI. Not caused by + unrelated to broker-funding-completed-normalization-drift."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Advisory service.stack jest tests can't resolve `@nestfolio/investor-adpt/domain`

Surfaced 2026-06-14 by the `broker-funding-completed-normalization-drift` Task-9 full-affected `nx run-many -t test,lint` (the funding change brought the advisory services into the affected set, so their tests ran fresh instead of being nx-cache-masked).

## Symptom

`nx test advisory-bff`, `nx test advisory-narrative-ctrl`, `nx test portfolio-engine-ctrl` fail in their `service.stack` tests with:

```
Cannot find module '@nestfolio/investor-adpt/domain' from '../decision-workflow-ctrl/src/domain/events.ts'
```

The service.stack tests CDK-synth a stack that transitively imports `decision-workflow-ctrl/src/domain/events.ts`, which does `import { InvestorCrossDomainEventTypes } from '@nestfolio/investor-adpt/domain'` (line 2). Those advisory services' jest `moduleNameMapper` is a STATIC per-subpath list that has no `@nestfolio/investor-adpt/domain` entry, so jest can't resolve it at run time (tsc resolves it fine via `tsconfig.base.json` paths — a different mechanism).

## Why it's pre-existing (NOT this workstream)

- `git diff origin/main..<funding-branch> --name-only` touches NONE of decision-workflow-ctrl, advisory-bff, advisory-narrative-ctrl, portfolio-engine-ctrl, investor-adpt, or any of their jest configs.
- The offending import (`decision-workflow-ctrl/events.ts` → `investor-adpt/domain`) is present verbatim on `origin/main` (`git show origin/main:.../events.ts`).
- So `nx test advisory-bff` fails the same on a clean `origin/main`; it has been masked by nx caching + the absence of a green CI run (see `ci-pipeline-bring-up`).

## Fix surface

Add the `@nestfolio/investor-adpt/domain` entry (and audit for other missing `@nestfolio/*` subpaths) to the static `moduleNameMapper` of every advisory jest config that synths a stack importing it (advisory-bff, advisory-narrative-ctrl, portfolio-engine-ctrl, and likely decision-workflow-ctrl itself). Better: derive the jest `moduleNameMapper` from `tsconfig.base.json` `paths` via `pathsToModuleNameMapper` so new subpaths resolve automatically — this is the SAME root cause as [[e2e-jest-modulenamemapper-auto-derive]] but for the integration/unit jest configs. Consider folding both into one "auto-derive jest moduleNameMapper from tsconfig paths workspace-wide" pass.

Not blocking the broker-funding workstream (which is execution-domain only; all execution + e2e-app targets pass). Promote alongside `e2e-jest-modulenamemapper-auto-derive` or `ci-pipeline-bring-up` (so the first green CI run isn't red on this).
