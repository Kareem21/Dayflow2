# Dayflow Electron - Installation Guide

## Prerequisites

1. **Node.js** (v18 or higher)
   - Download from: https://nodejs.org/

2. **FFmpeg** (required for video processing)
   - **macOS**: `brew install ffmpeg`
   - **Windows**: Download from https://ffmpeg.org/download.html and add to PATH
   - **Linux**: `sudo apt-get install ffmpeg`

3. **Python and Build Tools** (for native dependencies)
   - **macOS**: `xcode-select --install`
   - **Windows**: `npm install --global windows-build-tools`
   - **Linux**: `sudo apt-get install build-essential`

## Installation Steps

1. **Navigate to the electron-app directory**
   ```bash
   cd electron-app
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure FFmpeg path** (if needed)

   If FFmpeg is not in your PATH, you'll need to configure it manually:

   Edit `src/main/video-processor.js` and add at the top:
   ```javascript
   const ffmpeg = require('fluent-ffmpeg');
   ffmpeg.setFfmpegPath('/path/to/ffmpeg');
   ```

4. **Run the application**
   ```bash
   npm start
   ```

## First-Time Setup

1. **Screen Recording Permissions** (macOS only)
   - On first launch, macOS will ask for screen recording permission
   - Go to System Preferences → Security & Privacy → Screen Recording
   - Enable permission for Dayflow

2. **Configure AI Provider**
   - Click the "Settings" button in the app
   - Choose between:
     - **Gemini** (recommended): Fast, cloud-based. Requires API key from https://makersuite.google.com/app/apikey
     - **Ollama** (private): Local processing. Requires Ollama installed with llava model

3. **Start Recording**
   - Click "Start Recording" button
   - Activities will be analyzed every ~15 minutes
   - View your timeline by selecting dates

## Building for Distribution

### macOS
```bash
npm run build:mac
```

### Windows
```bash
npm run build:win
```

### Linux
```bash
npm run build:linux
```

Built applications will be in the `dist/` directory.

## Troubleshooting

### "Cannot find module 'better-sqlite3'"
- Make sure you ran `npm install`
- Try: `npm rebuild better-sqlite3`

### "FFmpeg not found"
- Install FFmpeg as described above
- Verify: `ffmpeg -version`

### Screen capture not working
- Check permissions (macOS/Windows)
- Restart the application
- Check console for errors

### Ollama not connecting
- Make sure Ollama is running: `ollama serve`
- Install llava model: `ollama pull llava`
- Check URL in settings (default: http://localhost:11434)

## Data Storage

All data is stored locally in:
- **macOS**: `~/Library/Application Support/dayflow-electron/`
- **Windows**: `%APPDATA%/dayflow-electron/`
- **Linux**: `~/.config/dayflow-electron/`

This includes:
- `dayflow.db` - SQLite database
- `recordings/` - 15-second video chunks
- `timelapses/` - Generated timelapse videos

Recordings are automatically deleted after 3 days for privacy.
