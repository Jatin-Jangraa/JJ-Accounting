export type AccountGroup = 'Assets' | 'Liabilities' | 'Income' | 'Expenses' | 'Capital';
export type DrCr = 'Dr' | 'Cr';
export type PartyType = 'customer' | 'supplier' | 'both';
export type LoanAccountCategory = string;
export type VoucherType =
  | 'Receipt'
  | 'Payment'
  | 'Contra'
  | 'Journal'
  | 'Sales'
  | 'Purchase'
  | 'Debit Note'
  | 'Credit Note';
export type InvoiceType = 'Sales' | 'Purchase';
export type LoanBook = 'K' | 'P';
export type ReportBook = LoanBook | 'Combined';
export type LoanSide = 'Dr' | 'Cr';

export interface Company {
  id?: number;
  name: string;
  shopNo?: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  financialYear: string;
}

export interface SessionUser {
  id: number;
  username: string;
}

export interface Ledger {
  id?: number;
  name: string;
  groupName: AccountGroup;
  openingBalance: number;
  openingType: DrCr;
  partyType?: PartyType | null;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  isSystem?: boolean;
}

export interface Item {
  id?: number;
  name: string;
  sku?: string | null;
  unit: string;
  price: number;
  gstRate: number;
  stock: number;
}

export interface VoucherEntry {
  ledgerId: number;
  ledgerName?: string;
  debit: number;
  credit: number;
  narration?: string;
}

export interface Voucher {
  id?: number;
  voucherNo?: string;
  type: VoucherType;
  date: string;
  partyLedgerId?: number | null;
  narration: string;
  entries: VoucherEntry[];
  totalDebit?: number;
  totalCredit?: number;
}

export interface InvoiceItem {
  itemId: number;
  itemName?: string;
  qty: number;
  rate: number;
  discount: number;
  gstRate: number;
}

export interface Invoice {
  id?: number;
  invoiceNo?: string;
  type: InvoiceType;
  date: string;
  partyLedgerId: number;
  partyName?: string;
  items: InvoiceItem[];
  notes?: string;
  subtotal?: number;
  discountTotal?: number;
  gstTotal?: number;
  grandTotal?: number;
}

export interface DashboardSummary {
  totalSales: number;
  totalPurchases: number;
  cashBalance: number;
  bankBalance: number;
  receivables: number;
  payables: number;
  profitLoss: number;
  recentTransactions: Voucher[];
}

export interface TrialBalanceRow {
  ledgerId: number;
  ledgerName: string;
  groupName: AccountGroup;
  debit: number;
  credit: number;
  partyType?: PartyType | null;
  isSystem?: boolean;
  isLoanAccount?: boolean;
  loanAccountCategory?: string | null;
}

export interface LedgerStatementRow {
  date: string;
  voucherNo: string;
  type: VoucherType;
  narration: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface LoanAccount {
  id?: number;
  name: string;
  ledgerId?: number;
  category: LoanAccountCategory;
  phone?: string | null;
  address?: string | null;
  defaultRate: number;
  note?: string | null;
  openingBalance?: number;
  openingType?: DrCr;
  openingBook?: LoanBook;
  openingKBalance?: number;
  openingKType?: DrCr;
  openingPBalance?: number;
  openingPType?: DrCr;
  openingDate: string;
  pinned?: boolean;
}

export interface LoanTransaction {
  id?: number;
  accountId: number;
  accountName?: string;
  date: string;
  book: LoanBook;
  side: LoanSide;
  amount: number;
  counterLedgerId: number;
  counterLedgerName?: string;
  interestAmount?: number;
  interestLedgerId?: number;
  interestLedgerName?: string;
  monthlyRate: number;
  narration?: string;
  voucherId?: number | null;
}

export interface LoanStatementRow extends LoanTransaction {
  days: number;
  interest: number;
}

export interface LoanSummaryRow {
  accountId: number;
  accountName: string;
  ledgerId: number;
  kBalance: number;
  pBalance: number;
  totalBalance: number;
  interest: number;
  netBalance: number;
}

export interface ProfitLossInterestRow {
  accountId: number;
  accountName: string;
  category: string;
  kBalance: number;
  pBalance: number;
  totalBalance: number;
  kInterest: number;
  pInterest: number;
  totalInterest: number;
}

export interface ProfitLossData {
  incomeRows: TrialBalanceRow[];
  expenseRows: TrialBalanceRow[];
  interestReceivable: ProfitLossInterestRow[];
  interestPayable: ProfitLossInterestRow[];
}

export interface ReportFilters {
  from?: string;
  to?: string;
  ledgerId?: number;
  partyLedgerId?: number;
  type?: string;
  search?: string;
  book?: ReportBook;
}

export interface AppInit {
  hasAdmin: boolean;
  company?: Company | null;
  dbPath: string;
}

export interface BackupResult {
  ok: boolean;
  path?: string;
  message: string;
}

export interface CloudSyncSettings {
  enabled: boolean;
  endpointUrl?: string;
  authToken: string;
  lastSyncedAt?: string;
  lastSyncMessage?: string;
  syncIntervalMinutes?: number;
}

export interface CloudSyncResult {
  ok: boolean;
  message: string;
  syncedAt?: string;
  endpointUrl?: string;
  status?: number;
}

export type LicenseMode = 'trial' | 'licensed' | 'expired' | 'blocked' | 'unlicensed';

export interface LicenseStatus {
  allowed: boolean;
  mode: LicenseMode;
  message: string;
  trialStartedAt: string;
  trialEndsAt: string;
  trialRemainingDays: number;
  licenseKey?: string;
  licenseServerUrl: string;
  deviceId: string;
  machineGuid?: string;
  deviceName: string;
  operatingSystem: string;
  expiryDate?: string;
  remainingDays?: number;
  maxDevices?: number;
  activeDevices?: number;
  lastCheckedAt?: string;
  blockReason?: string | null;
}

export interface LicenseActivationResult {
  ok: boolean;
  status: LicenseStatus;
}

export interface BalanceBDHistory {
  id?: number;
  ledgerId: number;
  loanAccountId: number;
  date: string;
  preKBalance: number;
  preKType: string;
  prePBalance: number;
  prePType: string;
  preOpeningBalance: number;
  preOpeningType: string;
  preOpeningDate: string;
  postKBalance: number;
  postKType: string;
  postPBalance: number;
  postPType: string;
  postOpeningBalance: number;
  postOpeningType: string;
  postOpeningDate: string;
  pdfPath?: string | null;
  createdAt?: string;
}
