const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'cdk-constructs',
  testEnvironment: 'node',
};
