// src/services/rss.js
import axios from "axios";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

export async function fetchRssItems(url, limit = 5) {
  const { data } = await axios.get(url, {
    timeout: 15000,
    headers: { "User-Agent": "gold-bot/1.0" },
  });

  const xml = typeof data === "string" ? data : String(data);
  const obj = parser.parse(xml);

  // RSS 2.0
  const rssItems = obj?.rss?.channel?.item;
  if (rssItems) return normalizeItems(rssItems, limit);

  // Atom
  const atomItems = obj?.feed?.entry;
  if (atomItems) return normalizeItems(atomItems, limit);

  return [];
}

function normalizeItems(items, limit) {
  const arr = Array.isArray(items) ? items : [items];
  return arr
    .filter(Boolean)
    .slice(0, limit)
    .map((it) => {
      const title = it?.title?.["#text"] ?? it?.title ?? "";
      const link =
        it?.link?.["@_href"] ??
        it?.link?.href ??
        it?.link ??
        it?.guid ??
        "";
      const pubDate = it?.pubDate ?? it?.updated ?? it?.published ?? "";
      return { title: String(title).trim(), link: String(link).trim(), pubDate: String(pubDate).trim() };
    })
    .filter((x) => x.title);
}
