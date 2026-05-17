---
id: ip-ctrl-vestigial-opus-env-var
status: parking
type: refactor
notes: "investor-profile-ctrl CDK stack still wires MODEL_OPUS_ID env var to AgentRuntime but risk-assessment.config.ts no longer reads it post Lever C (2026-05-17)"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# investor-profile-ctrl vestigial MODEL_OPUS_ID env var

## Evidence

`services/advisory/investor-profile-ctrl/src/service.stack.ts` still passes `MODEL_OPUS_ID` to the AgentRuntime environment, and the IAM grant block still scopes Bedrock InvokeModel to the Opus inference profile.

Post Lever C of `bedrock-cost-reduction-may-2026` (commit `86be7795`, 2026-05-17), `services/advisory/investor-profile-ctrl/src/agents/risk-assessment.config.ts:6` reads `modelId: 'us.anthropic.claude-sonnet-4-6'` — the agent no longer reads `MODEL_OPUS_ID` at runtime. The Opus IAM grant + env var are dead wiring.

## Cheapest next step

When next touching IP-ctrl CDK: delete the `MODEL_OPUS_ID` env var entry and narrow the IAM grant to Sonnet + Haiku inference profiles. Note: user-goals (Haiku) is the other surviving agent in this service.

## Promotion trigger

Promote when next touching IP-ctrl CDK or when AGENT_MODEL_OVERRIDE refactor lands (that workstream may consolidate model-resolution patterns workspace-wide).
