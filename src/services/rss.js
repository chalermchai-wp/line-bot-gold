import Parser from "rss-parser";

const parser = new Parser();

/**
 * Reads RSS feeds and returns flattened items.
 * URLs should be provided via NEWS_RSS_URLS (comma-separated).
 */
export async function fetchRssTopItems(limitPerFeed = 3) {
  const raw = (process.env.NEWS_RSS_URLS || "").trim();
  if (!raw) return [];
  const urls = raw.split(",").map(s => s.trim()).filter(Boolean);

  const items = [];
  for (const url of urls) {
    try {
      const feed = await parser.parseURL(url);
      for (const it of (feed.items || []).slice(0, limitPerFeed)) {
        items.push({
          source: feed.title || url,
          title: it.title || "(no title)",
          link: it.link,
          pubDate: it.isoDate || it.pubDate,
        });
      }
    } catch (e) {
      items.push({ source: url, title: `RSS error: ${(e?.message || e)}`, link: undefined, pubDate: undefined });
    }
  }
  return items;
}
