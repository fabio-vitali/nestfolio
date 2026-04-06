# Code Review: Integration Test Fixes (feat/integration-tests)

**Reviewer:** Claude Opus 4.6 (1M context)
**Date:** 2026-04-06
**Branch:** feat/integration-tests
**Scope:** 12 changed files fixing 2 failing integration test suites

---

## Overall Assessment

The implementation is solid. The fixes are genuine bugs surfaced by integration testing -- exactly what these tests are designed to find. The shared testing library is well-architected with clean separation of concerns. However, several fixes were applied only to the services under test, leaving identical bugs in other services.

---

## 1. Are Testing Utilities in the Right Location?

**Verdict: `libs/integration-testing/` is the correct home. Do NOT merge into `libs/event-processor/`.**

Rationale:

- `event-processor` is a **runtime** library. It is bundled into Lambda deployment packages (esbuild). Its exports are pipeline constructors (`materializeToTable`, `changeDataCapture`), intent helpers (`record`, `project`, `accumulate`), platform utilities, and domain types. Everything it exports runs inside Lambda containers in production.

- `libs/integration-testing/` is a **test-time** library. It creates and destroys real AWS resources (Cognito users, SQS queues, EB rules, Lambda functions, IAM roles). It is NEVER deployed. It runs in the Jest process on the developer's machine or CI runner.

- Merging them would: (a) bloat Lambda bundles with test-only AWS SDK imports (IAM, Cognito, CloudFormation, SQS queue management), (b) violate single responsibility -- event-processor would become both "how to handle events in Lambda" and "how to test the deployed infrastructure", (c) create a dependency cycle risk since integration-testing imports from services' domain types.

- `event-processor` already exports a focused `testing/` sub-module (`createTestHarness`, `fakeSqsRecord`, `fakeDdbStreamRecord`, `evaluateResolver`, `createAuthContext`). These are **unit test** harnesses that mock the pipeline internals. They belong there because they test event-processor's own abstractions. Integration testing fixtures test **deployed infrastructure**, which is a fundamentally different concern.

**Suggestion (nice to have):** Consider renaming `event-processor/testing/` to make the distinction even clearer -- perhaps `event-processor/unit-test-harness/` -- so there is zero ambiguity between the two testing approaches.

---

## 2. Are Generic Integration Testing Utils REALLY Generic?

**Verdict: One domain-specific concern leaks into shared code.**

### CRITICAL: `AppSyncClient` is hardcoded to `investor-bff`

File: `libs/integration-testing/src/fixtures/appsync-client.ts`, line 9:

```typescript
this.graphqlUrl = ctx.ssm.graphqlUrl('investor-bff');
```

This makes `AppSyncClient` unusable for testing `advisory-bff`, `dashboard-bff`, or `ledger-bff` -- all of which have AppSync Facade endpoints. The service name should be a constructor parameter:

```typescript
constructor(ctx: IntegrationContext, tokens: CognitoTokens, service: string = 'investor-bff') {
  this.graphqlUrl = ctx.ssm.graphqlUrl(service);
  this.idToken = tokens.idToken;
}
```

### All other fixtures: genuinely generic

- `EventBridgeClient` -- parameterized by bus name and target service. Good.
- `EventBusTrap` -- parameterized by bus name and detail type(s). Good.
- `TableAssertions` -- parameterized by table service name. Good.
- `MockApiFixture` -- creates disposable Lambda + Function URL. No domain knowledge. Good.
- `SsmOverrideFixture` -- parameterized by SSM path. Good.
- `CognitoFixture` -- uses SSM to discover the investor User Pool. This is acceptable since there is only one User Pool in the system (defined in investor-web), and all BFFs share it.
- `SsmCache` -- all methods are parameterized. `userPoolId()` and `userPoolClientId()` hardcode the investor path, but this is correct since the User Pool is a system singleton.
- `IntegrationContext` / `CleanupRegistry` -- pure infrastructure. Good.

---

## 3. Service Code Fixes Needing System-Wide Alignment

### CRITICAL: `custom:tenantId` vs `custom:tenant_id` -- 4 files still broken

The Cognito User Pool (investor-web/src/service.stack.ts line 69-71) defines:
```
customAttributes: { tenant_id: new StringAttribute({ mutable: false }) }
```

This means the JWT claim key is `custom:tenant_id` (snake_case). The fix correctly changed investor-bff and dashboard-bff check-auth files. But these files still use the WRONG `custom:tenantId` (camelCase):

| File | Status |
|------|--------|
| `services/investor/investor-bff/src/graphql/js-function/utils/check-auth.fn.js` | FIXED |
| `services/investor/dashboard-bff/src/graphql/js-function/utils/check-auth.fn.js` | FIXED |
| `services/advisory/advisory-bff/src/graphql/js-function/utils/check-auth.fn.js` | **BROKEN** |
| `services/ledger/ledger-bff/src/graphql/js-function/utils/check-auth.fn.js` | **BROKEN** |
| `libs/cdk-constructs/test/core/__fixtures__/check-auth.fn.js` | **BROKEN** (test fixture) |

Additionally, these TypeScript files in shared libs use the wrong claim key:

| File | Status |
|------|--------|
| `libs/event-processor/src/lambda/authorize-request.ts` (line 20) | **BROKEN**: reads `custom:tenantId` |
| `libs/event-processor/src/lambda/test-utils/evaluate-resolver.ts` (line 48) | **BROKEN**: sets `custom:tenantId` in test context |
| `libs/event-processor/test/lambda/authorize-request.test.ts` (line 7) | **BROKEN**: tests with `custom:tenantId` |
| `services/ledger/ledger-bff/test/handlers/graphql-resolver.test.ts` (lines 55, 96) | **BROKEN**: uses `custom:tenantId` |

**Impact:** Any BFF using `authorizeRequest()` (Lambda resolvers in ledger-bff for `getPortfolioAt` and `getSimulationComparison`) will fail with UNAUTHORIZED for every request.

### IMPORTANT: ParamsAndSecrets IAM grants pattern

The fix added `ssm:GetParameter` and `secretsmanager:GetSecretValue` grants to broker-alpaca-adpt's Ingress handler, OrderPollFn, and TransferPollFn. Currently broker-alpaca-adpt is the only service using `ParamsAndSecretsLayerVersion`. However, the design spec notes that ALL third-party adapters should use this pattern. When other adapters adopt it, they will need the same IAM grants. This is not a current bug, but a pattern to document.

### The `attributeValues` vs `item` fix -- correctly scoped

The fix to `initiate-deposit.fn.js` changed `attributeValues` to `item` inside a `ddb.put()` call. This is correct: the `@aws-appsync/utils/dynamodb` `put()` helper expects `item`, while the raw AppSync `TransactWriteItems.PutItem` operation uses `attributeValues`. All other resolvers that use `attributeValues` do so correctly within raw `TransactWriteItems` requests. No system-wide fix needed here.

### The `client_order_id` addition -- good practice, no system-wide concern

Adding `client_order_id` to Alpaca order submission is an idempotency improvement specific to the broker-alpaca-adpt service. The unit test was correctly updated. No propagation needed.

### The `staticConfig` flag in AlpacaClient -- well-designed

The dual-mode constructor (static config for unit tests, runtime SSM resolution for production) is clean. The `resolve()` method correctly re-reads baseUrl from SSM on each invocation (important for SSM override during integration tests with the 5s TTL), while caching secrets (which don't change). Good design.

---

## 4. Documentation and Memory Updates Needed

### CRITICAL: MEMORY.md has incorrect Cognito claim key

MEMORY.md (line in "Technical Notes") states:
> Cognito claim key: `custom:tenantId` (camelCase, not snake_case)

This is **wrong**. The User Pool defines `tenant_id` (snake_case), making the actual JWT claim `custom:tenant_id`. The memory note is actively misleading future sessions. Must be corrected to:
> Cognito claim key: `custom:tenant_id` (snake_case)

### IMPORTANT: project_integration_testing.md needs update

The topic file should document:
- The MockApiFixture Lambda Function URL permission fix (both `lambda:InvokeFunctionUrl` AND `lambda:InvokeFunction` needed for NONE auth)
- The SSM TTL interaction with SsmOverrideFixture (5s parameterStoreTtl means 6s wait is necessary)
- The merged test file pattern for broker-alpaca-adpt (single beforeAll deployment, single trap with multiple detail types)

### SUGGESTION: evaluate-resolver.ts `createAuthContext` should use correct claim

When the Cognito claim fix is applied to `evaluate-resolver.ts`, also update `createAuthContext` so that all unit tests using it will work correctly:
```typescript
claims: { 'custom:tenant_id': tenantId, 'sub': userId },
```

---

## 5. Additional Code Quality Observations

### Well done

- **Test consolidation:** Merging 3 separate broker-alpaca-adpt test files into one is the right call. Single mock deployment, single SSM override, single trap -- eliminates race conditions from parallel test files sharing SSM state.
- **EventBusTrap multi-type deploy:** The `detailType: string | string[]` API is clean and avoids needing separate traps per event type.
- **CleanupRegistry LIFO ordering:** Correct -- resources created last should be destroyed first.
- **Trailing slash strip on Function URL:** `urlResult.FunctionUrl!.replace(/\/+$/, '')` prevents double-slash in URL construction. Good defensive coding.

### Suggestion: EventBusTrap SQS policy ARN construction (line 89)

```typescript
Condition: {
  ArnEquals: { 'aws:SourceArn': `arn:aws:events:${this.ctx.region}:*:rule/${this.busArn!.split('/').pop()}/${this.ruleName}` },
}
```

Using `*` for the account ID works but is overly permissive. Since the integration context has access to the STS caller identity (or could), consider using the actual account ID for a tighter policy. Low priority since these are ephemeral test queues.

### Suggestion: MockApiFixture retry loop

The IAM propagation retry (lines 59-81) uses a linear backoff (`2000 * attempts`). Consider extracting a reusable `retryWithBackoff` utility since `SsmOverrideFixture` might need similar patterns for eventual consistency.

---

## Summary of Required Actions

| Priority | Action | Files |
|----------|--------|-------|
| CRITICAL | Fix `custom:tenantId` -> `custom:tenant_id` in 5 remaining files | advisory-bff/check-auth.fn.js, ledger-bff/check-auth.fn.js, cdk-constructs/test fixture, event-processor/authorize-request.ts, event-processor/evaluate-resolver.ts |
| CRITICAL | Fix `custom:tenantId` in authorize-request test + ledger-bff graphql-resolver test | 2 test files |
| CRITICAL | Correct MEMORY.md Cognito claim note | MEMORY.md |
| IMPORTANT | Make AppSyncClient service-parameterized | libs/integration-testing/src/fixtures/appsync-client.ts |
| IMPORTANT | Update project_integration_testing.md | memory topic file |
| SUGGESTION | Tighten EventBusTrap SQS policy account ID | libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts |
