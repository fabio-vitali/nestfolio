# Integration Test Alignment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align all services with bugs discovered during integration testing: Cognito claim key, AppSyncClient genericity, IAM grant patterns, and documentation corrections.

**Architecture:** 8 files still use `custom:tenantId` (camelCase) instead of the correct `custom:tenant_id` (snake_case) matching the Cognito User Pool schema. The AppSyncClient fixture hardcodes `investor-bff` preventing reuse. Memory/docs contain incorrect claim key info. All fixes are find-and-replace with test verification.

**Tech Stack:** AppSync JS resolvers, TypeScript, Jest, CDK, event-processor lib

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `services/advisory/advisory-bff/src/graphql/js-function/utils/check-auth.fn.js` | Fix claim key |
| Modify | `services/ledger/ledger-bff/src/graphql/js-function/utils/check-auth.fn.js` | Fix claim key |
| Modify | `libs/cdk-constructs/test/core/__fixtures__/check-auth.fn.js` | Fix claim key in test fixture |
| Modify | `libs/event-processor/src/lambda/authorize-request.ts:20` | Fix claim key in production code |
| Modify | `libs/event-processor/src/lambda/test-utils/evaluate-resolver.ts:48` | Fix claim key in test helper |
| Modify | `libs/event-processor/test/lambda/authorize-request.test.ts:7` | Fix claim key in test |
| Modify | `services/ledger/ledger-bff/test/handlers/graphql-resolver.test.ts:55,96` | Fix claim key in test mock |
| Modify | `libs/integration-testing/src/fixtures/appsync-client.ts:9` | Make service a required constructor param |
| Modify | `services/investor/investor-bff/test/integration/initiate-deposit.integration.test.ts:21` | Pass service to AppSyncClient |
| Modify | `~/.claude/projects/.../memory/MEMORY.md:57` | Correct claim key note |
| Modify | `~/.claude/projects/.../memory/project_request_context_migration.md:13,18` | Correct claim key note |
| Modify | `~/.claude/projects/.../memory/project_integration_testing.md` | Add lessons learned |

---

### Task 1: Fix Cognito claim key in event-processor (production + tests)

**Files:**
- Modify: `libs/event-processor/src/lambda/authorize-request.ts:20`
- Modify: `libs/event-processor/src/lambda/test-utils/evaluate-resolver.ts:48`
- Modify: `libs/event-processor/test/lambda/authorize-request.test.ts:7`

- [ ] **Step 1: Fix authorizeRequest production code**

In `libs/event-processor/src/lambda/authorize-request.ts`, line 20:

```typescript
// Before:
const tenantId = claimsMap?.['custom:tenantId'];
// After:
const tenantId = claimsMap?.['custom:tenant_id'];
```

- [ ] **Step 2: Fix createAuthContext test helper**

In `libs/event-processor/src/lambda/test-utils/evaluate-resolver.ts`, line 48:

```typescript
// Before:
claims: { 'custom:tenantId': tenantId, 'sub': userId },
// After:
claims: { 'custom:tenant_id': tenantId, 'sub': userId },
```

- [ ] **Step 3: Fix authorizeRequest unit test**

In `libs/event-processor/test/lambda/authorize-request.test.ts`, line 7:

```typescript
// Before:
...(tenantId && { 'custom:tenantId': tenantId }),
// After:
...(tenantId && { 'custom:tenant_id': tenantId }),
```

- [ ] **Step 4: Run event-processor tests**

Run: `pnpm nx test event-processor`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/lambda/authorize-request.ts libs/event-processor/src/lambda/test-utils/evaluate-resolver.ts libs/event-processor/test/lambda/authorize-request.test.ts
git commit -m "fix(event-processor): correct Cognito claim key to custom:tenant_id

custom:tenantId (camelCase) doesn't match the User Pool attribute
custom:tenant_id (snake_case), causing UNAUTHORIZED for all Lambda
resolvers using authorizeRequest()."
```

---

### Task 2: Fix Cognito claim key in advisory-bff and ledger-bff

**Files:**
- Modify: `services/advisory/advisory-bff/src/graphql/js-function/utils/check-auth.fn.js:4`
- Modify: `services/ledger/ledger-bff/src/graphql/js-function/utils/check-auth.fn.js:4`

- [ ] **Step 1: Fix advisory-bff check-auth**

In `services/advisory/advisory-bff/src/graphql/js-function/utils/check-auth.fn.js`, line 4:

```javascript
// Before:
const tenantId = ctx.identity?.claims?.['custom:tenantId'];
// After:
const tenantId = ctx.identity?.claims?.['custom:tenant_id'];
```

- [ ] **Step 2: Fix ledger-bff check-auth**

In `services/ledger/ledger-bff/src/graphql/js-function/utils/check-auth.fn.js`, line 4:

```javascript
// Before:
const tenantId = ctx.identity?.claims?.['custom:tenantId'];
// After:
const tenantId = ctx.identity?.claims?.['custom:tenant_id'];
```

- [ ] **Step 3: Run unit tests for both services**

Run: `pnpm nx run-many -t test -p advisory-bff,ledger-bff`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add services/advisory/advisory-bff/src/graphql/js-function/utils/check-auth.fn.js services/ledger/ledger-bff/src/graphql/js-function/utils/check-auth.fn.js
git commit -m "fix(advisory-bff,ledger-bff): correct Cognito claim key to custom:tenant_id"
```

---

### Task 3: Fix Cognito claim key in ledger-bff test mock and cdk-constructs fixture

**Files:**
- Modify: `services/ledger/ledger-bff/test/handlers/graphql-resolver.test.ts:55,96`
- Modify: `libs/cdk-constructs/test/core/__fixtures__/check-auth.fn.js:3`

- [ ] **Step 1: Fix ledger-bff graphql-resolver test mock**

In `services/ledger/ledger-bff/test/handlers/graphql-resolver.test.ts`:

Line 55 (inside the jest.mock authorizeRequest):
```typescript
// Before:
const tenantId = claimsMap?.['custom:tenantId'];
// After:
const tenantId = claimsMap?.['custom:tenant_id'];
```

Line 96 (inside buildEvent helper):
```typescript
// Before:
'custom:tenantId': tenantId,
// After:
'custom:tenant_id': tenantId,
```

- [ ] **Step 2: Fix cdk-constructs test fixture**

In `libs/cdk-constructs/test/core/__fixtures__/check-auth.fn.js`, line 3:

```javascript
// Before:
const tenantId = ctx.identity?.claims?.['custom:tenantId'];
// After:
const tenantId = ctx.identity?.claims?.['custom:tenant_id'];
```

- [ ] **Step 3: Run affected tests**

Run: `pnpm nx run-many -t test -p ledger-bff,cdk-constructs`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add services/ledger/ledger-bff/test/handlers/graphql-resolver.test.ts libs/cdk-constructs/test/core/__fixtures__/check-auth.fn.js
git commit -m "fix: correct Cognito claim key in test fixtures and mocks"
```

---

### Task 4: Deploy all affected BFF services

**Files:** None (infrastructure-only task)

- [ ] **Step 1: Verify no breaking changes in check-auth across the codebase**

Run: `grep -r "custom:tenantId" --include="*.ts" --include="*.js" services/ libs/`
Expected: NO matches (all should be `custom:tenant_id` now)

- [ ] **Step 2: Deploy affected services**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-bff,ledger-bff,investor-bff,dashboard-bff
```

Expected: All 4 stacks deploy successfully. The investor-bff and dashboard-bff were already deployed with the fix, but re-deploying ensures consistency.

- [ ] **Step 3: Verify integration tests still pass**

```bash
pnpm nx run investor-bff:test-integration
pnpm nx run broker-alpaca-adpt:test-integration
```

Expected: ALL PASS (5 tests total across 2 suites)

- [ ] **Step 4: Commit (no files — deployment verification only)**

No commit needed. Deployment is a runtime action.

---

### Task 5: Parameterize AppSyncClient (remove hardcoded investor-bff)

**Files:**
- Modify: `libs/integration-testing/src/fixtures/appsync-client.ts:8-9`
- Modify: `services/investor/investor-bff/test/integration/initiate-deposit.integration.test.ts:21`

- [ ] **Step 1: Make service a required constructor parameter**

In `libs/integration-testing/src/fixtures/appsync-client.ts`:

```typescript
// Before:
constructor(ctx: IntegrationContext, tokens: CognitoTokens) {
  this.graphqlUrl = ctx.ssm.graphqlUrl('investor-bff');
  this.idToken = tokens.idToken;
}

// After:
constructor(ctx: IntegrationContext, tokens: CognitoTokens, service: string) {
  this.graphqlUrl = ctx.ssm.graphqlUrl(service);
  this.idToken = tokens.idToken;
}
```

- [ ] **Step 2: Update investor-bff integration test to pass service name**

In `services/investor/investor-bff/test/integration/initiate-deposit.integration.test.ts`, line 21:

```typescript
// Before:
appsync = new AppSyncClient(ctx, tokens);
// After:
appsync = new AppSyncClient(ctx, tokens, 'investor-bff');
```

- [ ] **Step 3: Run investor-bff integration test**

Run: `pnpm nx run investor-bff:test-integration`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add libs/integration-testing/src/fixtures/appsync-client.ts services/investor/investor-bff/test/integration/initiate-deposit.integration.test.ts
git commit -m "refactor(integration-testing): make AppSyncClient service a required parameter

Removes hardcoded 'investor-bff' — each BFF test must explicitly
specify which service's GraphQL endpoint to use."
```

---

### Task 6: Correct memory and documentation

**Files:**
- Modify: `~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md:57`
- Modify: `~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_request_context_migration.md:13,18`
- Modify: `~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_integration_testing.md`

- [ ] **Step 1: Fix MEMORY.md claim key note**

Line 57, change:
```
- Cognito claim key: `custom:tenantId` (camelCase, not snake_case)
```
To:
```
- Cognito claim key: `custom:tenant_id` (snake_case) — verified from User Pool schema at investor-web/src/service.stack.ts
```

- [ ] **Step 2: Fix project_request_context_migration.md**

Line 13, change:
```
- Cognito claim key: `custom:tenantId` (camelCase, not snake_case)
```
To:
```
- Cognito claim key: `custom:tenant_id` (snake_case) — verified from User Pool schema
```

Line 18, change the last sentence:
```
The Cognito claim for tenant is `custom:tenantId` (camelCase).
```
To:
```
The Cognito claim for tenant is `custom:tenant_id` (snake_case).
```

- [ ] **Step 3: Add integration testing lessons learned to project_integration_testing.md**

Append a new section to the file:

```markdown
## Lessons Learned (2026-04-06)

### MockApiFixture: Lambda Function URL permissions
Both `lambda:InvokeFunctionUrl` (with FunctionUrlAuthType NONE condition) AND `lambda:InvokeFunction` (without condition) are required for NONE auth Function URLs to work. The trailing slash from Function URL must be stripped to avoid double-slash paths.

### SsmOverrideFixture + ParamsAndSecrets Extension interaction
The extension's `parameterStoreTtl` (configured at 5s on broker-alpaca-adpt) means the SsmOverrideFixture must wait at least TTL+1s after overriding. The handler's SSM client must NOT permanently cache the baseUrl — it should re-read from the extension on each invocation (the extension handles caching).

### Test file consolidation for SSM-overriding services
When multiple test files override the same SSM parameter (like broker-alpaca-adpt's Alpaca baseUrl), they MUST be merged into a single file with one mock deployment. Separate files cause: (1) SSM TooManyUpdates from concurrent overrides, (2) stale mock URLs when Lambda containers cache between test file runs, (3) in-memory mock state loss across Lambda containers.

### Cognito claim key: `custom:tenant_id`
The User Pool defines `tenant_id` (snake_case). JWT claims use the exact attribute name: `custom:tenant_id`. All check-auth.fn.js files and authorizeRequest() must use snake_case.

### AppSync JS resolver `ddb.put()` API
The `@aws-appsync/utils/dynamodb` `put()` helper expects `item` (not `attributeValues`). Raw `TransactWriteItems` operations use `attributeValues` with `util.dynamodb.toMapValues()` — these are different APIs.

### ParamsAndSecrets IAM grants
The Ingress construct grants DDB + EventBridge permissions. SSM GetParameter and Secrets Manager GetSecretValue must be added explicitly when using the ParamsAndSecrets Extension. Pattern: define shared PolicyStatements array, apply to all Lambdas that use the extension.
```

- [ ] **Step 4: No commit needed** (memory files are outside git)

---

## Summary

| Task | What | Risk if skipped |
|------|------|-----------------|
| 1 | Fix event-processor authorizeRequest claim key | ledger-bff Lambda resolvers return UNAUTHORIZED for all users |
| 2 | Fix advisory-bff + ledger-bff check-auth claim key | All GraphQL mutations on these BFFs return UNAUTHORIZED |
| 3 | Fix test fixtures/mocks | Tests pass with wrong claim key, masking the bug |
| 4 | Deploy 4 BFF services | Production stays broken despite code fix |
| 5 | Parameterize AppSyncClient | Cannot write integration tests for advisory-bff, dashboard-bff, ledger-bff |
| 6 | Correct memory + docs | Future sessions repeat the wrong claim key |
