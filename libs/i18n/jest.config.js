const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'i18n',
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
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$|@ngx-translate|@ngrx)'],
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
};
