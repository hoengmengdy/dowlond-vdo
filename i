# CODEX PROMPT — BULK FACEBOOK VIDEO DOWNLOADER

**Project Name:** FB Bulk Video Downloader

**Role:** Act as a Senior Full-Stack Developer, Python Engineer, and Professional UI/UX Designer.

## 1. MAIN OBJECTIVE

Build a complete, modern Facebook Bulk Video Downloader web application.

Users should be able to paste multiple Facebook video URLs and download multiple videos efficiently.

The application must be functional, not just a UI mockup.

Use this technology stack:

- Frontend: React + Tailwind CSS
- Backend: Python + FastAPI
- Download Engine: yt-dlp
- Real-time Progress: WebSocket or Server-Sent Events
- Background Job Queue: Controlled concurrency with asyncio
- File Packaging: ZIP
- Database: SQLite for local job history

**Important:** Support downloads only for public videos that users own or have permission to download, and only where platform rules permit. Do not bypass Facebook login, access restrictions, DRM, or anti-bot protection.

## 2. BULK URL INPUT

Create a large text input that supports pasting multiple URLs.

Example:

https://www.facebook.com/watch/?v=123456789

https://www.facebook.com/reel/123456789

https://www.facebook.com/example/videos/123456789

Features:

- One URL per line
- Paste 10, 50, 100, or more links
- Automatically detect valid Facebook links
- Remove duplicate URLs
- Display total valid URLs
- Show invalid links with clear error messages
- Add Clear All and Remove Selected buttons
- Allow importing URLs from TXT or CSV files
- Support URLs from facebook.com, fb.watch, and m.facebook.com

## 3. VIDEO INFORMATION

For accessible videos, retrieve:

- Video thumbnail
- Video title
- Duration
- Available resolution
- Original URL
- Download status

Each video should appear in a modern card with a selection checkbox.

Do not claim that a URL is downloadable until its accessibility has been verified.

## 4. DOWNLOAD OPTIONS

Allow users to choose:

- Best Available Quality
- 1080p, if available
- 720p, if available
- 480p, if available
- Original video format, if available
- MP4 output, when supported
- Download Selected
- Download All
- Download as ZIP

Do not upscale lower-resolution source videos.

## 5. MULTIPLE VIDEO DOWNLOADS

Implement bulk download processing with:

- Configurable concurrency: 1–5 simultaneous downloads
- Download queue
- Individual progress bars
- Overall download progress
- Completed video counter
- Failed video counter
- Download speed
- Estimated remaining time, when measurable
- Cancel individual download
- Cancel all
- Retry failed downloads

Handle 100+ URLs without freezing the UI.

Do not download everything at once. Use a controlled queue to prevent excessive resource usage.

## 6. PROFESSIONAL UI DESIGN

Create a modern dashboard with:

**Design Style:**

- Clean and minimalist
- White / Light Gray background
- Blue primary accent
- Rounded cards
- Subtle shadows
- Professional typography
- Responsive layout
- Smooth transitions

**Dashboard Layout:**

Header:
- FB Bulk Downloader logo
- Dashboard
- Download History
- Settings
- Light / Dark Mode

Main Content:
- Bulk URL input
- Paste Links button
- Import TXT/CSV
- Analyze Videos button
- Quality selector
- Download All button

Statistics:
- Total Videos
- Downloading
- Completed
- Failed

Video Queue:
- Thumbnail
- Title
- Quality
- Progress
- Status
- Download button
- Retry button

Bottom:
- Download ZIP
- Clear Completed
- Download History

## 7. BACKEND API

Create these endpoints:

POST /api/videos/analyze

POST /api/downloads/start

GET /api/downloads/{job_id}

GET /api/downloads/{job_id}/progress

POST /api/downloads/{job_id}/cancel

POST /api/downloads/{job_id}/retry

GET /api/downloads/{job_id}/zip

GET /api/history

DELETE /api/history

GET /api/health

Use strict URL validation, file-size limits, safe filenames, request timeouts, and appropriate rate limits.

Prevent SSRF and prohibit fetching arbitrary internal URLs.

## 8. DOWNLOAD ENGINE

Use yt-dlp where compatible with accessible, permitted Facebook video URLs.

Requirements:

- Detect available video formats.
- Prefer MP4-compatible streams where available.
- Use FFmpeg for supported audio/video merging.
- Preserve original audio