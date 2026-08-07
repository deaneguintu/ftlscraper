// Pure functions: invoice math, formatting, id generation.
// No DOM, no storage — safe to unit-test in isolation.

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const STATUSES = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];

export function emptyLineItem() {
  return { id: uid(), description: '', quantity: 1, unitPrice: 0 };
}

export function lineItemTotal(item) {
  const qty = Number(item.quantity) || 0;
  const price = Number(item.unitPrice) || 0;
  return qty * price;
}

export function calcTotals(invoice) {
  const subtotal = (invoice.lineItems || []).reduce((sum, li) => sum + lineItemTotal(li), 0);

  const discount = invoice.discount || { type: 'flat', value: 0 };
  const discountValue = Number(discount.value) || 0;
  const discountAmount = discount.type === 'percent'
    ? subtotal * (discountValue / 100)
    : discountValue;
  const afterDiscount = Math.max(0, subtotal - discountAmount);

  const taxRate = Number(invoice.taxRate) || 0;
  const taxAmount = afterDiscount * (taxRate / 100);

  const total = afterDiscount + taxAmount;

  return {
    subtotal,
    discountAmount,
    taxAmount,
    total,
  };
}

export function formatCurrency(amount, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount || 0);
  } catch {
    return `${(amount || 0).toFixed(2)} ${currency}`;
  }
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function todayISO() {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
}

export function addDaysISO(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
}

export function nextInvoiceNumber(settings, existingInvoices) {
  const prefix = settings.invoicePrefix || 'INV-';
  const used = new Set(existingInvoices.map((i) => i.number));
  let n = settings.invoiceCounter || 1;
  let candidate;
  do {
    candidate = `${prefix}${String(n).padStart(4, '0')}`;
    n += 1;
  } while (used.has(candidate));
  return { number: candidate, nextCounter: n };
}

export function isOverdue(invoice) {
  if (invoice.status !== 'sent') return false;
  if (!invoice.dueDate) return false;
  return invoice.dueDate < todayISO();
}

export function effectiveStatus(invoice) {
  return isOverdue(invoice) ? 'overdue' : invoice.status;
}
