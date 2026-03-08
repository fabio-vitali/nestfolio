const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'investor-web',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/lambda-utils$': '<rootDir>/../../../libs/lambda-utils/src/index.ts',
  },
};
