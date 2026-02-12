# Shop Haul Notion Gallery

A lightweight gallery app that pulls shops from a Notion database, captures website screenshots, and supports Awwwards-style filtering, sorting, and progressive loading.

## Features

- Notion database integration via Notion API
- Local screenshot caching via `/api/screenshot` (reduces repeated provider calls)
- Filter strip: `Category/Type`, `Tags/Categories`, and `Description/Notes/Summary`
- Active-filter count + reset filters action
- Sort by recently edited, oldest edited, title A-Z, title Z-A
- Pagination + infinite-loading behavior (Load more button + scroll sentinel)
- Editorial visual style aligned to the Shop Haul newsletter feel

## 1) Configure Notion

In your Notion integration settings:

1. Create or use an internal integration and copy the API key.
2. Share your database with that integration.
3. Copy your database ID.

Expected properties (customizable in `.env`):

- `Name` (title)
- `URL` (url)
- `Category/Type` (select, multi-select, or text)
- `Tags/Categories` (multi-select, select, or comma text)
- `Description/Notes/Summary` (optional rich text)

## 2) Set environment variables

```bash
cp .env.example .env
```

Then edit `.env`:

```bash
NOTION_API_KEY=secret_xxx
NOTION_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
PORT=3000
SCREENSHOT_CACHE_TTL_HOURS=168
```

If your Notion property names differ, update:

- `NOTION_NAME_PROP`
- `NOTION_URL_PROP`
- `NOTION_CATEGORY_PROP`
- `NOTION_TAGS_PROP`
- `NOTION_NOTES_PROP`

## 3) Run

```bash
npm install
npm run dev
```

Open: `http://localhost:3000`

## Screenshot cache details

- Cached files are stored at `public/cache/screenshots`.
- Each screenshot is refreshed after `SCREENSHOT_CACHE_TTL_HOURS`.
- To force fresh screenshots immediately, delete `public/cache/screenshots/*` and reload.
