const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'broker-ctrl',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
  moduleNameMapper: {
    '^@nestfolio/event-types$': '<rootDir>/../../../libs/event-types/src/index.ts',
    '^@nestfolio/cdk-constructs/(.*)$': '<rootDir>/../../../libs/cdk-constructs/src/$1/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/investor-adpt/domain$': '<rootDir>/../../investor/investor-adpt/src/domain/index.ts',
    '^@nestfolio/investor-bff/contracts$': '<rootDir>/../../investor/investor-bff/src/domain/contracts.ts',
    '^@nestfolio/execution-adpt/domain$': '<rootDir>/../execution-adpt/src/domain/index.ts',
    '^@nestfolio/broker-ctrl/contracts$': '<rootDir>/src/domain/contracts.ts',
    '^@nestfolio/broker-sim-adpt/contracts$': '<rootDir>/../broker-sim-adpt/src/domain/contracts.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
