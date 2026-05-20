import type { AgentConfig, ValidationRule } from '@nestfolio/agent-orchestrator';
import type { z } from 'zod';
import tiersJson from '../tiers.json';

export type Tier = keyof typeof tiersJson;

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
  readonly tier: Tier;
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

export interface PricingEntry {
  readonly inputUSDPerMTok: number;
  readonly outputUSDPerMTok: number;
  readonly source: 'aws-pricing-api';
  readonly serviceCode: 'AmazonBedrock' | 'AmazonBedrockFoundationModels';
  readonly inputUsagetype: string;
  readonly outputUsagetype: string;
  // Region the Pricing API returned the on-demand record for. Surfaces
  // cross-region pricing in evaluation reports for models that only publish
  // pricing in us-west-2 (e.g. some legacy Anthropic profiles).
  readonly regionCode: string;
}

export interface PricingCache {
  readonly fetchedAt: string;
  readonly models: Record<string, PricingEntry>;
}

export interface FixtureFile {
  readonly capturedAt: string;
  readonly modelId: string;
  readonly logStreamName: string;
  readonly promptPrefixHash: string;
  readonly prompt: string;
}

export type ExcludedReason =
  | 'sizeClass-unknown: no vendor classification'
  | 'no model access grant'
  | 'invalid modelId form (region/profile suffix shift)'
  | 'not available in region'
  | `probe-failed: ${string}`;

export interface ModelsCache {
  readonly fetchedAt: string;
  readonly tiersHash: string;
  readonly tiers: Record<Tier, readonly string[]>;
  readonly excluded: Record<string, ExcludedReason>;
  readonly uncategorized: readonly string[];
}
