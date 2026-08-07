# Invoicer — Offline-First Invoicing

A small, dependency-free Progressive Web App for creating and managing
invoices entirely offline. There is no backend, no account, and no network
call anywhere in the app — all data (clients, invoices, business settings)
is stored in the browser's IndexedDB.

This is a standalone project inside this repo; it shares no code or
dependencies with `ftl_scraper_api.py`.

## Features

- Clients: create, edit, delete.
- Invoices: line items, quantity × unit price, flat or percent discount,
  tax rate, statuses (draft / sent / paid / cancelled, with automatic
  "overdue" detection based on due date), notes.
- Auto-incrementing invoice numbers (configurable prefix).
- PDF export via the browser's native print dialog ("Save as PDF") — no
  external library, works fully offline.
- Backup: export all data to a `.json` file and re-import it later (merge
  or replace), since the data only lives in this browser profile.
- Installable as a PWA (add to home screen / desktop) via a service worker
  that precaches the entire app shell, so it loads and works with the
  network fully disabled.

## Running it

This is static HTML/CSS/JS — no build step, no `npm install`. Serve the
`invoicing/` folder with any static file server (service workers require
`http://localhost` or HTTPS, not `file://`):

```bash
cd invoicing
python3 -m http.server 8080
# then open http://localhost:8080
```

or `npx serve .`, or any equivalent.

Once loaded, you can go fully offline (disable Wi-Fi, or use DevTools →
Network → Offline) and continue creating/editing invoices and clients
without interruption.

## Structure

```
invoicing/
  index.html              App shell + navigation
  manifest.webmanifest    PWA metadata
  service-worker.js       Offline app-shell caching
  css/styles.css          Styles, incl. print stylesheet for PDF export
  js/db.js                IndexedDB wrapper (generic CRUD)
  js/models.js            Pure calculation/formatting helpers (no DOM/storage)
  js/store.js             Domain operations (clients, invoices, settings, backup)
  js/router.js            Minimal hash-based router
  js/pdf.js               Print-to-PDF rendering
  js/app.js               Views + wiring (dashboard, invoices, clients, settings)
```

## Data model

- **Client**: `id, name, email, phone, address, notes`
- **Invoice**: `id, number, clientId, status, issueDate, dueDate, currency,
  lineItems[], discount { type, value }, taxRate, notes`
- **Settings**: business profile, default currency/tax rate, invoice
  numbering, default payment terms.

All amounts are computed on the fly from line items (`quantity × unitPrice`),
so totals are never stored — only inputs are, which keeps edits consistent.
