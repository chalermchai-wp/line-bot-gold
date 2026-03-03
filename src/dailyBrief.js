import "dotenv/config";
import { listUserIds } from "./db.js";
import { pushText } from "./line.js";
import { fetchHSHGoldBar965 } from "./fetchGoldGTA.js";
import { ema, rsi } from "./indicators.js";
import { tvScan, tvHistory } from "./services/tradingview.js";
import { fetchRssTopItems } from "./services/rss.js";

function fmt(n, digits = 2) {
  if (!Number.isFinite(n)) return "-";
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: digits }).format(n);
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function scoreToSignal(score100) {
  const bull = Number(process.env.SCORE_BULL_THRESHOLD ?? 60);
  const bear = Number(process.env.SCORE_BEAR_THRESHOLD ?? 40);
  if (score100 >= bull) return "Bullish";
  if (score100 <= bear) return "Bearish";
  return "Neutral";
}

function normalizeScoreTo100(rawScore) {
  // Default range designed for our scoring weights in buildScoreParts()
  const min = Number(process.env.SCORE_MIN ?? -4);
  const max = Number(process.env.SCORE_MAX ?? 4);
  if (!Number.isFinite(rawScore) || !Number.isFinite(min) || !Number.isFinite(max) || max === min) return 50;
  const n = (rawScore - min) / (max - min);
  return Math.round(clamp(n * 100, 0, 100));
}

function buildScoreParts(ctx) {
  const parts = [];
  let score = 0;

  // Core macro drivers
  if (ctx.dxy.changePct > 0) { score -= 1; parts.push("DXY↑ กดทอง"); }
  else if (ctx.dxy.changePct < 0) { score += 1; parts.push("DXY↓ หนุนทอง"); }

  if (ctx.us10y.changePct > 0) { score -= 1; parts.push("US10Y↑ กดทอง"); }
  else if (ctx.us10y.changePct < 0) { score += 0.5; parts.push("US10Y↓ หนุนทอง"); }

  if (ctx.spx.changePct < 0) { score += 0.5; parts.push("หุ้นอ่อนตัว (risk-off)"); }
  else if (ctx.spx.changePct > 0) { score -= 0.2; parts.push("หุ้นบวก (risk-on)"); }

  // Directional confirmation from XAUUSD 1D change
  if (ctx.xau.changePct > 0) { score += 0.8; parts.push("ทองโลกบวก"); }
  else if (ctx.xau.changePct < 0) { score -= 0.8; parts.push("ทองโลกติดลบ"); }

  // Thai gold bias from USDTHB (for local pricing)
  if (ctx.usdthb.changePct > 0) { score += 0.3; parts.push("บาทอ่อน (หนุนทองไทย)"); }
  else if (ctx.usdthb.changePct < 0) { score -= 0.3; parts.push("บาทแข็ง (กดทองไทย)"); }

  // Technicals (if available)
  if (Number.isFinite(ctx.rsi14)) {
    if (ctx.rsi14 <= 30) { score += 1.0; parts.push(`RSI(${fmt(ctx.rsi14,0)}) oversold`); }
    else if (ctx.rsi14 >= 70) { score -= 1.0; parts.push(`RSI(${fmt(ctx.rsi14,0)}) overbought`); }
  }

  if (Number.isFinite(ctx.ema20) && Number.isFinite(ctx.xau.close)) {
    if (ctx.xau.close > ctx.ema20) { score += 0.5; parts.push("เหนือ EMA20"); }
    else { score -= 0.5; parts.push("ต่ำกว่า EMA20"); }
  }
  if (Number.isFinite(ctx.ema50) && Number.isFinite(ctx.xau.close)) {
    if (ctx.xau.close > ctx.ema50) { score += 0.3; parts.push("เหนือ EMA50"); }
    else { score -= 0.3; parts.push("ต่ำกว่า EMA50"); }
  }

  score = Math.round(score * 10) / 10;
  return { score, parts };
}

export async function runDailyBrief(nowThaiStr = "") {
  // 1) Thai gold price
  const thai = await fetchHSHGoldBar965();
  const buy = thai?.buyPrice ?? null;
  const sell = thai?.sellPrice ?? null;

  // 2) TradingView quotes (symbols configurable)
  const SYM_XAU = process.env.TV_XAUUSD || "OANDA:XAUUSD";
  const SYM_DXY = process.env.TV_DXY || "TVC:DXY";
  const SYM_US10Y = process.env.TV_US10Y || "TVC:US10Y";
  const SYM_USDTHB = process.env.TV_USDTHB || "FX_IDC:USDTHB";
  const SYM_SPX = process.env.TV_SPX || "SP:SPX";

  const [xau, dxy, us10y, usdthb, spx] = await Promise.all([
    tvScan("XAUUSD"),
    tvScan("DXY"),
    tvScan("US10Y"),
    tvScan("USDTHB"),
    tvScan("SPX")
  ]);

  // 3) Try compute EMA/RSI from last ~120 daily closes
  let ema20 = null, ema50 = null, rsi14 = null;
  let support = null, resistance = null;

  try {
    const nowSec = Math.floor(Date.now() / 1000);
    // const fromSec = nowSec - 200 * 24 * 3600; // ~200 days back
    const hist = await tvHistory(SYM_XAU, "D", 200);
    // const hist = await tvHistory(SYM_XAU, "D", fromSec, nowSec);
    const closes = (hist.c || []).map(Number).filter(Number.isFinite);
    const highs = (hist.h || []).map(Number).filter(Number.isFinite);
    const lows = (hist.l || []).map(Number).filter(Number.isFinite);

    ema20 = ema(closes, 20);
    ema50 = ema(closes, 50);
    rsi14 = rsi(closes, 14);

    // Use latest daily candle high/low as R/S (fallback to scan high/low)
    if (highs.length) resistance = highs[highs.length - 1];
    if (lows.length) support = lows[lows.length - 1];
  } catch (e) {
    // fallback to scan values (may be last bar high/low)
    support = Number.isFinite(xau.low) ? xau.low : null;
    resistance = Number.isFinite(xau.high) ? xau.high : null;
  }

  const ctx = { xau, dxy, us10y, usdthb, spx, ema20, ema50, rsi14, support, resistance };
  const { score: rawScore, parts } = buildScoreParts(ctx);
  const score100 = normalizeScoreTo100(rawScore);
  const signal = scoreToSignal(score100);

  // 4) News
  const news = await fetchRssTopItems(2);

  const lines = [];
  lines.push(`🌅 Gold Brief 06:00 (TH) ${nowThaiStr || ""}`.trim());
  lines.push(`สัญญาณ: ${signal} | คะแนน: ${score100}/100`);
  lines.push("");
  lines.push(`🇹🇭 ทองไทย 96.5%: รับซื้อ ${buy ? fmt(buy,0) : "-"} | ขายออก ${sell ? fmt(sell,0) : "-"}`);
  lines.push(`🌍 XAUUSD: ${fmt(xau.close,2)} (${fmt(xau.changePct,2)}%)`);
  lines.push(`💵 DXY: ${fmt(dxy.close,2)} (${fmt(dxy.changePct,2)}%) | 🏦 US10Y: ${fmt(us10y.close,3)} (${fmt(us10y.changePct,2)}%)`);
  lines.push(`💱 USDTHB: ${fmt(usdthb.close,3)} (${fmt(usdthb.changePct,2)}%) | 📈 SPX: ${fmt(spx.close,2)} (${fmt(spx.changePct,2)}%)`);
  lines.push("");

  lines.push(`🧭 แนวรับ/แนวต้าน (D1): S ${support ? fmt(support,2) : "-"} | R ${resistance ? fmt(resistance,2) : "-"}`);
  lines.push(`📊 EMA20: ${ema20 ? fmt(ema20,2) : "-"} | EMA50: ${ema50 ? fmt(ema50,2) : "-"} | RSI14: ${Number.isFinite(rsi14) ? fmt(rsi14,0) : "-"}`);
  lines.push("");
  lines.push(`เหตุผลหลัก: ${parts.slice(0, 5).join(" • ")}`);

  if (!process.env.NEWS_RSS_URLS) {
    lines.push("");
    lines.push("🗞 ข่าว: (ยังไม่ได้ตั้งค่า NEWS_RSS_URLS)");
  } else if (news.length) {
    lines.push("");
    lines.push("🗞 ข่าวที่น่ามีผล:");
    for (const it of news.slice(0, 3)) {
      lines.push(`- ${it.title}`);
    }
  }

  const msg = lines.join("\n");

  const userIds = await listUserIds();
  for (const uid of userIds) {
    try { await pushText(uid, msg); } catch (e) { /* ignore */ }
  }
}
