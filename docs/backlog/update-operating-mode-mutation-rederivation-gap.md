---
id: update-operating-mode-mutation-rederivation-gap
status: dropped
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
closed: "2026-05-08"
notes: "Superseded by investor-profile-domain-resplit — root cause is policy denormalization, not a missing mutation."
---

# `updateOperatingMode` mutation re-derivation gap

DROPPED 2026-05-08 — superseded by `investor-profile-domain-resplit`. Surfacing the gap during planning revealed the missing mutation is a *symptom* of policy denormalization across domains; the resplit workstream addresses the root cause and makes this fix trivial as a side-effect.

Filed 2026-05-05 during operating-mode feature close-out. Today the only mode-derived guardrail derivation happens in `services/investor/investor-bff/src/transforms/onboarding-completed.ts:37` (`resolveGuardrailParams(s.operatingMode)`). The existing `updateMandate` mutation (`services/investor/investor-bff/src/graphql/js-function/update-mandate.fn.js`) sets per-field guardrail values directly with NO mode-aware re-derivation; there is no `updateOperatingMode` mutation in the AppSync schema. Result: a user can change their operating mode value in the composite InvestorProfile row, but `mandate.maxSingleTradePercent` / `mandate.monthlyTurnoverCapPercent` / etc. won't update — compliance-ctrl will keep using the OLD mode's thresholds via its MandateSnapshot projection. Fix: add `updateOperatingMode(mode)` mutation that atomically updates `operatingMode` AND re-derives `mandate.*` from `resolveGuardrailParams(newMode)` in one UpdateItem expression. CDC will then emit INVESTOR_PROFILE_UPDATED → compliance-ctrl re-projects MandateSnapshot with new thresholds. ~30-45 min including a small JS resolver test. Promote when product surfaces a Settings UI for changing operating mode post-onboarding, or when a user-visible bug surfaces (mode shows as AGGRESSIVE in profile but trades still gate at CONSERVATIVE thresholds).
