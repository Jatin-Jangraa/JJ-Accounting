import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { ipcChannels } from '../shared/ipc.js';
import { AccountingService } from './services/accounting-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let service: AccountingService;
type WindowControlAction = 'close' | 'minimize' | 'enter-fullscreen' | 'exit-fullscreen' | 'toggle-fullscreen' | 'focus';

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 560,
    minHeight: 600,
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    title: 'JJ Accounting',
    icon: path.join(__dirname, app.isPackaged ? '../../dist/assets/jj-accounting-icon.png' : '../../public/assets/jj-accounting-icon.png'),
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send(ipcChannels.fullscreenChanged, true);
  });

  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send(ipcChannels.fullscreenChanged, false);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
};

app.whenReady().then(async () => {
  try {
    service = new AccountingService(app);
    ipcMain.handle(ipcChannels.invoke, async (_event, method: string, args: unknown[]) => {
      const target = (service as unknown as Record<string, (...args: unknown[]) => unknown>)[method];
      if (typeof target !== 'function') {
        throw new Error(`Unknown method: ${String(method)}`);
      }
      return target.apply(service, args);
    });
    ipcMain.on(ipcChannels.windowControl, (event, action: WindowControlAction) => {
      const sourceWindow = BrowserWindow.fromWebContents(event.sender);
      if (!sourceWindow) return;
      if (action === 'close') sourceWindow.close();
      if (action === 'minimize') sourceWindow.minimize();
      if (action === 'enter-fullscreen') sourceWindow.setFullScreen(true);
      if (action === 'exit-fullscreen') sourceWindow.setFullScreen(false);
      if (action === 'toggle-fullscreen') sourceWindow.setFullScreen(!sourceWindow.isFullScreen());
      if (action === 'focus') {
        if (sourceWindow.isMinimized()) sourceWindow.restore();
        sourceWindow.show();
        sourceWindow.focus();
        sourceWindow.webContents.focus();
      }
    });
    ipcMain.handle(ipcChannels.windowState, (event) => {
      const sourceWindow = BrowserWindow.fromWebContents(event.sender);
      return {
        isFullscreen: sourceWindow?.isFullScreen() ?? false
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await import('electron').then(({ dialog }) => {
      dialog.showErrorBox('JJ Accounting could not start', message);
    });
    app.quit();
    return;
  }

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
