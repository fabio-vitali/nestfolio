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
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: false,
          allow: [
            '@nestfolio/.+-adpt/domain',
            '@nestfolio/event-processor',
            '@nestfolio/agent-core',
          ],
          depConstraints: [
            { sourceTag: 'scope:platform', onlyDependOnLibsWithTags: ['scope:platform'] },
            { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared', 'scope:platform'] },
            { sourceTag: 'scope:domain', onlyDependOnLibsWithTags: ['scope:domain', 'scope:platform'] },
            { sourceTag: 'scope:investor', onlyDependOnLibsWithTags: ['scope:investor', 'scope:platform', 'scope:shared'] },
            { sourceTag: 'scope:advisory', onlyDependOnLibsWithTags: ['scope:advisory', 'scope:platform', 'scope:shared'] },
            { sourceTag: 'scope:execution', onlyDependOnLibsWithTags: ['scope:execution', 'scope:platform', 'scope:shared'] },
            { sourceTag: 'scope:ledger', onlyDependOnLibsWithTags: ['scope:ledger', 'scope:platform', 'scope:shared'] },
            { sourceTag: 'scope:shell', onlyDependOnLibsWithTags: ['scope:shell', 'scope:shared'] },
          ],
        },
      ],
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/tmp/**', '**/*.js', '!eslint.config.js'],
  },
];
