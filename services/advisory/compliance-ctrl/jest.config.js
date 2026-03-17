const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'compliance-ctrl',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/advisory-ctrl/service$': '<rootDir>/../../advisory/advisory-ctrl/src/service-domain/index.ts',
    '^@nestfolio/investor-adpt/domain$': '<rootDir>/../../investor/investor-adpt/src/domain/index.ts',
    '^@nestfolio/investor-bff/service$': '<rootDir>/../../investor/investor-bff/src/service-domain/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
