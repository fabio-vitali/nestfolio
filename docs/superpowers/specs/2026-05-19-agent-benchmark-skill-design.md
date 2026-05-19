# Agent benchmark skill — design spec

**Date**: 2026-05-19
**Backlog**: `docs/backlog/agent-benchmark-skill.md` (currently `status: parking` — promotes once the dependency below ships)
**Type**: design
**Depends on**: `simplify-agent-orchestrator-model-knob` (`docs/backlog/simplify-agent-orchestrator-model-knob.md` + `docs/superpowers/specs/2026-05-19-simplify-agent-orchestrator-model-knob-design.md`). That workstream removes the global `MODEL_ID_MAP` + escalation + `AGENT_MODEL_OVERRIDE` machinery, leaving each `*.config.ts`'s `modelId: string` as the unambiguous single source of truth. This spec is written **as if that workstream has already shipped** — it does not paper over the legacy escalation/override surface.
**Follow-up**: implementation plan filed separately at writing-plans handoff (post-dependency ship)

## 1. Context

The Nestfolio advisory domain runs 4 LangGraph services (`investor-profile-ctrl`, `market-intelligence-ctrl`, `portfolio-engine-ctrl`, `advisory-narrative-ctrl`), and inside them **6 distinct agent tasks**, each bound by its own `AgentConfig`. The benchmark's unit of work is the AgentConfig, not the service, because:

- Each `src/agents/<task>.config.ts` independently sets its `modelId: string` (raw Bedrock model ID), `maxTokens`, `temperature`, `schema` (Zod), and `promptTemplate`.
- A single service can host more than one task. `portfolio-engine-ctrl` today runs `portfolio-construction` on `claude-opus-4-6-v1` and `rebalance-planner` on `claude-sonnet-4-6` — different models, same service.
- Each `agents/<name>/graph.ts` simply wires the relevant configs into `createOrchestrator({ agents: { ... } })`.

The 6 production AgentConfigs as of 2026-05-19:

| Service | Config file | Export | Current `modelId` |
|---|---|---|---|
| investor-profile-ctrl | `src/agents/user-goals.config.ts` | `userGoalsConfig` (static) | `us.anthropic.claude-haiku-4-5-20251001-v1:0` |
| investor-profile-ctrl | `src/agents/risk-assessment.config.ts` | `riskAssessmentConfig` (static) | `us.anthropic.claude-sonnet-4-6` |
| market-intelligence-ctrl | `src/agents/market-research.config.ts` | `marketResearchConfig` (static) | `us.anthropic.claude-sonnet-4-6` |
| portfolio-engine-ctrl | `src/agents/portfolio-construction.config.ts` | `buildPortfolioConstructionConfig(mode)` (**builder fn**, parameterised on `OperatingMode`) | `us.anthropic.claude-opus-4-6-v1` (mode-invariant — same modelId for CONSERVATIVE/BALANCED/AGGRESSIVE; only the prompt template varies) |
| portfolio-engine-ctrl | `src/agents/rebalance-planner.config.ts` | `rebalancePlannerConfig` (static) | `us.anthropic.claude-sonnet-4-6` |
| advisory-narrative-ctrl | `src/agents/explainability.config.ts` | `explainabilityConfig` (static) | `us.anthropic.claude-haiku-4-5-20251001-v1:0` |

**Portfolio-construction special case**: it ships 3 prompt-template variants (one per OperatingMode) but a single shared `modelId`. The benchmark sweeps the BALANCED variant by default (most common production mode) and treats the recommendation as applying to all 3 — the model-choice question is mode-invariant given the modelId is shared. If the cross-task report ever surfaces evidence that a model's quality differs materially by mode, file a follow-on workstream to sweep CONSERVATIVE/AGGRESSIVE separately.

`createAgentNode` wraps `ChatBedrockConverse.withStructuredOutput(zodSchema)` against `config.modelId`. After the dependency workstream (`simplify-agent-orchestrator-model-knob`) ships, **`config.modelId` is the only model knob in the system** — used verbatim at runtime, no runtime escalation, no env-var override, no closed-set tier vocabulary. Production defaults live exclusively in the 6 `*.config.ts` files above.

These 6 picks have never been evaluated empirically against the task's actual prompt + input + Zod schema. With Claude 4.7 GA, Nova in steady state, and Llama 3.3 / Mistral Large available on Bedrock, a reproducible per-task sweep is needed to decide whether to keep, downgrade, or upgrade each choice. **Recommendations land as one-line edits to the matching `*.config.ts` file** — no ripple to other tasks.

The onboarding agent (`services/investor/onboarding-bff`) is **out of scope** — its invocation surface is multi-turn CopilotKit-driven, not a single structured-output call, and benchmarking it requires a different harness.

## 2. Goals

1. For each of the **6 AgentConfigs** (the production unit), produce per-(task, model) measurements of:
   - end-to-end latency (median, min, max across 3 runs by default; iteration count overridable via `--iterations`),
   - input + output token counts,
   - per-call USD cost (from current Bedrock pricing),
   - Zod-schema validation pass/fail,
   - the raw structured output (for Claude to evaluate semantically).
2. Use each task's **actual** `modelId`, `promptTemplate`, `schema`, `temperature`, `maxTokens` — imported directly from its `*.config.ts` file. Prompt drift in the codebase is automatically reflected.
3. Use **real** input state captured from one recent successful CloudWatch execution per task (each task receives a different state slice from the orchestrator — fixtures are per-task, not per-service).
4. Produce both per-task and cross-task reports rendered by Claude that include qualitative comments, per-model prompt-template suggestions, and a final recommendation reasoning over quality / cost / latency in light of that task's role.
5. Each recommendation maps to a **single-line edit** of the matching `*.config.ts`'s `modelId:` field.
6. Run on demand against the dev sandbox (`AWS_PROFILE=nestfolio-dev`, account `771924376645`, `us-east-1`).

## 3. Out of scope

(Mirrors backlog `out_of_scope:` — re-asserted here per CLAUDE.md spec rule.)

- The onboarding-bff agent (different invocation surface).
- `compliance-ctrl` (rule-based authority resolver, no LLM call site).
- Deployed AgentCore Runtime invocation path. Benchmarks run **locally** against Bedrock, using the agent's LangGraph node config — no per-model redeploy, no AgentCore cold-start noise polluting latency numbers.
- Auto-applying recommendations to `*.config.ts` files. Humans review the cross-task report and edit each `modelId:` line in a follow-on PR.
- Continuous / scheduled benchmark runs (this is a manual skill).
- Golden-output regression assertions (only schema-pass + Claude's purpose-anchored judgment).
- Reading actual billed cost from AWS billing line items (uses the free AWS Price List API instead).
- Frontend / e2e changes.

## 4. Architecture

### 4.1 Invocation layer (decided 2026-05-19)

Each task is invoked **directly** against Bedrock, locally, mirroring `createAgentNode` minus the orchestrator wrapping. The prompt is **replayed verbatim** from a Bedrock-invocation-log capture (see §6.1) — the benchmark does not perform `{input}` substitution on the production `promptTemplate` itself, because faithfully reconstructing the substituted state is fragile (memory context, KB context, mode framing, upstream wave outputs all flow through the production handler before reaching the model). Replaying the post-substitution prompt verbatim sidesteps that entirely.

```typescript
// pseudo
import { buildPortfolioConstructionConfig }
  from 'services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config';

const productionConfig = buildPortfolioConstructionConfig('BALANCED');
const { schema, maxTokens, temperature } = productionConfig;

// Fixture is the literal prompt captured from Bedrock invocation logging (§6.1).
const capturedPrompt: string = fixture.prompt;

const llm = new ChatBedrockConverse({ model: modelId, maxTokens, temperature, region: 'us-east-1' });
const structured = llm.withStructuredOutput(schema, { includeRaw: true });
const { raw, parsed } = await structured.invoke(capturedPrompt);
// raw.usage_metadata: { input_tokens, output_tokens, total_tokens }
```

The benchmark imports the production `AgentConfig` (or builder, for portfolio-construction) directly. The only sweep variable is `modelId`. Every other LLM-layer parameter — schema, tokens, temperature — is whatever production uses today. The prompt is the captured one. Rationale:

- **No redeploy** per model — the deployed AgentRuntime is locked to whatever `config.modelId` was at the last `deploy.sh`. Sweeping locally avoids 6 separate redeploys per run.
- **Clean latency** — no Docker cold-start, no AgentCore queue, no SF/SQS hop. Measures only the Bedrock call.
- **Cheap** — no Lambda/AgentCore/SF execution cost on top of Bedrock.
- **Realistic enough** — the same prompt, the same schema, the same `withStructuredOutput()` wrapping. The agent-factory `looksDegraded → REINFORCE_SUFFIX → second attempt` retry path is intentionally bypassed because the benchmark is measuring per-call behaviour; degraded outputs are visible via `schemaPass: false`.

### 4.2 Directory layout

Two committed trees + one gitignored tree. The benchmark's per-task config files live alongside the runner; they are thin wrappers around the production `*.config.ts` files plus a `models[]` sweep list.

```
scripts/benchmark-agents/                                # committed
├── run.ts                          # shared runner, args below
├── refresh-pricing.ts              # standalone — hits AWS Price List API
├── capture-fixture.ts              # standalone — pulls real input from CloudWatch
├── pricing-loader.ts               # reads pricing cache, computes per-call USD
├── lib/
│   ├── invoke-model.ts             # wraps ChatBedrockConverse.withStructuredOutput
│   ├── timings.ts                  # hrtime helpers, percentile aggregation
│   └── types.ts                    # IterationResult, ModelSweep, TaskSweepResult
└── tasks/                          # one file per AgentConfig (6 total)
    ├── user-goals.bench.ts
    ├── risk-assessment.bench.ts
    ├── market-research.bench.ts
    ├── portfolio-construction.bench.ts
    ├── rebalance-planner.bench.ts
    └── explainability.bench.ts

.claude/skills/benchmark-agents/                         # committed
└── SKILL.md                        # the orchestration playbook for Claude

benchmarks/                                              # gitignored ENTIRELY
├── cache/
│   └── pricing.json                # {fetchedAt, models: {modelId: {input, output}}}
├── fixtures/                       # one per task (6 total)
│   ├── user-goals.input.json
│   ├── risk-assessment.input.json
│   ├── market-research.input.json
│   ├── portfolio-construction.input.json
│   ├── rebalance-planner.input.json
│   └── explainability.input.json
└── tasks/
    ├── <task-name>/<ISO-timestamp>/
    │   ├── raw-results.json        # produced by run.ts
    │   └── evaluation.md           # produced by Claude reading raw-results.json
    └── _summary/<ISO-timestamp>/
        └── cross-task-report.md    # produced by Claude after all tasks done
```

`benchmarks/` is added to `.gitignore` in the implementation plan.

### 4.3 Per-task bench config shape

Each `scripts/benchmark-agents/tasks/<task>.bench.ts` imports the production `AgentConfig` (or builder) from the matching `*.config.ts` and adds metadata + the sweep list + an optional `validationRule` import for richer signal capture (§6.3):

```typescript
import { buildPortfolioConstructionConfig }
  from '../../../services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config';
import { portfolioValidationRule }
  from '../../../services/advisory/portfolio-engine-ctrl/src/agents/validation';

export const benchConfig: TaskBenchConfig = {
  taskName: 'portfolio-construction',
  service: 'portfolio-engine-ctrl',
  configFilePath:
    'services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config.ts',
  // Pin the canonical sweep mode for builder-fn configs (portfolio-construction only).
  // Static-export tasks omit this field.
  operatingMode: 'BALANCED',
  fixturePath: 'benchmarks/fixtures/portfolio-construction.input.json',
  // Resolved production AgentConfig — used verbatim except for `modelId`,
  // which the sweep overrides:
  productionConfig: buildPortfolioConstructionConfig('BALANCED'),
  // Production validation rule, if any — used to compute validationPass per
  // iteration (§6.3). Null if this task has no rule.
  validationRule: portfolioValidationRule,
  // Models to sweep at this task's modelId slot:
  models: [
    'us.anthropic.claude-sonnet-4-6',
    'us.anthropic.claude-sonnet-4-7',
    'us.anthropic.claude-opus-4-6-v1',
    'us.anthropic.claude-opus-4-7',
    'us.amazon.nova-premier-v1:0',
  ],
};
```

For static-export tasks (the other 5), the import is the named const (`userGoalsConfig`, `riskAssessmentConfig`, etc.) and `operatingMode` is omitted. The bench file's only authored content is the metadata (`taskName`, `service`, `configFilePath`, optional `operatingMode`) and the `models[]` candidates. Importing the production exports directly makes prompt/schema drift a compile error rather than a silent skew — if the production config or validation file removes/renames an export, the bench config fails to build.

## 5. Per-task model lists

Curated per task based on (a) structural strictness of the task's Zod schema, (b) downstream stakes, (c) known model strengths on structured-output tool calls, (d) current production model (as a quality reference point). All IDs are us-east-1 cross-region inference profile IDs where required by Bedrock.

| Task (service) | What it does | Current model | Models in sweep |
|---|---|---|---|
| **user-goals** (investor-profile-ctrl) | Extracts structured goals from onboarding answers. Low-to-moderate schema, simple extraction. | `claude-haiku-4-5` | `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-sonnet-4-7`, `nova-lite-v1`, `nova-pro-v1` |
| **risk-assessment** (investor-profile-ctrl) | Maps user inputs → RiskEvaluation. Moderate reasoning + strict schema. | `claude-sonnet-4-6` | `claude-sonnet-4-6`, `claude-sonnet-4-7`, `claude-opus-4-6`, `nova-pro-v1`, `nova-premier-v1` |
| **market-research** (market-intelligence-ctrl) | Synthesises multi-adapter financial data → MarketAnalysisOutput. Numerical reasoning + strict schema. | `claude-sonnet-4-6` | `claude-sonnet-4-6`, `claude-sonnet-4-7`, `claude-opus-4-6`, `nova-pro-v1`, `nova-premier-v1` |
| **portfolio-construction** (portfolio-engine-ctrl) | Produces the portfolio allocation. Highest stakes; currently the only opus site. | `claude-opus-4-6-v1` | `claude-sonnet-4-6`, `claude-sonnet-4-7`, `claude-opus-4-6`, `claude-opus-4-7`, `nova-premier-v1` |
| **rebalance-planner** (portfolio-engine-ctrl) | Produces RebalancePlan. Mid-stakes structured output. | `claude-sonnet-4-6` | `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-sonnet-4-7`, `nova-lite-v1`, `nova-pro-v1` |
| **explainability** (advisory-narrative-ctrl) | User-facing explanation prose. Lowest structural strictness — non-Claude viable. | `claude-haiku-4-5` | `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-sonnet-4-7`, `nova-lite-v1`, `nova-pro-v1`, `meta.llama-3-3-70b-instruct-v1:0`, `mistral.mistral-large-2407-v1:0` |

Total sweep size: 32 (task, model) combos × 3 iterations = **96 Bedrock calls** per default full run.

Order-of-magnitude expected cost per full run: ~$7–$20 depending on opus share of token volume. (Final number computed from `pricing.json` at runtime; this is a planning estimate only.)

**Model ID verification step (at implementation time)**: the model IDs above are spec-time guesses, especially for the non-Claude rows. Before the first sweep, verify each against the live Bedrock model list and the AWS Pricing API:

```bash
AWS_PROFILE=nestfolio-dev aws bedrock list-foundation-models --region us-east-1 \
  --query 'modelSummaries[?providerName==`Meta` || providerName==`Mistral AI` || providerName==`Amazon`].[modelId,providerName,modelName]' \
  --output table
```

`refresh-pricing.ts` will fail loudly on any model ID that has no SKU in the Pricing API — that's the implementation-time gate. Replace dashes/prefixes per Bedrock's canonical IDs (e.g. `meta.llama3-3-70b-instruct-v1:0` typically has no dash between "llama" and "3"; Nova IDs are usually `amazon.nova-pro-v1:0` without the `us.` inference-profile prefix; Mistral may be `mistral.mistral-large-2411-v1:0` rather than `-2407`). The spec table is illustrative; the bench configs commit the verified IDs.

## 6. Components

### 6.1 `capture-fixture.ts`

Standalone. Args: `--task <name>`. Captures the **literal post-substitution prompt** Bedrock saw in a recent dev decision cycle, not the pre-substitution `state.input`. Rationale: the `AgentTraceEnvelope` interface in `libs/agent-orchestrator/src/agent-tracer.ts` carries no `nodeInput` or rendered-prompt field (verified — the envelope has `llmCalls`, `toolCalls`, `nodeSequence`, `errors`, but never the prompt body). Reconstructing the prompt offline would require replicating each service handler's enrichment logic (memory context, KB retrieval, mode framing, upstream wave outputs). Replaying the captured prompt verbatim avoids all of that.

**Prerequisite (one-time setup, documented in the implementation plan)**: Bedrock model invocation logging must be enabled on the dev account, with CloudWatch as a destination. AWS console → Bedrock → Settings → Model invocation logging → enable → CloudWatch log group (e.g. `/aws/bedrock/dev-invocations`). Each model call produces a log entry containing the full request body (including the prompt text) and response.

**Capture algorithm**:

1. Load the bench config (`tasks/<task>.bench.ts`) to get the task's `productionConfig.promptTemplate` and its `productionConfig.modelId`.
2. Derive a **prompt prefix** from the production template: the contiguous static prefix before the first `{input}` placeholder (typically the system instruction — distinct per task by construction).
3. Query CloudWatch Logs Insights against the Bedrock invocation log group, in the last 24h, filtered by:
   - `modelId` matches the production `modelId` (catches the right model in case multiple are active),
   - request body's `messages[].content` (or `prompt`, depending on Bedrock's log schema for the Converse API) starts with the derived prefix,
   - response `status == 'success'`.
4. Pick the most recent match. Extract the full prompt string.
5. Write `benchmarks/fixtures/<task>.input.json`:

   ```json
   {
     "capturedAt": "2026-05-19T14:23:01Z",
     "modelId": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
     "logStreamName": "...",
     "promptPrefixHash": "sha256:...",
     "prompt": "<full prompt verbatim>"
   }
   ```

6. Idempotent — re-running overwrites with a fresher capture.

If no successful matching invocation is found in the window, exits non-zero with a message asking the user to (a) trigger a fresh dev decision-cycle, (b) verify invocation logging is enabled, (c) check that the task's prompt prefix hasn't recently changed (a prefix change would not match historical logs — the script's error message includes the prefix it tried).

**Cross-reference**: the prompt prefix is captured by hashing the static-prefix string (`promptPrefixHash`) so future capture runs can detect a prompt-template drift between fixture and current production code without needing to re-run.

### 6.2 `refresh-pricing.ts`

Standalone. No args. Calls AWS Price List Query API (`pricing.us-east-1.amazonaws.com`, `GetProducts`) for each Bedrock model ID across the union of all 6 task bench configs' `models[]`. Writes:

```json
{
  "fetchedAt": "2026-05-19T14:00:00Z",
  "models": {
    "us.anthropic.claude-sonnet-4-6": { "inputUSDPerMTok": 3.0, "outputUSDPerMTok": 15.0 },
    "us.anthropic.claude-opus-4-6-v1": { "inputUSDPerMTok": 15.0, "outputUSDPerMTok": 75.0 },
    "...": "..."
  }
}
```

The AWS Price List API is **free of charge**. Latency budget: ~5s for ~10 models.

### 6.3 `run.ts`

Args:

- `--task <name>` (required) — which task to sweep. Must match one of the 6 bench config `taskName`s.
- `--iterations <N>` (optional, default `3`) — runs per (task, model) combo.
- `--refresh-pricing` (optional) — force re-fetch of `pricing.json` regardless of age.

Behaviour:

1. Loads `tasks/<task>.bench.ts` (and through it the task's production `AgentConfig` — schema, maxTokens, temperature, and optional `validationRule`).
2. Loads `benchmarks/fixtures/<task>.input.json` — uses `fixture.prompt` verbatim as the prompt body (no substitution).
3. Loads `benchmarks/cache/pricing.json`. If missing or older than 7 days (or `--refresh-pricing`), invokes `refresh-pricing.ts` first.
4. For each `modelId` in `benchConfig.models`:
   - Constructs the LLM: `const llm = new ChatBedrockConverse({ model: modelId, maxTokens: productionConfig.maxTokens, temperature: productionConfig.temperature, region: 'us-east-1' });`
   - Wraps with `includeRaw: true` so token usage is accessible: `const structured = llm.withStructuredOutput(productionConfig.schema, { includeRaw: true });`
   - Invokes `N` times: `const { raw, parsed } = await structured.invoke(fixture.prompt);`
   - Per iteration captures:
     - `latencyMs` — `process.hrtime` around `.invoke()`.
     - `inputTokens` + `outputTokens` — read from `raw.usage_metadata.input_tokens` and `raw.usage_metadata.output_tokens` (LangChain's standard `usage_metadata` field on `AIMessage`, populated by `@langchain/aws`'s `ChatBedrockConverse`). **Do NOT use the `output.llmOutput.tokenUsage` path** — that's the path the production AgentTracer uses, and it returns zero for ChatBedrockConverse (see backlog `agent-tracer-bedrock-converse-token-extraction`). `includeRaw: true` gives access to the raw `AIMessage` which carries `usage_metadata` correctly.
     - `costUSD` — computed via `pricing-loader.ts`.
     - `schemaPass: boolean` — true if `.invoke()` returned without throwing; false on any thrown error.
     - `notDegraded: boolean | null` — runs the same `looksDegraded(parsed, schema)` check the production `agent-factory.ts` performs (import `looksDegraded` from `@nestfolio/agent-orchestrator`). `true` means the output has populated values for required schema keys; `false` means empty/null required fields (production would trigger the REINFORCE_SUFFIX retry). `null` when `schemaPass: false` (no output to check).
     - `validationPass: boolean | null` — if `benchConfig.validationRule` is set, runs `rule.validate(parsed, { state: {}, attempt: 0 })` and records `result.valid`. `null` when either the task has no rule, or `schemaPass: false`.
     - `output` — the raw parsed object (`parsed`), or `null` on schema fail.
     - `error` — the error message on schema fail, or `null` on success.
5. Writes `benchmarks/tasks/<task>/<ISO-timestamp>/raw-results.json` (full shape in §7).
6. Prints the output path to stdout — that's how Claude picks it up.

The triplet `(schemaPass, notDegraded, validationPass)` mirrors the three production-side gates: Zod schema validation → agent-factory's `looksDegraded` check → `withValidation` semantic rule. A model that passes all three is **production-viable** for this task; passing only `schemaPass` is necessary but not sufficient (production would either trigger the REINFORCE_SUFFIX retry or escalate to fallback).

Throttling: Bedrock opus tiers can throttle at sustained QPS. The script issues calls **sequentially**, never in parallel — keeps the script simple, eliminates noisy throttle retries.

### 6.4 `pricing-loader.ts`

Pure helper. Given a `modelId` + token counts, returns USD. Warns (does not fail) if `pricing.json.fetchedAt` is > 7 days old.

## 7. Data format — `raw-results.json`

```typescript
type RawResults = {
  taskName: string;            // e.g. "portfolio-construction"
  service: string;             // e.g. "portfolio-engine-ctrl"
  configFilePath: string;      // for recommendation pointer
  fixturePath: string;
  iterationsPerCombo: number;
  startedAt: string;      // ISO
  finishedAt: string;     // ISO
  pricingFetchedAt: string;
  models: ModelSweep[];
};

type ModelSweep = {
  modelId: string;
  iterations: IterationResult[];
  aggregates: {
    schemaPassRate: `${number}/${number}`;        // e.g. "3/3"
    notDegradedRate: `${number}/${number}`;       // out of `schemaPass` iterations
    validationPassRate: `${number}/${number}` | null;  // null if task has no validation rule
    medianLatencyMs: number;
    minLatencyMs: number;
    maxLatencyMs: number;
    medianCostUSD: number;
    totalCostUSD: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
};

type IterationResult = {
  ix: number;                              // 0..N-1
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  schemaPass: boolean;
  notDegraded: boolean | null;             // null when schemaPass=false
  validationPass: boolean | null;          // null when no rule or schemaPass=false
  output: Record<string, unknown> | null;
  error: string | null;
};
```

Schema is stable so Claude (and any future tooling) can consume it without per-version branching.

## 8. The skill — `.claude/skills/benchmark-agents/SKILL.md`

Invocation forms:

- `/benchmark-agents` — sweeps all 6 tasks, 3 iterations each.
- `/benchmark-agents <task1>,<task2>` — sweeps the listed tasks only (names match bench config `taskName`).
- `/benchmark-agents --iterations <N>` — overrides default iteration count.
- Combinations allowed: `/benchmark-agents portfolio-construction --iterations 5`.

The argv allowlist contains the 6 task names: `user-goals`, `risk-assessment`, `market-research`, `portfolio-construction`, `rebalance-planner`, `explainability`. Any other value is rejected — keeps `onboarding-bff` and arbitrary names from sneaking in.

**Argv parsing happens at the skill layer, not the runner layer.** The skill SKILL.md instructs Claude to parse the `/benchmark-agents` argv (comma-list of tasks + `--iterations` flag), validate against the 6-name allowlist, then invoke `run.ts` **once per task** in sequence. `run.ts --task <name>` is single-valued — it has no comma-list parsing. This split keeps the runner dumb (one task, one model sweep, one results file) and concentrates orchestration in the skill where Claude can recover from a per-task failure without losing the others.

Skill instructs Claude to:

1. **Preflight.** Verify `AWS_PROFILE=nestfolio-dev` is set; if not, ask the user. Verify `pnpm` available.
2. **Fixtures.** For each requested task missing `benchmarks/fixtures/<task>.input.json`, run `pnpm tsx scripts/benchmark-agents/capture-fixture.ts --task <name>`.
3. **Pricing.** If `benchmarks/cache/pricing.json` is missing or > 7 days old, run `pnpm tsx scripts/benchmark-agents/refresh-pricing.ts`.
4. **Sweep loop (sequential per task).** For each requested task:
   - Run `pnpm tsx scripts/benchmark-agents/run.ts --task <name> [--iterations <N>]`. Capture the printed `raw-results.json` path.
   - Read `raw-results.json`.
   - Write `benchmarks/tasks/<task>/<ISO>/evaluation.md` with:
     - **Header.** Task name, owning service, production config file path, fixture path, fixture `capturedAt`, run timestamp, iterations per combo, total cost.
     - **Comparison table.** `model | runs | schemaPass | notDegraded | validationPass | medianLatency | medianCost | totalCost`. Current production model is marked with `(current)` in the row label. A model with `schemaPass=3/3` but `validationPass=0/3` is highlighted as NOT production-viable despite the schema-pass.
     - **Per-model section.** For each model: one paragraph commenting on (a) output semantic quality vs the task's purpose (e.g. for portfolio-construction: "is the allocation coherent given the input mandate and market snapshot"), (b) any optional prompt-template suggestion that might lift this model specifically (e.g. "Llama 3.3 dropped the `rationale` field on 2/3 runs — adding an explicit `Return EVERY field, including rationale` suffix would likely fix this"), (c) the three-gate status (schemaPass / notDegraded / validationPass) read as a production-viability verdict.
     - **Final recommendation.** Explicit reasoning over quality / cost / latency anchored in this task's role. Example: "*portfolio-construction outputs the portfolio allocation — quality dominates cost. `sonnet-4-7` passed all three gates 3/3 with X% lower latency and Y% lower cost than the current opus-4-6 default. Recommend changing `modelId` inside `buildPortfolioConstructionConfig` in `services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config.ts` from `us.anthropic.claude-opus-4-6-v1` to `us.anthropic.claude-sonnet-4-7`. (Builder function — same modelId applies across all 3 OperatingModes.)*"
5. **Cross-task summary.** After all requested tasks are done, write `benchmarks/_summary/<ISO>/cross-task-report.md`:
   - **Per-task recommendation snapshot.** Table: task | service | current model | recommended model | quality verdict | cost delta per call | latency delta per call | config file to edit.
   - **Projected cost-per-decision-cycle delta.** Sums each task's per-call cost across one decision-workflow run (1 call per task per cycle) → "$X today vs $Y recommended".
   - **Cross-cutting observations.** Patterns visible only when looking across tasks (e.g. "Nova Pro consistently faster than Sonnet 4.6 on structured-output across all 5 task types tried", or "Llama 3.3 70B failed schema 2/3 on explainability → not viable anywhere").
   - **Action items.** Concrete edit list, one entry per task whose recommendation differs from current. Format:
     - **Static-export tasks** (5 of 6): `services/advisory/<service>/src/agents/<task>.config.ts` — change `modelId` from `<current>` to `<recommended>`. (Single-line edit, identifiable by the unique `modelId:` line in the file.)
     - **portfolio-construction** (builder function): `services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config.ts` — change the `modelId` value inside `buildPortfolioConstructionConfig`. Note: the modelId is shared across all 3 OperatingModes (CONSERVATIVE/BALANCED/AGGRESSIVE) since only the prompt template varies by mode, so a single edit applies everywhere.

Claude never edits any `*.config.ts` from within the skill — recommendations are read-only output. (After `simplify-agent-orchestrator-model-knob` ships, the global `MODEL_ID_MAP` no longer exists; there is nothing else to touch.)

## 9. Determinism, retries, and noise

- **Temperature.** Whatever each task's `*.config.ts` declares is what gets used. Per-iteration variance is the point of `iterations: 3` (overridable via `--iterations`).
- **Schema-degraded retries.** The agent-factory's `looksDegraded → REINFORCE_SUFFIX → second attempt` path is **deliberately not replicated** in the benchmark. It would hide a model's first-attempt reliability behind the retry. The benchmark captures `notDegraded` as a separate signal so Claude's evaluation can still reason about whether the first-attempt output would have survived the production retry guard.
- **Token extraction path.** The benchmark reads `raw.usage_metadata.input_tokens` / `output_tokens` via `withStructuredOutput(..., { includeRaw: true })`. The production AgentTracer reads `output.llmOutput.tokenUsage` instead and currently returns 0 for ChatBedrockConverse (open bug — see backlog `agent-tracer-bedrock-converse-token-extraction`). The benchmark's choice is independent and gives correct counts. If the AgentTracer bug is fixed before this workstream ships, both paths converge; if not, the benchmark's token + cost numbers remain authoritative.
- **Throttling.** Sequential calls only. If Bedrock returns a `ThrottlingException`, the iteration is recorded as `error: "ThrottlingException ..."`, `schemaPass: false`. Claude treats this in the eval — typically as "rerun this combo" guidance.
- **AWS credential expiry.** Long sweeps (especially opus with 25–30s latencies) can outlive an SSO/Granted session. The runner re-checks the AWS SDK's credential provider on every model boundary; if expired, exits non-zero with the path to the partial results so a resumed run can stitch.

## 10. Risks

| Risk | Mitigation |
|---|---|
| CloudWatch capture script grabs a *failed* execution by mistake | Filter on the AgentTracer envelope's `outcome: success` field, not just on log presence. Also filter on `nodeName === <task>`. |
| Production `*.config.ts` exports get renamed/removed | Acceptable — the bench file build fails loudly via the direct import. Better than silent drift between benchmark prompt and runtime prompt. |
| Bedrock model IDs change (e.g. new `-v2` profiles) | Per-task `models[]` lists are explicit; updating them is a one-line PR per task. AWS Pricing API will surface the new SKUs automatically. |
| `pricing.json` goes stale and reports drift from billed cost | `--refresh-pricing` flag + > 7-day warning. Worst case the cross-task report's projected delta is slightly off — never a correctness issue. |
| Llama / Mistral schema failures dominate the explainability sweep | That **is** the signal — they're in the sweep precisely to test whether they're viable for narrative-style output. The cross-task report will name them as "not viable" if so. |
| Onboarding agent re-included by mistake | Skill argv parser whitelists only the 6 production task names; `onboarding`, service names, or arbitrary strings are rejected. |
| Two AgentConfigs in the same service get different recommendations that conflict (e.g. portfolio-construction → sonnet, rebalance-planner → haiku) | This is **expected and supported** — each `*.config.ts` is independent. The cross-task report makes the per-task verdicts visible; humans review and edit each config file separately. |

## 11. Implementation order (for the writing-plans handoff)

The plan will sequence roughly:

1. Skeleton — types, directory layout, the **6 per-task bench configs** (compile-only, no execution yet). Each bench config imports the production `AgentConfig` from `services/advisory/.../src/agents/<task>.config.ts`.
2. `refresh-pricing.ts` + `pricing-loader.ts` (independent, easy to test).
3. `capture-fixture.ts` (needs CloudWatch perms — verify against dev account). Per-task fixture, sourced from the matching AgentTracer envelope `nodeInput`.
4. `run.ts` — single task, single model first; expand to full sweep.
5. The skill `SKILL.md` (Claude-side orchestration).
6. End-to-end dry run on `explainability` first (cheapest sweep — current model is haiku, narrative output, least production-critical fallback if a script bug runs up cost).
7. Full sweep across all 6 tasks.
