module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
  ],
  settings: { 'import/resolver': { typescript: {}, }, },
  plugins: [
    '@typescript-eslint',
    'import',
  ],
  rules: {
    'import/extensions': ['error', 'ignorePackages', {
      js: 'never',
      mjs: 'never',
      jsx: 'never',
      ts: 'never',
      tsx: 'never',
    }],
    'object-curly-newline': ['error', {
      multiline: true,
      minProperties: 2,
    }],
    'object-curly-spacing': ['error', 'always'],
    'max-len': ['warn', { code: 100 }],
    'no-shadow': 'off',
    'arrow-body-style': 'off',
    '@typescript-eslint/no-unused-vars': 0,
    'no-unused-vars': 0,
    '@typescript-eslint/no-duplicate-enum-values': 'warn',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/member-delimiter-style': ['error', {
      multiline: {
        delimiter: 'comma',
        requireLast: true,
      },
      singleline: {
        delimiter: 'semi',
        requireLast: false,
      },
    }],
    '@typescript-eslint/no-shadow': 'error',
    'import/prefer-default-export': 'off',
    'import/no-extraneous-dependencies': ['error', { devDependencies: ['**/*.test.ts', '**/*.test.tsx'] }],
    'vue/multi-word-component-names': 'off',
  },
  globals: { NodeJS: true },
};
