const preset = require('../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'test-support',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
};
