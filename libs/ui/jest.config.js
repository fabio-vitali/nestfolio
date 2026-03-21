const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'ui',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/test/test-setup.ts'],
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
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$|primeng|@primeng)'],
};
