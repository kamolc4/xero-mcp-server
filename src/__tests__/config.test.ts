import { config } from '../config';

describe('config', () => {
  it('loads and validates configuration from environment variables', () => {
    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('test');
    expect(config.mcpApiKey).toBe('test-mcp-api-key-0123456789');
    expect(config.xero.clientId).toBe('test-xero-client-id');
    expect(config.xero.redirectUri).toBe('http://localhost:3000/auth/xero/callback');
  });

  it('applies defaults for rate limiting', () => {
    expect(config.rateLimitWindowMs).toBe(900_000);
    expect(config.rateLimitMax).toBe(100);
  });
});
