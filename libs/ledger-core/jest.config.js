const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'ledger-core',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/command-core$': '<rootDir>/../command-core/src/index.ts',
    '^@nestfolio/command-core/(.*)$': '<rootDir>/../command-core/src/$1',
    '^@nestfolio/event-processor$': '<rootDir>/../event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../event-processor/src/$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      diagnostics: false,
    }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
  coverageThreshold: {
    global: { branches: 90, functions: 90, lines: 90, statements: 90 },
  },
};
