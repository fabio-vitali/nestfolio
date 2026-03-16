const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'investor-ctrl',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/investor-bff/service$': '<rootDir>/../../investor/investor-bff/src/service-domain/index.ts',
    '^@nestfolio/compliance-ctrl/service$': '<rootDir>/../../advisory/compliance-ctrl/src/service-domain/index.ts',
    '^@nestfolio/broker-adpt/service$': '<rootDir>/../../execution/broker-adpt/src/service-domain/index.ts',
    '^@nestfolio/ledger-ctrl/service$': '<rootDir>/../../ledger/ledger-ctrl/src/service-domain/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  // p-limit v7+ and yocto-queue are pure ESM — must be transformed by ts-jest
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
