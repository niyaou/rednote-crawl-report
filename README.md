# RedNote Crawl Report

A Node.js + Playwright crawler for Xiaohongshu (小红书 / RedNote) that searches keywords, filters image posts, downloads content, and generates reports.

## Features

- QR code login with persistent browser session
- Keyword-based search in Chinese
- Filter by newest posts, image-only, minimum likes
- Download post images to external disk (`/Volumes/T7/rednote`)
- Store post metadata in SQLite
- Deduplication: skip already saved posts
- Generate Markdown summary reports

## Quick Start

```bash
npm install
npm start
```

## Configuration

Edit `config.json`:

```json
{
  "keywords": ["穿搭", "美妆", "旅行"],
  "scanLimitPerKeyword": 20,
  "minLikes": 20,
  "sort": "time_descending",
  "imageOnly": true,
  "imageDir": "/Volumes/T7/rednote",
  "dbPath": "./data/posts.db",
  "reportDir": "./reports",
  "browserDataDir": "./browser_data",
  "headless": false,
  "delayBetweenRequestsMs": 3000,
  "scrollTimes": 3,
  "baseUrl": "https://www.xiaohongshu.com"
}
```

## How It Works

1. **Login**: Opens Chrome, navigates to xiaohongshu.com. If not logged in, shows QR code and waits for you to scan.
2. **Search**: For each keyword, searches and sorts by newest.
3. **Filter**: Keeps only image posts with likes >= `minLikes`.
4. **Deduplicate**: Skips posts already in the SQLite database.
5. **Download**: Saves images to `imageDir/{noteId}/` and metadata to `data/posts.db`.
6. **Report**: Generates a Markdown report in `reports/`.

## License

MIT
