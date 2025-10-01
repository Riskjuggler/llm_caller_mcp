module.exports = {
  preset: 'ts-jest/presets/default-esm',
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\.{1,2}/.*)\.js$': '$1'
  },
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { useESM: true, tsconfig: './tsconfig.json' }]
  }
};
