const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'platform-core',
  testEnvironment: 'node',
  coverageThreshold: {
    global: { branches: 90, functions: 90, lines: 90, statements: 90 },
  },
};
