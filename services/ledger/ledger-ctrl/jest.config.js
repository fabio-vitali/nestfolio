const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'ledger-ctrl',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      diagnostics: false,
    }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
  moduleNameMapper: {
'^@nestfolio/cdk-constructs/(.*)$': '<rootDir>/../../../libs/cdk-constructs/src/$1/index.ts',
    '^@nestfolio/event-types$': '<rootDir>/../../../libs/event-types/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/execution-adpt/domain$': '<rootDir>/../../execution/execution-adpt/src/domain/index.ts',
    '^@nestfolio/advisory-adpt/domain$': '<rootDir>/../../advisory/advisory-adpt/src/domain/index.ts',
    '^@nestfolio/ledger-adpt/domain$': '<rootDir>/../../ledger/ledger-adpt/src/domain/index.ts',
    '^@nestfolio/broker-ctrl/contracts$': '<rootDir>/../../execution/broker-ctrl/src/domain/contracts.ts',
    '^@nestfolio/compliance-ctrl/contracts$': '<rootDir>/../../advisory/compliance-ctrl/src/domain/contracts.ts',
    '^@nestfolio/advisory-bff/contracts$': '<rootDir>/../../advisory/advisory-bff/src/domain/contracts.ts',
    '^@nestfolio/decision-workflow-ctrl/contracts$': '<rootDir>/../../advisory/decision-workflow-ctrl/src/domain/contracts.ts',
    '^@nestfolio/ledger-ctrl/contracts$': '<rootDir>/src/domain/contracts.ts',
  },
};
