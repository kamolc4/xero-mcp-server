/**
 * Global Jest setup file.
 *
 * Runs once per test file, BEFORE the test framework and any test modules
 * are loaded (see jest.config.ts -> setupFiles).
 *
 * src/config.ts calls loadConfig() at import time and throws if required
 * env vars are missing, so every var it validates must be defined here —
 * otherwise importing anything that transitively pulls in ./config
 * (auth, xeroClient, health, server) blows up before a single test runs.
 */

process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '3000';
process.env['LOG_LEVEL'] = 'error';
process.env['SERVER_BASE_URL'] = 'http://localhost:3000';

process.env['MCP_API_KEY'] = 'test-mcp-api-key-0123456789';

process.env['XERO_CLIENT_ID'] = 'test-xero-client-id';
process.env['XERO_CLIENT_SECRET'] = 'test-xero-client-secret';
process.env['XERO_REDIRECT_URI'] = 'http://localhost:3000/auth/xero/callback';
process.env['XERO_SCOPES'] =
  'openid profile email accounting.transactions accounting.contacts accounting.settings offline_access';

process.env['RATE_LIMIT_WINDOW_MS'] = '900000';
process.env['RATE_LIMIT_MAX'] = '100';
