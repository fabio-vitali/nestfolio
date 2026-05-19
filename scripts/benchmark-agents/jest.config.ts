const basePreset = require('../../jest.preset.js');

module.exports = {
  ...basePreset,
  displayName: 'benchmark-agents',
  rootDir: '.',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  testMatch: ['<rootDir>/**/*.test.ts'],
};
