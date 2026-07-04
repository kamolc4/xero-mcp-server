import axios, { type AxiosInstance } from 'axios';
import { getValidAccessToken, getTokenStore } from './auth';
import { logger } from './logger';

// ─── Xero API Types ───────────────────────────────────────────────────────────

export interface XeroContact {
  ContactID: string;
  Name: string;
  EmailAddress?: string;
  IsSupplier: boolean;
  IsCustomer: boolean;
  UpdatedDateUTC?: string;
}

export interface XeroLineItem {
  Description: string;
  Quantity: number;
  UnitAmount: number;
  AccountCode: string;
  TaxType?: string;
}

export interface XeroInvoice {
  InvoiceID: string;
  Type: 'ACCREC' | 'ACCPAY';
  Status: 'DRAFT' | 'SUBMITTED' | 'AUTHORISED' | 'PAID' | 'VOIDED';
  InvoiceNumber?: string;
  Contact: { ContactID: string; Name: string };
  LineItems: XeroLineItem[];
  Date?: string;
  DueDate?: string;
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  AmountDue?: number;
  CurrencyCode?: string;
}

export interface XeroAccount {
  AccountID: string;
  Code: string;
  Name: string;
  Type: string;
  Status: string;
  Description?: string;
  Class?: string;
  SystemAccount?: string;
  EnablePaymentsToAccount?: boolean;
  BankAccountNumber?: string;
  CurrencyCode?: string;
}

export interface XeroPayment {
  PaymentID: string;
  Invoice: { InvoiceID: string; InvoiceNumber?: string };
  Account: { AccountID: string; Code?: string };
  Amount: number;
  Date: string;
  Status?: string;
}

// ─── Client Factory ───────────────────────────────────────────────────────────

async function createXeroAxios(): Promise<AxiosInstance> {
  const token = await getValidAccessToken();
  const store = getTokenStore()!;

  return axios.create({
    baseURL: 'https://api.xero.com/api.xro/2.0',
    headers: {
      Authorization: `Bearer ${token}`,
      'xero-tenant-id': store.tenantId,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
}

function xeroErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data as { Message?: string; Elements?: unknown[] } | undefined;
    return detail?.Message ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export async function listInvoices(params: {
  status?: string;
  page?: number;
  contactId?: string;
}): Promise<XeroInvoice[]> {
  const client = await createXeroAxios();
  const query: Record<string, string> = {};
  if (params.status) query['Statuses'] = params.status.toUpperCase();
  if (params.page) query['page'] = String(params.page);
  if (params.contactId) query['ContactIDs'] = params.contactId;

  try {
    const response = await client.get<{ Invoices: XeroInvoice[] }>('/Invoices', { params: query });
    logger.debug({ count: response.data.Invoices.length }, 'Fetched invoices');
    return response.data.Invoices;
  } catch (err) {
    throw new Error(`Xero listInvoices failed: ${xeroErrorMessage(err)}`);
  }
}

export async function createInvoice(payload: {
  type: 'ACCREC' | 'ACCPAY';
  contactId: string;
  lineItems: XeroLineItem[];
  date?: string;
  dueDate?: string;
  reference?: string;
  status?: 'DRAFT' | 'AUTHORISED';
}): Promise<XeroInvoice> {
  const client = await createXeroAxios();
  const body: Record<string, unknown> = {
    Type: payload.type,
    Contact: { ContactID: payload.contactId },
    LineItems: payload.lineItems,
    Status: payload.status ?? 'DRAFT',
  };
  if (payload.date) body['Date'] = payload.date;
  if (payload.dueDate) body['DueDate'] = payload.dueDate;
  if (payload.reference) body['Reference'] = payload.reference;

  try {
    const response = await client.post<{ Invoices: XeroInvoice[] }>('/Invoices', body);
    logger.info({ invoiceId: response.data.Invoices[0]?.InvoiceID }, 'Created invoice');
    return response.data.Invoices[0]!;
  } catch (err) {
    throw new Error(`Xero createInvoice failed: ${xeroErrorMessage(err)}`);
  }
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

export async function listContacts(params: {
  page?: number;
  searchTerm?: string;
  isCustomer?: boolean;
  isSupplier?: boolean;
}): Promise<XeroContact[]> {
  const client = await createXeroAxios();
  const query: Record<string, string> = {};
  if (params.page) query['page'] = String(params.page);
  if (params.searchTerm) query['searchTerm'] = params.searchTerm;
  if (params.isCustomer !== undefined) query['IsCustomer'] = String(params.isCustomer);
  if (params.isSupplier !== undefined) query['IsSupplier'] = String(params.isSupplier);

  try {
    const response = await client.get<{ Contacts: XeroContact[] }>('/Contacts', { params: query });
    logger.debug({ count: response.data.Contacts.length }, 'Fetched contacts');
    return response.data.Contacts;
  } catch (err) {
    throw new Error(`Xero listContacts failed: ${xeroErrorMessage(err)}`);
  }
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

export async function getAccount(codeOrId: string): Promise<XeroAccount> {
  const client = await createXeroAxios();
  try {
    const response = await client.get<{ Accounts: XeroAccount[] }>(`/Accounts/${codeOrId}`);
    const account = response.data.Accounts[0];
    if (!account) throw new Error(`Account ${codeOrId} not found`);
    return account;
  } catch (err) {
    throw new Error(`Xero getAccount failed: ${xeroErrorMessage(err)}`);
  }
}

export async function listAccounts(params: {
  type?: string;
  status?: string;
}): Promise<XeroAccount[]> {
  const client = await createXeroAxios();
  const where: string[] = [];
  if (params.type) where.push(`Type=="${params.type.toUpperCase()}"`);
  if (params.status) where.push(`Status=="${params.status.toUpperCase()}"`);
  const query: Record<string, string> = {};
  if (where.length) query['where'] = where.join(' AND ');

  try {
    const response = await client.get<{ Accounts: XeroAccount[] }>('/Accounts', { params: query });
    return response.data.Accounts;
  } catch (err) {
    throw new Error(`Xero listAccounts failed: ${xeroErrorMessage(err)}`);
  }
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export async function createPayment(payload: {
  invoiceId: string;
  accountId: string;
  amount: number;
  date: string;
  reference?: string;
}): Promise<XeroPayment> {
  const client = await createXeroAxios();
  const body: Record<string, unknown> = {
    Invoice: { InvoiceID: payload.invoiceId },
    Account: { AccountID: payload.accountId },
    Amount: payload.amount,
    Date: payload.date,
  };
  if (payload.reference) body['Reference'] = payload.reference;

  try {
    const response = await client.post<{ Payments: XeroPayment[] }>('/Payments', body);
    logger.info({ paymentId: response.data.Payments[0]?.PaymentID }, 'Created payment');
    return response.data.Payments[0]!;
  } catch (err) {
    throw new Error(`Xero createPayment failed: ${xeroErrorMessage(err)}`);
  }
}
