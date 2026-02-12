import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@notionhq/client";

const REPORT_PATH = path.resolve("reports/tag-suggestions.json");
const DEFAULT_THRESHOLD = Number(process.env.TAG_SUGGESTION_MIN_CONFIDENCE || 4);

function parseArgs(argv) {
  const args = { apply: false, threshold: DEFAULT_THRESHOLD, limit: Infinity };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--apply") args.apply = true;
    if (token === "--threshold") args.threshold = Number(argv[i + 1] || DEFAULT_THRESHOLD);
    if (token === "--limit") args.limit = Number(argv[i + 1] || Infinity);
  }
  if (!Number.isFinite(args.threshold)) args.threshold = DEFAULT_THRESHOLD;
  if (!Number.isFinite(args.limit)) args.limit = Infinity;
  return args;
}

function uniqueTags(tags = []) {
  return [...new Set(tags.map((t) => String(t || "").trim()).filter(Boolean))];
}

function buildTagUpdate(propertyType, tags) {
  if (propertyType === "multi_select") {
    return { multi_select: tags.map((name) => ({ name })) };
  }

  if (propertyType === "select") {
    return { select: tags[0] ? { name: tags[0] } : null };
  }

  if (propertyType === "rich_text") {
    return { rich_text: tags.length ? [{ type: "text", text: { content: tags.join(", ") } }] : [] };
  }

  return null;
}

async function main() {
  const { apply, threshold, limit } = parseArgs(process.argv.slice(2));

  const notionApiKey = process.env.NOTION_API_KEY;
  const tagsPropName = process.env.NOTION_TAGS_PROP || "Tags/Categories";

  if (!notionApiKey) throw new Error("NOTION_API_KEY is missing.");

  const notion = new Client({ auth: notionApiKey });
  const raw = await fs.readFile(REPORT_PATH, "utf8");
  const report = JSON.parse(raw);

  const candidates = (report.suggestions || [])
    .filter((s) => Number(s.confidence) >= threshold)
    .slice(0, limit);

  let skippedNoTagProperty = 0;
  let skippedNotEmpty = 0;
  let skippedUnsupportedType = 0;
  let updated = 0;

  for (const s of candidates) {
    const tags = uniqueTags(s.suggestedTags || []);
    if (!tags.length) continue;

    const page = await notion.pages.retrieve({ page_id: s.id });
    const props = page.properties || {};
    const tagProp = props[tagsPropName];

    if (!tagProp) {
      skippedNoTagProperty += 1;
      console.log(`[skip:no-property] ${s.id} ${s.title}`);
      continue;
    }

    const existingCount =
      tagProp.type === "multi_select"
        ? tagProp.multi_select?.length || 0
        : tagProp.type === "select"
          ? tagProp.select?.name
            ? 1
            : 0
          : tagProp.type === "rich_text"
            ? (tagProp.rich_text || []).map((t) => t.plain_text).join("").trim()
              ? 1
              : 0
            : 0;

    if (existingCount > 0) {
      skippedNotEmpty += 1;
      console.log(`[skip:not-empty] ${s.id} ${s.title}`);
      continue;
    }

    const propertyUpdate = buildTagUpdate(tagProp.type, tags);
    if (!propertyUpdate) {
      skippedUnsupportedType += 1;
      console.log(`[skip:unsupported-type:${tagProp.type}] ${s.id} ${s.title}`);
      continue;
    }

    if (!apply) {
      console.log(`[dry-run] ${s.id} ${s.title} -> ${tags.join(", ")}`);
      continue;
    }

    await notion.pages.update({
      page_id: s.id,
      properties: {
        [tagsPropName]: propertyUpdate
      }
    });

    updated += 1;
    console.log(`[updated] ${s.id} ${s.title} -> ${tags.join(", ")}`);
  }

  console.log("\nSummary");
  console.log(`- mode: ${apply ? "apply" : "dry-run"}`);
  console.log(`- threshold: ${threshold}`);
  console.log(`- candidates: ${candidates.length}`);
  console.log(`- updated: ${updated}`);
  console.log(`- skipped(no tag property): ${skippedNoTagProperty}`);
  console.log(`- skipped(not empty): ${skippedNotEmpty}`);
  console.log(`- skipped(unsupported type): ${skippedUnsupportedType}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
