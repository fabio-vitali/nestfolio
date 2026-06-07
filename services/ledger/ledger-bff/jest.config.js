const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'ledger-bff',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      diagnostics: false,
    }],
  },
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs/(.*)$': '<rootDir>/../../../libs/cdk-constructs/src/$1/index.ts',
    '^@nestfolio/event-types$': '<rootDir>/../../../libs/event-types/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/ledger-ctrl/events$': '<rootDir>/../../ledger/ledger-ctrl/src/domain/events.ts',
    '^@nestfolio/ledger-ctrl/contracts$': '<rootDir>/../../ledger/ledger-ctrl/src/domain/contracts.ts',
    '^@nestfolio/test-support$': '<rootDir>/../../../libs/test-support/src/index.ts',
    '^@aws-appsync/utils/dynamodb$': '<rootDir>/test/unit/graphql/__mocks__/appsync-utils-dynamodb.ts',
    '^@aws-appsync/utils$': '<rootDir>/test/unit/graphql/__mocks__/appsync-utils.ts',
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
