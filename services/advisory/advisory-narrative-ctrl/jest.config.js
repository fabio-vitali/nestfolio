const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'advisory-narrative-ctrl',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['<rootDir>/test/integration/'],
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs/(.*)$': '<rootDir>/../../../libs/cdk-constructs/src/$1/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/agent-orchestrator$': '<rootDir>/../../../libs/agent-orchestrator/src/index.ts',
    '^@nestfolio/agent-orchestrator/(.*)$': '<rootDir>/../../../libs/agent-orchestrator/src/$1',
    '^@nestfolio/decision-workflow-ctrl/service$': '<rootDir>/../../advisory/decision-workflow-ctrl/src/domain/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
