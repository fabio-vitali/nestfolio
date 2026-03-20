const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'ledger-bff',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      diagnostics: false,
    }],
  },
  moduleNameMapper: {
    '^@nestfolio/command-core$': '<rootDir>/../../../libs/command-core/src/index.ts',
    '^@nestfolio/ledger-core$': '<rootDir>/../../../libs/ledger-core/src/index.ts',
    '^@nestfolio/ledger-core/(.*)$': '<rootDir>/../../../libs/ledger-core/src/$1',
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/ledger-events$': '<rootDir>/../../ledger/ledger-ctrl/src/domain/index.ts',
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
