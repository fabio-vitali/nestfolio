const preset = require('../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'integration-testing',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  moduleNameMapper: {
    ...preset.moduleNameMapper,
    '^@nestfolio/test-support$': '<rootDir>/../test-support/src/index.ts',
  },
};
