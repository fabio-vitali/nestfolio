const preset = require('../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'e2e-feature-tests',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.e2e.test.ts', '<rootDir>/test/**/*.test.ts'],
  // 600s ceiling: onboarded() polls up to 360s for the IP-ctrl snapshot (one
  // full SQS native redrive on maxVms saturation) — see the
  // agentcore-invocation-resilience spec. Hooks/tests that need more set an
  // explicit per-hook timeout.
  testTimeout: 600_000,
  maxWorkers: 1,
  globalTeardown: '<rootDir>/jest.global-teardown.ts',
  moduleNameMapper: {
    '^@nestfolio/test-support$': '<rootDir>/../../libs/test-support/src/index.ts',
    '^@nestfolio/event-types$': '<rootDir>/../../libs/event-types/src/index.ts',
    '^@nestfolio/integration-testing$': '<rootDir>/../../libs/integration-testing/src/index.ts',
    '^@nestfolio/agent-orchestrator$': '<rootDir>/../../libs/agent-orchestrator/src/index.ts',
    '^@nestfolio/investor-bff/events$': '<rootDir>/../../services/investor/investor-bff/src/domain/events.ts',
    '^@nestfolio/decision-workflow-ctrl/events$': '<rootDir>/../../services/advisory/decision-workflow-ctrl/src/domain/events.ts',
    '^@nestfolio/advisory-narrative-ctrl/events$': '<rootDir>/../../services/advisory/advisory-narrative-ctrl/src/domain/events.ts',
    '^@nestfolio/portfolio-engine-ctrl/events$': '<rootDir>/../../services/advisory/portfolio-engine-ctrl/src/domain/events.ts',
    '^@nestfolio/investor-profile-ctrl/events$': '<rootDir>/../../services/advisory/investor-profile-ctrl/src/domain/events.ts',
    '^@nestfolio/market-intelligence-ctrl/events$': '<rootDir>/../../services/advisory/market-intelligence-ctrl/src/domain/events.ts',
    '^@nestfolio/onboarding-bff/events$': '<rootDir>/../../services/investor/onboarding-bff/src/domain/events.ts',
    '^@nestfolio/investor-ctrl/events$': '<rootDir>/../../services/investor/investor-ctrl/src/domain/events.ts',
    '^@nestfolio/ledger-ctrl/events$': '<rootDir>/../../services/ledger/ledger-ctrl/src/domain/events.ts',
    '^@nestfolio/broker-ctrl/events$': '<rootDir>/../../services/execution/broker-ctrl/src/domain/events.ts',
    '^@nestfolio/broker-alpaca-adpt/events$': '<rootDir>/../../services/execution/broker-alpaca-adpt/src/domain/events.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  coverageThreshold: undefined,
  collectCoverageFrom: undefined,
};
