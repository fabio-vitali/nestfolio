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
    '^@nestfolio/compliance-ctrl/events$': '<rootDir>/../../advisory/compliance-ctrl/src/domain/events.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
