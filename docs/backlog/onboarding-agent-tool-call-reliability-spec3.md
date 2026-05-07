---
id: onboarding-agent-tool-call-reliability-spec3
status: shipped
type: refactor
references: []
out_of_scope: []
spec: docs/superpowers/specs/2026-05-01-onboarding-tool-call-reliability-design.md
plan: docs/superpowers/plans/2026-05-01-onboarding-tool-call-reliability-plan.md
topic_memory:
  - project_onboarding_tool_call_reliability.md
validation_gate: "5-run onboarding e2e against deployed dev: onboarding completed 5/5 zero renderer-render_* timeouts; CloudWatch 45/45 phase-node invocations had phaseRetryCount=0; OnboardingToolCallFailure count = 0."
closed: "2026-05-01"
notes: "Hardened phase-node against Sonnet 4.6 zero-tool-call returns via prompt cleanup + named-tool retry guard."
---

# Onboarding agent tool-call reliability (Spec 3)

SHIPPED 2026-05-01 on `main` (commit `fa78514c`): hardened `services/investor/onboarding-bff/src/agent/phase-node.ts` against Sonnet 4.6's intermittent zero-tool-call returns. Two coupled fixes:

(1) **prompt cleanup** — dropped the SYSTEM↔TURN-CONTEXT contradiction in `prompts/system.ts` (the "restate for confirmation, then commit on confirmation" sentence conflicted with phase-node's "you MUST call commit_phase now" guidance), tightened TOOL USE to three numbered rules, restructured `prompts/phase-instructions.ts` so all 7 phases follow uniform TITLE/ON ENTRY/OPTIONS (tool args only)/ON RESPONSE shape (schema content preserved verbatim);

(2) **named-tool retry guard** — added `phaseToRenderTool` map + `OnboardingToolCallFailure` error class; if first invoke returns wrong/zero tool, retry once with `tool_choice: <expectedTool>` (LangChain shorthand → Bedrock Converse `{ tool: { name } }` wire shape — note: spec wrote `{ tool: <string> }` which is malformed; fixed during code review), double-fail throws → AbstractAgent emits RUN_ERROR → existing 'Riprova' UX.

Telemetry: `phaseRetryCount` + `phaseFailures` aggregates added to `OnboardingAgent stream complete` CloudWatch log.

Validation gate: 5-run onboarding portion of Playwright e2e against deployed dev → onboarding completed 5/5 with zero renderer-render_* timeouts; CloudWatch aggregate **45/45 phase-node invocations had phaseRetryCount=0** (retry guard never had to fire — prompt cleanup alone resolved the flakiness; retry guard remains as defense-in-depth); `OnboardingToolCallFailure` count = 0. Steps 9-10 of the journey (advisory-mfe decision-detail + Confirm) failed in 3 of 5 — separate pre-existing advisory-mfe blockers, out of Spec 3 scope.

Closes the "Onboarding Sonnet tool-call flakiness remaining intermittent blocker" item from `project_playwright_e2e_ui.md`. Spec 4 (recover originating specs per §21 OQ #11) remains.
