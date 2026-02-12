import { Client } from "@notionhq/client";

const getPlainText = (richText = []) => richText.map((t) => t.plain_text).join("");
const normalize = (value) => String(value || "").trim().toLowerCase();
const trim = (value) => String(value || "").trim();
const hasWhitespace = (value) => /\s/.test(String(value || ""));

const normalizeCandidateUrl = (value) => {
  const raw = trim(value);
  if (!raw) return "";

  // Already absolute URL
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
    } catch {
      return "";
    }
  }

  // Ignore obvious non-URL strings
  if (hasWhitespace(raw)) return "";
  if (!raw.includes(".")) return "";

  // Domain-like values, e.g. "example.com/"
  try {
    const parsed = new URL(`https://${raw.replace(/^\/+/, "")}`);
    return parsed.toString();
  } catch {
    return "";
  }
};

const readTitle = (property) => {
  if (!property) return "Untitled";
  if (property.type === "title") return getPlainText(property.title);
  if (property.type === "rich_text") return getPlainText(property.rich_text);
  return "Untitled";
};

const readUrl = (property) => {
  if (!property) return "";
  if (property.type === "url") return normalizeCandidateUrl(property.url || "");
  if (property.type === "rich_text") {
    const direct = normalizeCandidateUrl(getPlainText(property.rich_text).trim());
    if (direct) return direct;
    const linked = (property.rich_text || []).map((t) => t.href).find(Boolean);
    return normalizeCandidateUrl(linked || "");
  }
  if (property.type === "title") {
    const direct = normalizeCandidateUrl(getPlainText(property.title).trim());
    if (direct) return direct;
    const linked = (property.title || []).map((t) => t.href).find(Boolean);
    return normalizeCandidateUrl(linked || "");
  }
  if (property.type === "formula") {
    if (property.formula?.type === "string") return normalizeCandidateUrl(property.formula.string || "");
  }
  return "";
};

const normalizeWebsiteUrl = (value) => {
  return normalizeCandidateUrl(value);
};

const unwrapBuiltWithUrl = (value) => {
  const raw = trim(value);
  if (!raw) return raw;

  try {
    const parsed = new URL(raw);
    if (!/(\.|^)builtwith\.com$/i.test(parsed.hostname)) {
      return raw;
    }

    // BuiltWith links in this DB are often: https://builtwith.com/?https://target-site.com/
    const maybeTarget = decodeURIComponent(parsed.search.replace(/^\?/, "").trim());
    if (/^https?:\/\//i.test(maybeTarget)) {
      return maybeTarget;
    }

    return raw;
  } catch {
    return raw;
  }
};

const readTags = (property) => {
  if (!property) return [];
  if (property.type === "multi_select") {
    return property.multi_select.map((tag) => tag.name).filter(Boolean);
  }

  if (property.type === "select" && property.select?.name) {
    return [property.select.name];
  }

  if (property.type === "rich_text") {
    return getPlainText(property.rich_text)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  return [];
};

const readCategory = (property) => {
  if (!property) return "";
  if (property.type === "select") return property.select?.name || "";
  if (property.type === "multi_select") return property.multi_select?.[0]?.name || "";
  if (property.type === "rich_text") return trim(getPlainText(property.rich_text).split(",")[0] || "");
  return "";
};

const readNotes = (property) => {
  if (!property) return "";
  if (property.type === "rich_text") return getPlainText(property.rich_text);
  if (property.type === "title") return getPlainText(property.title);
  if (property.type === "formula" && property.formula?.type === "string") {
    return property.formula.string || "";
  }
  return "";
};

const firstPropertyByType = (props, acceptedTypes = []) => {
  const values = Object.values(props || {});
  return values.find((property) => acceptedTypes.includes(property?.type));
};

const findProperty = (props, preferredName, options = {}) => {
  const acceptedTypes = options.acceptedTypes || [];
  const preferredNames = (options.preferredNames || []).map(normalize);
  const entries = Object.entries(props || {});
  const byName = new Map(entries.map(([name, value]) => [normalize(name), value]));

  if (preferredName && byName.has(normalize(preferredName))) {
    return byName.get(normalize(preferredName));
  }

  for (const name of preferredNames) {
    if (byName.has(name)) return byName.get(name);
  }

  const byType = firstPropertyByType(props, acceptedTypes);
  if (byType) return byType;

  return undefined;
};

const findUrlFromAnyProperty = (props) => {
  for (const property of Object.values(props || {})) {
    const candidate = readUrl(property);
    if (candidate) return candidate;
  }
  return "";
};

export async function fetchShopsFromNotion(config) {
  const { notionApiKey, databaseId, propertyMap } = config;

  if (!notionApiKey) {
    throw new Error("NOTION_API_KEY is missing.");
  }

  if (!databaseId) {
    throw new Error("NOTION_DATABASE_ID is missing.");
  }

  const notion = new Client({ auth: notionApiKey });

  const results = [];
  let cursor = undefined;

  do {
    const page = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
      sorts: [
        {
          timestamp: "last_edited_time",
          direction: "descending"
        }
      ]
    });

    results.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);

  const pageRows = results.filter((row) => row.object === "page");

  const items = pageRows
    .map((row) => {
      const props = row.properties || {};
      const titleProp = findProperty(props, propertyMap.name, {
        acceptedTypes: ["title", "rich_text"],
        preferredNames: ["name", "title", "shop", "store"]
      });
      const urlProp = findProperty(props, propertyMap.url, {
        acceptedTypes: ["url", "rich_text", "formula"],
        preferredNames: ["url", "website", "link", "site", "shop url"]
      });
      const tagsProp = findProperty(props, propertyMap.tags, {
        acceptedTypes: ["multi_select", "select", "rich_text"],
        preferredNames: ["tags", "tags/categories", "tag", "topics", "labels", "keywords"]
      });
      const categoryProp = findProperty(props, propertyMap.category, {
        acceptedTypes: ["select", "multi_select", "rich_text"],
        preferredNames: ["category/type", "category", "type", "categories"]
      });
      const notesProp = findProperty(props, propertyMap.notes, {
        acceptedTypes: ["rich_text", "title", "formula"],
        preferredNames: ["description/notes/summary", "description", "notes", "summary", "blurb"]
      });

      const explicitUrl = readUrl(urlProp);
      const fallbackUrl = explicitUrl ? "" : findUrlFromAnyProperty(props);
      const url = unwrapBuiltWithUrl(normalizeWebsiteUrl(explicitUrl || fallbackUrl));
      const parsedHost = (() => {
        try {
          return new URL(url).hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      })();
      const title = trim(readTitle(titleProp)) || parsedHost || "Untitled";
      const tags = readTags(tagsProp);
      const category = readCategory(categoryProp);
      const notes = readNotes(notesProp);

      return {
        id: row.id,
        title,
        url,
        category,
        tags,
        notes,
        editedAt: row.last_edited_time
      };
    })
    .filter((item) => item.url);

  return {
    items,
    totalRows: pageRows.length,
    shopsWithUrl: items.length
  };
}
