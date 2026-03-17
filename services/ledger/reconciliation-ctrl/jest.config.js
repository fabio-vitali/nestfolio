const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'reconciliation-ctrl',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/ledger-ctrl/service$': '<rootDir>/../../ledger/ledger-ctrl/src/service-domain/index.ts',
    '^@nestfolio/execution-adpt/domain$': '<rootDir>/../../execution/execution-adpt/src/domain/index.ts',
    '^@nestfolio/broker-adpt/service$': '<rootDir>/../../execution/broker-adpt/src/service-domain/index.ts',
  },
};
