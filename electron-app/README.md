# Dayflow Electron

**Cross-platform screen activity tracker with AI-powered timeline**

A complete rewrite of Dayflow in Electron, bringing the privacy-focused screen tracking and AI analysis to Windows, macOS, and Linux.

## Features

- **1 FPS Screen Recording**: Efficient screen capture using Electron's `desktopCapturer` API
- **AI-Powered Analysis**: Automatic activity categorization using Gemini or local Ollama models
- **Timeline View**: Visual timeline of your daily activities
- **20x Timelapses**: Watch compressed videos of your activities
- **Privacy-First**: All data stored locally, auto-delete after 3 days
- **Cross-Platform**: Works on macOS, Windows, and Linux
- **System Tray**: Runs quietly in the background
- **Auto-Launch**: Starts automatically on login (optional)

## Architecture

### Core Components

1. **Main Process** (`src/main/main.js`)
   - Electron app lifecycle management
   - IPC communication between main and renderer
   - System tray integration
   - Window management

2. **Database Layer** (`src/main/database.js`)
   - SQLite database with better-sqlite3
   - Schema matches original macOS version
   - Tables: chunks, batches, timeline_cards, categories, settings
   - Automatic data cleanup

3. **Screen Recorder** (`src/main/recorder.js`)
   - Uses `desktopCapturer` API for screen capture
   - Saves 15-second WebM chunks
   - 1 FPS capture rate for efficiency
   - Auto-rotation and error handling

4. **Video Processor** (`src/main/video-processor.js`)
   - FFmpeg-based video stitching
   - Creates 20x speed timelapses
   - Frame extraction for AI analysis
   - H.264 encoding for compatibility

5. **LLM Service** (`src/main/llm-service.js`)
   - Gemini provider: Efficient video understanding (2 API calls per batch)
   - Ollama provider: Local frame-by-frame analysis (privacy-focused)
   - Activity parsing and categorization
   - Error handling and retry logic

6. **Analysis Manager** (`src/main/analysis.js`)
   - Groups chunks into ~15-minute batches
   - Orchestrates video processing and LLM analysis
   - Creates timeline cards
   - Background processing with 60-second intervals

7. **Renderer Process** (`src/renderer/`)
   - Clean HTML/CSS/JS UI (no framework overhead)
   - Timeline view with date navigation
   - Video playback modal
   - Settings configuration
   - Real-time recording status

## Technology Stack

- **Framework**: Electron 28.0
- **Database**: better-sqlite3 (SQLite)
- **Video**: fluent-ffmpeg (FFmpeg wrapper)
- **AI**: Google Gemini API / Ollama
- **UI**: Vanilla HTML/CSS/JavaScript (lightweight)
- **Build**: electron-builder

## Data Flow

```
Screen Capture (1 FPS)
    ↓
15-second WebM chunks → SQLite database
    ↓
Every 60s: Group into ~15-min batches
    ↓
Stitch chunks → Create timelapse (FFmpeg)
    ↓
Send to LLM (Gemini or Ollama)
    ↓
Parse activities → Save timeline cards
    ↓
Display in UI
```

## API Reference

### IPC Handlers (Main Process)

- `start-recording` - Start screen recording
- `stop-recording` - Stop screen recording
- `get-recording-state` - Get current recording state
- `get-timeline` - Get timeline cards for a date
- `get-date-range` - Get first and last activity dates
- `get-categories` - Get all categories
- `save-category` - Save a category
- `get-settings` - Get all settings
- `save-settings` - Save settings
- `get-sources` - Get available screen sources
- `get-video-path` - Get video path for a timeline card

### Database Schema

**chunks**
- id, start_time, end_time, duration, file_path, file_size, created_at

**analysis_batches**
- id, start_time, end_time, total_duration, chunk_count, status, created_at, processed_at

**batch_chunks** (join table)
- batch_id, chunk_id

**timeline_cards**
- id, batch_id, start_time, end_time, title, description, category, is_distraction, video_path, created_at

**categories**
- id, name, color, created_at

**settings**
- key, value

**llm_calls** (debugging)
- id, batch_id, provider, model, prompt_tokens, completion_tokens, response, error, created_at

## Configuration

Settings are stored in the SQLite database and can be configured via the UI:

- `llm_provider`: "gemini" or "ollama"
- `gemini_api_key`: Your Gemini API key
- `ollama_url`: Ollama server URL (default: http://localhost:11434)
- `ollama_model`: Ollama model name (default: llava)

## Deep Links

The app supports `dayflow://` URL scheme for automation:

- `dayflow://start-recording` - Start recording
- `dayflow://stop-recording` - Stop recording

## Platform-Specific Notes

### macOS
- Requires Screen Recording permission
- System tray icon in menu bar
- Native feel with standard shortcuts

### Windows
- No special permissions required
- System tray icon in taskbar
- Runs on Windows 10+

### Linux
- Works on most distributions
- Requires X11 or Wayland
- System tray support varies by desktop environment

## Performance

- **Memory**: ~200-400 MB (Chromium overhead)
- **CPU**: <1% during recording
- **Storage**: ~50-100 MB per hour of recording
- **Network**: Only when sending to Gemini (or no network with Ollama)

## Privacy

- All recordings stored locally
- No telemetry or analytics
- API keys stored in local database
- Auto-delete recordings after 3 days
- Choose between cloud (Gemini) or local (Ollama) AI

## Development

See [INSTALL.md](INSTALL.md) for setup instructions.

### Project Structure
```
electron-app/
├── src/
│   ├── main/          # Main process (Node.js)
│   │   ├── main.js
│   │   ├── preload.js
│   │   ├── database.js
│   │   ├── recorder.js
│   │   ├── video-processor.js
│   │   ├── llm-service.js
│   │   └── analysis.js
│   ├── renderer/      # Renderer process (UI)
│   │   ├── index.html
│   │   ├── styles.css
│   │   └── app.js
│   └── shared/        # Shared utilities
├── package.json
├── README.md
└── INSTALL.md
```

## Comparison with macOS Version

| Feature | macOS (Swift) | Electron |
|---------|---------------|----------|
| Screen Capture | ScreenCaptureKit | desktopCapturer |
| Video Encoding | AVFoundation | FFmpeg |
| Database | GRDB | better-sqlite3 |
| UI | SwiftUI | HTML/CSS/JS |
| Size | ~30 MB | ~150 MB |
| Memory | ~100 MB | ~300 MB |
| Cross-Platform | macOS only | Mac/Win/Linux |
| Development Speed | Medium | Fast |

## Roadmap

- [ ] Add tray icon assets
- [ ] Implement system sleep/wake detection
- [ ] Add keyboard shortcuts
- [ ] Implement auto-updater
- [ ] Add export functionality (CSV, JSON)
- [ ] Support multiple monitors
- [ ] Add statistics dashboard
- [ ] Implement custom categories
- [ ] Add search functionality

## License

MIT

## Credits

Based on the original Dayflow for macOS by the Dayflow team.
