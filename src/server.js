import "dotenv/config";
import crypto from "node:crypto";
import fsSync from "node:fs";
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
const distDir = path.resolve(__dirname, "../dist");
const staticDir = fsSync.existsSync(path.join(distDir, "index.html")) ? distDir : publicDir;
const isVercel = Boolean(process.env.VERCEL);
const screenshotCacheDir = isVercel ? path.join("/tmp", "shop-haul-screenshots") : path.join(publicDir, "cache", "screenshots");
const screenshotTtlHours = Number(process.env.SCREENSHOT_CACHE_TTL_HOURS || 168);
const screenshotTtlMs = Math.max(1, screenshotTtlHours) * 60 * 60 * 1000;
const screenshotVersion = "v3";
const shopsCacheTtlSeconds = Number(process.env.SHOPS_CACHE_TTL_SECONDS || 300);
const shopsCacheTtlMs = Math.max(5, shopsCacheTtlSeconds) * 1000;
const edgeCacheSeconds = Number(process.env.SHOPS_EDGE_CACHE_SECONDS || 60);
const edgeStaleSeconds = Number(process.env.SHOPS_EDGE_STALE_SECONDS || 300);
const sitePassword = String(process.env.SITE_PASSWORD || "");
const isPasswordGateEnabled = Boolean(sitePassword);
const authCookieName = "shop_haul_vault_auth";
const authCookieValue = sitePassword
  ? crypto.createHash("sha256").update(`shop-haul:${sitePassword}`).digest("hex")
  : "";

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

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};

  return cookieHeader.split(";").reduce((acc, part) => {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rawValue.join("=") || "");
    return acc;
  }, {});
}

function buildPasswordGateHtml(errorMessage = "") {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Shop Haul Vault</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #ffffff;
        --fg: #111111;
        --muted: rgba(17,17,17,.62);
        --border: rgba(17,17,17,.08);
        --primary: #dbff49;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100svh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(219,255,73,.12) 0, transparent 34%),
          linear-gradient(180deg, #fff 0%, #fff 100%);
        font-family: "Geist Variable", ui-sans-serif, system-ui, sans-serif;
        color: var(--fg);
      }
      .card {
        width: min(92vw, 460px);
        border: 1px solid var(--border);
        border-radius: 28px;
        background: rgba(255,255,255,.94);
        box-shadow: 0 24px 80px rgba(17,17,17,.08);
        padding: 28px;
      }
      h1 {
        margin: 0 0 10px;
        font-size: clamp(2rem, 5vw, 2.8rem);
        line-height: 1;
        letter-spacing: -.04em;
      }
      p {
        margin: 0 0 18px;
        color: var(--muted);
        font-size: 1rem;
        line-height: 1.5;
      }
      form { display: grid; gap: 12px; }
      input {
        width: 100%;
        height: 56px;
        border-radius: 18px;
        border: 1px solid var(--border);
        padding: 0 16px;
        font: inherit;
        outline: none;
      }
      button {
        height: 56px;
        border: 0;
        border-radius: 999px;
        background: var(--primary);
        color: #111;
        font: 600 1rem/1 "Geist Mono Variable", ui-monospace, monospace;
        cursor: pointer;
      }
      .error {
        min-height: 1.2rem;
        color: #b42318;
        font-size: .92rem;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Private Vault</h1>
      <p>Enter the password to access Shop Haul Vault.</p>
      <form method="post" action="/auth/login">
        <input type="password" name="password" placeholder="Password" autocomplete="current-password" required />
        <div class="error">${errorMessage}</div>
        <button type="submit">Enter vault</button>
      </form>
    </main>
  </body>
</html>`;
}

function timingSafeMatch(expected, actual) {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

app.use(express.urlencoded({ extended: false }));

if (isPasswordGateEnabled) {
  app.get("/auth/login", (_req, res) => {
    res.status(200).type("html").send(buildPasswordGateHtml());
  });

  app.post("/auth/login", (req, res) => {
    const submittedPassword = String(req.body?.password || "");
    const passwordMatches = timingSafeMatch(sitePassword, submittedPassword);

    if (!passwordMatches) {
      res.status(401).type("html").send(buildPasswordGateHtml("Incorrect password."));
      return;
    }

    const secure = isVercel ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `${authCookieName}=${authCookieValue}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${60 * 60 * 24 * 14}`
    );
    res.redirect(302, "/");
  });

  app.post("/auth/logout", (_req, res) => {
    const secure = isVercel ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${authCookieName}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`);
    res.redirect(302, "/auth/login");
  });

  app.use((req, res, next) => {
    if (req.path === "/auth/login" || req.path === "/auth/logout") {
      next();
      return;
    }

    const cookies = parseCookies(req.headers.cookie || "");
    const isAuthed = cookies[authCookieName] && timingSafeMatch(authCookieValue, cookies[authCookieName]);

    if (!isAuthed) {
      if (req.path.startsWith("/api/")) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }

      res.status(200).type("html").send(buildPasswordGateHtml());
      return;
    }

    next();
  });
}

app.use(express.static(staticDir));

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
  res.sendFile(path.join(staticDir, "index.html"));
});

await fs.mkdir(screenshotCacheDir, { recursive: true });

if (!isVercel) {
  app.listen(port, () => {
    console.log(`Shop Haul gallery running at http://localhost:${port}`);
  });
}

export default app;
