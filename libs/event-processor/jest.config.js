const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'event-processor',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/lambda-utils$': '<rootDir>/../lambda-utils/src/index.ts',
    '^@nestfolio/lambda-utils/(.*)$': '<rootDir>/../lambda-utils/src/$1',
    '^@nestfolio/platform-core$': '<rootDir>/../platform-core/src/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      diagnostics: false,
    }],
  },
  // p-limit v7+ and yocto-queue are pure ESM — must be transformed by ts-jest
  // Use .* prefix to handle pnpm nested node_modules/.pnpm paths
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
