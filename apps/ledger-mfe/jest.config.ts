export default {
  displayName: 'ledger-mfe',
  preset: '../../jest.preset.js',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/test/test-setup.ts'],
  coverageDirectory: '../../coverage/apps/ledger-mfe',
  moduleNameMapper: {
    '^@nestfolio/appsync-client$': '<rootDir>/../../libs/appsync-client/src/index.ts',
    '^@nestfolio/shared-state$': '<rootDir>/../../libs/shared-state/src/index.ts',
    '^@nestfolio/shared-state/testing$': '<rootDir>/../../libs/shared-state/test/testing/index.ts',
    '^@nestfolio/auth$': '<rootDir>/../../libs/auth/src/index.ts',
    '^@nestfolio/i18n$': '<rootDir>/../../libs/i18n/src/index.ts',
    '^@nestfolio/ui-components$': '<rootDir>/../../libs/ui-components/src/index.ts',
  },
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$|primeng|@primeng|@ngrx|@ngx-translate|.*uuid)'],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
