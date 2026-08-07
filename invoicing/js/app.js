import { route, startRouter, navigate } from './router.js';
import {
  listClients, getClient, saveClient, deleteClient,
  listInvoices, getInvoice, saveInvoice, deleteInvoice,
  getSettings, saveSettings, reserveNextInvoiceNumber,
  exportAllData, importAllData,
} from './store.js';
import {
  emptyLineItem, lineItemTotal, calcTotals, formatCurrency, formatDate,
  todayISO, addDaysISO, STATUSES, effectiveStatus, uid,
} from './models.js';
import { printInvoice } from './pdf.js';

const view = document.getElementById('view');

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function toast(message) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function setActiveNav(path) {
  document.querySelectorAll('.nav-link').forEach((a) => {
    const route = a.dataset.route;
    const active = route === '/' ? path === '/' : path.startsWith(route);
    a.classList.toggle('active', active);
  });
}

function render(html) {
  view.innerHTML = html;
  view.focus();
}

async function confirmAction(message) {
  return window.confirm(message);
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

async function renderDashboard() {
  setActiveNav('/');
  const [invoices, clients, settings] = await Promise.all([listInvoices(), listClients(), getSettings()]);

  let outstanding = 0;
  let paidTotal = 0;
  let overdueCount = 0;
  let draftCount = 0;

  for (const inv of invoices) {
    const totals = calcTotals(inv);
    const status = effectiveStatus(inv);
    if (status === 'paid') paidTotal += totals.total;
    else if (status === 'overdue') { overdueCount += 1; outstanding += totals.total; }
    else if (status === 'sent') outstanding += totals.total;
    else if (status === 'draft') draftCount += 1;
  }

  const clientById = Object.fromEntries(clients.map((c) => [c.id, c]));
  const recent = invoices.slice(0, 6);

  render(`
    <div class="page-header">
      <div>
        <h1>Dashboard</h1>
        <p class="muted">${esc(settings.businessName)}</p>
      </div>
      <div class="actions-row">
        <a href="#/invoices/new" class="btn btn-primary">+ New invoice</a>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat"><div class="value">${formatCurrency(outstanding, settings.defaultCurrency)}</div><div class="label">Outstanding</div></div>
      <div class="stat"><div class="value">${formatCurrency(paidTotal, settings.defaultCurrency)}</div><div class="label">Paid (all time)</div></div>
      <div class="stat"><div class="value">${overdueCount}</div><div class="label">Overdue invoices</div></div>
      <div class="stat"><div class="value">${draftCount}</div><div class="label">Drafts</div></div>
    </div>

    <div class="card">
      <h2>Recent invoices</h2>
      ${recent.length === 0 ? emptyState('No invoices yet.', '#/invoices/new', 'Create your first invoice') : `
        <table>
          <thead><tr><th>Number</th><th>Client</th><th>Date</th><th>Status</th><th>Total</th></tr></thead>
          <tbody>
            ${recent.map((inv) => invoiceRow(inv, clientById[inv.clientId], settings)).join('')}
          </tbody>
        </table>
      `}
    </div>
  `);

  view.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => navigate(`/invoices/${tr.dataset.id}`));
  });
}

function emptyState(message, href, cta) {
  return `<div class="empty-state"><p>${esc(message)}</p>${href ? `<a href="${href}" class="btn btn-primary">${esc(cta)}</a>` : ''}</div>`;
}

function invoiceRow(inv, client, settings) {
  const totals = calcTotals(inv);
  const status = effectiveStatus(inv);
  return `
    <tr data-id="${inv.id}">
      <td>${esc(inv.number)}</td>
      <td>${esc(client ? client.name : '—')}</td>
      <td>${formatDate(inv.issueDate)}</td>
      <td><span class="badge badge-${status}">${status}</span></td>
      <td>${formatCurrency(totals.total, inv.currency || settings.defaultCurrency)}</td>
    </tr>
  `;
}

// ---------------------------------------------------------------------------
// Invoices list
// ---------------------------------------------------------------------------

async function renderInvoiceList() {
  setActiveNav('/invoices');
  const [invoices, clients, settings] = await Promise.all([listInvoices(), listClients(), getSettings()]);
  const clientById = Object.fromEntries(clients.map((c) => [c.id, c]));

  render(`
    <div class="page-header">
      <h1>Invoices</h1>
      <a href="#/invoices/new" class="btn btn-primary">+ New invoice</a>
    </div>
    <div class="card">
      ${invoices.length === 0 ? emptyState('No invoices yet.', '#/invoices/new', 'Create your first invoice') : `
        <table>
          <thead><tr><th>Number</th><th>Client</th><th>Date</th><th>Due</th><th>Status</th><th>Total</th></tr></thead>
          <tbody>
            ${invoices.map((inv) => `
              <tr data-id="${inv.id}">
                <td>${esc(inv.number)}</td>
                <td>${esc(clientById[inv.clientId]?.name || '—')}</td>
                <td>${formatDate(inv.issueDate)}</td>
                <td>${formatDate(inv.dueDate)}</td>
                <td><span class="badge badge-${effectiveStatus(inv)}">${effectiveStatus(inv)}</span></td>
                <td>${formatCurrency(calcTotals(inv).total, inv.currency || settings.defaultCurrency)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `);

  view.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => navigate(`/invoices/${tr.dataset.id}`));
  });
}

// ---------------------------------------------------------------------------
// Invoice editor
// ---------------------------------------------------------------------------

async function renderInvoiceEditor(params) {
  setActiveNav('/invoices');
  const isNew = params.id === 'new';
  const [clients, settings] = await Promise.all([listClients(), getSettings()]);
  let invoice = isNew ? null : await getInvoice(params.id);

  if (!isNew && !invoice) {
    toast('Invoice not found');
    navigate('/invoices');
    return;
  }

  if (isNew) {
    invoice = {
      id: uid(),
      number: null, // reserved on first save
      clientId: clients[0]?.id || null,
      status: 'draft',
      issueDate: todayISO(),
      dueDate: addDaysISO(todayISO(), 14),
      currency: settings.defaultCurrency,
      lineItems: [emptyLineItem()],
      discount: { type: 'flat', value: 0 },
      taxRate: settings.defaultTaxRate,
      notes: '',
    };
  }

  const displayNumber = invoice.number || '(assigned on save)';

  function draw() {
    const totals = calcTotals(invoice);

    render(`
      <div class="page-header">
        <div>
          <h1>${isNew ? 'New invoice' : `Invoice ${esc(displayNumber)}`}</h1>
          ${!isNew ? `<span class="badge badge-${effectiveStatus(invoice)}">${effectiveStatus(invoice)}</span>` : ''}
        </div>
        <div class="actions-row" id="print-hide">
          ${!isNew ? '<button class="btn" id="print-btn">Export PDF / Print</button>' : ''}
          ${!isNew ? '<button class="btn btn-danger" id="delete-btn">Delete</button>' : ''}
          <button class="btn btn-primary" id="save-btn">Save</button>
        </div>
      </div>

      <div class="card">
        <div class="form-grid">
          <div class="field">
            <label>Client</label>
            <select id="f-client">
              <option value="">No client</option>
              ${clients.map((c) => `<option value="${c.id}" ${c.id === invoice.clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Status</label>
            <select id="f-status">
              ${STATUSES.filter((s) => s !== 'overdue').map((s) => `<option value="${s}" ${s === invoice.status ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Issue date</label>
            <input type="date" id="f-issue" value="${invoice.issueDate}" />
          </div>
          <div class="field">
            <label>Due date</label>
            <input type="date" id="f-due" value="${invoice.dueDate}" />
          </div>
          <div class="field">
            <label>Currency</label>
            <input type="text" id="f-currency" value="${esc(invoice.currency)}" maxlength="3" />
          </div>
          <div class="field">
            <label>Tax rate (%)</label>
            <input type="number" id="f-tax" value="${invoice.taxRate}" min="0" step="0.01" />
          </div>
        </div>

        <h2>Line items</h2>
        <div class="line-items">
          <div class="line-item-head"><span>Description</span><span>Qty</span><span>Unit price</span><span>Amount</span><span></span></div>
          <div id="line-item-rows">
            ${invoice.lineItems.map((li) => lineItemRow(li, invoice.currency)).join('')}
          </div>
          <button class="btn btn-sm" id="add-line">+ Add line item</button>
        </div>

        <div class="form-grid" style="margin-top:10px">
          <div class="field">
            <label>Discount type</label>
            <select id="f-discount-type">
              <option value="flat" ${invoice.discount.type === 'flat' ? 'selected' : ''}>Flat amount</option>
              <option value="percent" ${invoice.discount.type === 'percent' ? 'selected' : ''}>Percent</option>
            </select>
          </div>
          <div class="field">
            <label>Discount value</label>
            <input type="number" id="f-discount-value" value="${invoice.discount.value}" min="0" step="0.01" />
          </div>
        </div>

        <div class="field">
          <label>Notes</label>
          <textarea id="f-notes">${esc(invoice.notes)}</textarea>
        </div>

        <div class="totals">
          <div class="totals-row"><span>Subtotal</span><span>${formatCurrency(totals.subtotal, invoice.currency)}</span></div>
          <div class="totals-row"><span>Discount</span><span>-${formatCurrency(totals.discountAmount, invoice.currency)}</span></div>
          <div class="totals-row"><span>Tax</span><span>${formatCurrency(totals.taxAmount, invoice.currency)}</span></div>
          <div class="totals-row grand"><span>Total</span><span>${formatCurrency(totals.total, invoice.currency)}</span></div>
        </div>
      </div>
    `);

    wireEditorEvents();
  }

  function lineItemRow(li, currency) {
    return `
      <div class="line-item-row" data-id="${li.id}">
        <input type="text" class="li-desc" placeholder="Description" value="${esc(li.description)}" />
        <input type="number" class="li-qty" min="0" step="0.01" value="${li.quantity}" />
        <input type="number" class="li-price" min="0" step="0.01" value="${li.unitPrice}" />
        <span class="li-amount">${formatCurrency(lineItemTotal(li), currency)}</span>
        <button class="icon-btn li-remove" title="Remove" aria-label="Remove line item">✕</button>
      </div>
    `;
  }

  function readFormIntoInvoice() {
    invoice.clientId = document.getElementById('f-client').value || null;
    invoice.status = document.getElementById('f-status').value;
    invoice.issueDate = document.getElementById('f-issue').value;
    invoice.dueDate = document.getElementById('f-due').value;
    invoice.currency = document.getElementById('f-currency').value.toUpperCase() || 'USD';
    invoice.taxRate = Number(document.getElementById('f-tax').value) || 0;
    invoice.discount = {
      type: document.getElementById('f-discount-type').value,
      value: Number(document.getElementById('f-discount-value').value) || 0,
    };
    invoice.notes = document.getElementById('f-notes').value;

    invoice.lineItems = Array.from(document.querySelectorAll('.line-item-row')).map((row) => ({
      id: row.dataset.id,
      description: row.querySelector('.li-desc').value,
      quantity: Number(row.querySelector('.li-qty').value) || 0,
      unitPrice: Number(row.querySelector('.li-price').value) || 0,
    }));
  }

  function wireEditorEvents() {
    document.getElementById('add-line').addEventListener('click', () => {
      readFormIntoInvoice();
      invoice.lineItems.push(emptyLineItem());
      draw();
    });

    view.querySelectorAll('.li-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        readFormIntoInvoice();
        const id = btn.closest('.line-item-row').dataset.id;
        invoice.lineItems = invoice.lineItems.filter((li) => li.id !== id);
        if (invoice.lineItems.length === 0) invoice.lineItems.push(emptyLineItem());
        draw();
      });
    });

    // Live-recalculate totals and line amounts without a full redraw.
    view.querySelectorAll('.li-qty, .li-price, .li-desc').forEach((input) => {
      input.addEventListener('input', () => {
        readFormIntoInvoice();
        const totals = calcTotals(invoice);
        view.querySelectorAll('.line-item-row').forEach((row) => {
          const li = invoice.lineItems.find((l) => l.id === row.dataset.id);
          if (li) row.querySelector('.li-amount').textContent = formatCurrency(lineItemTotal(li), invoice.currency);
        });
        view.querySelector('.totals-row:nth-child(1) span:last-child').textContent = formatCurrency(totals.subtotal, invoice.currency);
        view.querySelector('.totals-row:nth-child(2) span:last-child').textContent = `-${formatCurrency(totals.discountAmount, invoice.currency)}`;
        view.querySelector('.totals-row:nth-child(3) span:last-child').textContent = formatCurrency(totals.taxAmount, invoice.currency);
        view.querySelector('.totals-row.grand span:last-child').textContent = formatCurrency(totals.total, invoice.currency);
      });
    });

    ['f-tax', 'f-discount-type', 'f-discount-value', 'f-currency'].forEach((id) => {
      document.getElementById(id).addEventListener('input', () => {
        readFormIntoInvoice();
        draw();
      });
    });

    document.getElementById('save-btn').addEventListener('click', async () => {
      readFormIntoInvoice();
      if (!invoice.number) {
        invoice.number = await reserveNextInvoiceNumber();
      }
      const saved = await saveInvoice(invoice);
      toast('Invoice saved');
      navigate(`/invoices/${saved.id}`);
    });

    const printBtn = document.getElementById('print-btn');
    if (printBtn) {
      printBtn.addEventListener('click', async () => {
        readFormIntoInvoice();
        const client = invoice.clientId ? await getClient(invoice.clientId) : null;
        printInvoice(invoice, client, settings);
      });
    }

    const deleteBtn = document.getElementById('delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (await confirmAction('Delete this invoice? This cannot be undone.')) {
          await deleteInvoice(invoice.id);
          toast('Invoice deleted');
          navigate('/invoices');
        }
      });
    }
  }

  draw();
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

async function renderClientList() {
  setActiveNav('/clients');
  const clients = await listClients();

  render(`
    <div class="page-header">
      <h1>Clients</h1>
      <a href="#/clients/new" class="btn btn-primary">+ New client</a>
    </div>
    <div class="card">
      ${clients.length === 0 ? emptyState('No clients yet.', '#/clients/new', 'Add your first client') : `
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th></tr></thead>
          <tbody>
            ${clients.map((c) => `
              <tr data-id="${c.id}">
                <td>${esc(c.name)}</td>
                <td>${esc(c.email)}</td>
                <td>${esc(c.phone)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `);

  view.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => navigate(`/clients/${tr.dataset.id}`));
  });
}

async function renderClientEditor(params) {
  setActiveNav('/clients');
  const isNew = params.id === 'new';
  let client = isNew ? { id: uid(), name: '', email: '', phone: '', address: '', notes: '' } : await getClient(params.id);

  if (!isNew && !client) {
    toast('Client not found');
    navigate('/clients');
    return;
  }

  render(`
    <div class="page-header">
      <h1>${isNew ? 'New client' : 'Edit client'}</h1>
      <div class="actions-row">
        ${!isNew ? '<button class="btn btn-danger" id="delete-btn">Delete</button>' : ''}
        <button class="btn btn-primary" id="save-btn">Save</button>
      </div>
    </div>
    <div class="card">
      <div class="form-grid">
        <div class="field"><label>Name</label><input id="f-name" value="${esc(client.name)}" /></div>
        <div class="field"><label>Email</label><input id="f-email" type="email" value="${esc(client.email)}" /></div>
        <div class="field"><label>Phone</label><input id="f-phone" value="${esc(client.phone)}" /></div>
      </div>
      <div class="field"><label>Address</label><textarea id="f-address">${esc(client.address)}</textarea></div>
      <div class="field"><label>Notes</label><textarea id="f-notes">${esc(client.notes)}</textarea></div>
    </div>
  `);

  document.getElementById('save-btn').addEventListener('click', async () => {
    const name = document.getElementById('f-name').value.trim();
    if (!name) { toast('Client name is required'); return; }
    const saved = await saveClient({
      ...client,
      name,
      email: document.getElementById('f-email').value.trim(),
      phone: document.getElementById('f-phone').value.trim(),
      address: document.getElementById('f-address').value.trim(),
      notes: document.getElementById('f-notes').value.trim(),
    });
    toast('Client saved');
    navigate(`/clients/${saved.id}`);
  });

  const deleteBtn = document.getElementById('delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (await confirmAction('Delete this client? Existing invoices will keep the client name but lose the link.')) {
        await deleteClient(client.id);
        toast('Client deleted');
        navigate('/clients');
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function renderSettings() {
  setActiveNav('/settings');
  const settings = await getSettings();

  render(`
    <div class="page-header"><h1>Settings</h1></div>

    <div class="card">
      <h2>Business profile</h2>
      <div class="form-grid">
        <div class="field"><label>Business name</label><input id="s-name" value="${esc(settings.businessName)}" /></div>
        <div class="field"><label>Email</label><input id="s-email" type="email" value="${esc(settings.email)}" /></div>
        <div class="field"><label>Phone</label><input id="s-phone" value="${esc(settings.phone)}" /></div>
        <div class="field"><label>Default currency</label><input id="s-currency" value="${esc(settings.defaultCurrency)}" maxlength="3" /></div>
        <div class="field"><label>Default tax rate (%)</label><input id="s-tax" type="number" min="0" step="0.01" value="${settings.defaultTaxRate}" /></div>
        <div class="field"><label>Invoice number prefix</label><input id="s-prefix" value="${esc(settings.invoicePrefix)}" /></div>
      </div>
      <div class="field"><label>Address</label><textarea id="s-address">${esc(settings.address)}</textarea></div>
      <div class="field"><label>Default payment terms</label><textarea id="s-terms">${esc(settings.paymentTerms)}</textarea></div>
      <button class="btn btn-primary" id="save-settings">Save settings</button>
    </div>

    <div class="card">
      <h2>Backup &amp; restore</h2>
      <p class="muted small">All data lives only in this browser. Export a backup regularly, especially before clearing browser data or switching devices.</p>
      <div class="actions-row">
        <button class="btn" id="export-btn">Export backup (.json)</button>
        <label class="btn" for="import-input" style="cursor:pointer">Import backup</label>
        <input type="file" id="import-input" accept="application/json" hidden />
      </div>
    </div>
  `);

  document.getElementById('save-settings').addEventListener('click', async () => {
    await saveSettings({
      businessName: document.getElementById('s-name').value.trim() || 'Your Business Name',
      email: document.getElementById('s-email').value.trim(),
      phone: document.getElementById('s-phone').value.trim(),
      defaultCurrency: document.getElementById('s-currency').value.trim().toUpperCase() || 'USD',
      defaultTaxRate: Number(document.getElementById('s-tax').value) || 0,
      invoicePrefix: document.getElementById('s-prefix').value.trim() || 'INV-',
      address: document.getElementById('s-address').value.trim(),
      paymentTerms: document.getElementById('s-terms').value.trim(),
    });
    toast('Settings saved');
  });

  document.getElementById('export-btn').addEventListener('click', async () => {
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `invoicer-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const replace = await confirmAction('Replace existing clients/invoices with this backup? Cancel to merge instead.');
      await importAllData(payload, { replace });
      toast('Backup imported');
      navigate('/');
    } catch (err) {
      toast('Import failed: invalid file');
      console.error(err);
    }
    e.target.value = '';
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

route('/', renderDashboard);
route('/invoices', renderInvoiceList);
route('/invoices/:id', renderInvoiceEditor);
route('/clients', renderClientList);
route('/clients/:id', renderClientEditor);
route('/settings', renderSettings);

startRouter();

// ---------------------------------------------------------------------------
// Offline / connectivity banner
// ---------------------------------------------------------------------------

function updateOfflineBanner() {
  document.getElementById('offline-banner').hidden = navigator.onLine;
}
window.addEventListener('online', updateOfflineBanner);
window.addEventListener('offline', updateOfflineBanner);
updateOfflineBanner();

// ---------------------------------------------------------------------------
// Install prompt
// ---------------------------------------------------------------------------

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById('install-app').hidden = false;
});
document.getElementById('install-btn')?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById('install-app').hidden = true;
});

// ---------------------------------------------------------------------------
// Service worker registration + update flow
// ---------------------------------------------------------------------------

if ('serviceWorker' in navigator) {
  let registration = null;
  let reloadingAfterUpdate = false;

  window.addEventListener('load', async () => {
    try {
      registration = await navigator.serviceWorker.register('service-worker.js');
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker?.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            document.getElementById('update-banner').hidden = false;
          }
        });
      });
    } catch (err) {
      console.warn('Service worker registration failed', err);
    }
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingAfterUpdate) window.location.reload();
  });

  document.getElementById('update-reload').addEventListener('click', () => {
    if (registration?.waiting) {
      reloadingAfterUpdate = true;
      registration.waiting.postMessage('SKIP_WAITING');
    } else {
      window.location.reload();
    }
  });
}
