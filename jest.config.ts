import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.spec.ts'],
  transform: {
    '^.+\.tsx?$': ['ts-jest', { tsconfig: { strict: true, esModuleInterop: true } }],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/__tests__/**',
  ],
  coverageReporters: ['text', 'lcov'],
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
};

export default config;
