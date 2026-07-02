import type { AccountingApi } from '../shared/ipc.js';

const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const ipcChannels = {
  invoke: 'accounting:invoke',
  windowControl: 'window:control',
  windowState: 'window:state',
  fullscreenChanged: 'window:fullscreen-changed'
} as const;

const call = <T,>(method: keyof AccountingApi, ...args: unknown[]): Promise<T> => {
  return ipcRenderer.invoke(ipcChannels.invoke, method, args);
};

const api: AccountingApi = {
  init: () => call('init'),
  createAdmin: (password) => call('createAdmin', password),
  login: (password) => call('login', password),
  changePassword: (currentPassword, nextPassword) => call('changePassword', currentPassword, nextPassword),
  getCompany: () => call('getCompany'),
  saveCompany: (company) => call('saveCompany', company),
  closeFinancialYear: (company, manualCloseDate) => call('closeFinancialYear', company, manualCloseDate),
  listFinancialYearArchives: () => call('listFinancialYearArchives'),
  undoFinancialYearClose: (archiveId) => call('undoFinancialYearClose', archiveId),
  listLedgers: () => call('listLedgers'),
  saveLedger: (ledger) => call('saveLedger', ledger),
  deleteLedger: (id) => call('deleteLedger', id),
  listItems: () => call('listItems'),
  saveItem: (item) => call('saveItem', item),
  deleteItem: (id) => call('deleteItem', id),
  listVouchers: (filters) => call('listVouchers', filters),
  saveVoucher: (voucher) => call('saveVoucher', voucher),
  deleteVoucher: (id) => call('deleteVoucher', id),
  listInvoices: (filters) => call('listInvoices', filters),
  saveInvoice: (invoice) => call('saveInvoice', invoice),
  deleteInvoice: (id) => call('deleteInvoice', id),
  dashboard: () => call('dashboard'),
  trialBalance: (filters) => call('trialBalance', filters),
  ledgerStatement: (ledgerId, filters) => call('ledgerStatement', ledgerId, filters),
  listLoanAccounts: () => call('listLoanAccounts'),
  saveLoanAccount: (account) => call('saveLoanAccount', account),
  deleteLoanAccount: (id) => call('deleteLoanAccount', id),
  saveLoanTransaction: (transaction) => call('saveLoanTransaction', transaction),
  updateLoanTransaction: (transaction) => call('updateLoanTransaction', transaction),
  deleteLoanTransaction: (id) => call('deleteLoanTransaction', id),
  postManualInterest: (accountId, date) => call('postManualInterest', accountId, date),
  setLoanAccountPinned: (id, pinned) => call('setLoanAccountPinned', id, pinned),
  loanStatement: (accountId, asOf) => call('loanStatement', accountId, asOf),
  lendingSummary: (asOf) => call('lendingSummary', asOf),
  profitLossData: (asOf, book) => call('profitLossData', asOf, book),
  report: (name, filters) => call('report', name, filters),
  exportBackup: () => call('exportBackup'),
  restoreBackup: () => call('restoreBackup'),
  setAutoBackup: (enabled) => call('setAutoBackup', enabled),
  getAutoBackup: () => call('getAutoBackup'),
  getCloudSyncSettings: () => call('getCloudSyncSettings'),
  saveCloudSyncSettings: (settings) => call('saveCloudSyncSettings', settings),
  generateCloudAccessKey: (settings) => call('generateCloudAccessKey', settings),
  syncDatabaseToCloud: () => call('syncDatabaseToCloud'),
  exportInvoicePdf: (invoiceId) => call('exportInvoicePdf', invoiceId),
  showSaveDialog: (defaultPath) => call('showSaveDialog', defaultPath),
  savePDFFile: (filePath, base64Data) => call('savePDFFile', filePath, base64Data),
  performBalanceBD: (accountId, asOfDate, pdfPath) => call('performBalanceBD', accountId, asOfDate, pdfPath),
  undoBalanceBD: (accountId) => call('undoBalanceBD', accountId),
  getLatestBalanceBD: (accountId) => call('getLatestBalanceBD', accountId),
  listBalanceBDHistory: () => call('listBalanceBDHistory'),
  openPDFFile: (filePath) => call('openPDFFile', filePath),
  printPDFFile: (filePath, orientation) => call('printPDFFile', filePath, orientation),
  resetDatabase: () => call('resetDatabase'),
  getLicenseStatus: () => call('getLicenseStatus'),
  activateLicense: (licenseKey) => call('activateLicense', licenseKey),
  validateLicense: () => call('validateLicense')
};

contextBridge.exposeInMainWorld('accounting', api);
contextBridge.exposeInMainWorld('windowControls', {
  close: () => ipcRenderer.send(ipcChannels.windowControl, 'close'),
  minimize: () => ipcRenderer.send(ipcChannels.windowControl, 'minimize'),
  enterFullscreen: () => ipcRenderer.send(ipcChannels.windowControl, 'enter-fullscreen'),
  exitFullscreen: () => ipcRenderer.send(ipcChannels.windowControl, 'exit-fullscreen'),
  toggleFullscreen: () => ipcRenderer.send(ipcChannels.windowControl, 'toggle-fullscreen'),
  focus: () => ipcRenderer.send(ipcChannels.windowControl, 'focus'),
  getState: () => ipcRenderer.invoke(ipcChannels.windowState),
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, isFullscreen: boolean) => callback(isFullscreen);
    ipcRenderer.on(ipcChannels.fullscreenChanged, listener);
    return () => ipcRenderer.removeListener(ipcChannels.fullscreenChanged, listener);
  }
});
