const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'ledger-ctrl',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      diagnostics: false,
    }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
  moduleNameMapper: {
    '^@nestfolio/command-core$': '<rootDir>/../../../libs/command-core/src/index.ts',
    '^@nestfolio/command-core/(.*)$': '<rootDir>/../../../libs/command-core/src/$1',
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/broker-adpt/service$': '<rootDir>/../../execution/broker-adpt/src/service-domain/index.ts',
    '^@nestfolio/advisory-ctrl/service$': '<rootDir>/../../advisory/advisory-ctrl/src/service-domain/index.ts',
  },
};
