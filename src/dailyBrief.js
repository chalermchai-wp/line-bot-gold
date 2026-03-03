// src/dailyBrief.js
import "dotenv/config";
import { listUserIds } from "./db.js";
import { pushText } from "./line.js";
import { fetchHSHGoldBar965 } from "./fetchGoldGTA.js";
import { fetchTradingViewQuotes } from "./services/tradingview.js";
import { fetchRssItems } from "./services/rss.js";
import { TH_TZ } from "./marketHours.js";

function fmt(n, digits = 2) {
  if (n == null || !Number.isFinite(Number(n))) return "-";
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: digits }).format(Number(n));
}

function nowTH() {
  // ISO-ish string in Thailand time for display
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TH_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function buildOutlook({ xau, dxy, us10y, usdthb, spx }) {
  // Simple scoring model (rule-based)
  let score = 0;
  const reasons = [];

  const dxyUp = (dxy?.changePct ?? 0) > 0;
  const yUp = (us10y?.changePct ?? 0) > 0;
  const spxDown = (spx?.changePct ?? 0) < 0;
  const thbWeak = (usdthb?.changePct ?? 0) > 0;

  if (dxyUp) { score -= 1; reasons.push("DXY แข็ง"); } else reasons.push("DXY อ่อน/ทรงตัว");
  if (yUp) { score -= 1; reasons.push("US10Y ขึ้น"); } else reasons.push("US10Y ลง/ทรงตัว");
  if (spxDown) { score += 0.5; reasons.push("หุ้นอ่อนตัว (risk-off)"); } else reasons.push("หุ้นทรง/บวก");
  if (thbWeak) reasons.push("บาทอ่อน (หนุนทองไทย)");

  const bias =
    score <= -1.5 ? "Bearish" :
    score >= 0.5 ? "Bullish" :
    "Neutral";

  // crude zones using intraday high/low if available
  const support = xau?.low != null ? fmt(xau.low) : "-";
  const resistance = xau?.high != null ? fmt(xau.high) : "-";

  return { bias, reasons: reasons.join(", "), support, resistance };
}

export async function runDailyBrief() {
  const userIds = await listUserIds();
  if (!userIds.length) return;

  // 1) Thai gold (HSH 96.5%)
  const thai = await fetchHSHGoldBar965(); // {buy,sell,fetchedAt}

  // 2) Global market snapshot via TradingView
  // You can override tickers via env if you want different exchanges/symbols.
  // Default tickers are common on TradingView.
  const tickers = {
    XAUUSD: process.env.TV_XAUUSD || "OANDA:XAUUSD",
    DXY: process.env.TV_DXY || "TVC:DXY",
    US10Y: process.env.TV_US10Y || "TVC:US10Y",
    USDTHB: process.env.TV_USDTHB || "FX_IDC:USDTHB",
    SPX: process.env.TV_SPX || "SP:SPX",
  };

  const quotes = await fetchTradingViewQuotes(Object.values(tickers));
  const xau = quotes[tickers.XAUUSD];
  const dxy = quotes[tickers.DXY];
  const us10y = quotes[tickers.US10Y];
  const usdthb = quotes[tickers.USDTHB];
  const spx = quotes[tickers.SPX];

  // 3) News (RSS list, multi-source)
  const rssList = (process.env.NEWS_RSS_URLS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const news = [];
  for (const url of rssList) {
    try {
      const items = await fetchRssItems(url, 3);
      for (const it of items) news.push(it);
    } catch {
      // ignore a broken feed
    }
  }

  const outlook = buildOutlook({ xau, dxy, us10y, usdthb, spx });

  const lines = [];
  lines.push(`🌅 Daily Gold Brief (TH ${nowTH()})`);
  lines.push("");
  lines.push(`🇹🇭 ทองไทย 96.5% (HSH)`);
  lines.push(`รับซื้อ: ${fmt(thai.buy, 0)} | ขายออก: ${fmt(thai.sell, 0)}`);
  lines.push("");
  lines.push("🌎 ตลาดต่างประเทศ (TradingView)");
  lines.push(`XAUUSD: ${fmt(xau?.price)} (${fmt(xau?.changePct)}%)`);
  lines.push(`DXY: ${fmt(dxy?.price)} (${fmt(dxy?.changePct)}%)`);
  lines.push(`US10Y: ${fmt(us10y?.price, 3)} (${fmt(us10y?.changePct)}%)`);
  lines.push(`USDTHB: ${fmt(usdthb?.price, 3)} (${fmt(usdthb?.changePct)}%)`);
  lines.push(`SPX: ${fmt(spx?.price)} (${fmt(spx?.changePct)}%)`);
  lines.push("");
  lines.push(`📌 Outlook วันนี้: ${outlook.bias}`);
  lines.push(`เหตุผล: ${outlook.reasons}`);
  if (outlook.support !== "-" || outlook.resistance !== "-") {
    lines.push(`โซน XAUUSD: แนวรับ ${outlook.support} | แนวต้าน ${outlook.resistance}`);
  }

  const topNews = news.slice(0, 5);
  if (topNews.length) {
    lines.push("");
    lines.push("🗞 ข่าวที่อาจกระทบทอง:");
    topNews.forEach((n, i) => {
      // Keep message short for LINE
      lines.push(`${i + 1}) ${n.title}`);
    });
  } else {
    lines.push("");
    lines.push("🗞 ข่าว: (ยังไม่ได้ตั้งค่า NEWS_RSS_URLS)");
  }

  const msg = lines.join("\n");
  await Promise.all(userIds.map(uid => pushText(uid, msg)));
}
