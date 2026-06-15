---
id: advisory-stack-tests-investor-adpt-domain-resolution
status: shipped
type: bug
notes: "PRE-EXISTING on main (verified 2026-06-14 against origin/main 2a68da89 with --skip-nx-cache, real node_modules — NOT a go-live regression). Three advisory unit suites fail to run: advisory-bff / advisory-narrative-ctrl / portfolio-engine-ctrl `test/unit/service.stack.test.ts` all error `Cannot find module '@nestfolio/investor-adpt/domain' from '../decision-workflow-ctrl/src/domain/events.ts'`. Root: decision-workflow-ctrl/src/domain/events.ts:2 imports `InvestorCrossDomainEventTypes` from `@nestfolio/investor-adpt/domain`; these 3 services' service.stack.test.ts synth stacks that pull decision-workflow-ctrl events transitively, but their Jest moduleNameMapper/tsconfig paths lack a `@nestfolio/investor-adpt/domain` entry (compliance-ctrl + investor-bff resolve it fine because they import it directly). Likely a one-line jest config / tsconfig-paths addition per service (or a shared base-config fix). Surfaced by go-live-agent-wiring's P1 affected-test gate (the event-registry edits pulled these advisory services into the affected set). BLOCKS `pnpm nx run-many -t test` on any affected set that includes these 3 services. NOT e2e-blocking (unit-level). Relevant to typed-subject program (investor-adpt/domain is the cross-domain contract home)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: "Fixed in the go-live-agent-wiring workstream (commit 1d3a87bd) — folded in because it blocked this workstream's closing verify gate (user direction 2026-06-14: fix, don't park). Two-hop transitive chain: decision-workflow-ctrl/events → @nestfolio/investor-adpt/domain → @nestfolio/investor-bff/contracts. Added both moduleNameMapper entries to advisory-bff / advisory-narrative-ctrl / portfolio-engine-ctrl jest configs (additive only). Verified: advisory-bff 11/48, advisory-narrative-ctrl 13/69, portfolio-engine-ctrl 16/118 all green (--skip-nx-cache); compliance-ctrl/investor-bff/decision-workflow-ctrl regression green."
---

# Advisory service.stack unit tests can't resolve @nestfolio/investor-adpt/domain (pre-existing)

## Symptom (verified pre-existing on `main`)

```
FAIL services/advisory/advisory-bff/test/unit/service.stack.test.ts
FAIL services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts
FAIL services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts
  ● Test suite failed to run
    Cannot find module '@nestfolio/investor-adpt/domain' from '../decision-workflow-ctrl/src/domain/events.ts'
    > 2 | import { InvestorCrossDomainEventTypes } from '@nestfolio/investor-adpt/domain';
```

Reproduced on `origin/main` (`2a68da89`) with `pnpm nx run-many -t test -p advisory-bff,advisory-narrative-ctrl,portfolio-engine-ctrl --skip-nx-cache` and real (non-symlinked) `node_modules` — so it is NOT a worktree-symlink artifact and NOT introduced by the go-live workstream.

## Root cause (hypothesis)

The 3 advisory services' `service.stack.test.ts` synthesize CDK stacks that reference `decision-workflow-ctrl` event types. `decision-workflow-ctrl/src/domain/events.ts` imports `@nestfolio/investor-adpt/domain` (`InvestorCrossDomainEventTypes`). The importing services' Jest `moduleNameMapper` (and/or tsconfig `paths`) maps the workspace packages they import *directly*, but not the *transitive* `@nestfolio/investor-adpt/domain` reached only through decision-workflow-ctrl's source. `compliance-ctrl` and `investor-bff` pass because they import `@nestfolio/investor-adpt/domain` directly (so it's in their mapper).

## Fix (to confirm during a dedicated pass)

Add `@nestfolio/investor-adpt/domain` (and likely the sibling cross-domain `/domain` subpaths decision-workflow-ctrl re-exports) to the affected services' Jest moduleNameMapper — or, better, fix it once in the shared base jest/tsconfig-paths config so transitive workspace-subpath imports resolve everywhere. Then `pnpm nx run-many -t test -p advisory-bff,advisory-narrative-ctrl,portfolio-engine-ctrl` is green.

## Why parking (not queued)

Pre-existing, unrelated to go-live's purpose, and unit-level (does not affect whether the e2e suites pass). BUT it blocks `nx run-many -t test` for any affected set including these 3 services — including the go-live workstream's own closing verify gate. If it blocks this workstream's ship, fold the minimal fix in or fast-track it; otherwise it stands on its own.
