import { ipcMain, shell } from 'electron';

export class IpcManager {
  constructor(readonly mainWindow: Electron.BrowserWindow) {
    this.setupFileDrop();
    this.setupProcessingStatus();
  }

  setupProcessingStatus() {
    ipcMain.on('processing-status', (_event, status: any) => {
      this.mainWindow.webContents.send('processing-status', status);
    });
  }

  setupFileDrop() {
    this.mainWindow.webContents.on('will-navigate', (e, url) => {
      e.preventDefault();

      if (!url.startsWith('file:///')) {
        shell.openExternal((e as any).target.href);
      }

      url = url.replace('file:///', '/');
      this.mainWindow.webContents.send('file-dropped', decodeURIComponent(url));
    });
  }
}