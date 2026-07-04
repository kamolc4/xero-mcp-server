import pino from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.logLevel,
  base: {
    service: 'xero-mcp-server',
    version: process.env['npm_package_version'] ?? '1.0.0',
    env: config.nodeEnv,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  ...(config.nodeEnv === 'development'
    ? {
        transport: {
          target: 'pino/file',
          options: { destination: 1 },
        },
      }
    : {}),
});

export function createRequestLogger(correlationId: string) {
  return logger.child({ correlationId });
}
