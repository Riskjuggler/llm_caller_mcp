module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
    jest: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json']
  },
  plugins: ['@typescript-eslint'],
  extends: ['standard-with-typescript'],
  rules: {
    '@typescript-eslint/consistent-type-definitions': 'off',
    '@typescript-eslint/strict-boolean-expressions': 'off'
  }
};
