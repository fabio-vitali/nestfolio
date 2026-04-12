const preset = require('../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'e2e-feature-tests',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  testTimeout: 300_000,
  maxWorkers: 1,
  globalTeardown: '<rootDir>/jest.global-teardown.ts',
  moduleNameMapper: {
    '^@nestfolio/test-support$': '<rootDir>/../../libs/test-support/src/index.ts',
    '^@nestfolio/event-types$': '<rootDir>/../../libs/event-types/src/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  coverageThreshold: undefined,
  collectCoverageFrom: undefined,
};
