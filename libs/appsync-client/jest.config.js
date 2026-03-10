const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'appsync-client',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/shared-state$': '<rootDir>/../shared-state/src/index.ts',
  },
};
