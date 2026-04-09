const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'market-intelligence-ctrl',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['<rootDir>/test/integration/'],
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs/(.*)$': '<rootDir>/../../../libs/cdk-constructs/src/$1/index.ts',
    '^@nestfolio/event-types$': '<rootDir>/../../../libs/event-types/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/agent-orchestrator$': '<rootDir>/../../../libs/agent-orchestrator/src/index.ts',
    '^@nestfolio/agent-orchestrator/(.*)$': '<rootDir>/../../../libs/agent-orchestrator/src/$1',
    '^@nestfolio/decision-workflow-ctrl/service$': '<rootDir>/../../advisory/decision-workflow-ctrl/src/domain/index.ts',
    '^@nestfolio/decision-workflow-ctrl/events$': '<rootDir>/../../advisory/decision-workflow-ctrl/src/domain/events.ts',
    '^@nestfolio/compliance-ctrl/service$': '<rootDir>/../../advisory/compliance-ctrl/src/domain/index.ts',
    '^@nestfolio/yahoo-finance-adpt/events$': '<rootDir>/../../advisory/yahoo-finance-adpt/src/domain/events.ts',
    '^@nestfolio/marketwatch-adpt/events$': '<rootDir>/../../advisory/marketwatch-adpt/src/domain/events.ts',
    '^@nestfolio/sec-edgar-adpt/events$': '<rootDir>/../../advisory/sec-edgar-adpt/src/domain/events.ts',
    '^@nestfolio/fred-adpt/events$': '<rootDir>/../../advisory/fred-adpt/src/domain/events.ts',
    '^@nestfolio/alpha-vantage-adpt/events$': '<rootDir>/../../advisory/alpha-vantage-adpt/src/domain/events.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
