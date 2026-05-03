---
name: audit-system
description: Full system sweep — dispatches audit-domain per domain in parallel, checks cross-domain consistency, orphans, flow coverage, arch doc freshness (SERVICE-INVENTORY count + BACKLOG design refs + orientation skill drift), skill freshness.
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
- [ ] 5. **Architecture doc & skill freshness** — verify the canonical architecture layer hasn't drifted from code (this check exists because design specs that read against drifted docs ship wrong solutions — see `CLAUDE.md` § Backlog Discipline):
  - **Service count** in `docs/architecture/SERVICE-INVENTORY.md` "Inventory Summary" table matches `ls services/{advisory,execution,investor,ledger}/ | grep -v README.md | wc -l`
  - **Per-service entries** in SERVICE-INVENTORY.md exist for every directory under `services/*/` and vice-versa (no orphan entries, no missing entries). Health tags (canonical / transitional / legacy / dormant) match git history (any service marked transitional/legacy must have a follow-up spec referenced).
  - **Evolution annotations** in `docs/architecture/SYSTEM-ARCHITECTURE.md` (§7.1, §10.1, §17.1, etc.) reference specs that exist under `docs/superpowers/specs/`
  - **Orientation skill drift guard:** `.claude/skills/orient/SKILL.md` and `.claude/skills/domains/SKILL.md` must remain under ~60 lines each. They were thinned to canonical-doc pointers on 2026-05-03; re-population with enumerated service or event lists is the failure mode (those drift on every system change). Grep for forbidden enumerations: any service name (`advisory-ctrl`, `decision-workflow-ctrl`, etc.) or event name (`MANDATE_CREATED`, etc.) appearing in these two skills is a hard fail.
  - **BACKLOG design-entry refs valid:** for each `[design]` entry in `docs/BACKLOG.md`, every reference in its `**References:**` line resolves AND still matches code (cited service section in SERVICE-INVENTORY.md exists; cited SYSTEM-ARCHITECTURE.md section exists; cited `flows/*.flow.yaml` exists and passes `validate-flow`).
- [ ] 6. **System-level checks summary:**

| Check | Severity |
|-------|----------|
| All domains pass | Aggregated |
| E2E feature test coverage (via audit-e2e-test) | Hard fail |
| C4 diagram freshness (D2 sources match CDK stacks) | Hard fail |
| Flow spec completeness (all cross-domain + user-triggered flows documented) | Hard fail |
| Cross-domain adapter subscription coverage (adapters subscribe to all required events on source buses) | Hard fail |
| Architecture doc freshness (SERVICE-INVENTORY count, evolution annotations, BACKLOG design refs) | Hard fail |
| Orientation skill drift guard (orient + domains under 60 lines, no enumerations) | Hard fail |
| Orphan services (outside domains) | Warning |
| Skill freshness (referenced paths exist) | Warning |

- [ ] 7. **Generate dashboard:**
  ```
  | Domain   | Services | Pass | Fail | Warn |
  |----------|----------|------|------|------|
  | Advisory | {count}  | ...  | ...  | ...  |
  | Execution| {count}  | ...  | ...  | ...  |
  | Investor | {count}  | ...  | ...  | ...  |
  | Ledger   | {count}  | ...  | ...  | ...  |
  ```
  Service count per domain is filled from `ls services/<domain>/ | grep -v README.md | wc -l` — never hardcode (that's how the dashboard itself drifts).
- [ ] 8. **Apply auto-fixes** — regenerate stale cards, regenerate stale C4 diagrams. Arch-doc drift and skill drift are NOT auto-fixable (they require human-curated narrative); surface them in the remediation summary instead.

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
   | SERVICE-INVENTORY.md service count or per-service entry drift | Manual fix — edit SERVICE-INVENTORY.md to match code; do not adopt any `[design]` entry referencing the affected service until fixed |
   | SYSTEM-ARCHITECTURE.md evolution annotation references missing spec | Manual fix — recover the spec (see Spec 4 precedent) or remove the annotation |
   | Orient/domains skill drifted (>60 lines or contains enumerations) | Manual fix — re-thin per the 2026-05-03 refactor pattern (canonical-doc pointers only) |
   | BACKLOG `[design]` entry References: line stale | Manual fix — either update the BACKLOG entry's refs to current code OR fix the doc layer. Do NOT adopt the entry to ACTIVE until refs verify. |
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
