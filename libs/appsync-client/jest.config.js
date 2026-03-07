const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'appsync-client',
  testEnvironment: 'node',
};
