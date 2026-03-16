const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'advisory-ctrl',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/agent-core$': '<rootDir>/../../../libs/agent-core/src/index.ts',
    '^@nestfolio/agent-core/(.*)$': '<rootDir>/../../../libs/agent-core/src/$1',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/investor-bff/service$': '<rootDir>/../../investor/investor-bff/src/service-domain/index.ts',
    '^@nestfolio/advisory-bff/service$': '<rootDir>/../../advisory/advisory-bff/src/service-domain/index.ts',
    '^@nestfolio/compliance-ctrl/service$': '<rootDir>/../../advisory/compliance-ctrl/src/service-domain/index.ts',
    '^@nestfolio/broker-adpt/service$': '<rootDir>/../../execution/broker-adpt/src/service-domain/index.ts',
    '^@nestfolio/reconciliation-ctrl/service$': '<rootDir>/../../ledger/reconciliation-ctrl/src/service-domain/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
