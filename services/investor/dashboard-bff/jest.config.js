const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'dashboard-bff',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/ledger-core$': '<rootDir>/../../../libs/ledger-core/src/index.ts',
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/ledger-adpt/domain$': '<rootDir>/../../ledger/ledger-adpt/src/domain/index.ts',
    '^@nestfolio/advisory-adpt/domain$': '<rootDir>/../../advisory/advisory-adpt/src/domain/index.ts',
    '^@nestfolio/advisory-ctrl/service$': '<rootDir>/../../advisory/advisory-ctrl/src/service-domain/index.ts',
    '^@nestfolio/investor-bff/service$': '<rootDir>/../../investor/investor-bff/src/service-domain/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  // p-limit v7+ and yocto-queue are pure ESM — must be transformed by ts-jest
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
