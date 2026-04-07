const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'investor-ctrl',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['<rootDir>/test/integration/'],
  testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs/(.*)$': '<rootDir>/../../../libs/cdk-constructs/src/$1/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/investor-bff/events$': '<rootDir>/../../investor/investor-bff/src/domain/events.ts',
    '^@nestfolio/advisory-adpt/domain$': '<rootDir>/../../advisory/advisory-adpt/src/domain/index.ts',
    '^@nestfolio/execution-adpt/domain$': '<rootDir>/../../execution/execution-adpt/src/domain/index.ts',
    '^@nestfolio/ledger-adpt/domain$': '<rootDir>/../../ledger/ledger-adpt/src/domain/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  // p-limit v7+ and yocto-queue are pure ESM — must be transformed by ts-jest
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
