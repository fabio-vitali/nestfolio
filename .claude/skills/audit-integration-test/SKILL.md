---
name: audit-integration-test
description: Verify integration test completeness and convention compliance for a service. Use to check coverage gaps, anti-patterns, and configuration issues.
---

## When This Skill Applies
- After writing or modifying integration tests (as verification step)
- Checking integration test coverage for a service
- During domain or system audits
- Called by `audit-service` or `audit-domain` as sub-check

## Prerequisites
- Read the target service's CLAUDE.md card: `services/{domain}/{service}/CLAUDE.md`
- If missing or stale, invoke `audit-service` first

## Checklist

### Configuration Checks

| # | Check | Severity | How to Verify |
|---|-------|----------|---------------|
| 1 | `jest.integration.config.js` exists at service root | Hard fail | `ls services/{domain}/{service}/jest.integration.config.js` |
| 2 | `test-integration` target in `project.json` | Hard fail | Read project.json, check targets |
| 3 | `testPathIgnorePatterns` includes integration dir in `jest.config.js` | Hard fail | Read jest.config.js |
| 4 | `maxWorkers: 1` in jest.integration.config.js | Warning | Read config file |
| 5 | `setupFilesAfterEnv` points to `jest.integration.setup.ts` | Warning | Read config file |
| 6 | Test directory `test/integration/` exists with `.integration.test.ts` files | Hard fail | `ls test/integration/` |

### Convention Checks

| # | Check | Severity | How to Verify |
|---|-------|----------|---------------|
| 7 | Uses `createIntegrationContext()` (not manual setup) | Hard fail | Grep test files for `createIntegrationContext` |
| 8 | Calls `ctx.cleanup.runAll()` in `afterAll` | Hard fail | Grep for `cleanup.runAll` |
| 9 | Calls `table.registerCleanup()` when using TableAssertions | Hard fail | Grep: if `TableAssertions` used, `registerCleanup` must appear |
| 10 | No `DdbSeedFixture` usage | Hard fail | Grep for `DdbSeedFixture` -- must not appear |
| 11 | No CDC assertions wrapped in try/catch | Hard fail | Grep for `waitForEvent` inside try blocks |
| 12 | No `describe.skip` without documented reason | Warning | Grep for `describe.skip` |
| 13 | Timeout hierarchy: beforeAll 90s, it() 120s, afterAll 60s | Warning | Read timeout values |

### Coverage Checks

Dispatch a sub-agent with this prompt (replace `{domain}` and `{service}`):

```
Audit integration test coverage for {service} in domain {domain}. Read these files:

1. services/{domain}/{service}/CLAUDE.md — extract Ingress subscriptions and Egress emissions
2. services/{domain}/{service}/src/service.stack.ts — extract all event types from:
   - Ingress construct detailType arrays
   - Egress construct eventTypes map
   - Orchestration construct triggers
   - Facade noneDataSource resolvers (if BFF)
3. services/{domain}/{service}/test/integration/ — read all test files

For each Ingress event type, classify test coverage:

| Event Type | Test Status | Assertion Level | Notes |
|-----------|-------------|-----------------|-------|
| {EVENT}   | TESTED / UNTESTED / SKIPPED | Full (DDB+CDC) / Partial (DDB only) / Smoke (no assertions) / Skip (drain) | details |

For each Egress CDC event type, classify:

| CDC Event | Trapped? | Asserted? | Notes |
|-----------|----------|-----------|-------|
| {EVENT}   | YES/NO   | YES/NO/TRY-CATCH | details |

Check for anti-patterns:
- DdbSeedFixture usage (HARD FAIL)
- try/catch around waitForEvent (HARD FAIL — creates false coverage)
- describe.skip blocks (WARNING — document reason)
- Missing table.registerCleanup() (HARD FAIL)
- Missing ctx.cleanup.runAll() in afterAll (HARD FAIL)
- Scan-based DDB assertions (WARNING)
- Fixtures deployed inside it() blocks (WARNING)

Produce a report in this format:

## Integration Test Audit: {service}

### Configuration
- [ ] jest.integration.config.js: {EXISTS|MISSING}
- [ ] test-integration target: {EXISTS|MISSING}
- [ ] Unit test exclusion: {CONFIGURED|MISSING}
- [ ] maxWorkers: 1: {YES|NO}

### Ingress Coverage: {tested}/{total} event types
| Event Type | Status | Assertion Level |
|-----------|--------|-----------------|

### Egress Coverage: {trapped}/{total} CDC event types
| CDC Event | Trapped | Asserted |
|-----------|---------|----------|

### Anti-Patterns Found
- {list or "None"}

### Recommendations
1. {prioritized list of improvements}

### Overall Grade
- EXEMPLARY: all ingress+egress tested, no anti-patterns
- GOOD: all ingress tested, some egress gaps
- PARTIAL: >50% ingress tested, significant gaps
- MINIMAL: <50% coverage or critical anti-patterns
- MISSING: no integration tests exist
```

### Self-Healing

- **Config missing** -> Scaffold using `create-integration-test` skill templates
- **Anti-pattern found** -> Report with file:line and suggested fix
- **Coverage gap** -> Report untested event types, suggest test stubs

## Batch Audit (Multiple Services)

To audit all services in a domain, dispatch parallel sub-agents:

```
For each service in services/{domain}/:
  1. Check if test/integration/ directory exists
  2. If yes: run full audit checklist above
  3. If no: report as MISSING with Ingress event count from CLAUDE.md

Produce domain-level summary:

## {Domain} Domain Integration Test Audit

| Service | Grade | Ingress Coverage | Egress Coverage | Anti-Patterns |
|---------|-------|-----------------|-----------------|---------------|

### Domain-Wide Issues
- {cross-cutting problems}

### Priority Improvements
1. {ordered by impact}
```

## Reference Files
- Integration testing lib: `libs/integration-testing/src/`
- Exemplary tests: `services/advisory/sec-edgar-adpt/test/integration/`, `services/investor/dashboard-bff/test/integration/`
- Full run report: `docs/reviews/2026-04-08-integration-test-full-run.md`
- Create skill: `.claude/skills/create-integration-test/SKILL.md`

## Anti-Patterns
- NEVER report coverage as "Full" if CDC assertions are wrapped in try/catch
- NEVER skip the anti-pattern check -- false coverage is worse than no coverage
- NEVER auto-fix test logic -- only auto-fix configuration (config files, targets)
