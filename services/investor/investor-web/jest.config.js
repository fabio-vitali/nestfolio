const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'investor-web',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/lambda-utils$': '<rootDir>/../../../libs/lambda-utils/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
