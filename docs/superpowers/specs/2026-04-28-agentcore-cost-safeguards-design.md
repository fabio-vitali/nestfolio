# AgentCore Cost Safeguards — Design

**Date:** 2026-04-28
**Status:** Design (pending approval — no deploy yet)
**Trigger:** 2026-04-21 cost spike — $55.80 in one day (AgentCore Runtime $7.71 + Claude models $47.81). AWS Q analysis attached in conversation.
**Caps decision:** Tight — `maxTokens=2048`, LangGraph `recursionLimit=10`.

---

## 1. Problem

On 2026-04-21 a single-day spend of $55.80 was observed, dominated by
Claude model invocations ($47.81). Existing CostControls (monthly $200
budget, 50%-of-monthly-in-6h spike alarm ≈ $100) **did not fire** — the
spike sat below the 6h trigger but was an order of magnitude above the
sustainable per-day rate (≈ $1700/mo if held).

We need:

1. **Hard caps** so a runaway agent cannot generate this volume of
   tokens again, regardless of detection.
2. **Detection within hours** of any future spike — not within months
   of breaching a budget.
3. **Per-agent attribution** so the next investigation does not require
   a manual hunt through six services.

## 2. Root cause analysis

### 2.1 Uncapped onboarding agent (PRIMARY SUSPECT)

**File:** `services/investor/onboarding-bff/agents/onboarding/graph.ts:21-24`

```ts
const model = new ChatBedrockConverse({
  model: deps.modelId ?? 'anthropic.claude-sonnet-4-20250514',
  region: deps.region ?? 'us-east-1',
});
// no maxTokens, no recursionLimit on the StateGraph either
```

By contrast, all six advisory agents (`services/advisory/*/agents/*.config.ts`)
declare explicit `maxTokens` between 2048 and 8192 — they were not the
source.

The onboarding runtime redesign shipped 2026-04-28 (custom
`OnboardingAgent extends AbstractAgent`) drives this same uncapped model
via `streamEvents({ version: 'v2' })`. Even after the redesign, **caps
remain absent**.

### 2.2 No LangGraph recursionLimit

`buildOnboardingGraph` returns the StateGraph without a `recursionLimit`
on `.compile()` or on per-invocation config. LangGraph default is 25 —
enough for a tool-calling loop to cycle through Bedrock 25 times before
aborting.

### 2.3 AgentRuntime construct exposes only AWS-level lifecycle knobs

`libs/cdk-constructs/src/extensions/agent-runtime.ts:69-72`:

```ts
lifecycleConfiguration: {
  idleRuntimeSessionTimeout: props.idleTimeout ?? Duration.minutes(15),
  maxLifetime: props.maxLifetime ?? Duration.hours(4),
}
```

AWS Q's `maxIterations` / per-invocation `timeoutSeconds` / `maxTokens`
are **not AgentCore parameters** — they are application-level (LangGraph
+ LangChain Bedrock SDK). They cannot be enforced from CDK alone.

### 2.4 CostControls thresholds too loose for daily spikes

`libs/cdk-constructs/src/extensions/cost-controls.ts:52-64`:

- Budget: $200/month — only notifies on **% of monthly cumulative**.
- Spike alarm: `monthlyBudgetUsd * 0.5` = $100 over 6 hours.

A $55.80 day = ~$13.95 per 6h window on average. Below $100. **Silent.**

## 3. Three-tier safeguard plan

| Tier | Goal | Blast radius |
|---|---|---|
| **P0** | Hard caps — onboarding agent cannot run away again | onboarding-bff stack only |
| **P0.5** | Temporary Sonnet→Haiku floor (smart-skip Opus) until e2e green | `agent-orchestrator` lib + onboarding graph + AgentRuntime construct + advisory service stacks (env-var injection) |
| **P1** | Daily-budget detection + spike threshold tightening + per-service Bedrock metrics | investor-hub stack + new `BedrockUsageAlarms` extension construct |
| **P2** | Full observability — AgentCore Observability flag + cost-allocation tags + dashboard | All 5 AgentRuntime stacks (advisory-ctrl, advisory-narrative-ctrl, market-intelligence-ctrl, investor-profile-ctrl, portfolio-engine-ctrl, onboarding-bff) |

P0 is the only tier required to prevent recurrence. P1 ensures detection
even if a future agent slips uncapped. P2 is for forensic depth.

---

## 4. P0 — Hard caps (onboarding-bff)

### 4.1 Cap `maxTokens` on the Bedrock model

**File:** `services/investor/onboarding-bff/agents/onboarding/graph.ts`

```diff
   const model = new ChatBedrockConverse({
     model: deps.modelId ?? 'anthropic.claude-sonnet-4-20250514',
     region: deps.region ?? 'us-east-1',
+    maxTokens: 2048,
+    temperature: 0,
   });
```

**Rationale:** 2048 matches `services/advisory/investor-profile-ctrl/src/agents/user-goals.config.ts:7`. Onboarding turns are short Q&A — never need more.
`temperature: 0` is added to match advisory agents and reduce variability
that costs tokens via retries. Easy to relax later if a phase legitimately
needs headroom.

### 4.2 Add `recursionLimit` at graph compile time

**File:** `services/investor/onboarding-bff/agents/onboarding/graph.ts`

The compiled graph is invoked through `OnboardingAgent`'s
`streamEvents({ version: 'v2' })` call. LangGraph honours
`config.recursionLimit` per invocation. Two options:

- **(chosen)** Pass `{ recursionLimit: 10 }` in the
  `streamEvents` call site — keeps graph builder pure.
- (rejected) Bake into `.compile({ recursionLimit })` — not supported
  by all LangGraph versions; per-invocation is canonical.

**File:** `services/investor/onboarding-bff/agents/onboarding/agent.ts`
(the custom `OnboardingAgent` class — locate the `streamEvents` call):

```diff
-  const stream = compiledGraph.streamEvents(input, { version: 'v2' });
+  const stream = compiledGraph.streamEvents(input, {
+    version: 'v2',
+    recursionLimit: 10,
+  });
```

If the project encodes the option differently (LangGraph evolves
fast), the equivalent is `RunnableConfig.recursionLimit`. Verify
during implementation against the version pinned in `package.json`.

### 4.3 Tighten AgentRuntime lifecycle on onboarding stack

**File:** `services/investor/onboarding-bff/src/service.stack.ts` (locate
the `new AgentRuntime(this, 'AgentRuntime', { ... })` call):

```diff
   new AgentRuntime(this, 'AgentRuntime', {
     runtimeName: ...,
     agentCodePath: ...,
+    idleTimeout: Duration.minutes(5),
+    maxLifetime: Duration.hours(1),
     ...
   });
```

**Rationale:** A 4-hour microVM lifetime is overkill for a 7-phase
wizard whose longest user pause is minutes. 5-minute idle reclaims VM
sooner — caller can always restart. Bills CPU/memory only while alive.

### 4.4 Apply the same caps to advisory agents that lack temperature=0

Audit pass — confirm all six advisory configs already have `temperature`
declared. If any are missing, add `temperature: 0`. **No `maxTokens`
changes needed** on advisory side.

---

---

## 4.5 P0.5 — Temporary model downgrade (smart-skip Opus)

**Goal:** Until end-to-end test suite is fully green, force Sonnet sites
to Haiku while preserving the 4 deliberately-Opus sites (chosen for
structured-output reliability against their Zod schemas). Belt-and-braces
with §4 caps. Reversible per deploy via CDK context.

### 4.5.1 Why smart-skip

10 LLM call sites today:
- **Haiku (2):** `advisory-ctrl/agents/config.ts:32` (narrative-builder), `investor-profile-ctrl/.../user-goals.config.ts:6`
- **Sonnet (5):** `market-research`, `explainability`, `rebalance-planner`, advisory-ctrl orchestrator + 2 advisory-ctrl agents
- **Opus (4):** `risk-assessment`, `portfolio-construction`, advisory-ctrl `config.ts:39` + `:53`

The 4 Opus sites were upgraded **deliberately** — earlier runs showed
Sonnet/Haiku producing structurally-invalid outputs against their
Zod schemas. Forcing them to Haiku trades cost for guaranteed e2e
failure on those specific agents. Skip them.

### 4.5.2 Override mechanism — `AGENT_MODEL_OVERRIDE` env var

**File:** `libs/agent-orchestrator/src/agent-factory.ts`

Add tier detection + override logic at the top of `createAgentNode`:

```ts
const TIER_ORDER = ['haiku', 'sonnet', 'opus'] as const;
type ModelTier = typeof TIER_ORDER[number];

const MODEL_ID_MAP: Record<ModelTier, string> = {
  haiku: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  sonnet: 'us.anthropic.claude-sonnet-4-6',
  opus: 'us.anthropic.claude-opus-4-6-v1',
};

function detectTier(modelId: string): ModelTier | null {
  if (modelId.includes('haiku')) return 'haiku';
  if (modelId.includes('sonnet')) return 'sonnet';
  if (modelId.includes('opus')) return 'opus';
  return null;
}

function applyOverride(modelId: string): string {
  const target = process.env.AGENT_MODEL_OVERRIDE as ModelTier | undefined;
  if (!target || !TIER_ORDER.includes(target)) return modelId;
  const currentTier = detectTier(modelId);
  if (!currentTier) return modelId;
  // Smart skip: NEVER downgrade Opus sites — they were chosen for
  // structured-output reliability. Override only applies tier-down.
  if (currentTier === 'opus') return modelId;
  // Only downgrade (never upgrade) — refuse override that would raise tier
  const targetIdx = TIER_ORDER.indexOf(target);
  const currentIdx = TIER_ORDER.indexOf(currentTier);
  if (targetIdx >= currentIdx) return modelId;
  return MODEL_ID_MAP[target];
}
```

Apply at the existing `effectiveModelId` resolution:

```diff
   const effectiveModelId = state.__escalationTier
     ? MODEL_ID_MAP[state.__escalationTier as string] ?? modelId
-    : modelId;
+    : applyOverride(modelId);
```

**Semantics:** `AGENT_MODEL_OVERRIDE=haiku` ⇒ Sonnet sites become Haiku;
Haiku stays Haiku; Opus stays Opus. Setting it to `sonnet` leaves
Sonnet/Haiku alone but does NOT downgrade Opus (smart-skip rule).
Unset ⇒ no-op. **Override never raises a tier** — escalation logic
remains the only path that bumps quality up.

### 4.5.3 Onboarding-bff override

**File:** `services/investor/onboarding-bff/agents/onboarding/graph.ts`

```diff
+const ONBOARDING_OVERRIDE_MAP: Record<string, string> = {
+  haiku: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
+  sonnet: 'us.anthropic.claude-sonnet-4-6',
+  opus:   'us.anthropic.claude-opus-4-6-v1',
+};
+
   export function buildOnboardingGraph(deps: GraphDeps, ...) {
+    const override = process.env.AGENT_MODEL_OVERRIDE;
+    const overrideId = override ? ONBOARDING_OVERRIDE_MAP[override] : undefined;
     const model = new ChatBedrockConverse({
-      model: deps.modelId ?? 'anthropic.claude-sonnet-4-20250514',
+      model: overrideId ?? deps.modelId ?? 'us.anthropic.claude-sonnet-4-6',
       region: deps.region ?? 'us-east-1',
+      maxTokens: 2048,
+      temperature: 0,
     });
```

(Also fixes the suspicious base-model fallback `claude-sonnet-4-20250514`
to a proper inference profile id.)

### 4.5.4 CDK context wiring

**Convention:** `--context agentModelOverride=haiku` at deploy time.

**File:** `libs/cdk-constructs/src/extensions/agent-runtime.ts`

In the `AgentRuntime` constructor, read context and merge into env:

```diff
+    const overrideContext = scope.node.tryGetContext('agentModelOverride');
+    const overrideEnv: Record<string, string> = overrideContext
+      ? { AGENT_MODEL_OVERRIDE: String(overrideContext) }
+      : {};
+
     this.runtime = new agentcore.Runtime(this, 'Runtime', {
       ...
-      environmentVariables: props.environmentVariables,
+      environmentVariables: { ...overrideEnv, ...props.environmentVariables },
     });
```

For advisory services where the orchestrator runs in a Lambda (not
AgentCore), wire via the Ingress lambda env. The cleanest place is
`Ingress.environment` per call site, OR a one-shot read at the top of
each advisory service stack:

```ts
const agentModelOverride = this.node.tryGetContext('agentModelOverride');
const overrideEnv = agentModelOverride
  ? { AGENT_MODEL_OVERRIDE: String(agentModelOverride) }
  : {};

new Ingress(this, 'Ingress', {
  state,
  eventTypes: [...],
  environment: { ...overrideEnv },
});
```

### 4.5.5 Operating procedure

```bash
# Dev account — force Haiku floor
pnpm cdk deploy --all --context agentModelOverride=haiku --profile dev

# Once e2e all-green: redeploy without the flag to restore production tiers
pnpm cdk deploy --all --profile dev
```

### 4.5.6 Rollback

`unset AGENT_MODEL_OVERRIDE` (i.e. redeploy without `--context`). No code
revert needed. Each service comes back at its original `.config.ts`
modelId on next cold-start.

### 4.5.7 Risk

If e2e fails on a Sonnet→Haiku site (e.g. `market-research` produces
invalid Zod), the failure is signal: that site really needs Sonnet. Two
options when this happens:
- Bump the site's `.config.ts` to use `'us.anthropic.claude-opus-4-6-v1'`
  permanently (joins the smart-skipped set)
- Or accept Sonnet as the per-site minimum and lift the override only
  for that service stack via `--context agentModelOverride=sonnet` for
  one stack-id (CDK supports per-stack context overrides via `cdk.json`).

---

## 5. P1 — Detection (investor-hub + new construct)

### 5.1 Add daily-budget alarm to CostControls

**File:** `libs/cdk-constructs/src/extensions/cost-controls.ts`

Add a second `CfnBudget` with `timeUnit: 'DAILY'` and a fixed USD
amount (default $30). New optional prop `dailyBudgetUsd`. Notification
at 80% and 100% to the same SNS topic.

### 5.2 Tighten spike alarm

Lower the 6h spike threshold from `monthlyBudgetUsd * 0.5` to
`monthlyBudgetUsd * 0.075` ≈ $15 / 6h for the current $200/mo budget.
Add prop `spikeRatio` so it can be tuned without editing the construct.

### 5.3 New `BedrockUsageAlarms` extension construct

**File (new):** `libs/cdk-constructs/src/extensions/bedrock-usage-alarms.ts`

Per-service CloudWatch alarms on `AWS/Bedrock` namespace:

- `Invocations` — alarm if > N per 5 min (configurable, default 100)
- `InputTokenCount` + `OutputTokenCount` — alarm on aggregate > M per
  5 min (configurable, default 500K input + 100K output)
- Dimensions: `ModelId` for tight attribution.

Wire alongside existing `addObservability()` call in each service stack
that has an AgentRuntime. SNS topic is the existing `CostAlertTopic`
exported from CostControls.

### 5.4 Cost-allocation tags

**File:** `libs/cdk-constructs/src/core/service-stack.ts` — confirm
`Tags.of(this).add('domain', ...)` and `add('service', ...)` are already
applied (memory says they are). No code change unless missing. **Then
manually activate the tags** in the AWS Billing console — this is a
one-time AWS Console action, **not CDK** (AWS limitation).

---

## 6. P2 — Observability (all AgentRuntime stacks)

### 6.1 Enable AgentCore Observability

`@aws-cdk/aws-bedrock-agentcore-alpha` exposes observability flags on
`Runtime`. Add `observability: { enabled: true }` to AgentRuntime
construct's underlying `agentcore.Runtime` constructor in
`libs/cdk-constructs/src/extensions/agent-runtime.ts:56-73`. Surface as
prop on `AgentRuntimeProps`, default `true`.

### 6.2 Per-agent CloudWatch dashboard

Extend `Monitoring` / `ServiceDashboard` (`libs/cdk-constructs/observability`)
with a Bedrock widget per service: token counts, invocation rate, error
rate by ModelId. Out of scope for P0/P1.

### 6.3 Real-time trace inspection

Onboarding already emits `ONBOARDING_AGENT_INVOCATION_TRACED`. Advisory
emits `AgentTraceEnvelope`. P2 wires these into a CloudWatch Logs
Insights saved query for cost forensics ("show me the top 10 sessions
by token count today").

---

## 7. Verification

### P0
- `pnpm nx run onboarding-bff:test` — unit tests still green
- `pnpm nx run onboarding-bff:test-integration` — integration test still green (FakeLlm path unaffected)
- Local manual: invoke onboarding runtime with a long-input prompt, confirm `Bedrock` returns `stop_reason='max_tokens'` once 2048 reached
- Local manual: force a recursion (mock tool that always reschedules), confirm LangGraph throws `GraphRecursionError` after 10 iterations
- `pnpm nx run onboarding-bff:synth` — CDK synth clean

### P1
- `pnpm nx run investor-hub:test` — assertions updated for daily budget + tightened spike
- `pnpm nx run investor-hub:synth` — synth clean
- AWS Console: confirm new daily budget appears post-deploy

### P2
- All 6 services synth clean
- Manual: AgentCore Observability console shows traces post-deploy

## 8. Open questions

1. **Daily budget amount** — proposed $30. Sustainable rate for
   dev account given current 33-service deploy? User to confirm.
2. **Spike ratio** — proposed 7.5% of monthly in 6h ≈ $15. Too tight
   may produce false positives during legitimate burst e2e runs.
3. **AgentCore Observability cost** — Observability itself bills for
   trace ingestion + retention. Confirm marginal cost is acceptable
   before P2 deploy.
4. **Backfill caps to other agents** — advisory agents already capped,
   but should we add `recursionLimit=10` to their orchestrator
   invocations as belt-and-braces? Currently in
   `libs/agent-orchestrator/src/invoke-orchestrator.ts` — no
   `recursionLimit` set. Could be done as a P0 addendum.

## 9. Files touched (summary)

**P0 (must change):**
- `services/investor/onboarding-bff/agents/onboarding/graph.ts`
- `services/investor/onboarding-bff/agents/onboarding/agent.ts`
- `services/investor/onboarding-bff/src/service.stack.ts`

**P0 (audit pass):**
- `services/advisory/*/agents/*.config.ts` × 6 — confirm `temperature` present

**P0.5 (must change):**
- `libs/agent-orchestrator/src/agent-factory.ts` — add `applyOverride()` + tier detection
- `services/investor/onboarding-bff/agents/onboarding/graph.ts` — env-var override + base-model-id fix
- `libs/cdk-constructs/src/extensions/agent-runtime.ts` — read `agentModelOverride` context, inject env var
- All advisory service stacks with Lambda agents — read context, inject `AGENT_MODEL_OVERRIDE` into Ingress env
- `libs/agent-orchestrator/test/agent-factory.test.ts` — new tests: smart-skip Opus, Sonnet→Haiku, no-upgrade, unset

**P1:**
- `libs/cdk-constructs/src/extensions/cost-controls.ts` (modify)
- `libs/cdk-constructs/src/extensions/bedrock-usage-alarms.ts` (new)
- `libs/cdk-constructs/src/extensions/index.ts` (export)
- `services/investor/investor-hub/src/service.stack.ts` (pass `dailyBudgetUsd`)
- All AgentRuntime stacks: instantiate `BedrockUsageAlarms`

**P2:**
- `libs/cdk-constructs/src/extensions/agent-runtime.ts` (observability prop)
- `libs/cdk-constructs/src/observability/*` (Bedrock widget)
- All AgentRuntime stacks (regenerate dashboard)
