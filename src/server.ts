import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { config } from './config';
import { logger } from './logger';
import { healthHandler } from './health';
import {
  requireApiKey,
  startOAuthFlow,
  handleOAuthCallback,
  getAuthStatus,
} from './auth';
import {
  listInvoices,
  createInvoice,
  listContacts,
  getAccount,
  listAccounts,
  createPayment,
} from './xeroClient';

// ─── Express App ──────────────────────────────────────────────────────────────

export const app = express();

app.use(express.json());

// Correlation ID
app.use((req, _res, next) => {
  (req as express.Request & { correlationId: string }).correlationId =
    (req.headers['x-correlation-id'] as string) ?? uuidv4();
  next();
});

// Pino HTTP logging
app.use(
  pinoHttp({
    logger,
    genReqId: (req) =>
      (req as express.Request & { correlationId?: string }).correlationId ?? uuidv4(),
    customLogLevel(_req, res) {
      if (res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  }),
);

// ─── OAuth Routes ─────────────────────────────────────────────────────────────

app.get('/auth/xero', startOAuthFlow);
app.get('/auth/xero/callback', handleOAuthCallback);
app.get('/auth/status', getAuthStatus);

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', healthHandler);

// ─── MCP Server ───────────────────────────────────────────────────────────────

const mcpServer = new McpServer({
  name: 'xero-mcp-server',
  version: '1.0.0',
});

// Tool: xero_list_invoices
mcpServer.tool(
  'xero_list_invoices',
  'List invoices from Xero with optional filtering by status, contact, and page number.',
  {
    status: z
      .enum(['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID', 'VOIDED'])
      .optional()
      .describe('Filter by invoice status'),
    page: z.number().int().positive().optional().default(1).describe('Page number (100 per page)'),
    contactId: z.string().uuid().optional().describe('Filter by Xero Contact UUID'),
  },
  async ({ status, page, contactId }) => {
    try {
      const invoices = await listInvoices({ status, page, contactId });
      const summary = invoices.map((inv) => ({
        id: inv.InvoiceID,
        number: inv.InvoiceNumber ?? '—',
        contact: inv.Contact.Name,
        status: inv.Status,
        total: inv.Total ?? 0,
        amountDue: inv.AmountDue ?? 0,
        currency: inv.CurrencyCode ?? 'USD',
        date: inv.Date ?? null,
        dueDate: inv.DueDate ?? null,
      }));
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ count: invoices.length, invoices: summary }, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// Tool: xero_create_invoice
mcpServer.tool(
  'xero_create_invoice',
  'Create a new invoice (accounts receivable or payable) in Xero.',
  {
    type: z.enum(['ACCREC', 'ACCPAY']).describe('ACCREC = sales invoice, ACCPAY = bill'),
    contactId: z.string().uuid().describe('Xero Contact UUID to bill'),
    lineItems: z
      .array(
        z.object({
          description: z.string().describe('Line item description'),
          quantity: z.number().positive().describe('Quantity'),
          unitAmount: z.number().describe('Price per unit'),
          accountCode: z.string().describe('Xero account code (e.g. 200)'),
          taxType: z.string().optional().describe('Tax type code (e.g. OUTPUT2)'),
        }),
      )
      .min(1)
      .describe('Invoice line items'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Invoice date YYYY-MM-DD'),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Due date YYYY-MM-DD'),
    reference: z.string().optional().describe('Your internal reference number'),
    status: z.enum(['DRAFT', 'AUTHORISED']).optional().default('DRAFT'),
  },
  async ({ type, contactId, lineItems, date, dueDate, reference, status }) => {
    try {
      const invoice = await createInvoice({
        type,
        contactId,
        lineItems: lineItems.map((li) => ({
          Description: li.description,
          Quantity: li.quantity,
          UnitAmount: li.unitAmount,
          AccountCode: li.accountCode,
          ...(li.taxType ? { TaxType: li.taxType } : {}),
        })),
        date,
        dueDate,
        reference,
        status,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                invoiceId: invoice.InvoiceID,
                invoiceNumber: invoice.InvoiceNumber,
                status: invoice.Status,
                total: invoice.Total,
                currency: invoice.CurrencyCode,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// Tool: xero_list_contacts
mcpServer.tool(
  'xero_list_contacts',
  'Search and list contacts (customers and suppliers) in Xero.',
  {
    page: z.number().int().positive().optional().default(1),
    searchTerm: z.string().optional().describe('Fuzzy search on contact name or email'),
    isCustomer: z.boolean().optional().describe('Filter to customer contacts only'),
    isSupplier: z.boolean().optional().describe('Filter to supplier contacts only'),
  },
  async ({ page, searchTerm, isCustomer, isSupplier }) => {
    try {
      const contacts = await listContacts({ page, searchTerm, isCustomer, isSupplier });
      const summary = contacts.map((c) => ({
        id: c.ContactID,
        name: c.Name,
        email: c.EmailAddress ?? null,
        isCustomer: c.IsCustomer,
        isSupplier: c.IsSupplier,
      }));
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ count: contacts.length, contacts: summary }, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// Tool: xero_get_account
mcpServer.tool(
  'xero_get_account',
  'Retrieve a specific chart-of-accounts entry by its Xero account code or UUID.',
  {
    codeOrId: z.string().describe('Xero account code (e.g. "200") or Account UUID'),
  },
  async ({ codeOrId }) => {
    try {
      const account = await getAccount(codeOrId);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(account, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// Tool: xero_list_accounts
mcpServer.tool(
  'xero_list_accounts',
  'List chart-of-accounts entries, optionally filtered by type (BANK, REVENUE, EXPENSE, etc.) and status.',
  {
    type: z
      .enum(['BANK', 'CURRENT', 'CURRLIAB', 'DEPRECIATN', 'DIRECTCOSTS', 'EQUITY', 'EXPENSE',
             'FIXED', 'LIABILITY', 'NONCURRENT', 'OTHERINCOME', 'OVERHEADS', 'PREPAYMENT',
             'REVENUE', 'SALES', 'TERMLIAB', 'PAYGLIABILITY', 'SUPERANNUATIONEXPENSE',
             'SUPERANNUATIONLIABILITY', 'WAGESEXPENSE'])
      .optional()
      .describe('Account type filter'),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional().default('ACTIVE'),
  },
  async ({ type, status }) => {
    try {
      const accounts = await listAccounts({ type, status });
      const summary = accounts.map((a) => ({
        id: a.AccountID,
        code: a.Code,
        name: a.Name,
        type: a.Type,
        class: a.Class ?? null,
        status: a.Status,
      }));
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ count: accounts.length, accounts: summary }, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// Tool: xero_create_payment
mcpServer.tool(
  'xero_create_payment',
  'Record a payment against an authorised Xero invoice, reducing the amount due.',
  {
    invoiceId: z.string().uuid().describe('UUID of the invoice to pay'),
    accountId: z.string().uuid().describe('UUID of the bank account to pay from'),
    amount: z.number().positive().describe('Payment amount'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Payment date YYYY-MM-DD'),
    reference: z.string().optional().describe('Payment reference / memo'),
  },
  async ({ invoiceId, accountId, amount, date, reference }) => {
    try {
      const payment = await createPayment({ invoiceId, accountId, amount, date, reference });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                paymentId: payment.PaymentID,
                invoiceId: payment.Invoice.InvoiceID,
                invoiceNumber: payment.Invoice.InvoiceNumber ?? null,
                amount: payment.Amount,
                date: payment.Date,
                status: payment.Status ?? null,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// ─── MCP HTTP Route ───────────────────────────────────────────────────────────

const mcpLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too Many Requests', message: 'Rate limit exceeded' },
});

app.post('/mcp', mcpLimiter, requireApiKey, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: uuidv4 });
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// ─── 404 ──────────────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        env: config.nodeEnv,
        oauthStart: `${config.serverBaseUrl}/auth/xero`,
      },
      'Xero MCP server started',
    );
  });
}
