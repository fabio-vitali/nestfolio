---
id: a2-frontend-deps-lib
status: shipped
type: refactor
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_mfe_charter_migration.md
validation_gate: "Shell ⊇ every MFE is now identity verified across all 6 apps via emitted remoteEntry.json superset-check; closed pre-existing Pillar 2 violation."
closed: "2026-04-25"
notes: "New CJS-only lib exports sharedFrontendDeps singleton union; collapsed 6 federation.config.js files from ~38 to ~10 lines."
---

# A2 — `@nestfolio/frontend-deps` lib

SHIPPED 2026-04-25 on branch `feat/a2-frontend-deps-lib` (merge commit `3fabbf9c`): new CJS-only lib at `libs/frontend-deps/` exports `sharedFrontendDeps` (23-package singleton union including `@ag-ui/client` + `@copilotkitnext/angular`) + `sharedMappings`. All 6 `apps/*/federation.config.js` collapsed from ~38 lines to ~10 lines, each spreading the same constant.

**Shell ⊇ every MFE is now identity** — emitted `remoteEntry.json` superset-check verified across all 6 apps. Closed pre-existing Pillar 2 violation: shell lacked the 2 CopilotKit packages `onboarding-mfe` required.

Second ship in the MFE charter migration roadmap. Pnpm gotcha discovered + documented: apps have no per-app package.json, so workspace dep must be declared in root `package.json` devDependencies for pnpm to symlink.
