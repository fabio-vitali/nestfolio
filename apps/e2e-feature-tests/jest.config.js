const preset = require('../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'e2e-feature-tests',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.e2e.test.ts', '<rootDir>/test/**/*.test.ts'],
  testTimeout: 300_000,
  maxWorkers: 1,
  globalTeardown: '<rootDir>/jest.global-teardown.ts',
  moduleNameMapper: {
    '^@nestfolio/test-support$': '<rootDir>/../../libs/test-support/src/index.ts',
    '^@nestfolio/event-types$': '<rootDir>/../../libs/event-types/src/index.ts',
    '^@nestfolio/investor-bff/events$': '<rootDir>/../../services/investor/investor-bff/src/domain/events.ts',
    '^@nestfolio/advisory-ctrl/events$': '<rootDir>/../../services/advisory/advisory-ctrl/src/domain/events.ts',
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
