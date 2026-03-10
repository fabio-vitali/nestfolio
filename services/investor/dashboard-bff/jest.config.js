const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'dashboard-bff',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/platform-core$': '<rootDir>/../../../libs/platform-core/src/index.ts',
    '^@nestfolio/platform-core/(.*)$': '<rootDir>/../../../libs/platform-core/src/$1',
    '^@nestfolio/domain-core$': '<rootDir>/../../../libs/domain-core/src/index.ts',
    '^@nestfolio/domain-core/(.*)$': '<rootDir>/../../../libs/domain-core/src/$1',
    '^@nestfolio/lambda-utils$': '<rootDir>/../../../libs/lambda-utils/src/index.ts',
    '^@nestfolio/lambda-utils/(.*)$': '<rootDir>/../../../libs/lambda-utils/src/$1',
    '^@nestfolio/command-core$': '<rootDir>/../../../libs/command-core/src/index.ts',
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
  },
};
