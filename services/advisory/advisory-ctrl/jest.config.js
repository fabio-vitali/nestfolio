const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'advisory-ctrl',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/agent-orchestrator$': '<rootDir>/../../../libs/agent-orchestrator/src/index.ts',
    '^@nestfolio/agent-orchestrator/(.*)$': '<rootDir>/../../../libs/agent-orchestrator/src/$1',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/investor-adpt/domain$': '<rootDir>/../../investor/investor-adpt/src/domain/index.ts',
    '^@nestfolio/advisory-bff/events$': '<rootDir>/../../advisory/advisory-bff/src/domain/events.ts',
    '^@nestfolio/compliance-ctrl/events$': '<rootDir>/../../advisory/compliance-ctrl/src/domain/events.ts',
    '^@nestfolio/execution-adpt/domain$': '<rootDir>/../../execution/execution-adpt/src/domain/index.ts',
    '^@nestfolio/ledger-adpt/domain$': '<rootDir>/../../ledger/ledger-adpt/src/domain/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
