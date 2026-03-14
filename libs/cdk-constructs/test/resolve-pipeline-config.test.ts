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
