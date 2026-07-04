import request from 'supertest';
import { app } from '../server';

describe('server routes', () => {
  it('returns 503 from /health when Xero is not authorised', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      status: 'error',
      checks: {
        xeroTokenValid: false,
        xeroApiReachable: false,
        tokenExpiresAt: null,
        tenantId: null,
      },
    });
    expect(typeof response.body.uptime).toBe('number');
    expect(typeof response.body.timestamp).toBe('string');
  });

  it('rejects /mcp requests without an API key', async () => {
    const response = await request(app).post('/mcp').send({ jsonrpc: '2.0' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: 'Unauthorized',
      message: 'Invalid or missing X-API-Key header',
    });
  });

  it('rejects /mcp requests with an invalid API key', async () => {
    const response = await request(app)
      .post('/mcp')
      .set('X-API-Key', 'wrong-api-key')
      .send({ jsonrpc: '2.0' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: 'Unauthorized',
      message: 'Invalid or missing X-API-Key header',
    });
  });

  it('applies rate limiting to /mcp requests', async () => {
    const responses = await Promise.all(
      Array.from({ length: 110 }, () => request(app).post('/mcp').send({ jsonrpc: '2.0' })),
    );

    expect(responses.some((response) => response.status === 429)).toBe(true);
  });
});
