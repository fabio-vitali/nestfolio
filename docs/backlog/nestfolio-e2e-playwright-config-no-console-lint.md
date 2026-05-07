---
id: nestfolio-e2e-playwright-config-no-console-lint
status: parking
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "Trivial fix — eslint-disable or process.stderr.write."
---

# `apps/nestfolio-e2e/playwright.config.ts:31` no-console lint error

Pre-existing `console.warn` in the CloudFront URL SSM lookup error path violates the `no-console` rule. Surfaced 2026-05-05 during integration-test bootstrap-uplift validation gate as the only failing project in `pnpm nx affected -t lint`. Trivial fix: either add `// eslint-disable-next-line no-console` (matches the test-infra precedent in `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts:178`) or replace with `process.stderr.write`. Out of scope for the bootstrap workstream — file-and-continue.
