const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const prettierConfig = require('eslint-config-prettier');
const nxPlugin = require('@nx/eslint-plugin');

module.exports = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    plugins: {
      '@nx': nxPlugin,
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      'no-console': 'error',
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: false,
          // The typed-fixture registry (`test-contracts`) composes producer-owned zod
          // contracts so test-support's typed `putEvent` can validate fixture subjects.
          // This forms a TEST-ONLY cycle: a producer service's *tests* import test-support
          // → test-contracts → that producer's `/contracts` (and producers reference each
          // other, e.g. decision-workflow-ctrl reads compliance-ctrl's ComplianceCheck back).
          // The production graph is acyclic — test-support/test-contracts are never bundled
          // into any Lambda. Every such cycle routes through a `test-contracts -> <producer>`
          // edge, so ignoring any cycle that involves test-contracts clears the benign test
          // cycle for this and every future typed-fixtures phase (as more producers join the
          // registry) without suppressing real production cycles.
          ignoredCircularDependencies: [['test-contracts', '*']],
          allow: [
            '@nestfolio/.+/events',
            '@nestfolio/.+/contracts',
            '@nestfolio/.+/agent-budgets',
            '@nestfolio/.+-adpt/domain',
            '@nestfolio/event-processor',
            '@nestfolio/e2e-feature-tests',
          ],
          depConstraints: [
            { sourceTag: 'scope:platform', onlyDependOnLibsWithTags: ['scope:platform'] },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:platform'],
            },
            {
              sourceTag: 'scope:domain',
              onlyDependOnLibsWithTags: ['scope:domain', 'scope:platform'],
            },
            {
              sourceTag: 'scope:investor',
              onlyDependOnLibsWithTags: ['scope:investor', 'scope:platform', 'scope:shared'],
            },
            {
              sourceTag: 'scope:onboarding',
              onlyDependOnLibsWithTags: ['scope:onboarding', 'scope:platform', 'scope:shared'],
            },
            {
              sourceTag: 'scope:advisory',
              onlyDependOnLibsWithTags: ['scope:advisory', 'scope:platform', 'scope:shared'],
            },
            {
              sourceTag: 'scope:execution',
              onlyDependOnLibsWithTags: ['scope:execution', 'scope:platform', 'scope:shared'],
            },
            {
              sourceTag: 'scope:ledger',
              onlyDependOnLibsWithTags: ['scope:ledger', 'scope:platform', 'scope:shared'],
            },
            { sourceTag: 'scope:shell', onlyDependOnLibsWithTags: ['scope:shell', 'scope:shared'] },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/tmp/**',
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
      '!eslint.config.js',
      '**/vitest.config.*.timestamp*',
    ],
  },
];
