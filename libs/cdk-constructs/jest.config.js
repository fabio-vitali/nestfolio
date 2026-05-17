const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'cdk-constructs',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/event-types$': '<rootDir>/../event-types/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../event-processor/src/$1',
    // For the cross-cutting CDK IAM-invariants test: imports stack classes
    // from five sibling services. Mirror the bare-package aliases each
    // service's own jest config uses, so the sibling source compiles inside
    // this lib's jest runtime.
    '^@nestfolio/cdk-constructs/(.*)$': '<rootDir>/src/$1/index.ts',
    '^@nestfolio/agent-orchestrator$': '<rootDir>/../agent-orchestrator/src/index.ts',
    '^@nestfolio/agent-orchestrator/(.*)$': '<rootDir>/../agent-orchestrator/src/$1',
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
};
