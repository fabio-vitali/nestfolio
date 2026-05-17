const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'architecture-tests',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  moduleNameMapper: {
    // Shared libs used transitively by service stacks under test.
    '^@nestfolio/event-types$': '<rootDir>/../../libs/event-types/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../libs/event-processor/src/$1',
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/cdk-constructs/(.*)$': '<rootDir>/../../libs/cdk-constructs/src/$1/index.ts',
    '^@nestfolio/agent-orchestrator$': '<rootDir>/../../libs/agent-orchestrator/src/index.ts',
    '^@nestfolio/agent-orchestrator/(.*)$': '<rootDir>/../../libs/agent-orchestrator/src/$1',
    // Service-stack bare-package aliases under test for cross-cutting IAM invariants.
    '^@nestfolio/investor-profile-ctrl/events$':
      '<rootDir>/../../services/advisory/investor-profile-ctrl/src/domain/events.ts',
    '^@nestfolio/investor-profile-ctrl/stack$':
      '<rootDir>/../../services/advisory/investor-profile-ctrl/src/service.stack.ts',
    '^@nestfolio/market-intelligence-ctrl/events$':
      '<rootDir>/../../services/advisory/market-intelligence-ctrl/src/domain/events.ts',
    '^@nestfolio/market-intelligence-ctrl/stack$':
      '<rootDir>/../../services/advisory/market-intelligence-ctrl/src/service.stack.ts',
    '^@nestfolio/portfolio-engine-ctrl/events$':
      '<rootDir>/../../services/advisory/portfolio-engine-ctrl/src/domain/events.ts',
    '^@nestfolio/portfolio-engine-ctrl/stack$':
      '<rootDir>/../../services/advisory/portfolio-engine-ctrl/src/service.stack.ts',
    '^@nestfolio/advisory-narrative-ctrl/events$':
      '<rootDir>/../../services/advisory/advisory-narrative-ctrl/src/domain/events.ts',
    '^@nestfolio/advisory-narrative-ctrl/stack$':
      '<rootDir>/../../services/advisory/advisory-narrative-ctrl/src/service.stack.ts',
    '^@nestfolio/decision-workflow-ctrl/events$':
      '<rootDir>/../../services/advisory/decision-workflow-ctrl/src/domain/events.ts',
    '^@nestfolio/decision-workflow-ctrl/stack$':
      '<rootDir>/../../services/advisory/decision-workflow-ctrl/src/service.stack.ts',
    // Transitive event-only aliases used by the service stacks' adapters/subscriptions.
    '^@nestfolio/compliance-ctrl/events$':
      '<rootDir>/../../services/advisory/compliance-ctrl/src/domain/events.ts',
    '^@nestfolio/investor-bff/events$':
      '<rootDir>/../../services/investor/investor-bff/src/domain/events.ts',
    '^@nestfolio/alpha-vantage-adpt/events$':
      '<rootDir>/../../services/advisory/alpha-vantage-adpt/src/domain/events.ts',
    '^@nestfolio/fred-adpt/events$':
      '<rootDir>/../../services/advisory/fred-adpt/src/domain/events.ts',
    '^@nestfolio/marketwatch-adpt/events$':
      '<rootDir>/../../services/advisory/marketwatch-adpt/src/domain/events.ts',
    '^@nestfolio/sec-edgar-adpt/events$':
      '<rootDir>/../../services/advisory/sec-edgar-adpt/src/domain/events.ts',
    '^@nestfolio/yahoo-finance-adpt/events$':
      '<rootDir>/../../services/advisory/yahoo-finance-adpt/src/domain/events.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      diagnostics: false,
    }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
  coverageThreshold: undefined,
  collectCoverageFrom: undefined,
};
