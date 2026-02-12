import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@notionhq/client";
import { fetchShopsFromNotion } from "../src/notion.js";

const OUTPUT_JSON = path.resolve("reports/unavailable-shops.json");
const OUTPUT_MD = path.resolve("reports/unavailable-shops.md");
const DEFAULT_TIMEOUT_MS = Number(process.env.UNAVAILABLE_TIMEOUT_MS || 9000);
const DEFAULT_CONCURRENCY = Number(process.env.UNAVAILABLE_CONCURRENCY || 6);

const propertyMap = {
  name: process.env.NOTION_NAME_PROP || "Name",
  url: process.env.NOTION_URL_PROP || "URL",
  category: process.env.NOTION_CATEGORY_PROP || "Category/Type",
  tags: process.env.NOTION_TAGS_PROP || "Tags/Categories",
  notes: process.env.NOTION_NOTES_PROP || "Description/Notes/Summary"
};

const UNAVAILABLE_PATTERNS = [
  /something went wrong/i,
  /this store is unavailable/i,
  /return to the previous page/i,
  /store is currently unavailable/i,
  /shop is unavailable/i,
  /page not found/i
];

function parseArgs(argv) {
  const args = {
    apply: false,
    limit: Infinity,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    concurrency: DEFAULT_CONCURRENCY
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--apply") args.apply = true;
    if (token === "--limit") args.limit = Number(argv[i + 1] || Infinity);
    if (token === "--timeout") args.timeoutMs = Number(argv[i + 1] || DEFAULT_TIMEOUT_MS);
    if (token === "--concurrency") args.concurrency = Number(argv[i + 1] || DEFAULT_CONCURRENCY);
  }

  if (!Number.isFinite(args.limit) || args.limit < 1) args.limit = Infinity;
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1000) args.timeoutMs = DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) args.concurrency = DEFAULT_CONCURRENCY;
  args.concurrency = Math.min(20, Math.floor(args.concurrency));

  return args;
}

function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i], i);
    }
  }

  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker)).then(() => out);
}

function normalizeHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; ShopHaulPrune/1.0)"
      }
    });

    const contentType = response.headers.get("content-type") || "";
    const text = contentType.toLowerCase().includes("text/html")
      ? normalizeHtml(await response.text())
      : "";

    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url || url,
      text
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      text: "",
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

function detectUnavailable(result) {
  if (!result) return null;

  if (result.status === 404 || result.status === 410) {
    return `http:${result.status}`;
  }

  for (const pattern of UNAVAILABLE_PATTERNS) {
    if (pattern.test(result.text || "")) {
      return `match:${pattern.source}`;
    }
  }

  if (!result.ok && result.error) {
    if (/ENOTFOUND|EAI_AGAIN|timed out|timeout/i.test(result.error)) {
      return null;
    }
  }

  return null;
}

async function withRetries(fn, attempts = 3) {
  let lastError;

  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const waitMs = 400 * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  throw lastError;
}

function toMarkdownReport(summary) {
  const lines = [];
  lines.push("# Unavailable Shop Cleanup");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Mode: ${summary.mode}`);
  lines.push("");
  lines.push(`- Scanned: ${summary.scanned}`);
  lines.push(`- Matches: ${summary.matches.length}`);
  lines.push(`- Archived: ${summary.archived}`);
  lines.push(`- Errors: ${summary.errors.length}`);
  lines.push("");

  if (summary.matches.length) {
    lines.push("## Matches");
    lines.push("");
    summary.matches.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}`);
      lines.push(`- URL: ${item.url}`);
      lines.push(`- Page ID: ${item.id}`);
      lines.push(`- Reason: ${item.reason}`);
      lines.push("");
    });
  }

  if (summary.errors.length) {
    lines.push("## Errors");
    lines.push("");
    summary.errors.forEach((error, index) => {
      lines.push(`${index + 1}. ${error.id} ${error.url}`);
      lines.push(`- Error: ${error.error}`);
      lines.push("");
    });
  }

  return lines.join("\n");
}

async function main() {
  const { apply, limit, timeoutMs, concurrency } = parseArgs(process.argv.slice(2));
  const notionApiKey = process.env.NOTION_API_KEY;

  if (!notionApiKey) {
    throw new Error("NOTION_API_KEY is missing.");
  }

  const notion = new Client({ auth: notionApiKey });
  const notionData = await fetchShopsFromNotion({
    notionApiKey,
    databaseId: process.env.NOTION_DATABASE_ID,
    propertyMap
  });

  const shops = notionData.items.slice(0, limit);
  const matches = [];
  const errors = [];
  let archived = 0;

  await mapLimit(shops, concurrency, async (shop, index) => {
    const n = index + 1;
    const result = await fetchWithTimeout(shop.url, timeoutMs);
    const reason = detectUnavailable(result);

    if (!reason) {
      if (n % 50 === 0) {
        console.log(`[scan] ${n}/${shops.length}`);
      }
      return;
    }

    matches.push({
      id: shop.id,
      title: shop.title,
      url: shop.url,
      reason
    });

    if (!apply) {
      console.log(`[match] ${shop.id} ${shop.title} (${reason})`);
      return;
    }

    try {
      await withRetries(
        () =>
          notion.pages.update({
            page_id: shop.id,
            archived: true
          }),
        3
      );
      archived += 1;
      console.log(`[archived] ${shop.id} ${shop.title} (${reason})`);
    } catch (error) {
      errors.push({
        id: shop.id,
        url: shop.url,
        error: error instanceof Error ? error.message : String(error)
      });
      console.log(`[error] ${shop.id} ${shop.title}`);
    }
  });

  const summary = {
    mode: apply ? "apply" : "dry-run",
    scanned: shops.length,
    archived,
    matches,
    errors
  };

  await fs.mkdir(path.dirname(OUTPUT_JSON), { recursive: true });
  await Promise.all([
    fs.writeFile(OUTPUT_JSON, JSON.stringify(summary, null, 2), "utf8"),
    fs.writeFile(OUTPUT_MD, toMarkdownReport(summary), "utf8")
  ]);

  console.log(`Wrote ${OUTPUT_JSON}`);
  console.log(`Wrote ${OUTPUT_MD}`);
  console.log(`Scanned ${summary.scanned}; matched ${summary.matches.length}; archived ${summary.archived}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
