---
id: investor-profile-domain-resplit
status: active
rank: 1
type: design
references:
  - services/investor/investor-bff/src/transforms/onboarding-completed.ts
  - services/investor/investor-bff/src/repositories/investor-profile.repository.ts
  - services/investor/investor-bff/src/graphql/js-function/update-mandate.fn.js
  - services/investor/investor-bff/src/graphql/js-function/revoke-mandate.fn.js
  - services/investor/investor-bff/src/schema.graphql
  - services/investor/investor-bff/src/domain/guardrail-params.ts
  - services/advisory/compliance-ctrl/src/handlers/event-listener.ts
  - services/advisory/compliance-ctrl/src/rules/rule-engine.ts
  - services/advisory/compliance-ctrl/src/rules/guardrail-evaluator.ts
  - services/investor/investor-ctrl/src/handlers/event-listener.ts
  - libs/cdk-constructs/src/core/event-types.ts
  - libs/cdk-constructs/src/core/egress.ts
out_of_scope:
  - "Goal sub-aggregate split (Goal stays on InvestorProfile row; only Mandate splits out)"
  - "RiskProfile sub-aggregate split (stays on InvestorProfile row)"
  - "AccountMode/ExecutionMode lifecycle changes"
  - "Mandate renewal or multi-active-mandate concurrency (one-active-mandate-per-user model retained)"
  - "Operating-mode Phase 2 (agent behavior changes) — orthogonal workstream"
  - "Frontend UI changes for mandate display (no UI exists for the 8 numeric guardrails today)"
  - "Migration of staging/prod data — dev sandbox is disposable per project conventions"
  - "Performance benchmarking — assumed cost-neutral"
  - "RBAC / authority model changes — AuthorityResolver stays compatible"
  - "Real-money operating-mode changes — current refactor remains compatible with broker flows"
spec: docs/superpowers/specs/2026-05-08-investor-profile-domain-resplit-design.md
plan: null
topic_memory:
  - project_investor_profile_collapse.md
validation_gate: null
notes: "Re-split Mandate as a sibling aggregate; relocate GUARDRAIL_TABLE policy into compliance-ctrl; introduce 3-tier event topology (carrier + semantic + lifecycle) via declarative onFieldChange extension to cdk-constructs."
---

# investor-profile-domain-resplit

Filed 2026-05-08, supersedes `update-operating-mode-mutation-rederivation-gap` (closed as superseded). Architectural refactor that partly reverses the 2026-05-04 InvestorProfile collapse — specifically the parts that mixed two distinct domain concerns (user *intent* vs. compliance *policy*) onto a single row + single carrier event.

See full design at `docs/superpowers/specs/2026-05-08-investor-profile-domain-resplit-design.md`.

## Why this exists

While picking up `update-operating-mode-mutation-rederivation-gap`, surfaced that the missing `updateOperatingMode` mutation is a *symptom*, not the bug. Root cause: `services/investor/investor-bff/src/domain/guardrail-params.ts` is a compliance policy table living in the wrong domain, denormalized at onboarding into `InvestorProfile.mandate.{8 guardrail fields}`, then re-broadcast over `INVESTOR_PROFILE_UPDATED` to compliance-ctrl. Any mode change must touch both `operatingMode` AND `mandate.*` atomically — in a domain that doesn't own the policy. Verification surfaced a half-built `setOperatingMode` repo method (line 182, dead code) that updates only `operatingMode` and would silently break compliance projection if wired up.

## Decision direction (B+A from brainstorm 2026-05-08)

1. **Mandate as a sibling aggregate.** `sk='Mandate'` row carries `{mandateId, level, status, effectiveDate, revokedAt}` — pure authority grant. The 8 numeric guardrails leave the row entirely.
2. **Compliance owns policy.** `GUARDRAIL_TABLE` moves to `services/advisory/compliance-ctrl/src/rules/guardrail-params.ts`. RuleEngine derives thresholds from `operatingMode` at evaluation time. `MandateSnapshot` shape: `{operatingMode, level, status}`.
3. **3-tier event topology.** `INVESTOR_PROFILE_UPDATED` (carrier — for snapshot consumers like dashboard-bff) + `OPERATING_MODE_CHANGED` / `GOAL_UPDATED` (semantic — for compliance, investor-ctrl) + `MANDATE_ISSUED` / `MANDATE_REVOKED` (lifecycle).
4. **Declarative `onFieldChange` extension** in `libs/cdk-constructs/src/core/event-types.ts` — egress lambda diffs OldImage vs NewImage and emits semantic events alongside the carrier.
5. **`updateMandate` mutation deleted** — has no UI consumer; conflicts with policy-in-compliance principle. `updateOperatingMode(mode)` becomes a one-field UpdateItem (no JS resolver / TS bridge friction).

## Scope estimate

Multi-day refactor, ~30 production files + 33 test files + 28 docs. Touches 6 services across investor + advisory domains plus one shared library.
