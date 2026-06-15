const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'advisory-bff',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs/(.*)$': '<rootDir>/../../../libs/cdk-constructs/src/$1/index.ts',
    '^@nestfolio/event-types$': '<rootDir>/../../../libs/event-types/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/decision-workflow-ctrl/events$': '<rootDir>/../../advisory/decision-workflow-ctrl/src/domain/events.ts',
    '^@nestfolio/investor-adpt/domain$': '<rootDir>/../../investor/investor-adpt/src/domain/index.ts',
    '^@nestfolio/investor-bff/contracts$': '<rootDir>/../../investor/investor-bff/src/domain/contracts.ts',
    '^@nestfolio/compliance-ctrl/events$': '<rootDir>/../../advisory/compliance-ctrl/src/domain/events.ts',
    '^@nestfolio/investor-bff/events$': '<rootDir>/../../investor/investor-bff/src/domain/events.ts',
    '^@aws-appsync/utils$': '<rootDir>/test/unit/graphql/__mocks__/appsync-utils.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
