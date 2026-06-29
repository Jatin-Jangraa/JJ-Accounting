import type {
  AppInit,
  BackupResult,
  CloudSyncResult,
  CloudSyncSettings,
  Company,
  DashboardSummary,
  FinancialYearArchive,
  FinancialYearCloseResult,
  Invoice,
  Item,
  Ledger,
  LedgerStatementRow,
  LicenseActivationResult,
  LicenseStatus,
  LoanAccount,
  LoanStatementRow,
  LoanSummaryRow,
  LoanTransaction,
  ProfitLossData,
  ReportFilters,
  SessionUser,
  TrialBalanceRow,
  Voucher
} from './types.js';

export interface AccountingApi {
  init(): Promise<AppInit>;
  createAdmin(password: string): Promise<SessionUser>;
  login(password: string): Promise<SessionUser>;
  changePassword(currentPassword: string, nextPassword: string): Promise<boolean>;
  getCompany(): Promise<Company | null>;
  saveCompany(company: Company): Promise<Company>;
  closeFinancialYear(company: Company): Promise<FinancialYearCloseResult>;
  listFinancialYearArchives(): Promise<FinancialYearArchive[]>;
  undoFinancialYearClose(archiveId: number): Promise<BackupResult>;
  listLedgers(): Promise<Ledger[]>;
  saveLedger(ledger: Ledger): Promise<Ledger>;
  deleteLedger(id: number): Promise<boolean>;
  listItems(): Promise<Item[]>;
  saveItem(item: Item): Promise<Item>;
  deleteItem(id: number): Promise<boolean>;
  listVouchers(filters?: ReportFilters): Promise<Voucher[]>;
  saveVoucher(voucher: Voucher): Promise<Voucher>;
  deleteVoucher(id: number): Promise<boolean>;
  listInvoices(filters?: ReportFilters): Promise<Invoice[]>;
  saveInvoice(invoice: Invoice): Promise<Invoice>;
  deleteInvoice(id: number): Promise<boolean>;
  dashboard(): Promise<DashboardSummary>;
  trialBalance(filters?: ReportFilters): Promise<TrialBalanceRow[]>;
  ledgerStatement(ledgerId: number, filters?: ReportFilters): Promise<LedgerStatementRow[]>;
  listLoanAccounts(): Promise<LoanAccount[]>;
  saveLoanAccount(account: LoanAccount): Promise<LoanAccount>;
  deleteLoanAccount(id: number): Promise<boolean>;
  saveLoanTransaction(transaction: LoanTransaction): Promise<LoanTransaction>;
  updateLoanTransaction(transaction: LoanTransaction): Promise<LoanTransaction>;
  deleteLoanTransaction(id: number): Promise<boolean>;
  setLoanAccountPinned(id: number, pinned: boolean): Promise<boolean>;
  loanStatement(accountId: number, asOf?: string): Promise<LoanStatementRow[]>;
  lendingSummary(asOf?: string): Promise<LoanSummaryRow[]>;
  profitLossData(asOf?: string, book?: string): Promise<ProfitLossData>;
  report(name: string, filters?: ReportFilters): Promise<any>;
  exportBackup(): Promise<BackupResult>;
  restoreBackup(): Promise<BackupResult>;
  setAutoBackup(enabled: boolean): Promise<boolean>;
  getAutoBackup(): Promise<boolean>;
  getCloudSyncSettings(): Promise<CloudSyncSettings>;
  saveCloudSyncSettings(settings: CloudSyncSettings): Promise<CloudSyncSettings>;
  syncDatabaseToCloud(): Promise<CloudSyncResult>;
  exportInvoicePdf(invoiceId: number): Promise<BackupResult>;
  showSaveDialog(defaultPath: string): Promise<any>;
  savePDFFile(filePath: string, base64Data: string): Promise<boolean>;
  performBalanceBD(accountId: number, asOfDate: string, pdfPath: string): Promise<boolean>;
  undoBalanceBD(accountId: number): Promise<boolean>;
  getLatestBalanceBD(accountId: number): Promise<any>;
  listBalanceBDHistory(): Promise<any[]>;
  openPDFFile(filePath: string): Promise<boolean>;
  resetDatabase(): Promise<boolean>;
  getLicenseStatus(): Promise<LicenseStatus>;
  activateLicense(licenseKey: string): Promise<LicenseActivationResult>;
  validateLicense(): Promise<LicenseStatus>;
}

export const ipcChannels = {
  invoke: 'accounting:invoke',
  windowControl: 'window:control',
  windowState: 'window:state',
  fullscreenChanged: 'window:fullscreen-changed'
} as const;
