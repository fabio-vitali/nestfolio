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
    '^@nestfolio/ledger-core$': '<rootDir>/../../../libs/ledger-core/src/index.ts',
    '^@nestfolio/ledger-core/(.*)$': '<rootDir>/../../../libs/ledger-core/src/$1',
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/execution-adpt/domain$': '<rootDir>/../../execution/execution-adpt/src/domain/index.ts',
    '^@nestfolio/advisory-adpt/domain$': '<rootDir>/../../advisory/advisory-adpt/src/domain/index.ts',
    '^@nestfolio/advisory-events$': '<rootDir>/../../../libs/advisory-events/src/index.ts',
  },
};
