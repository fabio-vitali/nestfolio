---
name: audit-system
description: Full system sweep — dispatches audit-domain per domain in parallel, checks cross-domain consistency, orphans, flow coverage, skill freshness.
---

## When This Skill Applies
- Periodic health check
- Before major releases
- After architectural changes

## Checklist

- [ ] 1. **Dispatch 4 parallel sub-agents** — one per domain (advisory, execution, investor, ledger), each running audit-domain
- [ ] 2. **E2E feature test audit** — invoke the `audit-e2e-test` skill against `apps/e2e-feature-tests/`. E2E tests are a system-level concern (they span domains), so this check lives here, not in per-service audit-service.
- [ ] 3. **C4 diagram freshness** — re-run Stage 1 (`node tools/generate-c4-sources.mjs --dry-run` or to a temp dir), diff the generated D2 files against `docs/architecture/c3/*.d2` and `docs/architecture/nestfolio.d2`. Any delta means diagrams are stale. Report which services have changed stacks since last generation.
- [ ] 4. **Flow spec completeness** — scan all cross-domain adapter rules (each `*-adpt` service's `service.stack.ts` Ingress subscriptions) and all BFF mutations (each `*-bff` Facade resolver list). For each cross-domain event path or user-triggered mutation flow, check whether a corresponding `.flow.yaml` exists in `flows/`. Report undocumented flows.
- [ ] 5. **System-level checks:**

| Check | Severity |
|-------|----------|
| All domains pass | Aggregated |
| E2E feature test coverage (via audit-e2e-test) | Hard fail |
| C4 diagram freshness (D2 sources match CDK stacks) | Hard fail |
| Flow spec completeness (all cross-domain + user-triggered flows documented) | Hard fail |
| Cross-domain adapter subscription coverage (adapters subscribe to all required events on source buses) | Hard fail |
| Orphan services (outside domains) | Warning |
| Skill freshness (referenced paths exist) | Warning |

- [ ] 6. **Generate dashboard:**
  ```
  | Domain | Services | Pass | Fail | Warn |
  |--------|----------|------|------|------|
  | Advisory | 15 | ... | ... | ... |
  | Execution | 6 | ... | ... | ... |
  | Investor | 7 | ... | ... | ... |
  | Ledger | 5 | ... | ... | ... |
  ```
- [ ] 7. **Apply auto-fixes** — regenerate stale cards, regenerate stale C4 diagrams

## Remediation Plan

After generating the dashboard, if any domain has failures or system-level checks fail:

1. **Aggregate all failures** from:
   - 4 domain audit reports (each contains per-service + domain-level failures with mapped skills)
   - E2E feature test audit report (with mapped skills)
   - System-level check failures

2. **Map system-level failures to fixing skills:**

   | System Failure | Fixing Skill |
   |---------------|--------------|
   | E2E coverage gaps | `create-e2e-test` |
   | C4 diagrams stale (D2 sources diverged from CDK stacks) | `generate-c4-diagrams` (auto-fixable — re-run both stages) |
   | Flow spec missing for cross-domain or user-triggered flow | `generate-flow-spec` |
   | Flow spec exists but fails validation | `validate-flow` → manual fix or `create-data-flow` |
   | Cross-domain adapter subscription gap | `create-data-flow` + `create-event` |
   | Orphan service (outside domains) | `create-service` (move to correct domain) |
   | Stale skill (referenced path gone) | Manual fix — update skill file |

3. **Present unified remediation summary** using AskUserQuestion:

   > **System audit complete: {total_pass} pass, {total_fail} fail, {total_warn} warnings.**
   >
   > | Domain | Pass | Fail | Warn | Top Issue |
   > |--------|------|------|------|-----------|
   > | Advisory | ... | ... | ... | {description} |
   > | Execution | ... | ... | ... | {description} |
   > | Investor | ... | ... | ... | {description} |
   > | Ledger | ... | ... | ... | {description} |
   > | E2E Tests | ... | ... | ... | {description} |
   > | C4 Diagrams | ... | ... | ... | {description} |
   > | Flow Specs | ... | ... | ... | {description} |
   > | System | ... | ... | ... | {description} |
   >
   > **{N} total issues.** Grouped by priority:
   > 1. Hard-fail issues requiring immediate attention ({count})
   > 2. Coverage gaps addressable via scaffolding skills ({count})
   > 3. Warnings and best-practice improvements ({count})
   >
   > Options:
   > - **A) Generate full remediation plan** — invoke `writing-plans` with the complete audit report (recommended for ≥5 issues)
   > - **B) Fix by domain** — pick the worst domain and generate a domain-scoped plan
   > - **C) Fix by category** — address all issues of one type across domains (e.g., all integration test gaps)
   > - **D) Report only** — save the full audit report, fix later

4. If user selects **A**: invoke `writing-plans` with the full system audit report. Organize the plan by domain, with system-level and E2E fixes as their own sections.
5. If user selects **B**: ask which domain, then invoke `writing-plans` scoped to that domain's failures.
6. If user selects **C**: ask which category, then invoke `writing-plans` scoped to that failure type across all domains.

## Anti-Patterns
- NEVER run sequentially — use parallel sub-agents
- NEVER skip cross-domain checks after domain audits
- NEVER skip the remediation step — always present options after the dashboard
- NEVER generate a plan without user approval — always present options first
