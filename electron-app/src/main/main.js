const { app, BrowserWindow, ipcMain, Tray, Menu, desktopCapturer } = require('electron');
const path = require('path');
const DatabaseManager = require('./database');
const ScreenRecorder = require('./recorder');
const AnalysisManager = require('./analysis');
const LLMService = require('./llm-service');

class DayflowApp {
  constructor() {
    this.mainWindow = null;
    this.tray = null;
    this.db = null;
    this.recorder = null;
    this.analysisManager = null;
    this.llmService = null;
  }

  async initialize() {
    // Initialize database
    const dbPath = path.join(app.getPath('userData'), 'dayflow.db');
    this.db = new DatabaseManager(dbPath);
    this.db.initialize();

    // Initialize services
    this.llmService = new LLMService(this.db);
    this.recorder = new ScreenRecorder(this.db);
    this.analysisManager = new AnalysisManager(this.db, this.llmService);

    // Set up IPC handlers
    this.setupIPC();

    // Create window
    this.createWindow();

    // Create tray
    this.createTray();

    // Start analysis manager
    this.analysisManager.start();
  }

  createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
      title: 'Dayflow',
      show: false
    });

    // Load the index.html
    this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    // Show window when ready
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
    });

    // Handle window close
    this.mainWindow.on('close', (event) => {
      if (!app.isQuitting) {
        event.preventDefault();
        this.mainWindow.hide();
      }
    });
  }

  createTray() {
    // Create tray icon (you'll need to add icon files)
    this.tray = new Tray(path.join(__dirname, '../../assets/tray-icon.png'));

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Dayflow',
        click: () => {
          this.mainWindow.show();
        }
      },
      {
        label: 'Start Recording',
        click: async () => {
          await this.recorder.startRecording();
        }
      },
      {
        label: 'Stop Recording',
        click: () => {
          this.recorder.stopRecording();
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    this.tray.setContextMenu(contextMenu);
    this.tray.setToolTip('Dayflow');

    this.tray.on('click', () => {
      this.mainWindow.show();
    });
  }

  setupIPC() {
    // Recording controls
    ipcMain.handle('start-recording', async () => {
      try {
        await this.recorder.startRecording();
        return { success: true };
      } catch (error) {
        console.error('Failed to start recording:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('stop-recording', () => {
      try {
        this.recorder.stopRecording();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('get-recording-state', () => {
      return this.recorder.isRecording;
    });

    // Timeline data
    ipcMain.handle('get-timeline', (event, date) => {
      try {
        const cards = this.db.getTimelineCards(date);
        return { success: true, cards };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('get-date-range', () => {
      try {
        const range = this.db.getDateRange();
        return { success: true, range };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Categories
    ipcMain.handle('get-categories', () => {
      try {
        const categories = this.db.getCategories();
        return { success: true, categories };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('save-category', (event, category) => {
      try {
        this.db.saveCategory(category);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Settings
    ipcMain.handle('get-settings', () => {
      try {
        const settings = this.db.getSettings();
        return { success: true, settings };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('save-settings', (event, settings) => {
      try {
        this.db.saveSettings(settings);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Get desktop sources for screen capture
    ipcMain.handle('get-sources', async () => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 150, height: 150 }
        });
        return sources;
      } catch (error) {
        console.error('Failed to get sources:', error);
        return [];
      }
    });

    // Video playback
    ipcMain.handle('get-video-path', (event, cardId) => {
      try {
        const videoPath = this.db.getVideoPath(cardId);
        return { success: true, path: videoPath };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }

  cleanup() {
    if (this.recorder) {
      this.recorder.stopRecording();
    }
    if (this.analysisManager) {
      this.analysisManager.stop();
    }
    if (this.db) {
      this.db.close();
    }
  }
}

// App lifecycle
let dayflowApp;

app.whenReady().then(async () => {
  dayflowApp = new DayflowApp();
  await dayflowApp.initialize();

  // Set login item
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true
  });
});

app.on('window-all-closed', () => {
  // Keep app running on macOS even when windows closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    dayflowApp.createWindow();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (dayflowApp) {
    dayflowApp.cleanup();
  }
});

// Handle deep links (dayflow://)
app.setAsDefaultProtocolClient('dayflow');

app.on('open-url', (event, url) => {
  event.preventDefault();

  if (url.startsWith('dayflow://start-recording')) {
    dayflowApp.recorder.startRecording();
  } else if (url.startsWith('dayflow://stop-recording')) {
    dayflowApp.recorder.stopRecording();
  }
});
