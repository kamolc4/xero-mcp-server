import type { Request, Response, NextFunction, RequestHandler } from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config';
import { logger } from './logger';

// ─── Token Store ─────────────────────────────────────────────────────────────
// In production replace this with a Redis or database-backed store.
export interface XeroTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix ms
  tenantId: string;
  idToken?: string;
}

let tokenStore: XeroTokenSet | null = null;
let pendingState: string | null = null;

export function getTokenStore(): XeroTokenSet | null {
  return tokenStore;
}

export function isTokenExpired(): boolean {
  if (!tokenStore) return true;
  return Date.now() >= tokenStore.expiresAt - 60_000; // 1-minute buffer
}

export async function refreshAccessToken(): Promise<void> {
  if (!tokenStore) throw new Error('No token stored — authorise first via GET /auth/xero');

  logger.info('Refreshing Xero access token');

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokenStore.refreshToken,
  });

  const credentials = Buffer.from(
    `${config.xero.clientId}:${config.xero.clientSecret}`,
  ).toString('base64');

  const response = await axios.post<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    id_token?: string;
  }>('https://identity.xero.com/connect/token', params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
  });

  tokenStore = {
    ...tokenStore,
    accessToken: response.data.access_token,
    refreshToken: response.data.refresh_token,
    idToken: response.data.id_token,
    expiresAt: Date.now() + response.data.expires_in * 1000,
  };

  logger.info({ expiresAt: new Date(tokenStore.expiresAt).toISOString() }, 'Token refreshed');
}

export async function getValidAccessToken(): Promise<string> {
  if (!tokenStore) throw new Error('Not authorised with Xero — visit GET /auth/xero to begin');
  if (isTokenExpired()) await refreshAccessToken();
  return tokenStore!.accessToken;
}

// ─── OAuth Routes ─────────────────────────────────────────────────────────────

export const startOAuthFlow: RequestHandler = (_req, res) => {
  pendingState = uuidv4();

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.xero.clientId,
    redirect_uri: config.xero.redirectUri,
    scope: config.xero.scopes,
    state: pendingState,
  });

  const authUrl = `https://login.xero.com/identity/connect/authorize?${params.toString()}`;
  logger.info({ authUrl }, 'Redirecting to Xero OAuth');
  res.redirect(authUrl);
};

export const handleOAuthCallback: RequestHandler = async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    logger.error({ error }, 'Xero OAuth error returned');
    res.status(400).json({ error, message: 'Xero returned an OAuth error' });
    return;
  }

  if (!code) {
    res.status(400).json({ message: 'Missing authorization code' });
    return;
  }

  if (state !== pendingState) {
    logger.warn({ received: state, expected: pendingState }, 'OAuth state mismatch');
    res.status(400).json({ message: 'OAuth state parameter mismatch — possible CSRF' });
    return;
  }
  pendingState = null;

  try {
    const credentials = Buffer.from(
      `${config.xero.clientId}:${config.xero.clientSecret}`,
    ).toString('base64');

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.xero.redirectUri,
    });

    const tokenResponse = await axios.post<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      id_token?: string;
    }>('https://identity.xero.com/connect/token', tokenParams.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
    });

    // Fetch connected tenants
    const connectionsResponse = await axios.get<Array<{ tenantId: string; tenantName: string }>>(
      'https://api.xero.com/connections',
      { headers: { Authorization: `Bearer ${tokenResponse.data.access_token}` } },
    );

    const tenant = connectionsResponse.data[0];
    if (!tenant) throw new Error('No Xero tenant connected to this app');

    tokenStore = {
      accessToken: tokenResponse.data.access_token,
      refreshToken: tokenResponse.data.refresh_token,
      idToken: tokenResponse.data.id_token,
      expiresAt: Date.now() + tokenResponse.data.expires_in * 1000,
      tenantId: tenant.tenantId,
    };

    logger.info(
      { tenantId: tenant.tenantId, tenantName: tenant.tenantName },
      'Xero OAuth complete — tokens stored',
    );

    res.json({
      message: 'Xero authorisation successful',
      tenantId: tenant.tenantId,
      tenantName: tenant.tenantName,
      expiresAt: new Date(tokenStore.expiresAt).toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, 'Failed to exchange OAuth code');
    res.status(500).json({ message: 'Token exchange failed', detail: message });
  }
};

export const getAuthStatus: RequestHandler = (_req, res) => {
  if (!tokenStore) {
    res.json({ authorised: false, message: 'No tokens stored — visit GET /auth/xero' });
    return;
  }
  res.json({
    authorised: true,
    expired: isTokenExpired(),
    tenantId: tokenStore.tenantId,
    expiresAt: new Date(tokenStore.expiresAt).toISOString(),
  });
};

// ─── MCP Route Guard ─────────────────────────────────────────────────────────

export const requireApiKey: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const key = req.headers['x-api-key'];
  if (!key || key !== config.mcpApiKey) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing X-API-Key header' });
    return;
  }
  next();
};
