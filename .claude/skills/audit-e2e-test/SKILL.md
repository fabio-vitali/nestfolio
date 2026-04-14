---
name: audit-e2e-test
description: Verify E2E feature test coverage, convention compliance, and configuration correctness. Use to check coverage gaps, anti-patterns, and configuration issues in apps/e2e-feature-tests.
---

## When This Skill Applies
- After writing a new E2E scenario (post-write verification)
- Checking E2E coverage gaps across feature domains
- Called by `audit-system` during system-level sweeps
- Periodic health check of the E2E test suite

## Configuration Checks

| # | Check | Severity | How to Check |
|---|-------|----------|-------------|
| 1 | `jest.config.js` exists with correct `testMatch`, `testTimeout: 300_000`, `maxWorkers: 1` | Hard fail | Read `apps/e2e-feature-tests/jest.config.js` |
| 2 | `test-e2e-features` target exists in `project.json` with `NODE_OPTIONS: --experimental-vm-modules` | Hard fail | Read `apps/e2e-feature-tests/project.json` |
| 3 | `globalTeardown` points to `jest.global-teardown.ts` | Warning | Check `jest.config.js` |
| 4 | `moduleNameMapper` covers all service event imports used in test files | Hard fail | Grep `*.e2e.test.ts` and `helpers/fixtures.ts` for `@nestfolio/*/events` imports; verify each has a mapper entry |
| 5 | `src/index.ts` barrel exports all helpers and fixtures | Warning | Compare exports in `src/index.ts` against files in `src/helpers/` |

## Convention Checks

| # | Check | Severity | How to Check |
|---|-------|----------|-------------|
| 1 | Every test uses `createTestContext()` from `@nestfolio/test-support` | Hard fail | Grep `*.e2e.test.ts` for `createTestContext` — must appear in every `beforeEach` |
| 2 | Every test uses `freshTenant()` (not manual CognitoFixture) | Hard fail | Grep for `new CognitoFixture` in test files — must NOT appear; only `freshTenant()` |
| 3 | Every test calls `ctx.cleanup.runAll()` in `afterEach` | Hard fail | Grep `*.e2e.test.ts` for `cleanup.runAll` — must appear in every `afterEach` |
| 4 | Timeout hierarchy: `beforeEach` ≥ 120_000, `afterEach` = 60_000 | Warning | Parse timeout arguments from `beforeEach(..., N)` and `afterEach(..., N)` |
| 5 | All assertions use BFF GraphQL (no DDB reads in test bodies) | Hard fail | Grep `*.e2e.test.ts` for `GetCommand`, `QueryCommand`, `ScanCommand`, `DynamoDBClient` — must NOT appear in test files (only in `helpers/fixtures.ts` where `funded()` polls DDB as a fixture, not an assertion) |
| 6 | Fixture composition via `applyFixtures()` in `beforeEach` (not in `it()`) | Warning | Grep for `applyFixtures` — must only appear inside `beforeEach` blocks |
| 7 | Tenant prefix is `e2e-` (not `integ-`) | Hard fail | Verify `freshTenant()` replaces prefix; grep test files for hardcoded `integ-` strings |
| 8 | No imports from `@nestfolio/integration-testing` | Hard fail | Grep all files for `@nestfolio/integration-testing` — must NOT appear |
| 9 | No `describe.skip` without documented reason | Warning | Grep for `describe.skip` — each must have an adjacent comment explaining why |
| 10 | No `waitForGraphQL` wrapped in try/catch | Hard fail | Grep for `try.*waitForGraphQL` or `catch` blocks around `waitForGraphQL` calls in test files |

## Coverage Checks

### Step 1: Identify Coverable Flows

Enumerate user-facing flows by scanning BFF Facade schemas:

```
For each BFF service (investor-bff, advisory-bff, ledger-bff, dashboard-bff):
  1. Read services/{domain}/{bff}/src/facade/resolvers/ — list all mutations
  2. Read flow specs in flows/*.flow.yaml — extract user-triggered flows
  3. Cross-reference with existing scenarios in apps/e2e-feature-tests/src/
```

### Step 2: Classify Each Flow

| Status | Criteria |
|--------|----------|
| **TESTED** | A `.e2e.test.ts` file exercises the flow's trigger (mutation or event) and asserts at least one downstream effect via `waitForGraphQL` |
| **UNTESTED** | No scenario covers this flow |
| **INFEASIBLE** | The flow cannot be tested end-to-end due to a known design gap (document the reason) |
| **SKIPPED** | A `describe.skip` exists — document why |

### Step 3: Produce Coverage Matrix

```
| Domain | Flow | Trigger | Status | Test File | Notes |
|--------|------|---------|--------|-----------|-------|
| Funding | Deposit | initiateDeposit mutation | TESTED | fund-account.e2e.test.ts | |
| Funding | Withdraw | requestWithdrawal mutation | TESTED | withdraw-cash.e2e.test.ts | |
| Advisory | First Decision | MANDATE_CREATED event | TESTED | first-decision.e2e.test.ts | |
| ... | ... | ... | ... | ... | ... |
```

### Step 4: Identify Coverage Gaps

List untested flows ordered by priority:
1. **Critical path** flows (onboarding, funding, trading) — must be tested
2. **Decision cycle** flows (confirm, reject, explain) — should be tested
3. **Read-only** flows (view portfolio, view history) — nice to have
4. **Admin/internal** flows — lower priority

## Grading

| Grade | Criteria |
|-------|----------|
| **EXEMPLARY** | All critical + decision-cycle flows tested, no anti-patterns, all convention checks pass |
| **GOOD** | All critical flows tested, ≤2 convention warnings, no hard fails |
| **PARTIAL** | >50% of critical flows tested, ≤1 hard fail |
| **MINIMAL** | <50% critical flow coverage or multiple hard fails |
| **MISSING** | No E2E test scenarios exist |

## Report Format

```markdown
## E2E Feature Test Audit

**Grade: {GRADE}**

### Configuration
| Check | Status | Detail |
|-------|--------|--------|
| jest.config.js | PASS/FAIL | ... |
| ... | ... | ... |

### Conventions
| Check | Status | Detail |
|-------|--------|--------|
| createTestContext usage | PASS/FAIL | ... |
| ... | ... | ... |

### Coverage ({tested}/{total} flows)
| Domain | Flow | Status | Test File |
|--------|------|--------|-----------|
| ... | ... | ... | ... |

### Recommendations
1. {Priority 1 action}
2. {Priority 2 action}
```

## Anti-Patterns

- **NEVER report false coverage** — a test file existing is not the same as the flow being tested. Verify the test actually exercises the trigger and asserts the downstream effect.
- **NEVER count `describe.skip` as TESTED** — skipped tests are SKIPPED, not tested.
- **NEVER skip convention checks** — run all checks even if coverage looks good. A passing test with anti-patterns (DDB assertions, missing cleanup) is worse than a missing test.
- **NEVER conflate integration tests with E2E tests** — integration tests (per-service, in `test/integration/`) are a different concern. This audit covers only `apps/e2e-feature-tests/`.
- **NEVER audit without reading the actual test files** — don't infer test behavior from file names alone. Read the test body to classify coverage.

## Reference Files

- Test app: `apps/e2e-feature-tests/`
- Helpers: `apps/e2e-feature-tests/src/helpers/`
- Test support lib: `libs/test-support/src/`
- Flow specs: `flows/*.flow.yaml`
- Exemplary tests: `src/advisory/accept-decision.e2e.test.ts` (Pattern C), `src/funding/fund-account.e2e.test.ts` (Pattern A), `src/advisory/first-decision.e2e.test.ts` (Pattern B)
- Scaffolding guide: `create-e2e-test` skill
