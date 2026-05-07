---
id: rename-nestfolio-integ-prefix-to-prefix
status: parking
type: refactor
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "Verbose NESTFOLIO_INTEG_ namespace is friction; rename atomically + sweep docs."
---

# Rename `NESTFOLIO_INTEG_PREFIX` env var to `PREFIX`

The verbose `NESTFOLIO_INTEG_` namespace is friction every time we run e2e/integration locally. Four code refs: `libs/test-support/src/context.ts:46,49,51,54`, `libs/test-support/test/context.test.ts` (8 occurrences), `apps/nestfolio-e2e/playwright.config.ts:18`, `apps/e2e-feature-tests/jest.global-teardown.ts:4`. Plus ~15 plan/skill docs reference it. Rename should be atomic + sweep all docs in same PR; deploy script already accepts `--prefix=<custom>` so no infra impact.
