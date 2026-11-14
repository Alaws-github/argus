// ESLint configuration for the whole repository (flat config, ESLint 9).
// It applies the maintainers' own recommended rule sets: @eslint/js for
// JavaScript, typescript-eslint for TypeScript and eslint-plugin-vue's
// "recommended" set, which follows the official Vue style guide (priority A,
// B and C rules). eslint-config-prettier comes last so ESLint never argues
// with Prettier about layout. See docs/CODING-STANDARDS.md for the reasons.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'data/**',
      'data-backups/**',
      'demos/**',
      'docs/**',
      '_to_delete/**', // old files waiting for the owner to delete
      'deploy/cloudflare/.wrangler/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],

  // Server, shared package and scripts run on Node.
  {
    files: [
      'apps/server/**/*.ts',
      'packages/**/*.ts',
      'scripts/**/*.{js,mjs,cjs}',
      '*.{js,mjs,cjs}',
      'deploy/**/*.{ts,js,mjs}',
    ],
    languageOptions: { globals: { ...globals.node } },
  },

  // The web app runs in the browser; .vue files are parsed with the TypeScript parser inside <script setup lang="ts">.
  {
    files: ['apps/web/**/*.{ts,vue}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'], sourceType: 'module' },
    },
  },

  // typescript-eslint's own advice: TypeScript already checks for undefined names, so ESLint's no-undef is
  // switched off for .ts and .vue files (it can't see declarations like the build-time globals in env.d.ts).
  {
    files: ['**/*.ts', '**/*.vue'],
    rules: { 'no-undef': 'off' },
  },

  // Project rules on top of the recommended sets.
  {
    rules: {
      // Unused code is noise for the next reader. A leading underscore marks an argument kept on purpose.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
      // `any` hides what a value is. Warned, not refused, while existing uses are replaced with real types.
      '@typescript-eslint/no-explicit-any': 'warn',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': 'off',
    },
  },

  // CommonJS scripts (the mock model server) use require.
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  prettier,
);
