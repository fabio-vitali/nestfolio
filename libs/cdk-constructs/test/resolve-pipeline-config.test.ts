import { App } from 'aws-cdk-lib';
import * as fs from 'fs';

// Mock fs with real defaults — CDK App needs real fs for cloud assembly
const realFs: typeof fs = jest.requireActual('fs');
jest.mock('fs', () => {
  const actual: typeof import('fs') = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn((...args: Parameters<typeof actual.existsSync>) => actual.existsSync(...args)),
    readFileSync: jest.fn((...args: Parameters<typeof actual.readFileSync>) => (actual.readFileSync as any)(...args)),
    readdirSync: jest.fn((...args: Parameters<typeof actual.readdirSync>) => (actual.readdirSync as any)(...args)),
    statSync: jest.fn((...args: Parameters<typeof actual.statSync>) => (actual.statSync as any)(...args)),
  };
});

import {
  resolvePipelineConfig,
  inferServiceMetadata,
  loadTierDefaults,
  mergeConfigs,
  HARDCODED_FALLBACKS,
} from '../src/resolve-pipeline-config';

const mockedFs = fs as jest.Mocked<typeof fs>;

// Helper: create a CDK App with context
const createApp = (context: Record<string, string> = {}) =>
  new App({ context });

// Helper: mock fs for pipeline config file reads (delegates unknown paths to real fs)
const mockFileSystem = (files: Record<string, unknown>) => {
  mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
    const filePath = typeof p === 'string' ? p : p.toString();
    if (Object.keys(files).some((f) => filePath.endsWith(f))) return true;
    return realFs.existsSync(p);
  });
  mockedFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor, ...args: any[]) => {
    const filePath = typeof p === 'string' ? p : p.toString();
    for (const [key, value] of Object.entries(files)) {
      if (filePath.endsWith(key)) return JSON.stringify(value);
    }
    return (realFs.readFileSync as any)(p, ...args);
  });
};

// Helper: mock discoverSubsystem for integration tests
const mockDiscoverSubsystem = (map: Record<string, string>) => {
  mockedFs.readdirSync.mockImplementation((p: fs.PathLike, ...args: any[]) => {
    const filePath = typeof p === 'string' ? p : p.toString();
    if (filePath.endsWith('services')) {
      return [...new Set(Object.values(map))] as any;
    }
    const subsystem = filePath.split('/').pop();
    const matching = Object.entries(map)
      .filter(([, sub]) => sub === subsystem)
      .map(([svc]) => svc);
    if (matching.length > 0) return matching as any;
    return (realFs.readdirSync as any)(p, ...args);
  });
  mockedFs.statSync.mockImplementation((p: fs.PathLike, ...args: any[]) => {
    const filePath = typeof p === 'string' ? p : p.toString();
    if (filePath.includes('services/')) return { isDirectory: () => true } as any;
    return (realFs.statSync as any)(p, ...args);
  });
};

// Reset mocks to real fs delegates between tests
const resetFsMocks = () => {
  mockedFs.existsSync.mockImplementation((...args) => realFs.existsSync(...args));
  mockedFs.readFileSync.mockImplementation((...args: any[]) => (realFs.readFileSync as any)(...args));
  mockedFs.readdirSync.mockImplementation((...args: any[]) => (realFs.readdirSync as any)(...args));
  mockedFs.statSync.mockImplementation((...args: any[]) => (realFs.statSync as any)(...args));
};

describe('inferServiceMetadata', () => {
  it('infers hub service -> phase 1, no dependencies', () => {
    expect(inferServiceMetadata('investor-hub', 'investor')).toEqual({
      service: 'investor-hub', subsystem: 'investor', deploymentPhase: 1, dependencies: [],
    });
  });

  it('infers -web service -> phase 2, depends on hub', () => {
    expect(inferServiceMetadata('investor-web', 'investor')).toEqual({
      service: 'investor-web', subsystem: 'investor', deploymentPhase: 2, dependencies: ['investor-hub'],
    });
  });

  it('infers -bff service -> phase 3, depends on hub + investor-web', () => {
    expect(inferServiceMetadata('advisory-bff', 'advisory')).toEqual({
      service: 'advisory-bff', subsystem: 'advisory', deploymentPhase: 3, dependencies: ['advisory-hub', 'investor-web'],
    });
  });

  it('infers -ctrl service -> phase 3, depends on hub', () => {
    expect(inferServiceMetadata('execution-ctrl', 'execution')).toEqual({
      service: 'execution-ctrl', subsystem: 'execution', deploymentPhase: 3, dependencies: ['execution-hub'],
    });
  });

  it('infers -adpt service -> phase 3, depends on hub', () => {
    expect(inferServiceMetadata('broker-adpt', 'execution')).toEqual({
      service: 'broker-adpt', subsystem: 'execution', deploymentPhase: 3, dependencies: ['execution-hub'],
    });
  });

  it('infers dashboard-bff subsystem as investor (passed by caller)', () => {
    expect(inferServiceMetadata('dashboard-bff', 'investor')).toEqual({
      service: 'dashboard-bff', subsystem: 'investor', deploymentPhase: 3, dependencies: ['investor-hub', 'investor-web'],
    });
  });

  it('infers reconciliation-ctrl subsystem as ledger (passed by caller)', () => {
    expect(inferServiceMetadata('reconciliation-ctrl', 'ledger')).toEqual({
      service: 'reconciliation-ctrl', subsystem: 'ledger', deploymentPhase: 3, dependencies: ['ledger-hub'],
    });
  });

  it('infers compliance-ctrl subsystem as advisory (passed by caller)', () => {
    expect(inferServiceMetadata('compliance-ctrl', 'advisory')).toEqual({
      service: 'compliance-ctrl', subsystem: 'advisory', deploymentPhase: 3, dependencies: ['advisory-hub'],
    });
  });
});

describe('loadTierDefaults', () => {
  afterEach(() => resetFsMocks());

  it('loads sandbox tier from pipeline-defaults.json', () => {
    mockFileSystem({
      'pipeline-defaults.json': {
        sandbox: { observability: false, logRetention: 7 },
        staging: { observability: true },
        production: { observability: true },
      },
    });
    expect(loadTierDefaults('sandbox')).toEqual({ observability: false, logRetention: 7 });
  });

  it('loads production tier (object form)', () => {
    mockFileSystem({
      'pipeline-defaults.json': {
        production: { observability: true, logRetention: 90, protectedResources: true },
      },
    });
    expect(loadTierDefaults('production')).toEqual({ observability: true, logRetention: 90, protectedResources: true });
  });

  it('returns empty object when pipeline-defaults.json is missing', () => {
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('pipeline-defaults.json')) return false;
      return realFs.existsSync(p);
    });
    expect(loadTierDefaults('sandbox')).toEqual({});
  });

  it('returns empty object when tier key is absent', () => {
    mockFileSystem({
      'pipeline-defaults.json': { sandbox: { observability: false } },
    });
    expect(loadTierDefaults('staging')).toEqual({});
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
    expect(loadTierDefaults('production')).toEqual({});
  });
});

describe('mergeConfigs', () => {
  it('applies hardcoded fallbacks when no tier defaults or overrides', () => {
    const inferred = { service: 'investor-hub', subsystem: 'investor', deploymentPhase: 1 as const, dependencies: [] };
    expect(mergeConfigs(inferred, {}, {}, 'staging')).toEqual({ ...inferred, ...HARDCODED_FALLBACKS, prefix: 'staging' });
  });

  it('tier defaults override hardcoded fallbacks', () => {
    const inferred = { service: 'investor-hub', subsystem: 'investor', deploymentPhase: 1 as const, dependencies: [] };
    expect(mergeConfigs(inferred, { logRetention: 30 }, {}, 'staging').logRetention).toBe(30);
  });

  it('per-service overrides override tier defaults', () => {
    const inferred = { service: 'investor-web', subsystem: 'investor', deploymentPhase: 2 as const, dependencies: ['investor-hub'] };
    expect(mergeConfigs(inferred, { parallelDeploy: true }, { parallelDeploy: false }, 'staging').parallelDeploy).toBe(false);
  });

  it('per-service dependencies replace inferred (not concat)', () => {
    const inferred = { service: 'advisory-bff', subsystem: 'advisory', deploymentPhase: 3 as const, dependencies: ['advisory-hub', 'investor-web'] };
    expect(mergeConfigs(inferred, {}, { dependencies: ['advisory-hub', 'investor-hub'] }, 'staging').dependencies).toEqual(['advisory-hub', 'investor-hub']);
  });

  it('per-service deploymentPhase override replaces inferred', () => {
    const inferred = { service: 'investor-bff', subsystem: 'investor', deploymentPhase: 3 as const, dependencies: ['investor-hub', 'investor-web'] };
    expect(mergeConfigs(inferred, {}, { deploymentPhase: 2 }, 'staging').deploymentPhase).toBe(2);
  });

  it('account and region pass through from tier defaults', () => {
    const inferred = { service: 'investor-hub', subsystem: 'investor', deploymentPhase: 1 as const, dependencies: [] };
    const result = mergeConfigs(inferred, { account: '111111111111', region: 'eu-west-1' }, {}, 'prod');
    expect(result.account).toBe('111111111111');
    expect(result.region).toBe('eu-west-1');
  });
});

describe('HARDCODED_FALLBACKS', () => {
  it('has expected default values', () => {
    expect(HARDCODED_FALLBACKS).toEqual({
      observability: false, logRetention: 14, protectedResources: false, parallelDeploy: true, alarmActions: [],
    });
  });
});

describe('resolvePipelineConfig (integration)', () => {
  afterEach(() => resetFsMocks());

  it('resolves a hub service with sandbox tier', () => {
    mockDiscoverSubsystem({ 'investor-hub': 'investor' });
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('main.ts')) return true;
      if (filePath.includes('pipeline-defaults.json')) return true;
      if (filePath.includes('pipeline.json') && !filePath.includes('pipeline-defaults')) return false;
      return realFs.existsSync(p);
    });
    mockedFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor, ...args: any[]) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('pipeline-defaults.json')) {
        return JSON.stringify({
          sandbox: { observability: false, logRetention: 7, protectedResources: false, parallelDeploy: true, alarmActions: [] },
        });
      }
      return (realFs.readFileSync as any)(p, ...args);
    });

    const app = createApp({ tier: 'sandbox', prefix: 'sandbox-pr-42' });
    const config = resolvePipelineConfig(app, 'investor-hub');

    expect(config).toEqual({
      service: 'investor-hub', subsystem: 'investor', deploymentPhase: 1, dependencies: [],
      observability: false, logRetention: 7, protectedResources: false, parallelDeploy: true, alarmActions: [],
      prefix: 'sandbox-pr-42',
    });
  });

  it('resolves investor-web with per-service override', () => {
    mockDiscoverSubsystem({ 'investor-web': 'investor' });
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('main.ts')) return true;
      if (filePath.includes('pipeline-defaults.json')) return true;
      if (filePath.includes('pipeline.json') && !filePath.includes('pipeline-defaults')) return true;
      return realFs.existsSync(p);
    });
    mockedFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor, ...args: any[]) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('pipeline-defaults.json')) {
        return JSON.stringify({
          staging: { observability: true, logRetention: 30, protectedResources: false, parallelDeploy: true, alarmActions: [] },
        });
      }
      if (filePath.includes('pipeline.json')) return JSON.stringify({ parallelDeploy: false });
      return (realFs.readFileSync as any)(p, ...args);
    });

    const app = createApp({ tier: 'staging', prefix: 'staging' });
    const config = resolvePipelineConfig(app, 'investor-web');
    expect(config.parallelDeploy).toBe(false);
    expect(config.observability).toBe(true);
    expect(config.deploymentPhase).toBe(2);
  });

  it('falls back to sandbox tier when no tier context and prefix is unknown', () => {
    mockDiscoverSubsystem({ 'investor-hub': 'investor' });
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('main.ts')) return true;
      if (filePath.includes('pipeline-defaults.json')) return true;
      if (filePath.includes('pipeline.json') && !filePath.includes('pipeline-defaults')) return false;
      return realFs.existsSync(p);
    });
    mockedFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor, ...args: any[]) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('pipeline-defaults.json')) return JSON.stringify({ sandbox: { logRetention: 7 } });
      return (realFs.readFileSync as any)(p, ...args);
    });

    const app = createApp({ prefix: 'my-custom' });
    expect(resolvePipelineConfig(app, 'investor-hub').logRetention).toBe(7);
  });

  it('infers staging tier from prefix when tier context is absent', () => {
    mockDiscoverSubsystem({ 'investor-hub': 'investor' });
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('main.ts')) return true;
      if (filePath.includes('pipeline-defaults.json')) return true;
      if (filePath.includes('pipeline.json') && !filePath.includes('pipeline-defaults')) return false;
      return realFs.existsSync(p);
    });
    mockedFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor, ...args: any[]) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('pipeline-defaults.json')) return JSON.stringify({ staging: { logRetention: 30 } });
      return (realFs.readFileSync as any)(p, ...args);
    });

    const app = createApp({ prefix: 'staging' });
    expect(resolvePipelineConfig(app, 'investor-hub').logRetention).toBe(30);
  });

  it('infers production tier from "prod" prefix', () => {
    mockDiscoverSubsystem({ 'investor-hub': 'investor' });
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('main.ts')) return true;
      if (filePath.includes('pipeline-defaults.json')) return true;
      if (filePath.includes('pipeline.json') && !filePath.includes('pipeline-defaults')) return false;
      return realFs.existsSync(p);
    });
    mockedFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor, ...args: any[]) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('pipeline-defaults.json')) return JSON.stringify({ production: { logRetention: 90 } });
      return (realFs.readFileSync as any)(p, ...args);
    });

    const app = createApp({ prefix: 'prod' });
    expect(resolvePipelineConfig(app, 'investor-hub').logRetention).toBe(90);
  });

  it('applies per-service tier-scoped overrides for matching tier', () => {
    mockDiscoverSubsystem({ 'investor-hub': 'investor' });
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('main.ts')) return true;
      if (filePath.includes('pipeline-defaults.json')) return true;
      if (filePath.includes('pipeline.json') && !filePath.includes('pipeline-defaults')) return true;
      return realFs.existsSync(p);
    });
    mockedFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor, ...args: any[]) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('pipeline-defaults.json')) {
        return JSON.stringify({
          staging: { observability: true, logRetention: 30, parallelDeploy: true, protectedResources: false, alarmActions: [] },
        });
      }
      if (filePath.includes('pipeline.json')) return JSON.stringify({ staging: { observability: false } });
      return (realFs.readFileSync as any)(p, ...args);
    });

    const app = createApp({ tier: 'staging', prefix: 'staging' });
    expect(resolvePipelineConfig(app, 'investor-hub').observability).toBe(false);
  });

  it('ignores per-service tier-scoped overrides for non-matching tier', () => {
    mockDiscoverSubsystem({ 'investor-hub': 'investor' });
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('main.ts')) return true;
      if (filePath.includes('pipeline-defaults.json')) return true;
      if (filePath.includes('pipeline.json') && !filePath.includes('pipeline-defaults')) return true;
      return realFs.existsSync(p);
    });
    mockedFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor, ...args: any[]) => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath.includes('pipeline-defaults.json')) {
        return JSON.stringify({
          production: { observability: true, logRetention: 90, parallelDeploy: true, protectedResources: true, alarmActions: [] },
        });
      }
      if (filePath.includes('pipeline.json')) return JSON.stringify({ staging: { observability: false } });
      return (realFs.readFileSync as any)(p, ...args);
    });

    const app = createApp({ tier: 'production', prefix: 'prod' });
    expect(resolvePipelineConfig(app, 'investor-hub').observability).toBe(true);
  });

  it('throws when prefix is not in context', () => {
    const app = createApp({});
    expect(() => resolvePipelineConfig(app, 'investor-hub')).toThrow('CDK context "prefix" is required');
  });
});
