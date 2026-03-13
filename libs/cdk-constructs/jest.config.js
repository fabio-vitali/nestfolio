const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'cdk-constructs',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/lambda-utils$': '<rootDir>/../lambda-utils/src/index.ts',
    '^@nestfolio/platform-core$': '<rootDir>/../platform-core/src/index.ts',
    '^@nestfolio/domain-core$': '<rootDir>/../domain-core/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      diagnostics: false,
    }],
  },
};
