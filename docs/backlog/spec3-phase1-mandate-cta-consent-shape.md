---
id: spec3-phase1-mandate-cta-consent-shape
status: dropped
rank: null
type: refactor
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: "Dropped without code change — re-file as a prompt audit if shape consistency is needed."
notes: "Dropped 2026-05-07 — purely stylistic; prompt-modification risk outweighs the cosmetic gain."
---

# Spec 3 Phase 1 reviewer Important findings

`mandate_cta` missing ON RESPONSE marker; `mandate_consent` missing OPTIONS block. Stylistic, not functional.

**Dropped 2026-05-07.** The fix is a 5-line prompt-text tweak in `services/investor/onboarding-bff/src/agent/prompts/phase-instructions.ts`. But:

- Spec 3 (shipped 2026-05-01) cleaned these prompts and validated empirically — CloudWatch showed 45/45 `phaseRetryCount=0` (named-tool retry never had to fire). Touching LLM prompts in isolation carries regression risk on tool-call reliability that a stylistic gain doesn't justify.
- The original backlog note already says "Revisit only if a future prompt audit asks for shape consistency across all 7 phases." Re-file as a holistic prompt audit when that's actually wanted; don't cherry-pick a 5-line tweak.

`test/unit/agent/prompts.test.ts:35-37` already encodes the current shape (`noOptionsPhases = new Set(['mandate_cta', 'mandate_consent'])`) — change is reversible if the audit happens.
