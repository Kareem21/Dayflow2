# Assets Directory

This directory should contain icon assets for the application.

## Required Files

1. **tray-icon.png** - Icon for the system tray (16x16 or 22x22 pixels)
   - Should be a simple, monochrome design
   - Works well at small sizes
   - Transparent background recommended

2. **icon.png** - Application icon (512x512 pixels recommended)
   - Used for the app window and taskbar
   - Should be the Dayflow logo or app icon

## Creating Icons

You can create simple placeholder icons using any image editor, or use the existing Dayflow branding if available from the macOS version.

For now, the app will work without icons but may show a default placeholder in the system tray.

## Platform-Specific Icons

For production builds, electron-builder can automatically generate platform-specific icons from a single source:

- **macOS**: .icns file (generated from .png)
- **Windows**: .ico file (generated from .png)
- **Linux**: .png files in various sizes

Add this to package.json build configuration:
```json
"build": {
  "mac": {
    "icon": "assets/icon.png"
  },
  "win": {
    "icon": "assets/icon.png"
  },
  "linux": {
    "icon": "assets/icon.png"
  }
}
```
