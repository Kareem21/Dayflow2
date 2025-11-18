const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('dayflow', {
  // Recording
  startRecording: () => ipcRenderer.invoke('start-recording'),
  stopRecording: () => ipcRenderer.invoke('stop-recording'),
  getRecordingState: () => ipcRenderer.invoke('get-recording-state'),

  // Timeline
  getTimeline: (date) => ipcRenderer.invoke('get-timeline', date),
  getDateRange: () => ipcRenderer.invoke('get-date-range'),

  // Categories
  getCategories: () => ipcRenderer.invoke('get-categories'),
  saveCategory: (category) => ipcRenderer.invoke('save-category', category),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Sources
  getSources: () => ipcRenderer.invoke('get-sources'),

  // Video
  getVideoPath: (cardId) => ipcRenderer.invoke('get-video-path', cardId),

  // Listen for events from main process
  onRecordingStateChanged: (callback) => {
    ipcRenderer.on('recording-state-changed', (event, state) => callback(state));
  },

  onTimelineUpdated: (callback) => {
    ipcRenderer.on('timeline-updated', (event, data) => callback(data));
  }
});
