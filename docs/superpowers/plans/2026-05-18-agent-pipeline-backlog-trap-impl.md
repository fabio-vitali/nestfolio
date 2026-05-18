# Agent-pipeline backlog trap — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encode the three-knob agreement (SF `TimeoutSeconds`, SQS `visibilityTimeout`, Lambda `sqsMaxConcurrency`) as a synth-time invariant inside a new `agentProfile()` helper, eliminate the per-cycle backlog trap that fails scenarios 11+12 of `apps/e2e-feature-tests`.

**Architecture:** Add `visibilityTimeout` to the `LambdaProfile` interface and a fallback rung in `Ingress`. Add `agentProfile(inputs): LambdaProfile` to `libs/cdk-constructs/src/utils/lambda-profiles.ts` that derives `(lambdaTimeout, sqsMaxConcurrency, visibilityTimeout)` from three meaningful inputs (`agentLatencyP90Ms`, `expectedBurstSize`, `uxBudgetSeconds`) and asserts `visibility ≤ ux × 2` at synth time. Define a shared `AGENT_BUDGETS` constants module owned by DWC. Thread the budget into DWC's two agent-invoke SF states. Replace `profile: agentProps` with `profile: agentProfile({...})` at the two deadline-bound call sites (PE + AN). Leave `agentProps` in place for IP + MI — they are agent Lambdas but not deadline-bound (continuous projection).

**Tech Stack:** TypeScript, AWS CDK (`aws-cdk-lib` v2), Jest, Node 24 ARM64 Lambdas, AWS Step Functions, SQS, EventBridge, Bedrock AgentCore.

---

## Decisions baked into this plan

These resolve the design spec's §10 open questions and one spec ambiguity:

1. **Shared budget module path** (spec §10 OQ #1): `services/advisory/decision-workflow-ctrl/src/agent-budgets.ts`, exported via a new `./agent-budgets` subpath in `services/advisory/decision-workflow-ctrl/package.json`. PE and AN import via `@nestfolio/decision-workflow-ctrl/agent-budgets`. Matches the existing pattern (e.g. `@nestfolio/decision-workflow-ctrl/events`).
2. **AN p99 > planned Lambda timeout** (spec §10 OQ #2): **raise AN's `agentLatencyP90Ms` from 30_000 → 35_000.** That makes the derived Lambda timeout `ceil(35 × 1.5) + 5 = 58s`, comfortably above AN's observed p99 of 53.7s, and keeps the invariant satisfied (`58 × 4 = 232s ≤ 240s`). Concurrency becomes `ceil(40 × 35 / 120) = 12`. Choice rationale: AN's slow tail comes from α/γ retry stacking (per `project_agent_runtime_structured_output`), not steady-state decode; failing at p99 would surface a *retry-path* regression rather than a real latency change — wrong feedback loop. We accept the slight over-provisioning (8s of slack) to keep e2e scenario 11+12 reliable.
3. **`expectedBurstSize` implicit multiplier** (spec §10 OQ #3): no implicit safety multiplier inside the helper. Author passes the explicit value (40 = 2× observed peak of 5 SFs × 8 calls). Spec preference for transparency stands.
4. **Spec §4 step 4 ("Delete `agentProps`") — partial deviation.** `agentProps` is consumed by 4 services today: PE, AN, IP, MI. PE + AN are deadline-bound; IP + MI are continuous-projection snapshot writers and have no SF task token waiting. Forcing IP + MI through `agentProfile()` with a synthetic `uxBudgetSeconds` would be semantic noise (the invariant guards a deadline that doesn't exist). Keep `agentProps` exported as the "non-deadline Bedrock-bound Lambda" profile for IP + MI; introduce `agentProfile()` as the "deadline-bound" helper for PE + AN. Both shapes coexist. This is a one-line deviation from the spec's "no shim" rule — `agentProps` is not a shim, it's the correct profile for a different shape.

## File structure

**New files:**
- `services/advisory/decision-workflow-ctrl/src/agent-budgets.ts` — `AGENT_BUDGETS` constants module exporting `PORTFOLIO_ENGINE_UX_SEC` and `ADVISORY_NARRATIVE_UX_SEC`. One source of truth consumed by DWC's SF construct + PE + AN service stacks.

**Modified files:**
- `libs/cdk-constructs/src/utils/lambda-profiles.ts` — extend `LambdaProfile` with `visibilityTimeout?: Duration`; add `AgentProfileInputs` interface; add `agentProfile()` function.
- `libs/cdk-constructs/src/utils/index.ts` — export `AgentProfileInputs`, `agentProfile`.
- `libs/cdk-constructs/test/utils/lambda-profiles.test.ts` — extend with `agentProfile()` test cases.
- `libs/cdk-constructs/src/core/ingress.ts:116` — add `profile?.visibilityTimeout` fallback rung before the 6× auto-calc.
- `libs/cdk-constructs/test/core/ingress.test.ts` (if exists; otherwise add a focused test alongside) — assert the new fallback precedence.
- `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` — pass explicit `timeout: Duration.seconds(AGENT_BUDGETS.PORTFOLIO_ENGINE_UX_SEC)` to `createAgentInvocationState('InvokePortfolioEngine', ...)` and `Duration.seconds(AGENT_BUDGETS.ADVISORY_NARRATIVE_UX_SEC)` to `createAgentInvocationState('InvokeAdvisoryNarrative', ...)`. Remove the implicit 10-minute default at the call sites (keep the helper's fallback for safety).
- `services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts` — extend assertions to check the new `TimeoutSeconds` values on both states.
- `services/advisory/decision-workflow-ctrl/package.json` — add `./agent-budgets` to the `exports` map.
- `services/advisory/decision-workflow-ctrl/CLAUDE.md` — update the SF description to reference `AGENT_BUDGETS.*_UX_SEC`.
- `services/advisory/portfolio-engine-ctrl/src/service.stack.ts` — swap `profile: agentProps` → `profile: agentProfile({ agentLatencyP90Ms: 29_000, expectedBurstSize: 40, uxBudgetSeconds: AGENT_BUDGETS.PORTFOLIO_ENGINE_UX_SEC })`. Update import.
- `services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts` — extend with SQS `VisibilityTimeout`, Lambda `Timeout`, ESM `MaximumConcurrency` assertions.
- `services/advisory/portfolio-engine-ctrl/CLAUDE.md` — update Ingress profile line.
- `services/advisory/advisory-narrative-ctrl/src/service.stack.ts` — swap `profile: agentProps` → `profile: agentProfile({ agentLatencyP90Ms: 35_000, expectedBurstSize: 40, uxBudgetSeconds: AGENT_BUDGETS.ADVISORY_NARRATIVE_UX_SEC })`. Update import.
- `services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts` — extend with SQS `VisibilityTimeout`, Lambda `Timeout`, ESM `MaximumConcurrency` assertions.
- `services/advisory/advisory-narrative-ctrl/CLAUDE.md` — update Ingress profile line.

**Unchanged files (intentional):**
- `services/advisory/investor-profile-ctrl/src/service.stack.ts` — keeps `profile: agentProps` (continuous projection, no SF deadline).
- `services/advisory/market-intelligence-ctrl/src/service.stack.ts` — same.
- `services/advisory/{investor-profile-ctrl,market-intelligence-ctrl}/CLAUDE.md` — no change.

---

## Task 1: Extend `LambdaProfile` interface with `visibilityTimeout`

**Files:**
- Modify: `libs/cdk-constructs/src/utils/lambda-profiles.ts`
- Test: `libs/cdk-constructs/test/utils/lambda-profiles.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `libs/cdk-constructs/test/utils/lambda-profiles.test.ts` inside the existing `describe('lambda-profiles — module contract', ...)` block:

```ts
it('LambdaProfile allows optional visibilityTimeout', () => {
  const withVisibility: LambdaProfile = {
    lambdaProps: { timeout: Duration.seconds(60) },
    visibilityTimeout: Duration.seconds(240),
  };
  expect(withVisibility.visibilityTimeout).toEqual(Duration.seconds(240));
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm nx test cdk-constructs --testPathPatterns=lambda-profiles
```

Expected: FAIL — `Object literal may only specify known properties, and 'visibilityTimeout' does not exist in type 'LambdaProfile'.`

- [ ] **Step 3: Add `visibilityTimeout` to `LambdaProfile`**

Edit `libs/cdk-constructs/src/utils/lambda-profiles.ts`, in the `LambdaProfile` interface (currently lines 59–67), insert `visibilityTimeout?: Duration;` between `sqsMaxConcurrency?: number;` and `ddbStreamBatchSize?: number;`. Update the JSDoc above the interface to mention `visibilityTimeout` in the SQS/DDB defaults list:

```ts
/**
 * ...
 * - `sqsBatchSize` / `sqsMaxBatchingWindow` / `sqsMaxConcurrency` — applied
 *   by `Ingress` to its `SqsEventSource`.
 * - `visibilityTimeout` — applied by `Ingress` to its SQS Queue. When unset,
 *   `Ingress` auto-calculates `6 × lambdaTimeout`.
 * - `ddbStreamBatchSize` / ...
 */
export interface LambdaProfile {
  lambdaProps: Partial<NodejsFunctionProps>;
  sqsBatchSize?: number;
  sqsMaxBatchingWindow?: Duration;
  sqsMaxConcurrency?: number;
  visibilityTimeout?: Duration;
  ddbStreamBatchSize?: number;
  ddbStreamMaxBatchingWindow?: Duration;
  ddbStreamParallelizationFactor?: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

```
pnpm nx test cdk-constructs --testPathPatterns=lambda-profiles
```

Expected: PASS, all suite green.

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/utils/lambda-profiles.ts libs/cdk-constructs/test/utils/lambda-profiles.test.ts
git commit -m "feat(cdk-constructs): add LambdaProfile.visibilityTimeout"
```

---

## Task 2: Wire `Ingress` profile.visibilityTimeout fallback rung

**Files:**
- Modify: `libs/cdk-constructs/src/core/ingress.ts:116`
- Test: `libs/cdk-constructs/test/core/ingress.test.ts` (create if absent; otherwise add to existing)

- [ ] **Step 1: Verify whether an Ingress test file exists**

```
ls libs/cdk-constructs/test/core/ingress.test.ts 2>/dev/null || echo MISSING
```

If MISSING, create the file with the test below as its sole content (skeleton imports included). If present, append the new `describe('Ingress — profile.visibilityTimeout fallback', ...)` block.

- [ ] **Step 2: Write the failing test**

If creating: write the full file `libs/cdk-constructs/test/core/ingress.test.ts`:

```ts
import { App, Duration } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Construct } from 'constructs';
import { Ingress } from '../../src/core/ingress';
import { ServiceStack } from '../../src/core/service-stack';
import { LambdaProfile } from '../../src/utils/lambda-profiles';
import { join } from 'path';

class TestServiceStack extends ServiceStack {
  constructor(scope: Construct, id: string, profile: LambdaProfile) {
    super(scope, id, {
      prefix: 'test',
      service: 'test-svc',
      subsystem: 'advisory',
      serviceDir: join(__dirname, '..', 'fixtures'),
    });
    new Ingress(this, 'Ingress', {
      eventTypes: ['TEST_EVENT'] as never[],
      profile,
      entry: join(__dirname, 'fixtures', 'noop-handler.ts'),
    });
  }
}

describe('Ingress — profile.visibilityTimeout fallback', () => {
  it('uses profile.visibilityTimeout when explicit prop is absent', () => {
    const app = new App();
    const stack = new TestServiceStack(app, 'S1', {
      lambdaProps: { timeout: Duration.seconds(60) },
      visibilityTimeout: Duration.seconds(240),
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::SQS::Queue', { VisibilityTimeout: 240 });
  });

  it('falls back to 6× lambdaTimeout when neither prop nor profile sets visibility', () => {
    const app = new App();
    const stack = new TestServiceStack(app, 'S2', {
      lambdaProps: { timeout: Duration.seconds(30) },
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::SQS::Queue', { VisibilityTimeout: 180 });
  });
});

// Precedence note: `props.visibilityTimeout` over `profile.visibilityTimeout` is
// covered by the EXISTING Ingress code path (the `props.visibilityTimeout ?? ...`
// chain predates this change). The only NEW behavior is profile→queue plumbing,
// which the two tests above exercise.
```

Also create `libs/cdk-constructs/test/fixtures/noop-handler.ts`:

```ts
export const handler = async () => ({ statusCode: 200 });
```

- [ ] **Step 3: Run test to verify it fails**

```
pnpm nx test cdk-constructs --testPathPatterns=ingress
```

Expected: FAIL — the first test should produce `VisibilityTimeout: 360` (6 × 60s) instead of `240`. The fallback test should pass.

- [ ] **Step 4: Add the fallback rung in `Ingress`**

Edit `libs/cdk-constructs/src/core/ingress.ts` lines 116–117. Change:

```ts
const visibilityTimeout = props.visibilityTimeout
  ?? Duration.seconds(6 * effectiveLambdaTimeout.toSeconds());
```

to:

```ts
const visibilityTimeout = props.visibilityTimeout
  ?? props.profile?.visibilityTimeout
  ?? Duration.seconds(6 * effectiveLambdaTimeout.toSeconds());
```

Update the `visibilityTimeout?: Duration;` JSDoc on `IngressProps` (line 38–39) to reflect the new precedence:

```ts
/** Visibility timeout for the SQS queue. Precedence: explicit prop > profile.visibilityTimeout > 6× effectiveLambdaTimeout. */
visibilityTimeout?: Duration;
```

- [ ] **Step 5: Run test to verify it passes**

```
pnpm nx test cdk-constructs --testPathPatterns=ingress
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/cdk-constructs/src/core/ingress.ts libs/cdk-constructs/test/core/ingress.test.ts libs/cdk-constructs/test/fixtures/noop-handler.ts
git commit -m "feat(cdk-constructs): wire Ingress profile.visibilityTimeout fallback"
```

---

## Task 3: Add `agentProfile()` helper

**Files:**
- Modify: `libs/cdk-constructs/src/utils/lambda-profiles.ts`
- Modify: `libs/cdk-constructs/src/utils/index.ts`
- Test: `libs/cdk-constructs/test/utils/lambda-profiles.test.ts`

- [ ] **Step 1: Write failing tests for `agentProfile` math + invariant + guards**

Append a new `describe` block to `libs/cdk-constructs/test/utils/lambda-profiles.test.ts`:

```ts
import { agentProfile, AgentProfileInputs } from '../../src/utils/lambda-profiles';

describe('agentProfile — deadline-bound agent Lambda profile', () => {
  const baseInputs: AgentProfileInputs = {
    agentLatencyP90Ms: 29_000,
    expectedBurstSize: 40,
    uxBudgetSeconds: 120,
  };

  describe('derivations', () => {
    it('derives lambdaTimeout = ceil(p90 × 1.5) + 5 seconds', () => {
      const profile = agentProfile(baseInputs);
      // p90 = 29s → ceil(29 × 1.5) + 5 = ceil(43.5) + 5 = 49
      expect(profile.lambdaProps.timeout).toEqual(Duration.seconds(49));
    });

    it('derives sqsMaxConcurrency = max(1, ceil(burst × p90 / ux))', () => {
      const profile = agentProfile(baseInputs);
      // ceil(40 × 29 / 120) = ceil(9.666...) = 10
      expect(profile.sqsMaxConcurrency).toBe(10);
    });

    it('derives visibilityTimeout = lambdaTimeout × visibilityMultiplier (default 4)', () => {
      const profile = agentProfile(baseInputs);
      // 49 × 4 = 196
      expect(profile.visibilityTimeout).toEqual(Duration.seconds(196));
    });

    it('respects visibilityMultiplier override', () => {
      const profile = agentProfile({ ...baseInputs, visibilityMultiplier: 3 });
      // 49 × 3 = 147
      expect(profile.visibilityTimeout).toEqual(Duration.seconds(147));
    });

    it('clamps sqsMaxConcurrency lower bound to 1 for tiny burst/p90 inputs', () => {
      const profile = agentProfile({ agentLatencyP90Ms: 100, expectedBurstSize: 1, uxBudgetSeconds: 600 });
      // ceil(1 × 0.1 / 600) = ceil(0.000166) = 1 → max(1, 1) = 1
      expect(profile.sqsMaxConcurrency).toBe(1);
    });

    it('matches AN spec values (p90=35_000, burst=40, ux=120, m=4)', () => {
      const profile = agentProfile({ agentLatencyP90Ms: 35_000, expectedBurstSize: 40, uxBudgetSeconds: 120 });
      // p90=35 → lambdaTimeout=ceil(52.5)+5=58
      // concurrency=ceil(40×35/120)=ceil(11.666)=12
      // visibility=58×4=232
      expect(profile.lambdaProps.timeout).toEqual(Duration.seconds(58));
      expect(profile.sqsMaxConcurrency).toBe(12);
      expect(profile.visibilityTimeout).toEqual(Duration.seconds(232));
    });
  });

  describe('input validation', () => {
    it('throws when agentLatencyP90Ms <= 0', () => {
      expect(() => agentProfile({ ...baseInputs, agentLatencyP90Ms: 0 }))
        .toThrow(/agentLatencyP90Ms must be > 0/);
    });

    it('throws when expectedBurstSize <= 0', () => {
      expect(() => agentProfile({ ...baseInputs, expectedBurstSize: 0 }))
        .toThrow(/expectedBurstSize must be > 0/);
    });

    it('throws when uxBudgetSeconds <= 0', () => {
      expect(() => agentProfile({ ...baseInputs, uxBudgetSeconds: 0 }))
        .toThrow(/uxBudgetSeconds must be > 0/);
    });

    it('throws when visibilityMultiplier < 1', () => {
      expect(() => agentProfile({ ...baseInputs, visibilityMultiplier: 0 }))
        .toThrow(/visibilityMultiplier must be >= 1/);
    });
  });

  describe('invariant: visibilityTimeoutSec ≤ uxBudgetSeconds × 2', () => {
    it('throws with the failing inequality when ux is too short for the derived visibility', () => {
      // ux=10, p90=29 → lambdaTimeout=49, visibility=196, ux×2=20, 196>20 → throws
      expect(() => agentProfile({ agentLatencyP90Ms: 29_000, expectedBurstSize: 40, uxBudgetSeconds: 10 }))
        .toThrow(/visibilityTimeoutSec=196 > uxBudgetSeconds×2=20/);
    });

    it('accepts ux exactly at the invariant boundary', () => {
      // visibility = 196, ux × 2 = 196 → equality passes
      expect(() => agentProfile({ agentLatencyP90Ms: 29_000, expectedBurstSize: 40, uxBudgetSeconds: 98 }))
        .not.toThrow();
    });
  });

  describe('static shape', () => {
    it('returns sqsBatchSize=1 and sqsMaxBatchingWindow=0 (deadline-bound, no batching)', () => {
      const profile = agentProfile(baseInputs);
      expect(profile.sqsBatchSize).toBe(1);
      expect(profile.sqsMaxBatchingWindow).toEqual(Duration.seconds(0));
    });

    it('uses 1024 MB memory and bundles @aws-sdk/* by default (matches old agentProps)', () => {
      const profile = agentProfile(baseInputs);
      expect(profile.lambdaProps.memorySize).toBe(1024);
      expect(profile.lambdaProps.bundling?.externalModules).toEqual([]);
    });

    it('respects custom bundling override', () => {
      const profile = agentProfile({ ...baseInputs, bundling: { externalModules: ['custom-package'] } });
      expect(profile.lambdaProps.bundling?.externalModules).toEqual(['custom-package']);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
pnpm nx test cdk-constructs --testPathPatterns=lambda-profiles
```

Expected: FAIL — `agentProfile is not exported from ../../src/utils/lambda-profiles`.

- [ ] **Step 3: Implement `AgentProfileInputs` + `agentProfile`**

Append to `libs/cdk-constructs/src/utils/lambda-profiles.ts` (after the existing `agentProps` const, before the EOF):

```ts
/**
 * Inputs to {@link agentProfile} — three meaningful, defensible numbers
 * the author can derive from CloudWatch evidence.
 *
 * The helper derives `(lambdaTimeout, sqsMaxConcurrency, visibilityTimeout)`
 * from these and asserts the invariant
 *
 *     visibilityTimeoutSec ≤ uxBudgetSeconds × 2
 *
 * at synth time, so the three knobs cannot drift apart silently.
 *
 * See `docs/superpowers/specs/2026-05-18-agent-pipeline-backlog-trap-architectural-design.md`
 * for the full derivation + rationale.
 */
export interface AgentProfileInputs {
  /** P90 latency of the agent invocation, in milliseconds. Plan around the slow tail. */
  agentLatencyP90Ms: number;
  /** Max simultaneous messages the queue may hold from realistic fan-out. Size for 2× observed peak. */
  expectedBurstSize: number;
  /** Time the SF state can spend before the user perceives the decision as failed. Must match the SF's TimeoutSeconds for this agent. */
  uxBudgetSeconds: number;
  /** SQS retries allowed within the visibility window. Default 4 (the CDK 6× default would violate the invariant for typical (p90, ux) shapes). */
  visibilityMultiplier?: number;
  /** Bundling escape hatch — defaults to externalModules=[] (PE+AN bundle @aws-sdk/* — see agentProps note). */
  bundling?: NodejsFunctionProps['bundling'];
}

/**
 * Deadline-bound Bedrock/LLM-calling Lambda profile. The hidden three-knob
 * agreement between SF `TimeoutSeconds`, SQS `visibilityTimeout`, and Lambda
 * `sqsMaxConcurrency` becomes an explicit, checked invariant.
 *
 * Use for: any Lambda whose execution time directly determines whether an
 * upstream SF task token is honoured — today, portfolio-engine-ctrl and
 * advisory-narrative-ctrl. NOT for continuous projection writers (those keep
 * using `agentProps`).
 *
 * @throws when `visibilityTimeoutSec > uxBudgetSeconds × 2` — drop the
 *   `visibilityMultiplier` or raise `uxBudgetSeconds`.
 */
export function agentProfile(inputs: AgentProfileInputs): LambdaProfile {
  if (inputs.agentLatencyP90Ms <= 0) throw new Error('agentProfile: agentLatencyP90Ms must be > 0');
  if (inputs.expectedBurstSize <= 0) throw new Error('agentProfile: expectedBurstSize must be > 0');
  if (inputs.uxBudgetSeconds <= 0) throw new Error('agentProfile: uxBudgetSeconds must be > 0');
  const visibilityMultiplier = inputs.visibilityMultiplier ?? 4;
  if (visibilityMultiplier < 1) throw new Error('agentProfile: visibilityMultiplier must be >= 1');

  const p90Sec = inputs.agentLatencyP90Ms / 1000;
  const lambdaTimeoutSec = Math.ceil(p90Sec * 1.5) + 5;
  const sqsMaxConcurrency = Math.max(
    1,
    Math.ceil(inputs.expectedBurstSize * p90Sec / inputs.uxBudgetSeconds),
  );
  const visibilitySec = lambdaTimeoutSec * visibilityMultiplier;

  if (visibilitySec > inputs.uxBudgetSeconds * 2) {
    throw new Error(
      `agentProfile invariant violated: visibilityTimeoutSec=${visibilitySec} > uxBudgetSeconds×2=${inputs.uxBudgetSeconds * 2}. ` +
      `Lower visibilityMultiplier (currently ${visibilityMultiplier}) or raise uxBudgetSeconds (currently ${inputs.uxBudgetSeconds}).`,
    );
  }

  return {
    lambdaProps: {
      ...BASE_LAMBDA_PROPS,
      memorySize: 1024,
      timeout: Duration.seconds(lambdaTimeoutSec),
      bundling: inputs.bundling ?? {
        ...BASE_LAMBDA_PROPS.bundling,
        // Bundle every @aws-sdk/* package — DO NOT externalize. The Node 24
        // Lambda runtime ships an older snapshot of the AWS SDK; agent
        // Lambdas use `@nestfolio/agent-orchestrator` which calls the
        // recently-added `BatchCreateMemoryRecordsCommand` from
        // `@aws-sdk/client-bedrock-agentcore`. Externalizing produces
        // `TypeError: <ns>.BatchCreateMemoryRecordsCommand is not a constructor`.
        externalModules: [],
      },
    },
    sqsBatchSize: 1,
    sqsMaxBatchingWindow: Duration.seconds(0),
    sqsMaxConcurrency,
    visibilityTimeout: Duration.seconds(visibilitySec),
  };
}
```

- [ ] **Step 4: Export `AgentProfileInputs` and `agentProfile` from the barrel**

Edit `libs/cdk-constructs/src/utils/index.ts`. Update the `lambda-profiles` re-export block:

```ts
export {
  BASE_LAMBDA_PROPS,
  PARAMS_AND_SECRETS_LAYER,
  LambdaProfile,
  handlerProps,
  adapterProps,
  reducerProps,
  agentProps,
  AgentProfileInputs,
  agentProfile,
} from './lambda-profiles';
```

- [ ] **Step 5: Run tests to verify they pass**

```
pnpm nx test cdk-constructs --testPathPatterns=lambda-profiles
```

Expected: PASS — all `agentProfile` describes green, plus the existing `agentProps` tests still green.

- [ ] **Step 6: Commit**

```bash
git add libs/cdk-constructs/src/utils/lambda-profiles.ts libs/cdk-constructs/src/utils/index.ts libs/cdk-constructs/test/utils/lambda-profiles.test.ts
git commit -m "feat(cdk-constructs): add agentProfile() helper with synth-time invariant"
```

---

## Task 4: Create shared `AGENT_BUDGETS` constants module

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/src/agent-budgets.ts`
- Modify: `services/advisory/decision-workflow-ctrl/package.json`
- Test: covered indirectly by Task 5 (DWC SF assertions) + Tasks 6–7 (PE+AN snapshot assertions). No standalone unit test for the constants — they're literal numbers.

- [ ] **Step 1: Create the constants file**

Write `services/advisory/decision-workflow-ctrl/src/agent-budgets.ts`:

```ts
/**
 * Per-agent UX budgets, in seconds. One source of truth consumed by:
 *
 * - `decision-workflow-ctrl`'s SF (`TimeoutSeconds` on each agent-invoke state)
 * - the agent services' stacks (PE, AN) (passed as `uxBudgetSeconds` into
 *   `agentProfile()`, which uses it to derive Lambda timeout, SQS concurrency
 *   and visibility timeout, and to enforce the three-knob invariant)
 *
 * Changing one of these values without redeploying the corresponding agent
 * service will violate the invariant on the next CDK synth and fail loud.
 *
 * Re-tuning policy: bump the per-agent value when CloudWatch p90 drifts more
 * than ~20% from the value baked into the matching service stack's
 * `agentLatencyP90Ms` input. See spec §6 "Re-tuning over time".
 */
export const AGENT_BUDGETS = {
  PORTFOLIO_ENGINE_UX_SEC: 120,
  ADVISORY_NARRATIVE_UX_SEC: 120,
} as const;

export type AgentBudgetKey = keyof typeof AGENT_BUDGETS;
```

- [ ] **Step 2: Add the package subpath export**

Read `services/advisory/decision-workflow-ctrl/package.json` and locate the existing `exports` map. Add a new entry alongside `./events`:

```jsonc
{
  "exports": {
    // ... existing entries unchanged ...
    "./agent-budgets": {
      "types": "./src/agent-budgets.ts",
      "default": "./src/agent-budgets.ts"
    }
  }
}
```

(Match the exact existing entry shape — types/default/import keys vary by package. Mirror whatever `./events` uses.)

- [ ] **Step 3: Verify import resolves from a consumer**

```
pnpm nx typecheck portfolio-engine-ctrl
```

If the package has no `typecheck` target, run `pnpm tsc --noEmit -p services/advisory/portfolio-engine-ctrl/tsconfig.lib.json` from the worktree root. Expected: PASS (no consumer imports yet, so this is just a smoke-typecheck of the existing tree).

- [ ] **Step 4: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/agent-budgets.ts services/advisory/decision-workflow-ctrl/package.json
git commit -m "feat(decision-workflow-ctrl): add AGENT_BUDGETS constants module"
```

---

## Task 5: Thread `AGENT_BUDGETS` into DWC SF agent-invoke states

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts`

- [ ] **Step 1: Write failing tests**

Append to the existing `describe` block in `services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts` (after the "still invokes PortfolioEngine" test around line 213):

```ts
it('sets TimeoutSeconds on InvokePortfolioEngine to AGENT_BUDGETS.PORTFOLIO_ENGINE_UX_SEC', () => {
  const state = definition.States.InvokePortfolioEngine;
  expect(state.TimeoutSeconds).toBe(120);
});

it('sets TimeoutSeconds on InvokeAdvisoryNarrative to AGENT_BUDGETS.ADVISORY_NARRATIVE_UX_SEC', () => {
  const state = definition.States.InvokeAdvisoryNarrative;
  expect(state.TimeoutSeconds).toBe(120);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
pnpm nx test decision-workflow-ctrl --testPathPatterns=decision-state-machine
```

Expected: FAIL — current `TimeoutSeconds` is `600` (the 10-minute default from `Duration.minutes(10).toSeconds()`).

- [ ] **Step 3: Pass explicit timeouts at the two call sites**

Edit `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`. Add the import at the top:

```ts
import { AGENT_BUDGETS } from '../agent-budgets';
```

Update the `invokePortfolioEngine` call (lines 120–130):

```ts
const invokePortfolioEngine = createAgentInvocationState(
  'InvokePortfolioEngine',
  'CONSTRUCT_PORTFOLIO',
  {
    timeout: Duration.seconds(AGENT_BUDGETS.PORTFOLIO_ENGINE_UX_SEC),
    extraSubject: {
      operatingMode: '$.investorProfile.operatingMode',
      investorProfile: '$.agentResults.InvokeInvestorProfile.agentOutput',
      marketAnalysis: '$.agentResults.InvokeMarketIntelligence.agentOutput',
    },
  },
);
```

Update the `invokeAdvisoryNarrative` call (lines 132–143):

```ts
const invokeAdvisoryNarrative = createAgentInvocationState(
  'InvokeAdvisoryNarrative',
  'GENERATE_NARRATIVE',
  {
    timeout: Duration.seconds(AGENT_BUDGETS.ADVISORY_NARRATIVE_UX_SEC),
    extraSubject: {
      operatingMode: '$.investorProfile.operatingMode',
      investorProfile: '$.agentResults.InvokeInvestorProfile.agentOutput',
      marketAnalysis: '$.agentResults.InvokeMarketIntelligence.agentOutput',
      portfolio: '$.agentResults.InvokePortfolioEngine.agentOutput',
    },
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

```
pnpm nx test decision-workflow-ctrl --testPathPatterns=decision-state-machine
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts
git commit -m "feat(decision-workflow-ctrl): thread AGENT_BUDGETS into SF agent-invoke timeouts"
```

---

## Task 6: Migrate `portfolio-engine-ctrl` to `agentProfile()`

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`
- Test: `services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Write failing tests**

Append to the existing `describe('PortfolioEngineCtrlStack', ...)` in `services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts`:

```ts
it('Ingress SQS Queue has VisibilityTimeout=196 (agentProfile derivation: lambdaTimeout 49s × 4)', () => {
  // ingress-side queues only (DLQ has the 14-day retention shape).
  // Match on the visibility-timeout value rather than logical-id to keep the
  // test robust to refactors.
  const queues = template.findResources('AWS::SQS::Queue', {
    Properties: { VisibilityTimeout: 196 },
  });
  expect(Object.keys(queues).length).toBeGreaterThanOrEqual(1);
});

it('Ingress Lambda has Timeout=49 (agentProfile: ceil(p90×1.5)+5 where p90=29s)', () => {
  const lambdas = template.findResources('AWS::Lambda::Function', {
    Properties: { Timeout: 49 },
  });
  expect(Object.keys(lambdas).length).toBeGreaterThanOrEqual(1);
});

it('Ingress EventSourceMapping has MaximumConcurrency=10 (agentProfile: ceil(40×29/120))', () => {
  const esms = template.findResources('AWS::Lambda::EventSourceMapping', {
    Properties: { ScalingConfig: { MaximumConcurrency: 10 } },
  });
  expect(Object.keys(esms).length).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
pnpm nx test portfolio-engine-ctrl --testPathPatterns=service.stack
```

Expected: FAIL — current values come from `agentProps` (VisibilityTimeout=1800, Timeout=300, MaximumConcurrency=5).

- [ ] **Step 3: Swap `agentProps` → `agentProfile()`**

Edit `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`. Update the imports (line 14):

```ts
import { agentProfile, defaultLambdaProps, NamingService, PARAMS_AND_SECRETS_LAYER } from '@nestfolio/cdk-constructs/utils';
import { AGENT_BUDGETS } from '@nestfolio/decision-workflow-ctrl/agent-budgets';
```

(Drop `agentProps` from the existing import list — it's no longer needed in this file.)

Update the Ingress call (lines 31–42):

```ts
// Ingress: trigger + KB ingestion events.
// Uses agentProfile() because this is one of the two per-cycle deadline-bound
// agent calls — see `docs/superpowers/specs/2026-05-18-agent-pipeline-backlog-trap-architectural-design.md`.
// The helper derives Lambda timeout, SQS concurrency and visibility timeout
// from p90 latency, expected burst size, and the SF UX budget; the synth
// fails loud if the three drift apart.
const ingress = new Ingress(this, 'Ingress', {
  state,
  eventTypes: [
    DecisionWorkflowEventTypes.CONSTRUCT_PORTFOLIO,
    SecEdgarAdptEventTypes.SEC_PROSPECTUS_UPDATED,
    SecEdgarAdptEventTypes.SEC_10K_UPDATED,
  ],
  profile: agentProfile({
    agentLatencyP90Ms: 29_000,
    expectedBurstSize: 40,
    uxBudgetSeconds: AGENT_BUDGETS.PORTFOLIO_ENGINE_UX_SEC,
  }),
  lambdaProps: {
    paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

```
pnpm nx test portfolio-engine-ctrl --testPathPatterns=service.stack
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/src/service.stack.ts services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(portfolio-engine-ctrl): migrate Ingress profile from agentProps to agentProfile()"
```

---

## Task 7: Migrate `advisory-narrative-ctrl` to `agentProfile()`

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`
- Test: `services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts`:

```ts
it('Ingress SQS Queue has VisibilityTimeout=232 (agentProfile derivation: lambdaTimeout 58s × 4)', () => {
  const queues = template.findResources('AWS::SQS::Queue', {
    Properties: { VisibilityTimeout: 232 },
  });
  expect(Object.keys(queues).length).toBeGreaterThanOrEqual(1);
});

it('Ingress Lambda has Timeout=58 (agentProfile: ceil(p90×1.5)+5 where p90=35s — raised from 30s to cover observed p99=53.7s)', () => {
  const lambdas = template.findResources('AWS::Lambda::Function', {
    Properties: { Timeout: 58 },
  });
  expect(Object.keys(lambdas).length).toBeGreaterThanOrEqual(1);
});

it('Ingress EventSourceMapping has MaximumConcurrency=12 (agentProfile: ceil(40×35/120))', () => {
  const esms = template.findResources('AWS::Lambda::EventSourceMapping', {
    Properties: { ScalingConfig: { MaximumConcurrency: 12 } },
  });
  expect(Object.keys(esms).length).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
pnpm nx test advisory-narrative-ctrl --testPathPatterns=service.stack
```

Expected: FAIL — current values come from `agentProps`.

- [ ] **Step 3: Swap `agentProps` → `agentProfile()`**

Edit `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`. Update imports (line 12):

```ts
import { agentProfile, NamingService, PARAMS_AND_SECRETS_LAYER } from '@nestfolio/cdk-constructs/utils';
import { AGENT_BUDGETS } from '@nestfolio/decision-workflow-ctrl/agent-budgets';
```

Update the Ingress call (lines 30–40):

```ts
// Ingress: trigger + feedback events.
// Uses agentProfile() because this is one of the two per-cycle deadline-bound
// agent calls. agentLatencyP90Ms=35_000 (raised from observed p90=29.7s to
// cover p99=53.7s — see spec §10 OQ #2 + plan decision #2).
const ingress = new Ingress(this, 'Ingress', {
  state,
  profile: agentProfile({
    agentLatencyP90Ms: 35_000,
    expectedBurstSize: 40,
    uxBudgetSeconds: AGENT_BUDGETS.ADVISORY_NARRATIVE_UX_SEC,
  }),
  eventTypes: [
    DecisionWorkflowEventTypes.GENERATE_NARRATIVE,
    DecisionWorkflowEventTypes.DECISION_FEEDBACK,
  ],
  lambdaProps: {
    paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

```
pnpm nx test advisory-narrative-ctrl --testPathPatterns=service.stack
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/src/service.stack.ts services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(advisory-narrative-ctrl): migrate Ingress profile from agentProps to agentProfile()"
```

---

## Task 8: Update service CLAUDE.md cards

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/CLAUDE.md` (Ingress section)
- Modify: `services/advisory/advisory-narrative-ctrl/CLAUDE.md` (Ingress section)
- Modify: `services/advisory/decision-workflow-ctrl/CLAUDE.md` (SF Orchestration section)

- [ ] **Step 1: Update PE card**

Edit `services/advisory/portfolio-engine-ctrl/CLAUDE.md`. Replace the Ingress profile line:

```markdown
  Profile: agentProps (1024 MB / 5min timeout / batchSize 1 / concurrency 5)
```

with:

```markdown
  Profile: agentProfile({ p90=29_000ms, burst=40, ux=AGENT_BUDGETS.PORTFOLIO_ENGINE_UX_SEC=120s }) → 1024 MB / 49s timeout / batchSize 1 / concurrency 10 / visibility 196s
```

- [ ] **Step 2: Update AN card**

Edit `services/advisory/advisory-narrative-ctrl/CLAUDE.md`. Replace:

```markdown
  Profile: agentProps (1024 MB / 5min timeout — Sonnet invocations are 50–130s p95; the default 30s timeout would leave the SF task token unreturned)
```

with:

```markdown
  Profile: agentProfile({ p90=35_000ms, burst=40, ux=AGENT_BUDGETS.ADVISORY_NARRATIVE_UX_SEC=120s }) → 1024 MB / 58s timeout / batchSize 1 / concurrency 12 / visibility 232s. P90 raised from observed 29.7s to 35s so the Lambda timeout covers p99=53.7s.
```

- [ ] **Step 3: Update DWC card**

Edit `services/advisory/decision-workflow-ctrl/CLAUDE.md`. In the "Orchestration" → step 5 description, replace:

```markdown
  5. PE + AN waitForTaskToken steps (SendTaskSuccess on AgentCompletion CDC, SendTaskFailure on AgentFailure CDC).
```

with:

```markdown
  5. PE + AN waitForTaskToken steps with explicit TimeoutSeconds = AGENT_BUDGETS.{PORTFOLIO_ENGINE,ADVISORY_NARRATIVE}_UX_SEC (120s each). PE+AN service stacks consume the same constants via `@nestfolio/decision-workflow-ctrl/agent-budgets` so the SF deadline + Lambda timeout + SQS visibility stay synchronised — the agentProfile() helper asserts the invariant at synth time. SendTaskSuccess on AgentCompletion CDC, SendTaskFailure on AgentFailure CDC.
```

Also append to the "Event Types" or a new "Exports" subsection:

```markdown
## Exports (package subpaths)
- `./events` — domain event types.
- `./agent-budgets` — `AGENT_BUDGETS` constants (PE+AN UX budgets, shared with the agent service stacks).
```

- [ ] **Step 4: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/CLAUDE.md services/advisory/advisory-narrative-ctrl/CLAUDE.md services/advisory/decision-workflow-ctrl/CLAUDE.md
git commit -m "docs(advisory): update PE/AN/DWC cards for agentProfile() migration"
```

---

## Task 9: Verify nx-affected suite stays green

**Files:** none (verification only)

- [ ] **Step 1: Run nx affected for tests + lint**

```
pnpm nx affected -t test,lint --base=origin/main
```

Expected: PASS. The diff touches `cdk-constructs`, `decision-workflow-ctrl`, `portfolio-engine-ctrl`, `advisory-narrative-ctrl` — affected projects include those four plus any package importing from them.

If `lint` fails on unused-import (most likely: `agentProps` removed from the import list but lint flags a stale reference elsewhere), fix and re-run. Do NOT delete `agentProps` from the lib exports — IP+MI still consume it.

- [ ] **Step 2: If anything fails, fix and re-run before proceeding**

If a downstream snapshot test in another service breaks (unlikely — no other service imports the modified files), patch the snapshot expectation. Pull the failing diff before deciding.

- [ ] **Step 3: No commit (verification step)**

---

## Task 10: Deploy to dev + scoped e2e validation

**Files:** none (deploy + validation only)

This task IS gated by `feedback_flake_means_broken` — 3 consecutive passes per scenario, evidence pulled from any failing window.

- [ ] **Step 1: Deploy the 3 changed services plus cdk-constructs consumers**

```
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=decision-workflow-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl | tee /tmp/agent-pipeline-trap-deploy.log
```

If the CDK diff for any other service reports changes due to the `cdk-constructs` revision (likely — shared lib bumps every consumer's bundle hash), include them in `--services=`. Re-run if `cdk diff` surfaces unexpected churn.

Expected outcome in the log: `✓ deploy succeeded` (or equivalent script output). Note the IngressQueue ARNs for PE+AN — they appear in the CFN outputs section.

- [ ] **Step 2: Purge the PE IngressQueue stale messages (one-time, evidence-driven)**

Per `MEMORY.md` (project_e2e_feature_tests): "Dev PE IngressQueue purged at adoption to clear stale task-token-dead messages". Repeat here so the new deploy doesn't inherit the old 810-message backlog:

```
AWS_PROFILE=nestfolio-dev aws sqs purge-queue --queue-url $(AWS_PROFILE=nestfolio-dev aws sqs get-queue-url --queue-name $(AWS_PROFILE=nestfolio-dev aws sqs list-queues --queue-name-prefix dev-portfolio-engine-ctrl-Ingress --query 'QueueUrls[0]' --output text | sed 's|.*/||') --query 'QueueUrl' --output text) --region us-east-1
```

(If your shell complains about quoting, run the inner queue-URL lookup first, then pass the result to `purge-queue`.)

- [ ] **Step 3: Run scoped e2e — scenario 11 (first-decision), 3 consecutive passes**

```
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns=first-decision
```

Run 3 times consecutively. Capture each run's exit code + duration.

If any run fails:
1. Pull CloudWatch evidence for the failing window:
   - SF execution timeline (look for `TaskTimedOut`, `ExecutionAborted`, `LambdaFunctionFailed`).
   - PE / AN Lambda logs: search for `Task timed out` or unhandled exceptions.
   - PE IngressQueue depth at the time of failure (CW metric `ApproximateNumberOfMessagesVisible`).
2. Do NOT mark this step complete on a "second-run-passed" rerun without investigating — see `feedback_flake_means_broken`.

- [ ] **Step 4: Run scoped e2e — scenario 12 (rebalance-on-drift), 3 consecutive passes**

```
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns=rebalance-on-drift
```

Same 3-consecutive-pass discipline. Same evidence-pull-on-failure discipline.

- [ ] **Step 5: Verify validation gate from the backlog file**

After all 6 runs (3 × scenario 11 + 3 × scenario 12) pass, run CloudWatch Insights confirmation queries (paste into the Logs Insights console or use `aws logs start-query` via CLI):

```
fields @timestamp, @message
| filter @message like /TaskTimedOut/
| filter @logStream like /InvokePortfolioEngine|InvokeAdvisoryNarrative|CONSTRUCT_PORTFOLIO|GENERATE_NARRATIVE/
| stats count(*) by bin(15m)
```

Expected: zero results in the window covering the 6 e2e runs.

Also check PE+AN Lambda timeout count:

```
fields @timestamp, @message
| filter @message like /Task timed out after/
| filter @logStream like /dev-portfolio-engine-ctrl-IngressHandler|dev-advisory-narrative-ctrl-IngressHandler/
| stats count(*) by bin(15m)
```

Expected: zero.

- [ ] **Step 6: No commit (validation step)**

If everything is green, proceed to Task 11. If anything fails, return to Task 6/7 with concrete evidence — do NOT mark the workstream shipped on partial validation.

---

## Task 11: Ship the backlog file + regen index

**Files:**
- Modify: `docs/backlog/agent-pipeline-backlog-trap-impl.md`
- Modify (auto): `docs/BACKLOG.md`

- [ ] **Step 1: Flip the backlog file to `shipped` and fill the validation gate**

Edit `docs/backlog/agent-pipeline-backlog-trap-impl.md`. Update frontmatter:

- `status: active` → `status: shipped`
- `plan: null` → `plan: docs/superpowers/plans/2026-05-18-agent-pipeline-backlog-trap-impl.md`
- `validation_gate: null` → a multi-line entry like:

```yaml
validation_gate: |
  - cdk-constructs unit tests green (lambda-profiles + ingress) — commit <SHA>
  - decision-state-machine.test.ts green with new TimeoutSeconds assertions — commit <SHA>
  - portfolio-engine-ctrl + advisory-narrative-ctrl service.stack.test.ts green with new Visibility/Timeout/Concurrency assertions — commits <SHA>, <SHA>
  - Deployed to dev 2026-05-18 via deploy.sh sandbox --prefix=dev --services=decision-workflow-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl — log /tmp/agent-pipeline-trap-deploy.log
  - e2e scenario 11 (first-decision): 3/3 consecutive PASS — durations <a>s, <b>s, <c>s
  - e2e scenario 12 (rebalance-on-drift): 3/3 consecutive PASS — durations <a>s, <b>s, <c>s
  - CloudWatch Logs Insights: zero TaskTimedOut events on CONSTRUCT_PORTFOLIO / GENERATE_NARRATIVE, zero Lambda Task timed out on PE/AN IngressHandler across the e2e window
```

Replace `<SHA>` and `<a/b/c>` placeholders with concrete values from Tasks 6, 7, 5, 10.

- [ ] **Step 2: Regenerate BACKLOG.md**

```
node .claude/skills/backlog-lint/lint.mjs --fix
```

Expected: `✓ N backlog files; all 8 rules pass (with --fix applied)`.

- [ ] **Step 3: Commit**

```bash
git add docs/backlog/agent-pipeline-backlog-trap-impl.md docs/BACKLOG.md
git commit -m "docs(backlog): ship agent-pipeline-backlog-trap-impl"
```

---

## Validation gate (what must be true to ship)

Mirrors the backlog file's gate and the spec §11 criteria. All must hold:

- All `pnpm nx affected -t test,lint --base=origin/main` green.
- 3 consecutive passes of `apps/e2e-feature-tests` scenarios 11 (first-decision) and 12 (rebalance-on-drift) against deployed dev, with no rerun-after-failure.
- CloudWatch Logs Insights: zero `TaskTimedOut` events on `CONSTRUCT_PORTFOLIO` / `GENERATE_NARRATIVE` states for the test window.
- CloudWatch Logs Insights: zero Lambda timeout events on PE / AN IngressHandler for the test window.
- PE IngressQueue depth during e2e never exceeds 40 (matches the spec's planned `expectedBurstSize`).
- `agentProfile()` synth-time invariant unit tests cover: derivation, all four input guards, invariant violation, multiplier override.
- DWC SF synth produces `TimeoutSeconds: 120` for both `InvokePortfolioEngine` and `InvokeAdvisoryNarrative`.

## Out of scope (mirrors backlog file)

Carry-forward verbatim from `docs/backlog/agent-pipeline-backlog-trap-impl.md`:

- Bedrock TPS quota tracking (concurrency × callRate ≤ modelRpm).
- Pre-warming / reserved Lambda concurrency.
- AN p90 tail reduction (compressing α/γ retry paths).
- Automated p90 drift CI check.
- Backfill of `agentProfile` to non-deadline-bound agent services (IP+MI keep `agentProps`).
- Runtime CloudWatch alarms on visibility-vs-deadline.
- Inter-agent state handoff redesign.
- Long-term Memory write latency on PE/AN.
- Re-introducing IP/MI to the per-cycle path.
- Test-harness changes (EventBusTrap, AgentTraceTrap, fixture polling budgets).
- Compliance-ctrl or AssemblePacket state changes.
- The publisher-side bug tracked in `update-operating-mode-cdc-silent`.
- F1/F3 test-gating heuristics.

## Rollback

`git revert` the cdk-constructs + DWC + PE + AN diffs. Redeploy: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=decision-workflow-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl`. Old `(5, 1800, 600, 300)` values come back. No data migration.
