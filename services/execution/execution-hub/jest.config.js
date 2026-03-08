const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'execution-hub',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
  },
};
