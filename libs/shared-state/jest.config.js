const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'shared-state',
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
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$|@ngrx)'],
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
};
