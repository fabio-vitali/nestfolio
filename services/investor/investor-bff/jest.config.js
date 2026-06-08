const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'investor-bff',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs/(.*)$': '<rootDir>/../../../libs/cdk-constructs/src/$1/index.ts',
    '^@nestfolio/event-types$': '<rootDir>/../../../libs/event-types/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/test-support$': '<rootDir>/../../../libs/test-support/src/index.ts',
    '^@nestfolio/investor-ctrl/events$': '<rootDir>/../../investor/investor-ctrl/src/domain/events.ts',
    '^@nestfolio/investor-ctrl/contracts$': '<rootDir>/../../investor/investor-ctrl/src/domain/contracts.ts',
    '^@nestfolio/investor-adpt/domain$': '<rootDir>/../../investor/investor-adpt/src/domain/index.ts',
    '^@nestfolio/ledger-adpt/domain$': '<rootDir>/../../ledger/ledger-adpt/src/domain/index.ts',
    '^@nestfolio/ledger-ctrl/contracts$': '<rootDir>/../../ledger/ledger-ctrl/src/domain/contracts.ts',
    '^@nestfolio/broker-ctrl/contracts$': '<rootDir>/../../execution/broker-ctrl/src/domain/contracts.ts',
    '^@aws-appsync/utils$': '<rootDir>/test/unit/graphql/__mocks__/appsync-utils.ts',
    '^@aws-appsync/utils/dynamodb$': '<rootDir>/test/unit/graphql/__mocks__/appsync-utils-dynamodb.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  // p-limit v7+ and yocto-queue are pure ESM — must be transformed by ts-jest
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
