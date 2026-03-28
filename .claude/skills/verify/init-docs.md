---
name: init-docs
description: Initialize/rebuild all agent documentation from code — regenerates all 33 service cards, regenerates flow specs, runs full system audit, commits auto-fixed artifacts. Run after major refactors, branch merges, or first-time setup.
---

## When This Skill Applies
- First-time setup of the documentation system in a fresh clone
- After a major refactor or branch merge that may have drifted derived artifacts
- Periodic full rebuild to reset all generated content to match code
- User invokes `/init-docs`

## What It Does

This is the "nuclear rebuild" — regenerates ALL derived artifacts from code, then verifies everything. Expect it to take several minutes due to 33+ sub-agent dispatches.

## Checklist

- [ ] 1. **Verify skill infrastructure exists**
  ```bash
  ls -d .claude/skills/{system,implement,verify,flows,architect} flows
  ```
  If missing, create the directories first.

- [ ] 2. **Regenerate ALL service cards (33 services)**
  Dispatch parallel sub-agents by domain using the `audit-service` generation procedure:
  - Advisory (15 services): advisory-ctrl, advisory-bff, advisory-hub, advisory-adpt, advisory-narrative-ctrl, decision-workflow-ctrl, compliance-ctrl, investor-profile-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl, alpha-vantage-adpt, fred-adpt, marketwatch-adpt, sec-edgar-adpt, yahoo-finance-adpt
  - Execution (6 services): execution-ctrl, execution-hub, execution-adpt, broker-ctrl, broker-sim-adpt, broker-alpaca-adpt
  - Investor (7 services): investor-ctrl, investor-bff, investor-hub, investor-adpt, dashboard-bff, onboarding-bff, investor-web
  - Ledger (5 services): ledger-ctrl, ledger-bff, ledger-hub, ledger-adpt, reconciliation-ctrl

  Dispatch 4 batches (one per domain) of parallel sub-agents.

- [ ] 3. **Regenerate ALL flow specs**
  For each `flows/*.flow.yaml`, dispatch a sub-agent using the `generate-flow-spec` procedure to re-trace the flow from code. If new flows are discovered (services have event chains not yet tracked), generate specs for those too.

- [ ] 4. **Validate all flow specs**
  For each regenerated spec, run the `validate-flow` procedure.

- [ ] 5. **Regenerate C4 architecture diagrams**
  ```bash
  node tools/generate-c4-diagrams.mjs
  ```
  This compiles `docs/architecture/nestfolio.d2` into navigable SVGs with AWS icons.

- [ ] 6. **Run full system audit**
  Invoke the `audit-system` procedure — 4 parallel domain audits + system-level checks.

- [ ] 7. **Report summary**
  ```
  ## /init-docs Results

  ### Service Cards
  - Generated: N/33
  - Failed: N (list failures)

  ### Flow Specs
  - Generated: N
  - Valid: N
  - Broken: N (list broken steps)

  ### System Audit
  - Hard failures: N
  - Warnings: N
  - Auto-fixed: N

  ### Files Changed
  [list of created/modified files]
  ```

- [ ] 8. **Commit all auto-generated artifacts**
  ```bash
  git add services/*/CLAUDE.md flows/*.flow.yaml docs/architecture/nestfolio/
  git commit -m "docs: regenerate all service cards, flow specs, and C4 diagrams via /init-docs"
  ```

## Anti-Patterns
- NEVER run this on every commit — it's expensive. Use for periodic rebuilds or after major changes.
- NEVER skip the audit step — regeneration without verification can mask issues.
- NEVER commit without reviewing the summary — check for failed generations.
