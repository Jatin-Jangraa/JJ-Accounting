# Ledgerly Accounting

Ledgerly is an offline Windows desktop accounting application built with Electron, React, TypeScript, Tailwind CSS, and SQLite.

## Features

- Company setup and editable company profile
- Local admin login with PBKDF2 password hashing
- Ledgers, account groups, customers, suppliers, and stock items
- Double-entry vouchers with debit/credit validation
- Sales and purchase invoices with items, GST, print, and PDF export
- Dashboard, day book, cash book, bank book, trial balance, profit and loss, balance sheet, stock, sales, purchase, and GST reports
- SQLite backup, restore, and auto backup
- Search and date filters
- Light and dark desktop UI

## Install

```powershell
npm install
```

## Run in development

```powershell
npm run dev
```

## Build Windows installer

```powershell
npm run build
```

The installer is created in `release`.

## Local data

The SQLite database is stored in the app user data folder as `ledgerly.sqlite`. Backups are normal SQLite files and can be restored from the Backup screen.

## Project structure

```text
src/
  main/
    main.ts
    services/accounting-service.ts
  preload/
    index.ts
  renderer/
    App.tsx
    styles.css
  shared/
    ipc.ts
    types.ts
```
