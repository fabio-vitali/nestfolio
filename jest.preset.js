/**
 * Jest preset — shared by all projects
 *
 * Conventions:
 *   Test naming:  Backend = .test.ts | Frontend = .spec.ts | Libs = .test.ts (backend-oriented)
 *   Environment:  Backend services = 'node' | Frontend apps/libs = 'jsdom'
 *   Paths:        Services use <rootDir>/../../libs/… | Apps use <rootDir>/../../../libs/…
 *                 (moduleNameMapper overrides are per-project due to different relative depths)
 *   Transform:    Backend uses ts-jest | Frontend uses jest-preset-angular
 *   Ignore:       Frontend needs transformIgnorePatterns for ESM packages (primeng, ngrx, ngx-translate)
 *
 * @type {import('jest').Config}
 */
// Sanitize TMPDIR before jest computes its haste-map cacheDirectory and
// before any tool that defaults to os.tmpdir() (CDK, tsx, etc.). Belt to
// the .npmrc node-options braces; this file is evaluated by nx-console's
// direct jest invocations too, which bypass .npmrc.
require('./tools/safe-tmpdir.cjs');
const path = require('node:path');
const os = require('node:os');

const preset = {
  cacheDirectory: path.join(os.tmpdir(), 'jest-nestfolio'),
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  testEnvironment: 'node',
  maxWorkers: '50%',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/index.ts',
    '!src/**/main.ts',
    '!src/**/*.stack.ts',
    '!src/**/*.stage.ts',
    '!src/**/constructs/**',
  ],
  coverageThreshold: {
    global: { branches: 80, functions: 80, lines: 80, statements: 80 },
  },
};

module.exports = preset;
