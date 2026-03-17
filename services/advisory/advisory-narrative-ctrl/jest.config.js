const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'advisory-narrative-ctrl',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/agent-core$': '<rootDir>/../../../libs/agent-core/src/index.ts',
    '^@nestfolio/agent-core/(.*)$': '<rootDir>/../../../libs/agent-core/src/$1',
    '^@nestfolio/decision-workflow-ctrl/service$': '<rootDir>/../../advisory/decision-workflow-ctrl/src/service-domain/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
