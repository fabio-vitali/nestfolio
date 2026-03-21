const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'appsync-client',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/shell$': '<rootDir>/../shell/src/index.ts',
  },
};
