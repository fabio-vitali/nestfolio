# Agent Benchmark Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/benchmark-agents` Claude skill plus a `scripts/benchmark-agents/` TS runner that sweeps multiple Bedrock models against each of the 6 production AgentConfigs in the advisory domain, captures per-iteration latency / tokens / cost / schema-pass / not-degraded / validation-pass, and produces per-task + cross-task evaluation reports rendered by Claude.

**Architecture:** A committed `scripts/benchmark-agents/` tree holds a shared TS runner (`run.ts`), pricing/fixture support scripts, and 6 thin per-task `*.bench.ts` configs that import each production `AgentConfig` directly from `services/advisory/.../src/agents/*.config.ts`. A committed `.claude/skills/benchmark-agents/SKILL.md` is the orchestration playbook Claude follows when `/benchmark-agents` fires. All artifacts (fixtures, pricing cache, raw results, evaluation markdown) land under a gitignored `benchmarks/` tree. The runner invokes `ChatBedrockConverse.withStructuredOutput(schema, { includeRaw: true })` locally against the dev sandbox; the prompt is replayed verbatim from a Bedrock-invocation-log capture so prompt-substitution drift is impossible.

**Tech Stack:** TypeScript, `tsx` (TS script runner), `@langchain/aws` (`ChatBedrockConverse`), `@aws-sdk/client-pricing` (free Price List Query API), `@aws-sdk/client-cloudwatch-logs` (Logs Insights), pnpm, Jest + ts-jest (workspace test runner — `jest.preset.js` at repo root).

---

## Out of scope (mirrors spec §3 + backlog frontmatter)

- onboarding-bff agent (multi-turn CopilotKit, different harness)
- compliance-ctrl (rule-based authority resolver, no LLM call site)
- Deployed AgentCore Runtime invocation path (we replay the prompt locally — no redeploy, no AgentCore cold-start)
- Auto-applying recommendations to `*.config.ts` files (humans review the report and edit in a follow-on PR)
- Continuous / scheduled benchmark runs
- Golden-output regression assertions (only schema-pass + Claude's purpose-anchored judgment)
- Reading actual billed cost from AWS billing line items (uses the free Pricing API instead)
- Frontend / e2e changes

---

## Task 0: AWS prerequisite (one-time manual gate)

**Files:** none — this is AWS-console + verification work, not a code change. Without this, Task 6 cannot produce a single fixture and the entire workstream is blocked.

- [ ] **Step 1: Enable Bedrock model invocation logging on dev**

AWS console with `AWS_PROFILE=nestfolio-dev` (account `771924376645`) → Bedrock → Settings → Model invocation logging → enable → destination CloudWatch. Let AWS provision the default log group (typically `aws/bedrock/modelinvocations`) or pin a deterministic name like `/aws/bedrock/dev-invocations`.

- [ ] **Step 2: Pin the resulting log group name + entry schema**

```bash
AWS_PROFILE=nestfolio-dev aws logs describe-log-groups --region us-east-1 \
  --query 'logGroups[?contains(logGroupName, `bedrock`)].[logGroupName,creationTime]' \
  --output table
```

Record the log group name (this becomes the `BEDROCK_INVOCATION_LOG_GROUP` default in Task 6). Then dump one sample entry and pin the JSON paths for `modelId`, the request `messages[].content` array, and `output.message.content[]`:

```bash
AWS_PROFILE=nestfolio-dev aws logs tail <log-group> --since 1h --format short | head -3
```

If the request body lives at `input.inputBodyJson.messages` (legacy schema) vs `input.messages` (Converse-API schema), record which — Task 6's extraction code handles both but the comment must reflect which one is live on dev.

- [ ] **Step 3: Verify a fresh decision-cycle populates the log group**

Trigger one advisory decision cycle on dev (existing e2e fixture, or manually via onboarding). Then:

```bash
AWS_PROFILE=nestfolio-dev aws logs tail <log-group> --since 10m --filter-pattern 'claude' --format short | head -10
```

Expected: at least one entry per task `modelId` appears within ~5 minutes of the cycle. Without this, the Insights queries in Task 6 will find nothing.

---

## Task 1: Skeleton — deps, layout, .gitignore, boundary smoke test

**Files:**
- Create: `scripts/benchmark-agents/lib/types.ts` (placeholder)
- Create: `scripts/benchmark-agents/lib/timings.ts` (placeholder)
- Create: `scripts/benchmark-agents/lib/invoke-model.ts` (placeholder)
- Create: `scripts/benchmark-agents/pricing-loader.ts` (placeholder)
- Create: `scripts/benchmark-agents/refresh-pricing.ts` (placeholder)
- Create: `scripts/benchmark-agents/capture-fixture.ts` (placeholder)
- Create: `scripts/benchmark-agents/run.ts` (placeholder)
- Create: `scripts/benchmark-agents/tasks/user-goals.bench.ts`
- Create: `scripts/benchmark-agents/tasks/risk-assessment.bench.ts`
- Create: `scripts/benchmark-agents/tasks/market-research.bench.ts`
- Create: `scripts/benchmark-agents/tasks/portfolio-construction.bench.ts`
- Create: `scripts/benchmark-agents/tasks/rebalance-planner.bench.ts`
- Create: `scripts/benchmark-agents/tasks/explainability.bench.ts`
- Modify: `.gitignore` (add `benchmarks/`)
- Modify: `package.json` + `pnpm-lock.yaml` (add 3 deps)

- [ ] **Step 1: Install runtime + dev deps**

```bash
pnpm add -D -w tsx @aws-sdk/client-pricing @aws-sdk/client-cloudwatch-logs
```

Expected: `package.json` lists all three under `devDependencies`, lockfile updates, install exits 0.

- [ ] **Step 2: Add `benchmarks/` to .gitignore**

Append before the trailing blank line of `.gitignore`:

```
# Agent benchmark artifacts (raw results, captured prompts, pricing cache).
# Gitignored end-to-end per docs/superpowers/specs/2026-05-19-agent-benchmark-skill-design.md §4.2.
benchmarks/
```

- [ ] **Step 3: Create the placeholder source files**

For each of `lib/types.ts`, `lib/timings.ts`, `lib/invoke-model.ts`, `pricing-loader.ts`, `refresh-pricing.ts`, `capture-fixture.ts`, `run.ts`, write a one-line stub:

```typescript
export {};
```

- [ ] **Step 4: Create all 6 bench config skeletons**

`scripts/benchmark-agents/tasks/user-goals.bench.ts`:

```typescript
import { userGoalsConfig } from '../../../services/advisory/investor-profile-ctrl/src/agents/user-goals.config';

export const benchConfig = {
  taskName: 'user-goals' as const,
  service: 'investor-profile-ctrl' as const,
  configFilePath: 'services/advisory/investor-profile-ctrl/src/agents/user-goals.config.ts',
  fixturePath: 'benchmarks/fixtures/user-goals.input.json',
  productionConfig: userGoalsConfig,
  validationRule: null as const,
  models: [
    'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    'us.anthropic.claude-sonnet-4-6',
    'us.anthropic.claude-sonnet-4-7',
    'amazon.nova-lite-v1:0',
    'amazon.nova-pro-v1:0',
  ],
};
```

`scripts/benchmark-agents/tasks/risk-assessment.bench.ts`:

```typescript
import { riskAssessmentConfig } from '../../../services/advisory/investor-profile-ctrl/src/agents/risk-assessment.config';

export const benchConfig = {
  taskName: 'risk-assessment' as const,
  service: 'investor-profile-ctrl' as const,
  configFilePath: 'services/advisory/investor-profile-ctrl/src/agents/risk-assessment.config.ts',
  fixturePath: 'benchmarks/fixtures/risk-assessment.input.json',
  productionConfig: riskAssessmentConfig,
  validationRule: null as const,
  models: [
    'us.anthropic.claude-sonnet-4-6',
    'us.anthropic.claude-sonnet-4-7',
    'us.anthropic.claude-opus-4-6-v1',
    'amazon.nova-pro-v1:0',
    'amazon.nova-premier-v1:0',
  ],
};
```

`scripts/benchmark-agents/tasks/market-research.bench.ts`:

```typescript
import { marketResearchConfig } from '../../../services/advisory/market-intelligence-ctrl/src/agents/market-research.config';

export const benchConfig = {
  taskName: 'market-research' as const,
  service: 'market-intelligence-ctrl' as const,
  configFilePath: 'services/advisory/market-intelligence-ctrl/src/agents/market-research.config.ts',
  fixturePath: 'benchmarks/fixtures/market-research.input.json',
  productionConfig: marketResearchConfig,
  validationRule: null as const,
  models: [
    'us.anthropic.claude-sonnet-4-6',
    'us.anthropic.claude-sonnet-4-7',
    'us.anthropic.claude-opus-4-6-v1',
    'amazon.nova-pro-v1:0',
    'amazon.nova-premier-v1:0',
  ],
};
```

`scripts/benchmark-agents/tasks/portfolio-construction.bench.ts`:

```typescript
import { buildPortfolioConstructionConfig } from '../../../services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config';
import { portfolioValidationRule } from '../../../services/advisory/portfolio-engine-ctrl/src/agents/validation';

export const benchConfig = {
  taskName: 'portfolio-construction' as const,
  service: 'portfolio-engine-ctrl' as const,
  configFilePath: 'services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config.ts',
  operatingMode: 'BALANCED' as const,
  fixturePath: 'benchmarks/fixtures/portfolio-construction.input.json',
  productionConfig: buildPortfolioConstructionConfig('BALANCED'),
  validationRule: portfolioValidationRule,
  models: [
    'us.anthropic.claude-sonnet-4-6',
    'us.anthropic.claude-sonnet-4-7',
    'us.anthropic.claude-opus-4-6-v1',
    'us.anthropic.claude-opus-4-7',
    'amazon.nova-premier-v1:0',
  ],
};
```

`scripts/benchmark-agents/tasks/rebalance-planner.bench.ts`:

```typescript
import { rebalancePlannerConfig } from '../../../services/advisory/portfolio-engine-ctrl/src/agents/rebalance-planner.config';
import { rebalanceValidationRule } from '../../../services/advisory/portfolio-engine-ctrl/src/agents/validation';

export const benchConfig = {
  taskName: 'rebalance-planner' as const,
  service: 'portfolio-engine-ctrl' as const,
  configFilePath: 'services/advisory/portfolio-engine-ctrl/src/agents/rebalance-planner.config.ts',
  fixturePath: 'benchmarks/fixtures/rebalance-planner.input.json',
  productionConfig: rebalancePlannerConfig,
  validationRule: rebalanceValidationRule,
  models: [
    'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    'us.anthropic.claude-sonnet-4-6',
    'us.anthropic.claude-sonnet-4-7',
    'amazon.nova-lite-v1:0',
    'amazon.nova-pro-v1:0',
  ],
};
```

`scripts/benchmark-agents/tasks/explainability.bench.ts`:

```typescript
import { explainabilityConfig } from '../../../services/advisory/advisory-narrative-ctrl/src/agents/explainability.config';

export const benchConfig = {
  taskName: 'explainability' as const,
  service: 'advisory-narrative-ctrl' as const,
  configFilePath: 'services/advisory/advisory-narrative-ctrl/src/agents/explainability.config.ts',
  fixturePath: 'benchmarks/fixtures/explainability.input.json',
  productionConfig: explainabilityConfig,
  validationRule: null as const,
  models: [
    'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    'us.anthropic.claude-sonnet-4-6',
    'us.anthropic.claude-sonnet-4-7',
    'amazon.nova-lite-v1:0',
    'amazon.nova-pro-v1:0',
    'meta.llama3-3-70b-instruct-v1:0',
    'mistral.mistral-large-2407-v1:0',
  ],
};
```

Note: model IDs above are spec-time guesses for the non-Claude rows. Task 5's `refresh-pricing.ts` will fail loudly on any modelId that has no SKU in the Price List API — that is the verification gate. Adjust per the live `aws bedrock list-foundation-models` output if a fetch misses (e.g. Mistral may be `-2411` not `-2407`).

- [ ] **Step 5: Boundary smoke test — verify nx + lint stay green**

```bash
pnpm nx run-many -t lint --skip-nx-cache --projects=advisory-narrative-ctrl,investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,agent-orchestrator
```

Expected: PASS. `scripts/` sits outside the Nx project graph (no `project.json` underneath), so `@nx/enforce-module-boundaries` does not apply — the rule only governs files inside tagged projects.

If lint flags any of the advisory services because of the import direction, the fix is to add the `scripts/benchmark-agents/**` paths to `eslint.config.js` § `allow:`. Do **not** add fake re-exports or duplicate the production exports — keep the bench files importing directly so prompt-template drift is a compile-time failure.

- [ ] **Step 6: Verify each bench config typechecks individually**

```bash
for t in user-goals risk-assessment market-research portfolio-construction rebalance-planner explainability; do
  pnpm tsx -e "import('./scripts/benchmark-agents/tasks/${t}.bench.ts').then(m => console.log(m.benchConfig.taskName));"
done
```

Expected: prints each task name in turn. This proves all 6 production imports resolve through pnpm's hoisted node_modules.

- [ ] **Step 7: Commit**

```bash
git add scripts/benchmark-agents .gitignore package.json pnpm-lock.yaml
git commit -m "feat(benchmark-agents): scaffold runner + 6 bench configs"
```

---

## Task 2: Shared types (TDD)

**Files:**
- Modify: `scripts/benchmark-agents/lib/types.ts`
- Create: `scripts/benchmark-agents/lib/types.test.ts`
- Create: `scripts/benchmark-agents/jest.config.ts`
- Create: `scripts/benchmark-agents/tsconfig.spec.json`

The workspace uses Jest + ts-jest (NOT vitest — vitest is not installed). The shared preset is at the repo root (`jest.preset.js`). Since `scripts/benchmark-agents/` is not an Nx project, we configure a small standalone jest config that picks up the workspace preset; this lets Tasks 2/3/4's TDD tests run via `pnpm jest --config scripts/benchmark-agents/jest.config.ts`.

- [ ] **Step 0: Add the jest config + tsconfig.spec.json (one-time)**

`scripts/benchmark-agents/jest.config.ts`:

```typescript
import basePreset from '../../jest.preset.js';

export default {
  ...basePreset,
  displayName: 'benchmark-agents',
  rootDir: '.',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  testMatch: ['<rootDir>/**/*.test.ts'],
};
```

`scripts/benchmark-agents/tsconfig.spec.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "module": "commonjs",
    "types": ["jest", "node"],
    "esModuleInterop": true
  },
  "include": [
    "**/*.test.ts",
    "**/*.ts"
  ]
}
```

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/benchmark-agents/lib/types.test.ts
import type { IterationResult, ModelSweep, RawResults, TaskBenchConfig } from './types';

describe('types', () => {
  it('IterationResult allows null for notDegraded + validationPass', () => {
    const r: IterationResult = {
      ix: 0,
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUSD: 0,
      schemaPass: false,
      notDegraded: null,
      validationPass: null,
      output: null,
      error: 'ThrottlingException',
    };
    expect(r.schemaPass).toBe(false);
  });

  it('ModelSweep aggregates carry pass-rates as N/M strings', () => {
    const s: ModelSweep = {
      modelId: 'us.anthropic.claude-sonnet-4-6',
      iterations: [],
      aggregates: {
        schemaPassRate: '3/3',
        notDegradedRate: '2/3',
        validationPassRate: null,
        medianLatencyMs: 1000,
        minLatencyMs: 800,
        maxLatencyMs: 1200,
        medianCostUSD: 0.01,
        totalCostUSD: 0.03,
        totalInputTokens: 300,
        totalOutputTokens: 200,
      },
    };
    expect(s.aggregates.schemaPassRate).toBe('3/3');
  });

  it('RawResults binds task identity fields', () => {
    const r: RawResults = {
      taskName: 'explainability',
      service: 'advisory-narrative-ctrl',
      configFilePath: 'services/advisory/advisory-narrative-ctrl/src/agents/explainability.config.ts',
      fixturePath: 'benchmarks/fixtures/explainability.input.json',
      iterationsPerCombo: 3,
      startedAt: '2026-05-19T00:00:00.000Z',
      finishedAt: '2026-05-19T00:01:00.000Z',
      pricingFetchedAt: '2026-05-19T00:00:00.000Z',
      models: [],
    };
    expect(r.taskName).toBe('explainability');
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
pnpm jest --config scripts/benchmark-agents/jest.config.ts lib/types.test.ts
```

Expected: FAIL (TypeScript compilation error — types not exported yet).

- [ ] **Step 3: Implement types**

Replace `scripts/benchmark-agents/lib/types.ts`:

```typescript
import type { AgentConfig, ValidationRule } from '@nestfolio/agent-orchestrator';
import type { z } from 'zod';

export type TaskName =
  | 'user-goals'
  | 'risk-assessment'
  | 'market-research'
  | 'portfolio-construction'
  | 'rebalance-planner'
  | 'explainability';

export type ServiceName =
  | 'investor-profile-ctrl'
  | 'market-intelligence-ctrl'
  | 'portfolio-engine-ctrl'
  | 'advisory-narrative-ctrl';

export type OperatingMode = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

export interface TaskBenchConfig<T extends z.ZodType = z.ZodType> {
  readonly taskName: TaskName;
  readonly service: ServiceName;
  readonly configFilePath: string;
  readonly fixturePath: string;
  readonly operatingMode?: OperatingMode;
  readonly productionConfig: AgentConfig<T>;
  readonly validationRule: ValidationRule<unknown> | null;
  readonly models: readonly string[];
}

export interface IterationResult {
  readonly ix: number;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUSD: number;
  readonly schemaPass: boolean;
  readonly notDegraded: boolean | null;
  readonly validationPass: boolean | null;
  readonly output: Record<string, unknown> | null;
  readonly error: string | null;
}

export interface ModelSweepAggregates {
  readonly schemaPassRate: `${number}/${number}`;
  readonly notDegradedRate: `${number}/${number}`;
  readonly validationPassRate: `${number}/${number}` | null;
  readonly medianLatencyMs: number;
  readonly minLatencyMs: number;
  readonly maxLatencyMs: number;
  readonly medianCostUSD: number;
  readonly totalCostUSD: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
}

export interface ModelSweep {
  readonly modelId: string;
  readonly iterations: readonly IterationResult[];
  readonly aggregates: ModelSweepAggregates;
}

export interface RawResults {
  readonly taskName: TaskName;
  readonly service: ServiceName;
  readonly configFilePath: string;
  readonly fixturePath: string;
  readonly iterationsPerCombo: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly pricingFetchedAt: string;
  readonly models: readonly ModelSweep[];
}

export interface PricingCache {
  readonly fetchedAt: string;
  readonly models: Record<
    string,
    { readonly inputUSDPerMTok: number; readonly outputUSDPerMTok: number }
  >;
}

export interface FixtureFile {
  readonly capturedAt: string;
  readonly modelId: string;
  readonly logStreamName: string;
  readonly promptPrefixHash: string;
  readonly prompt: string;
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
pnpm jest --config scripts/benchmark-agents/jest.config.ts lib/types.test.ts
```

Expected: PASS, all 3 cases green.

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark-agents/lib/types.ts scripts/benchmark-agents/lib/types.test.ts scripts/benchmark-agents/jest.config.ts scripts/benchmark-agents/tsconfig.spec.json
git commit -m "feat(benchmark-agents): shared types + jest harness"
```

---

## Task 3: pricing-loader.ts (pure helper, TDD)

**Files:**
- Modify: `scripts/benchmark-agents/pricing-loader.ts`
- Create: `scripts/benchmark-agents/pricing-loader.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/benchmark-agents/pricing-loader.test.ts
import { baseModelIdFor, computeCostUSD } from './pricing-loader';
import type { PricingCache } from './lib/types';

const cache: PricingCache = {
  fetchedAt: '2026-05-19T00:00:00Z',
  models: {
    'anthropic.claude-sonnet-4-6': { inputUSDPerMTok: 3.0, outputUSDPerMTok: 15.0 },
    'us.anthropic.claude-opus-4-6-v1': { inputUSDPerMTok: 15.0, outputUSDPerMTok: 75.0 },
    'amazon.nova-pro': { inputUSDPerMTok: 0.8, outputUSDPerMTok: 3.2 },
  },
};

describe('baseModelIdFor', () => {
  it('strips us. inference-profile prefix', () => {
    expect(baseModelIdFor('us.anthropic.claude-sonnet-4-6')).toBe('anthropic.claude-sonnet-4-6');
  });
  it('strips -v1:0 suffix on Nova-style ids', () => {
    expect(baseModelIdFor('amazon.nova-pro-v1:0')).toBe('amazon.nova-pro');
    expect(baseModelIdFor('amazon.nova-lite-v1:0')).toBe('amazon.nova-lite');
  });
  it('leaves already-bare ids untouched', () => {
    expect(baseModelIdFor('meta.llama3-3-70b-instruct')).toBe('meta.llama3-3-70b-instruct');
  });
});

describe('computeCostUSD', () => {
  it('uses literal modelId when present in cache', () => {
    const usd = computeCostUSD(cache, 'us.anthropic.claude-opus-4-6-v1', 1_000_000, 500_000);
    expect(usd).toBeCloseTo(52.5, 4);
  });
  it('falls back to base modelId when literal misses', () => {
    const usd = computeCostUSD(cache, 'us.anthropic.claude-sonnet-4-6', 1_000_000, 1_000_000);
    expect(usd).toBeCloseTo(18.0, 4);
  });
  it('strips both prefix and -v1:0 to find Nova base', () => {
    const usd = computeCostUSD(cache, 'amazon.nova-pro-v1:0', 500_000, 500_000);
    expect(usd).toBeCloseTo(2.0, 4);
  });
  it('throws when both literal and base miss', () => {
    expect(() => computeCostUSD(cache, 'us.anthropic.claude-mystery-99', 1, 1)).toThrow(/no pricing/);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
pnpm jest --config scripts/benchmark-agents/jest.config.ts pricing-loader.test.ts
```

Expected: FAIL (TS compile error — `baseModelIdFor` / `computeCostUSD` not exported).

- [ ] **Step 3: Implement pricing-loader.ts**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { PricingCache } from './lib/types';

const PRICING_PATH = path.resolve('benchmarks/cache/pricing.json');

export function baseModelIdFor(modelId: string): string {
  // Strip cross-region inference-profile prefix (us./eu./apac.).
  const noPrefix = modelId.replace(/^(us|eu|apac)\./, '');
  // Strip trailing -v<digits> or -v<digits>:<digits> suffix (handles Nova v1:0).
  return noPrefix.replace(/-v\d+(:\d+)?$/, '');
}

export function computeCostUSD(
  cache: PricingCache,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const literal = cache.models[modelId];
  const base = cache.models[baseModelIdFor(modelId)];
  const entry = literal ?? base;
  if (!entry) {
    throw new Error(
      `no pricing entry for ${modelId} (literal or base ${baseModelIdFor(modelId)})`,
    );
  }
  return (
    (inputTokens / 1_000_000) * entry.inputUSDPerMTok +
    (outputTokens / 1_000_000) * entry.outputUSDPerMTok
  );
}

export function loadPricingCache(): PricingCache {
  if (!fs.existsSync(PRICING_PATH)) {
    throw new Error(
      `pricing cache missing at ${PRICING_PATH} — run scripts/benchmark-agents/refresh-pricing.ts`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(PRICING_PATH, 'utf8')) as PricingCache;
  const ageMs = Date.now() - new Date(raw.fetchedAt).getTime();
  if (ageMs > 7 * 24 * 3600 * 1000) {
    console.warn(
      `[pricing-loader] cache is ${Math.floor(ageMs / 86400000)}d old — consider --refresh-pricing`,
    );
  }
  return raw;
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
pnpm jest --config scripts/benchmark-agents/jest.config.ts pricing-loader.test.ts
```

Expected: PASS, all 7 cases green.

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark-agents/pricing-loader.ts scripts/benchmark-agents/pricing-loader.test.ts
git commit -m "feat(benchmark-agents): pricing-loader with inference-profile fallback"
```

---

## Task 4: timings.ts (hrtime + percentile, TDD)

**Files:**
- Modify: `scripts/benchmark-agents/lib/timings.ts`
- Create: `scripts/benchmark-agents/lib/timings.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/benchmark-agents/lib/timings.test.ts
import { asRate, hrtimeMsAround, median } from './timings';

describe('median', () => {
  it('returns middle of odd-length array', () => {
    expect(median([1, 5, 3])).toBe(3);
  });
  it('returns mean of two middles on even length', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('throws on empty array', () => {
    expect(() => median([])).toThrow();
  });
});

describe('asRate', () => {
  it('formats numerator/denominator', () => {
    expect(asRate(3, 3)).toBe('3/3');
    expect(asRate(0, 3)).toBe('0/3');
  });
});

describe('hrtimeMsAround', () => {
  it('measures elapsed ms of async function', async () => {
    const { ms, value } = await hrtimeMsAround(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return 42;
    });
    expect(value).toBe(42);
    expect(ms).toBeGreaterThanOrEqual(25);
    expect(ms).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
pnpm jest --config scripts/benchmark-agents/jest.config.ts lib/timings.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement timings**

```typescript
export function median(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error('median of empty array');
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function asRate(num: number, denom: number): `${number}/${number}` {
  return `${num}/${denom}` as `${number}/${number}`;
}

export async function hrtimeMsAround<T>(
  fn: () => Promise<T>,
): Promise<{ ms: number; value: T }> {
  const start = process.hrtime.bigint();
  const value = await fn();
  const end = process.hrtime.bigint();
  return { ms: Number(end - start) / 1_000_000, value };
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
pnpm jest --config scripts/benchmark-agents/jest.config.ts lib/timings.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark-agents/lib/timings.ts scripts/benchmark-agents/lib/timings.test.ts
git commit -m "feat(benchmark-agents): timings helpers"
```

---

## Task 5: refresh-pricing.ts (Price List API)

**Files:**
- Modify: `scripts/benchmark-agents/refresh-pricing.ts`

- [ ] **Step 1: Implement refresh-pricing.ts**

```typescript
#!/usr/bin/env tsx
/* refresh-pricing.ts — fetches Bedrock per-token pricing from the AWS Price List
 * Query API and writes benchmarks/cache/pricing.json.
 *
 * Resolves the union of sweep modelIds from `scripts/benchmark-agents/tasks/*.bench.ts`
 * via dynamic import, so adding a 7th bench file or a new sweep model auto-picks-up
 * with no edits here.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { PricingClient, GetProductsCommand } from '@aws-sdk/client-pricing';
import { baseModelIdFor } from './pricing-loader';
import type { PricingCache } from './lib/types';

const TASKS_DIR = path.resolve('scripts/benchmark-agents/tasks');
const OUT_PATH = path.resolve('benchmarks/cache/pricing.json');

async function collectModelIds(): Promise<string[]> {
  const files = (await fs.readdir(TASKS_DIR)).filter((f) => f.endsWith('.bench.ts'));
  const set = new Set<string>();
  for (const f of files) {
    const mod = (await import(path.join(TASKS_DIR, f))) as {
      benchConfig: { models: readonly string[] };
    };
    for (const m of mod.benchConfig.models) set.add(m);
  }
  return [...set];
}

interface PriceDimension {
  pricePerUnit?: { USD?: string };
  description?: string;
  unit?: string;
}

async function fetchPriceForModel(
  client: PricingClient,
  modelId: string,
): Promise<{ inputUSDPerMTok: number; outputUSDPerMTok: number } | null> {
  // Bedrock products live under ServiceCode 'AmazonBedrock'.
  const cmd = new GetProductsCommand({
    ServiceCode: 'AmazonBedrock',
    Filters: [{ Type: 'TERM_MATCH', Field: 'model', Value: modelId }],
    MaxResults: 100,
  });
  const resp = await client.send(cmd);
  if (!resp.PriceList || resp.PriceList.length === 0) return null;
  let input = NaN;
  let output = NaN;
  for (const raw of resp.PriceList) {
    const product = JSON.parse(typeof raw === 'string' ? raw : (raw as unknown as string));
    const terms = (product?.terms?.OnDemand ?? {}) as Record<
      string,
      { priceDimensions?: Record<string, PriceDimension> }
    >;
    for (const term of Object.values(terms)) {
      for (const dim of Object.values(term.priceDimensions ?? {})) {
        const usd = Number(dim.pricePerUnit?.USD ?? 'NaN');
        const desc = (dim.description ?? '').toLowerCase();
        if (!Number.isFinite(usd)) continue;
        // Per-1k-tokens dimensions need × 1000 to land at USD/MTok.
        const unit = (dim.unit ?? '').toLowerCase();
        const usdPerMTok = unit.includes('1k tokens') ? usd * 1000 : usd * 1_000_000;
        if (desc.includes('input')) input = usdPerMTok;
        else if (desc.includes('output')) output = usdPerMTok;
      }
    }
  }
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return { inputUSDPerMTok: input, outputUSDPerMTok: output };
}

async function main(): Promise<void> {
  const sweepIds = await collectModelIds();
  console.log(`[refresh-pricing] resolving ${sweepIds.length} sweep modelIds`);
  const client = new PricingClient({ region: 'us-east-1' });
  const out: PricingCache = { fetchedAt: new Date().toISOString(), models: {} };
  const misses: string[] = [];
  for (const id of sweepIds) {
    const literal = await fetchPriceForModel(client, id);
    if (literal) {
      out.models[id] = literal;
      continue;
    }
    const base = baseModelIdFor(id);
    const fallback = await fetchPriceForModel(client, base);
    if (fallback) {
      out.models[base] = fallback;
      continue;
    }
    misses.push(`${id} (also missed base ${base})`);
  }
  if (misses.length > 0) {
    console.error('[refresh-pricing] no pricing found for:');
    for (const m of misses) console.error(`  - ${m}`);
    process.exit(1);
  }
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`[refresh-pricing] wrote ${OUT_PATH} (${Object.keys(out.models).length} entries)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke-test against AWS**

```bash
AWS_PROFILE=nestfolio-dev pnpm tsx scripts/benchmark-agents/refresh-pricing.ts
```

Expected: writes `benchmarks/cache/pricing.json` containing one entry per unique sweep modelId across the 6 bench configs. If any modelId mistypos (e.g. `meta.llama-3-3-...` vs `meta.llama3-3-...`), the script exits non-zero — that's the verification gate spec §5 calls for. Fix the bench config, rerun.

- [ ] **Step 3: Sanity-check the cache**

```bash
cat benchmarks/cache/pricing.json | head -40
```

Verify the numbers are in the expected order of magnitude (opus around $15/MTok input + $75 output; sonnet ~$3 + $15; haiku ~$0.8 + $4; Nova Pro ~$0.8 + $3.2).

- [ ] **Step 4: Commit**

```bash
git add scripts/benchmark-agents/refresh-pricing.ts
git commit -m "feat(benchmark-agents): refresh-pricing with inference-profile fallback"
```

---

## Task 6: capture-fixture.ts (CloudWatch Logs Insights)

**Files:**
- Modify: `scripts/benchmark-agents/capture-fixture.ts`

- [ ] **Step 1: Implement capture-fixture.ts**

```typescript
#!/usr/bin/env tsx
/* capture-fixture.ts — pulls the most recent successful Bedrock invocation
 * matching a task's prompt prefix from CloudWatch Logs Insights, captures the
 * verbatim post-substitution prompt, writes benchmarks/fixtures/<task>.input.json.
 *
 * Prereq: Task 0 (Bedrock model invocation logging enabled on dev).
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CloudWatchLogsClient,
  GetQueryResultsCommand,
  StartQueryCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import type { FixtureFile, TaskBenchConfig } from './lib/types';

// Override via env if Task 0 step 2 pinned a different log group name.
const LOG_GROUP =
  process.env.BEDROCK_INVOCATION_LOG_GROUP ?? '/aws/bedrock/dev-invocations';

const TASKS_DIR = path.resolve('scripts/benchmark-agents/tasks');
const FIXTURES_DIR = path.resolve('benchmarks/fixtures');

function derivePromptPrefix(template: string): string {
  const ix = template.indexOf('{input}');
  const prefix = ix >= 0 ? template.slice(0, ix) : template;
  return prefix.replace(/\s+$/, '').slice(0, 256);
}

function sha256(s: string): string {
  return 'sha256:' + crypto.createHash('sha256').update(s).digest('hex');
}

async function runInsightsQuery(
  client: CloudWatchLogsClient,
  logGroupName: string,
  queryString: string,
): Promise<Array<Array<{ field?: string; value?: string }>>> {
  const start = await client.send(
    new StartQueryCommand({
      logGroupName,
      startTime: Math.floor(Date.now() / 1000) - 24 * 3600,
      endTime: Math.floor(Date.now() / 1000),
      queryString,
      limit: 5,
    }),
  );
  const queryId = start.queryId;
  if (!queryId) throw new Error('StartQuery returned no queryId');
  for (let i = 0; i < 30; i++) {
    const r = await client.send(new GetQueryResultsCommand({ queryId }));
    if (r.status === 'Complete') {
      return (r.results ?? []) as Array<Array<{ field?: string; value?: string }>>;
    }
    if (r.status === 'Failed' || r.status === 'Cancelled') {
      throw new Error(`Insights query ${r.status}: ${queryString}`);
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`Insights query timed out after 30s: ${queryString}`);
}

function extractPromptText(parsed: unknown): string {
  const p = parsed as {
    input?: {
      inputBodyJson?: { messages?: Array<{ content?: unknown }> };
      messages?: Array<{ content?: unknown }>;
    };
  };
  const messages = p?.input?.inputBodyJson?.messages ?? p?.input?.messages ?? [];
  const content = messages?.[0]?.content ?? [];
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c as { text?: string }).text ?? '').join('');
  }
  return '';
}

async function captureForTask(taskArg: string): Promise<void> {
  const benchPath = path.join(TASKS_DIR, `${taskArg}.bench.ts`);
  const mod = (await import(benchPath)) as { benchConfig: TaskBenchConfig };
  const { taskName, productionConfig } = mod.benchConfig;
  if (taskName !== taskArg) {
    throw new Error(`bench file ${benchPath} has taskName=${taskName}, expected ${taskArg}`);
  }

  const prefix = derivePromptPrefix(productionConfig.promptTemplate);
  const prefixHash = sha256(prefix);
  console.log(`[capture-fixture] task=${taskName} modelId=${productionConfig.modelId}`);
  console.log(`[capture-fixture] prefix(${prefix.length}c)=${prefix.slice(0, 80)}...`);

  // Insights filter: modelId match + first 40 chars of the prompt prefix appear
  // in @message. The 40-char window is chosen so the substring is short enough
  // to be unique to this task (each task's system instruction is distinct by
  // construction) yet long enough to avoid false positives across tasks.
  const subPrefix = prefix.slice(0, 40);
  const query = `
    fields @timestamp, @logStream, @message
    | filter modelId = "${productionConfig.modelId}"
    | filter @message like ${JSON.stringify(subPrefix)}
    | sort @timestamp desc
    | limit 5
  `;

  const client = new CloudWatchLogsClient({ region: 'us-east-1' });
  const rows = await runInsightsQuery(client, LOG_GROUP, query);

  if (rows.length === 0) {
    console.error(`[capture-fixture] no successful match for ${taskName} in last 24h.`);
    console.error(`  Tried prefix: ${prefix.slice(0, 120)}...`);
    console.error(`  modelId: ${productionConfig.modelId}`);
    console.error(`  Hint: (1) trigger a fresh dev decision cycle,`);
    console.error(`        (2) verify Bedrock invocation logging is enabled (Task 0),`);
    console.error(`        (3) check whether the task's prompt template has changed`);
    console.error(`            (the prefix you'd find in logs would differ).`);
    process.exit(1);
  }

  const msgField = rows[0].find((f) => f.field === '@message')?.value ?? '';
  const streamField = rows[0].find((f) => f.field === '@logStream')?.value ?? '';
  const parsed = JSON.parse(msgField);
  const text = extractPromptText(parsed);

  if (!text || !text.includes(subPrefix)) {
    throw new Error(
      `Insights returned a row but the extracted prompt does not contain the derived prefix. ` +
        `Likely a JSON path mismatch in extractPromptText() — verify against Task 0 step 2 pinning. ` +
        `Extracted (first 200): ${text.slice(0, 200)}`,
    );
  }

  const fixture: FixtureFile = {
    capturedAt: new Date().toISOString(),
    modelId: productionConfig.modelId,
    logStreamName: streamField,
    promptPrefixHash: prefixHash,
    prompt: text,
  };

  await fs.mkdir(FIXTURES_DIR, { recursive: true });
  const out = path.join(FIXTURES_DIR, `${taskName}.input.json`);
  await fs.writeFile(out, JSON.stringify(fixture, null, 2));
  console.log(`[capture-fixture] wrote ${out} (prompt ${text.length} chars)`);
}

async function main(): Promise<void> {
  const ix = process.argv.indexOf('--task');
  if (ix === -1 || !process.argv[ix + 1]) {
    console.error('usage: capture-fixture.ts --task <name>');
    process.exit(2);
  }
  await captureForTask(process.argv[ix + 1]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke-test on the cheapest task (explainability)**

```bash
AWS_PROFILE=nestfolio-dev pnpm tsx scripts/benchmark-agents/capture-fixture.ts --task explainability
```

Expected outcomes:
- Logging enabled + recent decision cycle ran → writes `benchmarks/fixtures/explainability.input.json` (prompt body in the multi-KB range).
- Logging enabled but no match in 24h → exits non-zero with the diagnostic message. Trigger one decision cycle (e.g. run a known-fast e2e scenario against dev), then rerun.
- JSON path mismatch → the inner `extractPromptText` throws with the first 200 chars of what it tried. Update the path according to Task 0 step 2's pinning and rerun.

- [ ] **Step 3: Commit (no fixture file lands in git — that path is gitignored)**

```bash
git add scripts/benchmark-agents/capture-fixture.ts
git commit -m "feat(benchmark-agents): capture-fixture from CloudWatch Logs Insights"
```

---

## Task 7: invoke-model.ts (LLM wrapper)

**Files:**
- Modify: `scripts/benchmark-agents/lib/invoke-model.ts`

- [ ] **Step 1: Implement invoke-model.ts**

```typescript
/* invoke-model.ts — single Bedrock structured-output call. Returns latency,
 * token counts (read from raw.usage_metadata — NOT the broken
 * output.llmOutput.tokenUsage path the production AgentTracer uses; see
 * backlog agent-tracer-bedrock-converse-token-extraction), parsed result,
 * schema-pass boolean, and the raw error string on failure.
 *
 * The production agent-factory.ts retry path (looksDegraded → REINFORCE_SUFFIX
 * → second attempt) is intentionally NOT replicated here — the benchmark
 * measures per-call behaviour. The benchmark records `notDegraded` separately
 * so Claude can still reason about whether the production retry would have
 * been triggered.
 */

import { ChatBedrockConverse } from '@langchain/aws';
import type { z } from 'zod';
import { hrtimeMsAround } from './timings';

export interface InvokeArgs<T extends z.ZodType> {
  readonly modelId: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly schema: T;
  readonly prompt: string;
}

export interface InvokeOutcome {
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly schemaPass: boolean;
  readonly parsed: Record<string, unknown> | null;
  readonly error: string | null;
}

export async function invokeStructured<T extends z.ZodType>(
  args: InvokeArgs<T>,
): Promise<InvokeOutcome> {
  const llm = new ChatBedrockConverse({
    model: args.modelId,
    maxTokens: args.maxTokens,
    temperature: args.temperature,
    region: 'us-east-1',
  });
  // includeRaw: true returns { raw: AIMessage, parsed: T }. usage_metadata
  // hangs off raw and carries Converse's token counts correctly.
  const structured = llm.withStructuredOutput(args.schema as never, { includeRaw: true });
  try {
    const { ms, value } = await hrtimeMsAround(async () => structured.invoke(args.prompt));
    const v = value as unknown as {
      raw?: {
        usage_metadata?: { input_tokens?: number; output_tokens?: number };
      };
      parsed?: Record<string, unknown>;
    };
    const inputTokens = v.raw?.usage_metadata?.input_tokens ?? 0;
    const outputTokens = v.raw?.usage_metadata?.output_tokens ?? 0;
    return {
      latencyMs: Math.round(ms),
      inputTokens,
      outputTokens,
      schemaPass: true,
      parsed: v.parsed ?? null,
      error: null,
    };
  } catch (err) {
    return {
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      schemaPass: false,
      parsed: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
```

- [ ] **Step 2: Commit (no unit test — covered by the Task 8 dry-run smoke)**

```bash
git add scripts/benchmark-agents/lib/invoke-model.ts
git commit -m "feat(benchmark-agents): invoke-model wrapper"
```

---

## Task 8: run.ts (single-task sweep)

**Files:**
- Modify: `scripts/benchmark-agents/run.ts`

- [ ] **Step 1: Implement run.ts**

```typescript
#!/usr/bin/env tsx
/* run.ts — sweep one task across its bench config's models[], write
 * benchmarks/tasks/<task>/<ISO>/raw-results.json. Sequential calls only
 * (Bedrock opus throttles on parallel sustained QPS).
 *
 * Comma-list parsing across multiple tasks lives at the SKILL.md layer (§8 of
 * the spec) — this script handles exactly one --task at a time.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { looksDegraded } from '@nestfolio/agent-orchestrator';
import { invokeStructured } from './lib/invoke-model';
import { asRate, median } from './lib/timings';
import { computeCostUSD, loadPricingCache } from './pricing-loader';
import type {
  FixtureFile,
  IterationResult,
  ModelSweep,
  ModelSweepAggregates,
  RawResults,
  TaskBenchConfig,
} from './lib/types';

const TASKS_DIR = path.resolve('scripts/benchmark-agents/tasks');
const RESULTS_ROOT = path.resolve('benchmarks/tasks');
const PRICING_PATH = path.resolve('benchmarks/cache/pricing.json');

interface Args {
  readonly task: string;
  readonly iterations: number;
  readonly refreshPricing: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let task = '';
  let iterations = 3;
  let refreshPricing = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--task') task = argv[++i];
    else if (argv[i] === '--iterations') iterations = Number(argv[++i]);
    else if (argv[i] === '--refresh-pricing') refreshPricing = true;
  }
  if (!task) {
    console.error('usage: run.ts --task <name> [--iterations N] [--refresh-pricing]');
    process.exit(2);
  }
  if (!Number.isFinite(iterations) || iterations < 1) {
    console.error('--iterations must be a positive integer');
    process.exit(2);
  }
  return { task, iterations, refreshPricing };
}

function aggregate(
  iterations: readonly IterationResult[],
  hasRule: boolean,
): ModelSweepAggregates {
  const passes = iterations.filter((i) => i.schemaPass);
  const notDegraded = passes.filter((i) => i.notDegraded === true);
  const validationPass = passes.filter((i) => i.validationPass === true);
  const latencies = passes.map((i) => i.latencyMs);
  const costs = passes.map((i) => i.costUSD);
  return {
    schemaPassRate: asRate(passes.length, iterations.length),
    notDegradedRate: asRate(notDegraded.length, Math.max(passes.length, 1)),
    validationPassRate: hasRule
      ? asRate(validationPass.length, Math.max(passes.length, 1))
      : null,
    medianLatencyMs: latencies.length ? Math.round(median(latencies)) : 0,
    minLatencyMs: latencies.length ? Math.min(...latencies) : 0,
    maxLatencyMs: latencies.length ? Math.max(...latencies) : 0,
    medianCostUSD: costs.length ? Number(median(costs).toFixed(6)) : 0,
    totalCostUSD: Number(costs.reduce((a, b) => a + b, 0).toFixed(6)),
    totalInputTokens: passes.reduce((a, b) => a + b.inputTokens, 0),
    totalOutputTokens: passes.reduce((a, b) => a + b.outputTokens, 0),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Pricing — refresh if missing, > 7 days old, or forced.
  const pricingStatMs = await fs
    .stat(PRICING_PATH)
    .then((s) => s.mtimeMs)
    .catch(() => 0);
  const needsRefresh =
    args.refreshPricing ||
    pricingStatMs === 0 ||
    Date.now() - pricingStatMs > 7 * 24 * 3600 * 1000;
  if (needsRefresh) {
    console.log('[run] refreshing pricing cache');
    execSync('pnpm tsx scripts/benchmark-agents/refresh-pricing.ts', { stdio: 'inherit' });
  }
  const pricing = loadPricingCache();

  // Bench config + fixture.
  const benchPath = path.join(TASKS_DIR, `${args.task}.bench.ts`);
  const mod = (await import(benchPath)) as { benchConfig: TaskBenchConfig };
  const bench = mod.benchConfig;
  const fixtureRaw = await fs.readFile(path.resolve(bench.fixturePath), 'utf8');
  const fixture = JSON.parse(fixtureRaw) as FixtureFile;
  console.log(
    `[run] task=${bench.taskName} models=${bench.models.length} iterations=${args.iterations}`,
  );

  const startedAt = new Date().toISOString();
  const sweeps: ModelSweep[] = [];

  for (const modelId of bench.models) {
    console.log(`[run] sweeping ${modelId}`);
    const iters: IterationResult[] = [];
    for (let ix = 0; ix < args.iterations; ix++) {
      const r = await invokeStructured({
        modelId,
        maxTokens: bench.productionConfig.maxTokens,
        temperature: bench.productionConfig.temperature,
        schema: bench.productionConfig.schema,
        prompt: fixture.prompt,
      });
      const cost = r.schemaPass
        ? computeCostUSD(pricing, modelId, r.inputTokens, r.outputTokens)
        : 0;
      let notDegraded: boolean | null = null;
      let validationPass: boolean | null = null;
      if (r.schemaPass && r.parsed !== null) {
        notDegraded = !looksDegraded(r.parsed, bench.productionConfig.schema);
        if (bench.validationRule) {
          const v = bench.validationRule.validate(r.parsed as never, {
            state: {},
            attempt: 0,
          });
          validationPass = v.valid;
        }
      }
      iters.push({
        ix,
        latencyMs: r.latencyMs,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUSD: Number(cost.toFixed(6)),
        schemaPass: r.schemaPass,
        notDegraded,
        validationPass,
        output: r.parsed,
        error: r.error,
      });
      console.log(
        `  ix=${ix} schemaPass=${r.schemaPass} lat=${r.latencyMs}ms tok=${r.inputTokens}/${r.outputTokens} cost=$${cost.toFixed(4)}`,
      );
    }
    sweeps.push({
      modelId,
      iterations: iters,
      aggregates: aggregate(iters, bench.validationRule !== null),
    });
  }

  const finishedAt = new Date().toISOString();
  const out: RawResults = {
    taskName: bench.taskName,
    service: bench.service,
    configFilePath: bench.configFilePath,
    fixturePath: bench.fixturePath,
    iterationsPerCombo: args.iterations,
    startedAt,
    finishedAt,
    pricingFetchedAt: pricing.fetchedAt,
    models: sweeps,
  };

  const outDir = path.join(RESULTS_ROOT, bench.taskName, startedAt.replace(/[:.]/g, '-'));
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'raw-results.json');
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
  // stdout — SKILL.md scrapes this line.
  console.log(`[run] raw-results=${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Single-model, single-iteration smoke**

Temporarily shrink `tasks/explainability.bench.ts` `models` to just `['us.anthropic.claude-haiku-4-5-20251001-v1:0']`, then:

```bash
AWS_PROFILE=nestfolio-dev pnpm tsx scripts/benchmark-agents/run.ts --task explainability --iterations 1
```

Expected:
- One `[run] sweeping ...` line, one `ix=0 schemaPass=true lat=<n>ms tok=<X>/<Y> cost=$0.0xxx` line.
- A trailing `[run] raw-results=benchmarks/tasks/explainability/<ts>/raw-results.json` line.
- Inspect the JSON: `aggregates.schemaPassRate='1/1'`, `aggregates.totalInputTokens > 0`, `iterations[0].output` is a populated object.

If tokens are zero, log `JSON.stringify(value.raw)` from `invoke-model.ts` to find the correct field — `usage_metadata` is the LangChain standard but `@langchain/aws` may have shifted it.

- [ ] **Step 3: Restore the full models[] list in explainability.bench.ts**

- [ ] **Step 4: Commit**

```bash
git add scripts/benchmark-agents/run.ts
git commit -m "feat(benchmark-agents): single-task sweep runner"
```

---

## Task 9: SKILL.md (Claude orchestration playbook)

**Files:**
- Create: `.claude/skills/benchmark-agents/SKILL.md`

- [ ] **Step 1: Author SKILL.md**

```markdown
---
name: benchmark-agents
description: Sweep multiple Bedrock models against each of the 6 production AgentConfigs in the advisory domain, capture latency / token usage / cost / schema-pass / not-degraded / validation-pass per iteration against a real captured prompt, and produce per-task + cross-task evaluation reports. Invoked only via `/benchmark-agents` (optional `<task1>,<task2>` and/or `--iterations N`).
---

## What this skill does

For each requested task, runs `scripts/benchmark-agents/run.ts` — which sweeps that task's `models[]` against its captured production prompt — then Claude reads the resulting `raw-results.json` and writes an `evaluation.md`. After all requested tasks complete, Claude writes a cross-task `cross-task-report.md`.

All artifacts land under `benchmarks/` (gitignored end-to-end). No `*.config.ts` files are edited by this skill — recommendations are read-only output that humans apply in a follow-on PR.

## When this skill applies

Invoke only when the user types `/benchmark-agents` (optionally followed by `<task1>,<task2>` and/or `--iterations N`). Do NOT invoke otherwise. Do NOT auto-run on a schedule — that is filed `out_of_scope` in the design spec.

## Procedure

### 0. Parse argv against the live task allowlist

```bash
ls scripts/benchmark-agents/tasks/*.bench.ts | xargs -n1 basename | sed 's/\.bench\.ts$//'
```

Today this prints: `explainability market-research portfolio-construction rebalance-planner risk-assessment user-goals`. Use this dynamic set as the allowlist — never hardcode the 6 names in this SKILL.md (that's the drift trap §8 calls out).

Parsing rules:
- No positional args → sweep all 6 tasks.
- `<task1>,<task2>` → split on comma, validate each against the allowlist. Reject + bail loudly on any name not in the set (e.g. `onboarding`, `compliance`, service names).
- `--iterations <N>` → positive integer, default `3`. Pass through to `run.ts`.

### 1. Preflight

```bash
echo "${AWS_PROFILE:-}"
```

Must print `nestfolio-dev`. If empty or different, ask the user to set it. Verify `pnpm` is on PATH.

### 2. Fixtures

For each requested task, check whether the fixture file already exists:

```bash
test -f benchmarks/fixtures/<task>.input.json
```

If missing:

```bash
AWS_PROFILE=nestfolio-dev pnpm tsx scripts/benchmark-agents/capture-fixture.ts --task <task>
```

On non-zero exit, surface the script's diagnostic message verbatim to the user. Do NOT synthesize a fake prompt — the capture step is what makes the benchmark truthful.

### 3. Pricing

If `benchmarks/cache/pricing.json` is missing or older than 7 days, run:

```bash
AWS_PROFILE=nestfolio-dev pnpm tsx scripts/benchmark-agents/refresh-pricing.ts
```

### 4. Sweep loop (one task at a time, sequential)

For each requested task:

```bash
AWS_PROFILE=nestfolio-dev pnpm tsx scripts/benchmark-agents/run.ts --task <task> --iterations <N>
```

Capture the trailing `[run] raw-results=<path>` line. That's the JSON the next step reads.

If a task throws `ThrottlingException` mid-sweep, the iteration is recorded with `schemaPass=false` and the script continues. Note throttled rows in the evaluation and recommend the user rerun just that task.

### 5. Per-task evaluation.md

Read each `raw-results.json`. Write `benchmarks/tasks/<task>/<same-ISO>/evaluation.md` with these sections in order:

1. **Header** — task name, owning service, production config file path, fixture path + `capturedAt`, run timestamp, iterations per combo, sum of `aggregates.totalCostUSD` across all models.
2. **Comparison table** — markdown, one row per model:

   ```
   | model | runs | schemaPass | notDegraded | validationPass | medianLat | medianCost | totalCost |
   ```

   Mark the row whose `modelId` matches the production config's `modelId` with `(current)`. Highlight any row where `schemaPass='3/3'` but `validationPass='0/3'` as **NOT production-viable**.

3. **Per-model section** — one paragraph per model commenting on:
   - (a) output semantic quality given the task's role (inspect iteration `output` fields, but quote ≤ 5 lines — never the full output);
   - (b) prompt-template tweaks that might lift this model specifically (e.g. "Llama 3.3 dropped the `rationale` field on 2/3 runs — adding `Return EVERY field including rationale` to the prompt would likely fix this");
   - (c) three-gate verdict (schemaPass / notDegraded / validationPass).

4. **Final recommendation** — explicit reasoning over quality / cost / latency anchored in this task's role. Format:

   > Recommend changing `modelId` in `<configFilePath>` from `<current>` to `<recommended>`.

   For portfolio-construction (builder function), append: "modelId is shared across all 3 OperatingModes — single edit applies everywhere."

### 6. Cross-task report

After all requested tasks finish, write `benchmarks/_summary/<ISO>/cross-task-report.md`:

1. **Recommendation snapshot table** — `| task | service | current model | recommended model | quality verdict | cost Δ/call | latency Δ/call | configFilePath |`.
2. **Projected cost-per-decision-cycle delta** — sum each task's effective per-call cost across one cycle. Effective factor per (task, model) = `2 − (notDegraded count / iterations)`. Render: "$X today vs $Y recommended". Models with `notDegradedRate < 0.7` flagged "retry-heavy — high variance".
3. **Iteration-noise caveat** — if any (task, model) has `(maxLat − minLat) / medianLat > 0.3` OR `(maxCost − minCost) / medianCost > 0.3`, recommend rerunning that subset with `--iterations 5` before treating the median as basis for the production edit.
4. **Cross-cutting observations** — patterns visible only across tasks (e.g. "Nova Pro faster than Sonnet 4.6 on structured-output across all 5 task types tried").
5. **Action items** — concrete edit list:
   - Static-export tasks (5 of 6): "`<configFilePath>` — change `modelId` from `<current>` to `<recommended>`."
   - portfolio-construction (builder function): "`<configFilePath>` — change `modelId` value inside `buildPortfolioConstructionConfig` (applies to all 3 modes)."

### 7. PII guard (mirrors spec §4.2)

- Never paste fixture content or full raw output into chat, PR descriptions, or any non-local surface.
- `evaluation.md` and `cross-task-report.md` may quote schemaPass/fail signals + ≤5-line structural excerpts. Never full prompt bodies. Never full structured outputs.
- The `benchmarks/` tree is gitignored entirely; treat the contents as the dev account's data.

### 8. Reporting back

When done, tell the user:
- Tasks swept + iteration count.
- The path to each `evaluation.md`.
- The path to `cross-task-report.md`.
- Total estimated cost across all `aggregates.totalCostUSD`.

Do NOT edit `*.config.ts`. Recommendations are read-only output.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/benchmark-agents/SKILL.md
git commit -m "feat(benchmark-agents): SKILL.md orchestration playbook"
```

---

## Task 10: End-to-end dry run on explainability (cheapest validation gate)

**Files:** none — artifacts under `benchmarks/`, all gitignored.

- [ ] **Step 1: Capture explainability fixture (if not already done in Task 6 step 2)**

```bash
AWS_PROFILE=nestfolio-dev pnpm tsx scripts/benchmark-agents/capture-fixture.ts --task explainability
```

Expected: `benchmarks/fixtures/explainability.input.json` exists, prompt field is non-empty.

- [ ] **Step 2: Refresh pricing**

```bash
AWS_PROFILE=nestfolio-dev pnpm tsx scripts/benchmark-agents/refresh-pricing.ts
```

Expected: `benchmarks/cache/pricing.json` exists with one entry per unique sweep modelId.

- [ ] **Step 3: Full sweep on explainability (7 models × 3 iterations = 21 calls)**

```bash
AWS_PROFILE=nestfolio-dev pnpm tsx scripts/benchmark-agents/run.ts --task explainability --iterations 3
```

Expected:
- All 21 iterations log non-zero token counts.
- At least Claude rows and Nova rows have `schemaPass=true` 3/3.
- Llama/Mistral may fail schema — that's the signal §10 anticipates.
- `aggregates.totalCostUSD` < $0.20 (haiku + sonnet + nova are cheap).
- Trailing line: `[run] raw-results=benchmarks/tasks/explainability/<ts>/raw-results.json`.

- [ ] **Step 4: Claude writes evaluation.md following SKILL.md step 5**

Sections: header + comparison table + 7 per-model paragraphs + final recommendation. Verify the markdown renders, the production row is marked `(current)`, and the recommendation names a concrete target modelId.

- [ ] **Step 5: No commit (all artifacts gitignored — this is a validation pass)**

Record the `raw-results.json` path and the `evaluation.md` path. They go into the workstream's `validation_gate:` evidence in Task 11.

---

## Task 11: Full sweep + cross-task report (workstream done-definition)

**Files:** none — artifacts under `benchmarks/`, all gitignored.

- [ ] **Step 1: Capture fixtures for the remaining 5 tasks**

```bash
for t in user-goals risk-assessment market-research portfolio-construction rebalance-planner; do
  AWS_PROFILE=nestfolio-dev pnpm tsx scripts/benchmark-agents/capture-fixture.ts --task "$t"
done
```

If any task exits non-zero, trigger a fresh dev decision cycle and rerun just that task's capture. Expected: 6 files under `benchmarks/fixtures/` when this step finishes.

- [ ] **Step 2: Sweep all 6 tasks (sequential)**

```bash
for t in user-goals risk-assessment market-research portfolio-construction rebalance-planner explainability; do
  AWS_PROFILE=nestfolio-dev pnpm tsx scripts/benchmark-agents/run.ts --task "$t" --iterations 3
done
```

Watch for `ThrottlingException` on opus rows in portfolio-construction. If a row throttles, rerun just that task.

Expected: 6 `raw-results.json` files. Approximate total cost: $7–$20 per spec §5.

- [ ] **Step 3: Write 6 per-task `evaluation.md` files**

One per `raw-results.json`, following SKILL.md step 5. Confirm each has a populated comparison table and a recommendation that names a concrete `<configFilePath>` and target modelId.

- [ ] **Step 4: Write `cross-task-report.md`**

`benchmarks/_summary/<ISO>/cross-task-report.md` — per SKILL.md step 6. Five sections: recommendation snapshot table, projected cost delta, iteration-noise caveat, cross-cutting observations, action items.

- [ ] **Step 5: Assemble `validation_gate:` evidence**

Record into the backlog file (`docs/backlog/agent-benchmark-skill.md`) `validation_gate:`:

- The 6 `raw-results.json` paths.
- The 6 `evaluation.md` paths.
- The `cross-task-report.md` path.
- Sum of `aggregates.totalCostUSD` across the 6 sweeps (sanity-check vs. the $7–$20 spec estimate).
- The commit SHA of the SKILL.md commit (Task 9 step 2).

This is the evidence the `/backlog-next` closing-phase step 6.5 will reference.

---

## Self-review notes

- Spec §1–§11 coverage: every architecture, component, data shape, risk, and order-of-implementation item maps to a task above.
- Type consistency: `TaskBenchConfig`, `IterationResult`, `ModelSweep`, `RawResults`, `PricingCache`, `FixtureFile` are defined once in Task 2 and consumed verbatim in Tasks 5/6/7/8.
- `looksDegraded` imported from `@nestfolio/agent-orchestrator` (production export, verified in `libs/agent-orchestrator/src/agent-factory.ts`).
- Token extraction path: `raw.usage_metadata.input_tokens` / `output_tokens` (LangChain standard via `withStructuredOutput({ includeRaw: true })`), explicitly distinct from the broken `output.llmOutput.tokenUsage` path the production AgentTracer uses — see backlog `agent-tracer-bedrock-converse-token-extraction`.
- No placeholder steps. Every code block is the actual final content; every command is runnable as-is once Task 0 has provisioned invocation logging.
