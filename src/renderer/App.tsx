import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, BarChart3, Building2, CheckCircle2, ChevronDown, Download, Eye, EyeOff, FileSpreadsheet, FileText, HardDriveDownload, HardDriveUpload, Home, KeyRound, Maximize2, Menu, Minimize2, Minus, Moon, MoreVertical, PanelLeftClose, PanelLeftOpen, Pencil, Pin, PinOff, Plus, Printer, RefreshCw, Save, Search, Settings, ShieldCheck, Shrink, Sun, Trash2, UserPlus, Users, X } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Toaster, toast } from 'sonner';
import type { AppInit, CloudSyncSettings, Company, Ledger, LicenseStatus, LoanAccount, LoanBook, LoanSide, LoanStatementRow, LoanSummaryRow, LoanTransaction, ProfitLossData, ReportBook, TrialBalanceRow, Voucher } from '../shared/types';
import './styles.css';

const today = () => new Date().toISOString().slice(0, 10);
const amount = (value = 0) => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const dateText = (date?: string) => date ? date.split('-').reverse().join('-') : '';
const dateTimeText = (date?: string) => date ? new Date(date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not available';
const daysBetweenDates = (from?: string, to?: string) => {
  if (!from || !to) return 0;
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  const days = Math.floor((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86_400_000);
  return Number.isFinite(days) && days > 0 ? days : 0;
};
const bookLabel = (book: ReportBook) => book === 'K' ? 'Khacha' : book === 'P' ? 'Packa' : 'Combined';
const safeFileName = (name: string) => name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
const defaultCategories = ['Debtors', 'Creditors', 'Capital', 'Income', 'Expenses', 'Other A/C'];
const appName = 'JJ Accounting';
const defaultCompany = (): Company => ({ name: '', shopNo: '', address: '', phone: '', email: '', gstin: '', financialYear: '' });
const blankAccount: LoanAccount = { name: '', category: 'Debtors', phone: '', address: '', defaultRate: 1.5, note: '', openingKBalance: 0, openingKType: 'Dr', openingPBalance: 0, openingPType: 'Dr', openingDate: today() };
const emptyAccount = (): LoanAccount => ({ ...blankAccount });
const blankEntry: LoanTransaction = {
  accountId: 0,
  date: today(),
  book: 'K',
  side: 'Dr',
  amount: 0,
  counterLedgerId: 0,
  interestAmount: 0,
  interestLedgerId: 0,
  monthlyRate: 1.5,
  narration: ''
};

const generateWebsitePassword = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('').replace(/(.{6})/g, '$1-').replace(/-$/, '');
};

function App() {
  const [init, setInit] = useState<AppInit | null>(null);
  const [password, setPassword] = useState('');
  const [company, setCompany] = useState<Company | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [accounts, setAccounts] = useState<LoanAccount[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [selectedId, setSelectedId] = useState(0);
  const [newAccountForm, setNewAccountForm] = useState<LoanAccount>(emptyAccount);
  const [editAccountForm, setEditAccountForm] = useState<LoanAccount>(emptyAccount);
  const [entry, setEntry] = useState<LoanTransaction>(blankEntry);
  const [rows, setRows] = useState<LoanStatementRow[]>([]);
  const [asOf, setAsOf] = useState(today());
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [view, setView] = useState<'dashboard' | 'account' | 'accounts' | 'manage' | 'trial' | 'balance' | 'profit_loss' | 'settings'>('dashboard');
  const [plAsOf, setPlAsOf] = useState(today());
  const [plData, setPlData] = useState<ProfitLossData | null>(null);
  const [plBook, setPlBook] = useState<ReportBook>('Combined');
  const [settingsTab, setSettingsTab] = useState<'firm' | 'license' | 'backup' | 'cloud' | 'security' | 'records'>('firm');
  const [trialRows, setTrialRows] = useState<TrialBalanceRow[]>([]);
  const [summaryRows, setSummaryRows] = useState<LoanSummaryRow[]>([]);
  const [recentVouchers, setRecentVouchers] = useState<Voucher[]>([]);
  const [accountBusy, setAccountBusy] = useState(false);
  const [dark, setDark] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sheetZoom, setSheetZoom] = useState(1);
  const [accountEditorOpen, setAccountEditorOpen] = useState(false);
  const [showEntryDetails, setShowEntryDetails] = useState(false);
  const [reportBook, setReportBook] = useState<ReportBook>('Combined');
  const [accountBook, setAccountBook] = useState<ReportBook>('Combined');
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [worksheetEditMode, setWorksheetEditMode] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<LoanStatementRow | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<LoanStatementRow | null>(null);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [latestBD, setLatestBD] = useState<any>(null);
  const [showBDConfirm, setShowBDConfirm] = useState(false);
  const [showUndoConfirm, setShowUndoConfirm] = useState(false);

  useEffect(() => {
    Promise.all([window.accounting.init(), window.accounting.getLicenseStatus()])
      .then(([nextInit, nextLicense]) => {
        setInit(nextInit);
        setCompany(nextInit.company ?? null);
        setLicenseStatus(nextLicense);
      })
      .catch((error) => toast.error(error.message));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const load = async (nextId = selectedId, nextAsOf = asOf) => {
    const [nextAccounts, nextLedgers, nextSummary, nextVouchers] = await Promise.all([window.accounting.listLoanAccounts(), window.accounting.listLedgers(), window.accounting.lendingSummary(nextAsOf), window.accounting.listVouchers({})]);
    setAccounts(nextAccounts);
    setLedgers(nextLedgers);
    setSummaryRows(nextSummary);
    setRecentVouchers(nextVouchers.slice(0, 10));
    const active = nextId || 0;
    const activeAccount = selectedAccount(nextAccounts, active);
    const firstOppositeLedger = nextLedgers.find((ledger) => ledger.id !== activeAccount?.ledgerId);
    setSelectedId(active);
    setEntry((current) => ({
      ...current,
      accountId: active,
      counterLedgerId: nextLedgers.some((ledger) => ledger.id === current.counterLedgerId && ledger.id !== activeAccount?.ledgerId) ? current.counterLedgerId : firstOppositeLedger?.id || 0,
      monthlyRate: activeAccount?.defaultRate ?? current.monthlyRate ?? 1.5
    }));
    setRows(active ? await window.accounting.loanStatement(active, nextAsOf) : []);
    if (active) {
      try {
        const history = await window.accounting.getLatestBalanceBD(active);
        setLatestBD(history);
      } catch (err) {
        setLatestBD(null);
      }
    } else {
      setLatestBD(null);
    }
  };

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (init?.hasAdmin) {
        await window.accounting.login(password);
      } else {
        await window.accounting.createAdmin(password || '123456');
      }
      setUnlocked(true);
      const nextLicense = await window.accounting.getLicenseStatus();
      setLicenseStatus(nextLicense);
      if (nextLicense.allowed) {
        await load(0);
      } else {
        setSettingsTab('license');
        setView('settings');
        toast.error(nextLicense.message);
      }
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const refreshLicenseStatus = async () => {
    const nextLicense = await window.accounting.getLicenseStatus();
    setLicenseStatus(nextLicense);
    if (nextLicense.allowed && !accounts.length) await load(0);
    return nextLicense;
  };

  const saveNewAccount = async () => {
    if (accountBusy) return;
    setAccountBusy(true);
    try {
      const saved = await window.accounting.saveLoanAccount({ ...newAccountForm, id: undefined, ledgerId: undefined });
      setNewAccountForm(emptyAccount());
      setAccountEditorOpen(false);
      await load(saved.id ?? selectedId);
      setView('account');
      toast.success('Account created');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setAccountBusy(false);
    }
  };

  const saveEditedAccount = async () => {
    if (accountBusy) return;
    setAccountBusy(true);
    try {
      const saved = await window.accounting.saveLoanAccount(editAccountForm);
      setEditAccountForm(emptyAccount());
      setAccountEditorOpen(false);
      await load(saved.id ?? selectedId);
      setView('account');
      toast.success('Account updated');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setAccountBusy(false);
    }
  };

  const chooseAccount = async (id: number) => {
    const account = accounts.find((row) => row.id === id);
    const firstOppositeLedger = ledgers.find((ledger) => ledger.id !== account?.ledgerId);
    setSelectedId(id);
    setView('account');
    setEntry((current) => ({
      ...current,
      accountId: id,
      counterLedgerId: ledgers.some((ledger) => ledger.id === current.counterLedgerId && ledger.id !== account?.ledgerId) ? current.counterLedgerId : firstOppositeLedger?.id || 0,
      monthlyRate: account?.defaultRate ?? current.monthlyRate
    }));
    setRows(id ? await window.accounting.loanStatement(id, asOf) : []);
    if (id) {
      try {
        const history = await window.accounting.getLatestBalanceBD(id);
        setLatestBD(history);
      } catch (err) {
        setLatestBD(null);
      }
    } else {
      setLatestBD(null);
    }
  };

  const openTrialBalance = async () => {
    setTrialRows(await window.accounting.trialBalance({ book: reportBook }));
    setView('trial');
  };

  const openBalanceSheet = async () => {
    setTrialRows(await window.accounting.trialBalance({ book: reportBook }));
    setView('balance');
  };

  const openProfitLoss = async () => {
    try {
      const data = await window.accounting.profitLossData(plAsOf, plBook);
      setPlData(data);
      setView('profit_loss');
    } catch (error: any) {
      toast.error(error?.message ?? 'Failed to load Profit & Loss data');
    }
  };

  const refreshPL = async (nextAsOf: string, nextBook: ReportBook) => {
    setPlAsOf(nextAsOf);
    setPlBook(nextBook);
    try {
      const data = await window.accounting.profitLossData(nextAsOf, nextBook);
      setPlData(data);
    } catch (error: any) {
      toast.error(error?.message ?? 'Failed to refresh Profit & Loss data');
    }
  };


  const postAmount = async () => {
    try {
      const selectedCounter = oppositeLedgers.find((ledger) => ledger.id === entry.counterLedgerId);
      if (!selectedCounter) throw new Error('Select a valid opposite account.');
      await window.accounting.saveLoanTransaction({
        ...entry,
        accountId: selectedId,
        monthlyRate: activeAccount?.defaultRate ?? entry.monthlyRate,
        narration: `Being amount recorded in ${activeAccount?.name} A/c against ${selectedCounter.name} A/c (${entry.book === 'K' ? 'Khacha' : 'Packa'} Book).`
      });
      setEntry((current) => ({ ...blankEntry, accountId: selectedId, counterLedgerId: current.counterLedgerId, monthlyRate: activeAccount?.defaultRate ?? current.monthlyRate }));
      await load(selectedId);
      toast.success('Amount passed into account');
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const deleteAccount = async (account: LoanAccount | null) => {
    if (!account?.id) return;
    if (!confirm(`Delete ${account.name} and all its entries?`)) return;
    if (accountBusy) return;
    setAccountBusy(true);
    try {
      await window.accounting.deleteLoanAccount(account.id);
      setSelectedId(0);
      setRows([]);
      setEditAccountForm(emptyAccount());
      setAccountEditorOpen(false);
      setView('manage');
      await load(0);
      toast.success('Account deleted');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setAccountBusy(false);
    }
  };

  const togglePin = async (account: LoanAccount) => {
    if (!account.id) return;
    try {
      await window.accounting.setLoanAccountPinned(account.id, !account.pinned);
      await load(selectedId);
      toast.success(account.pinned ? 'Account unpinned' : 'Account pinned');
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const deleteTransaction = async (transaction: LoanStatementRow) => {
    if (!transaction.id) return;
    try {
      await window.accounting.deleteLoanTransaction(transaction.id);
      setDeleteCandidate(null);
      setEditingTransaction(null);
      await load(selectedId, asOf);
      toast.success('Transaction deleted');
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handlePerformBD = async () => {
    if (!activeAccount?.id) return;
    try {
      const defaultName = `${activeAccount.name}-statement-${asOf}.pdf`;
      const saveResult = await window.accounting.showSaveDialog(defaultName);
      if (saveResult.canceled || !saveResult.filePath) {
        toast.info('Balance B/D cancelled.');
        return;
      }

      const filePath = saveResult.filePath;

      // Generate PDF
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

      doc.setFontSize(18);
      doc.text(company?.name || 'JJ Accounting', 40, 40);
      doc.setFontSize(10);
      doc.text(`Shop No: ${company?.shopNo || ''}, Address: ${company?.address || ''}`, 40, 55);
      doc.text(`Phone: ${company?.phone || ''}, Email: ${company?.email || ''}`, 40, 68);

      doc.setFontSize(14);
      doc.text(`Ledger Statement for: ${activeAccount.name}`, 40, 95);
      doc.setFontSize(10);
      doc.text(`Category: ${activeAccount.category || 'Debtors'} | Interest up to: ${asOf}`, 40, 110);
      doc.text(`Phone: ${activeAccount.phone || 'N/A'} | Address: ${activeAccount.address || 'N/A'}`, 40, 122);

      const activeRows = rows.filter(row => row.date <= asOf);

      const getBookTotals = (book: LoanBook) => {
        const bookRows = activeRows.filter((row) => row.book === book);
        const opening = book === 'K' ? Number(activeAccount.openingKBalance || 0) : Number(activeAccount.openingPBalance || 0);
        const openingType = book === 'K' ? activeAccount.openingKType : activeAccount.openingPType;
        const debit = bookRows.filter((row) => row.side === 'Dr').reduce((sum, row) => sum + Number(row.amount || 0), openingType !== 'Cr' ? opening : 0);
        const credit = bookRows.filter((row) => row.side === 'Cr').reduce((sum, row) => sum + Number(row.amount || 0), openingType === 'Cr' ? opening : 0);
        const openingDays = daysBetweenDates(activeAccount.openingDate, asOf);
        const openingInterest = opening * Number(activeAccount.defaultRate || 0) / 100 / 30 * openingDays * (openingType === 'Cr' ? -1 : 1);
        const interest = openingInterest + bookRows.reduce((sum, row) => sum + Number(row.interest || 0), 0);
        return { debit, credit, balance: debit - credit, interest, openingInterest, opening };
      };

      const k = getBookTotals('K');
      const p = getBookTotals('P');
      const totals = {
        debit: k.debit + p.debit,
        credit: k.credit + p.credit,
        balance: k.balance + p.balance,
        interest: k.interest + p.interest
      };

      autoTable(doc, {
        startY: 135,
        head: [['Book', 'Debit Total', 'Credit Total', 'Closing Balance', 'Accumulated Interest']],
        body: [
          ['Khacha', k.debit.toFixed(2), k.credit.toFixed(2), `${k.balance >= 0 ? 'Dr. ' : 'Cr. '}${Math.abs(k.balance).toFixed(2)}`, k.interest.toFixed(2)],
          ['Packa', p.debit.toFixed(2), p.credit.toFixed(2), `${p.balance >= 0 ? 'Dr. ' : 'Cr. '}${Math.abs(p.balance).toFixed(2)}`, p.interest.toFixed(2)],
          ['Combined', totals.debit.toFixed(2), totals.credit.toFixed(2), `${totals.balance >= 0 ? 'Dr. ' : 'Cr. '}${Math.abs(totals.balance).toFixed(2)}`, totals.interest.toFixed(2)]
        ],
        theme: 'striped',
        styles: { fontSize: 9, cellPadding: 3 }
      });

      const getBookTableData = (book: 'K' | 'P', totalsObj: any) => {
        const bookRows = activeRows.filter((row) => row.book === book);
        const debitRows = bookRows.filter((row) => row.side === 'Dr').sort((a, b) => `${a.date}-${a.id ?? 0}`.localeCompare(`${b.date}-${b.id ?? 0}`));
        const creditRows = bookRows.filter((row) => row.side === 'Cr').sort((a, b) => `${a.date}-${a.id ?? 0}`.localeCompare(`${b.date}-${b.id ?? 0}`));

        const debitEntries = [...(totalsObj.opening > 0 && (book === 'K' ? activeAccount.openingKType : activeAccount.openingPType) === 'Dr' ? [{ opening: true }] : []), ...debitRows.map((row) => ({ row }))];
        const creditEntries = [...(totalsObj.opening > 0 && (book === 'K' ? activeAccount.openingKType : activeAccount.openingPType) === 'Cr' ? [{ opening: true }] : []), ...creditRows.map((row) => ({ row }))];
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
            dOpening ? dateText(activeAccount.openingDate) : dRow ? dateText(dRow.date) : '',
            dOpening ? 'Opening Balance' : dRow ? dRow.counterLedgerName || '' : '',
            dOpening ? totalsObj.opening.toFixed(2) : dRow ? dRow.amount.toFixed(2) : '',
            dOpening ? totalsObj.openingInterest.toFixed(2) : dRow ? Number(dRow.interest || 0).toFixed(2) : '',
            cOpening ? dateText(activeAccount.openingDate) : cRow ? dateText(cRow.date) : '',
            cOpening ? 'Opening Balance' : cRow ? cRow.counterLedgerName || '' : '',
            cOpening ? totalsObj.opening.toFixed(2) : cRow ? cRow.amount.toFixed(2) : '',
            cOpening ? totalsObj.openingInterest.toFixed(2) : cRow ? Number(cRow.interest || 0).toFixed(2) : ''
          ]);
        }

        const footer = [
          ['', 'Debit Total', totalsObj.debit.toFixed(2), Math.max(totalsObj.interest, 0).toFixed(2), '', 'Credit Total', totalsObj.credit.toFixed(2), Math.abs(Math.min(totalsObj.interest, 0)).toFixed(2)],
          [{ content: 'Closing Balance', colSpan: 6, styles: { halign: 'right', fontStyle: 'bold' } }, { content: `${totalsObj.balance >= 0 ? 'Dr. ' : 'Cr. '}${Math.abs(totalsObj.balance).toFixed(2)}`, colSpan: 2, styles: { fontStyle: 'bold' } }]
        ];

        return { body, footer };
      };

      const kData = getBookTableData('K', k);
      const pData = getBookTableData('P', p);

      let currentY = (doc as any).lastAutoTable.finalY + 25;
      doc.setFontSize(12);
      doc.text('Khacha Book Ledger', 40, currentY);
      
      autoTable(doc, {
        startY: currentY + 10,
        head: [
          [{ content: 'Debit Side (Dr.)', colSpan: 4, styles: { halign: 'center', fillColor: [239, 246, 255], textColor: [30, 58, 138] } }, { content: 'Credit Side (Cr.)', colSpan: 4, styles: { halign: 'center', fillColor: [254, 242, 242], textColor: [153, 27, 27] } }],
          ['Date', 'Particulars', 'Amount', 'Interest', 'Date', 'Particulars', 'Amount', 'Interest']
        ],
        body: kData.body,
        foot: kData.footer,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 4 }
      });

      currentY = (doc as any).lastAutoTable.finalY + 30;
      if (currentY > doc.internal.pageSize.getHeight() - 150) {
        doc.addPage();
        currentY = 40;
      }
      doc.setFontSize(12);
      doc.text('Packa Book Ledger', 40, currentY);

      autoTable(doc, {
        startY: currentY + 10,
        head: [
          [{ content: 'Debit Side (Dr.)', colSpan: 4, styles: { halign: 'center', fillColor: [239, 246, 255], textColor: [30, 58, 138] } }, { content: 'Credit Side (Cr.)', colSpan: 4, styles: { halign: 'center', fillColor: [254, 242, 242], textColor: [153, 27, 27] } }],
          ['Date', 'Particulars', 'Amount', 'Interest', 'Date', 'Particulars', 'Amount', 'Interest']
        ],
        body: pData.body,
        foot: pData.footer,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 4 }
      });

      const base64 = doc.output('datauristring').split(',')[1];
      const saveOk = await window.accounting.savePDFFile(filePath, base64);
      if (!saveOk) throw new Error('Failed to save statement PDF.');

      const result = await window.accounting.performBalanceBD(activeAccount.id, asOf, filePath);
      if (result) {
        toast.success('Balance B/D completed successfully.');
        await load(selectedId, asOf);
      }
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleUndoBD = async () => {
    if (!activeAccount?.id) return;
    try {
      const result = await window.accounting.undoBalanceBD(activeAccount.id);
      if (result) {
        toast.success('Balance B/D undone successfully.');
        await load(selectedId, asOf);
      }
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const saveEditedTransaction = async () => {
    if (!editingTransaction?.id) return;
    try {
      const counter = oppositeLedgers.find((ledger) => ledger.id === editingTransaction.counterLedgerId);
      if (!counter) throw new Error('Select a valid opposite account.');
      if (editingTransaction.amount <= 0) throw new Error('Amount must be greater than zero.');
      await window.accounting.updateLoanTransaction({
        ...editingTransaction,
        narration: `Being amount recorded in ${activeAccount?.name} A/c against ${counter.name} A/c (${editingTransaction.book === 'K' ? 'Khacha' : 'Packa'} Book).`
      });
      setEditingTransaction(null);
      await load(selectedId, asOf);
      toast.success('Transaction updated');
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const refreshDate = async (value: string) => {
    setAsOf(value);
    await load(selectedId, value);
  };

  const filteredAccounts = accounts.filter((account) => {
    const matchesSearch = account.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === 'All' || account.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });
  const accountCategories = Array.from(new Set([...defaultCategories, ...accounts.map((account) => account.category).filter(Boolean)])).sort();
  const activeAccount = selectedAccount(accounts, selectedId);
  const accountForLedger = (ledgerId?: number) => accounts.find((account) => account.ledgerId === ledgerId);
  const oppositeLedgers = ledgers
    .filter((ledger) => ledger.id !== activeAccount?.ledgerId)
    .sort((left, right) => Number(Boolean(accountForLedger(right.id)?.pinned)) - Number(Boolean(accountForLedger(left.id)?.pinned)) || left.name.localeCompare(right.name));
  const licenseLocked = Boolean(unlocked && licenseStatus && !licenseStatus.allowed);

  if (!init) return <><WindowTopBar /><Splash /></>;
  if (!unlocked) return <><WindowTopBar /><Login password={password} setPassword={setPassword} onSubmit={unlock} firstRun={!init.hasAdmin} company={company} /></>;

  return (
    <>
    <WindowTopBar />
    <main className={`app-shell ${view === 'account' && !sidebarOpen && !licenseLocked ? 'sidebar-collapsed' : ''}`}>
      <aside className="account-sidebar">
        <div className="brand">
          <button className="brand-home" type="button" onClick={() => { setView('dashboard'); setNavigationOpen(false); }} title="Go to Dashboard">
            <BrandIdentity compact />
            <span>Khacha / Packa Ledger</span>
          </button>
          <div className="brand-actions">
            <button className="theme-button" onClick={() => setNavigationOpen(!navigationOpen)} title="Open main menu"><Menu size={17} /></button>
            <button className="theme-button" onClick={() => setDark(!dark)} title="Change theme">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
          </div>
        </div>
        {navigationOpen && <div className="side-actions">
          <button onClick={() => setView('dashboard')} className={view === 'dashboard' ? 'selected' : ''} disabled={licenseLocked}><Home size={16} /> Dashboard</button>
          <button onClick={() => setView('accounts')} className={view === 'accounts' ? 'selected' : ''} disabled={licenseLocked}><Users size={16} /> All Accounts</button>
          <button onClick={() => setView('manage')} className={view === 'manage' ? 'selected' : ''} disabled={licenseLocked}><Users size={16} /> Manage Accounts</button>
          <button onClick={openTrialBalance} className={view === 'trial' ? 'selected' : ''} disabled={licenseLocked}><BarChart3 size={16} /> Trial Balance</button>
          <button onClick={openBalanceSheet} className={view === 'balance' ? 'selected' : ''} disabled={licenseLocked}><FileText size={16} /> Balance Sheet</button>
          <button onClick={openProfitLoss} className={view === 'profit_loss' ? 'selected' : ''} disabled={licenseLocked}><FileText size={16} /> Profit &amp; Loss</button>
          <button onClick={() => { setSettingsTab('firm'); setView('settings'); }} className={view === 'settings' ? 'selected' : ''}><Settings size={16} /> Settings</button>
        </div>}
        {licenseStatus && <button className={`license-sidebar-status ${licenseStatus.allowed ? licenseStatus.mode : 'locked'}`} type="button" onClick={() => { setSettingsTab('license'); setView('settings'); }}>
          {licenseStatus.allowed ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
          <span><strong>{licenseStatus.mode === 'licensed' ? 'Licensed' : licenseStatus.mode === 'trial' ? 'Free Trial' : 'License Required'}</strong><small>{licenseStatus.mode === 'trial' ? `${licenseStatus.trialRemainingDays} days left` : licenseStatus.remainingDays !== undefined ? `${licenseStatus.remainingDays} days left` : 'Activate now'}</small></span>
        </button>}
        <div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search account" /></div>
        <div className="category-filter">
          {['All', ...accountCategories].map((category) => (
            <button key={category} type="button" className={categoryFilter === category ? 'selected' : ''} onClick={() => setCategoryFilter(category)}>{category}</button>
          ))}
        </div>
        <div className="account-list">
          {filteredAccounts.map((account) => (
            <div className={`account-list-row ${selectedId === account.id ? 'selected' : ''}`} key={account.id}>
              <button onClick={() => chooseAccount(account.id!)}>{account.name}</button>
              <button className="sidebar-pin" title={account.pinned ? 'Unpin account' : 'Pin account'} onClick={() => togglePin(account)}>{account.pinned ? <Pin size={14} /> : <PinOff size={14} />}</button>
            </div>
          ))}
        </div>
      </aside>

      <section className="work-area">
        <header className="page-header">
          <div>
            <h1>{view === 'dashboard' ? 'Dashboard' : view === 'accounts' ? 'All Accounts' : view === 'manage' ? 'Manage Accounts' : view === 'trial' ? 'Trial Balance' : view === 'balance' ? 'Balance Sheet' : view === 'profit_loss' ? 'Profit & Loss' : view === 'settings' ? 'Settings' : activeAccount?.name}</h1>
            <p>{view === 'account' ? 'Pass entries directly into this account.' : view === 'settings' ? 'Firm profile, license, backup, and restore.' : 'Simple business account management.'}</p>
          </div>
          {view === 'account' && !licenseLocked && (
            <button className="secondary-button" onClick={() => setSidebarOpen(!sidebarOpen)}>
              {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />} {sidebarOpen ? 'Hide Menu' : 'Show Menu'}
            </button>
          )}
        </header>
        {view === 'settings' && licenseStatus && <SettingsView tab={settingsTab} setTab={setSettingsTab} company={company} dbPath={init.dbPath} licenseStatus={licenseStatus} onCompanySaved={(nextCompany) => { setCompany(nextCompany); setInit({ ...init, company: nextCompany }); }} onLicenseStatusChange={async (nextStatus) => { setLicenseStatus(nextStatus); if (nextStatus.allowed) await load(0); }} refreshLicenseStatus={refreshLicenseStatus} />}
        {licenseLocked && view !== 'settings' && licenseStatus && <SettingsView tab="license" setTab={setSettingsTab} company={company} dbPath={init.dbPath} licenseStatus={licenseStatus} onCompanySaved={(nextCompany) => { setCompany(nextCompany); setInit({ ...init, company: nextCompany }); }} onLicenseStatusChange={async (nextStatus) => { setLicenseStatus(nextStatus); if (nextStatus.allowed) await load(0); }} refreshLicenseStatus={refreshLicenseStatus} />}
        {!licenseLocked && view === 'dashboard' && <Dashboard accounts={accounts} vouchers={recentVouchers} openAccounts={() => setView('accounts')} openTrial={openTrialBalance} openBalance={openBalanceSheet} openProfitLoss={openProfitLoss} />}
        {!licenseLocked && view === 'accounts' && <AccountsView accounts={filteredAccounts} openAccount={chooseAccount} />}
        {!licenseLocked && view === 'manage' && <ManageAccounts accounts={filteredAccounts} accountForm={newAccountForm} categories={accountCategories} setAccountForm={setNewAccountForm} busy={accountBusy} onCreate={saveNewAccount} openAccount={chooseAccount} deleteAccount={(account) => deleteAccount(account)} togglePin={togglePin} />}
        {!licenseLocked && view === 'trial' && <TrialBalance rows={trialRows} book={reportBook} setBook={async (book) => { setReportBook(book); setTrialRows(await window.accounting.trialBalance({ book })); }} />}
        {!licenseLocked && view === 'balance' && <BalanceSheet rows={trialRows} book={reportBook} setBook={async (book) => { setReportBook(book); setTrialRows(await window.accounting.trialBalance({ book })); }} />}
        {!licenseLocked && view === 'profit_loss' && plData && <ProfitLoss data={plData} book={plBook} asOf={plAsOf} onRefresh={refreshPL} />}
        {!licenseLocked && view === 'account' && (
          <>
            <div className="entry-sticky">
              <div className="simple-panel">
                <h2>Pass Amount Directly Into {activeAccount?.name}</h2>
                <div className="form-grid entry-create">
                  <DateInput label="Date" value={entry.date} onChange={(value) => setEntry({ ...entry, date: value })} />
                  <Segment label="Side" value={entry.side} options={['Dr', 'Cr']} onChange={(value) => setEntry({ ...entry, side: value as LoanSide })} />
                  <Segment label="Record" value={entry.book} options={['K', 'P']} labels={{ K: 'Khacha', P: 'Packa' }} onChange={(value) => setEntry({ ...entry, book: value as LoanBook })} />
                  <NumberInput label="Amount" value={entry.amount} onChange={(value) => setEntry({ ...entry, amount: value, interestAmount: 0, interestLedgerId: 0 })} />
                  <SearchSelectInput
                    label={`Opposite A/c · ${entry.side === 'Dr' ? 'Credit' : 'Debit'}`}
                    value={String(entry.counterLedgerId || '')}
                    onChange={(value) => setEntry({ ...entry, counterLedgerId: Number(value) })}
                    onTogglePin={(accountId) => { const account = accounts.find((row) => row.id === accountId); if (account) void togglePin(account); }}
                    options={oppositeLedgers.map((ledger) => { const account = accountForLedger(ledger.id); return { value: String(ledger.id), label: ledger.name, accountId: account?.id, pinned: Boolean(account?.pinned) }; })}
                  />
                  <button className="primary-button" disabled={!entry.amount || !entry.counterLedgerId} onClick={postAmount}><Save size={16} /> Pass Entry</button>
                </div>
                <div className="entry-effect" aria-live="polite">
                  <span>Accounting effect</span>
                  <strong>{entry.side === 'Dr' ? activeAccount?.name : oppositeLedgers.find((ledger) => ledger.id === entry.counterLedgerId)?.name || 'Opposite account'} A/c Dr.</strong>
                  <i>To</i>
                  <strong>{entry.side === 'Cr' ? activeAccount?.name : oppositeLedgers.find((ledger) => ledger.id === entry.counterLedgerId)?.name || 'Opposite account'} A/c</strong>
                </div>
              </div>
            </div>
            {accountEditorOpen && (
              <div className="simple-panel account-editor-panel">
                <h2>Edit Account</h2>
                <div className="form-grid dashboard-create">
                  <TextInput label="Name" value={editAccountForm.name} onChange={(value) => setEditAccountForm((current) => ({ ...current, name: value }))} />
                  <CategoryInput label="Category" value={editAccountForm.category} categories={accountCategories} onChange={(value) => setEditAccountForm((current) => ({ ...current, category: value || 'Other A/C' }))} />
                  <TextInput label="Phone" value={editAccountForm.phone ?? ''} onChange={(value) => setEditAccountForm((current) => ({ ...current, phone: value }))} />
                  <TextInput label="Address" value={editAccountForm.address ?? ''} onChange={(value) => setEditAccountForm((current) => ({ ...current, address: value }))} />
                  <NumberInput label="Interest %" value={editAccountForm.defaultRate} onChange={(value) => setEditAccountForm((current) => ({ ...current, defaultRate: value }))} />
                  <OpeningBalanceFields account={editAccountForm} setAccount={setEditAccountForm} />
                  <button className="primary-button" onClick={saveEditedAccount} disabled={accountBusy || !editAccountForm.name.trim()}><Save size={16} /> {accountBusy ? 'Saving...' : 'Save Changes'}</button>
                </div>
              </div>
            )}
            <div className="sheet-toolbar">
              <div className="toolbar-group">
                <DateInput label="Interest up to" value={asOf} onChange={refreshDate} />
              </div>
              <div className="toolbar-group">
                <ViewTabs value={accountBook} onChange={setAccountBook} />
                <div className="worksheet-quick-tools" aria-label="Worksheet display and editing tools">
                  <button className={`worksheet-icon-tool ${showEntryDetails ? 'active' : ''}`} data-tooltip={showEntryDetails ? 'Hide details' : 'Show details'} aria-label={showEntryDetails ? 'Hide transaction details' : 'Show transaction details'} aria-pressed={showEntryDetails} onClick={() => setShowEntryDetails(!showEntryDetails)}>{showEntryDetails ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                  <button className={`worksheet-icon-tool ${worksheetEditMode ? 'active editing' : ''}`} data-tooltip={worksheetEditMode ? 'Finish editing' : 'Edit entries'} aria-label={worksheetEditMode ? 'Finish editing entries' : 'Edit entries'} aria-pressed={worksheetEditMode} onClick={() => { setWorksheetEditMode(!worksheetEditMode); setEditingTransaction(null); setDeleteCandidate(null); }}><Pencil size={16} /></button>
                </div>
                <button className="secondary-button icon-only" onClick={() => setSheetZoom(Math.max(0.75, Number((sheetZoom - 0.1).toFixed(2))))}><Minus size={16} /></button>
                <span className="zoom-value">{Math.round(sheetZoom * 100)}%</span>
                <button className="secondary-button icon-only" onClick={() => setSheetZoom(Math.min(1.35, Number((sheetZoom + 0.1).toFixed(2))))}><Plus size={16} /></button>
                <ReportActions targetId="account-report" title={`${activeAccount?.name || 'Account'} - ${bookLabel(accountBook)}`} />
                <details className="export-menu actions-menu">
                  <summary><Settings size={16} /> Actions <ChevronDown size={15} /></summary>
                  <div className="export-menu-popover actions-menu-popover">
                    <button type="button" onClick={(event) => {
                      setEditAccountForm(activeAccount ? { ...activeAccount } : emptyAccount());
                      setAccountEditorOpen(!accountEditorOpen);
                      (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                    }}>
                      <Pencil size={16} />
                      <span><strong>Edit Account</strong><small>Modify name, category or default interest</small></span>
                    </button>
                    {activeAccount && (
                      <button type="button" onClick={(event) => {
                        void togglePin(activeAccount);
                        (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                      }}>
                        {activeAccount.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                        <span><strong>{activeAccount.pinned ? 'Unpin Account' : 'Pin Account'}</strong><small>Toggle pin status in sidebar</small></span>
                      </button>
                    )}
                    {activeAccount && (
                      <button type="button" onClick={(event) => {
                        setShowBDConfirm(true);
                        (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                      }}>
                        <RefreshCw size={16} />
                        <span><strong>Balance B/D</strong><small>Consolidate ledger entries & save PDF</small></span>
                      </button>
                    )}
                    {latestBD && (
                      <button type="button" className="danger-item" onClick={(event) => {
                        setShowUndoConfirm(true);
                        (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                      }}>
                        <RefreshCw size={16} />
                        <span><strong>Undo Balance B/D</strong><small>Restore archived entries & revert balances</small></span>
                      </button>
                    )}
                  </div>
                </details>
              </div>
            </div>
            <details className="mobile-account-tools">
              <summary><Menu size={17} /> Account Options <ChevronDown size={15} /></summary>
              <div className="mobile-account-tools-panel">
                <DateInput label="Interest up to" value={asOf} onChange={refreshDate} />
                <button className="secondary-button" onClick={(event) => {
                  setEditAccountForm(activeAccount ? { ...activeAccount } : emptyAccount());
                  setAccountEditorOpen(!accountEditorOpen);
                  (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                }}><Pencil size={16} /> Edit Account</button>
                {activeAccount && (
                  <button className="secondary-button" onClick={(event) => {
                    void togglePin(activeAccount);
                    (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                  }}>{activeAccount.pinned ? <PinOff size={16} /> : <Pin size={16} />} {activeAccount.pinned ? 'Unpin Account' : 'Pin Account'}</button>
                )}
                {activeAccount && (
                  <button className="primary-button" onClick={(event) => {
                    setShowBDConfirm(true);
                    (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                  }}><RefreshCw size={15} /> Balance B/D</button>
                )}
                {latestBD && (
                  <button className="danger-button" onClick={(event) => {
                    setShowUndoConfirm(true);
                    (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                  }}><RefreshCw size={15} /> Undo B/D</button>
                )}
                <div className="mobile-tool-block"><span>Ledger view</span><ViewTabs value={accountBook} onChange={setAccountBook} /></div>
                <div className="mobile-tool-block"><span>Worksheet tools</span><div className="worksheet-quick-tools mobile">
                  <button className={`worksheet-icon-tool ${showEntryDetails ? 'active' : ''}`} title={showEntryDetails ? 'Hide details' : 'Show details'} aria-label={showEntryDetails ? 'Hide transaction details' : 'Show transaction details'} aria-pressed={showEntryDetails} onClick={() => setShowEntryDetails(!showEntryDetails)}>{showEntryDetails ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                  <button className={`worksheet-icon-tool ${worksheetEditMode ? 'active editing' : ''}`} title={worksheetEditMode ? 'Finish editing' : 'Edit entries'} aria-label={worksheetEditMode ? 'Finish editing entries' : 'Edit entries'} aria-pressed={worksheetEditMode} onClick={() => { setWorksheetEditMode(!worksheetEditMode); setEditingTransaction(null); setDeleteCandidate(null); }}><Pencil size={17} /></button>
                </div></div>
                <div className="mobile-zoom-row">
                  <button className="secondary-button icon-only" onClick={() => setSheetZoom(Math.max(0.75, Number((sheetZoom - 0.1).toFixed(2))))}><Minus size={16} /></button>
                  <span className="zoom-value">{Math.round(sheetZoom * 100)}%</span>
                  <button className="secondary-button icon-only" onClick={() => setSheetZoom(Math.min(1.35, Number((sheetZoom + 0.1).toFixed(2))))}><Plus size={16} /></button>
                </div>
                <ReportActions targetId="account-report" title={`${activeAccount?.name || 'Account'} - ${bookLabel(accountBook)}`} />
              </div>
            </details>
            {editingTransaction && <div className="transaction-editor simple-panel">
              <div className="transaction-editor-head"><div><span>Edit transaction</span><h2>{activeAccount?.name} A/c</h2></div><button className="editor-close" title="Cancel editing" onClick={() => setEditingTransaction(null)}><X size={17} /></button></div>
              <div className="transaction-editor-grid">
                <DateInput label="Date" value={editingTransaction.date} onChange={(date) => setEditingTransaction({ ...editingTransaction, date })} />
                <Segment label="Side" value={editingTransaction.side} options={['Dr', 'Cr']} onChange={(side) => setEditingTransaction({ ...editingTransaction, side: side as LoanSide })} />
                <Segment label="Book" value={editingTransaction.book} options={['K', 'P']} labels={{ K: 'Khacha', P: 'Packa' }} onChange={(book) => setEditingTransaction({ ...editingTransaction, book: book as LoanBook })} />
                <NumberInput label="Amount" value={editingTransaction.amount} onChange={(value) => setEditingTransaction({ ...editingTransaction, amount: value })} />
                <SearchSelectInput label={`Opposite A/c · ${editingTransaction.side === 'Dr' ? 'Credit' : 'Debit'}`} value={String(editingTransaction.counterLedgerId)} onChange={(value) => setEditingTransaction({ ...editingTransaction, counterLedgerId: Number(value) })} options={oppositeLedgers.map((ledger) => ({ value: String(ledger.id), label: ledger.name }))} />
                <button className="primary-button" disabled={!editingTransaction.amount || !editingTransaction.counterLedgerId} onClick={saveEditedTransaction}><Save size={16} /> Save Changes</button>
              </div>
            </div>}
            <AccountSheet account={activeAccount} rows={rows} zoom={sheetZoom} showDetails={showEntryDetails} book={accountBook} asOf={asOf} editMode={worksheetEditMode} onEditTransaction={setEditingTransaction} onDeleteTransaction={setDeleteCandidate} />
          </>
        )}
        {deleteCandidate && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setDeleteCandidate(null)}>
          <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="confirm-icon"><Trash2 size={21} /></div>
            <h2 id="delete-title">Delete this transaction?</h2>
            <p>This will remove the linked debit and credit entries from both accounts and the journal.</p>
            <dl><div><dt>Date</dt><dd>{dateText(deleteCandidate.date)}</dd></div><div><dt>Amount</dt><dd>₹ {amount(deleteCandidate.amount)}</dd></div><div><dt>Book</dt><dd>{bookLabel(deleteCandidate.book)}</dd></div></dl>
            <div className="confirm-actions"><button className="secondary-button" onClick={() => setDeleteCandidate(null)}>Cancel</button><button className="danger-button" onClick={() => void deleteTransaction(deleteCandidate)}><Trash2 size={16} /> Delete Transaction</button></div>
          </div>
        </div>}
        {showBDConfirm && (
          <div className="dialog-backdrop" role="presentation" onMouseDown={() => setShowBDConfirm(false)}>
            <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="bd-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="confirm-icon" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}><RefreshCw size={21} /></div>
              <h2 id="bd-title">Perform Balance B/D?</h2>
              <p>This will consolidate all entries for <strong>{activeAccount?.name}</strong> up to <strong>{dateText(asOf)}</strong> (including principal and interest) into a single opening balance.</p>
              <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '6px' }}>
                <strong>IMPORTANT:</strong> A statement PDF will be saved first to preserve transaction history. You must select a file path to proceed.
              </p>
              <div className="confirm-actions">
                <button className="secondary-button" onClick={() => setShowBDConfirm(false)}>Cancel</button>
                <button className="primary-button" onClick={() => { setShowBDConfirm(false); void handlePerformBD(); }}>
                  <RefreshCw size={16} /> Save PDF & Consolidate
                </button>
              </div>
            </div>
          </div>
        )}
        {showUndoConfirm && (
          <div className="dialog-backdrop" role="presentation" onMouseDown={() => setShowUndoConfirm(false)}>
            <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="undo-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="confirm-icon" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}><RefreshCw size={21} /></div>
              <h2 id="undo-title">Undo Balance B/D?</h2>
              <p>This will restore all consolidated history entries for <strong>{activeAccount?.name}</strong> and revert the opening balances to their state before the consolidation.</p>
              <div className="confirm-actions">
                <button className="secondary-button" onClick={() => setShowUndoConfirm(false)}>Cancel</button>
                <button className="danger-button" onClick={() => { setShowUndoConfirm(false); void handleUndoBD(); }}>
                  <RefreshCw size={16} /> Undo Balance B/D
                </button>
              </div>
            </div>
          </div>
        )}
        <Toaster richColors position="top-right" />
      </section>
    </main>
    </>
  );
}

function BrandIdentity({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand-identity ${compact ? 'compact' : ''}`}>
      <img src="assets/jj-accounting-mark.svg" alt="" />
      <span>
        <strong>{appName}</strong>
        {!compact && <small>Business accounting ledger</small>}
      </span>
    </span>
  );
}

function WindowTopBar() {
  const [isFullscreen, setIsFullscreen] = useState(true);

  useEffect(() => {
    window.windowControls.getState().then((state) => setIsFullscreen(state.isFullscreen));
    const removeListener = window.windowControls.onFullscreenChange(setIsFullscreen);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        window.windowControls.toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      removeListener();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isFullscreen]);

  const toggleFullscreen = () => {
    if (isFullscreen) {
      window.windowControls.exitFullscreen();
    } else {
      window.windowControls.enterFullscreen();
    }
  };

  return (
    <div className={`window-hover-zone ${isFullscreen ? 'is-fullscreen' : 'is-windowed'}`}>
      <div className="window-top-bar">
        <span className="window-title-brand"><img src="assets/jj-accounting-mark.svg" alt="" />{appName}</span>
        <div className="window-actions">
          <button type="button" title="Minimize" onClick={() => window.windowControls.minimize()}><Minimize2 size={16} /></button>
          <button type="button" title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={toggleFullscreen}>{isFullscreen ? <Shrink size={16} /> : <Maximize2 size={16} />}</button>
          <button type="button" title="Close" className="window-close" onClick={() => window.windowControls.close()}><X size={17} /></button>
        </div>
      </div>
    </div>
  );
}

function selectedAccount(accounts: LoanAccount[], id: number) {
  return accounts.find((account) => account.id === id) ?? null;
}

function Dashboard({
  accounts,
  vouchers,
  openAccounts,
  openTrial,
  openBalance,
  openProfitLoss
}: {
  accounts: LoanAccount[];
  vouchers: Voucher[];
  openAccounts: () => void;
  openTrial: () => void;
  openBalance: () => void;
  openProfitLoss: () => void;
}) {
  return (
    <div className="dashboard">
      <div className="dashboard-cards">
        <button onClick={openAccounts}><Users size={22} /><strong>{accounts.length}</strong><span>All Accounts</span></button>
        <button onClick={openTrial}><BarChart3 size={22} /><strong>Trial</strong><span>Trial Balance</span></button>
        <button onClick={openBalance}><FileText size={22} /><strong>Sheet</strong><span>Balance Sheet</span></button>
        <button onClick={openProfitLoss}><FileText size={22} /><strong>P &amp; L</strong><span>Profit &amp; Loss</span></button>
      </div>
      <LatestJournal vouchers={vouchers} />
    </div>
  );
}

function LatestJournal({ vouchers }: { vouchers: Voucher[] }) {
  const rows = vouchers.flatMap((voucher) => voucher.entries.map((entry, index) => ({ voucher, entry, index })));
  const totalDebit = rows.reduce((sum, row) => sum + Number(row.entry.debit || 0), 0);
  const totalCredit = rows.reduce((sum, row) => sum + Number(row.entry.credit || 0), 0);
  return (
    <section className="journal-panel">
      <div className="journal-heading"><div><span>Books of original entry</span><h2>Journal</h2></div><small>Recent transactions</small></div>
      <div className="journal-table-wrap"><table className="journal-table">
        <thead><tr><th>Date</th><th>Particulars</th><th className="journal-lf">L.F.</th><th className="number-cell">Debit (₹)</th><th className="number-cell">Credit (₹)</th></tr></thead>
        <tbody>
          {rows.length ? rows.map(({ voucher, entry, index }) => (
            <React.Fragment key={`${voucher.id}-${index}`}>
            <tr className={index === 0 ? 'journal-entry-start' : ''}>
              <td>{index === 0 ? dateText(voucher.date) : ''}</td>
              <td className={`journal-particular ${entry.credit ? 'credit-particular' : ''}`}>{entry.credit ? 'To ' : ''}{entry.ledgerName} A/c{entry.debit ? ' Dr.' : ''}{index === 0 && <small>{voucher.voucherNo || voucher.type}</small>}</td>
              <td className="journal-lf">—</td>
              <td className="number-cell">{entry.debit ? amount(entry.debit) : ''}</td>
              <td className="number-cell">{entry.credit ? amount(entry.credit) : ''}</td>
            </tr>
            {index === voucher.entries.length - 1 && voucher.narration ? <tr className="journal-narration-row"><td></td><td colSpan={4}>({voucher.narration})</td></tr> : null}
            </React.Fragment>
          )) : <tr><td className="journal-empty" colSpan={5}>No journal entries have been recorded yet.</td></tr>}
        </tbody>
        {rows.length > 0 && <tfoot><tr><td></td><td>Total</td><td></td><td className="number-cell">{amount(totalDebit)}</td><td className="number-cell">{amount(totalCredit)}</td></tr></tfoot>}
      </table></div>
    </section>
  );
}

type AccountFormSetter = React.Dispatch<React.SetStateAction<LoanAccount>>;

function AccountFormFields({ accountForm, setAccountForm, categories, actionLabel, actionIcon, busy = false, onSave }: { accountForm: LoanAccount; setAccountForm: AccountFormSetter; categories: string[]; actionLabel: string; actionIcon: React.ReactNode; busy?: boolean; onSave: () => void }) {
  return (
    <div className="form-grid dashboard-create">
      <TextInput label="Name" value={accountForm.name} onChange={(value) => setAccountForm((current) => ({ ...current, name: value }))} />
      <CategoryInput label="Category" value={accountForm.category} categories={categories} onChange={(value) => setAccountForm((current) => ({ ...current, category: value || 'Other A/C' }))} />
      <TextInput label="Phone" value={accountForm.phone ?? ''} onChange={(value) => setAccountForm((current) => ({ ...current, phone: value }))} />
      <TextInput label="Address" value={accountForm.address ?? ''} onChange={(value) => setAccountForm((current) => ({ ...current, address: value }))} />
      <NumberInput label="Interest %" value={accountForm.defaultRate} onChange={(value) => setAccountForm((current) => ({ ...current, defaultRate: value }))} />
      <OpeningBalanceFields account={accountForm} setAccount={setAccountForm} />
      <button className="primary-button" onClick={onSave} disabled={busy || !accountForm.name.trim()}>{actionIcon} {busy ? 'Saving...' : actionLabel}</button>
    </div>
  );
}

function OpeningBalanceFields({ account, setAccount }: { account: LoanAccount; setAccount: AccountFormSetter }) {
  return (
    <div className="opening-balance-section">
      <div className="opening-balance-heading"><strong>Opening Balances</strong><span>Enter each book separately</span></div>
      <div className="opening-book-card khacha">
        <div className="opening-book-title"><span>K</span><div><strong>Khacha</strong><small>Opening position</small></div></div>
        <NumberInput label="Opening Balance" value={account.openingKBalance ?? 0} onChange={(value) => setAccount((current) => ({ ...current, openingKBalance: value }))} />
        <Segment label="Balance Side" value={account.openingKType ?? 'Dr'} options={['Dr', 'Cr']} onChange={(value) => setAccount((current) => ({ ...current, openingKType: value as 'Dr' | 'Cr' }))} />
      </div>
      <div className="opening-book-card packa">
        <div className="opening-book-title"><span>P</span><div><strong>Packa</strong><small>Opening position</small></div></div>
        <NumberInput label="Opening Balance" value={account.openingPBalance ?? 0} onChange={(value) => setAccount((current) => ({ ...current, openingPBalance: value }))} />
        <Segment label="Balance Side" value={account.openingPType ?? 'Dr'} options={['Dr', 'Cr']} onChange={(value) => setAccount((current) => ({ ...current, openingPType: value as 'Dr' | 'Cr' }))} />
      </div>
      <div className="opening-date-field"><DateInput label="Opening Balance Date *" value={account.openingDate} onChange={(value) => setAccount((current) => ({ ...current, openingDate: value }))} /></div>
    </div>
  );
}

function AccountsView({ accounts, openAccount }: { accounts: LoanAccount[]; openAccount: (id: number) => void }) {
  return (
    <div className="dashboard">
      <AllAccounts accounts={accounts} openAccount={openAccount} />
    </div>
  );
}

function AllAccounts({ accounts, openAccount, deleteAccount, compact = false }: { accounts: LoanAccount[]; openAccount: (id: number) => void; deleteAccount?: (account: LoanAccount) => void; compact?: boolean }) {
  return (
    <div className="simple-panel">
      <h2>{compact ? 'Recent Accounts' : 'All Accounts'}</h2>
      <table className="plain-table">
        <thead><tr><th>Name</th><th>Category</th><th>Phone</th><th>Opening Date</th><th>Opening</th><th>Interest %</th><th></th></tr></thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id}>
              <td>{account.name}</td>
              <td>{account.category}</td>
              <td>{account.phone}</td>
              <td>{dateText(account.openingDate)}</td>
              <td>{(account.openingKBalance || account.openingPBalance) ? `K: ${account.openingKType} ${amount(account.openingKBalance)} / P: ${account.openingPType} ${amount(account.openingPBalance)}` : '—'}</td>
              <td>{account.defaultRate}</td>
              <td className="number-cell action-cell">{!compact && <button className="small-button icon-action" title="Open account" onClick={() => account.id && openAccount(account.id)}><Eye size={15} /></button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManageAccounts({ accounts, accountForm, categories, setAccountForm, busy, onCreate, openAccount, deleteAccount, togglePin }: { accounts: LoanAccount[]; accountForm: LoanAccount; categories: string[]; setAccountForm: AccountFormSetter; busy: boolean; onCreate: () => void; openAccount: (id: number) => void; deleteAccount: (account: LoanAccount) => void; togglePin: (account: LoanAccount) => void | Promise<void> }) {
  return (
    <div className="dashboard">
      <div className="simple-panel">
        <h2>Create Account</h2>
        <AccountFormFields accountForm={accountForm} setAccountForm={setAccountForm} categories={categories} actionLabel="Create Account" actionIcon={<UserPlus size={16} />} busy={busy} onSave={onCreate} />
      </div>
      <div className="simple-panel">
      <h2>Manage Accounts</h2>
      <table className="plain-table">
        <thead><tr><th>Name</th><th>Category</th><th>Phone</th><th>Interest %</th><th></th></tr></thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id}>
              <td>{account.name}</td>
              <td>{account.category}</td>
              <td>{account.phone}</td>
              <td>{account.defaultRate}</td>
              <td className="number-cell action-cell">
                <button className="small-button icon-action" title={account.pinned ? 'Unpin account' : 'Pin account'} disabled={busy} onClick={() => togglePin(account)}>{account.pinned ? <PinOff size={15} /> : <Pin size={15} />}</button>
                <button className="small-button icon-action" title="Open account" disabled={busy} onClick={() => account.id && openAccount(account.id)}><Eye size={15} /></button>
                <button className="small-button icon-action danger-small" title="Delete account" disabled={busy} onClick={() => deleteAccount(account)}><Trash2 size={15} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function TrialBalance({ rows, book, setBook }: { rows: TrialBalanceRow[]; book: ReportBook; setBook: (book: ReportBook) => void | Promise<void> }) {
  const visibleRows = rows.filter((row) => Math.abs(Number(row.debit || 0) - Number(row.credit || 0)) >= 0.005);
  const totalDebit = visibleRows.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = visibleRows.reduce((sum, row) => sum + row.credit, 0);
  return (
    <div className="simple-panel report-panel">
      <div className="report-heading"><div><h2>Ledger Trial Balance</h2><span>{bookLabel(book)}</span></div><ViewTabs value={book} onChange={setBook} /></div>
      <ReportActions targetId="trial-balance-report" title={`Trial Balance - ${bookLabel(book)}`} />
      <div id="trial-balance-report"><table className="plain-table">
        <thead><tr><th>Account</th><th className="number-cell">Debit</th><th className="number-cell">Credit</th></tr></thead>
        <tbody>{visibleRows.length ? visibleRows.map((row) => <tr key={row.ledgerId}><td>{row.ledgerName}</td><td className="number-cell">{row.debit ? amount(row.debit) : '—'}</td><td className="number-cell">{row.credit ? amount(row.credit) : '—'}</td></tr>) : <tr><td colSpan={3} className="report-empty-state">No outstanding account balances</td></tr>}</tbody>
        <tfoot><tr><td>Total</td><td className="number-cell">{amount(totalDebit)}</td><td className="number-cell">{amount(totalCredit)}</td></tr></tfoot>
      </table></div>
    </div>
  );
}

function BalanceSheet({ rows, book, setBook }: { rows: TrialBalanceRow[]; book: ReportBook; setBook: (book: ReportBook) => void | Promise<void> }) {
  // --- Build category-grouped sides ---
  // Dr balance -> Assets side, Cr balance -> Liabilities side
  // For loan accounts: group by loanAccountCategory
  // For non-loan accounts: use groupName (Assets, Liabilities, Capital)

  interface SectionRow {
    type: 'header' | 'detail' | 'subtotal' | 'total' | 'space';
    label: string;
    amount?: number;
  }

  // Collect categories for each side
  const liabilityCategories = new Map<string, { rows: TrialBalanceRow[] }>();
  const assetCategories = new Map<string, { rows: TrialBalanceRow[] }>();

  const addToSide = (side: Map<string, { rows: TrialBalanceRow[] }>, category: string, row: TrialBalanceRow) => {
    if (!side.has(category)) side.set(category, { rows: [] });
    side.get(category)!.rows.push(row);
  };

  for (const row of rows) {
    const netBalance = row.debit - row.credit;
    if (Math.abs(netBalance) < 0.005) continue;

    if (netBalance > 0) {
      // Debit balance -> Assets
      if (row.isLoanAccount && row.loanAccountCategory) {
        addToSide(assetCategories, row.loanAccountCategory, row);
      } else if (row.groupName === 'Capital') {
        // Capital with Dr balance — rare but place in Assets as 'Capital (Dr)'
        addToSide(assetCategories, 'Capital Account', row);
      } else if (row.groupName === 'Expenses' || row.groupName === 'Income') {
        addToSide(assetCategories, row.groupName, row);
      } else {
        // Non-loan: try to assign a meaningful category
        const lname = row.ledgerName.toLowerCase();
        if (lname.includes('cash') || lname.includes('bank')) {
          addToSide(assetCategories, 'Cash & Bank', row);
        } else if (row.groupName === 'Assets') {
          addToSide(assetCategories, 'Other Assets', row);
        } else {
          addToSide(assetCategories, 'Other Assets', row);
        }
      }
    } else {
      // Credit balance -> Liabilities
      if (row.isLoanAccount && row.loanAccountCategory) {
        addToSide(liabilityCategories, row.loanAccountCategory, row);
      } else if (row.groupName === 'Capital') {
        addToSide(liabilityCategories, 'Capital Account', row);
      } else if (row.groupName === 'Income' || row.groupName === 'Expenses') {
        addToSide(liabilityCategories, row.groupName, row);
      } else {
        const lname = row.ledgerName.toLowerCase();
        if (lname.includes('gst') || lname.includes('tax')) {
          addToSide(liabilityCategories, 'Duties & Taxes', row);
        } else if (row.groupName === 'Liabilities') {
          addToSide(liabilityCategories, 'Other Liabilities', row);
        } else {
          addToSide(liabilityCategories, 'Other Liabilities', row);
        }
      }
    }
  }

  // Build structured section rows
  const buildSide = (categoryMap: Map<string, { rows: TrialBalanceRow[] }>, isAssets: boolean): SectionRow[] => {
    const result: SectionRow[] = [];
    for (const [categoryName, { rows: catRows }] of categoryMap) {
      result.push({ type: 'header', label: categoryName });
      let catTotal = 0;
      for (const row of catRows) {
        const amt = isAssets ? row.debit - row.credit : row.credit - row.debit;
        result.push({ type: 'detail', label: row.ledgerName, amount: amt });
        catTotal += amt;
      }
      result.push({ type: 'total', label: `Total ${categoryName}`, amount: catTotal });
      result.push({ type: 'space', label: '' });
    }
    return result;
  };

  // Sort: Capital Account first on liabilities, Cash & Bank last on assets (most liquid last)
  const sortedLiabilityKeys = Array.from(liabilityCategories.keys()).sort((a, b) => {
    if (a === 'Capital Account') return -1;
    if (b === 'Capital Account') return 1;
    return a.localeCompare(b);
  });
  const sortedAssetKeys = Array.from(assetCategories.keys()).sort((a, b) => {
    if (a === 'Cash & Bank') return 1;
    if (b === 'Cash & Bank') return -1;
    return a.localeCompare(b);
  });

  const sortedLiabilities = new Map(sortedLiabilityKeys.map(k => [k, liabilityCategories.get(k)!]));
  const sortedAssets = new Map(sortedAssetKeys.map(k => [k, assetCategories.get(k)!]));

  const leftSide = buildSide(sortedLiabilities, false);
  const rightSide = buildSide(sortedAssets, true);

  const totalLiabilities = Array.from(sortedLiabilities.values()).reduce((sum, { rows: catRows }) =>
    sum + catRows.reduce((s, r) => s + (r.credit - r.debit), 0), 0);
  const totalAssets = Array.from(sortedAssets.values()).reduce((sum, { rows: catRows }) =>
    sum + catRows.reduce((s, r) => s + (r.debit - r.credit), 0), 0);

  const max = Math.max(leftSide.length, rightSide.length);

  const renderCell = (item: SectionRow | undefined, isLeft: boolean) => {
    const borderClass = isLeft ? ' split-border' : '';
    if (!item) {
      return (
        <>
          <td></td>
          <td></td>
          <td className={isLeft ? 'split-border' : undefined}></td>
        </>
      );
    }
    if (item.type === 'header') {
      return (
        <td className={`category-header${borderClass}`} colSpan={3}>
          <strong>{item.label}</strong>
        </td>
      );
    }
    if (item.type === 'space') {
      return (
        <>
          <td className="space-cell">&nbsp;</td>
          <td className="space-cell"></td>
          <td className={`space-cell${borderClass}`}></td>
        </>
      );
    }
    if (item.type === 'total') {
      return (
        <>
          <td className="category-total"><strong>{item.label}</strong></td>
          <td className="category-total"></td>
          <td className={`number-cell category-total${borderClass}`}><strong>{amount(item.amount)}</strong></td>
        </>
      );
    }
    // Detail row
    return (
      <>
        <td className="ledger-cell">{item.label}</td>
        <td className="number-cell">{amount(item.amount)}</td>
        <td className={isLeft ? 'split-border' : undefined}></td>
      </>
    );
  };

  return (
    <div className="simple-panel report-panel">
      <div className="report-heading"><div><h2>Ledger Balance Sheet</h2><span>{bookLabel(book)}</span></div><ViewTabs value={book} onChange={setBook} /></div>
      <ReportActions targetId="balance-sheet-report" title={`Balance Sheet - ${bookLabel(book)}`} />
      <div id="balance-sheet-report">
        <table className="plain-table balance-table">
          <thead>
            <tr>
              <th style={{ width: '30%' }}>Liability / Capital</th>
              <th className="number-cell" style={{ width: '10%' }}>Amount</th>
              <th className="number-cell split-border" style={{ width: '10%' }}>Total</th>
              <th style={{ width: '30%' }}>Asset</th>
              <th className="number-cell" style={{ width: '10%' }}>Amount</th>
              <th className="number-cell" style={{ width: '10%' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {max ? Array.from({ length: max }).map((_, index) => (
              <tr key={index}>
                {renderCell(leftSide[index], true)}
                {renderCell(rightSide[index], false)}
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="report-empty-state">No outstanding asset or liability balances</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Total Liabilities & Capital</td>
              <td className="number-cell split-border">{amount(totalLiabilities)}</td>
              <td colSpan={2}>Total Assets</td>
              <td className="number-cell">{amount(totalAssets)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function ProfitLoss({ data, book, asOf, onRefresh }: {
  data: ProfitLossData;
  book: ReportBook;
  asOf: string;
  onRefresh: (asOf: string, book: ReportBook) => void;
}) {
  const { incomeRows, expenseRows, interestReceivable, interestPayable } = data;

  // ── Build P&L rows from Income/Expense ledgers only (no interest) ──
  interface PLRow {
    type: 'detail' | 'total';
    label: string;
    amount?: number;
  }

  const leftRows: PLRow[] = [];
  const rightRows: PLRow[] = [];
  let totalExpenses = 0;
  let totalIncome = 0;

  for (const r of expenseRows) {
    const amt = r.debit - r.credit;
    if (Math.abs(amt) < 0.005) continue;
    leftRows.push({ type: 'detail', label: r.ledgerName, amount: amt });
    totalExpenses += amt;
  }

  for (const r of incomeRows) {
    const amt = r.credit - r.debit;
    if (Math.abs(amt) < 0.005) continue;
    rightRows.push({ type: 'detail', label: r.ledgerName, amount: amt });
    totalIncome += amt;
  }

  const netProfit = totalIncome - totalExpenses;
  const grandTotal = Math.max(totalIncome, totalExpenses);

  if (netProfit >= 0.005) {
    leftRows.push({ type: 'total', label: 'Net Profit', amount: netProfit });
  } else if (netProfit <= -0.005) {
    rightRows.push({ type: 'total', label: 'Net Loss', amount: Math.abs(netProfit) });
  }

  const max = Math.max(leftRows.length, rightRows.length);

  // 2-column layout per side: Account Name | Closing Balance
  const renderCell = (item: PLRow | undefined, isLeft: boolean) => {
    const borderClass = isLeft ? ' split-border' : '';
    if (!item) {
      return (<><td></td><td className={isLeft ? 'split-border' : undefined}></td></>);
    }
    if (item.type === 'total') {
      return (
        <>
          <td className="category-total"><strong>{item.label}</strong></td>
          <td className={`number-cell category-total${borderClass}`}><strong>{amount(item.amount)}</strong></td>
        </>
      );
    }
    return (
      <>
        <td className="ledger-cell">{item.label}</td>
        <td className={`number-cell${borderClass}`}>{amount(item.amount)}</td>
      </>
    );
  };

  const hasInterestDetails = interestReceivable.length > 0 || interestPayable.length > 0;

  return (
    <div className="simple-panel report-panel">
      <div className="report-heading">
        <div>
          <h2>Profit &amp; Loss Account</h2>
          <span>{bookLabel(book)}</span>
        </div>
        <ViewTabs value={book} onChange={(b) => onRefresh(asOf, b)} />
      </div>
      <div className="pl-toolbar">
        <label className="pl-date-label">
          <span>Interest Accrued As Of</span>
          <input
            type="date"
            value={asOf}
            onChange={(e) => onRefresh(e.target.value, book)}
            className="pl-date-input"
          />
        </label>
      </div>
      <ReportActions targetId="profit-loss-full-report" title={`Profit and Loss - ${bookLabel(book)}`} />
      <div id="profit-loss-full-report">

        {/* ── Main P&L Table: Income & Expenses ledger accounts only ── */}
        <div id="profit-loss-report">
          <table className="plain-table balance-table">
            <thead>
              <tr>
                <th style={{ width: '35%' }}>Expenses</th>
                <th className="number-cell split-border" style={{ width: '15%' }}>Closing Balance</th>
                <th style={{ width: '35%' }}>Income</th>
                <th className="number-cell" style={{ width: '15%' }}>Closing Balance</th>
              </tr>
            </thead>
            <tbody>
              {max > 0 ? Array.from({ length: max }).map((_, i) => (
                <tr key={i}>
                  {renderCell(leftRows[i], true)}
                  {renderCell(rightRows[i], false)}
                </tr>
              )) : (
                <tr>
                  <td colSpan={4} className="report-empty-state">
                    No income or expense entries found. Assign ledgers to the <strong>Income</strong> or <strong>Expenses</strong> group to see them here.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>Total</strong></td>
                <td className="number-cell split-border"><strong>{amount(grandTotal)}</strong></td>
                <td><strong>Total</strong></td>
                <td className="number-cell"><strong>{amount(grandTotal)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ── Interest Details: two side-by-side panels below P&L ── */}
        {hasInterestDetails && (
          <div className="interest-details-section">
            <div className="interest-details-heading">
              <h3>Interest Details</h3>
              <span className="interest-details-sub">Loan interest accrued as of {dateText(asOf)}</span>
            </div>
            <div className="interest-panels-row">

              {/* Left panel — Interest Payable (Loans Taken) */}
              <div className="interest-panel interest-panel-payable">
                <div className="interest-panel-header">
                  <span>Interest Payable</span>
                  <small>on Loans Taken</small>
                </div>
                {interestPayable.length > 0 ? (
                  <table className="plain-table">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th className="number-cell">K</th>
                        <th className="number-cell">P</th>
                        <th className="number-cell">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {interestPayable.map((r) => (
                        <tr key={r.accountId}>
                          <td className="ledger-cell">
                            {r.accountName}
                            <small className="interest-cat-badge">{r.category}</small>
                          </td>
                          <td className="number-cell">{amount(r.kInterest)}</td>
                          <td className="number-cell">{amount(r.pInterest)}</td>
                          <td className="number-cell interest-total-cell">{amount(r.totalInterest)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td><strong>Total Payable</strong></td>
                        <td className="number-cell"><strong>{amount(interestPayable.reduce((s, r) => s + r.kInterest, 0))}</strong></td>
                        <td className="number-cell"><strong>{amount(interestPayable.reduce((s, r) => s + r.pInterest, 0))}</strong></td>
                        <td className="number-cell interest-total-cell"><strong>{amount(interestPayable.reduce((s, r) => s + r.totalInterest, 0))}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                ) : (
                  <p className="interest-panel-empty">No interest payable entries.</p>
                )}
              </div>

              {/* Right panel — Interest Receivable (Loans Given) */}
              <div className="interest-panel interest-panel-receivable">
                <div className="interest-panel-header">
                  <span>Interest Receivable</span>
                  <small>on Loans Given</small>
                </div>
                {interestReceivable.length > 0 ? (
                  <table className="plain-table">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th className="number-cell">K</th>
                        <th className="number-cell">P</th>
                        <th className="number-cell">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {interestReceivable.map((r) => (
                        <tr key={r.accountId}>
                          <td className="ledger-cell">
                            {r.accountName}
                            <small className="interest-cat-badge">{r.category}</small>
                          </td>
                          <td className="number-cell">{amount(r.kInterest)}</td>
                          <td className="number-cell">{amount(r.pInterest)}</td>
                          <td className="number-cell interest-total-cell">{amount(r.totalInterest)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td><strong>Total Receivable</strong></td>
                        <td className="number-cell"><strong>{amount(interestReceivable.reduce((s, r) => s + r.kInterest, 0))}</strong></td>
                        <td className="number-cell"><strong>{amount(interestReceivable.reduce((s, r) => s + r.pInterest, 0))}</strong></td>
                        <td className="number-cell interest-total-cell"><strong>{amount(interestReceivable.reduce((s, r) => s + r.totalInterest, 0))}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                ) : (
                  <p className="interest-panel-empty">No interest receivable entries.</p>
                )}
              </div>

            </div>
          </div>
        )}

      </div>
    </div>
  );
}


function SettingsView({
  tab,
  setTab,
  company,
  dbPath,
  licenseStatus,
  onCompanySaved,
  onLicenseStatusChange,
  refreshLicenseStatus
}: {
  tab: 'firm' | 'license' | 'backup' | 'cloud' | 'security' | 'records';
  setTab: (tab: 'firm' | 'license' | 'backup' | 'cloud' | 'security' | 'records') => void;
  company: Company | null;
  dbPath: string;
  licenseStatus: LicenseStatus;
  onCompanySaved: (company: Company) => void;
  onLicenseStatusChange: (status: LicenseStatus) => void | Promise<void>;
  refreshLicenseStatus: () => Promise<LicenseStatus>;
}) {
  return (
    <div className="settings-page">
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        <button type="button" className={tab === 'firm' ? 'active' : ''} onClick={() => setTab('firm')}><Building2 size={16} /> Firm Details</button>
        <button type="button" className={tab === 'license' ? 'active' : ''} onClick={() => setTab('license')}><KeyRound size={16} /> License</button>
        <button type="button" className={tab === 'security' ? 'active' : ''} onClick={() => setTab('security')}><ShieldCheck size={16} /> Password</button>
        <button type="button" className={tab === 'backup' ? 'active' : ''} onClick={() => setTab('backup')}><HardDriveDownload size={16} /> Backup & Restore</button>
        <button type="button" className={tab === 'cloud' ? 'active' : ''} onClick={() => setTab('cloud')}><HardDriveUpload size={16} /> Cloud Sync</button>
        <button type="button" className={tab === 'records' ? 'active' : ''} onClick={() => setTab('records')}><FileText size={16} /> Records & Documents</button>
      </div>
      {tab === 'firm' && <FirmDetailsView company={company} onSaved={onCompanySaved} />}
      {tab === 'license' && <LicenseView status={licenseStatus} onStatusChange={onLicenseStatusChange} refreshStatus={refreshLicenseStatus} />}
      {tab === 'security' && <PasswordSecurityView />}
      {tab === 'backup' && <BackupView dbPath={dbPath} />}
      {tab === 'cloud' && <CloudSyncView />}
      {tab === 'records' && <RecordsView />}
    </div>
  );
}

function RecordsView() {
  const [history, setHistory] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const fetchHistory = async () => {
    setBusy(true);
    try {
      const list = await window.accounting.listBalanceBDHistory();
      setHistory(list);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void fetchHistory();
  }, []);

  const openPDF = async (path: string) => {
    try {
      const opened = await window.accounting.openPDFFile(path);
      if (opened) {
        toast.success('Opened PDF statement');
      } else {
        toast.error('File not found or could not be opened.');
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="simple-panel records-panel">
      <div className="settings-section-heading" style={{ marginBottom: '20px' }}>
        <div className="settings-section-icon"><FileText size={22} /></div>
        <div>
          <h2>Records & Documents</h2>
          <p>Browse and open historical statements saved automatically during Balance B/D consolidations.</p>
        </div>
      </div>
      {busy && history.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>Loading records...</div>
      ) : history.length === 0 ? (
        <div className="report-empty-state" style={{ padding: '40px 20px', textAlign: 'center' }}>
          <FileText size={40} style={{ margin: '0 auto 12px', color: 'var(--muted)', display: 'block' }} />
          No consolidated records found. Perform a Balance B/D to archive statements.
        </div>
      ) : (
        <div className="plain-table-wrap">
          <table className="plain-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Consolidation Date</th>
                <th>New Opening Balance</th>
                <th>Saved Path</th>
                <th className="number-cell"></th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.account_name}</strong>
                    <br />
                    <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{row.ledger_name}</span>
                  </td>
                  <td>{dateText(row.date)}</td>
                  <td>
                    <strong>{row.post_opening_type} {amount(row.post_opening_balance)}</strong>
                    <br />
                    <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                      K: {row.post_k_type} {amount(row.post_k_balance)} / P: {row.post_p_type} {amount(row.post_p_balance)}
                    </span>
                  </td>
                  <td style={{ fontSize: '11px', color: 'var(--muted)', wordBreak: 'break-all', maxWidth: '300px' }} title={row.pdf_path}>
                    {row.pdf_path ? row.pdf_path.split(/[\\/]/).pop() : '—'}
                  </td>
                  <td className="number-cell action-cell">
                    {row.pdf_path ? (
                      <button className="small-button icon-action" title="Open Statement PDF" onClick={() => openPDF(row.pdf_path)}>
                        <Eye size={15} />
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FirmDetailsView({ company, onSaved }: { company: Company | null; onSaved: (company: Company) => void }) {
  const [form, setForm] = useState<Company>(company ?? defaultCompany());
  const [busy, setBusy] = useState(false);

  useEffect(() => setForm(company ?? defaultCompany()), [company]);

  const saveFirm = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const saved = await window.accounting.saveCompany(form);
      onSaved(saved);
      toast.success('Firm details updated');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="simple-panel firm-settings" onSubmit={saveFirm}>
      <div className="settings-section-heading">
        <div className="settings-section-icon"><Building2 size={22} /></div>
        <div>
          <h2>Firm Profile</h2>
          <p>This information appears on the password screen and can be used across reports and documents.</p>
        </div>
      </div>
      <div className="form-grid firm-grid">
        <TextInput label="Firm name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
        <TextInput label="Shop no." value={form.shopNo ?? ''} onChange={(value) => setForm({ ...form, shopNo: value })} />
        <TextInput label="Address" value={form.address} onChange={(value) => setForm({ ...form, address: value })} />
        <TextInput label="Phone" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
        <TextInput label="Email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
        <TextInput label="GSTIN" value={form.gstin} onChange={(value) => setForm({ ...form, gstin: value.toUpperCase() })} />
        <TextInput label="Financial year" value={form.financialYear} onChange={(value) => setForm({ ...form, financialYear: value })} />
      </div>
      <button className="primary-button" disabled={busy}><Save size={16} /> {busy ? 'Saving...' : 'Save Firm Details'}</button>
    </form>
  );
}

function PasswordSecurityView() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const canSave = currentPassword.length > 0 && nextPassword.length >= 6 && nextPassword === confirmPassword;

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentPassword) {
      toast.error('Enter your current password.');
      return;
    }
    if (nextPassword.length < 6) {
      toast.error('New password must be at least 6 characters.');
      return;
    }
    if (nextPassword !== confirmPassword) {
      toast.error('New password and confirmation do not match.');
      return;
    }
    setBusy(true);
    try {
      await window.accounting.changePassword(currentPassword, nextPassword);
      setCurrentPassword('');
      setNextPassword('');
      setConfirmPassword('');
      toast.success('Application password changed');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="simple-panel password-settings" onSubmit={changePassword}>
      <div className="settings-section-heading">
        <div className="settings-section-icon"><ShieldCheck size={22} /></div>
        <div>
          <h2>Application Password</h2>
          <p>Change the password used to unlock JJ Accounting on this computer.</p>
        </div>
      </div>
      <div className="form-grid password-grid">
        <label className="field">
          <span>Current password</span>
          <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" />
        </label>
        <label className="field">
          <span>New password</span>
          <input type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} autoComplete="new-password" />
        </label>
        <label className="field">
          <span>Confirm new password</span>
          <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
        </label>
      </div>
      <button className="primary-button" disabled={busy || !canSave}><KeyRound size={16} /> {busy ? 'Changing...' : 'Change Password'}</button>
    </form>
  );
}

function CloudSyncView() {
  const [settings, setSettings] = useState<CloudSyncSettings>({ enabled: false, authToken: '' });
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    window.accounting.getCloudSyncSettings().then(setSettings).catch((error) => toast.error(error.message));
  }, []);

  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      setSettings(await window.accounting.saveCloudSyncSettings(settings));
      toast.success('Cloud sync settings saved');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      await window.accounting.saveCloudSyncSettings(settings);
      const result = await window.accounting.syncDatabaseToCloud();
      setSettings(await window.accounting.getCloudSyncSettings());
      toast.success(result.message);
    } catch (error: any) {
      setSettings(await window.accounting.getCloudSyncSettings().catch(() => settings));
      toast.error(error.message);
    } finally {
      setSyncing(false);
    }
  };

  const canSync = settings.enabled && settings.authToken.trim().length >= 8;

  return (
    <form className="simple-panel cloud-sync-settings" onSubmit={saveSettings}>
      <div className="settings-section-heading">
        <div className="settings-section-icon"><HardDriveUpload size={22} /></div>
        <div>
          <h2>Cloud Sync</h2>
          <p>Automatically upload your accounting data to your website for online viewing. Auto-syncs every 30 minutes when enabled.</p>
        </div>
      </div>
      <div className="form-grid cloud-sync-grid">
        <label className="backup-toggle cloud-sync-toggle">
          <input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))} />
          <span>{settings.enabled ? 'Cloud sync enabled' : 'Cloud sync disabled'}</span>
        </label>
        <label className="field">
          <span>Access key <small style={{ color: 'var(--muted)', fontWeight: 400 }}>(generated on your website dashboard)</small></span>
          <div className="cloud-password-row">
            <input type="text" value={settings.authToken} onChange={(event) => setSettings((current) => ({ ...current, authToken: event.target.value }))} autoComplete="off" placeholder="Paste the key from your website" />
          </div>
        </label>
      </div>
      <div className="cloud-sync-status">
        <div><dt>Last sync</dt><dd>{settings.lastSyncedAt ? dateTimeText(settings.lastSyncedAt) : 'Not synced yet'}</dd></div>
        <div><dt>Status</dt><dd>{settings.lastSyncMessage || 'Ready'}</dd></div>
      </div>
      <div className="license-actions">
        <button className="primary-button" disabled={busy || syncing}><Save size={16} /> {busy ? 'Saving...' : 'Save Settings'}</button>
        <button className="secondary-button" type="button" onClick={syncNow} disabled={busy || syncing || !canSync}><RefreshCw size={16} /> {syncing ? 'Syncing...' : 'Sync Now'}</button>
      </div>
    </form>
  );
}

function LicenseView({ status, onStatusChange, refreshStatus }: { status: LicenseStatus; onStatusChange: (status: LicenseStatus) => void | Promise<void>; refreshStatus: () => Promise<LicenseStatus> }) {
  const [licenseKey, setLicenseKey] = useState(status.licenseKey ?? '');
  const [busy, setBusy] = useState(false);
  const licensed = status.mode === 'licensed';
  const blocked = !status.allowed;

  const activate = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await window.accounting.activateLicense(licenseKey);
      await onStatusChange(result.status);
      toast.success(result.status.message);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const validate = async () => {
    setBusy(true);
    try {
      const next = await window.accounting.validateLicense();
      await onStatusChange(next);
      if (next.allowed) toast.success(next.message);
      else toast.error(next.message);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    try {
      await onStatusChange(await refreshStatus());
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="license-page">
      <section className={`license-hero simple-panel ${blocked ? 'blocked' : ''}`}>
        <div className="license-hero-icon">{blocked ? <AlertTriangle size={28} /> : <ShieldCheck size={28} />}</div>
        <div>
          <span>{licensed ? 'Activated License' : status.mode === 'trial' ? 'Free Trial' : 'Access Locked'}</span>
          <h2>{status.message}</h2>
          <p>{status.mode === 'trial' ? `Trial started ${dateTimeText(status.trialStartedAt)} and ends ${dateTimeText(status.trialEndsAt)}.` : `This device validates against ${status.licenseServerUrl}.`}</p>
        </div>
        <button className="secondary-button" onClick={refresh} disabled={busy}><RefreshCw size={16} /> Refresh</button>
      </section>

      <div className="license-grid">
        <form className="simple-panel license-activation" onSubmit={activate}>
          <div className="license-section-heading">
            <KeyRound size={22} />
            <div><h2>Activate License</h2><p>Enter the license key issued from the JJ Accounting license control website.</p></div>
          </div>
          <label className="field">
            <span>License key</span>
            <input value={licenseKey} onChange={(event) => setLicenseKey(event.target.value.toUpperCase())} placeholder="ACC-XXXX-XXXX-XXXX" />
          </label>
          <div className="license-actions">
            <button className="primary-button" disabled={busy || licenseKey.trim().length < 8}><KeyRound size={16} /> {busy ? 'Please wait...' : 'Activate'}</button>
            <button className="secondary-button" type="button" onClick={validate} disabled={busy || !status.licenseKey}><CheckCircle2 size={16} /> Validate</button>
          </div>
        </form>

        <section className="simple-panel license-details">
          <div className="license-section-heading">
            <ShieldCheck size={22} />
            <div><h2>Current Status</h2><p>Trial access works automatically for 3 days. A valid key unlocks the app after trial expiry.</p></div>
          </div>
          <dl>
            <div><dt>Status</dt><dd>{status.mode.replace('-', ' ')}</dd></div>
            <div><dt>Trial remaining</dt><dd>{status.trialRemainingDays} day{status.trialRemainingDays === 1 ? '' : 's'}</dd></div>
            <div><dt>License remaining</dt><dd>{status.remainingDays !== undefined ? `${status.remainingDays} day${status.remainingDays === 1 ? '' : 's'}` : 'Not activated'}</dd></div>
            <div><dt>Expiry</dt><dd>{status.expiryDate ? dateTimeText(status.expiryDate) : dateTimeText(status.trialEndsAt)}</dd></div>
            <div><dt>Devices</dt><dd>{status.activeDevices && status.maxDevices ? `${status.activeDevices} of ${status.maxDevices}` : 'Not activated'}</dd></div>
            <div><dt>Last checked</dt><dd>{dateTimeText(status.lastCheckedAt)}</dd></div>
          </dl>
        </section>

        <section className="simple-panel license-device">
          <div className="license-section-heading">
            <HardDriveDownload size={22} />
            <div><h2>This Device</h2><p>Use these details when support needs to reset or confirm an activation.</p></div>
          </div>
          <dl>
            <div><dt>Device name</dt><dd>{status.deviceName}</dd></div>
            <div><dt>Operating system</dt><dd>{status.operatingSystem}</dd></div>
            <div><dt>Device ID</dt><dd>{status.deviceId}</dd></div>
            <div><dt>Machine GUID</dt><dd>{status.machineGuid ?? 'Not available'}</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}

function BackupView({ dbPath }: { dbPath: string }) {
  const [autoBackup, setAutoBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState('');

  useEffect(() => {
    window.accounting.getAutoBackup().then(setAutoBackup).catch((error) => toast.error(error.message));
  }, []);

  const exportBackup = async () => {
    setBusy(true);
    try {
      const result = await window.accounting.exportBackup();
      if (result.ok) toast.success(`Backup saved to ${result.path}`);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = async () => {
    if (!confirm('Restore a backup? Your current data will be replaced. A safety copy will be created automatically.')) return;
    setBusy(true);
    try {
      const result = await window.accounting.restoreBackup();
      if (result.ok) {
        alert('Backup restored successfully. The application will now reload. Sign in using the password from that backup.');
        window.location.reload();
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const changeAutoBackup = async (enabled: boolean) => {
    try {
      setAutoBackup(await window.accounting.setAutoBackup(enabled));
      toast.success(enabled ? 'Automatic daily backup enabled' : 'Automatic backup disabled');
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const openResetDialog = () => {
    setResetConfirmation('');
    setResetDialogOpen(true);
  };

  const closeResetDialog = () => {
    if (busy) return;
    setResetDialogOpen(false);
    setResetConfirmation('');
  };

  const resetApp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (resetConfirmation !== 'RESET') {
      toast.error('Type RESET exactly to confirm the reset.');
      return;
    }
    setBusy(true);
    try {
      const ok = await window.accounting.resetDatabase();
      if (ok) {
        alert('JJ Accounting has been reset. The application will now reload to the first setup screen.');
        window.location.reload();
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <div className="backup-grid">
      <section className="simple-panel backup-card">
        <HardDriveDownload size={30} />
        <div><h2>Create a backup</h2><p>Save one complete copy of all accounts, entries, settings, and your login. Keep it on a USB drive, cloud drive, or another laptop.</p></div>
        <button className="primary-button" onClick={exportBackup} disabled={busy}><Download size={16} /> {busy ? 'Please wait…' : 'Save Backup File'}</button>
      </section>
      <section className="simple-panel backup-card">
        <HardDriveUpload size={30} />
        <div><h2>Continue from a backup</h2><p>After installing JJ Accounting on another laptop, select your saved backup file here. It replaces the data currently on this device.</p></div>
        <button className="secondary-button" onClick={restoreBackup} disabled={busy}><HardDriveUpload size={16} /> Restore Backup File</button>
      </section>
      <section className="simple-panel backup-wide">
        <div><h2>Automatic daily safety copy</h2><p>A copy is made after changes, at most once per day. These copies remain on this laptop, so still create a manual backup before reinstalling Windows or changing laptops.</p></div>
        <label className="backup-toggle"><input type="checkbox" checked={autoBackup} onChange={(event) => changeAutoBackup(event.target.checked)} /> <span>{autoBackup ? 'On' : 'Off'}</span></label>
      </section>
      <section className="simple-panel backup-wide destructive-section">
        <div><h2>Reset Application</h2><p>Delete all accounts, ledgers, transactions, settings, and passwords. This restores the database to a completely clean, new installation state.</p></div>
        <button className="danger-button" onClick={openResetDialog} disabled={busy}><Trash2 size={16} /> Reset Application</button>
      </section>
      <p className="data-location">Current data location: <span>{dbPath}</span></p>
    </div>

    {resetDialogOpen && (
      <div className="dialog-backdrop" role="presentation" onMouseDown={closeResetDialog}>
        <form className="confirm-dialog reset-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={resetApp}>
          <div className="confirm-icon"><AlertTriangle size={21} /></div>
          <h2 id="reset-title">Reset JJ Accounting?</h2>
          <p>This permanently deletes all accounts, transactions, firm details, settings, and login passwords on this device. The next launch will show the first-time setup screen.</p>
          <div className="reset-impact-list" aria-label="Reset impact">
            <span>Accounts</span>
            <span>Transactions</span>
            <span>Firm profile</span>
            <span>Password</span>
          </div>
          <label className="field reset-confirm-field">
            <span>Type RESET to confirm</span>
            <input autoFocus value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} placeholder="RESET" autoComplete="off" />
          </label>
          <div className="confirm-actions">
            <button className="secondary-button" type="button" onClick={closeResetDialog} disabled={busy}>Cancel</button>
            <button className="danger-button" disabled={busy || resetConfirmation !== 'RESET'}><Trash2 size={16} /> {busy ? 'Resetting...' : 'Reset Application'}</button>
          </div>
        </form>
      </div>
    )}
    </>
  );
}

function AccountSheet({ account, rows, zoom, showDetails, book, asOf, editMode, onEditTransaction, onDeleteTransaction }: { account: LoanAccount | null; rows: LoanStatementRow[]; zoom: number; showDetails: boolean; book: ReportBook; asOf: string; editMode: boolean; onEditTransaction: (transaction: LoanStatementRow) => void; onDeleteTransaction: (transaction: LoanStatementRow) => void }) {
  const bookTotal = (book: LoanBook) => {
    const bookRows = rows.filter((row) => row.book === book);
    const opening = book === 'K' ? Number(account?.openingKBalance || 0) : Number(account?.openingPBalance || 0);
    const openingType = book === 'K' ? account?.openingKType : account?.openingPType;
    const debit = bookRows.filter((row) => row.side === 'Dr').reduce((sum, row) => sum + Number(row.amount || 0), openingType !== 'Cr' ? opening : 0);
    const credit = bookRows.filter((row) => row.side === 'Cr').reduce((sum, row) => sum + Number(row.amount || 0), openingType === 'Cr' ? opening : 0);
    const openingDays = daysBetweenDates(account?.openingDate, asOf);
    const openingInterest = opening * Number(account?.defaultRate || 0) / 100 / 30 * openingDays * (openingType === 'Cr' ? -1 : 1);
    const interest = openingInterest + bookRows.reduce((sum, row) => sum + Number(row.interest || 0), 0);
    return { debit, credit, balance: debit - credit, interest, openingInterest };
  };
  const k = bookTotal('K');
  const p = bookTotal('P');
  const totals = {
    debit: k.debit + p.debit,
    credit: k.credit + p.credit,
    balance: k.balance + p.balance,
    interest: k.interest + p.interest
  };
  const displayed = book === 'K' ? k : book === 'P' ? p : totals;

  return (
    <div className="worksheet" id="account-report" style={{ zoom }}>
      <div className="worksheet-head">
        <div>
          <h2>{account?.name || 'Select Account'}</h2>
          <span>{account?.category || 'Account worksheet'}</span>
        </div>
        <div className={`balance-pill ${displayed.balance >= 0 ? 'debit' : 'credit'}`}>
          <span>{bookLabel(book)} Balance</span>
          <strong>{displayed.balance >= 0 ? 'Dr.' : 'Cr.'} {amount(Math.abs(displayed.balance))}</strong>
        </div>
      </div>

      <div className="worksheet-summary">
        {book === 'K' && <SummaryTile title="Khacha" debit={k.debit} credit={k.credit} balance={k.balance} interest={k.interest} />}
        {book === 'P' && <SummaryTile title="Packa" debit={p.debit} credit={p.credit} balance={p.balance} interest={p.interest} />}
        {book === 'Combined' && <SummaryTile title="Combined" debit={totals.debit} credit={totals.credit} balance={totals.balance} interest={totals.interest} />}
      </div>

      <div className="book-ledger-stack">
        {book === 'K' && <BookLedger title="Khacha" book="K" rows={rows} totals={k} showDetails={showDetails} openingBalance={account?.openingKBalance ?? 0} openingType={account?.openingKType ?? 'Dr'} openingDate={account?.openingDate ?? ''} openingInterest={k.openingInterest} editMode={editMode} onEditTransaction={onEditTransaction} onDeleteTransaction={onDeleteTransaction} />}
        {book === 'P' && <BookLedger title="Packa" book="P" rows={rows} totals={p} showDetails={showDetails} openingBalance={account?.openingPBalance ?? 0} openingType={account?.openingPType ?? 'Dr'} openingDate={account?.openingDate ?? ''} openingInterest={p.openingInterest} editMode={editMode} onEditTransaction={onEditTransaction} onDeleteTransaction={onDeleteTransaction} />}
        {book === 'Combined' && <BookLedger title="Account Ledger" book="Combined" rows={rows} totals={totals} showDetails={showDetails} openingBalance={Math.abs((account?.openingKBalance ?? 0) * (account?.openingKType === 'Cr' ? -1 : 1) + (account?.openingPBalance ?? 0) * (account?.openingPType === 'Cr' ? -1 : 1))} openingType={((account?.openingKBalance ?? 0) * (account?.openingKType === 'Cr' ? -1 : 1) + (account?.openingPBalance ?? 0) * (account?.openingPType === 'Cr' ? -1 : 1)) < 0 ? 'Cr' : 'Dr'} openingDate={account?.openingDate ?? ''} openingInterest={k.openingInterest + p.openingInterest} editMode={editMode} onEditTransaction={onEditTransaction} onDeleteTransaction={onDeleteTransaction} />}
      </div>
    </div>
  );
}

function BookLedger({ title, book, rows, totals, showDetails, openingBalance, openingType, openingDate, openingInterest, editMode, onEditTransaction, onDeleteTransaction }: { title: string; book: ReportBook; rows: LoanStatementRow[]; totals: { debit: number; credit: number; balance: number; interest: number }; showDetails: boolean; openingBalance: number; openingType: 'Dr' | 'Cr'; openingDate: string; openingInterest: number; editMode: boolean; onEditTransaction: (transaction: LoanStatementRow) => void; onDeleteTransaction: (transaction: LoanStatementRow) => void }) {
  const bookRows = book === 'Combined' ? rows : rows.filter((row) => row.book === book);
  const debitRows = bookRows.filter((row) => row.side === 'Dr').sort((a, b) => `${a.date}-${a.id ?? 0}`.localeCompare(`${b.date}-${b.id ?? 0}`));
  const creditRows = bookRows.filter((row) => row.side === 'Cr').sort((a, b) => `${a.date}-${a.id ?? 0}`.localeCompare(`${b.date}-${b.id ?? 0}`));
  const debitEntries = [...(openingBalance > 0 && openingType === 'Dr' ? [{ opening: true as const }] : []), ...debitRows.map((row) => ({ row }))];
  const creditEntries = [...(openingBalance > 0 && openingType === 'Cr' ? [{ opening: true as const }] : []), ...creditRows.map((row) => ({ row }))];
  const maxRows = Math.max(debitEntries.length, creditEntries.length, 5);
  const rowDetail = (row?: LoanStatementRow) => showDetails && row ? `${row.days ? `${row.days} days` : ''}${row.narration ? `${row.days ? ' / ' : ''}${row.narration}` : ''}` : '';
  const particulars = (row?: LoanStatementRow) => showDetails && row ? row.counterLedgerName || '' : '';

  return (
    <section className="book-ledger">
      <div className="book-ledger-title">
        <h3>{title}</h3>
        <span>{totals.balance >= 0 ? 'Dr.' : 'Cr.'} {amount(Math.abs(totals.balance))}</span>
      </div>
      <div className="old-ledger-wrap">
        <table className="old-ledger-table">
          <thead>
            <tr>
              <th colSpan={4} className="ledger-side-title debit-title">Debit Side (Dr.)</th>
              <th colSpan={4} className="ledger-side-title credit-title">Credit Side (Cr.)</th>
            </tr>
            <tr>
              <th>Date</th><th>Particulars</th><th className="number-cell">Amount</th><th className="number-cell">Interest</th>
              <th>Date</th><th>Particulars</th><th className="number-cell">Amount</th><th className="number-cell">Interest</th>
            </tr>
          </thead>
          <tbody>
            {(bookRows.length || openingBalance > 0) ? Array.from({ length: maxRows }).map((_, index) => {
              const debitEntry = debitEntries[index];
              const creditEntry = creditEntries[index];
              const debit = debitEntry && 'row' in debitEntry ? debitEntry.row : undefined;
              const credit = creditEntry && 'row' in creditEntry ? creditEntry.row : undefined;
              const debitOpening = Boolean(debitEntry && 'opening' in debitEntry);
              const creditOpening = Boolean(creditEntry && 'opening' in creditEntry);
              return (
                <tr key={index}>
                  <td>{debitOpening ? dateText(openingDate) : dateText(debit?.date)}</td>
                  <td>
                    {debitOpening ? <strong>Opening Balance</strong> : particulars(debit)}
                    {rowDetail(debit) && <span className="worksheet-detail">{rowDetail(debit)}</span>}
                    {debit && editMode && <span className="transaction-actions"><button title="Edit transaction" onClick={() => onEditTransaction(debit)}><Pencil size={13} /></button><button className="delete" title="Delete transaction" onClick={() => onDeleteTransaction(debit)}><Trash2 size={13} /></button></span>}
                  </td>
                  <td className="number-cell">{debitOpening ? amount(openingBalance) : debit ? amount(debit.amount) : ''}</td>
                  <td className="number-cell">{debitOpening ? amount(Math.abs(openingInterest)) : debit ? amount(debit.interest) : ''}</td>
                  <td>{creditOpening ? dateText(openingDate) : dateText(credit?.date)}</td>
                  <td>
                    {creditOpening ? <strong>Opening Balance</strong> : particulars(credit)}
                    {rowDetail(credit) && <span className="worksheet-detail">{rowDetail(credit)}</span>}
                    {credit && editMode && <span className="transaction-actions"><button title="Edit transaction" onClick={() => onEditTransaction(credit)}><Pencil size={13} /></button><button className="delete" title="Delete transaction" onClick={() => onDeleteTransaction(credit)}><Trash2 size={13} /></button></span>}
                  </td>
                  <td className="number-cell">{creditOpening ? amount(openingBalance) : credit ? amount(credit.amount) : ''}</td>
                  <td className="number-cell">{creditOpening ? amount(Math.abs(openingInterest)) : credit ? amount(Math.abs(credit.interest || 0)) : ''}</td>
                </tr>
              );
            }) : <tr><td colSpan={8} className="empty-row">No {title} transactions yet</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Debit Total</td>
              <td className="number-cell">{amount(totals.debit)}</td>
              <td className="number-cell">{amount(Math.max(totals.interest, 0))}</td>
              <td colSpan={2}>Credit Total</td>
              <td className="number-cell">{amount(totals.credit)}</td>
              <td className="number-cell">{amount(Math.abs(Math.min(totals.interest, 0)))}</td>
            </tr>
            <tr>
              <td colSpan={6} className="balance-title">{title} Closing Balance</td>
              <td colSpan={2} className="number-cell">{totals.balance >= 0 ? 'Dr. ' : 'Cr. '}{amount(Math.abs(totals.balance))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function SummaryTile({ title, debit, credit, balance, interest }: { title: string; debit: number; credit: number; balance: number; interest: number }) {
  return (
    <div className="summary-tile">
      <div>
        <span>{title}</span>
        <strong>{balance >= 0 ? 'Dr.' : 'Cr.'} {amount(Math.abs(balance))}</strong>
      </div>
      <dl>
        <div><dt>Debit</dt><dd>{amount(debit)}</dd></div>
        <div><dt>Credit</dt><dd>{amount(credit)}</dd></div>
        <div><dt>Interest</dt><dd>{amount(interest)}</dd></div>
      </dl>
    </div>
  );
}

function ViewTabs({ value, onChange }: { value: ReportBook; onChange: (value: ReportBook) => void | Promise<void> }) {
  return (
    <div className="view-tabs" role="group" aria-label="Account book view">
      {(['K', 'P', 'Combined'] as ReportBook[]).map((option) => (
        <button key={option} type="button" className={value === option ? 'active' : ''} onClick={() => onChange(option)}>
          {bookLabel(option)}
        </button>
      ))}
    </div>
  );
}

function ReportActions({ targetId, title }: { targetId: string; title: string }) {
  const getTarget = () => document.getElementById(targetId);
  const exportExcel = () => {
    const target = getTarget();
    if (!target) return toast.error('Report is not ready yet.');
    const workbook = `<!doctype html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse}th,td{border:1px solid #999;padding:6px 10px}th{background:#eef2f7}</style></head><body><h2>${title}</h2>${target.innerHTML}</body></html>`;
    const url = URL.createObjectURL(new Blob([workbook], { type: 'application/vnd.ms-excel' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeFileName(title)}.xls`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Excel file exported');
  };
  const exportPdf = () => {
    const target = getTarget();
    const tables = Array.from(target?.querySelectorAll('table') ?? []);
    if (!tables.length) return toast.error('There is no report table to export.');
    const doc = new jsPDF({ orientation: tables.length > 1 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    doc.setFontSize(16);
    doc.text(title, 40, 38);
    let startY = 56;
    tables.forEach((table, index) => {
      if (index > 0) {
        const previousY = (doc as any).lastAutoTable?.finalY ?? startY;
        startY = previousY + 28;
        if (startY > doc.internal.pageSize.getHeight() - 100) { doc.addPage(); startY = 40; }
      }
      autoTable(doc, { html: table, startY, theme: 'grid', styles: { fontSize: 8, cellPadding: 4 }, headStyles: { fillColor: [37, 99, 235] } });
    });
    doc.save(`${safeFileName(title)}.pdf`);
    toast.success('PDF exported');
  };
  const printReport = () => {
    const target = getTarget();
    if (!target) return toast.error('Report is not ready yet.');
    const popup = window.open('', '_blank', 'width=1100,height=800');
    if (!popup) return toast.error('Allow the print window to open.');
    const ledgerPrint = targetId === 'account-report';
    const content = target.cloneNode(true) as HTMLElement;
    if (ledgerPrint) content.querySelectorAll('.worksheet-summary, .balance-pill').forEach((element) => element.remove());
    popup.document.write(`<!doctype html><html><head><title>${title}</title><style>
      *{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0;padding:10mm}h1{font-size:18px;text-align:center;margin:0 0 4mm}.worksheet{display:block}.worksheet-head{display:flex;justify-content:space-between;border-bottom:2px solid #111;margin-bottom:5mm;padding-bottom:3mm}.worksheet-head h2{margin:0;font-size:20px}.worksheet-head span{font-size:11px}.book-ledger{break-inside:avoid;margin-bottom:7mm}.book-ledger-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:2mm}.book-ledger-title h3{margin:0;font-size:15px}.book-ledger-title span{font-weight:bold}table{width:100%;border-collapse:collapse;margin-bottom:4mm;table-layout:fixed}th,td{border:1px solid #555;padding:4px 5px;text-align:left;font-size:10px;height:7mm}.ledger-side-title{text-align:center;font-size:12px;background:#eee}.number-cell{text-align:right}.worksheet-detail{display:block;font-size:8px;color:#555}tfoot td{font-weight:bold;background:#f3f3f3}button{display:none}@page{size:${ledgerPrint ? 'A4 landscape' : 'A4 portrait'};margin:8mm}
    </style></head><body><h1>${title}</h1>${content.outerHTML}</body></html>`);
    popup.document.close();
    popup.focus();
    setTimeout(() => { popup.print(); popup.close(); }, 250);
  };
  const closeMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
  };
  return (
    <div className="report-actions">
      <details className="export-menu">
        <summary><Download size={16} /> Export <ChevronDown size={15} /></summary>
        <div className="export-menu-popover">
          <button type="button" onClick={(event) => { exportPdf(); closeMenu(event); }}><FileText size={17} /><span><strong>Export PDF</strong><small>Portable report document</small></span></button>
          <button type="button" onClick={(event) => { exportExcel(); closeMenu(event); }}><FileSpreadsheet size={17} /><span><strong>Export Excel</strong><small>Spreadsheet for editing</small></span></button>
          <button type="button" onClick={(event) => { printReport(); closeMenu(event); }}><Printer size={17} /><span><strong>Print ledger</strong><small>Printer-ready format</small></span></button>
        </div>
      </details>
    </div>
  );
}

function Splash() {
  return (
    <div className="login-screen branded-start">
      <div className="splash-card">
        <BrandIdentity />
        <div className="startup-loader" aria-label="Opening JJ Accounting"><span></span><span></span><span></span></div>
      </div>
    </div>
  );
}

function Login({ password, setPassword, onSubmit, firstRun, company }: { password: string; setPassword: (value: string) => void; onSubmit: (event: React.FormEvent) => void; firstRun: boolean; company: Company | null }) {
  const hasFirm = Boolean(company?.name || company?.shopNo || company?.address || company?.phone || company?.email || company?.gstin);
  return (
    <form className="login-screen branded-start" onSubmit={onSubmit}>
      <div className="login-layout">
        <section className="firm-welcome-panel">
          <BrandIdentity />
          <div>
            <span className="login-eyebrow">Secure business workspace</span>
            <h1>{company?.name || appName}</h1>
            <p>{hasFirm ? 'Your firm profile is ready for daily account work.' : 'Enter once, then update firm details from Settings.'}</p>
          </div>
          <dl className="firm-detail-list">
            <div><dt>Shop No.</dt><dd>{company?.shopNo || 'Not set'}</dd></div>
            <div><dt>Address</dt><dd>{company?.address || 'Not set'}</dd></div>
            <div><dt>Phone</dt><dd>{company?.phone || 'Not set'}</dd></div>
            <div><dt>GSTIN</dt><dd>{company?.gstin || 'Not set'}</dd></div>
          </dl>
        </section>
        <div className="login-box">
          <img className="login-logo" src="assets/jj-accounting-mark.svg" alt="" />
          <h2>{firstRun ? 'Create Admin Password' : 'Enter Password'}</h2>
          <p>{firstRun ? 'Set a password to protect your accounting data.' : 'Unlock your local accounting workspace.'}</p>
          <label className="field">
            <span>Password</span>
            <input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button className="primary-button">{firstRun ? 'Create & Open' : 'Open JJ Accounting'}</button>
        </div>
      </div>
      <Toaster richColors position="top-right" />
    </form>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="field"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function CategoryInput({ label, value, categories, onChange }: { label: string; value: string; categories: string[]; onChange: (value: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const options = Array.from(new Set([...categories, value].filter(Boolean))).sort();
  const commitDraft = () => {
    const next = draft.trim();
    if (next) onChange(next);
    setAdding(false);
  };

  if (adding) {
    return (
      <label className="field">
        <span>{label}</span>
        <div className="category-new">
          <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commitDraft} />
          <button type="button" className="small-button icon-action" title="Use category" onMouseDown={(event) => event.preventDefault()} onClick={commitDraft}><Save size={15} /></button>
        </div>
      </label>
    );
  }

  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => {
        if (event.target.value === '__new__') {
          setDraft('');
          setAdding(true);
        } else {
          onChange(event.target.value);
        }
      }}>
        {options.map((category) => <option key={category} value={category}>{category}</option>)}
        <option value="__new__">+ Add new category</option>
      </select>
    </label>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="field"><span>{label}</span><input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void | Promise<void> }) {
  return <label className="field"><span>{label}</span><input type="date" value={value} onChange={(event) => void onChange(event.target.value)} /></label>;
}

type AccountSelectOption = { value: string; label: string; accountId?: number; pinned?: boolean };

function SearchSelectInput({ label, value, onChange, onTogglePin, options }: { label: string; value: string; onChange: (value: string) => void; onTogglePin?: (accountId: number) => void; options: AccountSelectOption[] }) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? '';
  const [query, setQuery] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const filtered = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 12);

  useEffect(() => setQuery(selectedLabel), [selectedLabel]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const choose = (option: AccountSelectOption) => {
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
  };

  return (
    <label className="field account-combobox-field"><span>{label}</span>
      <div className="account-combobox" ref={controlRef}>
      <Search className="combobox-search" size={16} />
      <input
        type="search"
        value={query}
        placeholder="Search and select account"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && filtered[0]) { event.preventDefault(); choose(filtered[0]); }
          if (event.key === 'Escape') { setQuery(selectedLabel); setOpen(false); }
        }}
      />
      <ChevronDown className={`combobox-chevron ${open ? 'open' : ''}`} size={16} />
      {open && <div className="account-options" role="listbox">
        {filtered.length ? filtered.map((option) => <div role="option" aria-selected={option.value === value} className={`account-option ${option.value === value ? 'selected' : ''}`} key={option.value}>
          <button className="account-option-main" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}><span>{option.label.slice(0, 1).toUpperCase()}</span><strong>{option.label}</strong>{option.value === value && <small>Selected</small>}</button>
          {option.accountId && <button className={`account-option-pin ${option.pinned ? 'pinned' : ''}`} type="button" title={option.pinned ? 'Unpin account' : 'Pin account'} onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.stopPropagation(); onTogglePin?.(option.accountId!); }}>{option.pinned ? <Pin size={15} /> : <PinOff size={15} />}</button>}
        </div>) : <div className="account-options-empty">No matching account</div>}
      </div>}
      </div>
    </label>
  );
}

function SelectInput({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="" disabled>Select account</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function Segment({ label, value, options, labels = {}, onChange }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return (
    <label className="field"><span>{label}</span><div className="segment">
      {options.map((option) => <button key={option} type="button" className={value === option ? 'active' : ''} onClick={() => onChange(option)}>{labels[option] ?? option}</button>)}
    </div></label>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
