import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { fetchShopsFromNotion } from "./notion.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");
const isVercel = Boolean(process.env.VERCEL);
const screenshotCacheDir = isVercel ? path.join("/tmp", "shop-haul-screenshots") : path.join(publicDir, "cache", "screenshots");
const screenshotTtlHours = Number(process.env.SCREENSHOT_CACHE_TTL_HOURS || 168);
const screenshotTtlMs = Math.max(1, screenshotTtlHours) * 60 * 60 * 1000;
const screenshotVersion = "v3";
const shopsCacheTtlSeconds = Number(process.env.SHOPS_CACHE_TTL_SECONDS || 300);
const shopsCacheTtlMs = Math.max(5, shopsCacheTtlSeconds) * 1000;
const edgeCacheSeconds = Number(process.env.SHOPS_EDGE_CACHE_SECONDS || 60);
const edgeStaleSeconds = Number(process.env.SHOPS_EDGE_STALE_SECONDS || 300);

const shopsCache =
  globalThis.__shopHaulShopsCache ||
  (globalThis.__shopHaulShopsCache = {
    payload: null,
    fetchedAt: 0,
    inflight: null
  });

const propertyMap = {
  name: process.env.NOTION_NAME_PROP || "Name",
  url: process.env.NOTION_URL_PROP || "URL",
  category: process.env.NOTION_CATEGORY_PROP || "Category/Type",
  tags: process.env.NOTION_TAGS_PROP || "Tags",
  notes: process.env.NOTION_NOTES_PROP || "Notes"
};

const screenshotProviders = [
  (url) => `https://image.thum.io/get/width/1400/crop/900/noanimate/${encodeURIComponent(url)}`
];

const isWebUrl = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const cacheKeyForUrl = (url) => crypto.createHash("sha256").update(`${screenshotVersion}:${url}`).digest("hex");

const pathsForKey = (cacheKey) => ({
  binPath: path.join(screenshotCacheDir, `${cacheKey}.bin`),
  metaPath: path.join(screenshotCacheDir, `${cacheKey}.json`)
});

async function readCacheEntry(cacheKey) {
  const { binPath, metaPath } = pathsForKey(cacheKey);

  try {
    const [metaRaw, bin] = await Promise.all([fs.readFile(metaPath, "utf8"), fs.readFile(binPath)]);
    const meta = JSON.parse(metaRaw);

    if (!meta?.fetchedAt || !meta?.contentType) {
      return null;
    }

    if (!String(meta.contentType).toLowerCase().startsWith("image/")) {
      return null;
    }

    const ageMs = Date.now() - Number(meta.fetchedAt);
    if (!Number.isFinite(ageMs) || ageMs > screenshotTtlMs) {
      return null;
    }

    return {
      contentType: meta.contentType,
      body: bin
    };
  } catch {
    return null;
  }
}

async function writeCacheEntry(cacheKey, contentType, body) {
  const { binPath, metaPath } = pathsForKey(cacheKey);
  const meta = {
    contentType,
    fetchedAt: Date.now()
  };

  await Promise.all([
    fs.writeFile(binPath, body),
    fs.writeFile(metaPath, JSON.stringify(meta), "utf8")
  ]);
}

async function fetchScreenshotBuffer(targetUrl) {
  let lastError = "Unknown screenshot error.";

  for (const buildProviderUrl of screenshotProviders) {
    const upstream = buildProviderUrl(targetUrl);
    if (!upstream) {
      continue;
    }

    try {
      const response = await fetch(upstream);
      if (!response.ok) {
        lastError = `Provider failed (${response.status}).`;
        continue;
      }

      const contentType = response.headers.get("content-type") || "image/jpeg";
      if (!contentType.toLowerCase().startsWith("image/")) {
        lastError = `Provider returned non-image content (${contentType}).`;
        continue;
      }

      const body = Buffer.from(await response.arrayBuffer());
      if (!body.length) {
        lastError = "Provider returned an empty image.";
        continue;
      }

      return { contentType, body };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError);
}

async function buildShopsPayload() {
  const notionData = await fetchShopsFromNotion({
    notionApiKey: process.env.NOTION_API_KEY,
    databaseId: process.env.NOTION_DATABASE_ID,
    propertyMap
  });

  const payload = notionData.items.map((shop) => ({
    ...shop,
    screenshot: `/api/screenshot?u=${encodeURIComponent(shop.url)}&sv=${screenshotVersion}`
  }));

  const tags = Array.from(
    new Set(payload.flatMap((shop) => shop.tags).map((tag) => tag.trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
  const categories = Array.from(
    new Set(payload.map((shop) => String(shop.category || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  return {
    shops: payload,
    categories,
    tags,
    count: payload.length,
    totalRows: notionData.totalRows,
    shopsWithUrl: notionData.shopsWithUrl,
    databaseId: process.env.NOTION_DATABASE_ID
  };
}

function isFreshCache() {
  if (!shopsCache.payload || !shopsCache.fetchedAt) return false;
  return Date.now() - shopsCache.fetchedAt < shopsCacheTtlMs;
}

async function getShopsPayload() {
  if (isFreshCache()) {
    return { payload: shopsCache.payload, source: "memory-fresh" };
  }

  if (shopsCache.inflight) {
    const payload = await shopsCache.inflight;
    return { payload, source: "memory-inflight" };
  }

  shopsCache.inflight = buildShopsPayload()
    .then((payload) => {
      shopsCache.payload = payload;
      shopsCache.fetchedAt = Date.now();
      return payload;
    })
    .finally(() => {
      shopsCache.inflight = null;
    });

  const payload = await shopsCache.inflight;
  return { payload, source: "notion-refresh" };
}

app.use(express.static(publicDir));

app.get("/api/screenshot", async (req, res) => {
  const targetUrl = typeof req.query.u === "string" ? req.query.u.trim() : "";

  if (!isWebUrl(targetUrl)) {
    res.status(400).json({ error: "Missing or invalid screenshot URL." });
    return;
  }

  const cacheKey = cacheKeyForUrl(targetUrl);

  try {
    const cached = await readCacheEntry(cacheKey);
    if (cached) {
      res.setHeader("content-type", cached.contentType);
      res.setHeader("cache-control", "no-store");
      res.send(cached.body);
      return;
    }

    const fresh = await fetchScreenshotBuffer(targetUrl);
    await writeCacheEntry(cacheKey, fresh.contentType, fresh.body);

    res.setHeader("content-type", fresh.contentType);
    res.setHeader("cache-control", "no-store");
    res.send(fresh.body);
  } catch (error) {
    res.status(502).json({
      error: "Failed to create screenshot.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/shops", async (_req, res) => {
  try {
    const { payload, source } = await getShopsPayload();
    res.setHeader("cache-control", `public, s-maxage=${edgeCacheSeconds}, stale-while-revalidate=${edgeStaleSeconds}`);
    res.setHeader("x-shops-cache", source);
    res.json(payload);
  } catch (error) {
    if (shopsCache.payload) {
      res.setHeader("cache-control", `public, s-maxage=${edgeCacheSeconds}, stale-while-revalidate=${edgeStaleSeconds}`);
      res.setHeader("x-shops-cache", "memory-stale-on-error");
      res.json(shopsCache.payload);
      return;
    }

    res.status(500).json({
      error: "Failed to load Notion database.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

await fs.mkdir(screenshotCacheDir, { recursive: true });

if (!isVercel) {
  app.listen(port, () => {
    console.log(`Shop Haul gallery running at http://localhost:${port}`);
  });
}

export default app;
