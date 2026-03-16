const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'advisory-bff',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/advisory-ctrl/domain$': '<rootDir>/../../advisory/advisory-ctrl/src/domain/index.ts',
    '^@nestfolio/compliance-ctrl/domain$': '<rootDir>/../../advisory/compliance-ctrl/src/domain/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
