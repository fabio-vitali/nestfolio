const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'event-types',
  testEnvironment: 'node',
  moduleNameMapper: {},
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      diagnostics: false,
    }],
  },
};
