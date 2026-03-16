const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'advisory-ctrl',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/platform-core$': '<rootDir>/../../../libs/platform-core/src/index.ts',
    '^@nestfolio/platform-core/(.*)$': '<rootDir>/../../../libs/platform-core/src/$1',
    '^@nestfolio/domain-core$': '<rootDir>/../../../libs/domain-core/src/index.ts',
    '^@nestfolio/domain-core/(.*)$': '<rootDir>/../../../libs/domain-core/src/$1',
    '^@nestfolio/lambda-utils$': '<rootDir>/../../../libs/lambda-utils/src/index.ts',
    '^@nestfolio/lambda-utils/(.*)$': '<rootDir>/../../../libs/lambda-utils/src/$1',
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/agent-core$': '<rootDir>/../../../libs/agent-core/src/index.ts',
    '^@nestfolio/agent-core/(.*)$': '<rootDir>/../../../libs/agent-core/src/$1',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/investor-bff/domain$': '<rootDir>/../../investor/investor-bff/src/domain/index.ts',
    '^@nestfolio/advisory-bff/domain$': '<rootDir>/../../advisory/advisory-bff/src/domain/index.ts',
    '^@nestfolio/compliance-ctrl/domain$': '<rootDir>/../../advisory/compliance-ctrl/src/domain/index.ts',
    '^@nestfolio/execution-adpt/domain$': '<rootDir>/../../execution/execution-adpt/src/domain/index.ts',
    '^@nestfolio/reconciliation-ctrl/domain$': '<rootDir>/../../ledger/reconciliation-ctrl/src/domain/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
