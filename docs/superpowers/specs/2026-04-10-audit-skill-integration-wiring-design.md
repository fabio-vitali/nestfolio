# Audit Skill Integration Test Wiring — Design

**Date:** 2026-04-10
**Status:** Approved, pending implementation plan
**Scope:** `.claude/skills/audit-service/SKILL.md` + `.claude/skills/audit-integration-test/SKILL.md`

## Problem

The `audit-integration-test` skill claims in its "When This Skill Applies" section:

> Called by `audit-service` or `audit-domain` as sub-check

This is false. Neither `audit-service` nor `audit-domain` actually invokes it. Evidence:

- `audit-service/SKILL.md` Verification Checks table has 8 rows. Check #4 is `"Test coverage: every handler has corresponding test | Warning"` — generic unit test coverage, no reference to integration tests or `audit-integration-test`. The string "integration" appears zero times in the skill.
- `audit-domain/SKILL.md` checklist dispatches `audit-service` per service and runs domain-level checks (service completeness, adapter subs, event contracts, flow validation, bus config, infinite loops). No integration test coverage row.
- `audit-system/SKILL.md` dispatches `audit-domain` — inherits the gap transitively.

Net effect: `audit-integration-test` is orphaned from the audit cascade despite claiming to be part of it. The *create* path is wired correctly (`create-service` step 7b → `create-integration-test`, `create-feature` step 7b → `create-integration-test`, `testing-patterns` delegates to both), but the *audit* path has a hole.

Meanwhile, the project baseline is 100% integration test coverage across all backend business services — 28/28 `-ctrl`, `-bff`, and `-adpt` services have `test/integration/` directories today (verified by `find services -type d -name integration`). The 5 services without integration tests are all legitimately exempt: 4 `-hub` services (pass-through EventBridge routers with no business logic) and 1 `-web` service (Angular frontend, different test model). A missing `test/integration/` directory on any `-ctrl`/`-bff`/`-adpt` service is therefore a regression — exactly the kind of thing an audit should catch.

## Goal

Wire `audit-integration-test` into the audit cascade so that:

1. Running `audit-service <service>` includes an integration test coverage sub-check.
2. `audit-domain` and `audit-system` inherit the check transitively via the existing cascade (`audit-system` → `audit-domain` → `audit-service` → `audit-integration-test`).
3. Missing `test/integration/` directory hard-fails the audit (regression from baseline).
4. The false "Called by" claim in `audit-integration-test` becomes true.

## Non-goals

- Adding an explicit integration test row to `audit-domain`'s checklist (cascade handles it silently — adding the row is visual noise).
- Adding an "Integration Tests" section to the generated CLAUDE.md service card (cards describe runtime behavior; test coverage is an audit-time concern).
- Changing `ci-audit` or `pr-audit.yml` (orthogonal — `ci-audit` uses its own inline prompt and does not invoke `audit-service`; the CI integration test concern is handled by the separate `2026-04-10-pr-integration-tests-design.md` spec).
- Introducing gradual-adoption severities. Since the baseline is 100% coverage, missing tests is hard fail, not warning.
- Modifying the `audit-integration-test` "Batch Audit (Multiple Services)" section — it stays valid for standalone manual invocation.

## Design

Three skill files change (one is a no-op verification).

### 1. `.claude/skills/audit-service/SKILL.md` — Verification Checks table

**Retitle existing check #4** to scope it explicitly to unit tests:

```
4 | Unit test coverage: every handler has corresponding test in test/ (excluding test/integration/) | Warning | Compare handler vs test file lists
```

**Add new check #9:**

```
9 | Integration test coverage: test/integration/ exists and passes audit-integration-test (gated on service suffix) | Hard fail | Invoke audit-integration-test skill as sub-check; hard fail if directory absent AND suffix is -ctrl, -bff, or -adpt
```

**Add a short paragraph below the table:**

> **Integration test sub-check (check #9)**: Determine applicability by service suffix, then act:
>
> - **`-ctrl`, `-bff`, `-adpt`** (backend business services): if `test/integration/` exists, invoke the `audit-integration-test` skill and incorporate its findings into the audit report. If the directory is absent, hard-fail with the message: `"Service has no test/integration/ directory — integration tests are required for -ctrl/-bff/-adpt services (baseline: 28/28 covered today). Add tests via create-integration-test skill."`
> - **`-hub`** (event bus routers): skip check #9 entirely. Hubs are pass-through EventBridge routers with no business logic; the integration test model does not apply. Report as `"N/A — hub services route events, no integration test required."`
> - **`-web`** (Angular frontends / MFEs): skip check #9 entirely. Web apps use a different test model (Angular component tests, E2E via Playwright/Cypress) and do not consume the `@nestfolio/integration-testing` lib. Report as `"N/A — web services use a different test model."`

### 2. `.claude/skills/audit-integration-test/SKILL.md` — Fix the false claim

In the "When This Skill Applies" section, replace:

> - Called by `audit-service` or `audit-domain` as sub-check

with:

> - Called by `audit-service` as a per-service sub-check (hard-fails if `test/integration/` absent)
> - Cascades transitively through `audit-domain` and `audit-system` via `audit-service`

The "Batch Audit (Multiple Services)" section stays as-is — it remains valid for standalone manual invocation when a dev wants a domain-wide integration test sweep without the full `audit-domain` cascade.

### 3. `.claude/skills/audit-domain/SKILL.md` — No change

The existing checklist step `"Dispatch parallel sub-agents — one per service, running audit-service"` already cascades the new check transitively. Adding an explicit domain-level "integration test coverage" row would be visual noise and duplicate the check's location in the skill hierarchy.

### 4. `.claude/skills/audit-system/SKILL.md` — No change

Dispatches `audit-domain`, inherits the cascade.

## Rationale for each choice

| Choice | Rationale |
|---|---|
| Wire from `audit-service` only (not `audit-domain`) | Single wiring point, single mental model. Cascade is already the idiom in the audit skills. Standalone `audit-service <one-service>` also picks up the check. Matches `audit-integration-test`'s own stated behavior. |
| Hard fail on missing `test/integration/` for `-ctrl`/`-bff`/`-adpt` | Baseline is 100% coverage across backend business services (28/28 today). Missing tests on those is a regression, not gradual adoption. Consistent with the project's "no deprecation, breaking changes free" posture (`feedback_no_deprecation`). Softer severities erode coverage over time. |
| Skip check #9 for `-hub` and `-web` suffixes | `-hub` services are pass-through EventBridge routers with no Lambda handlers or DDB tables — the integration test model (EventBridgeClient, TableAssertions, EventBusTrap) doesn't apply. `-web` services are Angular frontends that don't consume `@nestfolio/integration-testing`. Hard-failing these would be wrong. Suffix-based gating is principled, not arbitrary. |
| Split check #4 (unit only) + new check #9 (integration) | Unit and integration tests have different coverage models (handler→test ratio vs event→scenario), different severities (Warning vs Hard fail), and the integration model is already defined in the specialized skill. Splitting makes both explicit. |
| New check is a thin delegation row | Depth of integration coverage logic stays in `audit-integration-test` (Ingress events, CDC, adapter forwarding, anti-patterns). `audit-service` just gates presence and delegates. No duplication. |
| `audit-domain` checklist unchanged | Cascade is idiomatic in the existing audit skills. Adding the row would duplicate check location and risk drift between the two skills. |
| Service card untouched | Service cards describe runtime behavior; audit findings are a report-time concern. Separating them keeps the card stable across audits and avoids card churn on every audit run. |

## Failure mode and developer experience

Scenario: dev scaffolds a new `-ctrl`/`-bff`/`-adpt` service via `create-service`, skips step 7b (`create-integration-test`), runs `audit-service` on the new service.

- Check #9 hard-fails with the stated message.
- Dev reads the message, invokes `create-integration-test` to add the missing directory, re-runs `audit-service`, passes.

This is the intended feedback loop. `create-service` step 7b already documents the requirement; the hard fail enforces it instead of silently tolerating skipped steps.

Scenario: dev scaffolds a new `-hub` or `-web` service.

- Check #9 reports `N/A` based on suffix and passes. No friction for service types where integration tests don't apply.

Scenario: dev runs `audit-domain advisory` during a refactor.

- All 15 advisory services run `audit-service` in parallel. The 14 `-ctrl`/`-bff`/`-adpt` services run the full sub-check; the 1 `-hub` service (`advisory-hub`) reports `N/A`.
- Any `-ctrl`/`-bff`/`-adpt` service missing `test/integration/` hard-fails; the domain report aggregates the hard fails alongside the existing domain-level checks (adapter subs, event contracts, flow validation).

Scenario: dev runs `audit-system` before a major release.

- 4 parallel `audit-domain` runs cascade down to per-service `audit-service` runs. 28 services get full integration test checks, 5 get `N/A` (4 hubs + 1 web). Any missing coverage surfaces in the system dashboard.

## Verification plan

1. Run `audit-service` on a `-ctrl`/`-bff`/`-adpt` service with an existing `test/integration/` directory (e.g., `services/advisory/sec-edgar-adpt`). Expect the audit report to include `audit-integration-test` sub-check output.
2. Run `audit-service` on a `-hub` service (e.g., `services/advisory/advisory-hub`). Expect check #9 to report `"N/A — hub services route events, no integration test required."` and NOT hard-fail despite the absence of `test/integration/`.
3. Run `audit-service` on `services/investor/investor-web`. Expect check #9 to report `"N/A — web services use a different test model."` and NOT hard-fail.
4. Temporarily rename a `-ctrl` service's `test/integration/` directory, run `audit-service` on that service. Expect hard fail with the stated message. Rename back.
5. Run `audit-domain advisory`. Expect 14 `-ctrl`/`-bff`/`-adpt` services to get full sub-checks and the 1 `-hub` service to get the `N/A` response. No changes to the domain-level checks.
6. Run `audit-system`. Confirm the cascade holds: 28 services get full checks, 5 get `N/A`, zero hard fails assuming current state.
7. Grep `.claude/skills/` for the old string `"Called by \`audit-service\` or \`audit-domain\` as sub-check"`. Expect zero matches.
8. Grep `.claude/skills/audit-service/SKILL.md` for `"audit-integration-test"`. Expect at least one match (the new check #9 delegation).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `audit-service` becomes noticeably slower (now invokes another skill per service) | Acceptable. `audit-integration-test` is static file inspection (no AWS calls). The whole audit chain is developer-driven, not a hot path. |
| New service scaffolded without integration tests hits hard fail on first audit | `create-service` step 7b already invokes `create-integration-test`. The hard fail enforces that wiring; it doesn't regress against it. The failure message names the skill to invoke for remediation. |
| "Batch Audit (Multiple Services)" section in `audit-integration-test` becomes vestigial | It remains valid for standalone manual invocation (a dev running a domain-wide integration test sweep without the full `audit-domain` cascade). Keep it. |
| Check #4 retitle is missed during rollout, causing drift between the retitled description and old audit reports | The retitle is a one-line edit in the same commit as the new #9. No drift window. |

## No changes required to

- `.claude/skills/audit-domain/SKILL.md` — inherits via cascade.
- `.claude/skills/audit-system/SKILL.md` — inherits via cascade.
- `.claude/skills/create-service/SKILL.md` — step 7b already invokes `create-integration-test`.
- `.claude/skills/create-feature/SKILL.md` — step 7b already invokes `create-integration-test` for new events.
- `.claude/skills/testing-patterns/SKILL.md` — already delegates integration tests to `create-integration-test` and `audit-integration-test`.
- `.claude/skills/ci-audit/SKILL.md` — uses its own inline prompt, does not invoke `audit-service`. Orthogonal to this spec.
- `CLAUDE.md` skill routing table — both `audit-service` and `audit-integration-test` are already listed; their relationship is now implementation detail of `audit-service`, not a routing entry.
- Service cards (`services/*/CLAUDE.md`) — untouched.

## Out of scope / deferred

- Domain-level explicit integration test row in `audit-domain` checklist. Cascade handles it.
- Integration test section in service cards. Audit findings stay in audit reports, not cards.
- Unit test severity escalation (check #4 stays as Warning). Out of scope; this spec is about integration tests only.
- Gradual-adoption severities. Not needed at 100% baseline.
- Main-merge audit integration (`audit-system` in CI). The `ci-audit` path is independent and uses its own inline prompt.
- Automated fix mode for missing integration tests (auto-invoke `create-integration-test`). Audit skills self-heal stale cards, not missing tests — test creation needs human judgment about which pattern (A/B/C/D/E) applies.
