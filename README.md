# ScriptSnip - Web Version

A client-side web application that extracts speech audio from video files using subtitle timing, perfect for language immersion learning.

## Features

- **Client-side processing**: All processing happens in your browser - no files uploaded to servers
- **Multiple format support**: Videos (MP4, MKV, AVI, etc.) and subtitles (SRT, ASS, VTT)
- **Intelligent filtering**: Remove parenthetical text and unwanted characters
- **Batch processing**: Handle multiple video files at once
- **Flexible output**: MP3, FLAC, WAV, AAC, OGG formats
- **Condensed subtitles**: Optional SRT/LRC output matching the condensed timeline

## How to Use

### Try the Live App

**🚀 Use ScriptSnip instantly at: [script-snip.vercel.app](https://script-snip.vercel.app/)**

No installation required - just open the link in your browser and start processing!

### Run Locally (Optional)

If you prefer to run the app locally or want to contribute:

#### Prerequisites

- Node.js (version 16 or higher)
- A modern web browser with SharedArrayBuffer support

#### Setup Instructions

1. **Install dependencies:**

   ```bash
   cd ScriptSnip
   npm install
   ```

2. **Start the development server:**

   ```bash
   npm run dev
   ```

3. **Open your browser:**
   - Navigate to `http://localhost:3000`
   - The app should load automatically

#### Important Browser Requirements

This app requires **SharedArrayBuffer** for optimal FFmpeg.wasm performance. Most modern browsers support this, but you need:

- **Chrome/Edge**: Version 68+
- **Firefox**: Version 79+
- **Safari**: Version 15.2+

The development server is configured with the required security headers automatically.

## How to Use

### Basic Usage

1. **Select files**: Drag and drop or click to select video files and their corresponding subtitle files
2. **Configure settings**: Adjust padding, output format, and filtering options in the Configuration tab
3. **Process**: Click the process button to start condensing
4. **Download**: Processed files will automatically download when complete

### File Naming Convention

The app automatically finds subtitle files that match your video files:

- `movie.mp4` + `movie.srt`
- `episode01.mkv` + `episode01.ass`
- `video.mp4` + `video_en.srt` (if you set "Subtitle Suffix" to "\_en")

### Configuration Options

- **Padding**: Time added before/after each subtitle line (default: 500ms)
- **Output Format**: Choose from MP3, FLAC, WAV, AAC, OGG
- **Filter Parentheses**: Remove text in (), [], {} brackets
- **Filtered Characters**: Remove specific characters (musical notes, etc.)
- **Condensed Subtitles**: Output subtitle files matching the condensed timeline

## File Structure

```
ScriptSnip/
├── src/
│   ├── types.ts              # TypeScript interfaces and types
│   ├── subtitle-processor.ts # Subtitle parsing and filtering
│   ├── audio-processor.ts    # FFmpeg.wasm audio processing
│   ├── file-manager.ts       # File handling utilities
│   ├── condenser-engine.ts   # Main processing engine
│   └── main.js              # UI and app initialization
├── index.html               # Main app interface
├── package.json            # Dependencies and scripts
├── vite.config.js          # Vite configuration
└── README.md              # This file
```

## Technical Details

- **Subtitle Processing**: Parses SRT/ASS/VTT files, applies filtering, merges overlapping periods
- **Audio Extraction**: Uses FFmpeg.wasm to extract audio from video files
- **Segmentation**: Cuts audio based on subtitle timing with configurable padding
- **Concatenation**: Combines segments into final condensed audio

## Browser Compatibility

- **Recommended**: Chrome 90+, Firefox 88+, Safari 15.2+
- **Required Features**: ES2020, Web Audio API, File API, Web Workers
- **Optional**: SharedArrayBuffer (for better performance)

## Troubleshooting

### "SharedArrayBuffer is not defined"

- Make sure you're accessing via `http://localhost:3000` (not file://)
- Try a different browser (Chrome/Firefox recommended)

### "FFmpeg failed to load"

- Check your internet connection (FFmpeg.wasm loads from CDN)
- Clear browser cache and reload

### "No subtitle file found"

- Ensure subtitle files have the same base name as video files
- Check the "Subtitle Suffix" setting if your subs have suffixes

### Large files processing slowly

- Use smaller video files for testing
- Try FLAC output for faster processing
- Consider using the original Python version for very large batches

## Development

To build for production:

```bash
npm run build
```

To preview the production build:

```bash
npm run preview
```
