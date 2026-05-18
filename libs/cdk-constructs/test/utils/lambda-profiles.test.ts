import { Duration } from 'aws-cdk-lib';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { LambdaProfile, handlerProps, adapterProps, reducerProps, agentProps, PARAMS_AND_SECRETS_LAYER, agentProfile, AgentProfileInputs } from '../../src/utils/lambda-profiles';

describe('lambda-profiles — module contract', () => {
  it('exports LambdaProfile type so it can be imported by constructs', () => {
    // Type-level check: if the import fails, TS compile blocks the test.
    const shape: LambdaProfile = {
      lambdaProps: { runtime: Runtime.NODEJS_24_X, architecture: Architecture.ARM_64 },
    };
    expect(shape.lambdaProps).toBeDefined();
  });

  it('LambdaProfile allows optional SQS and DDB stream defaults', () => {
    const full: LambdaProfile = {
      lambdaProps: { memorySize: 256, timeout: Duration.seconds(30), logRetention: RetentionDays.THREE_MONTHS },
      sqsBatchSize: 10,
      sqsMaxBatchingWindow: Duration.seconds(1),
      sqsMaxConcurrency: 5,
      ddbStreamBatchSize: 50,
      ddbStreamMaxBatchingWindow: Duration.seconds(2),
      ddbStreamParallelizationFactor: 1,
    };
    expect(full.sqsBatchSize).toBe(10);
    expect(full.ddbStreamBatchSize).toBe(50);
  });

  it('LambdaProfile allows optional visibilityTimeout', () => {
    const withVisibility: LambdaProfile = {
      lambdaProps: { timeout: Duration.seconds(60) },
      visibilityTimeout: Duration.seconds(240),
    };
    expect(withVisibility.visibilityTimeout).toEqual(Duration.seconds(240));
  });
});

describe('handlerProps — default event handler profile', () => {
  it('uses 256 MB memory (matches current Ingress default)', () => {
    expect(handlerProps.lambdaProps.memorySize).toBe(256);
  });

  it('uses 30s timeout (matches current Ingress default)', () => {
    expect(handlerProps.lambdaProps.timeout).toEqual(Duration.seconds(30));
  });

  it('uses Node.js 24 ARM64 runtime', () => {
    expect(handlerProps.lambdaProps.runtime).toEqual(Runtime.NODEJS_24_X);
    expect(handlerProps.lambdaProps.architecture).toEqual(Architecture.ARM_64);
  });

  it('defaults SQS batch size to 10 (matches current Ingress default)', () => {
    expect(handlerProps.sqsBatchSize).toBe(10);
  });

  it('defaults SQS batching window to 1s (matches current Ingress default)', () => {
    expect(handlerProps.sqsMaxBatchingWindow).toEqual(Duration.seconds(1));
  });

  it('does not set sqsMaxConcurrency (uncapped by default)', () => {
    expect(handlerProps.sqsMaxConcurrency).toBeUndefined();
  });

  it('excludes @aws-sdk/* from bundling', () => {
    expect(handlerProps.lambdaProps.bundling?.externalModules).toEqual(['@aws-sdk/*']);
  });
});

describe('adapterProps — third-party API adapter profile', () => {
  it('uses 256 MB memory (same as handler)', () => {
    expect(adapterProps.lambdaProps.memorySize).toBe(256);
  });

  it('uses 60s timeout (upstream can be slow)', () => {
    expect(adapterProps.lambdaProps.timeout).toEqual(Duration.seconds(60));
  });

  it('bundles the Parameters and Secrets Extension layer', () => {
    expect(adapterProps.lambdaProps.paramsAndSecrets).toBe(PARAMS_AND_SECRETS_LAYER);
  });

  it('uses smaller SQS batches (one slow call cannot hold up unrelated work)', () => {
    expect(adapterProps.sqsBatchSize).toBe(5);
  });

  it('uses 2s SQS batching window', () => {
    expect(adapterProps.sqsMaxBatchingWindow).toEqual(Duration.seconds(2));
  });

  it('caps SQS concurrency to 10 (rate-limit-friendly for third-party APIs)', () => {
    expect(adapterProps.sqsMaxConcurrency).toBe(10);
  });

  it('inherits base bundling config', () => {
    expect(adapterProps.lambdaProps.bundling?.externalModules).toEqual(['@aws-sdk/*']);
  });
});

describe('reducerProps — CDC/stream-heavy reducer profile', () => {
  it('uses 512 MB memory (larger in-memory aggregation)', () => {
    expect(reducerProps.lambdaProps.memorySize).toBe(512);
  });

  it('uses 60s timeout', () => {
    expect(reducerProps.lambdaProps.timeout).toEqual(Duration.seconds(60));
  });

  it('uses large SQS batches (25) to amortize write cost', () => {
    expect(reducerProps.sqsBatchSize).toBe(25);
  });

  it('uses 2s SQS batching window', () => {
    expect(reducerProps.sqsMaxBatchingWindow).toEqual(Duration.seconds(2));
  });

  it('uses DDB stream batch size 100', () => {
    expect(reducerProps.ddbStreamBatchSize).toBe(100);
  });

  it('uses DDB stream batching window 5s', () => {
    expect(reducerProps.ddbStreamMaxBatchingWindow).toEqual(Duration.seconds(5));
  });

  it('uses DDB stream parallelizationFactor 1', () => {
    expect(reducerProps.ddbStreamParallelizationFactor).toBe(1);
  });
});

describe('agentProps — Bedrock/LLM-calling profile', () => {
  it('uses 1024 MB memory (cold-start sensitive)', () => {
    expect(agentProps.lambdaProps.memorySize).toBe(1024);
  });

  it('uses 5 minute timeout (LLM calls are slow)', () => {
    expect(agentProps.lambdaProps.timeout).toEqual(Duration.minutes(5));
  });

  it('uses SQS batch size 1 — one event = one LLM invocation', () => {
    expect(agentProps.sqsBatchSize).toBe(1);
  });

  it('uses zero batching window (no amortization benefit)', () => {
    expect(agentProps.sqsMaxBatchingWindow).toEqual(Duration.seconds(0));
  });

  it('caps SQS concurrency to 5 (below Bedrock throttle limits)', () => {
    expect(agentProps.sqsMaxConcurrency).toBe(5);
  });

  it('does NOT bundle the params-and-secrets layer', () => {
    expect(agentProps.lambdaProps.paramsAndSecrets).toBeUndefined();
  });

  it('overrides externalModules to [] so @aws-sdk/client-bedrock-agentcore is bundled', () => {
    // Other profiles externalize @aws-sdk/* (the runtime ships those clients).
    // Agent profile must bundle because BatchCreateMemoryRecordsCommand was
    // added to the bedrock-agentcore SDK after the version Lambda Node 24
    // ships — externalizing produces TypeError at agent memory writes.
    expect(agentProps.lambdaProps.bundling?.externalModules).toEqual([]);
  });
});

describe('lambda-profiles — barrel export', () => {
  it('re-exports profiles from @nestfolio/cdk-constructs/utils', async () => {
    const utils = await import('../../src/utils');
    expect(utils.handlerProps).toBeDefined();
    expect(utils.adapterProps).toBeDefined();
    expect(utils.reducerProps).toBeDefined();
    expect(utils.agentProps).toBeDefined();
  });

  it('re-exports LambdaProfile type', async () => {
    // Type is erased at runtime — this test asserts the import path compiles.
    type Profile = import('../../src/utils').LambdaProfile;
    const check: Profile = { lambdaProps: {} };
    expect(check).toBeDefined();
  });
});

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
