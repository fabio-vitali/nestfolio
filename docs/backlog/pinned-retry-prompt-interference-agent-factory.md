---
id: pinned-retry-prompt-interference-agent-factory
status: parking
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_agent_runtime_structured_output.md
validation_gate: null
notes: "γ.4 retry stacks two corrective directives; cleaner separation needed."
epic: agent-runtime-latent-correctness
epic_role: core
---

# Pinned-retry prompt interference in agent-factory γ.4 path

`libs/agent-orchestrator/src/agent-factory.ts:121` sends `prompt + REINFORCE_SUFFIX` where `prompt` may already carry the `PRIOR ATTEMPT FEEDBACK` section (Approach B Task 4, commit `638e4396`). When the failure is BOTH (a) caught by `withRetry` as `ValidationError` AND (b) the in-call `structured.invoke` returns empty payload, the pinned retry's prompt stacks two distinct corrective directives: "your previous output violated rules" (envelope feedback) + "your previous response had empty fields" (REINFORCE_SUFFIX). At γ.4 retry the failure mode is specifically empty-payload, so the envelope feedback is noise. Cleaner separation: extract `pinnedPrompt = basePrompt + REINFORCE_SUFFIX` (no feedback) so γ.4's retry stays focused on payload recovery. The current test at `libs/agent-orchestrator/test/agent-factory.test.ts` ('feedback-augmented prompt is also used by the tool_choice-pinned retry') asserts both are present, validating current behavior — change would also require updating that test. Low priority — only fires in the rare combined failure case. Promote when γ.4 retries are observed misfiring after envelope feedback in production. Topic memory: `project_agent_runtime_structured_output.md`.
