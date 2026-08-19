import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  setupFiles: ['<rootDir>/tests/preload-env.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  verbose: true,
  moduleNameMapper: {
    '^src/database/data-source$': '<rootDir>/src/database/data-source.test.ts',
  },
};

export default config;