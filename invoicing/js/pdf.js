// "PDF export" via the browser's native print-to-PDF — no library, works offline.

import { calcTotals, formatCurrency, formatDate, lineItemTotal } from './models.js';

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

export function printInvoice(invoice, client, settings) {
  const totals = calcTotals(invoice);
  const root = document.getElementById('print-root');

  const rows = (invoice.lineItems || [])
    .map(
      (li) => `
        <tr>
          <td>${esc(li.description)}</td>
          <td>${li.quantity}</td>
          <td>${formatCurrency(li.unitPrice, invoice.currency)}</td>
          <td>${formatCurrency(lineItemTotal(li), invoice.currency)}</td>
        </tr>`
    )
    .join('');

  root.innerHTML = `
    <div class="invoice-print">
      <div class="top">
        <div>
          <h1>Invoice ${esc(invoice.number)}</h1>
          <div>${esc(settings.businessName)}</div>
          ${settings.email ? `<div>${esc(settings.email)}</div>` : ''}
          ${settings.address ? `<div>${esc(settings.address)}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div><strong>Issued:</strong> ${formatDate(invoice.issueDate)}</div>
          ${invoice.dueDate ? `<div><strong>Due:</strong> ${formatDate(invoice.dueDate)}</div>` : ''}
          <div style="margin-top:10px"><strong>Bill to:</strong></div>
          <div>${esc(client ? client.name : 'No client')}</div>
          ${client && client.email ? `<div>${esc(client.email)}</div>` : ''}
          ${client && client.address ? `<div>${esc(client.address)}</div>` : ''}
        </div>
      </div>

      <table>
        <thead>
          <tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="totals">
        <div class="totals-row"><span>Subtotal</span><span>${formatCurrency(totals.subtotal, invoice.currency)}</span></div>
        ${totals.discountAmount ? `<div class="totals-row"><span>Discount</span><span>-${formatCurrency(totals.discountAmount, invoice.currency)}</span></div>` : ''}
        ${invoice.taxRate ? `<div class="totals-row"><span>Tax (${invoice.taxRate}%)</span><span>${formatCurrency(totals.taxAmount, invoice.currency)}</span></div>` : ''}
        <div class="totals-row grand"><span>Total</span><span>${formatCurrency(totals.total, invoice.currency)}</span></div>
      </div>

      ${invoice.notes ? `<div style="margin-top:30px"><strong>Notes</strong><p>${esc(invoice.notes)}</p></div>` : ''}
      ${settings.paymentTerms ? `<p class="muted">${esc(settings.paymentTerms)}</p>` : ''}
    </div>
  `;

  window.print();
}
