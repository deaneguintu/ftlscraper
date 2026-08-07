// Domain-level data operations, built on top of db.js.

import { db } from './db.js';
import { uid, todayISO, nextInvoiceNumber } from './models.js';

const DEFAULT_SETTINGS = {
  key: 'business',
  businessName: 'Your Business Name',
  email: '',
  phone: '',
  address: '',
  defaultCurrency: 'USD',
  defaultTaxRate: 0,
  invoicePrefix: 'INV-',
  invoiceCounter: 1,
  paymentTerms: 'Payment due within 14 days.',
};

export async function getSettings() {
  const existing = await db.get('settings', 'business');
  return existing ? { ...DEFAULT_SETTINGS, ...existing } : { ...DEFAULT_SETTINGS };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const updated = { ...current, ...patch, key: 'business' };
  await db.put('settings', updated);
  return updated;
}

export async function listClients() {
  const clients = await db.getAll('clients');
  return clients.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getClient(id) {
  return db.get('clients', id);
}

export async function saveClient(client) {
  const now = new Date().toISOString();
  const record = {
    id: client.id || uid(),
    name: client.name || '',
    email: client.email || '',
    phone: client.phone || '',
    address: client.address || '',
    notes: client.notes || '',
    createdAt: client.createdAt || now,
    updatedAt: now,
  };
  await db.put('clients', record);
  return record;
}

export async function deleteClient(id) {
  return db.delete('clients', id);
}

export async function listInvoices() {
  const invoices = await db.getAll('invoices');
  return invoices.sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''));
}

export async function getInvoice(id) {
  return db.get('invoices', id);
}

export async function saveInvoice(invoice) {
  const now = new Date().toISOString();
  const record = {
    id: invoice.id || uid(),
    number: invoice.number,
    clientId: invoice.clientId || null,
    status: invoice.status || 'draft',
    issueDate: invoice.issueDate || todayISO(),
    dueDate: invoice.dueDate || '',
    currency: invoice.currency || 'USD',
    lineItems: invoice.lineItems || [],
    discount: invoice.discount || { type: 'flat', value: 0 },
    taxRate: invoice.taxRate ?? 0,
    notes: invoice.notes || '',
    createdAt: invoice.createdAt || now,
    updatedAt: now,
  };
  await db.put('invoices', record);
  return record;
}

export async function deleteInvoice(id) {
  return db.delete('invoices', id);
}

export async function reserveNextInvoiceNumber() {
  const settings = await getSettings();
  const invoices = await listInvoices();
  const { number, nextCounter } = nextInvoiceNumber(settings, invoices);
  await saveSettings({ invoiceCounter: nextCounter });
  return number;
}

export async function exportAllData() {
  const [clients, invoices, settings] = await Promise.all([
    listClients(),
    listInvoices(),
    getSettings(),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    clients,
    invoices,
    settings,
  };
}

export async function importAllData(payload, { replace = false } = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid backup file');
  }
  if (replace) {
    await Promise.all([db.clear('clients'), db.clear('invoices')]);
  }
  for (const client of payload.clients || []) {
    await db.put('clients', client);
  }
  for (const invoice of payload.invoices || []) {
    await db.put('invoices', invoice);
  }
  if (payload.settings) {
    await saveSettings(payload.settings);
  }
}
