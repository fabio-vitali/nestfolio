const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'broker-alpaca-adpt-integration',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.integration.test.ts'],
  moduleNameMapper: {
    '^@nestfolio/integration-testing$': '<rootDir>/../../../libs/integration-testing/src/index.ts',
    '^@nestfolio/integration-testing/(.*)$': '<rootDir>/../../../libs/integration-testing/src/$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  testTimeout: 120_000,
};
