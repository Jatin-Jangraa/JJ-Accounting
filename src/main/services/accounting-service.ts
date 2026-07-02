import type { App as ElectronApp } from 'electron';
import { BrowserWindow, dialog, shell } from 'electron';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  AccountGroup,
  AppInit,
  BackupResult,
  CloudSyncResult,
  CloudSyncSettings,
  Company,
  DashboardSummary,
  FinancialYearArchive,
  FinancialYearCloseResult,
  Invoice,
  InvoiceItem,
  Item,
  Ledger,
  LedgerStatementRow,
  LicenseActivationResult,
  LicenseStatus,
  LoanAccount,
  LoanAccountCategory,
  LoanBook,
  LoanSide,
  LoanStatementRow,
  LoanSummaryRow,
  LoanTransaction,
  ProfitLossData,
  ProfitLossInterestRow,
  ReportBook,
  ReportFilters,
  SessionUser,
  TrialBalanceRow,
  Voucher,
  VoucherEntry
} from '../../shared/types.js';
import { LicenseService } from './license-service.js';

type Db = Database.Database;
type FinancialYearPeriod = { start: string; end: string };
type AccountInterestBreakdown = { previous: number; current: number; total: number };

const MONEY = 2;
const DEFAULT_CLOUD_SYNC_URL = 'https://jj-accounting-cloud.vercel.app/api/sync';
const CLOUD_KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const round = (value: number) => Number((Number(value || 0)).toFixed(MONEY));
const today = () => new Date().toISOString().slice(0, 10);
const randomCloudKeyPart = (length: number) => Array.from(crypto.randomBytes(length), (byte) => CLOUD_KEY_ALPHABET[byte % CLOUD_KEY_ALPHABET.length]).join('');
const loanCategoryGroup = (category: LoanAccountCategory): AccountGroup => {
  const normalized = category.toLowerCase();
  if (normalized.includes('creditor')) return 'Liabilities';
  if (normalized.includes('capital')) return 'Capital';
  if (normalized.includes('income')) return 'Income';
  if (normalized.includes('expense') || normalized.includes('expanse')) return 'Expenses';
  return 'Assets';
};

const hashPassword = (password: string, salt = crypto.randomBytes(16).toString('hex')) => {
  const hash = crypto.pbkdf2Sync(password, salt, 210_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
};

const verifyPassword = (password: string, stored: string) => {
  const [salt, hash] = stored.split(':');
  const test = hashPassword(password, salt).split(':')[1];
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
};

export class AccountingService {
  private db: Db;
  private dbPath: string;
  private backupDir: string;
  private archiveDir: string;
  private cloudSyncPath: string;
  private cloudSyncInFlight = false;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private licenseService: LicenseService;

  constructor(private app: ElectronApp) {
    const dataDir = app.getPath('userData');
    fs.mkdirSync(dataDir, { recursive: true });
    this.backupDir = path.join(dataDir, 'backups');
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.archiveDir = path.join(dataDir, 'financial-year-archives');
    fs.mkdirSync(this.archiveDir, { recursive: true });
    this.cloudSyncPath = path.join(dataDir, 'cloud-sync.json');
    this.licenseService = new LicenseService(app);
    this.dbPath = path.join(dataDir, 'ledgerly.sqlite');
    this.db = this.connectDatabase();
    this.migrate();
    this.seedSystemLedgers();
    // Start periodic cloud sync on app launch
    this.startAutoSyncTimer();
  }

  private connectDatabase(): Db {
    const db = new Database(this.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return db;
  }

  init(): AppInit {
    const hasAdmin = Boolean(this.db.prepare('select id from users limit 1').get());
    return { hasAdmin, company: this.getCompany(), dbPath: this.dbPath };
  }

  getLicenseStatus(): Promise<LicenseStatus> {
    return this.licenseService.getStatus();
  }

  activateLicense(licenseKey: string): Promise<LicenseActivationResult> {
    return this.licenseService.activate(licenseKey);
  }

  validateLicense(): Promise<LicenseStatus> {
    return this.licenseService.validate();
  }

  createAdmin(password: string): SessionUser {
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    const existing = this.db.prepare('select id from users limit 1').get();
    if (existing) throw new Error('Admin user already exists.');
    const result = this.db.prepare('insert into users (username, password_hash) values (?, ?)').run('admin', hashPassword(password));
    this.autoBackup();
    return { id: Number(result.lastInsertRowid), username: 'admin' };
  }

  login(password: string): SessionUser {
    const user = this.db.prepare('select * from users where username = ?').get('admin') as any;
    if (!user || !verifyPassword(password, user.password_hash)) throw new Error('Invalid password.');
    return { id: user.id, username: user.username };
  }

  changePassword(currentPassword: string, nextPassword: string): boolean {
    this.login(currentPassword);
    if (nextPassword.length < 6) throw new Error('New password must be at least 6 characters.');
    this.db.prepare("update users set password_hash = ?, updated_at = datetime('now') where username = ?").run(hashPassword(nextPassword), 'admin');
    this.autoBackup();
    return true;
  }

  getCompany(): Company | null {
    const row = this.db.prepare('select * from company order by id limit 1').get() as any;
    return row ? this.mapCompany(row) : null;
  }

  saveCompany(company: Company): Company {
    if (!company.name.trim()) throw new Error('Company name is required.');
    const current = this.getCompany();
    if (current?.id) {
      this.db.prepare(
        "update company set name=?, shop_no=?, address=?, phone=?, email=?, gstin=?, financial_year=?, updated_at=datetime('now') where id=?"
      ).run(company.name, company.shopNo ?? '', company.address, company.phone, company.email, company.gstin, company.financialYear, current.id);
      this.autoBackup();
      return { ...company, id: current.id };
    }
    const result = this.db.prepare(
      'insert into company (name, shop_no, address, phone, email, gstin, financial_year) values (?, ?, ?, ?, ?, ?, ?)'
    ).run(company.name, company.shopNo ?? '', company.address, company.phone, company.email, company.gstin, company.financialYear);
    this.autoBackup();
    return { ...company, id: Number(result.lastInsertRowid) };
  }

  async closeFinancialYear(company: Company, manualCloseDate?: string): Promise<FinancialYearCloseResult> {
    if (!company.name.trim()) throw new Error('Company name is required.');
    const current = this.getCompany();
    if (!current?.id) throw new Error('Save firm details before closing a financial year.');
    const fromFinancialYear = (current.financialYear || '').trim();
    const toFinancialYear = (company.financialYear || '').trim();
    if (!fromFinancialYear) throw new Error('Current financial year is required before closing.');
    if (!toFinancialYear) throw new Error('New financial year is required.');
    if (fromFinancialYear.toLowerCase() === toFinancialYear.toLowerCase()) {
      return { company: this.saveCompany(company), archive: this.latestFinancialYearArchive(), message: 'Firm details updated.' };
    }

    const requestedCloseDate = (manualCloseDate || today()).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedCloseDate)) throw new Error('Manual close date is required.');
    const parsedPeriod = this.parseFinancialYear(fromFinancialYear);
    const period = { ...parsedPeriod, end: requestedCloseDate };
    if (period.end < period.start) throw new Error('Manual close date cannot be before the current financial year start date.');
    const nextOpeningDate = this.addDays(period.end, 1);
    const safeYear = this.safeFileName(`${fromFinancialYear}-to-${toFinancialYear}`) || `financial-year-${Date.now()}`;
    const yearDir = path.join(this.archiveDir, safeYear);
    fs.mkdirSync(yearDir, { recursive: true });

    const backupPath = path.join(yearDir, `${safeYear}-database.sqlite`);
    await this.db.backup(backupPath);

    const ledgers = this.listLedgers();
    const previousInterestBeforeClose = this.loanPreviousInterestSnapshot();
    const bookReports = {
      Combined: this.financialYearBookReport('Combined', ledgers, period),
      K: this.financialYearBookReport('K', ledgers, period),
      P: this.financialYearBookReport('P', ledgers, period)
    };
    const previousInterestAfterClose = this.loanPreviousInterestSnapshot(period.end);
    const trialBalance = bookReports.Combined.trialBalance;
    const profitLossData = bookReports.Combined.profitLoss;
    const ledgerStatements = bookReports.Combined.ledgers;
    const vouchers = this.listVouchers({ from: period.start, to: period.end });
    const invoices = this.listInvoices({ from: period.start, to: period.end });
    const snapshot = {
      company: current,
      closedToCompany: { ...company, id: current.id },
      fromFinancialYear,
      toFinancialYear,
      periodStart: period.start,
      periodEnd: period.end,
      createdAt: new Date().toISOString(),
      trialBalance,
      balanceSheet: trialBalance.filter((row) => ['Assets', 'Liabilities', 'Capital'].includes(row.groupName)),
      profitLoss: profitLossData,
      ledgers: ledgerStatements,
      bookReports,
      previousInterestBeforeClose,
      previousInterestAfterClose,
      vouchers,
      invoices
    };

    const snapshotPath = path.join(yearDir, `${safeYear}-records.json`);
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
    const documentPath = await this.writeFinancialYearDocument(fromFinancialYear, snapshot, yearDir, safeYear);

    const result = this.db.transaction(() => {
      const inserted = this.db.prepare(
        `insert into financial_year_archives (
          from_financial_year, to_financial_year, period_start, period_end,
          company_snapshot_json, trial_balance_json, balance_sheet_json, profit_loss_json, ledger_statements_json,
          document_path, snapshot_path, backup_path, voucher_count, invoice_count, ledger_count, previous_interest_json
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        fromFinancialYear,
        toFinancialYear,
        period.start,
        period.end,
        JSON.stringify(current),
        JSON.stringify(snapshot.trialBalance),
        JSON.stringify(snapshot.balanceSheet),
        JSON.stringify(snapshot.profitLoss),
        JSON.stringify(snapshot.ledgers),
        documentPath,
        snapshotPath,
        backupPath,
        vouchers.length,
        invoices.length,
        ledgers.length,
        JSON.stringify(previousInterestAfterClose)
      );
      const archiveId = Number(inserted.lastInsertRowid);

      this.storePreviousYearInterest(period.end, nextOpeningDate);
      this.rollForwardOpeningBalances(trialBalance, period.end, nextOpeningDate);

      this.db.prepare(`update voucher_entries set financial_year_archive_id=? where financial_year_archive_id is null and voucher_id in (select id from vouchers where date <= ?)`).run(archiveId, period.end);
      this.db.prepare(`update vouchers set financial_year_archive_id=? where financial_year_archive_id is null and date <= ?`).run(archiveId, period.end);
      this.db.prepare(`update invoices set financial_year_archive_id=? where financial_year_archive_id is null and date <= ?`).run(archiveId, period.end);
      this.db.prepare(`update loan_transactions set financial_year_archive_id=? where financial_year_archive_id is null and date <= ?`).run(archiveId, period.end);
      this.db.prepare(
        "update company set name=?, shop_no=?, address=?, phone=?, email=?, gstin=?, financial_year=?, updated_at=datetime('now') where id=?"
      ).run(company.name, company.shopNo ?? '', company.address, company.phone, company.email, company.gstin, toFinancialYear, current.id);
      this.writeAuditLog('financial_year', archiveId, 'close', {
        fromFinancialYear,
        toFinancialYear,
        periodStart: period.start,
        periodEnd: period.end,
        nextOpeningDate,
        previousInterestBeforeClose,
        previousInterestAfterClose
      });

      return archiveId;
    })();

    const archive = this.mapFinancialYearArchive(this.db.prepare('select * from financial_year_archives where id=?').get(result) as any);
    this.autoBackup();
    return {
      company: this.getCompany() as Company,
      archive,
      message: `Financial year ${fromFinancialYear} manually closed on ${period.end}; ${toFinancialYear} opened from ${nextOpeningDate}.`
    };
  }

  listFinancialYearArchives(): FinancialYearArchive[] {
    return (this.db.prepare('select * from financial_year_archives order by period_end desc, id desc').all() as any[]).map((row) => this.mapFinancialYearArchive(row));
  }

  async undoFinancialYearClose(archiveId: number): Promise<BackupResult> {
    const archive = this.db.prepare('select * from financial_year_archives where id=?').get(archiveId) as any;
    if (!archive) throw new Error('Financial year archive not found.');
    if (!archive.backup_path) throw new Error('This archive does not have a restore backup path.');
    const nextOpeningDate = this.addDays(archive.period_end, 1);
    if (this.hasTransactionsOnOrAfter(nextOpeningDate)) {
      throw new Error('Undo is not allowed because transactions already exist in the new financial year. Please delete or reverse those entries first.');
    }
    await this.restoreDatabaseFromFile(archive.backup_path, `before-financial-year-undo-${Date.now()}.sqlite`);
    this.writeAuditLog('financial_year', archiveId, 'undo', {
      fromFinancialYear: archive.from_financial_year,
      toFinancialYear: archive.to_financial_year,
      periodStart: archive.period_start,
      periodEnd: archive.period_end,
      nextOpeningDate
    });
    return {
      ok: true,
      path: archive.backup_path,
      message: `Financial year close ${archive.from_financial_year} -> ${archive.to_financial_year} was undone.`
    };
  }

  listLedgers(): Ledger[] {
    return (this.db.prepare('select * from ledgers order by name').all() as any[]).map((row) => this.mapLedger(row));
  }

  saveLedger(ledger: Ledger): Ledger {
    if (!ledger.name.trim()) throw new Error('Ledger name is required.');
    if (!['Assets', 'Liabilities', 'Income', 'Expenses', 'Capital'].includes(ledger.groupName)) throw new Error('Invalid account group.');
    if (ledger.id) {
      this.db.prepare(
        "update ledgers set name=?, group_name=?, opening_balance=?, opening_type=?, party_type=?, gstin=?, phone=?, email=?, address=?, updated_at=datetime('now') where id=?"
      ).run(
        ledger.name,
        ledger.groupName,
        round(ledger.openingBalance),
        ledger.openingType,
        ledger.partyType ?? null,
        ledger.gstin ?? null,
        ledger.phone ?? null,
        ledger.email ?? null,
        ledger.address ?? null,
        ledger.id
      );
      this.autoBackup();
      return ledger;
    }
    const result = this.db.prepare(
      `insert into ledgers (name, group_name, opening_balance, opening_type, party_type, gstin, phone, email, address)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      ledger.name,
      ledger.groupName,
      round(ledger.openingBalance),
      ledger.openingType,
      ledger.partyType ?? null,
      ledger.gstin ?? null,
      ledger.phone ?? null,
      ledger.email ?? null,
      ledger.address ?? null
    );
    this.autoBackup();
    return { ...ledger, id: Number(result.lastInsertRowid) };
  }

  deleteLedger(id: number): boolean {
    const used = this.db.prepare('select id from voucher_entries where ledger_id=? limit 1').get(id);
    if (used) throw new Error('Ledger is used in transactions.');
    this.db.prepare('delete from ledgers where id=? and is_system=0').run(id);
    this.autoBackup();
    return true;
  }

  listItems(): Item[] {
    return (this.db.prepare('select * from items order by name').all() as any[]).map(this.mapItem);
  }

  saveItem(item: Item): Item {
    if (!item.name.trim()) throw new Error('Item name is required.');
    if (item.id) {
      this.db.prepare("update items set name=?, sku=?, unit=?, price=?, gst_rate=?, stock=?, updated_at=datetime('now') where id=?").run(
        item.name,
        item.sku ?? null,
        item.unit,
        round(item.price),
        round(item.gstRate),
        round(item.stock),
        item.id
      );
      this.autoBackup();
      return item;
    }
    const result = this.db.prepare('insert into items (name, sku, unit, price, gst_rate, stock) values (?, ?, ?, ?, ?, ?)').run(
      item.name,
      item.sku ?? null,
      item.unit,
      round(item.price),
      round(item.gstRate),
      round(item.stock)
    );
    this.autoBackup();
    return { ...item, id: Number(result.lastInsertRowid) };
  }

  deleteItem(id: number): boolean {
    const used = this.db.prepare('select id from invoice_items where item_id=? limit 1').get(id);
    if (used) throw new Error('Item is used in invoices.');
    this.db.prepare('delete from items where id=?').run(id);
    this.autoBackup();
    return true;
  }

  listVouchers(filters: ReportFilters = {}): Voucher[] {
    const where = this.filterSql(filters, 'v');
    const vouchers = this.db.prepare(`select v.* from vouchers v ${where.sql} order by v.date desc, v.id desc`).all(...where.args) as any[];
    return vouchers.map((row) => this.hydrateVoucher(row));
  }

  saveVoucher(voucher: Voucher): Voucher {
    this.validateVoucher(voucher);
    const totalDebit = round(voucher.entries.reduce((sum, entry) => sum + Number(entry.debit || 0), 0));
    const totalCredit = round(voucher.entries.reduce((sum, entry) => sum + Number(entry.credit || 0), 0));
    const tx = this.db.transaction(() => {
      if (voucher.id) {
        this.db.prepare('delete from voucher_entries where voucher_id=?').run(voucher.id);
        this.db.prepare(
          "update vouchers set type=?, date=?, party_ledger_id=?, narration=?, total_debit=?, total_credit=?, updated_at=datetime('now') where id=?"
        ).run(voucher.type, voucher.date, voucher.partyLedgerId ?? null, voucher.narration, totalDebit, totalCredit, voucher.id);
      } else {
        voucher.voucherNo = this.nextNumber(voucher.type.toUpperCase().replaceAll(' ', '_'));
        const result = this.db.prepare(
          'insert into vouchers (voucher_no, type, date, party_ledger_id, narration, total_debit, total_credit) values (?, ?, ?, ?, ?, ?, ?)'
        ).run(voucher.voucherNo, voucher.type, voucher.date, voucher.partyLedgerId ?? null, voucher.narration, totalDebit, totalCredit);
        voucher.id = Number(result.lastInsertRowid);
      }
      const stmt = this.db.prepare('insert into voucher_entries (voucher_id, ledger_id, debit, credit, narration) values (?, ?, ?, ?, ?)');
      for (const entry of voucher.entries) stmt.run(voucher.id, entry.ledgerId, round(entry.debit), round(entry.credit), entry.narration ?? '');
    });
    tx();
    this.autoBackup();
    return this.hydrateVoucher(this.db.prepare('select * from vouchers where id=?').get(voucher.id) as any);
  }

  deleteVoucher(id: number): boolean {
    this.db.prepare('delete from vouchers where id=?').run(id);
    this.autoBackup();
    return true;
  }

  listInvoices(filters: ReportFilters = {}): Invoice[] {
    const where = this.filterSql(filters, 'i');
    const rows = this.db.prepare(`select i.*, l.name party_name from invoices i left join ledgers l on l.id=i.party_ledger_id ${where.sql} order by i.date desc, i.id desc`).all(...where.args) as any[];
    return rows.map((row) => this.hydrateInvoice(row));
  }

  saveInvoice(invoice: Invoice): Invoice {
    if (!invoice.partyLedgerId) throw new Error('Party is required.');
    if (!invoice.items.length) throw new Error('At least one item is required.');
    const totals = this.invoiceTotals(invoice.items);
    const tx = this.db.transaction(() => {
      if (!invoice.invoiceNo) invoice.invoiceNo = this.nextNumber(invoice.type === 'Sales' ? 'SALES_INV' : 'PURCHASE_INV');
      if (invoice.id) {
        this.db.prepare('delete from invoice_items where invoice_id=?').run(invoice.id);
        this.db.prepare(
          "update invoices set invoice_no=?, type=?, date=?, party_ledger_id=?, subtotal=?, discount_total=?, gst_total=?, grand_total=?, notes=?, updated_at=datetime('now') where id=?"
        ).run(invoice.invoiceNo, invoice.type, invoice.date, invoice.partyLedgerId, totals.subtotal, totals.discountTotal, totals.gstTotal, totals.grandTotal, invoice.notes ?? '', invoice.id);
      } else {
        const result = this.db.prepare(
          'insert into invoices (invoice_no, type, date, party_ledger_id, subtotal, discount_total, gst_total, grand_total, notes) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(invoice.invoiceNo, invoice.type, invoice.date, invoice.partyLedgerId, totals.subtotal, totals.discountTotal, totals.gstTotal, totals.grandTotal, invoice.notes ?? '');
        invoice.id = Number(result.lastInsertRowid);
      }
      const itemStmt = this.db.prepare(
        'insert into invoice_items (invoice_id, item_id, qty, rate, discount, gst_rate, taxable, gst_amount, total) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const item of invoice.items) {
        const line = this.invoiceLine(item);
        itemStmt.run(invoice.id, item.itemId, item.qty, item.rate, item.discount, item.gstRate, line.taxable, line.gst, line.total);
        const stockDelta = invoice.type === 'Sales' ? -Number(item.qty) : Number(item.qty);
        this.db.prepare('update items set stock = stock + ? where id=?').run(stockDelta, item.itemId);
      }
      const salesLedger = this.getOrCreateSystemLedger('Sales', 'Income');
      const purchaseLedger = this.getOrCreateSystemLedger('Purchase', 'Expenses');
      const gstLedger = this.getOrCreateSystemLedger('GST Payable', 'Liabilities');
      const entries: VoucherEntry[] =
        invoice.type === 'Sales'
          ? [
              { ledgerId: invoice.partyLedgerId, debit: totals.grandTotal, credit: 0 },
              { ledgerId: salesLedger, debit: 0, credit: round(totals.subtotal - totals.discountTotal) },
              { ledgerId: gstLedger, debit: 0, credit: totals.gstTotal }
            ]
          : [
              { ledgerId: purchaseLedger, debit: round(totals.subtotal - totals.discountTotal), credit: 0 },
              { ledgerId: gstLedger, debit: totals.gstTotal, credit: 0 },
              { ledgerId: invoice.partyLedgerId, debit: 0, credit: totals.grandTotal }
            ];
      this.saveVoucher({
        type: invoice.type,
        date: invoice.date,
        partyLedgerId: invoice.partyLedgerId,
        narration: `${invoice.type} invoice ${invoice.invoiceNo}`,
        entries
      });
    });
    tx();
    this.autoBackup();
    return this.hydrateInvoice(this.db.prepare('select i.*, l.name party_name from invoices i left join ledgers l on l.id=i.party_ledger_id where i.id=?').get(invoice.id) as any);
  }

  deleteInvoice(id: number): boolean {
    this.db.prepare('delete from invoices where id=?').run(id);
    this.autoBackup();
    return true;
  }

  dashboard(): DashboardSummary {
    const sales = this.scalar("select coalesce(sum(grand_total),0) from invoices where type='Sales'");
    const purchases = this.scalar("select coalesce(sum(grand_total),0) from invoices where type='Purchase'");
    const balances = this.ledgerBalances();
    const byName = (name: string) => balances.find((row) => row.ledgerName.toLowerCase() === name.toLowerCase())?.debit ?? 0;
    const receivables = balances.filter((row) => row.groupName === 'Assets' && row.debit > 0).reduce((sum, row) => sum + row.debit, 0);
    const payables = balances.filter((row) => row.groupName === 'Liabilities' && row.credit > 0).reduce((sum, row) => sum + row.credit, 0);
    return {
      totalSales: sales,
      totalPurchases: purchases,
      cashBalance: byName('Cash'),
      bankBalance: byName('Bank'),
      receivables,
      payables,
      profitLoss: this.profitLoss(),
      recentTransactions: this.listVouchers({}).slice(0, 8)
    };
  }

  trialBalance(filters: ReportFilters = {}): TrialBalanceRow[] {
    return this.ledgerBalances(filters);
  }

  ledgerStatement(ledgerId: number, filters: ReportFilters = {}): LedgerStatementRow[] {
    const rows = this.db.prepare(
      `select v.date, v.voucher_no, v.type, coalesce(ve.narration, v.narration) narration, ve.debit, ve.credit
       from voucher_entries ve join vouchers v on v.id=ve.voucher_id
       where ve.ledger_id=? and ve.balance_bd_id is null and ve.financial_year_archive_id is null ${filters.from ? 'and v.date >= ?' : ''} ${filters.to ? 'and v.date <= ?' : ''}
       order by v.date, v.id`
    ).all(ledgerId, ...[filters.from, filters.to].filter(Boolean)) as any[];
    let balance = 0;
    return rows.map((row) => {
      balance += Number(row.debit) - Number(row.credit);
      return {
        date: row.date,
        voucherNo: row.voucher_no,
        type: row.type,
        narration: row.narration,
        debit: round(row.debit),
        credit: round(row.credit),
        balance: round(balance)
      };
    });
  }

  listLoanAccounts(): LoanAccount[] {
    return (this.db.prepare(
      `select a.*, l.opening_balance, l.opening_type
       from loan_accounts a join ledgers l on l.id=a.ledger_id
       order by a.is_pinned desc, a.category, a.name`
    ).all() as any[]).map((row) => this.mapLoanAccount(row));
  }

  saveLoanAccount(account: LoanAccount): LoanAccount {
    if (!account.name.trim()) throw new Error('Account name is required.');
    if (!account.openingDate) throw new Error('Opening balance date is required.');
    const category = account.category?.trim() || 'Debtors';
    const openingK = round(account.openingKBalance ?? 0);
    const openingP = round(account.openingPBalance ?? 0);
    const openingKType = account.openingKType ?? 'Dr';
    const openingPType = account.openingPType ?? 'Dr';
    const netOpening = round(openingK * (openingKType === 'Dr' ? 1 : -1) + openingP * (openingPType === 'Dr' ? 1 : -1));
    const tx = this.db.transaction(() => {
      const existingAccount = account.id ? this.db.prepare('select * from loan_accounts where id=?').get(account.id) as any : null;
      const existingLedger = account.ledgerId ? this.db.prepare('select id from ledgers where id=?').get(account.ledgerId) as any : null;
      const ledgerId = existingLedger?.id ?? this.getOrCreatePartyLedger(account.name, category);
      this.db.prepare(
        "update ledgers set name=?, group_name=?, party_type='customer', phone=?, address=?, opening_balance=?, opening_type=?, updated_at=datetime('now') where id=?"
      ).run(account.name, loanCategoryGroup(category), account.phone ?? null, account.address ?? null, Math.abs(netOpening), netOpening < 0 ? 'Cr' : 'Dr', ledgerId);
      if (existingAccount) {
        this.db.prepare(
          "update loan_accounts set name=?, ledger_id=?, category=?, phone=?, address=?, default_rate=?, note=?, opening_k_balance=?, opening_k_type=?, opening_p_balance=?, opening_p_type=?, opening_date=?, updated_at=datetime('now') where id=?"
        ).run(account.name, ledgerId, category, account.phone ?? null, account.address ?? null, round(account.defaultRate ?? 1.5), account.note ?? null, openingK, openingKType, openingP, openingPType, account.openingDate, account.id);
        return account.id;
      }
      const result = this.db.prepare(
        'insert into loan_accounts (name, ledger_id, category, phone, address, default_rate, note, opening_k_balance, opening_k_type, opening_p_balance, opening_p_type, opening_date) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(account.name, ledgerId, category, account.phone ?? null, account.address ?? null, round(account.defaultRate ?? 1.5), account.note ?? null, openingK, openingKType, openingP, openingPType, account.openingDate);
      return Number(result.lastInsertRowid);
    });
    const id = tx();
    this.autoBackup();
    return this.mapLoanAccount(this.db.prepare('select * from loan_accounts where id=?').get(id) as any);
  }

  deleteLoanAccount(id: number): boolean {
    const account = this.db.prepare('select * from loan_accounts where id=?').get(id) as any;
    if (!account) return true;
    const voucherIds = (this.db.prepare('select voucher_id from loan_transactions where account_id=? and voucher_id is not null').all(id) as any[]).map((row) => row.voucher_id);
    const tx = this.db.transaction(() => {
      if (voucherIds.length) {
        const placeholders = voucherIds.map(() => '?').join(',');
        this.db.prepare(`delete from loan_transactions where voucher_id in (${placeholders})`).run(...voucherIds);
        this.db.prepare(`delete from voucher_entries where voucher_id in (${placeholders})`).run(...voucherIds);
        this.db.prepare(`delete from vouchers where id in (${placeholders})`).run(...voucherIds);
      }
      this.db.prepare('delete from loan_transactions where account_id=?').run(id);
      this.db.prepare('delete from balance_bd_history where loan_account_id=?').run(id);
      this.db.prepare('delete from loan_accounts where id=?').run(id);
      const stillUsed = this.db.prepare('select id from voucher_entries where ledger_id=? limit 1').get(account.ledger_id);
      if (!stillUsed) this.db.prepare('delete from ledgers where id=? and is_system=0').run(account.ledger_id);
    });
    tx();
    this.autoBackup();
    return true;
  }

  setLoanAccountPinned(id: number, pinned: boolean): boolean {
    this.db.prepare('update loan_accounts set is_pinned=?, updated_at=datetime(\'now\') where id=?').run(pinned ? 1 : 0, id);
    this.autoBackup();
    return pinned;
  }

  saveLoanTransaction(transaction: LoanTransaction): LoanTransaction {
    this.validateLoanTransaction(transaction);
    const account = this.db.prepare('select * from loan_accounts where id=?').get(transaction.accountId) as any;
    if (!account) throw new Error('Loan account not found.');
    const counterLedgerId = transaction.counterLedgerId;
    if (counterLedgerId === account.ledger_id) throw new Error('Opposite account cannot be the same as this account.');
    const amount = round(transaction.amount);
    const interestAmount = round(transaction.interestAmount ?? 0);
    const interestLedgerId = interestAmount > 0 ? transaction.interestLedgerId || null : null;
    const narration = transaction.narration?.trim() || `${transaction.book} ${transaction.side} ${account.name}`;
    const oppositeLoanAccount = this.db.prepare('select * from loan_accounts where ledger_id=?').get(counterLedgerId) as any;
    const voucher =
      transaction.side === 'Dr'
        ? this.saveVoucher({
            type: 'Payment',
            date: transaction.date,
            partyLedgerId: account.ledger_id,
            narration,
            entries: [
              { ledgerId: account.ledger_id, debit: amount, credit: 0, narration },
              { ledgerId: counterLedgerId, debit: 0, credit: amount, narration }
            ]
          })
        : this.saveVoucher({
            type: 'Receipt',
            date: transaction.date,
            partyLedgerId: account.ledger_id,
            narration,
            entries: [
              { ledgerId: counterLedgerId, debit: amount, credit: 0, narration },
              { ledgerId: account.ledger_id, debit: 0, credit: amount, narration }
            ]
          });
    const monthlyRate = round(transaction.monthlyRate ?? account.default_rate ?? 1.5);
    const insertLoanTransaction = this.db.prepare(
      `insert into loan_transactions (account_id, date, book, side, amount, counter_ledger_id, interest_amount, interest_ledger_id, monthly_rate, narration, voucher_id)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const result = insertLoanTransaction.run(
      transaction.accountId,
      transaction.date,
      transaction.book,
      transaction.side,
      amount,
      counterLedgerId,
      interestAmount,
      interestLedgerId,
      monthlyRate,
      narration,
      voucher.id ?? null
    );
    if (oppositeLoanAccount) {
      insertLoanTransaction.run(
        oppositeLoanAccount.id,
        transaction.date,
        transaction.book,
        transaction.side === 'Dr' ? 'Cr' : 'Dr',
        amount,
        account.ledger_id,
        0,
        null,
        round(oppositeLoanAccount.default_rate ?? monthlyRate ?? 1.5),
        narration,
        voucher.id ?? null
      );
    }
    this.autoBackup();
    return this.loanTransactionById(Number(result.lastInsertRowid));
  }

  postManualInterest(accountId: number, date: string): Voucher {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Interest posting date is required.');
    const account = this.db.prepare('select * from loan_accounts where id=?').get(accountId) as any;
    if (!account) throw new Error('Loan account not found.');
    const breakdown = this.accountInterestBreakdown(account, date);
    const totalInterest = round(breakdown.total);
    if (Math.abs(totalInterest) < 0.005) throw new Error('There is no interest to post.');

    const ledgerName = totalInterest >= 0 ? 'Interest Income' : 'Interest Expense';
    const ledgerGroup = totalInterest >= 0 ? 'Income' : 'Expenses';
    const interestLedgerId = this.getOrCreateSystemLedger(ledgerName, ledgerGroup);
    const amount = Math.abs(totalInterest);
    const narration = `Manual interest entry for ${account.name} up to ${date}.`;

    const voucher = totalInterest >= 0
      ? this.saveVoucher({
          type: 'Journal',
          date,
          partyLedgerId: account.ledger_id,
          narration,
          entries: [
            { ledgerId: account.ledger_id, debit: amount, credit: 0, narration },
            { ledgerId: interestLedgerId, debit: 0, credit: amount, narration }
          ]
        })
      : this.saveVoucher({
          type: 'Journal',
          date,
          partyLedgerId: account.ledger_id,
          narration,
          entries: [
            { ledgerId: interestLedgerId, debit: amount, credit: 0, narration },
            { ledgerId: account.ledger_id, debit: 0, credit: amount, narration }
          ]
        });

    this.db.prepare(
      "update loan_accounts set previous_year_interest=0, current_interest_start_date=?, last_interest_posted_date=?, updated_at=datetime('now') where id=?"
    ).run(date, date, account.id);
    this.writeAuditLog('manual_interest', voucher.id ?? null, 'post', {
      accountId: account.id,
      accountName: account.name,
      date,
      previousYearInterest: breakdown.previous,
      currentYearInterest: breakdown.current,
      totalInterest,
      voucherNo: voucher.voucherNo
    });
    this.autoBackup();
    return voucher;
  }

  updateLoanTransaction(transaction: LoanTransaction): LoanTransaction {
    if (!transaction.id) throw new Error('Transaction ID is required.');
    this.validateLoanTransaction(transaction);
    const current = this.db.prepare('select * from loan_transactions where id=?').get(transaction.id) as any;
    if (!current) throw new Error('Transaction not found.');
    const account = this.db.prepare('select * from loan_accounts where id=?').get(transaction.accountId) as any;
    if (!account) throw new Error('Account not found.');
    if (transaction.counterLedgerId === account.ledger_id) throw new Error('Opposite account cannot be the same as this account.');

    const amount = round(transaction.amount);
    const interestAmount = round(transaction.interestAmount ?? 0);
    const interestLedgerId = interestAmount > 0 ? transaction.interestLedgerId || null : null;
    const monthlyRate = round(transaction.monthlyRate ?? account.default_rate ?? 1.5);
    const narration = transaction.narration?.trim() || `${transaction.book} ${transaction.side} ${account.name}`;
    const oppositeAccount = this.db.prepare('select * from loan_accounts where ledger_id=?').get(transaction.counterLedgerId) as any;
    const voucherId = current.voucher_id;

    const update = this.db.transaction(() => {
      if (!voucherId) throw new Error('The linked voucher could not be found.');
      const type = transaction.side === 'Dr' ? 'Payment' : 'Receipt';
      this.db.prepare("update vouchers set type=?, date=?, party_ledger_id=?, narration=?, total_debit=?, total_credit=?, updated_at=datetime('now') where id=?")
        .run(type, transaction.date, account.ledger_id, narration, amount, amount, voucherId);
      this.db.prepare('delete from voucher_entries where voucher_id=?').run(voucherId);
      const insertEntry = this.db.prepare('insert into voucher_entries (voucher_id, ledger_id, debit, credit, narration) values (?, ?, ?, ?, ?)');
      if (transaction.side === 'Dr') {
        insertEntry.run(voucherId, account.ledger_id, amount, 0, narration);
        insertEntry.run(voucherId, transaction.counterLedgerId, 0, amount, narration);
      } else {
        insertEntry.run(voucherId, transaction.counterLedgerId, amount, 0, narration);
        insertEntry.run(voucherId, account.ledger_id, 0, amount, narration);
      }

      this.db.prepare(`update loan_transactions set account_id=?, date=?, book=?, side=?, amount=?, counter_ledger_id=?, interest_amount=?, interest_ledger_id=?, monthly_rate=?, narration=? where id=?`)
        .run(transaction.accountId, transaction.date, transaction.book, transaction.side, amount, transaction.counterLedgerId, interestAmount, interestLedgerId, monthlyRate, narration, transaction.id);
      const mirror = this.db.prepare('select id from loan_transactions where voucher_id=? and id<>?').get(voucherId, transaction.id) as any;
      if (oppositeAccount) {
        if (mirror) {
          this.db.prepare(`update loan_transactions set account_id=?, date=?, book=?, side=?, amount=?, counter_ledger_id=?, interest_amount=0, interest_ledger_id=null, monthly_rate=?, narration=? where id=?`)
            .run(oppositeAccount.id, transaction.date, transaction.book, transaction.side === 'Dr' ? 'Cr' : 'Dr', amount, account.ledger_id, round(oppositeAccount.default_rate ?? monthlyRate), narration, mirror.id);
        } else {
          this.db.prepare(`insert into loan_transactions (account_id, date, book, side, amount, counter_ledger_id, interest_amount, interest_ledger_id, monthly_rate, narration, voucher_id) values (?, ?, ?, ?, ?, ?, 0, null, ?, ?, ?)`)
            .run(oppositeAccount.id, transaction.date, transaction.book, transaction.side === 'Dr' ? 'Cr' : 'Dr', amount, account.ledger_id, round(oppositeAccount.default_rate ?? monthlyRate), narration, voucherId);
        }
      } else if (mirror) {
        this.db.prepare('delete from loan_transactions where id=?').run(mirror.id);
      }
    });
    update();
    this.autoBackup();
    return this.loanTransactionById(transaction.id);
  }

  deleteLoanTransaction(id: number): boolean {
    const row = this.db.prepare('select id, voucher_id from loan_transactions where id=?').get(id) as any;
    if (!row) return true;
    const tx = this.db.transaction(() => {
      if (row.voucher_id) {
        this.db.prepare('delete from loan_transactions where voucher_id=?').run(row.voucher_id);
        this.db.prepare('delete from voucher_entries where voucher_id=?').run(row.voucher_id);
        this.db.prepare('delete from vouchers where id=?').run(row.voucher_id);
      } else {
        this.db.prepare('delete from loan_transactions where id=?').run(id);
      }
    });
    tx();
    this.autoBackup();
    return true;
  }

  loanStatement(accountId: number, asOf = today()): LoanStatementRow[] {
    const rows = this.loanRows('where t.account_id=? order by t.date, t.id', [accountId]);
    return rows.map((row) => this.mapLoanStatementRow(row, asOf));
  }

  lendingSummary(asOf = today()): LoanSummaryRow[] {
    const accounts = this.db.prepare('select * from loan_accounts order by name').all() as any[];
    return accounts.map((account) => {
      const rows = this.loanRows('where t.account_id=?', [account.id]);
      let kBalance = 0;
      let pBalance = 0;
      kBalance += Number(account.opening_k_balance || 0) * (account.opening_k_type === 'Cr' ? -1 : 1);
      pBalance += Number(account.opening_p_balance || 0) * (account.opening_p_type === 'Cr' ? -1 : 1);
      for (const row of rows) {
        const signed = row.side === 'Dr' ? Number(row.amount) : -Number(row.amount);
        if (row.book === 'K') kBalance += signed;
        else pBalance += signed;
      }
      const totalBalance = round(kBalance + pBalance);
      const interest = this.accountInterestBreakdown(account, asOf);
      return {
        accountId: account.id,
        accountName: account.name,
        ledgerId: account.ledger_id,
        kBalance: round(kBalance),
        pBalance: round(pBalance),
        totalBalance,
        previousYearInterest: interest.previous,
        currentYearInterest: interest.current,
        interest: interest.total,
        netBalance: round(totalBalance + interest.total)
      };
    });
  }

  profitLossData(asOf = today(), bookFilter?: string): ProfitLossData {
    const book = bookFilter && bookFilter !== 'Combined' ? bookFilter : null;
    const allBalances = this.ledgerBalances({ book: bookFilter as any });

    const incomeRows = allBalances.filter((r) => r.groupName === 'Income');
    const expenseRows = allBalances.filter((r) => r.groupName === 'Expenses');

    // Calculate per-account interest split by book
    const accounts = this.db.prepare('select * from loan_accounts order by name').all() as any[];
    const interestReceivable: ProfitLossInterestRow[] = [];
    const interestPayable: ProfitLossInterestRow[] = [];

    for (const account of accounts) {
      const allRows = this.loanRows('where t.account_id=? order by t.date, t.id', [account.id]);
      const kRows = book === 'K' ? allRows.filter((r: any) => r.book === 'K') : allRows.filter((r: any) => r.book === 'K');
      const pRows = book === 'P' ? allRows.filter((r: any) => r.book === 'P') : allRows.filter((r: any) => r.book === 'P');

      // Calculate K book balance
      const kOpening = Number(account.opening_k_balance || 0) * (account.opening_k_type === 'Cr' ? -1 : 1);
      const pOpening = Number(account.opening_p_balance || 0) * (account.opening_p_type === 'Cr' ? -1 : 1);
      let kBal = kOpening;
      let pBal = pOpening;
      for (const r of allRows) {
        const signed = r.side === 'Dr' ? Number(r.amount) : -Number(r.amount);
        if (r.book === 'K') kBal += signed;
        else pBal += signed;
      }

      // Filter by book if needed
      let effectiveKBal = book === 'P' ? 0 : kBal;
      let effectivePBal = book === 'K' ? 0 : pBal;
      let effectiveKInt = book === 'P' ? 0 : this.accountCurrentInterest(account, asOf, 'K');
      let effectivePInt = book === 'K' ? 0 : this.accountCurrentInterest(account, asOf, 'P');

      const totalBalance = round(effectiveKBal + effectivePBal);
      const previousInterest = book ? 0 : round(account.previous_year_interest || 0);
      const totalInterest = round(effectiveKInt + effectivePInt + previousInterest);

      if (Math.abs(totalInterest) < 0.005) continue;

      const row: ProfitLossInterestRow = {
        accountId: account.id,
        accountName: account.name,
        category: account.category ?? 'Debtors',
        kBalance: round(effectiveKBal),
        pBalance: round(effectivePBal),
        totalBalance,
        kInterest: round(effectiveKInt + (book ? 0 : previousInterest)),
        pInterest: round(effectivePInt),
        totalInterest
      };

      if (totalBalance > 0) {
        // Dr balance = money lent = Interest Receivable (Income)
        interestReceivable.push(row);
      } else if (totalBalance < 0) {
        // Cr balance = money borrowed = Interest Payable (Expense)
        interestPayable.push({ ...row, totalInterest: Math.abs(totalInterest), kInterest: Math.abs(round(effectiveKInt)), pInterest: Math.abs(round(effectivePInt)) });
      }
    }

    return { incomeRows, expenseRows, interestReceivable, interestPayable };
  }

  report(name: string, filters: ReportFilters = {}): any {
    const normalized = name.toLowerCase();
    if (normalized === 'daybook') return this.listVouchers(filters);
    if (normalized === 'cashbook') return this.ledgerStatement(this.getOrCreateSystemLedger('Cash', 'Assets'), filters);
    if (normalized === 'bankbook') return this.ledgerStatement(this.getOrCreateSystemLedger('Bank', 'Assets'), filters);
    if (normalized === 'salesregister') return this.listInvoices({ ...filters, type: 'Sales' });
    if (normalized === 'purchaseregister') return this.listInvoices({ ...filters, type: 'Purchase' });
    if (normalized === 'stocksummary') return this.listItems();
    if (normalized === 'gstsummary') return this.gstSummary(filters);
    if (normalized === 'lendingsummary') return this.lendingSummary(filters.to ?? today());
    if (normalized === 'profitloss') return { profitLoss: this.profitLoss(filters), rows: this.ledgerBalances(filters).filter((row) => row.groupName === 'Income' || row.groupName === 'Expenses') };
    if (normalized === 'balancesheet') return { rows: this.ledgerBalances(filters).filter((row) => ['Assets', 'Liabilities', 'Capital'].includes(row.groupName)) };
    return this.listVouchers(filters);
  }

  async exportBackup(): Promise<BackupResult> {
    const result = await dialog.showSaveDialog({ title: 'Export Backup', defaultPath: `ledgerly-backup-${today()}.sqlite`, filters: [{ name: 'SQLite Database', extensions: ['sqlite', 'db'] }] });
    if (result.canceled || !result.filePath) return { ok: false, message: 'Backup cancelled.' };
    await this.db.backup(result.filePath);
    return { ok: true, path: result.filePath, message: 'Backup exported.' };
  }

  async restoreBackup(): Promise<BackupResult> {
    const result = await dialog.showOpenDialog({ title: 'Restore Backup', properties: ['openFile'], filters: [{ name: 'SQLite Database', extensions: ['sqlite', 'db'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, message: 'Restore cancelled.' };
    const source = result.filePaths[0];
    await this.restoreDatabaseFromFile(source, `before-restore-${Date.now()}.sqlite`);
    return { ok: true, path: source, message: 'Backup restored.' };
  }

  private assertValidBackup(source: string) {
    if (!fs.existsSync(source)) throw new Error('The restore backup file could not be found.');
    const check = new Database(source, { readonly: true });
    try {
      const integrity = check.pragma('integrity_check', { simple: true });
      const hasSettings = check.prepare("select name from sqlite_master where type='table' and name='settings'").get();
      if (integrity !== 'ok' || !hasSettings) throw new Error('The selected file is not a valid JJ Accounting backup.');
    } finally {
      check.close();
    }
  }

  private async restoreDatabaseFromFile(source: string, safetyFileName: string) {
    this.assertValidBackup(source);
    const safetyCopy = path.join(this.backupDir, safetyFileName);
    await this.db.backup(safetyCopy);
    this.db.close();
    try {
      fs.copyFileSync(source, this.dbPath);
      this.db = this.connectDatabase();
      this.migrate();
      this.seedSystemLedgers();
    } catch (error) {
      fs.copyFileSync(safetyCopy, this.dbPath);
      this.db = this.connectDatabase();
      this.migrate();
      this.seedSystemLedgers();
      throw error;
    }
  }

  setAutoBackup(enabled: boolean): boolean {
    this.setSetting('autoBackup', enabled ? '1' : '0');
    return enabled;
  }

  getAutoBackup(): boolean {
    return this.getSetting('autoBackup') === '1';
  }

  getCloudSyncSettings(): CloudSyncSettings {
    return this.readCloudSyncSettings();
  }

  saveCloudSyncSettings(settings: CloudSyncSettings): CloudSyncSettings {
    const authToken = settings.authToken.trim();
    const endpointUrl = settings.endpointUrl?.trim();
    if (settings.enabled && !authToken) throw new Error('Enter a cloud sync access key.');
    if (endpointUrl) this.validateCloudSyncEndpoint(endpointUrl);
    const next: CloudSyncSettings = {
      enabled: Boolean(settings.enabled),
      endpointUrl,
      authToken,
      cloudTenantId: settings.cloudTenantId,
      lastSyncedAt: settings.lastSyncedAt,
      lastSyncMessage: settings.lastSyncMessage,
      syncIntervalMinutes: settings.syncIntervalMinutes
    };
    this.writeCloudSyncSettings(next);
    // Restart timer to reflect new settings
    this.startAutoSyncTimer();
    return next;
  }

  async generateCloudAccessKey(settings?: CloudSyncSettings): Promise<CloudSyncSettings> {
    const current = { ...this.readCloudSyncSettings(), ...settings };
    const endpointUrl = this.getCloudSyncEndpoint(current);
    if (!endpointUrl) throw new Error('Cloud sync URL is not configured.');
    this.validateCloudSyncEndpoint(endpointUrl);

    const setupUrl = this.getCloudSetupEndpoint(current);
    const cloudTenantId = (current.cloudTenantId || randomCloudKeyPart(8)).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const secret = randomCloudKeyPart(16).replace(/(.{4})/g, '$1-').replace(/-$/, '');
    const accessKey = `${cloudTenantId}-${secret}`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (current.authToken?.trim()) headers.authorization = `Bearer ${current.authToken.trim()}`;

    const response = await fetch(setupUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ accessKey })
    });

    const responseText = await response.text().catch(() => '');
    let parsed: any = {};
    try {
      parsed = responseText ? JSON.parse(responseText) : {};
    } catch {}

    if (!response.ok) throw new Error(parsed.error || responseText || `Cloud server returned ${response.status}.`);

    const next: CloudSyncSettings = {
      ...current,
      enabled: true,
      endpointUrl: current.endpointUrl?.trim(),
      authToken: parsed.key || accessKey,
      cloudTenantId: parsed.tenantId || cloudTenantId,
      lastSyncMessage: 'Access key generated. Sync now to publish latest data.'
    };
    this.writeCloudSyncSettings(next);
    this.startAutoSyncTimer();
    return next;
  }

  async syncDatabaseToCloud(): Promise<CloudSyncResult> {
    const settings = this.readCloudSyncSettings();
    if (!settings.enabled) throw new Error('Cloud sync is not enabled.');

    // Resolve endpoint URL: prefer env var, fallback to stored value
    const endpointUrl = this.getCloudSyncEndpoint(settings);
    if (!endpointUrl) throw new Error('Cloud sync URL is not configured. Set CLOUD_SYNC_URL in your .env file.');
    if (!settings.authToken) throw new Error('Enter a cloud sync access key.');

    const syncedAt = new Date().toISOString();
    const snapshotPath = path.join(this.backupDir, `cloud-sync-${Date.now()}.sqlite`);
    await this.db.backup(snapshotPath);

    try {
      const company = this.getCompany();
      const headers: Record<string, string> = {
        'content-type': 'application/octet-stream',
        'x-file-name': 'jj-accounting.sqlite',
        'x-synced-at': syncedAt,
        'x-app-name': 'JJ Accounting'
      };
      if (company?.name) headers['x-company-name'] = encodeURIComponent(company.name);
      headers.authorization = `Bearer ${settings.authToken}`;

      const fileBuffer = fs.readFileSync(snapshotPath);
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers,
        body: new Uint8Array(fileBuffer)
      });

      const responseText = await response.text().catch(() => '');
      let parsedMessage = responseText;
      try {
        const parsed = JSON.parse(responseText);
        if (parsed.message) parsedMessage = parsed.message;
        else if (parsed.error) parsedMessage = parsed.error;
      } catch {}

      if (!response.ok) {
        if (response.status === 405) {
          throw new Error('Cloud sync server does not accept uploads. Please contact support to verify the sync endpoint.');
        }
        throw new Error(parsedMessage || `Cloud server returned ${response.status}.`);
      }

      const message = parsedMessage || 'Database synced to cloud.';
      const nextSettings = { ...settings, lastSyncedAt: syncedAt, lastSyncMessage: message };
      this.writeCloudSyncSettings(nextSettings);
      return { ok: true, message, syncedAt, endpointUrl, status: response.status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.writeCloudSyncSettings({ ...settings, lastSyncMessage: message });
      throw error;
    } finally {
      if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
    }
  }

  async exportInvoicePdf(invoiceId: number): Promise<BackupResult> {
    const invoice = this.hydrateInvoice(this.db.prepare('select i.*, l.name party_name from invoices i left join ledgers l on l.id=i.party_ledger_id where i.id=?').get(invoiceId) as any);
    const result = await dialog.showSaveDialog({ title: 'Export Invoice PDF', defaultPath: `${invoice.invoiceNo}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (result.canceled || !result.filePath) return { ok: false, message: 'PDF export cancelled.' };
    const { jsPDF } = await import('jspdf');
    const { autoTable } = await import('jspdf-autotable');
    const doc = new jsPDF();
    const company = this.getCompany();
    doc.setFontSize(16);
    doc.text(company?.name || 'Invoice', 14, 18);
    doc.setFontSize(10);
    doc.text(`${invoice.type} Invoice: ${invoice.invoiceNo}`, 14, 28);
    doc.text(`Date: ${invoice.date}`, 140, 28);
    doc.text(`Party: ${invoice.partyName || ''}`, 14, 36);
    autoTable(doc, {
      startY: 44,
      head: [['Item', 'Qty', 'Rate', 'Disc', 'GST %', 'Total']],
      body: invoice.items.map((item) => {
        const line = this.invoiceLine(item);
        return [item.itemName ?? '', item.qty, item.rate, item.discount, item.gstRate, line.total.toFixed(2)];
      })
    });
    doc.text(`Grand Total: ${invoice.grandTotal?.toFixed(2)}`, 140, (doc as any).lastAutoTable.finalY + 12);
    const pdf = Buffer.from(doc.output('arraybuffer'));
    fs.writeFileSync(result.filePath, pdf);
    return { ok: true, path: result.filePath, message: 'Invoice PDF exported.' };
  }

  private migrate() {
    this.db.exec(`
      create table if not exists migrations (id integer primary key, name text not null unique, run_at text default current_timestamp);
      create table if not exists company (
        id integer primary key,
        name text not null,
        shop_no text default '',
        address text default '',
        phone text default '',
        email text default '',
        gstin text default '',
        financial_year text default '',
        updated_at text default current_timestamp
      );
      create table if not exists users (
        id integer primary key,
        username text not null unique,
        password_hash text not null,
        updated_at text default current_timestamp
      );
      create table if not exists ledgers (
        id integer primary key,
        name text not null unique,
        group_name text not null,
        opening_balance real not null default 0,
        opening_type text not null default 'Dr',
        party_type text,
        gstin text,
        phone text,
        email text,
        address text,
        is_system integer not null default 0,
        updated_at text default current_timestamp
      );
      create table if not exists items (
        id integer primary key,
        name text not null unique,
        sku text,
        unit text not null default 'Nos',
        price real not null default 0,
        gst_rate real not null default 0,
        stock real not null default 0,
        updated_at text default current_timestamp
      );
      create table if not exists vouchers (
        id integer primary key,
        voucher_no text not null unique,
        type text not null,
        date text not null,
        party_ledger_id integer,
        narration text default '',
        total_debit real not null,
        total_credit real not null,
        updated_at text default current_timestamp,
        foreign key (party_ledger_id) references ledgers(id) on delete set null
      );
      create table if not exists voucher_entries (
        id integer primary key,
        voucher_id integer not null,
        ledger_id integer not null,
        debit real not null default 0,
        credit real not null default 0,
        narration text default '',
        foreign key (voucher_id) references vouchers(id) on delete cascade,
        foreign key (ledger_id) references ledgers(id)
      );
      create table if not exists invoices (
        id integer primary key,
        invoice_no text not null unique,
        type text not null,
        date text not null,
        party_ledger_id integer not null,
        subtotal real not null,
        discount_total real not null,
        gst_total real not null,
        grand_total real not null,
        notes text default '',
        updated_at text default current_timestamp,
        foreign key (party_ledger_id) references ledgers(id)
      );
      create table if not exists invoice_items (
        id integer primary key,
        invoice_id integer not null,
        item_id integer not null,
        qty real not null,
        rate real not null,
        discount real not null default 0,
        gst_rate real not null default 0,
        taxable real not null,
        gst_amount real not null,
        total real not null,
        foreign key (invoice_id) references invoices(id) on delete cascade,
        foreign key (item_id) references items(id)
      );
      create table if not exists loan_accounts (
        id integer primary key,
        name text not null unique,
        ledger_id integer not null unique,
        category text not null default 'Debtors',
        phone text,
        address text,
        default_rate real not null default 1.5,
        note text,
        updated_at text default current_timestamp,
        foreign key (ledger_id) references ledgers(id)
      );
      create table if not exists loan_transactions (
        id integer primary key,
        account_id integer not null,
        date text not null,
        book text not null check (book in ('K','P')),
        side text not null check (side in ('Dr','Cr')),
        amount real not null,
        counter_ledger_id integer not null,
        interest_amount real not null default 0,
        interest_ledger_id integer,
        monthly_rate real not null default 1.5,
        narration text default '',
        voucher_id integer,
        created_at text default current_timestamp,
        foreign key (account_id) references loan_accounts(id) on delete cascade,
        foreign key (counter_ledger_id) references ledgers(id),
        foreign key (interest_ledger_id) references ledgers(id),
        foreign key (voucher_id) references vouchers(id)
      );
      create table if not exists counters (prefix text primary key, value integer not null);
      create table if not exists settings (key text primary key, value text not null);
      create index if not exists idx_vouchers_date on vouchers(date);
      create index if not exists idx_entries_ledger on voucher_entries(ledger_id);
      create index if not exists idx_invoices_date on invoices(date);
      create index if not exists idx_loan_transactions_account on loan_transactions(account_id);
      create index if not exists idx_loan_transactions_date on loan_transactions(date);
      
      create table if not exists balance_bd_history (
        id integer primary key,
        ledger_id integer not null,
        loan_account_id integer not null,
        date text not null,
        pre_k_balance real not null,
        pre_k_type text not null,
        pre_p_balance real not null,
        pre_p_type text not null,
        pre_opening_balance real not null,
        pre_opening_type text not null,
        pre_opening_date text not null,
        post_k_balance real not null,
        post_k_type text not null,
        post_p_balance real not null,
        post_p_type text not null,
        post_opening_balance real not null,
        post_opening_type text not null,
        post_opening_date text not null,
        pdf_path text,
        created_at text default current_timestamp,
        foreign key (ledger_id) references ledgers(id) on delete cascade,
        foreign key (loan_account_id) references loan_accounts(id) on delete cascade
      );
      create table if not exists financial_year_archives (
        id integer primary key,
        from_financial_year text not null,
        to_financial_year text not null,
        period_start text not null,
        period_end text not null,
        company_snapshot_json text not null,
        trial_balance_json text not null,
        balance_sheet_json text not null,
        profit_loss_json text not null,
        ledger_statements_json text not null,
        document_path text,
        snapshot_path text,
        backup_path text,
        voucher_count integer not null default 0,
        invoice_count integer not null default 0,
        ledger_count integer not null default 0,
        created_at text default current_timestamp
      );
      create table if not exists audit_logs (
        id integer primary key,
        entity_type text not null,
        entity_id integer,
        action text not null,
        details_json text not null,
        created_at text default current_timestamp
      );
    `);
    this.addColumnIfMissing('loan_accounts', 'category', "text not null default 'Debtors'");
    this.addColumnIfMissing('voucher_entries', 'balance_bd_id', 'integer');
    this.addColumnIfMissing('loan_transactions', 'balance_bd_id', 'integer');
    this.addColumnIfMissing('vouchers', 'financial_year_archive_id', 'integer');
    this.addColumnIfMissing('voucher_entries', 'financial_year_archive_id', 'integer');
    this.addColumnIfMissing('invoices', 'financial_year_archive_id', 'integer');
    this.addColumnIfMissing('loan_transactions', 'financial_year_archive_id', 'integer');
    this.addColumnIfMissing('company', 'shop_no', "text not null default ''");
    this.addColumnIfMissing('loan_transactions', 'interest_amount', 'real not null default 0');
    this.addColumnIfMissing('loan_transactions', 'interest_ledger_id', 'integer');
    this.addColumnIfMissing('loan_accounts', 'opening_book', "text not null default 'K'");
    this.addColumnIfMissing('loan_accounts', 'opening_k_balance', 'real not null default 0');
    this.addColumnIfMissing('loan_accounts', 'opening_k_type', "text not null default 'Dr'");
    this.addColumnIfMissing('loan_accounts', 'opening_p_balance', 'real not null default 0');
    this.addColumnIfMissing('loan_accounts', 'opening_p_type', "text not null default 'Dr'");
    this.addColumnIfMissing('loan_accounts', 'opening_date', "text not null default ''");
    this.addColumnIfMissing('loan_accounts', 'is_pinned', 'integer not null default 0');
    this.addColumnIfMissing('loan_accounts', 'previous_year_interest', 'real not null default 0');
    this.addColumnIfMissing('loan_accounts', 'current_interest_start_date', "text not null default ''");
    this.addColumnIfMissing('loan_accounts', 'last_interest_posted_date', 'text');
    this.addColumnIfMissing('financial_year_archives', 'previous_interest_json', 'text');
    this.addColumnIfMissing('audit_logs', 'entity_type', "text not null default ''");
    this.addColumnIfMissing('audit_logs', 'entity_id', 'integer');
    this.addColumnIfMissing('audit_logs', 'action', "text not null default ''");
    this.addColumnIfMissing('audit_logs', 'details_json', "text not null default '{}'");
    this.db.prepare("update loan_accounts set opening_date=? where opening_date is null or opening_date='' ").run(today());
    this.db.prepare("update loan_accounts set current_interest_start_date=opening_date where current_interest_start_date is null or current_interest_start_date=''").run();
    if (this.getSetting('dual_opening_migrated') !== '1') {
      this.db.prepare(
        `update loan_accounts set
          opening_k_balance=case when opening_book='K' then coalesce((select opening_balance from ledgers where id=ledger_id),0) else 0 end,
          opening_k_type=coalesce((select opening_type from ledgers where id=ledger_id),'Dr'),
          opening_p_balance=case when opening_book='P' then coalesce((select opening_balance from ledgers where id=ledger_id),0) else 0 end,
          opening_p_type=coalesce((select opening_type from ledgers where id=ledger_id),'Dr')`
      ).run();
      this.setSetting('dual_opening_migrated', '1');
    }
    if (this.getSetting('income_expense_group_migrated') !== '1') {
      this.db.prepare(
        `update ledgers set group_name='Income' where id in (select ledger_id from loan_accounts where lower(category) like '%income%')`
      ).run();
      this.db.prepare(
        `update ledgers set group_name='Expenses' where id in (select ledger_id from loan_accounts where lower(category) like '%expense%' or lower(category) like '%expanse%')`
      ).run();
      this.setSetting('income_expense_group_migrated', '1');
    }
  }

  private seedSystemLedgers() {
    // Accounts are intentionally not seeded. The user creates Cash, Bank,
    // customers, and all other ledgers according to their own books.
  }

  private getOrCreateSystemLedger(name: string, groupName: AccountGroup): number {
    const row = this.db.prepare('select id from ledgers where name=?').get(name) as any;
    if (row) return row.id;
    const result = this.db.prepare("insert into ledgers (name, group_name, opening_type, is_system) values (?, ?, 'Dr', 1)").run(name, groupName);
    return Number(result.lastInsertRowid);
  }

  private getOrCreatePartyLedger(name: string, category: LoanAccountCategory = 'Debtors'): number {
    const row = this.db.prepare('select id from ledgers where name=?').get(name) as any;
    if (row) return row.id;
    const result = this.db.prepare(
      "insert into ledgers (name, group_name, opening_type, party_type) values (?, ?, 'Dr', 'customer')"
    ).run(name, loanCategoryGroup(category));
    return Number(result.lastInsertRowid);
  }

  private getOrCreateSystemLoanAccount(name: string, ledgerId: number) {
    const row = this.db.prepare('select id from loan_accounts where name=? or ledger_id=?').get(name, ledgerId);
    if (row) return;
    this.db.prepare(
      'insert into loan_accounts (name, ledger_id, default_rate, note) values (?, ?, ?, ?)'
    ).run(name, ledgerId, 0, 'System khacha/packa account');
  }

  private parseFinancialYear(financialYear: string): FinancialYearPeriod {
    const normalized = financialYear.trim();
    const explicitDates = normalized.match(/(\d{4}-\d{2}-\d{2})\D+(\d{4}-\d{2}-\d{2})/);
    if (explicitDates) return { start: explicitDates[1], end: explicitDates[2] };

    const yearRange = normalized.match(/(\d{4})\D+(\d{2,4})/);
    if (!yearRange) throw new Error('Use a financial year like 2025-2026 or 2025-26.');

    const startYear = Number(yearRange[1]);
    let endYear = Number(yearRange[2]);
    if (endYear < 100) endYear = Math.floor(startYear / 100) * 100 + endYear;
    if (endYear <= startYear) endYear += 100;
    if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) throw new Error('Financial year format is invalid.');
    return { start: `${startYear}-04-01`, end: `${endYear}-03-31` };
  }

  private addDays(date: string, days: number): string {
    const [year, month, day] = date.split('-').map(Number);
    const value = new Date(Date.UTC(year, month - 1, day + days));
    return value.toISOString().slice(0, 10);
  }

  private safeFileName(name: string): string {
    return name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  }

  private signedToBalance(value: number) {
    const rounded = round(value);
    return { amount: Math.abs(rounded), type: rounded < 0 ? 'Cr' : 'Dr' };
  }

  private rollForwardOpeningBalances(trialBalance: TrialBalanceRow[], periodEnd: string, nextOpeningDate: string) {
    const loanAccounts = this.db.prepare('select * from loan_accounts').all() as any[];
    const loanBalanceByLedger = new Map<number, { k: number; p: number; total: number }>();
    for (const account of loanAccounts) {
      const k = this.loanBookBalance(account, 'K', periodEnd);
      const p = this.loanBookBalance(account, 'P', periodEnd);
      loanBalanceByLedger.set(account.ledger_id, { k, p, total: round(k + p) });
      const kBalance = this.signedToBalance(k);
      const pBalance = this.signedToBalance(p);
      this.db.prepare(
        `update loan_accounts set opening_k_balance=?, opening_k_type=?, opening_p_balance=?, opening_p_type=?, opening_date=?, updated_at=datetime('now') where id=?`
      ).run(kBalance.amount, kBalance.type, pBalance.amount, pBalance.type, nextOpeningDate, account.id);
    }

    const trialByLedger = new Map(trialBalance.map((row) => [row.ledgerId, row]));
    const ledgers = this.db.prepare('select * from ledgers').all() as any[];
    for (const ledger of ledgers) {
      const loanBalance = loanBalanceByLedger.get(ledger.id);
      const trial = trialByLedger.get(ledger.id);
      let signed = trial ? round(trial.debit - trial.credit) : Number(ledger.opening_balance || 0) * (ledger.opening_type === 'Cr' ? -1 : 1);
      if (loanBalance) signed = loanBalance.total;
      if (!loanBalance && ['Income', 'Expenses'].includes(ledger.group_name)) signed = 0;
      const next = this.signedToBalance(signed);
      this.db.prepare("update ledgers set opening_balance=?, opening_type=?, updated_at=datetime('now') where id=?").run(next.amount, next.type, ledger.id);
    }
  }

  private storePreviousYearInterest(periodEnd: string, nextOpeningDate: string) {
    const accounts = this.db.prepare('select * from loan_accounts').all() as any[];
    const stmt = this.db.prepare(
      "update loan_accounts set previous_year_interest=?, current_interest_start_date=?, updated_at=datetime('now') where id=?"
    );
    for (const account of accounts) {
      const currentInterest = this.accountCurrentInterest(account, periodEnd);
      const previousInterest = round(Number(account.previous_year_interest || 0) + currentInterest);
      stmt.run(previousInterest, nextOpeningDate, account.id);
    }
  }

  private loanPreviousInterestSnapshot(asOf?: string) {
    const accounts = this.db.prepare('select * from loan_accounts order by name').all() as any[];
    return accounts.map((account) => {
      const previous = round(account.previous_year_interest || 0);
      const current = asOf ? this.accountCurrentInterest(account, asOf) : 0;
      return {
        accountId: account.id,
        accountName: account.name,
        previousYearInterest: previous,
        currentYearInterest: current,
        totalInterest: round(previous + current)
      };
    });
  }

  private accountInterestBreakdown(account: any, asOf: string, bookFilter?: ReportBook): AccountInterestBreakdown {
    const previous = bookFilter && bookFilter !== 'Combined' ? 0 : round(account.previous_year_interest || 0);
    const current = this.accountCurrentInterest(account, asOf, bookFilter);
    return { previous, current, total: round(previous + current) };
  }

  private accountCurrentInterest(account: any, asOf: string, bookFilter?: ReportBook): number {
    const rows = this.loanRows('where t.account_id=? order by t.date, t.id', [account.id]);
    const books: LoanBook[] = bookFilter === 'K' || bookFilter === 'P' ? [bookFilter] : ['K', 'P'];
    let interest = 0;
    for (const book of books) {
      const opening = book === 'K' ? Number(account.opening_k_balance || 0) : Number(account.opening_p_balance || 0);
      const openingType = book === 'K' ? account.opening_k_type : account.opening_p_type;
      const signedOpening = opening * (openingType === 'Cr' ? -1 : 1);
      const startDate = this.maxDate(account.opening_date || today(), account.current_interest_start_date || account.opening_date || today());
      const openingDays = this.daysBetween(startDate, asOf);
      interest += Math.abs(signedOpening) * Number(account.default_rate || 0) / 100 / 30 * openingDays * (signedOpening >= 0 ? 1 : -1);
    }
    for (const row of rows) {
      if (bookFilter === 'K' || bookFilter === 'P') {
        if (row.book !== bookFilter) continue;
      }
      interest += this.loanInterest(row, asOf);
    }
    return round(interest);
  }

  private maxDate(left: string, right: string): string {
    if (!left) return right;
    if (!right) return left;
    return left >= right ? left : right;
  }

  private loanBookBalance(account: any, book: LoanBook, asOf: string): number {
    const opening = book === 'K' ? Number(account.opening_k_balance || 0) : Number(account.opening_p_balance || 0);
    const openingType = book === 'K' ? account.opening_k_type : account.opening_p_type;
    let balance = opening * (openingType === 'Cr' ? -1 : 1);
    const rows = this.loanRows('where t.account_id=? and t.date <= ?', [account.id, asOf]);
    for (const row of rows) {
      if (row.book !== book) continue;
      balance += Number(row.amount || 0) * (row.side === 'Cr' ? -1 : 1);
    }
    return round(balance);
  }

  private ledgerOpeningSigned(ledger: Ledger): number {
    const loanAccount = ledger.id ? this.db.prepare('select * from loan_accounts where ledger_id=?').get(ledger.id) as any : null;
    if (loanAccount) {
      const k = Number(loanAccount.opening_k_balance || 0) * (loanAccount.opening_k_type === 'Cr' ? -1 : 1);
      const p = Number(loanAccount.opening_p_balance || 0) * (loanAccount.opening_p_type === 'Cr' ? -1 : 1);
      return round(k + p);
    }
    return round(Number(ledger.openingBalance || 0) * (ledger.openingType === 'Cr' ? -1 : 1));
  }

  private ledgerOpeningSignedForBook(ledger: Ledger, book: ReportBook): number {
    const loanAccount = ledger.id ? this.db.prepare('select * from loan_accounts where ledger_id=?').get(ledger.id) as any : null;
    if (loanAccount) {
      const k = Number(loanAccount.opening_k_balance || 0) * (loanAccount.opening_k_type === 'Cr' ? -1 : 1);
      const p = Number(loanAccount.opening_p_balance || 0) * (loanAccount.opening_p_type === 'Cr' ? -1 : 1);
      if (book === 'K') return round(k);
      if (book === 'P') return round(p);
      return round(k + p);
    }
    if (book !== 'Combined') return 0;
    return round(Number(ledger.openingBalance || 0) * (ledger.openingType === 'Cr' ? -1 : 1));
  }

  private ledgerStatementForBook(ledgerId: number, filters: ReportFilters = {}): LedgerStatementRow[] {
    const book = filters.book && filters.book !== 'Combined' ? filters.book : null;
    const rows = this.db.prepare(
      `select v.date, v.voucher_no, v.type, coalesce(ve.narration, v.narration) narration, ve.debit, ve.credit
       from voucher_entries ve join vouchers v on v.id=ve.voucher_id
       where ve.ledger_id=? and ve.balance_bd_id is null and ve.financial_year_archive_id is null ${filters.from ? 'and v.date >= ?' : ''} ${filters.to ? 'and v.date <= ?' : ''}
         and (? is null or exists (select 1 from loan_transactions lt where lt.voucher_id=v.id and lt.book=?))
       order by v.date, v.id`
    ).all(ledgerId, ...[filters.from, filters.to].filter(Boolean), book, book) as any[];
    let balance = 0;
    return rows.map((row) => {
      balance += Number(row.debit) - Number(row.credit);
      return {
        date: row.date,
        voucherNo: row.voucher_no,
        type: row.type,
        narration: row.narration,
        debit: round(row.debit),
        credit: round(row.credit),
        balance: round(balance)
      };
    });
  }

  private financialYearBookReport(book: ReportBook, ledgers: Ledger[], period: FinancialYearPeriod) {
    const trialBalance = this.trialBalance({ to: period.end, book });
    const profitLoss = this.profitLossData(period.end, book);
    const ledgerStatements = ledgers.map((ledger) => {
      const closing = trialBalance.find((row) => row.ledgerId === ledger.id);
      const openingBalance = this.ledgerOpeningSignedForBook(ledger, book);
      const rows = ledger.id ? this.ledgerStatementForBook(ledger.id, { from: period.start, to: period.end, book }).map((row) => ({ ...row, balance: round(row.balance + openingBalance) })) : [];
      return {
        ledger,
        openingBalance,
        closingBalance: closing ? round(closing.debit - closing.credit) : 0,
        rows
      };
    });
    return {
      book,
      label: book === 'K' ? 'Kacha' : book === 'P' ? 'Packa' : 'Combined',
      trialBalance,
      balanceSheet: trialBalance.filter((row) => ['Assets', 'Liabilities', 'Capital'].includes(row.groupName)),
      profitLoss,
      ledgers: ledgerStatements
    };
  }

  private latestFinancialYearArchive(): FinancialYearArchive {
    const row = this.db.prepare('select * from financial_year_archives order by id desc limit 1').get() as any;
    if (!row) throw new Error('No financial year archive has been created yet.');
    return this.mapFinancialYearArchive(row);
  }

  private mapFinancialYearArchive(row: any): FinancialYearArchive {
    return {
      id: row.id,
      fromFinancialYear: row.from_financial_year,
      toFinancialYear: row.to_financial_year,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      documentPath: row.document_path,
      snapshotPath: row.snapshot_path,
      backupPath: row.backup_path,
      voucherCount: Number(row.voucher_count || 0),
      invoiceCount: Number(row.invoice_count || 0),
      ledgerCount: Number(row.ledger_count || 0),
      createdAt: row.created_at
    };
  }

  private async writeFinancialYearDocument(archiveLabel: string, snapshot: any, yearDir: string, safeYear: string): Promise<string> {
    const htmlPath = path.join(yearDir, `${safeYear}-report.html`);
    const pdfPath = path.join(yearDir, `${safeYear}-report.pdf`);
    fs.writeFileSync(htmlPath, this.financialYearHtml(snapshot));

    const { jsPDF } = await import('jspdf');
    const { autoTable } = await import('jspdf-autotable');
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const margin = 36;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const title = `${snapshot.company.name || 'Firm'} - Financial Year ${snapshot.fromFinancialYear}`;
    const periodText = `Period: ${this.formatDateText(snapshot.periodStart)} to ${this.formatDateText(snapshot.periodEnd)} | Closed to: ${snapshot.toFinancialYear}`;

    let y = 78;
    const drawHeader = (heading?: string) => {
      doc.setFontSize(15);
      doc.text(snapshot.company.name || 'Financial Year Archive', margin, 30);
      doc.setFontSize(9);
      doc.text(periodText, margin, 45);
      if (snapshot.company.address) doc.text(String(snapshot.company.address).slice(0, 130), margin, 59);
      doc.setDrawColor(17, 24, 39);
      doc.line(margin, 66, pageWidth - margin, 66);
      if (heading) {
        doc.setFontSize(12);
        doc.text(heading, pageWidth / 2, 84, { align: 'center' });
        y = 102;
      } else {
        y = 78;
      }
    };
    const addPage = (heading?: string) => {
      doc.addPage();
      drawHeader(heading);
    };
    const section = (heading: string) => {
      if (y > pageHeight - 130) addPage();
      doc.setFontSize(12);
      doc.text(heading, margin, y);
      y += 12;
    };
    const table = (head: string[][], body: any[][], options: Record<string, unknown> = {}) => {
      autoTable(doc, {
        head,
        body,
        startY: y,
        margin: { left: margin, right: margin },
        theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak', lineColor: [148, 163, 184], lineWidth: 0.4 },
        headStyles: { fillColor: [31, 41, 55], textColor: 255, halign: 'center' },
        footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        didDrawPage: () => drawFooter(),
        ...options
      });
      y = ((doc as any).lastAutoTable?.finalY ?? y) + 18;
    };
    const drawFooter = () => {
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(`Archive: ${archiveLabel}`, margin, pageHeight - 18);
      doc.text(`Generated by JJ Accounting`, pageWidth - margin, pageHeight - 18, { align: 'right' });
      doc.setTextColor(0);
    };
    const signedBalance = (row: TrialBalanceRow) => round(Number(row.debit || 0) - Number(row.credit || 0));
    const debitCreditAmount = (row: TrialBalanceRow) => Math.abs(signedBalance(row));
    const total = (rows: TrialBalanceRow[], side: 'debit' | 'credit') =>
      round(rows.reduce((sum, row) => sum + (side === 'debit' ? Number(row.debit || 0) : Number(row.credit || 0)), 0));
    const pairedTableRows = (leftRows: any[][], rightRows: any[][], minRows = 1) => {
      const count = Math.max(leftRows.length, rightRows.length, minRows);
      return Array.from({ length: count }, (_, index) => [...(leftRows[index] ?? ['', '']), ...(rightRows[index] ?? ['', ''])]);
    };

    const reports = [
      snapshot.bookReports?.Combined ?? {
        label: 'Combined',
        trialBalance: snapshot.trialBalance,
        balanceSheet: snapshot.balanceSheet,
        profitLoss: snapshot.profitLoss,
        ledgers: snapshot.ledgers
      },
      snapshot.bookReports?.K,
      snapshot.bookReports?.P
    ].filter(Boolean);

    const renderBookReport = (report: any, isFirst: boolean) => {
      if (isFirst) drawHeader(`${report.label} Book Reports`);
      else addPage(`${report.label} Book Reports`);

      const reportInterestReceivable = report.profitLoss.interestReceivable ?? [];
      const reportInterestPayable = report.profitLoss.interestPayable ?? [];
      const reportInterestReceivableTotal = round(reportInterestReceivable.reduce((sum: number, row: any) => sum + Number(row.totalInterest || 0), 0));
      const reportInterestPayableTotal = round(reportInterestPayable.reduce((sum: number, row: any) => sum + Number(row.totalInterest || 0), 0));
      const reportIncomeRows = report.profitLoss.incomeRows ?? [];
      const reportExpenseRows = report.profitLoss.expenseRows ?? [];
      const reportIncome = round(reportIncomeRows.reduce((sum: number, row: TrialBalanceRow) => sum + row.credit - row.debit, 0) + reportInterestReceivableTotal);
      const reportExpenses = round(reportExpenseRows.reduce((sum: number, row: TrialBalanceRow) => sum + row.debit - row.credit, 0) + reportInterestPayableTotal);
      const reportNetProfit = round(reportIncome - reportExpenses);

      section(`${report.label} Trial Balance`);
      table(
        [['Account', 'Group', 'Debit', 'Credit']],
        report.trialBalance.map((row: TrialBalanceRow) => [row.ledgerName, row.groupName, this.moneyText(row.debit), this.moneyText(row.credit)]),
        {
          foot: [['Total', '', this.moneyText(total(report.trialBalance, 'debit')), this.moneyText(total(report.trialBalance, 'credit'))]],
          columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } }
        }
      );

      section(`${report.label} Profit and Loss Account`);
      const expenseSide = reportExpenseRows
        .map((row: TrialBalanceRow) => [row.ledgerName, this.moneyText(Math.max(0, row.debit - row.credit))])
        .filter((row: any[]) => Number(row[1]) > 0);
      if (reportInterestPayableTotal > 0) expenseSide.push(['Accrued Interest Payable', this.moneyText(reportInterestPayableTotal)]);
      const incomeSide = reportIncomeRows
        .map((row: TrialBalanceRow) => [row.ledgerName, this.moneyText(Math.max(0, row.credit - row.debit))])
        .filter((row: any[]) => Number(row[1]) > 0);
      if (reportInterestReceivableTotal > 0) incomeSide.push(['Accrued Interest Receivable', this.moneyText(reportInterestReceivableTotal)]);
      if (reportNetProfit >= 0) expenseSide.push(['Net Profit', this.moneyText(reportNetProfit)]);
      else incomeSide.push(['Net Loss', this.moneyText(Math.abs(reportNetProfit))]);
      const profitLossTotal = Math.max(reportIncome, reportExpenses);
      table(
        [['Dr. Expenses', 'Amount', 'Cr. Income', 'Amount']],
        pairedTableRows(expenseSide, incomeSide),
        {
          foot: [['Total', this.moneyText(profitLossTotal), 'Total', this.moneyText(profitLossTotal)]],
          columnStyles: { 1: { halign: 'right' }, 3: { halign: 'right' } }
        }
      );

      section(`${report.label} Balance Sheet`);
      const liabilityRows = report.balanceSheet
        .filter((row: TrialBalanceRow) => ['Liabilities', 'Capital'].includes(row.groupName))
        .map((row: TrialBalanceRow) => [row.ledgerName, this.moneyText(Math.max(0, -signedBalance(row)))])
        .filter((row: any[]) => Number(row[1]) > 0);
      const assetRows = report.balanceSheet
        .filter((row: TrialBalanceRow) => row.groupName === 'Assets')
        .map((row: TrialBalanceRow) => [row.ledgerName, this.moneyText(debitCreditAmount(row))])
        .filter((row: any[]) => Number(row[1]) > 0);
      const liabilitiesTotal = round(liabilityRows.reduce((sum: number, row: any[]) => sum + Number(row[1] || 0), 0));
      const assetsTotal = round(assetRows.reduce((sum: number, row: any[]) => sum + Number(row[1] || 0), 0));
      table(
        [['Liabilities & Capital', 'Amount', 'Assets', 'Amount']],
        pairedTableRows(liabilityRows, assetRows),
        {
          foot: [['Total', this.moneyText(liabilitiesTotal), 'Total', this.moneyText(assetsTotal)]],
          columnStyles: { 1: { halign: 'right' }, 3: { halign: 'right' } }
        }
      );

      section(`${report.label} Ledger Index`);
      table(
        [['Ledger', 'Group', 'Opening', 'Closing', 'Entries']],
        report.ledgers.map((entry: any) => [entry.ledger.name, entry.ledger.groupName, this.balanceText(entry.openingBalance), this.balanceText(entry.closingBalance), String(entry.rows.length)]),
        { columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } } }
      );

      for (const entry of report.ledgers) {
        if (!entry.rows.length && Math.abs(entry.openingBalance || 0) < 0.005 && Math.abs(entry.closingBalance || 0) < 0.005) continue;
        addPage(`${report.label} Ledger Account: ${entry.ledger.name}`);
        const debitRows: any[][] = [];
        const creditRows: any[][] = [];
        const opening = round(entry.openingBalance || 0);
        if (opening > 0) debitRows.push(['', 'To Opening Balance', '', this.moneyText(opening)]);
        if (opening < 0) creditRows.push(['', 'By Opening Balance', '', this.moneyText(Math.abs(opening))]);
        for (const row of entry.rows as LedgerStatementRow[]) {
          if (Number(row.debit || 0) > 0) debitRows.push([this.formatDateText(row.date), `To ${row.narration || row.type}`, row.voucherNo, this.moneyText(row.debit)]);
          if (Number(row.credit || 0) > 0) creditRows.push([this.formatDateText(row.date), `By ${row.narration || row.type}`, row.voucherNo, this.moneyText(row.credit)]);
        }
        const closing = round(entry.closingBalance || 0);
        if (closing > 0) creditRows.push(['', 'By Balance c/d', '', this.moneyText(closing)]);
        if (closing < 0) debitRows.push(['', 'To Balance c/d', '', this.moneyText(Math.abs(closing))]);
        const debitTotal = round(debitRows.reduce((sum, row) => sum + Number(row[3] || 0), 0));
        const creditTotal = round(creditRows.reduce((sum, row) => sum + Number(row[3] || 0), 0));
        table(
          [['Date', 'Debit Particulars', 'Vch', 'Amount', 'Date', 'Credit Particulars', 'Vch', 'Amount']],
          pairedTableRows(debitRows, creditRows, 6),
          {
            foot: [['', 'Total', '', this.moneyText(debitTotal), '', 'Total', '', this.moneyText(creditTotal)]],
            columnStyles: { 3: { halign: 'right' }, 7: { halign: 'right' } }
          }
        );
      }
    };

    reports.forEach((report, index) => renderBookReport(report, index === 0));

    doc.setProperties({ title, subject: 'Financial year archive', creator: 'JJ Accounting' });
    const pdf = Buffer.from(doc.output('arraybuffer'));
    fs.writeFileSync(pdfPath, pdf);
    return pdfPath;
  }

  private financialYearHtml(snapshot: any): string {
    const rows = (items: any[], cells: (item: any) => string[], className = '') => items.map((item) => `<tr${className ? ` class="${className}"` : ''}>${cells(item).map((cell) => `<td>${this.escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
    const table = (head: string[], body: string, foot = '') => `<table><thead><tr>${head.map((cell) => `<th>${this.escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${head.length}">No records</td></tr>`}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table>`;
    const signedBalance = (row: TrialBalanceRow) => round(Number(row.debit || 0) - Number(row.credit || 0));
    const pairedRows = (leftRows: string[][], rightRows: string[][], minRows = 1) => {
      const count = Math.max(leftRows.length, rightRows.length, minRows);
      return Array.from({ length: count }, (_, index) => {
        const left = leftRows[index] ?? ['', ''];
        const right = rightRows[index] ?? ['', ''];
        return `<tr><td>${this.escapeHtml(left[0])}</td><td class="num">${this.escapeHtml(left[1])}</td><td>${this.escapeHtml(right[0])}</td><td class="num">${this.escapeHtml(right[1])}</td></tr>`;
      }).join('');
    };
    const reports = [
      snapshot.bookReports?.Combined ?? {
        label: 'Combined',
        trialBalance: snapshot.trialBalance,
        balanceSheet: snapshot.balanceSheet,
        profitLoss: snapshot.profitLoss,
        ledgers: snapshot.ledgers
      },
      snapshot.bookReports?.K,
      snapshot.bookReports?.P
    ].filter(Boolean);
    const reportSections = reports.map((report: any) => {
      const interestReceivable = report.profitLoss.interestReceivable ?? [];
      const interestPayable = report.profitLoss.interestPayable ?? [];
      const totalInterestReceivable = round(interestReceivable.reduce((sum: number, row: any) => sum + Number(row.totalInterest || 0), 0));
      const totalInterestPayable = round(interestPayable.reduce((sum: number, row: any) => sum + Number(row.totalInterest || 0), 0));
      const incomeRows = report.profitLoss.incomeRows ?? [];
      const expenseRows = report.profitLoss.expenseRows ?? [];
      const income = round(incomeRows.reduce((sum: number, row: TrialBalanceRow) => sum + row.credit - row.debit, 0) + totalInterestReceivable);
      const expenses = round(expenseRows.reduce((sum: number, row: TrialBalanceRow) => sum + row.debit - row.credit, 0) + totalInterestPayable);
      const netProfit = round(income - expenses);
      const trialDebit = round(report.trialBalance.reduce((sum: number, row: TrialBalanceRow) => sum + Number(row.debit || 0), 0));
      const trialCredit = round(report.trialBalance.reduce((sum: number, row: TrialBalanceRow) => sum + Number(row.credit || 0), 0));
      const trialRows = rows(report.trialBalance, (row: TrialBalanceRow) => [row.ledgerName, row.groupName, this.moneyText(row.debit), this.moneyText(row.credit)]);

      const expenseSide = expenseRows
        .map((row: TrialBalanceRow) => [row.ledgerName, this.moneyText(Math.max(0, row.debit - row.credit))])
        .filter((row: string[]) => Number(row[1]) > 0);
      if (totalInterestPayable > 0) expenseSide.push(['Accrued Interest Payable', this.moneyText(totalInterestPayable)]);
      const incomeSide = incomeRows
        .map((row: TrialBalanceRow) => [row.ledgerName, this.moneyText(Math.max(0, row.credit - row.debit))])
        .filter((row: string[]) => Number(row[1]) > 0);
      if (totalInterestReceivable > 0) incomeSide.push(['Accrued Interest Receivable', this.moneyText(totalInterestReceivable)]);
      if (netProfit >= 0) expenseSide.push(['Net Profit', this.moneyText(netProfit)]);
      else incomeSide.push(['Net Loss', this.moneyText(Math.abs(netProfit))]);
      const plTotal = this.moneyText(Math.max(income, expenses));

      const liabilityRows = report.balanceSheet
        .filter((row: TrialBalanceRow) => ['Liabilities', 'Capital'].includes(row.groupName))
        .map((row: TrialBalanceRow) => [row.ledgerName, this.moneyText(Math.max(0, -signedBalance(row)))])
        .filter((row: string[]) => Number(row[1]) > 0);
      const assetRows = report.balanceSheet
        .filter((row: TrialBalanceRow) => row.groupName === 'Assets')
        .map((row: TrialBalanceRow) => [row.ledgerName, this.moneyText(Math.abs(signedBalance(row)))])
        .filter((row: string[]) => Number(row[1]) > 0);
      const liabilityTotal = this.moneyText(liabilityRows.reduce((sum: number, row: string[]) => sum + Number(row[1] || 0), 0));
      const assetTotal = this.moneyText(assetRows.reduce((sum: number, row: string[]) => sum + Number(row[1] || 0), 0));

      const ledgerSections = report.ledgers.map((entry: any) => {
        if (!entry.rows.length && Math.abs(entry.openingBalance || 0) < 0.005 && Math.abs(entry.closingBalance || 0) < 0.005) return '';
        const debitRows: string[][] = [];
        const creditRows: string[][] = [];
        const opening = round(entry.openingBalance || 0);
        if (opening > 0) debitRows.push(['To Opening Balance', this.moneyText(opening)]);
        if (opening < 0) creditRows.push(['By Opening Balance', this.moneyText(Math.abs(opening))]);
        for (const row of entry.rows as LedgerStatementRow[]) {
          if (Number(row.debit || 0) > 0) debitRows.push([`${this.formatDateText(row.date)}  To ${row.narration || row.type}`, this.moneyText(row.debit)]);
          if (Number(row.credit || 0) > 0) creditRows.push([`${this.formatDateText(row.date)}  By ${row.narration || row.type}`, this.moneyText(row.credit)]);
        }
        const closing = round(entry.closingBalance || 0);
        if (closing > 0) creditRows.push(['By Balance c/d', this.moneyText(closing)]);
        if (closing < 0) debitRows.push(['To Balance c/d', this.moneyText(Math.abs(closing))]);
        const debitTotal = this.moneyText(debitRows.reduce((sum, row) => sum + Number(row[1] || 0), 0));
        const creditTotal = this.moneyText(creditRows.reduce((sum, row) => sum + Number(row[1] || 0), 0));
        return `<section class="ledger-section"><h3>${this.escapeHtml(report.label)} Ledger: ${this.escapeHtml(entry.ledger.name)}</h3>${table(['Debit Particulars', 'Amount', 'Credit Particulars', 'Amount'], pairedRows(debitRows, creditRows, 6), `<tr><td>Total</td><td class="num">${debitTotal}</td><td>Total</td><td class="num">${creditTotal}</td></tr>`)}</section>`;
      }).join('');

      return `
        <section class="book-section">
          <h2>${this.escapeHtml(report.label)} Book</h2>
          <h3>Trial Balance</h3>
          ${table(['Account', 'Group', 'Debit', 'Credit'], trialRows, `<tr><td>Total</td><td></td><td class="num">${this.moneyText(trialDebit)}</td><td class="num">${this.moneyText(trialCredit)}</td></tr>`)}
          <h3>Profit and Loss Account</h3>
          ${table(['Dr. Expenses', 'Amount', 'Cr. Income', 'Amount'], pairedRows(expenseSide, incomeSide), `<tr><td>Total</td><td class="num">${plTotal}</td><td>Total</td><td class="num">${plTotal}</td></tr>`)}
          <h3>Balance Sheet</h3>
          ${table(['Liabilities & Capital', 'Amount', 'Assets', 'Amount'], pairedRows(liabilityRows, assetRows), `<tr><td>Total</td><td class="num">${liabilityTotal}</td><td>Total</td><td class="num">${assetTotal}</td></tr>`)}
          <h3>Ledger Accounts</h3>
          ${ledgerSections || '<p>No ledger movement for this book.</p>'}
        </section>
      `;
    }).join('');
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${this.escapeHtml(snapshot.company.name || 'Financial Year Archive')}</title>
  <style>
    body{font-family:Arial,sans-serif;color:#111;margin:32px;line-height:1.35}
    header{border-bottom:2px solid #111;margin-bottom:24px;padding-bottom:14px}
    h1{font-size:24px;margin:0 0 6px} h2{font-size:18px;margin:24px 0 8px;text-align:center} h3{font-size:14px;margin:18px 0 8px}
    .meta{font-size:12px;color:#555}
    table{width:100%;border-collapse:collapse;margin:8px 0 18px;table-layout:fixed}
    th,td{border:1px solid #999;padding:6px 8px;font-size:11px;text-align:left;vertical-align:top;word-wrap:break-word}
    th{background:#eef2f7}.num{text-align:right}tfoot td{font-weight:bold;background:#f8fafc}.book-section{page-break-before:always}.book-section:first-of-type{page-break-before:auto}.ledger-section{break-inside:avoid}
    @media print{body{margin:12mm}.book-section{page-break-before:always}.book-section:first-of-type{page-break-before:auto}}
  </style>
</head>
<body>
  <header>
    <h1>${this.escapeHtml(snapshot.company.name || 'Financial Year Archive')}</h1>
    <div class="meta">Financial Year: ${this.escapeHtml(snapshot.fromFinancialYear)} | Period: ${this.formatDateText(snapshot.periodStart)} to ${this.formatDateText(snapshot.periodEnd)} | New Year: ${this.escapeHtml(snapshot.toFinancialYear)}</div>
  </header>
  ${reportSections}
</body>
</html>`;
  }

  private moneyText(value = 0): string {
    return round(value).toFixed(2);
  }

  private balanceText(value = 0): string {
    const rounded = round(value);
    return `${rounded < 0 ? 'Cr' : 'Dr'} ${Math.abs(rounded).toFixed(2)}`;
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));
  }

  private validateLoanTransaction(transaction: LoanTransaction) {
    if (!transaction.accountId) throw new Error('Select an account.');
    if (!transaction.counterLedgerId) throw new Error('Select the opposite account.');
    if (!transaction.date) throw new Error('Date is required.');
    if (!['K', 'P'].includes(transaction.book)) throw new Error('Select K or P book.');
    if (!['Dr', 'Cr'].includes(transaction.side)) throw new Error('Select Dr or Cr.');
    if (Number(transaction.amount || 0) <= 0) throw new Error('Amount must be greater than zero.');
    if (Number(transaction.interestAmount || 0) < 0) throw new Error('Interest cannot be negative.');
  }

  private loanRows(whereSql: string, args: unknown[], includeArchived = false) {
    const archiveClause = includeArchived ? '' : 't.balance_bd_id is null and t.financial_year_archive_id is null';
    let sql = `select t.*, a.name account_name, a.default_rate account_default_rate, a.current_interest_start_date account_current_interest_start_date, c.name counter_ledger_name, i.name interest_ledger_name
       from loan_transactions t
       join loan_accounts a on a.id=t.account_id
       join ledgers c on c.id=t.counter_ledger_id
       left join ledgers i on i.id=t.interest_ledger_id`;
    if (whereSql.trim().toLowerCase().startsWith('where')) {
      sql += ' ' + whereSql.replace(/where/i, `where ${archiveClause ? archiveClause + ' and ' : ''}`);
    } else {
      sql += archiveClause ? ` where ${archiveClause} ` : '';
      sql += ' ' + whereSql;
    }
    return this.db.prepare(sql).all(...args) as any[];
  }

  private addColumnIfMissing(table: string, column: string, definition: string) {
    const columns = this.db.prepare(`pragma table_info(${table})`).all() as any[];
    if (!columns.some((row) => row.name === column)) {
      this.db.prepare(`alter table ${table} add column ${column} ${definition}`).run();
    }
  }

  private loanTransactionById(id: number): LoanTransaction {
    const row = this.loanRows('where t.id=?', [id])[0];
    return this.mapLoanTransaction(row);
  }

  private loanInterest(row: any, asOf: string): number {
    const monthlyRate = Number(row.monthly_rate ?? row.monthlyRate ?? row.account_default_rate ?? 0);
    if (monthlyRate === 0) return 0;
    const startDate = this.maxDate(row.date, row.account_current_interest_start_date || row.currentInterestStartDate || row.date);
    const days = this.daysBetween(startDate, asOf);
    const interest = Number(row.amount || 0) * (monthlyRate / 100) / 30 * days;
    return round(row.side === 'Dr' ? interest : -interest);
  }

  private hasTransactionsOnOrAfter(date: string): boolean {
    const voucher = this.db.prepare('select id from vouchers where date >= ? limit 1').get(date);
    const invoice = this.db.prepare('select id from invoices where date >= ? limit 1').get(date);
    const loanTransaction = this.db.prepare('select id from loan_transactions where date >= ? limit 1').get(date);
    return Boolean(voucher || invoice || loanTransaction);
  }

  private writeAuditLog(entityType: string, entityId: number | null | undefined, action: string, details: unknown) {
    const columns = new Set((this.db.prepare('pragma table_info(audit_logs)').all() as any[]).map((row) => row.name));
    const detailsJson = JSON.stringify(details);
    const payload: Record<string, unknown> = {};

    if (columns.has('entity_type')) payload.entity_type = entityType;
    if (columns.has('entity_id')) payload.entity_id = entityId ?? null;
    if (columns.has('event_type')) payload.event_type = entityType;
    if (columns.has('event_id')) payload.event_id = entityId ?? null;
    if (columns.has('action')) payload.action = action;
    if (columns.has('message')) payload.message = `${entityType} ${action}`;
    if (columns.has('details_json')) payload.details_json = detailsJson;
    if (columns.has('details')) payload.details = detailsJson;
    if (columns.has('metadata')) payload.metadata = detailsJson;

    const insertColumns = Object.keys(payload);
    if (!insertColumns.length) return;
    const placeholders = insertColumns.map(() => '?').join(', ');
    this.db.prepare(`insert into audit_logs (${insertColumns.join(', ')}) values (${placeholders})`).run(...insertColumns.map((column) => payload[column]));
  }

  private daysBetween(from: string, to: string): number {
    const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
    const [toYear, toMonth, toDay] = to.split('-').map(Number);
    const start = Date.UTC(fromYear, fromMonth - 1, fromDay);
    const end = Date.UTC(toYear, toMonth - 1, toDay);
    const diff = Math.floor((end - start) / 86_400_000);
    return Number.isFinite(diff) && diff > 0 ? diff : 0;
  }

  private nextNumber(prefix: string): string {
    const row = this.db.prepare('select value from counters where prefix=?').get(prefix) as any;
    const next = row ? row.value + 1 : 1;
    this.db.prepare('insert into counters(prefix, value) values(?, ?) on conflict(prefix) do update set value=excluded.value').run(prefix, next);
    return `${prefix.replaceAll('_', '-')}-${String(next).padStart(5, '0')}`;
  }

  private validateVoucher(voucher: Voucher) {
    if (!voucher.type || !voucher.date) throw new Error('Voucher type and date are required.');
    if (voucher.entries.length < 2) throw new Error('A voucher needs at least two entries.');
    const debit = round(voucher.entries.reduce((sum, entry) => sum + Number(entry.debit || 0), 0));
    const credit = round(voucher.entries.reduce((sum, entry) => sum + Number(entry.credit || 0), 0));
    if (debit <= 0 || credit <= 0 || debit !== credit) throw new Error('Total debit must equal total credit.');
    for (const entry of voucher.entries) {
      if (!entry.ledgerId) throw new Error('Every entry needs a ledger.');
      if (Number(entry.debit || 0) > 0 && Number(entry.credit || 0) > 0) throw new Error('An entry cannot have both debit and credit.');
    }
  }

  private ledgerBalances(filters: ReportFilters = {}): TrialBalanceRow[] {
    const book = filters.book && filters.book !== 'Combined' ? filters.book : null;
    const rows = this.db.prepare(
      `select l.id ledger_id, l.name ledger_name, l.group_name, l.party_type, l.is_system, la.id loan_id, la.category loan_category,
        case
          when la.id is null then case when @book is null then l.opening_balance * case when l.opening_type='Cr' then -1 else 1 end else 0 end
          when @book='K' then la.opening_k_balance * case when la.opening_k_type='Cr' then -1 else 1 end
          when @book='P' then la.opening_p_balance * case when la.opening_p_type='Cr' then -1 else 1 end
          else la.opening_k_balance * case when la.opening_k_type='Cr' then -1 else 1 end
             + la.opening_p_balance * case when la.opening_p_type='Cr' then -1 else 1 end
        end opening_signed,
        coalesce(sum(case when v.id is null then 0 else ve.debit end),0) debit_total,
        coalesce(sum(case when v.id is null then 0 else ve.credit end),0) credit_total
       from ledgers l
       left join loan_accounts la on la.ledger_id=l.id
       left join voucher_entries ve on ve.ledger_id=l.id and ve.balance_bd_id is null and ve.financial_year_archive_id is null
       left join vouchers v on v.id=ve.voucher_id ${filters.from ? 'and v.date >= @from' : ''} ${filters.to ? 'and v.date <= @to' : ''}
         and (@book is null or exists (select 1 from loan_transactions lt where lt.voucher_id=v.id and lt.book=@book))
       group by l.id
       order by l.name`
    ).all({ ...filters, book }) as any[];
    return rows.map((row) => {
      const opening = Number(row.opening_signed || 0);
      const balance = opening + Number(row.debit_total || 0) - Number(row.credit_total || 0);
      return {
        ledgerId: row.ledger_id,
        ledgerName: row.ledger_name,
        groupName: row.group_name,
        debit: balance >= 0 ? round(balance) : 0,
        credit: balance < 0 ? round(Math.abs(balance)) : 0,
        partyType: row.party_type,
        isSystem: Boolean(row.is_system),
        isLoanAccount: row.loan_id !== null && row.loan_id !== undefined,
        loanAccountCategory: row.loan_category ?? null
      };
    });
  }

  private profitLoss(filters: ReportFilters = {}) {
    const balances = this.ledgerBalances(filters);
    const income = balances.filter((row) => row.groupName === 'Income').reduce((sum, row) => sum + row.credit - row.debit, 0);
    const expenses = balances.filter((row) => row.groupName === 'Expenses').reduce((sum, row) => sum + row.debit - row.credit, 0);
    return round(income - expenses);
  }

  private gstSummary(filters: ReportFilters) {
    return {
      salesGst: this.scalar("select coalesce(sum(gst_total),0) from invoices where type='Sales'"),
      purchaseGst: this.scalar("select coalesce(sum(gst_total),0) from invoices where type='Purchase'"),
      rows: this.listInvoices(filters).map((invoice) => ({ date: invoice.date, invoiceNo: invoice.invoiceNo, type: invoice.type, party: invoice.partyName, gst: invoice.gstTotal, total: invoice.grandTotal }))
    };
  }

  private filterSql(filters: ReportFilters, alias: string) {
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (alias === 'v' || alias === 'i') {
      clauses.push(`${alias}.financial_year_archive_id is null`);
    }
    if (filters.from) {
      clauses.push(`${alias}.date >= ?`);
      args.push(filters.from);
    }
    if (filters.to) {
      clauses.push(`${alias}.date <= ?`);
      args.push(filters.to);
    }
    if (filters.type) {
      clauses.push(`${alias}.type = ?`);
      args.push(filters.type);
    }
    if (filters.partyLedgerId) {
      clauses.push(`${alias}.party_ledger_id = ?`);
      args.push(filters.partyLedgerId);
    }
    if (filters.search) {
      const col = alias === 'v' ? `${alias}.voucher_no || ' ' || ${alias}.narration` : `${alias}.invoice_no || ' ' || coalesce(${alias}.notes,'')`;
      clauses.push(`${col} like ?`);
      args.push(`%${filters.search}%`);
    }
    return { sql: clauses.length ? `where ${clauses.join(' and ')}` : '', args };
  }

  private hydrateVoucher(row: any): Voucher {
    const entries = this.db.prepare(
      'select ve.*, l.name ledger_name from voucher_entries ve join ledgers l on l.id=ve.ledger_id where voucher_id=? order by ve.id'
    ).all(row.id) as any[];
    return {
      id: row.id,
      voucherNo: row.voucher_no,
      type: row.type,
      date: row.date,
      partyLedgerId: row.party_ledger_id,
      narration: row.narration,
      totalDebit: row.total_debit,
      totalCredit: row.total_credit,
      entries: entries.map((entry) => ({
        ledgerId: entry.ledger_id,
        ledgerName: entry.ledger_name,
        debit: round(entry.debit),
        credit: round(entry.credit),
        narration: entry.narration
      }))
    };
  }

  private hydrateInvoice(row: any): Invoice {
    const items = this.db.prepare(
      'select ii.*, it.name item_name from invoice_items ii join items it on it.id=ii.item_id where invoice_id=? order by ii.id'
    ).all(row.id) as any[];
    return {
      id: row.id,
      invoiceNo: row.invoice_no,
      type: row.type,
      date: row.date,
      partyLedgerId: row.party_ledger_id,
      partyName: row.party_name,
      subtotal: round(row.subtotal),
      discountTotal: round(row.discount_total),
      gstTotal: round(row.gst_total),
      grandTotal: round(row.grand_total),
      notes: row.notes,
      items: items.map((item) => ({ itemId: item.item_id, itemName: item.item_name, qty: item.qty, rate: item.rate, discount: item.discount, gstRate: item.gst_rate }))
    };
  }

  private invoiceLine(item: InvoiceItem) {
    const gross = Number(item.qty || 0) * Number(item.rate || 0);
    const taxable = round(gross - Number(item.discount || 0));
    const gst = round((taxable * Number(item.gstRate || 0)) / 100);
    return { taxable, gst, total: round(taxable + gst) };
  }

  private invoiceTotals(items: InvoiceItem[]) {
    return items.reduce(
      (sum, item) => {
        const gross = Number(item.qty || 0) * Number(item.rate || 0);
        const line = this.invoiceLine(item);
        return {
          subtotal: round(sum.subtotal + gross),
          discountTotal: round(sum.discountTotal + Number(item.discount || 0)),
          gstTotal: round(sum.gstTotal + line.gst),
          grandTotal: round(sum.grandTotal + line.total)
        };
      },
      { subtotal: 0, discountTotal: 0, gstTotal: 0, grandTotal: 0 }
    );
  }

  private scalar(sql: string): number {
    const row = this.db.prepare(sql).pluck().get() as number;
    return round(row || 0);
  }

  private getSetting(key: string): string {
    return (this.db.prepare('select value from settings where key=?').get(key) as any)?.value ?? '';
  }

  private setSetting(key: string, value: string) {
    this.db.prepare('insert into settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value').run(key, value);
  }

  private validateCloudSyncEndpoint(endpointUrl: string) {
    let parsed: URL;
    try {
      parsed = new URL(endpointUrl);
    } catch {
      throw new Error('Cloud sync upload URL is invalid.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Cloud sync upload URL must start with http:// or https://.');
    if (!parsed.pathname.endsWith('/api/sync')) throw new Error('Cloud sync upload URL must end with /api/sync.');
  }

  private getCloudSyncEndpoint(settings: CloudSyncSettings) {
    return (process.env.CLOUD_SYNC_URL || settings.endpointUrl || DEFAULT_CLOUD_SYNC_URL).trim();
  }

  private getCloudSetupEndpoint(settings: CloudSyncSettings) {
    const parsed = new URL(this.getCloudSyncEndpoint(settings));
    parsed.pathname = parsed.pathname.replace(/\/api\/sync$/, '/api/setup');
    return parsed.toString();
  }

  private readCloudSyncSettings(): CloudSyncSettings {
    const defaults: CloudSyncSettings = { enabled: false, authToken: '' };
    if (!fs.existsSync(this.cloudSyncPath)) return defaults;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.cloudSyncPath, 'utf8')) as Partial<CloudSyncSettings>;
      return {
        enabled: Boolean(parsed.enabled),
        endpointUrl: typeof parsed.endpointUrl === 'string' ? parsed.endpointUrl : undefined,
        authToken: typeof parsed.authToken === 'string' ? parsed.authToken : '',
        cloudTenantId: typeof parsed.cloudTenantId === 'string' ? parsed.cloudTenantId : undefined,
        lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : undefined,
        lastSyncMessage: typeof parsed.lastSyncMessage === 'string' ? parsed.lastSyncMessage : undefined,
        syncIntervalMinutes: typeof parsed.syncIntervalMinutes === 'number' ? parsed.syncIntervalMinutes : 30
      };
    } catch {
      return defaults;
    }
  }

  private writeCloudSyncSettings(settings: CloudSyncSettings) {
    fs.writeFileSync(this.cloudSyncPath, JSON.stringify(settings, null, 2));
  }

  private autoBackup() {
    if (this.getAutoBackup()) {
      const target = path.join(this.backupDir, `auto-${today()}.sqlite`);
      void this.db.backup(target).catch((error) => console.error('Automatic backup failed:', error));
    }
    this.autoCloudSync();
  }

  private autoCloudSync() {
    const settings = this.readCloudSyncSettings();
    const endpointUrl = this.getCloudSyncEndpoint(settings);
    if (!settings.enabled || !endpointUrl || !settings.authToken || this.cloudSyncInFlight) return;
    this.cloudSyncInFlight = true;
    void this.syncDatabaseToCloud()
      .catch((error) => console.error('Cloud sync failed:', error))
      .finally(() => {
        this.cloudSyncInFlight = false;
      });
  }

  private startAutoSyncTimer() {
    // Clear any existing timer first
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    const settings = this.readCloudSyncSettings();
    const endpointUrl = this.getCloudSyncEndpoint(settings);
    if (!settings.enabled || !endpointUrl || !settings.authToken) return;
    const intervalMs = (settings.syncIntervalMinutes ?? 30) * 60 * 1000;
    this.syncTimer = setInterval(() => {
      this.autoCloudSync();
    }, intervalMs);
    console.log(`Cloud auto-sync timer started: every ${settings.syncIntervalMinutes ?? 30} minutes`);
  }

  private mapCompany(row: any): Company {
    return { id: row.id, name: row.name, shopNo: row.shop_no ?? '', address: row.address, phone: row.phone, email: row.email, gstin: row.gstin, financialYear: row.financial_year };
  }

  private mapLedger(row: any): Ledger {
    return {
      id: row.id,
      name: row.name,
      groupName: row.group_name,
      openingBalance: row.opening_balance,
      openingType: row.opening_type,
      partyType: row.party_type,
      gstin: row.gstin,
      phone: row.phone,
      email: row.email,
      address: row.address,
      isSystem: Boolean(row.is_system)
    };
  }

  private mapItem(row: any): Item {
    return { id: row.id, name: row.name, sku: row.sku, unit: row.unit, price: row.price, gstRate: row.gst_rate, stock: row.stock };
  }

  private mapLoanAccount(row: any): LoanAccount {
    return {
      id: row.id,
      name: row.name,
      ledgerId: row.ledger_id,
      category: row.category ?? 'Debtors',
      phone: row.phone,
      address: row.address,
      defaultRate: row.default_rate,
      note: row.note,
      openingBalance: round(row.opening_balance || 0),
      openingType: row.opening_type ?? 'Dr',
      openingBook: row.opening_book ?? 'K'
      ,openingKBalance: round(row.opening_k_balance || 0)
      ,openingKType: row.opening_k_type ?? 'Dr'
      ,openingPBalance: round(row.opening_p_balance || 0)
      ,openingPType: row.opening_p_type ?? 'Dr'
      ,openingDate: row.opening_date || today()
      ,previousYearInterest: round(row.previous_year_interest || 0)
      ,currentInterestStartDate: row.current_interest_start_date || row.opening_date || today()
      ,lastInterestPostedDate: row.last_interest_posted_date
      ,pinned: Boolean(row.is_pinned)
    };
  }

  private mapLoanTransaction(row: any): LoanTransaction {
    return {
      id: row.id,
      accountId: row.account_id,
      accountName: row.account_name,
      date: row.date,
      book: row.book as LoanBook,
      side: row.side as LoanSide,
      amount: round(row.amount),
      counterLedgerId: row.counter_ledger_id,
      counterLedgerName: row.counter_ledger_name,
      interestAmount: round(row.interest_amount),
      interestLedgerId: row.interest_ledger_id,
      interestLedgerName: row.interest_ledger_name,
      monthlyRate: row.monthly_rate,
      narration: row.narration,
      voucherId: row.voucher_id
    };
  }

  private mapLoanStatementRow(row: any, asOf: string): LoanStatementRow {
    return {
      ...this.mapLoanTransaction(row),
      days: this.daysBetween(row.date, asOf),
      interest: this.loanInterest(row, asOf)
    };
  }

  async showSaveDialog(defaultName: string): Promise<any> {
    const result = await dialog.showSaveDialog({
      title: 'Export Ledger Statement before Balance B/D',
      defaultPath: defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    return result;
  }

  savePDFFile(filePath: string, base64Data: string): boolean {
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    return true;
  }

  performBalanceBD(accountId: number, asOfDate: string, pdfPath: string): boolean {
    const account = this.db.prepare('select * from loan_accounts where id=?').get(accountId) as any;
    if (!account) throw new Error('Account not found.');
    const ledger = this.db.prepare('select * from ledgers where id=?').get(account.ledger_id) as any;
    if (!ledger) throw new Error('Ledger not found.');

    const rows = this.loanStatement(accountId, asOfDate).filter(row => row.date <= asOfDate);
    const kTotals = this.getBookLedgerTotals(account, rows, 'K', asOfDate);
    const pTotals = this.getBookLedgerTotals(account, rows, 'P', asOfDate);

    // Carry only principal closing balance into the new opening balance.
    const netK = round(kTotals.balance);
    const netP = round(pTotals.balance);
    const netLedger = round(netK + netP);

    const postKBalance = Math.abs(netK);
    const postKType = netK >= 0 ? 'Dr' : 'Cr';
    const postPBalance = Math.abs(netP);
    const postPType = netP >= 0 ? 'Dr' : 'Cr';
    
    const postOpeningBalance = Math.abs(netLedger);
    const postOpeningType = netLedger >= 0 ? 'Dr' : 'Cr';

    const tx = this.db.transaction(() => {
      // 1. Save history record
      const result = this.db.prepare(`
        insert into balance_bd_history (
          ledger_id, loan_account_id, date,
          pre_k_balance, pre_k_type, pre_p_balance, pre_p_type,
          pre_opening_balance, pre_opening_type, pre_opening_date,
          post_k_balance, post_k_type, post_p_balance, post_p_type,
          post_opening_balance, post_opening_type, post_opening_date,
          pdf_path
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ledger.id, account.id, asOfDate,
        account.opening_k_balance, account.opening_k_type, account.opening_p_balance, account.opening_p_type,
        ledger.opening_balance, ledger.opening_type, account.opening_date,
        postKBalance, postKType, postPBalance, postPType,
        postOpeningBalance, postOpeningType, asOfDate,
        pdfPath
      );
      const historyId = Number(result.lastInsertRowid);

      // 2. Update ledger opening balance
      this.db.prepare(`
        update ledgers set
          opening_balance = ?,
          opening_type = ?,
          updated_at = datetime('now')
        where id = ?
      `).run(postOpeningBalance, postOpeningType, ledger.id);

      // 3. Update loan account opening balances
      this.db.prepare(`
        update loan_accounts set
          opening_k_balance = ?,
          opening_k_type = ?,
          opening_p_balance = ?,
          opening_p_type = ?,
          opening_date = ?,
          updated_at = datetime('now')
        where id = ?
      `).run(postKBalance, postKType, postPBalance, postPType, asOfDate, account.id);

      // 4. Archive loan transactions
      this.db.prepare(`
        update loan_transactions set balance_bd_id = ?
        where account_id = ? and date <= ? and balance_bd_id is null
      `).run(historyId, account.id, asOfDate);

      // 5. Archive voucher entries
      this.db.prepare(`
        update voucher_entries set balance_bd_id = ?
        where ledger_id = ? and balance_bd_id is null and voucher_id in (
          select id from vouchers where date <= ?
        )
      `).run(historyId, ledger.id, asOfDate);
    });

    tx();
    this.autoBackup();
    return true;
  }

  undoBalanceBD(accountId: number): boolean {
    const account = this.db.prepare('select * from loan_accounts where id=?').get(accountId) as any;
    if (!account) throw new Error('Account not found.');
    const ledger = this.db.prepare('select * from ledgers where id=?').get(account.ledger_id) as any;
    if (!ledger) throw new Error('Ledger not found.');

    const history = this.db.prepare(`
      select * from balance_bd_history
      where loan_account_id = ?
      order by id desc limit 1
    `).get(account.id) as any;
    if (!history) throw new Error('No Balance B/D history found for this account.');

    const tx = this.db.transaction(() => {
      // 1. Revert ledger opening balances
      this.db.prepare(`
        update ledgers set
          opening_balance = ?,
          opening_type = ?,
          updated_at = datetime('now')
        where id = ?
      `).run(history.pre_opening_balance, history.pre_opening_type, ledger.id);

      // 2. Revert loan account opening balances
      this.db.prepare(`
        update loan_accounts set
          opening_k_balance = ?,
          opening_k_type = ?,
          opening_p_balance = ?,
          opening_p_type = ?,
          opening_date = ?,
          updated_at = datetime('now')
        where id = ?
      `).run(history.pre_k_balance, history.pre_k_type, history.pre_p_balance, history.pre_p_type, history.pre_opening_date, account.id);

      // 3. Restore loan transactions
      this.db.prepare(`
        update loan_transactions set balance_bd_id = null
        where balance_bd_id = ?
      `).run(history.id);

      // 4. Restore voucher entries
      this.db.prepare(`
        update voucher_entries set balance_bd_id = null
        where balance_bd_id = ?
      `).run(history.id);

      // 5. Delete history record
      this.db.prepare('delete from balance_bd_history where id = ?').run(history.id);
    });

    tx();
    this.autoBackup();
    return true;
  }

  getLatestBalanceBD(accountId: number): any {
    const account = this.db.prepare('select * from loan_accounts where id=?').get(accountId) as any;
    if (!account) return null;
    return this.db.prepare(`
      select * from balance_bd_history
      where loan_account_id = ?
      order by id desc limit 1
    `).get(account.id) ?? null;
  }

  listBalanceBDHistory(): any[] {
    return this.db.prepare(`
      select h.*, a.name account_name, l.name ledger_name
      from balance_bd_history h
      join loan_accounts a on a.id = h.loan_account_id
      join ledgers l on l.id = h.ledger_id
      order by h.date desc, h.id desc
    `).all() as any[];
  }

  openPDFFile(filePath: string): boolean {
    if (!filePath) return false;
    if (fs.existsSync(filePath)) {
      void shell.openPath(filePath);
      return true;
    }
    return false;
  }

  async printPDFFile(filePath: string, orientation: 'portrait' | 'landscape' = 'portrait'): Promise<boolean> {
    if (!filePath || !fs.existsSync(filePath)) return false;
    const printablePath = filePath.toLowerCase().endsWith('.pdf')
      ? filePath.replace(/\.pdf$/i, '.html')
      : filePath;
    const targetPath = fs.existsSync(printablePath) ? printablePath : filePath;
    const printWindow = new BrowserWindow({
      show: true,
      width: 980,
      height: 720,
      title: `Print ${orientation === 'landscape' ? 'Landscape' : 'Portrait'}`,
      autoHideMenuBar: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    try {
      await printWindow.loadFile(targetPath);
      await printWindow.webContents.executeJavaScript(`
        (() => {
          const style = document.createElement('style');
          style.textContent = '@page { size: A4 ${orientation}; margin: 10mm; }';
          document.head.appendChild(style);
        })();
      `);
      printWindow.show();
      printWindow.focus();
      await printWindow.webContents.executeJavaScript(`
        new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve(true);
          };
          window.addEventListener('afterprint', finish, { once: true });
          setTimeout(finish, 60000);
          window.print();
        });
      `);
      return true;
    } finally {
      if (!printWindow.isDestroyed()) printWindow.close();
    }
  }

  resetDatabase(): boolean {
    try {
      try {
        this.db.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // A checkpoint is best-effort before deleting the database files.
      }

      this.db.close();
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        const filePath = `${this.dbPath}${suffix}`;
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }

      this.db = this.connectDatabase();
      this.migrate();
      this.seedSystemLedgers();
      return true;
    } catch (err) {
      try {
        this.db.prepare('select 1').get();
      } catch {
        this.db = this.connectDatabase();
        this.migrate();
        this.seedSystemLedgers();
      }
      console.error('Reset database failed:', err);
      throw err;
    }
  }

  private getBookLedgerTotals(account: any, rows: any[], book: 'K' | 'P', asOf: string) {
    const bookRows = rows.filter((row) => row.book === book);
    const opening = book === 'K' ? Number(account.opening_k_balance || 0) : Number(account.opening_p_balance || 0);
    const openingType = book === 'K' ? account.opening_k_type : account.opening_p_type;
    const openingDate = this.maxDate(account.opening_date, account.current_interest_start_date || account.opening_date);
    const openingDays = this.daysBetween(openingDate, asOf);
    const openingInterest = opening * (account.default_rate || 1.5) / 100 / 30 * openingDays * (openingType === 'Cr' ? -1 : 1);

    const debitTotal = bookRows.filter((row) => row.side === 'Dr').reduce((sum, row) => sum + Number(row.amount || 0), openingType !== 'Cr' ? opening : 0);
    const creditTotal = bookRows.filter((row) => row.side === 'Cr').reduce((sum, row) => sum + Number(row.amount || 0), openingType === 'Cr' ? opening : 0);
    const interest = openingInterest + bookRows.reduce((sum, row) => sum + this.loanInterest(row, asOf), 0);

    return { debit: debitTotal, credit: creditTotal, balance: debitTotal - creditTotal, interest };
  }

  private getBookLedgerTableData(account: any, rows: any[], book: 'K' | 'P', asOf: string) {
    const bookRows = rows.filter((row) => row.book === book);
    const opening = book === 'K' ? Number(account.opening_k_balance || 0) : Number(account.opening_p_balance || 0);
    const openingType = book === 'K' ? account.opening_k_type : account.opening_p_type;
    const openingDate = this.maxDate(account.opening_date, account.current_interest_start_date || account.opening_date);
    const openingDays = this.daysBetween(openingDate, asOf);
    const openingInterest = opening * (account.default_rate || 1.5) / 100 / 30 * openingDays * (openingType === 'Cr' ? -1 : 1);

    const debitRows = bookRows.filter((row) => row.side === 'Dr').sort((a, b) => `${a.date}-${a.id ?? 0}`.localeCompare(`${b.date}-${b.id ?? 0}`));
    const creditRows = bookRows.filter((row) => row.side === 'Cr').sort((a, b) => `${a.date}-${a.id ?? 0}`.localeCompare(`${b.date}-${b.id ?? 0}`));

    const debitEntries = [...(opening > 0 && openingType === 'Dr' ? [{ opening: true }] : []), ...debitRows.map((row) => ({ row }))];
    const creditEntries = [...(opening > 0 && openingType === 'Cr' ? [{ opening: true }] : []), ...creditRows.map((row) => ({ row }))];
    const maxRows = Math.max(debitEntries.length, creditEntries.length, 5);

    const body: any[] = [];
    for (let i = 0; i < maxRows; i++) {
      const debitEntry = debitEntries[i];
      const creditEntry = creditEntries[i];

      const dRow = debitEntry && 'row' in debitEntry ? debitEntry.row : undefined;
      const cRow = creditEntry && 'row' in creditEntry ? creditEntry.row : undefined;

      const dOpening = Boolean(debitEntry && 'opening' in debitEntry);
      const cOpening = Boolean(creditEntry && 'opening' in creditEntry);

      body.push([
        dOpening ? this.formatDateText(openingDate) : dRow ? this.formatDateText(dRow.date) : '',
        dOpening ? 'Opening Balance' : dRow ? dRow.counterLedgerName || '' : '',
        dOpening ? opening.toFixed(2) : dRow ? dRow.amount.toFixed(2) : '',
        dOpening ? openingInterest.toFixed(2) : dRow ? this.loanInterest(dRow, asOf).toFixed(2) : '',
        cOpening ? this.formatDateText(openingDate) : cRow ? this.formatDateText(cRow.date) : '',
        cOpening ? 'Opening Balance' : cRow ? cRow.counterLedgerName || '' : '',
        cOpening ? opening.toFixed(2) : cRow ? cRow.amount.toFixed(2) : '',
        cOpening ? openingInterest.toFixed(2) : cRow ? this.loanInterest(cRow, asOf).toFixed(2) : ''
      ]);
    }

    const totals = this.getBookLedgerTotals(account, rows, book, asOf);
    const footer = [
      ['', 'Debit Total', totals.debit.toFixed(2), Math.max(totals.interest, 0).toFixed(2), '', 'Credit Total', totals.credit.toFixed(2), Math.abs(Math.min(totals.interest, 0)).toFixed(2)],
      [{ content: 'Closing Balance', colSpan: 6, styles: { halign: 'right', fontStyle: 'bold' } }, { content: `${totals.balance >= 0 ? 'Dr. ' : 'Cr. '}${Math.abs(totals.balance).toFixed(2)}`, colSpan: 2, styles: { fontStyle: 'bold' } }]
    ];

    return { body, footer };
  }

  private formatDateText(date?: string): string {
    return date ? date.split('-').reverse().join('-') : '';
  }
}
