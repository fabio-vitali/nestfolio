const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'cdk-constructs',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/lambda-utils$': '<rootDir>/../lambda-utils/src/index.ts',
    '^@nestfolio/platform-core$': '<rootDir>/../platform-core/src/index.ts',
    '^@nestfolio/domain-core$': '<rootDir>/../domain-core/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../event-processor/src/$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      diagnostics: false,
    }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
