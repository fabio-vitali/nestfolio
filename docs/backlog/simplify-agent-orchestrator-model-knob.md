---
id: simplify-agent-orchestrator-model-knob
status: shipped
type: design
rank: null
notes: "Remove runtime model-tier escalation (__escalationTier + escalationPath + buildEscalationPath + tier-escalation.ts) and the AGENT_MODEL_OVERRIDE cost-cap downgrade (MODEL_ID_MAP + TIER_ORDER + detectTier + applyOverride) from libs/agent-orchestrator. After this lands, each *.config.ts's modelId is the ONLY model knob — used verbatim, no closed-set tier semantics, no runtime mutation. Unblocks the agent-benchmark-skill workstream by simplifying the system to the shape the benchmark assumes (raw modelId per task)."
references:
  - libs/agent-orchestrator/src/agent-factory.ts
  - libs/agent-orchestrator/src/with-retry.ts
  - libs/agent-orchestrator/src/create-orchestrator.ts
  - libs/agent-orchestrator/src/types.ts
  - libs/agent-orchestrator/src/agent-tracer.ts
  - libs/agent-orchestrator/src/index.ts
  - services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts
  - services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts
out_of_scope:
  - The benchmark skill itself (filed separately as `agent-benchmark-skill`, currently parking — promotes to active after this ships).
  - The `looksDegraded` / `REINFORCE_SUFFIX` schema-degraded retry path in agent-factory (independent of escalation; stays as-is).
  - The `withValidation` validation-rule retry path (`__retryFeedback` prompt augmentation; independent of escalation; stays as-is).
  - "Replacing the haiku/sonnet/opus tier vocabulary with a different vocabulary — there is no replacement vocabulary, the unit is now the raw `modelId: string` everywhere."
  - Changing which model each AgentConfig uses today. This refactor is behavior-preserving — every `*.config.ts` keeps its current `modelId`. Model-choice decisions land in the follow-on benchmark workstream.
  - Adding a per-deploy override mechanism (env var, SSM, etc.) for cost-cap or canary purposes. AGENT_MODEL_OVERRIDE was never used and is being removed precisely to avoid carrying a feature that's never exercised. If a future need arises, design it then.
  - Onboarding-bff agent's own model wiring (separate from advisory; comment reference only).
spec: docs/superpowers/specs/2026-05-19-simplify-agent-orchestrator-model-knob-design.md
plan: docs/superpowers/plans/2026-05-19-simplify-agent-orchestrator-model-knob.md
topic_memory:
  - project_agent_orchestrators.md
  - project_agent_runtime_structured_output.md
validation_gate: |
  Branch worktree-simplify-agent-orchestrator-model-knob, HEAD e39d662e (16 commits ahead of origin/main: db974a32 plan; dcf2e855 plan-addendum Task 13; bf1de97d-0a9fe670 tasks 2-12 implementation; abde500d task 13 e2e; e39d662e doc derivation regen).
  pnpm nx affected -t test --base=origin/main → PASS, 35 projects.
  pnpm nx affected -t lint --base=origin/main → PASS, 37 projects, 0 errors (24 pre-existing warnings outside this workstream).
  pnpm nx affected -t type-check → No tasks (no project in affected set has the target — acceptable, build/test exercise tsc).
  Deploy `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl` succeeded across all 4 services (parallel keychain race required sequential redeploy of AN+PE; both ✅ on retry).
  Scoped e2e against deployed dev:
    - apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts → PASS (138.8s) — full advisory pipeline exercised end-to-end with raw `gen_ai.request.model` id `us.anthropic.claude-haiku-4-5-20251001-v1:0`.
    - apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts → PASS (149.5s) — portfolio-engine raw-id assertion (`us.anthropic.claude-opus-4-6-v1` OR `us.anthropic.claude-sonnet-4-6`) holds against live trace.
  Orphan grep across services/, libs/, infrastructure/, apps/ for ModelTier, escalationPath, buildEscalationPath, escalatedFromTier, MODEL_ID_MAP, extractModelTier, tier-escalation → zero hits. AGENT_MODEL_OVERRIDE grep across advisory paths → zero hits (only onboarding-bff's own override remains, out-of-scope per spec §3).
---

# Simplify agent-orchestrator model knob

## Why

`libs/agent-orchestrator/src/agent-factory.ts` carries two features that aren't used in practice:

1. **Runtime tier escalation** — `withRetry` enriches state with `__escalationTier`, which `createAgentNode` reads to look up a different model in `MODEL_ID_MAP`. Used by `advisory-narrative-ctrl` and `market-intelligence-ctrl` retry options. Closed-set vocabulary (`'haiku'|'sonnet'|'opus'`) — incompatible with Nova/Llama/Mistral if those become viable choices via the benchmark.
2. **`AGENT_MODEL_OVERRIDE` cost-cap downgrade** — `applyOverride()` reads an env var and downgrades the resolved model. Wiring through CDK exists only as a comment reference; the env var was never actually plumbed to Lambda functions. Dead in practice.

Together they make `MODEL_ID_MAP` the apparent source of model truth, even though it isn't: production defaults already live in each `*.config.ts`'s `modelId: string`. The benchmark workstream (`agent-benchmark-skill`) treats `*.config.ts modelId` as the single source of truth and lands recommendations as one-line edits there. Carrying the escalation/override machinery forward forces the spec to keep saying "but MODEL_ID_MAP is only for escalation/override, not for production" — a caveat that wouldn't need to exist if those features were removed.

After this workstream: `*.config.ts modelId` is the only knob. Full Bedrock model ID, used verbatim at runtime, no enrichment, no downgrade.

## What

A behaviour-preserving refactor of `libs/agent-orchestrator`:

- Drop `MODEL_ID_MAP`, `TIER_ORDER`, `detectTier`, `applyOverride`, `tier-escalation.ts`, `buildEscalationPath`, `ModelTier` type, `RetryOptions.escalationPath` field, `__escalationTier` state key, `escalatedFromTier` trace field, `TIER_RANK`, `classifyTier`.
- Keep `withRetry`'s `maxAttempts` retry loop (no escalation, same model on retry).
- Refactor `extractModelTier(...)` → `extractModelId(...)`: returns the raw model ID string (e.g. `'us.anthropic.claude-sonnet-4-6'`) for observability, instead of mapping to `'haiku'|'sonnet'|'opus'|'unknown'`. Better Nova/Llama observability anyway.
- Drop `escalationPath: ['sonnet', 'opus']` from `advisory-narrative` retry options and `escalationPath: ['sonnet']` from `market-intelligence`.
- Update stale comments (`onboarding-bff/agents/onboarding/graph.ts:39`, `cdk-constructs/extensions/agent-runtime.ts:58`).
- Remove related tests (escalation, override).

Every `*.config.ts modelId` keeps its current value. No production behaviour changes from the user's perspective — only the internal plumbing.

## Done-definition

- `pnpm nx affected --target=test` passes.
- `pnpm nx affected --target=type-check` passes.
- `pnpm nx affected --target=lint` passes.
- Dev redeploy (`bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl`) succeeds.
- One advisory-pipeline e2e scenario in `apps/e2e-feature-tests` passes against deployed dev.
- After ship: `backlog-lint --fix` flips `agent-benchmark-skill` from parking → queued (or active) with the trigger sentence removed and a rationale appended.
