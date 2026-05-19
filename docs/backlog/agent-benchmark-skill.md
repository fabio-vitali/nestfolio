---
id: agent-benchmark-skill
type: design
notes: "Benchmark skill + shared TS runner + per-task bench configs that sweep multiple Bedrock models against each of the 6 production AgentConfigs across the 4 LangGraph advisory services (user-goals, risk-assessment, market-research, portfolio-construction, rebalance-planner, explainability) using locally-invoked withStructuredOutput() calls against the dev sandbox (AWS_PROFILE=nestfolio-dev). The unit of work is the AgentConfig, not the service — each task has its own modelId, schema, prompt, and gets its own one-line config-file recommendation. Each script captures latency / token usage / schema-pass / raw output per iteration; Claude orchestrates the sweep and writes per-task + cross-task evaluation reports under gitignored benchmarks/. Onboarding-bff explicitly excluded. Sequenced behind `simplify-agent-orchestrator-model-knob` — that workstream removes the MODEL_ID_MAP + escalation + override machinery; this spec is written for the post-simplification system shape (config.ts modelId as the only model knob)."
references:
  - libs/agent-orchestrator/src/agent-factory.ts
  - libs/agent-orchestrator/src/types.ts
  - services/advisory/investor-profile-ctrl/src/agents/user-goals.config.ts
  - services/advisory/investor-profile-ctrl/src/agents/risk-assessment.config.ts
  - services/advisory/market-intelligence-ctrl/src/agents/market-research.config.ts
  - services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config.ts
  - services/advisory/portfolio-engine-ctrl/src/agents/rebalance-planner.config.ts
  - services/advisory/advisory-narrative-ctrl/src/agents/explainability.config.ts
out_of_scope:
  - onboarding-bff agent (explicitly excluded by user — different invocation surface, CopilotKit-driven multi-turn, not a single-shot structured-output call).
  - compliance-ctrl mode-aware authority resolver (rule-based, no LLM call site).
  - Deployed AgentCore Runtime invocation path (chose local LangGraph-node invocation to avoid per-model redeploys + AgentCore cold-start noise).
  - Auto-applying recommendations back to MODEL_ID_MAP — humans review the cross-agent report and edit agent-factory.ts manually.
  - Continuous / scheduled benchmark runs — this is a manual on-demand skill, not a CI gate.
  - Golden-output regression assertions — only schema validation + Claude's purpose-anchored judgment.
  - Cost-per-token computation by reading the AWS billing line items — benchmark uses the free AWS Pricing API (List API) instead.
  - Frontend / e2e impact — purely a developer-side skill.
spec: docs/superpowers/specs/2026-05-19-agent-benchmark-skill-design.md
plan: docs/superpowers/plans/2026-05-19-agent-benchmark-skill.md
topic_memory:
  - project_agent_orchestrators.md
  - project_agent_runtime_structured_output.md
  - project_lambda_profile_system.md
status: shipped
validation_gate: |
  Shipped 2026-05-19. Implementation: 9 commits f545fce0..f855ac72 on branch worktree-agent-benchmark-skill.
  Final reviewer verdict: Ready to ship. Jest harness 15/15 green; lint clean across 5 advisory projects;
  refresh-pricing.ts writes a 10-entry pricing.json from the checked-in manifest.

  Full sweep run 2026-05-19T21 — 5 of 6 agents (market-research skipped: IP+MI moved to continuous
  projection per advisory-cycle-agent-precomputation-impl, no recent dev invocation existed). Per-task
  total cost = $0.93 (well below the spec's $7-$20 estimate; smaller fixtures + zero-cost failed rows).

  Per-task evaluations (5):
    benchmarks/tasks/user-goals/2026-05-19T21-06-50-892Z/evaluation.md
    benchmarks/tasks/risk-assessment/2026-05-19T21-07-46-127Z/evaluation.md
    benchmarks/tasks/portfolio-construction/2026-05-19T21-09-39-575Z/evaluation.md
    benchmarks/tasks/rebalance-planner/2026-05-19T21-11-29-611Z/evaluation.md
    benchmarks/tasks/explainability/2026-05-19T21-13-34-934Z/evaluation.md

  Cross-task report:
    benchmarks/_summary/2026-05-19T21-15-00Z/cross-task-report.md

  Headline result: applying all 5 recommendations cuts cost-per-decision-cycle from $0.165 to $0.031 (81%
  reduction on the swept 5 agents, BALANCED mode, fixture-derived; 1 call per agent assumed).
  Recommendations all surface in the cross-task §5 action items — humans review + edit each *.config.ts
  in a follow-on PR per spec §3.

  Known gaps (filed as follow-ups, not blockers):
    - market-research not swept (MI continuous projection trigger)
    - 5 modelIds returned ValidationException/AccessDeniedException on dev (sonnet-4-7, opus-4-7,
      nova-premier, llama3-3-70b, mistral-large-2407) — Bedrock model access not granted on dev account
      OR inference-profile form has shifted
    - Pricing manifest hand-transcribed (no live verification — AWS pricing page is JS-rendered)
---

# Agent benchmark skill

## Why

`MODEL_ID_MAP` in `libs/agent-orchestrator/src/agent-factory.ts` hardcodes `haiku-4-5 / sonnet-4-6 / opus-4-6` as the only available tiers; each per-agent `graph.ts` picks one. These choices were made ad-hoc — there is no evidence base showing the current tier is the right cost/quality/latency point for each agent's specific structured-output task. With Claude 4.7 family now GA, Nova in steady state, and Llama 3.3 / Mistral Large available on Bedrock, a reproducible sweep is needed.

## What

A Claude skill (`/benchmark-agents`) that:

1. Runs a per-agent benchmark script (shared TS runner + per-agent config) against each of the 4 advisory LangGraph agents, locally invoking the agent's `withStructuredOutput()` node directly against Bedrock (`AWS_PROFILE=nestfolio-dev`) using:
   - the agent's actual prompt template + Zod schema + maxTokens (imported from its `graph.ts`),
   - a real captured input state (one CloudWatch-pulled execution per agent, frozen as a JSON fixture),
   - a curated per-agent model list (Claude family always, Nova where relevant, Llama/Mistral only on narrative).
2. Iterates `N` times per (agent, model) — default 3, overridable.
3. Captures per-iteration latency / token usage / per-call USD cost (from AWS Pricing API cache) / schema-pass / raw output.
4. Claude reads each agent's raw results and writes a Markdown evaluation including per-iteration comments + per-model prompt-template suggestions + a final recommendation reasoned over quality/cost/latency in light of that agent's role.
5. After all selected agents complete, Claude writes a cross-agent summary report (tables, projected cost-per-cycle delta, action items naming the specific `MODEL_ID_MAP` edits).

## Done-definition

- Skill invokable via `/benchmark-agents` and `/benchmark-agents <agent1,agent2>` and `/benchmark-agents --iterations <N>`.
- Per-agent + cross-agent reports produced under `benchmarks/` (gitignored) for one full end-to-end run.
- Captured fixtures and AWS Pricing cache present + reproducible.
- Recommendations applied to `MODEL_ID_MAP` reviewed in a separate, follow-on PR (not part of this workstream's ship gate).
