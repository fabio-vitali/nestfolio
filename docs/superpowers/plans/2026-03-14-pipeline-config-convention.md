# Pipeline Config Convention-over-Configuration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 16 identical `pipeline.json` files with a convention-over-configuration resolution engine that infers metadata from directory structure, reads tier defaults from a single `pipeline-defaults.json`, and supports optional per-service overrides.

**Architecture:** A 3-layer merge strategy (inferred → tier defaults → per-service overrides) implemented in `resolve-pipeline-config.ts`. Services are discovered by scanning `services/*/*/src/main.ts`. The active tier (`sandbox`/`staging`/`production`) is passed via CDK context `-c tier=`. `deploy.sh` gets a new signature: `deploy.sh <tier> [--prefix=<custom>] [--services=svc1,svc2]`.

**Tech Stack:** TypeScript, AWS CDK, Jest, Bash, GitHub Actions YAML

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `infrastructure/pipeline-defaults.json` | Tier-level default properties (sandbox/staging/production) |
| `infrastructure/pipeline-defaults-schema.json` | JSON Schema validating pipeline-defaults.json |
| `libs/cdk-constructs/src/resolve-pipeline-config.ts` | Resolution engine: infer + merge + return `ResolvedPipelineConfig` |
| `libs/cdk-constructs/test/resolve-pipeline-config.test.ts` | Unit tests for inference, merge, tier detection, edge cases |
| `infrastructure/scripts/resolve-all-configs.ts` | CLI helper: resolves all services at once, outputs JSON for deploy.sh |
| `infrastructure/scripts/__snapshots__/resolve-all-configs.snap.json` | Golden snapshot: all 16 services × 3 tiers |

### Modified Files
| File | Change |
|------|--------|
| `.pipeline-schema.json` | Replace current required-fields schema with permissive override schema |
| `libs/cdk-constructs/src/index.ts` | Export `resolvePipelineConfig` and `ResolvedPipelineConfig` |
| `infrastructure/scripts/deploy.sh` | New signature, tier-based flow, CDK context passing |
| `.github/scripts/validate-pipeline-configs.sh` | Validate pipeline-defaults.json + optional per-service overrides |
| `.github/workflows/deploy.yml` | Pass tier to deploy.sh, add prod_targets matrix output |
| `.github/workflows/pr-deploy.yml` | Pass tier + prefix to deploy.sh |
| 16× `services/*/*/src/main.ts` | Use `resolvePipelineConfig()` instead of `getPrefix()` |

### Deleted Files
| File | Reason |
|------|--------|
| 15× `services/*/*/pipeline.json` (all except investor-web) | Fully inferrable — no override needed |
| `services/investor/investor-web/pipeline.json` | Replaced with minimal override (`{ "parallelDeploy": false }`) |

---

## Chunk 1: Resolution Engine + Unit Tests

### Task 1: Create `infrastructure/pipeline-defaults.json` + schema

**Files:**
- Create: `infrastructure/pipeline-defaults.json`
- Create: `infrastructure/pipeline-defaults-schema.json`

- [ ] **Step 1: Create the pipeline-defaults-schema.json**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Nestfolio Pipeline Defaults",
  "type": "object",
  "properties": {
    "$schema": { "type": "string" },
    "sandbox": { "$ref": "#/$defs/tierDefaults" },
    "staging": { "$ref": "#/$defs/tierDefaults" },
    "production": {
      "oneOf": [
        { "$ref": "#/$defs/tierDefaults" },
        { "type": "array", "items": { "$ref": "#/$defs/targetDefaults" }, "minItems": 1 }
      ]
    }
  },
  "additionalProperties": false,
  "$defs": {
    "tierDefaults": {
      "type": "object",
      "properties": {
        "account": { "type": "string", "pattern": "^[0-9]{12}$" },
        "region": { "type": "string" },
        "environment": { "type": "string", "description": "GitHub Actions environment name for OIDC auth" },
        "observability": { "type": "boolean" },
        "parallelDeploy": { "type": "boolean" },
        "logRetention": { "type": "integer", "minimum": 1 },
        "protectedResources": { "type": "boolean" },
        "alarmActions": { "type": "array", "items": { "type": "string" } }
      },
      "additionalProperties": false
    },
    "targetDefaults": {
      "type": "object",
      "required": ["account", "region", "environment"],
      "properties": {
        "account": { "type": "string", "pattern": "^[0-9]{12}$" },
        "region": { "type": "string" },
        "environment": { "type": "string", "description": "GitHub Actions environment name for OIDC auth" },
        "observability": { "type": "boolean" },
        "parallelDeploy": { "type": "boolean" },
        "logRetention": { "type": "integer", "minimum": 1 },
        "protectedResources": { "type": "boolean" },
        "alarmActions": { "type": "array", "items": { "type": "string" } }
      },
      "additionalProperties": false
    }
  }
}
```

Write to `infrastructure/pipeline-defaults-schema.json`.

- [ ] **Step 2: Create pipeline-defaults.json**

```json
{
  "$schema": "./pipeline-defaults-schema.json",
  "sandbox": {
    "observability": false,
    "logRetention": 7,
    "protectedResources": false,
    "parallelDeploy": true,
    "alarmActions": []
  },
  "staging": {
    "observability": true,
    "logRetention": 30,
    "protectedResources": false,
    "parallelDeploy": true,
    "alarmActions": []
  },
  "production": {
    "observability": true,
    "logRetention": 90,
    "protectedResources": true,
    "parallelDeploy": true,
    "alarmActions": []
  }
}
```

Write to `infrastructure/pipeline-defaults.json`.

- [ ] **Step 3: Commit**

```bash
git add infrastructure/pipeline-defaults.json infrastructure/pipeline-defaults-schema.json
git commit -m "feat(pipeline): add pipeline-defaults.json and schema for tier-level defaults"
```

---

### Task 2: Write failing tests for `resolve-pipeline-config.ts`

**Files:**
- Create: `libs/cdk-constructs/test/resolve-pipeline-config.test.ts`

The test file covers all inference rules, merge logic, tier detection, and edge cases.

**Design note:** `inferServiceMetadata(serviceName, subsystem)` takes the subsystem as a parameter (not discovered from filesystem). Filesystem scanning to discover which subsystem a service belongs to happens in `discoverSubsystem()` (called by `resolvePipelineConfig`) and in `resolve-all-configs.ts`. This keeps unit tests pure — no fs mocking needed for inference tests.

- [ ] **Step 1: Write the full test file**

```typescript
import { App } from 'aws-cdk-lib';
import {
  resolvePipelineConfig,
  inferServiceMetadata,
  loadTierDefaults,
  mergeConfigs,
  HARDCODED_FALLBACKS,
  ResolvedPipelineConfig,
} from '../src/resolve-pipeline-config';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('fs');

const mockedFs = fs as jest.Mocked<typeof fs>;

// Helper: create a CDK App with context
const createApp = (context: Record<string, string> = {}) =>
  new App({ context });

// Helper: mock fs.existsSync and fs.readFileSync
const mockFileSystem = (files: Record<string, unknown>) => {
  mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
    const filePath = typeof p === 'string' ? p : p.toString();
    return Object.keys(files).some((f) => filePath.endsWith(f));
  });
  mockedFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
    const filePath = typeof p === 'string' ? p : p.toString();
    for (const [key, value] of Object.entries(files)) {
      if (filePath.endsWith(key)) return JSON.stringify(value);
    }
    throw new Error(`ENOENT: ${filePath}`);
  });
};

// Helper: mock discoverSubsystem for integration tests
const mockDiscoverSubsystem = (map: Record<string, string>) => {
  // Mock readdirSync + statSync for directory scanning
  mockedFs.readdirSync.mockImplementation((p: fs.PathLike) => {
    const filePath = typeof p === 'string' ? p : p.toString();
    if (filePath.endsWith('services')) {
      return [...new Set(Object.values(map))] as any;
    }
    // Return service names for a given subsystem dir
    const subsystem = filePath.split('/').pop();
    return Object.entries(map)
      .filter(([, sub]) => sub === subsystem)
      .map(([svc]) => svc) as any;
  });
  mockedFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
};

describe('inferServiceMetadata', () => {
  // inferServiceMetadata takes (serviceName, subsystem) — no fs needed

  it('infers hub service → phase 1, no dependencies', () => {
    const result = inferServiceMetadata('investor-hub', 'investor');
    expect(result).toEqual({
      service: 'investor-hub',
      subsystem: 'investor',
      deploymentPhase: 1,
      dependencies: [],
    });
  });

  it('infers -web service → phase 2, depends on hub', () => {
    const result = inferServiceMetadata('investor-web', 'investor');
    expect(result).toEqual({
      service: 'investor-web',
      subsystem: 'investor',
      deploymentPhase: 2,
      dependencies: ['investor-hub'],
    });
  });

  it('infers -bff service → phase 3, depends on hub + investor-web', () => {
    const result = inferServiceMetadata('advisory-bff', 'advisory');
    expect(result).toEqual({
      service: 'advisory-bff',
      subsystem: 'advisory',
      deploymentPhase: 3,
      dependencies: ['advisory-hub', 'investor-web'],
    });
  });

  it('infers -ctrl service → phase 3, depends on hub', () => {
    const result = inferServiceMetadata('execution-ctrl', 'execution');
    expect(result).toEqual({
      service: 'execution-ctrl',
      subsystem: 'execution',
      deploymentPhase: 3,
      dependencies: ['execution-hub'],
    });
  });

  it('infers -adpt service → phase 3, depends on hub', () => {
    const result = inferServiceMetadata('execution-adpt', 'execution');
    expect(result).toEqual({
      service: 'execution-adpt',
      subsystem: 'execution',
      deploymentPhase: 3,
      dependencies: ['execution-hub'],
    });
  });

  it('infers dashboard-bff subsystem as investor (passed by caller)', () => {
    const result = inferServiceMetadata('dashboard-bff', 'investor');
    expect(result).toEqual({
      service: 'dashboard-bff',
      subsystem: 'investor',
      deploymentPhase: 3,
      dependencies: ['investor-hub', 'investor-web'],
    });
  });

  it('infers reconciliation-ctrl subsystem as ledger (passed by caller)', () => {
    const result = inferServiceMetadata('reconciliation-ctrl', 'ledger');
    expect(result).toEqual({
      service: 'reconciliation-ctrl',
      subsystem: 'ledger',
      deploymentPhase: 3,
      dependencies: ['ledger-hub'],
    });
  });

  it('infers compliance-ctrl subsystem as advisory (passed by caller)', () => {
    const result = inferServiceMetadata('compliance-ctrl', 'advisory');
    expect(result).toEqual({
      service: 'compliance-ctrl',
      subsystem: 'advisory',
      deploymentPhase: 3,
      dependencies: ['advisory-hub'],
    });
  });
});

describe('loadTierDefaults', () => {
  afterEach(() => jest.restoreAllMocks());

  it('loads sandbox tier from pipeline-defaults.json', () => {
    mockFileSystem({
      'pipeline-defaults.json': {
        sandbox: { observability: false, logRetention: 7 },
        staging: { observability: true },
        production: { observability: true },
      },
    });
    const result = loadTierDefaults('sandbox');
    expect(result).toEqual({ observability: false, logRetention: 7 });
  });

  it('loads production tier (object form)', () => {
    mockFileSystem({
      'pipeline-defaults.json': {
        production: { observability: true, logRetention: 90, protectedResources: true },
      },
    });
    const result = loadTierDefaults('production');
    expect(result).toEqual({ observability: true, logRetention: 90, protectedResources: true });
  });

  it('returns empty object when pipeline-defaults.json is missing', () => {
    mockedFs.existsSync.mockReturnValue(false);
    const result = loadTierDefaults('sandbox');
    expect(result).toEqual({});
  });

  it('returns empty object when tier key is absent', () => {
    mockFileSystem({
      'pipeline-defaults.json': { sandbox: { observability: false } },
    });
    const result = loadTierDefaults('staging');
    expect(result).toEqual({});
  });

  it('returns empty object when production is array form (multi-target)', () => {
    mockFileSystem({
      'pipeline-defaults.json': {
        production: [
          { account: '111111111111', region: 'us-east-1', environment: 'prod-us' },
          { account: '222222222222', region: 'eu-west-1', environment: 'prod-eu' },
        ],
      },
    });
    const result = loadTierDefaults('production');
    expect(result).toEqual({});
  });
});

describe('mergeConfigs', () => {
  it('applies hardcoded fallbacks when no tier defaults or overrides', () => {
    const inferred = {
      service: 'investor-hub',
      subsystem: 'investor',
      deploymentPhase: 1 as const,
      dependencies: [],
    };
    const result = mergeConfigs(inferred, {}, {}, 'staging');
    expect(result).toEqual({
      ...inferred,
      ...HARDCODED_FALLBACKS,
      prefix: 'staging',
    });
  });

  it('tier defaults override hardcoded fallbacks', () => {
    const inferred = {
      service: 'investor-hub',
      subsystem: 'investor',
      deploymentPhase: 1 as const,
      dependencies: [],
    };
    const result = mergeConfigs(inferred, { logRetention: 30 }, {}, 'staging');
    expect(result.logRetention).toBe(30);
  });

  it('per-service overrides override tier defaults', () => {
    const inferred = {
      service: 'investor-web',
      subsystem: 'investor',
      deploymentPhase: 2 as const,
      dependencies: ['investor-hub'],
    };
    const result = mergeConfigs(
      inferred,
      { parallelDeploy: true },
      { parallelDeploy: false },
      'staging',
    );
    expect(result.parallelDeploy).toBe(false);
  });

  it('per-service dependencies replace inferred (not concat)', () => {
    const inferred = {
      service: 'advisory-bff',
      subsystem: 'advisory',
      deploymentPhase: 3 as const,
      dependencies: ['advisory-hub', 'investor-web'],
    };
    const result = mergeConfigs(
      inferred,
      {},
      { dependencies: ['advisory-hub', 'investor-hub'] },
      'staging',
    );
    expect(result.dependencies).toEqual(['advisory-hub', 'investor-hub']);
  });

  it('per-service deploymentPhase override replaces inferred', () => {
    const inferred = {
      service: 'investor-bff',
      subsystem: 'investor',
      deploymentPhase: 3 as const,
      dependencies: ['investor-hub', 'investor-web'],
    };
    const result = mergeConfigs(inferred, {}, { deploymentPhase: 2 }, 'staging');
    expect(result.deploymentPhase).toBe(2);
  });

  it('account and region pass through from tier defaults', () => {
    const inferred = {
      service: 'investor-hub',
      subsystem: 'investor',
      deploymentPhase: 1 as const,
      dependencies: [],
    };
    const result = mergeConfigs(
      inferred,
      { account: '111111111111', region: 'eu-west-1' },
      {},
      'prod',
    );
    expect(result.account).toBe('111111111111');
    expect(result.region).toBe('eu-west-1');
  });
});

describe('HARDCODED_FALLBACKS', () => {
  it('has expected default values', () => {
    expect(HARDCODED_FALLBACKS).toEqual({
      observability: false,
      logRetention: 14,
      protectedResources: false,
      parallelDeploy: true,
      alarmActions: [],
    });
  });
});

describe('resolvePipelineConfig (integration)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('resolves a hub service with sandbox tier', () => {
    mockDiscoverSubsystem({ 'investor-hub': 'investor' });
    mockFileSystem({
      'pipeline-defaults.json': {
        sandbox: { observability: false, logRetention: 7, protectedResources: false, parallelDeploy: true, alarmActions: [] },
      },
    });
    // Override existsSync to also handle discoverSubsystem's main.ts check
    const origExistsSync = mockedFs.existsSync.getMockImplementation()!;
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('main.ts')) return true;
      if (filePath.includes('pipeline-defaults.json')) return true;
      return false; // No per-service pipeline.json
    });

    const app = createApp({ tier: 'sandbox', prefix: 'sandbox-pr-42' });
    const config = resolvePipelineConfig(app, 'investor-hub');

    expect(config).toEqual({
      service: 'investor-hub',
      subsystem: 'investor',
      deploymentPhase: 1,
      dependencies: [],
      observability: false,
      logRetention: 7,
      protectedResources: false,
      parallelDeploy: true,
      alarmActions: [],
      prefix: 'sandbox-pr-42',
    });
  });

  it('resolves investor-web with per-service override', () => {
    mockDiscoverSubsystem({ 'investor-web': 'investor' });
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('pipeline-defaults.json')) {
        return JSON.stringify({
          staging: { observability: true, logRetention: 30, protectedResources: false, parallelDeploy: true, alarmActions: [] },
        });
      }
      if (filePath.includes('pipeline.json')) {
        return JSON.stringify({ parallelDeploy: false });
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const app = createApp({ tier: 'staging', prefix: 'staging' });
    const config = resolvePipelineConfig(app, 'investor-web');

    expect(config.parallelDeploy).toBe(false);
    expect(config.observability).toBe(true);
    expect(config.deploymentPhase).toBe(2);
  });

  it('falls back to sandbox tier when no tier context and prefix is unknown', () => {
    mockDiscoverSubsystem({ 'investor-hub': 'investor' });
    mockFileSystem({
      'pipeline-defaults.json': {
        sandbox: { logRetention: 7 },
      },
    });
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('main.ts')) return true;
      if (filePath.includes('pipeline-defaults.json')) return true;
      return false;
    });

    const app = createApp({ prefix: 'my-custom' });
    // No tier in context → infer from prefix → "my-custom" doesn't match any pattern → sandbox
    const config = resolvePipelineConfig(app, 'investor-hub');
    expect(config.logRetention).toBe(7);
  });

  it('infers staging tier from prefix when tier context is absent', () => {
    mockDiscoverSubsystem({ 'investor-hub': 'investor' });
    mockFileSystem({
      'pipeline-defaults.json': {
        staging: { logRetention: 30 },
      },
    });
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('main.ts')) return true;
      if (filePath.includes('pipeline-defaults.json')) return true;
      return false;
    });

    const app = createApp({ prefix: 'staging' });
    const config = resolvePipelineConfig(app, 'investor-hub');
    expect(config.logRetention).toBe(30);
  });

  it('infers production tier from "prod" prefix', () => {
    mockDiscoverSubsystem({ 'investor-hub': 'investor' });
    mockFileSystem({
      'pipeline-defaults.json': {
        production: { logRetention: 90 },
      },
    });
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('main.ts')) return true;
      if (filePath.includes('pipeline-defaults.json')) return true;
      return false;
    });

    const app = createApp({ prefix: 'prod' });
    const config = resolvePipelineConfig(app, 'investor-hub');
    expect(config.logRetention).toBe(90);
  });

  it('applies per-service tier-scoped overrides for matching tier', () => {
    // pipeline-defaults.json has observability: true for staging
    // per-service pipeline.json has staging: { observability: false }
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('pipeline-defaults.json')) {
        return JSON.stringify({
          staging: { observability: true, logRetention: 30, parallelDeploy: true, protectedResources: false, alarmActions: [] },
        });
      }
      if (filePath.includes('pipeline.json')) {
        return JSON.stringify({ staging: { observability: false } });
      }
      throw new Error(`ENOENT: ${filePath}`);
    });
    mockDiscoverSubsystem({ 'investor-hub': 'investor' });

    const app = createApp({ tier: 'staging', prefix: 'staging' });
    const config = resolvePipelineConfig(app, 'investor-hub');
    expect(config.observability).toBe(false);
  });

  it('ignores per-service tier-scoped overrides for non-matching tier', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('pipeline-defaults.json')) {
        return JSON.stringify({
          production: { observability: true, logRetention: 90, parallelDeploy: true, protectedResources: true, alarmActions: [] },
        });
      }
      if (filePath.includes('pipeline.json')) {
        return JSON.stringify({ staging: { observability: false } });
      }
      throw new Error(`ENOENT: ${filePath}`);
    });
    mockDiscoverSubsystem({ 'investor-hub': 'investor' });

    const app = createApp({ tier: 'production', prefix: 'prod' });
    const config = resolvePipelineConfig(app, 'investor-hub');
    expect(config.observability).toBe(true);
  });

  it('throws when prefix is not in context', () => {
    const app = createApp({});
    expect(() => resolvePipelineConfig(app, 'investor-hub')).toThrow(
      'CDK context "prefix" is required',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=resolve-pipeline-config`
Expected: FAIL — module `../src/resolve-pipeline-config` does not exist.

- [ ] **Step 3: Commit**

```bash
git add libs/cdk-constructs/test/resolve-pipeline-config.test.ts
git commit -m "test(cdk-constructs): add failing tests for resolve-pipeline-config"
```

---

### Task 3: Implement `resolve-pipeline-config.ts`

**Files:**
- Create: `libs/cdk-constructs/src/resolve-pipeline-config.ts`
- Modify: `libs/cdk-constructs/src/index.ts`

- [ ] **Step 1: Write the resolution engine**

```typescript
import { Construct } from 'constructs';
import * as fs from 'fs';
import * as path from 'path';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ResolvedPipelineConfig {
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
    'observability' | 'parallelDeploy' | 'logRetention' | 'protectedResources' | 'alarmActions' | 'account' | 'region' | 'environment'
  >
>;

// ── Constants ──────────────────────────────────────────────────────────────

export const HARDCODED_FALLBACKS: Pick<
  ResolvedPipelineConfig,
  'observability' | 'logRetention' | 'protectedResources' | 'parallelDeploy' | 'alarmActions'
> = {
  observability: false,
  logRetention: 14,
  protectedResources: false,
  parallelDeploy: true,
  alarmActions: [],
};

/**
 * Discovers the subsystem for a service by scanning services/*/*/src/main.ts.
 * Used by resolvePipelineConfig() — unit tests for inferServiceMetadata bypass this.
 */
export function discoverSubsystem(serviceName: string): string {
  const servicesDir = path.resolve(__dirname, '..', '..', '..', 'services');
  if (!fs.existsSync(servicesDir)) {
    throw new Error(`Services directory not found: ${servicesDir}`);
  }

  for (const subsystem of fs.readdirSync(servicesDir)) {
    const subsystemDir = path.join(servicesDir, subsystem);
    if (!fs.statSync(subsystemDir).isDirectory()) continue;
    const mainTs = path.join(subsystemDir, serviceName, 'src', 'main.ts');
    if (fs.existsSync(mainTs)) return subsystem;
  }

  throw new Error(
    `Cannot discover subsystem for "${serviceName}". ` +
    `Expected a directory at services/{subsystem}/${serviceName}/src/main.ts`,
  );
}

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
    __dirname, '..', '..', '..', 'infrastructure', 'pipeline-defaults.json',
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
    __dirname, '..', '..', '..', 'services', subsystem, serviceName, 'pipeline.json',
  );
  if (!fs.existsSync(overridePath)) return {};

  const raw = JSON.parse(fs.readFileSync(overridePath, 'utf-8'));

  // Extract tier-scoped overrides and merge with top-level overrides
  const { sandbox, staging, production, $schema, ...topLevel } = raw;
  const tierScoped = tier === 'sandbox' ? sandbox
    : tier === 'staging' ? staging
    : production;

  // If tier-scoped is an array (multi-target production), ignore here
  if (Array.isArray(tierScoped)) return topLevel;

  return { ...topLevel, ...(tierScoped ?? {}) };
}

// ── Tier Detection ─────────────────────────────────────────────────────────

function detectTier(prefix: string): Tier {
  if (prefix.startsWith('sandbox')) return 'sandbox';
  if (prefix === 'staging') return 'staging';
  if (prefix === 'prod' || prefix === 'production') return 'production';
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
  };

  // Layer 2: tier defaults override fallbacks (scalars only)
  for (const [key, value] of Object.entries(tierDefaults)) {
    if (value !== undefined) {
      (base as any)[key] = value;
    }
  }

  // Layer 3: per-service overrides (scalars last-wins, arrays replace)
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && key !== '$schema' && key !== 'sandbox' && key !== 'staging' && key !== 'production') {
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
 * @param serviceName The Nx project name (e.g. 'advisory-ctrl')
 */
export function resolvePipelineConfig(
  scope: Construct,
  serviceName: string,
): ResolvedPipelineConfig {
  const prefix = scope.node.tryGetContext('prefix');
  if (!prefix) {
    throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
  }

  const tierContext = scope.node.tryGetContext('tier') as Tier | undefined;
  const tier: Tier = tierContext ?? detectTier(prefix);

  const subsystem = discoverSubsystem(serviceName);
  const inferred = inferServiceMetadata(serviceName, subsystem);
  const tierDefaults = loadTierDefaults(tier);
  const overrides = loadServiceOverrides(serviceName, subsystem, tier);

  return mergeConfigs(inferred, tierDefaults, overrides, prefix);
}
```

- [ ] **Step 2: Export from index.ts**

Add to `libs/cdk-constructs/src/index.ts`:

```typescript
export { resolvePipelineConfig, ResolvedPipelineConfig, inferServiceMetadata, discoverSubsystem, HARDCODED_FALLBACKS } from './resolve-pipeline-config';
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=resolve-pipeline-config`
Expected: ALL PASS

Note: `inferServiceMetadata` tests don't need fs mocking since subsystem is passed as a parameter. Integration tests (`resolvePipelineConfig`) mock both the file reads AND directory scanning via `mockDiscoverSubsystem`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=resolve-pipeline-config`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/resolve-pipeline-config.ts libs/cdk-constructs/src/index.ts
git commit -m "feat(cdk-constructs): implement resolve-pipeline-config resolution engine"
```

---

### Task 4: Update `.pipeline-schema.json` to permissive override schema

**Files:**
- Modify: `.pipeline-schema.json`

- [ ] **Step 1: Replace the schema**

Replace the entire content of `.pipeline-schema.json` with the new permissive schema from the spec (all fields optional, supports tier-scoped overrides, production as object or array):

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Nestfolio Per-Service Pipeline Override",
  "type": "object",
  "properties": {
    "$schema": { "type": "string" },
    "deploymentPhase": {
      "type": "integer", "minimum": 1, "maximum": 3
    },
    "parallelDeploy": { "type": "boolean" },
    "dependencies": {
      "type": "array", "items": { "type": "string" }
    },
    "observability": { "type": "boolean" },
    "logRetention": { "type": "integer", "minimum": 1 },
    "protectedResources": { "type": "boolean" },
    "alarmActions": {
      "type": "array", "items": { "type": "string" }
    },
    "sandbox": { "$ref": "#/$defs/tierOverride" },
    "staging": { "$ref": "#/$defs/tierOverride" },
    "production": {
      "oneOf": [
        { "$ref": "#/$defs/tierOverride" },
        { "type": "array", "items": { "$ref": "#/$defs/targetOverride" } }
      ]
    }
  },
  "additionalProperties": false,
  "$defs": {
    "tierOverride": {
      "type": "object",
      "properties": {
        "account": { "type": "string", "pattern": "^[0-9]{12}$" },
        "region": { "type": "string" },
        "environment": { "type": "string" },
        "observability": { "type": "boolean" },
        "parallelDeploy": { "type": "boolean" },
        "logRetention": { "type": "integer", "minimum": 1 },
        "protectedResources": { "type": "boolean" },
        "alarmActions": { "type": "array", "items": { "type": "string" } }
      },
      "additionalProperties": false
    },
    "targetOverride": {
      "type": "object",
      "properties": {
        "account": { "type": "string", "pattern": "^[0-9]{12}$" },
        "region": { "type": "string" },
        "environment": { "type": "string" },
        "observability": { "type": "boolean" },
        "parallelDeploy": { "type": "boolean" },
        "logRetention": { "type": "integer", "minimum": 1 },
        "protectedResources": { "type": "boolean" },
        "alarmActions": { "type": "array", "items": { "type": "string" } }
      },
      "additionalProperties": false
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add .pipeline-schema.json
git commit -m "feat(pipeline): update .pipeline-schema.json to permissive override schema"
```

---

## Chunk 2: resolve-all-configs + deploy.sh Rewrite

### Task 5: Create `infrastructure/scripts/resolve-all-configs.ts`

**Files:**
- Create: `infrastructure/scripts/resolve-all-configs.ts`

This script is called by `deploy.sh`. It resolves all services and outputs a JSON array to stdout. It uses `ts-node` to run (same as CDK synth).

- [ ] **Step 1: Write resolve-all-configs.ts**

```typescript
#!/usr/bin/env ts-node
/**
 * resolve-all-configs.ts — Resolves pipeline config for all discovered services.
 *
 * Usage: ts-node resolve-all-configs.ts <tier> [--prefix=<prefix>]
 * Output: JSON array of ResolvedPipelineConfig objects to stdout.
 *
 * When production tier has array-form targets in pipeline-defaults.json,
 * each service appears once per target with account/region/environment populated.
 */
import * as fs from 'fs';
import * as path from 'path';

// ── Types (duplicated from resolve-pipeline-config to avoid CDK dependency) ──

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

// ── CLI argument parsing ───────────────────────────────────────────────────

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

// ── Discover services ──────────────────────────────────────────────────────

const rootDir = path.resolve(__dirname, '..', '..');
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

// ── Inference (same logic as resolve-pipeline-config.ts) ───────────────────

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

// ── Load pipeline-defaults.json ────────────────────────────────────────────

function loadDefaults(): Record<string, unknown> {
  const defaultsPath = path.join(rootDir, 'infrastructure', 'pipeline-defaults.json');
  if (!fs.existsSync(defaultsPath)) return {};
  return JSON.parse(fs.readFileSync(defaultsPath, 'utf-8'));
}

// ── Load per-service pipeline.json ─────────────────────────────────────────

function loadServiceOverride(serviceName: string, subsystem: string): Record<string, unknown> {
  const overridePath = path.join(servicesDir, subsystem, serviceName, 'pipeline.json');
  if (!fs.existsSync(overridePath)) return {};
  return JSON.parse(fs.readFileSync(overridePath, 'utf-8'));
}

// ── Resolve ────────────────────────────────────────────────────────────────

function resolveAll(): ResolvedConfig[] {
  const services = discoverServices();
  const defaults = loadDefaults();
  const tierData = defaults[tier];
  const results: ResolvedConfig[] = [];

  for (const { service, subsystem } of services) {
    const inferred = inferMetadata(service, subsystem);
    const override = loadServiceOverride(service, subsystem);
    const { $schema, sandbox, staging, production, ...topOverrides } = override as any;

    // Extract tier-scoped override
    const tierScopedOverride = tier === 'sandbox' ? sandbox
      : tier === 'staging' ? staging
      : production;

    // Determine targets (for multi-target production)
    let targets: Array<Record<string, unknown>>;

    if (tier === 'production') {
      // Check per-service production override first (array = replaces global targets)
      if (Array.isArray(tierScopedOverride)) {
        targets = tierScopedOverride;
      } else if (Array.isArray(tierData)) {
        // Global multi-target production
        targets = (tierData as Array<Record<string, unknown>>).map((t) => ({
          ...t,
          ...(typeof tierScopedOverride === 'object' ? tierScopedOverride : {}),
        }));
      } else {
        // Single-target production (object form)
        targets = [{ ...(typeof tierData === 'object' ? tierData : {}) }];
      }
    } else {
      // Non-production: single target from tier defaults
      targets = [typeof tierData === 'object' ? tierData as Record<string, unknown> : {}];
    }

    for (const target of targets) {
      const merged: ResolvedConfig = {
        ...inferred,
        ...HARDCODED_FALLBACKS,
        prefix,
      };

      // Apply tier-level defaults
      for (const [key, value] of Object.entries(target)) {
        if (value !== undefined && key !== '$schema') {
          (merged as any)[key] = value;
        }
      }

      // Apply top-level per-service overrides
      for (const [key, value] of Object.entries(topOverrides)) {
        if (value !== undefined) {
          (merged as any)[key] = value;
        }
      }

      // Apply tier-scoped per-service overrides (object form only, not array)
      if (tierScopedOverride && !Array.isArray(tierScopedOverride)) {
        for (const [key, value] of Object.entries(tierScopedOverride)) {
          if (value !== undefined) {
            (merged as any)[key] = value;
          }
        }
      }

      // Only include account/region/environment if they were explicitly set
      if (!merged.account) delete merged.account;
      if (!merged.region) delete merged.region;
      if (!merged.environment) delete merged.environment;

      results.push(merged);
    }
  }

  // Sort by phase then service name for deterministic output
  results.sort((a, b) =>
    a.deploymentPhase !== b.deploymentPhase
      ? a.deploymentPhase - b.deploymentPhase
      : a.service.localeCompare(b.service),
  );

  return results;
}

// ── Main ───────────────────────────────────────────────────────────────────

const configs = resolveAll();
console.log(JSON.stringify(configs, null, 2));
```

- [ ] **Step 2: Verify it runs**

Run: `npx ts-node -r ./tools/register-paths.js infrastructure/scripts/resolve-all-configs.ts sandbox --prefix=sandbox-pr-42`
Expected: JSON array of 16 resolved configs printed to stdout.

Note: This will initially fail if the current `pipeline.json` files are still present — the override loader will read them and apply their fields. That's fine; the output should still be valid. We verify correctness after deleting the old files.

- [ ] **Step 3: Commit**

```bash
git add infrastructure/scripts/resolve-all-configs.ts
git commit -m "feat(pipeline): add resolve-all-configs.ts CLI for deploy.sh consumption"
```

---

### Task 6: Rewrite `deploy.sh`

**Files:**
- Modify: `infrastructure/scripts/deploy.sh`

- [ ] **Step 1: Rewrite deploy.sh with new signature**

Replace the entire content of `infrastructure/scripts/deploy.sh`:

```bash
#!/usr/bin/env bash
# deploy.sh — Phase-ordered deployment driven by resolve-all-configs.ts
set -euo pipefail

TIER=${1:?Usage: deploy.sh <tier> [--prefix=<custom>] [--services=svc1,svc2,...] [--dry-run]}

# Validate tier
case "$TIER" in
  sandbox|staging|prod|production) ;;
  *) echo "ERROR: Invalid tier '$TIER'. Must be sandbox, staging, prod, or production." >&2; exit 1 ;;
esac

# Normalize tier for resolver
RESOLVER_TIER="$TIER"
if [ "$TIER" = "prod" ]; then RESOLVER_TIER="production"; fi

# Parse optional flags
PREFIX=""
SERVICES_FILTER=""
SERVICES_FLAG_PROVIDED="false"
DRY_RUN="false"
shift
for arg in "$@"; do
  case "$arg" in
    --prefix=*) PREFIX="${arg#--prefix=}" ;;
    --services=*) SERVICES_FILTER="${arg#--services=}"; SERVICES_FLAG_PROVIDED="true" ;;
    --dry-run) DRY_RUN="true" ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# Default prefix from tier
if [ -z "$PREFIX" ]; then
  case "$TIER" in
    sandbox) PREFIX="sandbox" ;;
    staging) PREFIX="staging" ;;
    prod|production) PREFIX="prod" ;;
  esac
fi

# If --services was passed with an empty value, skip deployment
if [ "$SERVICES_FLAG_PROVIDED" = "true" ] && [ -z "$SERVICES_FILTER" ]; then
  echo "No affected services — skipping deployment."
  exit 0
fi

# Determine approval mode: skip approval in CI, require locally
APPROVAL_FLAG=""
if [ -n "${CI:-}" ]; then
  APPROVAL_FLAG="--require-approval never"
fi

trap 'echo "ERROR: Deployment failed. Tier: $TIER, Prefix: $PREFIX — manual cleanup may be required." >&2' ERR

# ── Resolve all configs ─────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

RESOLVER_ARGS="$RESOLVER_TIER --prefix=$PREFIX"
CONFIGS=$(npx ts-node -r "$REPO_ROOT/tools/register-paths.js" "$SCRIPT_DIR/resolve-all-configs.ts" $RESOLVER_ARGS)

# ── Helper functions ────────────────────────────────────────────────────────

is_service_included() {
  local svc="$1"
  if [ "$SERVICES_FLAG_PROVIDED" = "false" ]; then return 0; fi
  echo ",$SERVICES_FILTER," | grep -q ",$svc,"
}

deploy_service() {
  local svc="$1"
  local region="${2:-}"
  local account="${3:-}"
  local config_json="$4"

  # Extract config values
  local observability=$(echo "$config_json" | jq -r '.observability')
  local log_retention=$(echo "$config_json" | jq -r '.logRetention')
  local protected_resources=$(echo "$config_json" | jq -r '.protectedResources')

  local region_flag="${region:-${CDK_DEFAULT_REGION:-us-east-1}}"

  echo "  Deploying $svc (${region_flag})..."

  if [ "$DRY_RUN" = "true" ]; then
    echo "    [DRY RUN] Would deploy with: tier=$TIER prefix=$PREFIX observability=$observability logRetention=$log_retention protectedResources=$protected_resources"
    return 0
  fi

  local env_vars=""
  if [ -n "$region" ]; then env_vars="CDK_DEFAULT_REGION=$region"; fi
  if [ -n "$account" ]; then env_vars="$env_vars CDK_DEFAULT_ACCOUNT=$account"; fi

  env $env_vars pnpm nx run "$svc:deploy" -- \
    $APPROVAL_FLAG \
    -c prefix="$PREFIX" \
    -c tier="$RESOLVER_TIER" \
    -c observability="$observability" \
    -c logRetention="$log_retention" \
    -c protectedResources="$protected_resources" \
    -c region="$region_flag"
}

verify_ssm_param() {
  local param_name="$1"
  local region="${2:-${CDK_DEFAULT_REGION:-us-east-1}}"
  if [ "$DRY_RUN" = "true" ]; then
    echo "    [DRY RUN] Would verify SSM: $param_name ($region)"
    return 0
  fi
  if ! aws ssm get-parameter --name "$param_name" --region "$region" --query 'Parameter.Value' --output text > /dev/null 2>&1; then
    echo "ERROR: SSM parameter $param_name not found in $region after deployment." >&2
    exit 1
  fi
}

check_all_hub_params_exist() {
  if [ "$DRY_RUN" = "true" ]; then return 1; fi
  local hub_configs="$1"
  for cfg in $(echo "$hub_configs" | jq -c '.[]'); do
    local subsystem=$(echo "$cfg" | jq -r '.subsystem')
    local region=$(echo "$cfg" | jq -r '.region // empty')
    region="${region:-${CDK_DEFAULT_REGION:-us-east-1}}"
    local param="/nestfolio/${PREFIX}-${subsystem}/event-hub/busArn"
    if ! aws ssm get-parameter --name "$param" --region "$region" --query 'Parameter.Value' --output text > /dev/null 2>&1; then
      return 1
    fi
  done
  return 0
}

# ── Deployment ──────────────────────────────────────────────────────────────

echo "Tier: $TIER"
echo "Prefix: $PREFIX"
if [ "$SERVICES_FLAG_PROVIDED" = "true" ]; then
  echo "Service filter: $SERVICES_FILTER"
else
  echo "Service filter: (all)"
fi
if [ "$DRY_RUN" = "true" ]; then echo "Mode: DRY RUN"; fi

# Collect hub configs for Phase 4
HUB_CONFIGS="[]"

# Get unique targets (for multi-target production)
TARGETS=$(echo "$CONFIGS" | jq -c '[.[] | {account, region, environment}] | unique')
TARGET_COUNT=$(echo "$TARGETS" | jq 'length')

# Deploy phases per target
for TARGET_IDX in $(seq 0 $((TARGET_COUNT - 1))); do
  TARGET=$(echo "$TARGETS" | jq -c ".[$TARGET_IDX]")
  TARGET_ACCOUNT=$(echo "$TARGET" | jq -r '.account // empty')
  TARGET_REGION=$(echo "$TARGET" | jq -r '.region // empty')
  TARGET_ENV=$(echo "$TARGET" | jq -r '.environment // empty')

  if [ "$TARGET_COUNT" -gt 1 ]; then
    echo ""
    echo "═══ Target: ${TARGET_ENV:-default} (${TARGET_REGION:-default}) ═══"
  fi

  for PHASE in 1 2 3; do
    # Filter configs for this phase + target
    PHASE_CONFIGS=$(echo "$CONFIGS" | jq -c "[.[] | select(
      .deploymentPhase == $PHASE and
      (.account // empty) == \"$TARGET_ACCOUNT\" and
      (.region // empty) == \"$TARGET_REGION\"
    )]")

    PHASE_COUNT=$(echo "$PHASE_CONFIGS" | jq 'length')
    if [ "$PHASE_COUNT" = "0" ]; then continue; fi

    echo ""
    echo "Phase $PHASE:"

    # Collect hub configs for Phase 4
    if [ "$PHASE" = "1" ]; then
      HUB_CONFIGS=$(echo "$PHASE_CONFIGS" | jq -c "[.[] | select(.service | endswith(\"-hub\"))]")
    fi

    # Split into serial and parallel
    SERIAL_CONFIGS=$(echo "$PHASE_CONFIGS" | jq -c '[.[] | select(.parallelDeploy == false)]')
    PARALLEL_CONFIGS=$(echo "$PHASE_CONFIGS" | jq -c '[.[] | select(.parallelDeploy == true)]')

    # Deploy serial services first
    for cfg in $(echo "$SERIAL_CONFIGS" | jq -c '.[]'); do
      SVC=$(echo "$cfg" | jq -r '.service')
      if is_service_included "$SVC"; then
        deploy_service "$SVC" "$TARGET_REGION" "$TARGET_ACCOUNT" "$cfg"
      fi
    done

    # Deploy parallel services concurrently
    PIDS=""
    for cfg in $(echo "$PARALLEL_CONFIGS" | jq -c '.[]'); do
      SVC=$(echo "$cfg" | jq -r '.service')
      if is_service_included "$SVC"; then
        deploy_service "$SVC" "$TARGET_REGION" "$TARGET_ACCOUNT" "$cfg" &
        PIDS="$PIDS $!"
      fi
    done
    FAIL=0
    for PID in $PIDS; do
      wait "$PID" || FAIL=1
    done
    if [ "$FAIL" -ne 0 ]; then echo "ERROR: One or more parallel deploys failed in Phase $PHASE." >&2; exit 1; fi

    # Post-phase verification
    if [ "$PHASE" = "1" ]; then
      echo "Verifying Phase 1 SSM parameters..."
      for cfg in $(echo "$PHASE_CONFIGS" | jq -c '.[]'); do
        SVC=$(echo "$cfg" | jq -r '.service')
        if is_service_included "$SVC"; then
          SUBSYSTEM=$(echo "$cfg" | jq -r '.subsystem')
          REGION=$(echo "$cfg" | jq -r '.region // empty')
          verify_ssm_param "/nestfolio/${PREFIX}-${SUBSYSTEM}/event-hub/busArn" "${REGION:-${CDK_DEFAULT_REGION:-us-east-1}}"
        fi
      done
    fi

    if [ "$PHASE" = "2" ]; then
      echo "Verifying Phase 2 SSM parameters..."
      verify_ssm_param "/nestfolio/${PREFIX}-investor/auth/userPoolId" "${TARGET_REGION:-${CDK_DEFAULT_REGION:-us-east-1}}"
      verify_ssm_param "/nestfolio/${PREFIX}-investor/auth/userPoolClientId" "${TARGET_REGION:-${CDK_DEFAULT_REGION:-us-east-1}}"
    fi
  done

  # Phase 4: Re-deploy hubs (only on first deploy)
  HUB_COUNT=$(echo "$HUB_CONFIGS" | jq 'length')
  if [ "$HUB_COUNT" -gt 0 ]; then
    if check_all_hub_params_exist "$HUB_CONFIGS"; then
      echo ""
      echo "Phase 4 (hub re-deploy): SKIPPED — all hub SSM parameters already exist."
    else
      echo ""
      echo "Phase 4 (hub re-deploy — first deploy detected):"
      PIDS=""
      for cfg in $(echo "$HUB_CONFIGS" | jq -c '.[]'); do
        SVC=$(echo "$cfg" | jq -r '.service')
        if is_service_included "$SVC"; then
          deploy_service "$SVC" "$TARGET_REGION" "$TARGET_ACCOUNT" "$cfg" &
          PIDS="$PIDS $!"
        fi
      done
      FAIL=0
      for PID in $PIDS; do
        wait "$PID" || FAIL=1
      done
      if [ "$FAIL" -ne 0 ]; then echo "ERROR: One or more hub re-deploys failed." >&2; exit 1; fi
    fi
  fi
done

echo ""
echo "Deployment complete. Tier: $TIER, Prefix: $PREFIX"
```

- [ ] **Step 2: Verify deploy.sh syntax**

Run: `bash -n infrastructure/scripts/deploy.sh`
Expected: no output (valid syntax)

- [ ] **Step 3: Commit**

```bash
git add infrastructure/scripts/deploy.sh
git commit -m "feat(pipeline): rewrite deploy.sh with tier-based signature and resolver integration"
```

---

### Task 7: Add `--dry-run` end-to-end verification

This is the `--dry-run` flag already built into deploy.sh above. Verify it works.

- [ ] **Step 1: Run dry-run for each tier**

Run (each command separately):
```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=sandbox-pr-42 --dry-run
bash infrastructure/scripts/deploy.sh staging --dry-run
bash infrastructure/scripts/deploy.sh prod --dry-run
```

Expected: Each prints resolved configs per phase with `[DRY RUN]` prefix, no actual deploys.

- [ ] **Step 2: Commit** (no changes needed, just verification)

---

## Chunk 3: Migrate All 16 Services

### Task 8: Update all 16 `main.ts` files to use `resolvePipelineConfig()`

**Files:**
- Modify: 16× `services/*/*/src/main.ts`

Each `main.ts` currently uses `getPrefix(app)` and hardcodes `process.env['CDK_DEFAULT_ACCOUNT']` / `CDK_DEFAULT_REGION`. Replace with `resolvePipelineConfig(app, '<service-name>')`.

**Important:** Some main.ts files pass `prefix` to the stack constructor, others don't. After migration, ALL will use `config.prefix` and can pass the full config or individual props.

- [ ] **Step 1: Update hub main.ts files (4 hubs — don't pass prefix)**

Update each of these files:
- `services/investor/investor-hub/src/main.ts`
- `services/advisory/advisory-hub/src/main.ts`
- `services/execution/execution-hub/src/main.ts`
- `services/ledger/ledger-hub/src/main.ts`

Before (example — investor-hub):
```typescript
import { App } from 'aws-cdk-lib';
import { getPrefix } from '@nestfolio/cdk-constructs';
import { InvestorHubStack } from './service.stack';

const app = new App();
const prefix = getPrefix(app);

new InvestorHubStack(app, `${prefix}-investor-hub`, {
  env: {
    account: process.env['CDK_DEFAULT_ACCOUNT'],
    region: process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
```

After:
```typescript
import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { InvestorHubStack } from './service.stack';

const app = new App();
const config = resolvePipelineConfig(app, 'investor-hub');

new InvestorHubStack(app, `${config.prefix}-investor-hub`, {
  env: {
    account: config.account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: config.region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
```

Apply the same pattern to all 4 hubs. Each hub's `main.ts` has the same structure — only the Stack class name and service name string differ.

- [ ] **Step 2: Update investor-web main.ts (phase 2, doesn't pass prefix)**

File: `services/investor/investor-web/src/main.ts`

Same transformation as hubs. Replace `getPrefix` with `resolvePipelineConfig`.

- [ ] **Step 3: Update 11 remaining services (pass prefix)**

These services currently pass `prefix` to the stack. After migration, continue passing `config.prefix`:

Files:
- `services/investor/investor-bff/src/main.ts`
- `services/investor/investor-ctrl/src/main.ts`
- `services/investor/dashboard-bff/src/main.ts`
- `services/advisory/advisory-bff/src/main.ts`
- `services/advisory/advisory-ctrl/src/main.ts`
- `services/advisory/compliance-ctrl/src/main.ts`
- `services/execution/execution-ctrl/src/main.ts`
- `services/execution/execution-adpt/src/main.ts`
- `services/ledger/ledger-bff/src/main.ts`
- `services/ledger/ledger-ctrl/src/main.ts`
- `services/ledger/reconciliation-ctrl/src/main.ts`

Before (example — investor-bff):
```typescript
import { App } from 'aws-cdk-lib';
import { getPrefix } from '@nestfolio/cdk-constructs';
import { InvestorBffStack } from './service.stack';

const app = new App();
const prefix = getPrefix(app);

new InvestorBffStack(app, `${prefix}-investor-bff`, {
  prefix,
  env: {
    account: process.env['CDK_DEFAULT_ACCOUNT'],
    region: process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
```

After:
```typescript
import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { InvestorBffStack } from './service.stack';

const app = new App();
const config = resolvePipelineConfig(app, 'investor-bff');

new InvestorBffStack(app, `${config.prefix}-investor-bff`, {
  prefix: config.prefix,
  env: {
    account: config.account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: config.region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
```

Apply to all 11 services. Each follows the same pattern.

- [ ] **Step 4: Run tests to verify nothing broke**

Run: `pnpm nx run-many -t test --all --parallel=5`
Expected: ALL PASS (main.ts files aren't directly unit-tested, but dependent stacks are)

- [ ] **Step 5: Commit**

```bash
git add services/*/*/src/main.ts
git commit -m "refactor(services): migrate all 16 main.ts to resolvePipelineConfig()"
```

---

### Task 9: Delete old pipeline.json files, create investor-web override

**Files:**
- Delete: 15 `pipeline.json` files (all except investor-web)
- Modify: `services/investor/investor-web/pipeline.json` (replace with minimal override)

- [ ] **Step 1: Replace investor-web pipeline.json with minimal override**

Write to `services/investor/investor-web/pipeline.json`:
```json
{
  "$schema": "../../../.pipeline-schema.json",
  "parallelDeploy": false
}
```

- [ ] **Step 2: Delete remaining 15 pipeline.json files**

```bash
# Delete all pipeline.json except investor-web
find services -name "pipeline.json" -not -path "*/investor-web/*" -delete
```

Verify only investor-web remains:
```bash
find services -name "pipeline.json"
```
Expected: `services/investor/investor-web/pipeline.json`

- [ ] **Step 3: Run dry-run to verify resolution still works**

Run: `bash infrastructure/scripts/deploy.sh staging --dry-run`
Expected: All 16 services resolved correctly. investor-web has `parallelDeploy: false`.

- [ ] **Step 4: Commit**

```bash
git add -A services/*/*/pipeline.json
git commit -m "refactor(pipeline): delete 15 pipeline.json files, keep investor-web override only"
```

---

## Chunk 4: Validation Script + GitHub Actions + Final Verification

### Task 10: Update `validate-pipeline-configs.sh`

**Files:**
- Modify: `.github/scripts/validate-pipeline-configs.sh`

The validation script needs to:
1. Validate `infrastructure/pipeline-defaults.json` against its schema
2. Validate any remaining per-service `pipeline.json` files against `.pipeline-schema.json`
3. No longer require `service`, `subsystem`, `deploymentPhase`, `production` (all optional now)

- [ ] **Step 1: Rewrite the validation script**

```bash
#!/usr/bin/env bash
set -euo pipefail

ERRORS=0

# ── Validate pipeline-defaults.json ──────────────────────────────────────

DEFAULTS_FILE="infrastructure/pipeline-defaults.json"
DEFAULTS_SCHEMA="infrastructure/pipeline-defaults-schema.json"

if [ -f "$DEFAULTS_FILE" ]; then
  echo "Validating $DEFAULTS_FILE..."
  if ! node -e "
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync('$DEFAULTS_FILE', 'utf8'));
    const errors = [];
    const validTiers = ['sandbox', 'staging', 'production'];
    for (const key of Object.keys(data)) {
      if (key === '\$schema') continue;
      if (!validTiers.includes(key)) errors.push('Unknown tier: ' + key);
    }
    for (const tier of validTiers) {
      if (data[tier] && typeof data[tier] !== 'object') errors.push(tier + ' must be an object or array');
    }
    if (errors.length > 0) {
      errors.forEach(e => console.error('    -', e));
      process.exit(1);
    }
    console.log('  PASS: $DEFAULTS_FILE');
  " 2>&1; then
    ERRORS=$((ERRORS + 1))
    echo "  FAIL: $DEFAULTS_FILE"
  fi
else
  echo "INFO: $DEFAULTS_FILE not found — using hardcoded fallbacks only."
fi

# ── Validate per-service pipeline.json files ─────────────────────────────

OVERRIDE_SCHEMA=".pipeline-schema.json"
PIPELINE_FILES=$(find services -maxdepth 3 -name "pipeline.json" -not -path "*/.*" -type f 2>/dev/null || true)

if [ -z "$PIPELINE_FILES" ]; then
  echo "No per-service pipeline.json overrides found."
else
  echo ""
  echo "Validating per-service pipeline.json overrides..."
  for FILE in $PIPELINE_FILES; do
    echo "  Validating $FILE..."
    if ! node -e "
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync('$FILE', 'utf8'));
      const errors = [];
      const validKeys = ['\$schema', 'deploymentPhase', 'parallelDeploy', 'dependencies', 'observability', 'logRetention', 'protectedResources', 'alarmActions', 'sandbox', 'staging', 'production'];
      for (const key of Object.keys(data)) {
        if (!validKeys.includes(key)) errors.push('Unknown key: ' + key);
      }
      if (data.deploymentPhase !== undefined && (!Number.isInteger(data.deploymentPhase) || data.deploymentPhase < 1 || data.deploymentPhase > 3)) {
        errors.push('deploymentPhase must be 1-3');
      }
      if (data.parallelDeploy !== undefined && typeof data.parallelDeploy !== 'boolean') {
        errors.push('parallelDeploy must be a boolean');
      }
      if (data.dependencies !== undefined && !Array.isArray(data.dependencies)) {
        errors.push('dependencies must be an array');
      }
      if (data.logRetention !== undefined && (!Number.isInteger(data.logRetention) || data.logRetention < 1)) {
        errors.push('logRetention must be a positive integer');
      }
      if (errors.length > 0) {
        errors.forEach(e => console.error('    -', e));
        process.exit(1);
      }
      console.log('  PASS: $FILE');
    " 2>&1; then
      ERRORS=$((ERRORS + 1))
    fi
  done
fi

# ── Summary ──────────────────────────────────────────────────────────────

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "ERROR: $ERRORS file(s) failed validation."
  exit 1
fi
echo "All pipeline configuration files are valid."
```

- [ ] **Step 2: Verify validation passes**

Run: `bash .github/scripts/validate-pipeline-configs.sh`
Expected: All files pass.

- [ ] **Step 3: Commit**

```bash
git add .github/scripts/validate-pipeline-configs.sh
git commit -m "refactor(ci): update validate-pipeline-configs.sh for convention-over-configuration"
```

---

### Task 11: Update GitHub Actions workflows

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/pr-deploy.yml`

- [ ] **Step 1: Update deploy.yml**

Key changes:
- Staging deploy: `deploy.sh staging` → `deploy.sh staging` (same, but now passes tier)
- Production deploy: `deploy.sh prod` → `deploy.sh prod` (same, but now passes tier)
- The commented-out deploy commands already use `deploy.sh staging`/`deploy.sh prod` — they match the new signature.
- Add `prod_targets` output for future multi-target matrix (not wired yet — day 1 single-target)

Replace staging deploy command (line 72):
```
          # bash infrastructure/scripts/deploy.sh staging --services="${{ steps.affected.outputs.services }}"
```

Replace production deploy command (line 98):
```
          # bash infrastructure/scripts/deploy.sh prod --services="${{ needs.staging.outputs.affected }}"
```

These are already correct! The new `deploy.sh` accepts `staging`/`prod` as tier (first arg), matching what's already in the workflow. No changes needed to the commented-out commands.

**However**, add the tier-aware multi-target production matrix structure as a comment for when multi-account is enabled:

After the current production job (append as comment block):
```yaml
  # ── Multi-target production (uncomment when multi-account is enabled) ──
  # production:
  #   needs: staging
  #   if: needs.staging.outputs.skipped == 'false'
  #   strategy:
  #     matrix:
  #       target: ${{ fromJson(needs.staging.outputs.prod_targets) }}
  #   runs-on: ubuntu-latest
  #   environment: ${{ matrix.target.environment }}
  #   steps:
  #     - uses: aws-actions/configure-aws-credentials@v4
  #       with:
  #         role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
  #         aws-region: ${{ matrix.target.region }}
  #     - run: |
  #         export CDK_DEFAULT_ACCOUNT=${{ matrix.target.account }}
  #         export CDK_DEFAULT_REGION=${{ matrix.target.region }}
  #         bash infrastructure/scripts/deploy.sh prod --services="${{ needs.staging.outputs.affected }}"
```

- [ ] **Step 2: Update pr-deploy.yml**

Change sandbox deploy commands (lines 96 and 98):

Before:
```yaml
            bash infrastructure/scripts/deploy.sh "$PREFIX_SANDBOX"
          else
            bash infrastructure/scripts/deploy.sh "$PREFIX_SANDBOX" --services="$AFFECTED"
```

After:
```yaml
            bash infrastructure/scripts/deploy.sh sandbox --prefix="$PREFIX_SANDBOX"
          else
            bash infrastructure/scripts/deploy.sh sandbox --prefix="$PREFIX_SANDBOX" --services="$AFFECTED"
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml .github/workflows/pr-deploy.yml
git commit -m "ci: update GitHub Actions workflows for tier-based deploy.sh signature"
```

---

### Task 12: Golden snapshot test for resolve-all-configs

**Files:**
- Create: `infrastructure/scripts/__tests__/resolve-all-configs.test.ts` (or run as shell snapshot)

Rather than a full jest test (which would need complex fs mocking), use a simpler approach: run the resolver for each tier and snapshot the output.

- [ ] **Step 1: Generate golden snapshots**

```bash
mkdir -p infrastructure/scripts/__snapshots__
npx ts-node -r ./tools/register-paths.js infrastructure/scripts/resolve-all-configs.ts sandbox --prefix=sandbox > infrastructure/scripts/__snapshots__/sandbox.json
npx ts-node -r ./tools/register-paths.js infrastructure/scripts/resolve-all-configs.ts staging --prefix=staging > infrastructure/scripts/__snapshots__/staging.json
npx ts-node -r ./tools/register-paths.js infrastructure/scripts/resolve-all-configs.ts production --prefix=prod > infrastructure/scripts/__snapshots__/production.json
```

- [ ] **Step 2: Verify the snapshots look correct**

Review each JSON file. Check:
- 16 entries per tier (single-target) or 16×N for multi-target production
- investor-web has `parallelDeploy: false`
- All hubs have `deploymentPhase: 1`
- BFFs have `dependencies` including `investor-web`
- Tier-specific values match `pipeline-defaults.json`

- [ ] **Step 3: Commit**

```bash
git add infrastructure/scripts/__snapshots__/
git commit -m "test(pipeline): add golden snapshots for resolve-all-configs output"
```

---

### Task 13: End-to-end dry-run validation

- [ ] **Step 1: Run full dry-run for all tiers**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=sandbox-pr-42 --dry-run
bash infrastructure/scripts/deploy.sh staging --dry-run
bash infrastructure/scripts/deploy.sh prod --dry-run
```

Verify for each:
- Phase ordering: 1 → 2 → 3 (→ 4 if first deploy)
- investor-web deploys serially (not in parallel batch)
- All other services deploy in parallel within their phase
- Correct observability/logRetention/protectedResources per tier

- [ ] **Step 2: Run all tests**

```bash
pnpm nx run-many -t test --all --parallel=5
```

Expected: ALL PASS

- [ ] **Step 3: Run validation script**

```bash
bash .github/scripts/validate-pipeline-configs.sh
```

Expected: All files pass.

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(pipeline): address dry-run validation issues"
```

---

## Deployment Strategy Reference

Carried through from spec — this section is reference material for operators.

### Environment Tiers

| Tier | Purpose | Prefix | Lifecycle |
|------|---------|--------|-----------|
| **Sandbox** | Ephemeral PR environments for integration testing | `sandbox-pr-{N}` | Created on PR open, destroyed on PR close |
| **Staging** | Pre-production validation, mirrors prod config | `staging` | Permanent, deployed on every push to main |
| **Production** | Live customer-facing environments | `prod` | Permanent, deployed after staging passes, protected by GH environment approvals |

### Deployment Phases

| Phase | Services | Why |
|-------|----------|-----|
| 1 | `*-hub` (EventBridge buses + SSM params) | Other services need bus ARNs to exist |
| 2 | `*-web`, `*-auth` (Frontend, Cognito) | Auth must exist before BFFs validate tokens |
| 3 | Everything else (BFFs, controllers, adapters) | Depend on hubs and auth |
| 4 | Hub re-deploy (first deploy only) | Cross-domain forwarding rules need all bus ARNs |

### Multi-Target Production Deployment

When production has multiple targets, deploy.sh deploys **all phases to target 1, then all phases to target 2**:
```
Target 1 (us-east-1): Phase 1 → Phase 2 → Phase 3 → Phase 4
Target 2 (eu-west-1): Phase 1 → Phase 2 → Phase 3 → Phase 4
```

---

## Per-Service Configuration Override Guide

Carried through from spec — this section is reference material for developers.

### When to Create a `pipeline.json`

Create `services/{subsystem}/{service}/pipeline.json` **only** when a service deviates from convention:

#### 1. Serial Deployment
```json
{ "$schema": "../../../.pipeline-schema.json", "parallelDeploy": false }
```

#### 2. Custom Dependencies (replaces inferred, not appends)
```json
{ "$schema": "../../../.pipeline-schema.json", "dependencies": ["advisory-hub", "investor-hub"] }
```

#### 3. Override Deployment Phase
```json
{ "$schema": "../../../.pipeline-schema.json", "deploymentPhase": 2 }
```

#### 4. Service-Specific Tier Override
```json
{ "$schema": "../../../.pipeline-schema.json", "staging": { "observability": false } }
```

#### 5. Service-Specific Production Targets
```json
{ "$schema": "../../../.pipeline-schema.json", "production": [{ "region": "us-east-1" }] }
```

#### 6. Custom Log Retention
```json
{ "$schema": "../../../.pipeline-schema.json", "production": { "logRetention": 365 } }
```

#### 7. Alarm Actions
```json
{ "$schema": "../../../.pipeline-schema.json", "production": { "alarmActions": ["arn:aws:sns:us-east-1:111111111111:critical-alerts"] } }
```

### Merge Behavior

| Property | Strategy |
|----------|----------|
| Scalars | Last wins |
| `dependencies` | **Replace** |
| `alarmActions` | **Replace** |
| `production` (array override) | Replaces global targets entirely |

---

## Summary

| Chunk | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-4 | Resolution engine + tests + schemas |
| 2 | 5-7 | resolve-all-configs CLI + deploy.sh rewrite + dry-run |
| 3 | 8-9 | Migrate 16 main.ts + delete old pipeline.json files |
| 4 | 10-13 | Validation script + GitHub Actions + snapshots + E2E verification |

**Total: 13 tasks, 4 chunks**
