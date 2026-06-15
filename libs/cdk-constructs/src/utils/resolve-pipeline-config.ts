import { Construct } from 'constructs';
import * as fs from 'fs';
import * as path from 'path';
import { getPrefix, discoverSubsystem, isProductionPrefix } from './naming-service';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ScheduleConfig {
  enabled: boolean;
  rate: string;
}

export interface ResolvedPipelineConfig {
  service: string;
  subsystem: string;
  deploymentPhase: 1 | 2 | 3;
  dependencies: string[];
  observability: boolean;
  waf: boolean;
  parallelDeploy: boolean;
  logRetention: number;
  protectedResources: boolean;
  alarmActions: string[];
  account?: string;
  region?: string;
  environment?: string;
  prefix: string;
  /** True only for production deploy prefixes. Drives env-aware RemovalPolicy
   *  (production RETAINs stateful resources; non-prod DESTROYs them). */
  production: boolean;
  schedule?: ScheduleConfig;
}

interface InferredMetadata {
  service: string;
  subsystem: string;
  deploymentPhase: 1 | 2 | 3;
  dependencies: string[];
}

type Tier = 'sandbox' | 'staging' | 'production';

type TierDefaults = Partial<
  Pick<
    ResolvedPipelineConfig,
    | 'observability'
    | 'waf'
    | 'parallelDeploy'
    | 'logRetention'
    | 'protectedResources'
    | 'alarmActions'
    | 'account'
    | 'region'
    | 'environment'
    | 'schedule'
  >
>;

// ── Constants ──────────────────────────────────────────────────────────────

export const HARDCODED_FALLBACKS: Pick<
  ResolvedPipelineConfig,
  'observability' | 'waf' | 'logRetention' | 'protectedResources' | 'parallelDeploy' | 'alarmActions'
> = {
  observability: false,
  waf: false,
  logRetention: 14,
  protectedResources: false,
  parallelDeploy: true,
  alarmActions: [],
};

// ── Layer 1: Inference ─────────────────────────────────────────────────────

/**
 * Infers deployment metadata from service name and subsystem.
 * The subsystem is passed in (discovered by the caller), not scanned from fs.
 */
export function inferServiceMetadata(serviceName: string, subsystem: string): InferredMetadata {
  const isHub = serviceName.endsWith('-hub');
  const isWeb = serviceName.endsWith('-web') || serviceName.endsWith('-auth');
  const isBff = serviceName.endsWith('-bff');

  let deploymentPhase: 1 | 2 | 3;
  let dependencies: string[];

  if (isHub) {
    deploymentPhase = 1;
    dependencies = [];
  } else if (isWeb) {
    deploymentPhase = 2;
    dependencies = [`${subsystem}-hub`];
  } else if (isBff) {
    deploymentPhase = 3;
    dependencies = [`${subsystem}-hub`, 'investor-web'];
  } else {
    deploymentPhase = 3;
    dependencies = [`${subsystem}-hub`];
  }

  return { service: serviceName, subsystem, deploymentPhase, dependencies };
}

// ── Layer 2: Tier Defaults ─────────────────────────────────────────────────

export function loadTierDefaults(tier: Tier): TierDefaults {
  const defaultsPath = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'infrastructure',
    'pipeline-defaults.json',
  );
  if (!fs.existsSync(defaultsPath)) return {};

  const raw = JSON.parse(fs.readFileSync(defaultsPath, 'utf-8'));
  const tierData = raw[tier];
  if (!tierData) return {};

  // If production is an array, we don't extract tier-level defaults here —
  // that's handled by resolveAllConfigs which expands per-target.
  // For single-target (object form), return as-is.
  if (Array.isArray(tierData)) return {};

  return tierData;
}

// ── Layer 3: Per-Service Overrides ─────────────────────────────────────────

function loadServiceOverrides(
  serviceName: string,
  subsystem: string,
  tier: Tier,
): Record<string, unknown> {
  const overridePath = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'services',
    subsystem,
    serviceName,
    'pipeline.json',
  );
  if (!fs.existsSync(overridePath)) return {};

  const raw = JSON.parse(fs.readFileSync(overridePath, 'utf-8'));

  // Extract tier-scoped overrides and merge with top-level overrides
  const { sandbox, staging, production, $schema: _schema, ...topLevel } = raw;
  const tierScoped = tier === 'sandbox' ? sandbox : tier === 'staging' ? staging : production;

  // If tier-scoped is an array (multi-target production), ignore here
  if (Array.isArray(tierScoped)) return topLevel;

  return { ...topLevel, ...(tierScoped ?? {}) };
}

// ── Tier Detection ─────────────────────────────────────────────────────────

function detectTier(prefix: string): Tier {
  if (prefix.startsWith('sandbox')) return 'sandbox';
  if (prefix === 'staging') return 'staging';
  if (isProductionPrefix(prefix)) return 'production';
  return 'sandbox'; // safe default
}

// ── Merge ──────────────────────────────────────────────────────────────────

export function mergeConfigs(
  inferred: InferredMetadata,
  tierDefaults: TierDefaults,
  overrides: Record<string, unknown>,
  prefix: string,
): ResolvedPipelineConfig {
  // Start with hardcoded fallbacks
  const base: ResolvedPipelineConfig = {
    ...inferred,
    ...HARDCODED_FALLBACKS,
    prefix,
    production: isProductionPrefix(prefix),
  };

  // Layer 2: tier defaults override fallbacks (scalars only)
  for (const [key, value] of Object.entries(tierDefaults)) {
    if (value !== undefined) {
      (base as any)[key] = value;
    }
  }

  // Layer 3: per-service overrides (scalars last-wins, arrays replace)
  for (const [key, value] of Object.entries(overrides)) {
    if (
      value !== undefined &&
      key !== '$schema' &&
      key !== 'sandbox' &&
      key !== 'staging' &&
      key !== 'production'
    ) {
      (base as any)[key] = value;
    }
  }

  return base;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolves the full pipeline config for a service.
 * Reads 'tier' and 'prefix' from CDK context.
 *
 * @param scope CDK construct scope (usually the App)
 * @param service The Nx project name (e.g. 'advisory-ctrl')
 */
export function resolvePipelineConfig(scope: Construct, service: string): ResolvedPipelineConfig {
  const prefix = getPrefix(scope);

  const tierContext = scope.node.tryGetContext('tier') as Tier | undefined;
  const tier: Tier = tierContext ?? detectTier(prefix);

  const subsystem = discoverSubsystem(service);
  const inferred = inferServiceMetadata(service, subsystem);
  const tierDefaults = loadTierDefaults(tier);
  const overrides = loadServiceOverrides(service, subsystem, tier);

  return mergeConfigs(inferred, tierDefaults, overrides, prefix);
}
