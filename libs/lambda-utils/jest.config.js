const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'lambda-utils',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/platform-core$': '<rootDir>/../platform-core/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      diagnostics: false,
    }],
  },
  coverageThreshold: {
    global: { branches: 90, functions: 90, lines: 90, statements: 90 },
  },
};
