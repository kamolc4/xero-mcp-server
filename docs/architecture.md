# Xero MCP Server Architecture

```mermaid
flowchart LR
  A[Claude Desktop / Cursor / MCP Client] -->|HTTP POST /mcp + X-API-Key| B[Express MCP Server]
  B --> C[API Key Guard]
  C --> D[Rate Limit Middleware]
  D --> E[MCP Tool Registry]
  E --> F[Xero Client]
  F -->|Bearer token + xero-tenant-id| G[Xero Accounting API]

  H[Browser] -->|GET /auth/xero| I[Xero OAuth Flow]
  I --> J[Token Store]
  J --> F

  K[Monitoring] -->|GET /health| L[Health Handler]
  L --> J
  L --> G

  M[MCPForge Verify] -->|Server review| B
```

## Main components

- `src/server.ts` — Express app, MCP server, tool registration, `/mcp` route.
- `src/auth.ts` — Xero OAuth flow, token refresh, API key middleware.
- `src/config.ts` — environment validation with Zod.
- `src/health.ts` — health endpoint and Xero connectivity check.
- `src/xeroClient.ts` — typed Xero API wrapper used by MCP tools.
- `src/__tests__` — Jest tests for config, health, auth guard, and rate limiting.
