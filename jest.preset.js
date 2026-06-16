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
const path = require('node:path');
const os = require('node:os');
const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig.base.json');

const preset = {
  cacheDirectory: path.join(os.tmpdir(), 'jest-nestfolio'),
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  testEnvironment: 'node',
  // Generic @nestfolio/* alias resolution for all backend projects. Absolute prefix
  // (__dirname = workspace root) makes the mappings depth-independent, so every project
  // extending this preset resolves every @nestfolio/* alias to its src without a
  // per-project moduleNameMapper entry. Per-project configs may still override specific
  // keys by spreading `...preset.moduleNameMapper` and adding their own entries AFTER it.
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, {
    prefix: `${__dirname}/`,
  }),
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
