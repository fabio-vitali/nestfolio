const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'dashboard-bff',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/command-core$': '<rootDir>/../../../libs/command-core/src/index.ts',
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/ledger-ctrl/domain$': '<rootDir>/../../ledger/ledger-ctrl/src/domain/index.ts',
    '^@nestfolio/reconciliation-ctrl/domain$': '<rootDir>/../../ledger/reconciliation-ctrl/src/domain/index.ts',
    '^@nestfolio/advisory-ctrl/domain$': '<rootDir>/../../advisory/advisory-ctrl/src/domain/index.ts',
    '^@nestfolio/compliance-ctrl/domain$': '<rootDir>/../../advisory/compliance-ctrl/src/domain/index.ts',
    '^@nestfolio/investor-bff/domain$': '<rootDir>/../../investor/investor-bff/src/domain/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  // p-limit v7+ and yocto-queue are pure ESM — must be transformed by ts-jest
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
