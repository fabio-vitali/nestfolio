const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'advisory-adpt',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['<rootDir>/test/integration/'],
  moduleNameMapper: {
    '^@nestfolio/event-types$': '<rootDir>/../../../libs/event-types/src/index.ts',
    '^@nestfolio/cdk-constructs/(.*)$': '<rootDir>/../../../libs/cdk-constructs/src/$1/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
