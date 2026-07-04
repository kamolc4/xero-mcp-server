import type { RequestHandler } from 'express';
import axios from 'axios';
import { getTokenStore, isTokenExpired, getValidAccessToken } from './auth';
import { logger } from './logger';

interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  uptime: number;
  version: string;
  timestamp: string;
  checks: {
    xeroTokenValid: boolean;
    xeroApiReachable: boolean;
    tokenExpiresAt: string | null;
    tenantId: string | null;
  };
}

const startTime = Date.now();

export const healthHandler: RequestHandler = async (_req, res) => {
  const version = process.env['npm_package_version'] ?? '1.0.0';
  const tokenStore = getTokenStore();
  const tokenValid = !isTokenExpired();
  let xeroApiReachable = false;

  if (tokenValid) {
    try {
      const token = await getValidAccessToken();
      await axios.get('https://api.xero.com/connections', {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });
      xeroApiReachable = true;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Xero API health check failed');
    }
  }

  const allOk = tokenValid && xeroApiReachable;
  const status: HealthStatus['status'] = allOk ? 'ok' : tokenStore ? 'degraded' : 'error';

  const body: HealthStatus = {
    status,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version,
    timestamp: new Date().toISOString(),
    checks: {
      xeroTokenValid: tokenValid,
      xeroApiReachable,
      tokenExpiresAt: tokenStore ? new Date(tokenStore.expiresAt).toISOString() : null,
      tenantId: tokenStore?.tenantId ?? null,
    },
  };

  res.status(status === 'error' ? 503 : 200).json(body);
};
