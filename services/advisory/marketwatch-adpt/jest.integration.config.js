const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'marketwatch-adpt-integration',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.integration.test.ts'],
  moduleNameMapper: {
    '^@nestfolio/test-support$': '<rootDir>/../../../libs/test-support/src/index.ts',
    '^@nestfolio/test-support/(.*)$': '<rootDir>/../../../libs/test-support/src/$1',
    '^@nestfolio/integration-testing$': '<rootDir>/../../../libs/integration-testing/src/index.ts',
    '^@nestfolio/integration-testing/(.*)$': '<rootDir>/../../../libs/integration-testing/src/$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
  testTimeout: 120_000,
  maxWorkers: 1,
  setupFilesAfterEnv: ['<rootDir>/../../../libs/integration-testing/src/jest.integration.setup.ts'],
};
