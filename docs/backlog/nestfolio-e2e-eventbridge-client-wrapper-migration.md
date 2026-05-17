---
id: nestfolio-e2e-eventbridge-client-wrapper-migration
status: parking
type: refactor
notes: "apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts is the lone file in the Playwright app that imports @aws-sdk/client-eventbridge directly — migrate to EventBridgeClient from @nestfolio/test-support for consistency with the Jest e2e app."
references:
  - apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts
  - libs/test-support/src/fixtures/event-bridge-client.ts
  - apps/e2e-feature-tests/src/advisory/accept-decision.e2e.test.ts
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Migrate nestfolio-e2e's inject-advisory-update.ts to test-support EventBridgeClient wrapper

## Evidence

Audited all `@aws-sdk/*` imports across `apps/nestfolio-e2e/src` (12 files: 2 spec files, 1 journey spec, 4 fixtures, 5 page objects). Only one direct SDK import:

```
apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts:1
  import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
```

The file has three helpers (`injectAdvisoryTriggerEvent`, `injectAdvisoryBffTriggerEvent`, `injectDashboardBffTriggerEvent`) that each instantiate a raw `EventBridgeClient`, build a `PutEventsCommand`, and inspect `result.Entries?.[0]?.ErrorMessage` — duplicating the plumbing already in `@nestfolio/test-support`'s `EventBridgeClient.putEvent()` (`libs/test-support/src/fixtures/event-bridge-client.ts:56`).

The rest of the app already routes through test-support / e2e-feature-tests:
- `TestContext` from `@nestfolio/test-support`
- `CognitoTokens` from `@nestfolio/test-support`
- `freshTenant` (which uses `CognitoFixture` internally) from `@nestfolio/e2e-feature-tests`
- `bffClient`, `waitForGraphQL`, `AgentTraceTrap` from `@nestfolio/e2e-feature-tests`

## Cheapest next step

Replace the imports + the three call sites with `new EventBridgeClient(ctx).putEvent({ ... })`. Drop the `@aws-sdk/client-eventbridge` dependency from `apps/nestfolio-e2e/package.json` if no other file pulls it. Re-run the Playwright suite to verify the migration is behavior-preserving.

## Out of scope

(none — single file migration)
