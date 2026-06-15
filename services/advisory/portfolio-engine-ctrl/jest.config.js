const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'portfolio-engine-ctrl',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs/(.*)$': '<rootDir>/../../../libs/cdk-constructs/src/$1/index.ts',
    '^@nestfolio/event-types$': '<rootDir>/../../../libs/event-types/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/agent-orchestrator$': '<rootDir>/../../../libs/agent-orchestrator/src/index.ts',
    '^@nestfolio/agent-orchestrator/(.*)$': '<rootDir>/../../../libs/agent-orchestrator/src/$1',
    '^@nestfolio/decision-workflow-ctrl/service$': '<rootDir>/../../advisory/decision-workflow-ctrl/src/domain/index.ts',
    '^@nestfolio/decision-workflow-ctrl/events$': '<rootDir>/../../advisory/decision-workflow-ctrl/src/domain/events.ts',
    '^@nestfolio/investor-adpt/domain$': '<rootDir>/../../investor/investor-adpt/src/domain/index.ts',
    '^@nestfolio/investor-bff/contracts$': '<rootDir>/../../investor/investor-bff/src/domain/contracts.ts',
    '^@nestfolio/decision-workflow-ctrl/agent-budgets$': '<rootDir>/../../advisory/decision-workflow-ctrl/src/agent-budgets.ts',
    '^@nestfolio/execution-adpt/domain$': '<rootDir>/../../execution/execution-adpt/src/domain/index.ts',
    '^@nestfolio/investor-bff/events$': '<rootDir>/../../investor/investor-bff/src/domain/events.ts',
    '^@nestfolio/sec-edgar-adpt/events$': '<rootDir>/../../advisory/sec-edgar-adpt/src/domain/events.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
