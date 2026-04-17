export default {
  displayName: 'investor-mfe',
  preset: '../../jest.preset.js',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/test/test-setup.ts'],
  coverageDirectory: '../../coverage/apps/investor-mfe',
  moduleNameMapper: {
    '^@nestfolio/shell$': '<rootDir>/../../libs/shell/src/index.ts',
    '^@nestfolio/shell/testing$': '<rootDir>/../../libs/shell/test/testing/index.ts',
    '^@nestfolio/shell/(.+)$': '<rootDir>/../../libs/shell/src/$1/index.ts',
    '^@nestfolio/ui$': '<rootDir>/../../libs/ui/src/index.ts',
    '^@nestfolio/ui/feature-flags$': '<rootDir>/../../libs/ui/feature-flags/src/index.ts',
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
