const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'shell',
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
        diagnostics: false,
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$|@ngrx|@ngx-translate)'],
  moduleNameMapper: {
    '^@nestfolio/shell/testing$': '<rootDir>/test/testing/index.ts',
    '^@nestfolio/shell/auth$': '<rootDir>/src/auth/index.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/test/test-setup.ts'],
};
