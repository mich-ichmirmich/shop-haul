import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fetchShopsFromNotion } from "../src/notion.js";

const OUTPUT_JSON = path.resolve("reports/tag-suggestions.json");
const OUTPUT_MD = path.resolve("reports/tag-suggestions.md");
const MAX_SUGGESTIONS_PER_SHOP = 4;
const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_CHARS = 220000;
const CONCURRENCY = 6;

const propertyMap = {
  name: process.env.NOTION_NAME_PROP || "Name",
  url: process.env.NOTION_URL_PROP || "URL",
  category: process.env.NOTION_CATEGORY_PROP || "Category/Type",
  tags: process.env.NOTION_TAGS_PROP || "Tags/Categories",
  notes: process.env.NOTION_NOTES_PROP || "Description/Notes/Summary"
};

const CATEGORY_HINTS = {
  beverage: ["graphics", "typography", "animation"],
  food: ["typography", "graphics", "animation"],
  cosmetics: ["minimalism", "typography", "photography"],
  electronics: ["minimalism", "typography"],
  supplements: ["minimalism", "typography"],
  household: ["minimalism", "typography"],
  pets: ["animation", "graphics", "illustration"],
  bags: ["minimalism", "typography"],
  accessoires: ["minimalism", "typography"]
};

const KEYWORD_MAP = {
  animation: ["animation", "animated", "motion", "lottie", "gsap", "scroll effect", "microinteraction"],
  parallax: ["parallax", "depth scroll"],
  frontend: ["frontend", "react", "next.js", "nextjs", "vue", "web app", "javascript"],
  graphics: ["graphics", "visual", "branding", "brand identity", "poster", "packaging"],
  illustration: ["illustration", "illustrated", "mascot", "drawing", "cartoon"],
  minimalism: ["minimal", "minimalist", "clean design", "simple layout", "refined"],
  typography: ["typography", "typeface", "font", "lettering"],
  photography: ["photography", "photo", "shot", "studio", "lookbook"],
  headless: ["headless", "composable", "storefront api", "cms api"]
};

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMetaDescription(html) {
  const byName = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i);
  if (byName?.[1]) return byName[1];
  const reversedName = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']description["']/i);
  if (reversedName?.[1]) return reversedName[1];

  const byProp = html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  if (byProp?.[1]) return byProp[1];
  const reversedProp = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
  return reversedProp?.[1] || "";
}

async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; ShopHaulTagSuggest/1.0)"
      }
    });

    if (!response.ok) {
      return "";
    }

    const html = await response.text();
    return html.slice(0, MAX_HTML_CHARS);
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

function rankTags({ shop, htmlText, allowedTags }) {
  const allowedSet = new Set(allowedTags.map(normalize));
  const score = new Map();
  const reasons = new Map();

  const add = (tag, points, reason) => {
    const key = normalize(tag);
    if (!allowedSet.has(key)) return;
    score.set(key, (score.get(key) || 0) + points);
    if (!reasons.has(key)) reasons.set(key, []);
    reasons.get(key).push(reason);
  };

  const text = normalize([shop.title, shop.notes, shop.category, shop.url, htmlText].join(" "));

  const categoryKey = normalize(shop.category);
  (CATEGORY_HINTS[categoryKey] || []).forEach((tag) => add(tag, 2, `category:${categoryKey}`));

  for (const [tag, keywords] of Object.entries(KEYWORD_MAP)) {
    for (const kw of keywords) {
      if (text.includes(normalize(kw))) {
        add(tag, 1, `keyword:${kw}`);
      }
    }
  }

  const ranked = [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SUGGESTIONS_PER_SHOP)
    .map(([tag, points]) => ({ tag, score: points, reasons: reasons.get(tag) || [] }));

  return ranked;
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

function toMarkdown(summary) {
  const lines = [];
  lines.push("# Tag Suggestions (Review Only)");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`- Database rows: ${summary.totalRows}`);
  lines.push(`- Shops with URL: ${summary.shopsWithUrl}`);
  lines.push(`- Existing tagged shops: ${summary.existingTaggedShops}`);
  lines.push(`- Empty-tag shops reviewed: ${summary.emptyTagShops}`);
  lines.push(`- Shops with suggestions: ${summary.withSuggestions}`);
  lines.push("");

  summary.suggestions.forEach((s, i) => {
    lines.push(`## ${i + 1}. ${s.title}`);
    lines.push(`- URL: ${s.url}`);
    lines.push(`- Category: ${s.category || "(none)"}`);
    lines.push(`- Suggested tags: ${s.suggestedTags.join(", ") || "(none)"}`);
    lines.push(`- Confidence: ${s.confidence}`);
    if (s.reasons.length) {
      lines.push(`- Reasons: ${s.reasons.join("; ")}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

async function main() {
  const notionData = await fetchShopsFromNotion({
    notionApiKey: process.env.NOTION_API_KEY,
    databaseId: process.env.NOTION_DATABASE_ID,
    propertyMap
  });

  const all = notionData.items;
  const existingTags = new Set();
  all.forEach((shop) => shop.tags.forEach((t) => existingTags.add(normalize(t))));

  const emptyTagShops = all.filter((shop) => !shop.tags.length);

  const suggestions = await mapLimit(emptyTagShops, CONCURRENCY, async (shop) => {
    const html = await fetchWithTimeout(shop.url);
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
    const metaDesc = extractMetaDescription(html);
    const text = cleanText(`${title} ${metaDesc} ${html}`);

    const ranked = rankTags({ shop, htmlText: text, allowedTags: [...existingTags] });

    return {
      id: shop.id,
      title: shop.title,
      url: shop.url,
      category: shop.category,
      suggestedTags: ranked.map((r) => r.tag),
      confidence: ranked.length ? ranked[0].score : 0,
      reasons: ranked.flatMap((r) => r.reasons)
    };
  });

  const nonEmptySuggestions = suggestions.filter((s) => s.suggestedTags.length);

  const summary = {
    generatedAt: new Date().toISOString(),
    databaseId: process.env.NOTION_DATABASE_ID,
    totalRows: notionData.totalRows,
    shopsWithUrl: notionData.shopsWithUrl,
    existingTaggedShops: all.filter((s) => s.tags.length).length,
    emptyTagShops: emptyTagShops.length,
    withSuggestions: nonEmptySuggestions.length,
    suggestions: nonEmptySuggestions
  };

  await fs.mkdir(path.dirname(OUTPUT_JSON), { recursive: true });
  await Promise.all([
    fs.writeFile(OUTPUT_JSON, JSON.stringify(summary, null, 2), "utf8"),
    fs.writeFile(OUTPUT_MD, toMarkdown(summary), "utf8")
  ]);

  console.log(`Wrote ${OUTPUT_JSON}`);
  console.log(`Wrote ${OUTPUT_MD}`);
  console.log(`Reviewed ${summary.emptyTagShops} empty-tag shops; suggested tags for ${summary.withSuggestions}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
