# Test Support Extraction — Design

**Date:** 2026-04-13
**Status:** Approved
**Author:** brainstorming session (Claude + fabio-vitali)

## 1. Purpose

Extract generic AWS test infrastructure from `libs/integration-testing` into a new `libs/test-support` library so that `apps/e2e-feature-tests` (and future test layers) import from the correct abstraction level. Today, the e2e suite imports `createIntegrationContext`, `EventBridgeClient`, `CognitoFixture`, and `AppSyncClient` from a lib scoped to per-service integration tests — coupling two independent test layers and creating naming confusion.

## 2. What Moves to `libs/test-support`

| Current file (in `integration-testing`) | Exports | Notes |
|---|---|---|
| `context.ts` | `createTestContext()`, `TestContext`, `TimingConfig` | Renamed from `createIntegrationContext` / `IntegrationContext` |
| `fixtures/cleanup-registry.ts` | `CleanupRegistry` | |
| `fixtures/ssm-cache.ts` | `SsmCache` | |
| `fixtures/event-bridge-client.ts` | `EventBridgeClient` | |
| `fixtures/cognito-fixture.ts` | `CognitoFixture`, `CognitoTokens` | |
| `fixtures/appsync-client.ts` | `AppSyncClient` | |

These are generic AWS test infrastructure utilities usable by any test layer — e2e, integration, or future layers.

## 3. What Stays in `libs/integration-testing`

| File | Exports | Why it stays |
|---|---|---|
| `fixtures/event-bus-trap.ts` | `EventBusTrap`, `CapturedEvent` | Creates ephemeral SQS queues + EB rules for event interception — per-service integration test pattern |
| `fixtures/table-assertions.ts` | `TableAssertions` | Polls DDB directly — violates e2e black-box philosophy |
| `fixtures/ssm-override-fixture.ts` | `SsmOverrideFixture` | Temporarily swaps SSM values — per-service config testing |
| `fixtures/mock-api-fixture.ts` | `MockApiFixture` | Creates temporary Lambda functions — per-service mock pattern |
| `fixtures/account-seeding-fixture.ts` | `AccountSeedingFixture` | Domain-aware (Execution/Account) seeding |
| `fixtures/ddb-seed-fixture.ts` | `DdbSeedFixture` | Direct DDB writes — per-service data setup |
| `resilience.ts` | `snapshotState`, `assertEquivalentState`, `stripDynamicFields`, `sortSnapshot`, `countItems` | Resilience test patterns tied to DDB state comparison |

`integration-testing` imports `TestContext` from `test-support` — it does NOT define its own context type. All integration-specific tools accept `TestContext` as their context parameter.

**No re-exports.** `integration-testing` does NOT re-export `test-support` symbols. If you import from `integration-testing`, you get integration-specific tools only.

## 4. Consumer Migration (all in one shot)

### `apps/e2e-feature-tests/` (~9 files)

- Change `from '@nestfolio/integration-testing'` → `from '@nestfolio/test-support'`
- Rename `IntegrationContext` → `TestContext`, `createIntegrationContext` → `createTestContext`
- Remove `@nestfolio/integration-testing` from `jest.config.js` `moduleNameMapper`; add `@nestfolio/test-support`

### `services/*/test/integration/` (~10 files)

- Rename `IntegrationContext` → `TestContext`, `createIntegrationContext` → `createTestContext`
- Split imports: generic utilities from `@nestfolio/test-support`, integration-specific tools from `@nestfolio/integration-testing`

### `tsconfig.base.json`

- Add `@nestfolio/test-support` path alias pointing to `libs/test-support/src/index.ts`
- Keep `@nestfolio/integration-testing` path alias (still exists, just smaller)

## 5. New Library Structure

```
libs/test-support/
├── project.json              # name: test-support, projectType: library, tags: [scope:platform, type:lib]
├── tsconfig.json
├── tsconfig.spec.json
├── jest.config.js            # unit tests for the utilities themselves (if any)
└── src/
    ├── index.ts              # re-exports public surface
    ├── context.ts            # createTestContext(), TestContext, TimingConfig
    └── fixtures/
        ├── cleanup-registry.ts
        ├── ssm-cache.ts
        ├── event-bridge-client.ts
        ├── cognito-fixture.ts
        └── appsync-client.ts
```

## 6. Resulting `libs/integration-testing` Structure

```
libs/integration-testing/
├── project.json
├── tsconfig.json
├── tsconfig.spec.json
├── jest.config.js
└── src/
    ├── index.ts              # exports integration-specific tools only
    ├── resilience.ts
    └── fixtures/
        ├── event-bus-trap.ts
        ├── table-assertions.ts
        ├── ssm-override-fixture.ts
        ├── mock-api-fixture.ts
        ├── account-seeding-fixture.ts
        └── ddb-seed-fixture.ts
```

`context.ts` is removed (moved to `test-support`). All files that referenced `IntegrationContext` now import `TestContext` from `@nestfolio/test-support`.

## 7. Decision Log

- **Naming:** `libs/test-support` — simple, broad, matches the role
- **No re-exports:** Clean separation. `integration-testing` does not re-export `test-support`.
- **All consumers updated in one shot:** No backward-compat shims. ~19 files touched.
- **Rename types:** `IntegrationContext` → `TestContext`, `createIntegrationContext` → `createTestContext` — reflects that both e2e and integration tests share the same context.
