const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'test-contracts',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: false }],
  },
};
