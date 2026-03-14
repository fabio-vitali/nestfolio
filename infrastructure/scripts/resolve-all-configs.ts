import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * resolve-all-configs.ts -- Resolves pipeline config for all discovered services.
 *
 * Usage: node resolve-all-configs.ts <tier> [--prefix=<prefix>]
 * Output: JSON array of ResolvedPipelineConfig objects to stdout.
 */

const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);

interface ResolvedConfig {
  service: string;
  subsystem: string;
  deploymentPhase: 1 | 2 | 3;
  dependencies: string[];
  observability: boolean;
  parallelDeploy: boolean;
  logRetention: number;
  protectedResources: boolean;
  alarmActions: string[];
  account?: string;
  region?: string;
  environment?: string;
  prefix: string;
}

type Tier = 'sandbox' | 'staging' | 'production';

const HARDCODED_FALLBACKS = {
  observability: false,
  logRetention: 14,
  protectedResources: false,
  parallelDeploy: true,
  alarmActions: [] as string[],
};

const VALID_TIERS: Tier[] = ['sandbox', 'staging', 'production'];

// CLI argument parsing
const args = process.argv.slice(2);
const tierArg = args[0];
if (!tierArg || !VALID_TIERS.includes(tierArg as Tier)) {
  console.error(`Usage: resolve-all-configs.ts <tier> [--prefix=<prefix>]`);
  console.error(`  tier: sandbox | staging | production`);
  process.exit(1);
}
const tier = tierArg as Tier;

let prefix = tier === 'production' ? 'prod' : tier;
for (const arg of args.slice(1)) {
  if (arg.startsWith('--prefix=')) {
    prefix = arg.slice('--prefix='.length);
  }
}

// Discover services
const rootDir = path.resolve(__dirname_esm, '..', '..');
const servicesDir = path.join(rootDir, 'services');

interface ServiceEntry {
  service: string;
  subsystem: string;
}

function discoverServices(): ServiceEntry[] {
  const entries: ServiceEntry[] = [];
  for (const subsystem of fs.readdirSync(servicesDir)) {
    const subsystemDir = path.join(servicesDir, subsystem);
    if (!fs.statSync(subsystemDir).isDirectory()) continue;
    for (const service of fs.readdirSync(subsystemDir)) {
      const mainTs = path.join(subsystemDir, service, 'src', 'main.ts');
      if (fs.existsSync(mainTs)) {
        entries.push({ service, subsystem });
      }
    }
  }
  return entries;
}

function inferMetadata(serviceName: string, subsystem: string) {
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

function loadDefaults(): Record<string, unknown> {
  const defaultsPath = path.join(rootDir, 'infrastructure', 'pipeline-defaults.json');
  if (!fs.existsSync(defaultsPath)) return {};
  return JSON.parse(fs.readFileSync(defaultsPath, 'utf-8'));
}

function loadServiceOverride(serviceName: string, subsystem: string): Record<string, unknown> {
  const overridePath = path.join(servicesDir, subsystem, serviceName, 'pipeline.json');
  if (!fs.existsSync(overridePath)) return {};
  return JSON.parse(fs.readFileSync(overridePath, 'utf-8'));
}

function resolveAll(): ResolvedConfig[] {
  const services = discoverServices();
  const defaults = loadDefaults();
  const tierData = defaults[tier];
  const results: ResolvedConfig[] = [];

  for (const { service, subsystem } of services) {
    const inferred = inferMetadata(service, subsystem);
    const override = loadServiceOverride(service, subsystem);
    const { $schema, sandbox, staging, production, ...topOverrides } = override as any;

    const tierScopedOverride = tier === 'sandbox' ? sandbox
      : tier === 'staging' ? staging
      : production;

    let targets: Array<Record<string, unknown>>;

    if (tier === 'production') {
      if (Array.isArray(tierScopedOverride)) {
        targets = tierScopedOverride;
      } else if (Array.isArray(tierData)) {
        targets = (tierData as Array<Record<string, unknown>>).map((t) => ({
          ...t,
          ...(typeof tierScopedOverride === 'object' ? tierScopedOverride : {}),
        }));
      } else {
        targets = [{ ...(typeof tierData === 'object' ? tierData : {}) }];
      }
    } else {
      targets = [typeof tierData === 'object' ? tierData as Record<string, unknown> : {}];
    }

    for (const target of targets) {
      const merged: ResolvedConfig = {
        ...inferred,
        ...HARDCODED_FALLBACKS,
        prefix,
      };

      for (const [key, value] of Object.entries(target)) {
        if (value !== undefined && key !== '$schema') {
          (merged as any)[key] = value;
        }
      }

      for (const [key, value] of Object.entries(topOverrides)) {
        if (value !== undefined) {
          (merged as any)[key] = value;
        }
      }

      if (tierScopedOverride && !Array.isArray(tierScopedOverride)) {
        for (const [key, value] of Object.entries(tierScopedOverride)) {
          if (value !== undefined) {
            (merged as any)[key] = value;
          }
        }
      }

      if (!merged.account) delete merged.account;
      if (!merged.region) delete merged.region;
      if (!merged.environment) delete merged.environment;

      results.push(merged);
    }
  }

  results.sort((a, b) =>
    a.deploymentPhase !== b.deploymentPhase
      ? a.deploymentPhase - b.deploymentPhase
      : a.service.localeCompare(b.service),
  );

  return results;
}

// Main
const configs = resolveAll();
console.log(JSON.stringify(configs, null, 2));
