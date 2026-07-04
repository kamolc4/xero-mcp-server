import { z } from 'zod';

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  serverBaseUrl: z.string().url().default('http://localhost:3000'),

  mcpApiKey: z.string().min(8, 'MCP_API_KEY must be at least 8 characters'),

  xero: z.object({
    clientId: z.string().min(1, 'XERO_CLIENT_ID is required'),
    clientSecret: z.string().min(1, 'XERO_CLIENT_SECRET is required'),
    redirectUri: z.string().url('XERO_REDIRECT_URI must be a valid URL'),
    scopes: z.string().default(
      'openid profile email accounting.transactions accounting.contacts accounting.settings offline_access',
    ),
  }),

  rateLimitWindowMs: z.coerce.number().int().positive().default(900_000),
  rateLimitMax: z.coerce.number().int().positive().default(100),
});

export type AppConfig = z.infer<typeof configSchema>;

function loadConfig(): AppConfig {
  const result = configSchema.safeParse({
    port: process.env['PORT'],
    nodeEnv: process.env['NODE_ENV'],
    logLevel: process.env['LOG_LEVEL'],
    serverBaseUrl: process.env['SERVER_BASE_URL'],
    mcpApiKey: process.env['MCP_API_KEY'],
    xero: {
      clientId: process.env['XERO_CLIENT_ID'],
      clientSecret: process.env['XERO_CLIENT_SECRET'],
      redirectUri: process.env['XERO_REDIRECT_URI'],
      scopes: process.env['XERO_SCOPES'],
    },
    rateLimitWindowMs: process.env['RATE_LIMIT_WINDOW_MS'],
    rateLimitMax: process.env['RATE_LIMIT_MAX'],
  });

  if (!result.success) {
    const messages = result.error.errors.map((e) => `  ${e.path.join('.')}: ${e.message}`);
    throw new Error(`Configuration validation failed:\n${messages.join('\n')}`);
  }

  return result.data;
}

export const config = loadConfig();
