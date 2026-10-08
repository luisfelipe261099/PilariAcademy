/** Suíte de integração: MySQL 8 real (mysql-memory-server) + app Nest com Host header. */
module.exports = {
  rootDir: '../..',
  testRegex: 'test/integration/.*\\.int-spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/test/integration/tsconfig.json' }] },
  testEnvironment: 'node',
  moduleNameMapper: { '^@pilari/(.*)$': '<rootDir>/src/__mocks__/@pilari/types.ts' },
  globalSetup: '<rootDir>/test/integration/global-setup.js',
  globalTeardown: '<rootDir>/test/integration/global-teardown.js',
  testTimeout: 120000,
}
