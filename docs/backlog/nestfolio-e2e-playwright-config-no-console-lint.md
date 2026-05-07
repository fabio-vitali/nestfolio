---
id: nestfolio-e2e-playwright-config-no-console-lint
status: shipped
rank: null
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: "pnpm nx run nestfolio-e2e:lint → All files pass linting"
notes: "Shipped 2026-05-07 — added // eslint-disable-next-line no-console comment matching the libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts:178 precedent."
---

# `apps/nestfolio-e2e/playwright.config.ts:31` no-console lint error

Pre-existing `console.warn` in the CloudFront URL SSM lookup error path violated the `no-console` rule. Surfaced 2026-05-05 during integration-test bootstrap-uplift validation gate as the only failing project in `pnpm nx affected -t lint`.

**Shipped 2026-05-07.** Added `// eslint-disable-next-line no-console` above the `console.warn` call (matches the test-infra precedent in `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts:178`). The `console.warn` is the right behavior — it's a non-fatal warning during config evaluation and there's no logger available at that scope. `pnpm nx run nestfolio-e2e:lint` passes.
