const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'execution-ctrl',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/compliance-ctrl/service$': '<rootDir>/../../advisory/compliance-ctrl/src/service-domain/index.ts',
    '^@nestfolio/advisory-bff/service$': '<rootDir>/../../advisory/advisory-bff/src/service-domain/index.ts',
    '^@nestfolio/advisory-ctrl/service$': '<rootDir>/../../advisory/advisory-ctrl/src/service-domain/index.ts',
    '^@nestfolio/investor-bff/service$': '<rootDir>/../../investor/investor-bff/src/service-domain/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
