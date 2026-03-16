import "dotenv/config";
import { listUserIds } from "./db.js";
import { pushText } from "./line.js";
import { fetchHSHGoldBar965, fetchHSHMarketStatus } from "./fetchGoldGTA.js";
import { tvScan } from "./services/tradingview.js";
import { fetchRssTopItems } from "./services/rss.js";
import { fetchFinnomenaThaiGoldRealtime, fetchFinnomenaTraderPresent } from "./finnomena-gold.js";

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

  if (ctx.xau.close > ctx.ema20 && ctx.ema20 > ctx.ema50) {
    score += 1;
    parts.push("trend ขาขึ้น");
  }
  
  if (ctx.xau.close < ctx.ema20 && ctx.ema20 < ctx.ema50) {
    score -= 1;
    parts.push("trend ขาลง");
  }

  score = Math.round(score * 10) / 10;
  return { score, parts };
}

function trendFromSR(price, support, resistance) {
  if (!Number.isFinite(price) || !Number.isFinite(support) || !Number.isFinite(resistance) || resistance === support) return "-";
  const pos = (price - support) / (resistance - support); // 0..1
  if (pos >= 0.7) return "แข็งแถวแนวต้าน ↗";
  if (pos <= 0.3) return "อ่อนแถวแนวรับ ↘";
  return "แกว่งกลางกรอบ ↔";
}

function smartBuyZoneNoRSI({ price, support, xauChangePct, dxyChangePct, us10yChangePct }) {
  if (!Number.isFinite(price) || !Number.isFinite(support)) return { label: "-", zone: "-" };

  const bandPctBase = 0.35; // โซนรอบแนวรับ 0.35%
  const pressure =
    (Number.isFinite(dxyChangePct) ? (dxyChangePct > 0 ? 1 : -0.5) : 0) +
    (Number.isFinite(us10yChangePct) ? (us10yChangePct > 0 ? 1 : -0.3) : 0);

  // ถ้าแรงกดสูง → ให้โซนแคบลง (รอให้ใกล้แนวรับมากขึ้น)
  const bandPct = pressure >= 1.5 ? 0.25 : bandPctBase;

  const zoneLow = support * (1 - bandPct / 100);
  const zoneHigh = support * (1 + bandPct / 100);

  const distPct = ((price - support) / support) * 100;
  const nearSupport = distPct <= bandPct;

  const mom = Number.isFinite(xauChangePct) ? xauChangePct : 0;

  // ลงแรงมาก = หลีกเลี่ยงไล่รับ
  if (mom <= -3.0) {
    return { label: "Knife falling ⚠️ (รอเด้ง)", zone: `${fmt(zoneLow,2)} - ${fmt(zoneHigh,2)}` };
  }

  if (price < support * 0.997) {
    return { label: "Breakdown ⚠️ (หลุดแนวรับ)", zone: `${fmt(zoneLow,2)} - ${fmt(zoneHigh,2)}` };
  }

  if (nearSupport) {
    return { label: "Buy Zone 🟢 (รับแถวแนวรับ)", zone: `${fmt(zoneLow,2)} - ${fmt(zoneHigh,2)}` };
  }

  return { label: "Wait ⏳", zone: `${fmt(zoneLow,2)} - ${fmt(zoneHigh,2)}` };
}

function detectLiquiditySweep(price, support, changePct) {

  if (!Number.isFinite(price) || !Number.isFinite(support))
    return null;

  const dist = (price - support) / support;

  if (dist < 0.005 && dist > 0 && changePct < -1) {
    return `⚠️ Liquidity sweep likely below ${fmt(support,0)}`;
  }

  if (price < support) {
    return `💧 Stops triggered below ${fmt(support,0)}`;
  }

  return null;
}

function detectReversal(ctx) {

  const { xau, dxy, us10y, spx, support } = ctx;

  if (!Number.isFinite(xau.close) || !Number.isFinite(support))
    return null;

  const nearSupport =
    Math.abs(xau.close - support) / support < 0.01;

  if (
    nearSupport &&
    xau.changePct > -1 &&
    dxy.changePct <= 0
  ) {
    return "🔄 Reversal potential near support";
  }

  if (
    spx.changePct < -1 &&
    dxy.changePct <= 0
  ) {
    return "🔄 Gold may bounce with risk-off";
  }

  return null;
}

function detectCrashRisk(ctx) {

  const { xau, dxy, us10y } = ctx;

  if (
    xau.changePct < -2 &&
    dxy.changePct > 0.3 &&
    us10y.changePct > 0.3
  ) {
    return "⚠️ Crash Risk High";
  }

  if (
    xau.changePct < -1 &&
    dxy.changePct > 0
  ) {
    return "⚠️ Downside Pressure";
  }

  return null;
}

function calcBuyProbability(ctx) {

  let score = 50;

  if (ctx.xau.changePct < -2)
    score += 10;

  if (ctx.xau.changePct > 1)
    score -= 10;

  if (ctx.dxy.changePct > 0)
    score -= 10;

  if (ctx.us10y.changePct > 0)
    score -= 8;

  if (ctx.spx.changePct < 0)
    score += 5;

  if (ctx.usdthb.changePct > 0)
    score += 5;

  return Math.max(5, Math.min(95, Math.round(score)));
}

function smartMoneySignal(ctx) {
  const { xau, dxy, us10y, spx, support, resistance } = ctx;

  // fallback
  if (!Number.isFinite(xau?.close) || !Number.isFinite(support) || !Number.isFinite(resistance) || resistance === support) {
    return { label: "-", note: "-" };
  }

  const price = xau.close;
  const pos = (price - support) / (resistance - support); // 0..1

  const goldDump = Number.isFinite(xau.changePct) && xau.changePct <= -2.0;
  const dollarUp = Number.isFinite(dxy.changePct) && dxy.changePct > 0.3;
  const yieldUp = Number.isFinite(us10y.changePct) && us10y.changePct > 0.3;
  const riskOff = Number.isFinite(spx.changePct) && spx.changePct < -0.5;

  // 1) Panic sell (เทขายหนัก)
  if (goldDump && (dollarUp || yieldUp)) {
    return { label: "Panic Sell 🔻", note: "ทองลงแรง + แรงกดจาก USD/ยีลด์" };
  }

  // 2) Accumulation ใกล้แนวรับ (เริ่มสะสม)
  if (pos <= 0.25 && riskOff && !dollarUp) {
    return { label: "Accumulation 🟢", note: "อ่อนใกล้แนวรับ + risk-off แต่ USD ไม่กดเพิ่ม" };
  }

  // 3) Distribution ใกล้แนวต้าน (ทยอยขาย)
  if (pos >= 0.75 && Number.isFinite(xau.changePct) && xau.changePct > 0 && (dollarUp || yieldUp)) {
    return { label: "Distribution 🟠", note: "เด้งใกล้แนวต้านแต่ USD/ยีลด์กด อาจมีขายทำกำไร" };
  }

  // 4) Range / Neutral
  if (pos > 0.25 && pos < 0.75) {
    return { label: "Range Trading ↔", note: "แกว่งในกรอบ S/R" };
  }

  return { label: "Mixed / Unclear ❔", note: "สัญญาณผสม" };
}

function autoTradingSignal(ctx) {
  const { xau, support, resistance, buyProbability, crashRisk } = ctx;

  const price = xau?.close;
  if (!Number.isFinite(price) || !Number.isFinite(support) || !Number.isFinite(resistance) || resistance === support) {
    return { action: "WAIT", reason: "ข้อมูลไม่พอ" };
  }

  const pos = (price - support) / (resistance - support); // 0..1
  const mom = Number.isFinite(xau.changePct) ? xau.changePct : 0;

  // ถ้ามี crash warning -> หลีกเลี่ยงก่อน
  if (crashRisk === "⚠️ Crash Risk High") {
    return { action: "AVOID", reason: "มีสัญญาณ Crash Risk สูง" };
  }

  // Knife falling -> หลีกเลี่ยงรับมีด
  if (mom <= -3.0) {
    return { action: "AVOID", reason: "ราคาลงแรง (knife falling) รอเด้งก่อน" };
  }

  // BUY: ใกล้แนวรับ + buyProbability สูงพอ + ไม่อยู่ใกล้แนวต้าน
  if (pos <= 0.25 && buyProbability >= 60) {
    return { action: "BUY", reason: "ใกล้แนวรับ + โอกาสรีบาวด์สูง" };
  }

  // WAIT: ใกล้แนวรับแต่ความน่าจะเป็นยังกลางๆ
  if (pos <= 0.25 && buyProbability >= 40) {
    return { action: "WAIT", reason: "ใกล้แนวรับ แต่ยังต้องรอคอนเฟิร์ม" };
  }

  // AVOID: ใกล้แนวต้านและโอกาสซื้อไม่สูง
  if (pos >= 0.75 && buyProbability < 55) {
    return { action: "AVOID", reason: "ใกล้แนวต้าน โอกาสเสี่ยงย่อ" };
  }

  return { action: "WAIT", reason: "อยู่กลางกรอบ/สัญญาณยังไม่ชัด" };
}

async function getThaiPrice() {

  const hshMarketStatus = await fetchHSHMarketStatus();

  const hshPrice = await fetchHSHGoldBar965();
  let finoPrice = null;

  try {
    finoPrice = await fetchFinnomenaThaiGoldRealtime();
    console.log("finoPrice :", finoPrice);
  } catch (e) {
    console.error("Finnomena error:", e.message);
  }

  let buyPrice = hshMarketStatus === "ON" ? hshPrice?.buyPrice : finoPrice?.thaiGoldAsk ?? null;
  let sellPrice = hshMarketStatus === "ON" ? hshPrice?.sellPrice : finoPrice?.thaiGoldBid ?? null;
  let source = hshMarketStatus === "ON" ? "HSH" : "FINNOMENA";

  return {
    source,
    buyPrice,
    sellPrice,
    hshMarketStatus
  };
}

export async function runDailyBrief(nowThaiStr = "", isFromManual = false) {
  // 1) Thai gold price
  const thai = await getThaiPrice();
  const buy = thai?.buyPrice ?? null;
  const sell = thai?.sellPrice ?? null;
  const source = thai?.source ?? null;
  const hshMarketStatus = thai.hshMarketStatus ?? null;

  const [xau, dxy, us10y, usdthb, spx] = await Promise.all([
    tvScan("XAUUSD"),
    tvScan("DXY"),
    tvScan("US10Y"),
    tvScan("USDTHB"),
    tvScan("SPX")
  ]);

  // 3) Try compute EMA/RSI from last ~120 daily closes
  let ema20 = null, ema50 = null, rsi14 = null;
  let support = Number.isFinite(xau.low) ? xau.low : null;
  let resistance = Number.isFinite(xau.high) ? xau.high : null;

  const ctx = { xau, dxy, us10y, usdthb, spx, ema20, ema50, rsi14, support, resistance };
  const { score: rawScore, parts } = buildScoreParts(ctx);
  const score100 = normalizeScoreTo100(rawScore);
  const signal = scoreToSignal(score100);

  const THAI_GOLD_FACTOR = 0.4901;
  const fair = Number.isFinite(xau.close) && Number.isFinite(usdthb.close)
    ? xau.close * usdthb.close * THAI_GOLD_FACTOR
    : null;
  
  const thaiRef = (sell ?? buy);
  const premium = (Number.isFinite(thaiRef) && Number.isFinite(fair)) ? (thaiRef - fair) : null;

  const buyInfo = smartBuyZoneNoRSI({
    price: xau.close,
    support,
    xauChangePct: xau.changePct,
    dxyChangePct: dxy.changePct,
    us10yChangePct: us10y.changePct,
  });

  const liquiditySweep = detectLiquiditySweep(
    xau.close,
    support,
    xau.changePct
  );

  const reversalSignal = detectReversal(ctx);

  const crashRisk = detectCrashRisk(ctx);

  const buyProbability = calcBuyProbability(ctx);

  const ctx2 = { ...ctx, buyProbability, crashRisk };

  const sm = smartMoneySignal(ctx2);
  const trade = autoTradingSignal(ctx2);

  // 4) News
  const news = await fetchRssTopItems(2);

  const lines = [];
  lines.push(`🌅 Gold Brief ${nowThaiStr || ""}`.trim());
  lines.push(`สัญญาณ: ${signal} | คะแนน: ${score100}/100`);
  lines.push("");
  lines.push(`🇹🇭 ทองไทย 96.5% จาก: ${source}, ตลาด: ${hshMarketStatus === "ON" ?  "เปิด" : "ปิด"}`);
  lines.push(`🇹🇭 ทองไทย 96.5%: รับซื้อ ${buy ? fmt(buy,0) : "-"} | ขายออก ${sell ? fmt(sell,0) : "-"}`);
  lines.push(`🧮 Fair Value ทองไทย: ${fair ? fmt(fair,0) : "-"} | Premium: ${premium!=null ? fmt(premium,0) : "-"}`);
  lines.push(`🌍 XAUUSD: ${fmt(xau.close,2)} (${fmt(xau.changePct,2)}%)`);
  lines.push(`💵 DXY: ${fmt(dxy.close,2)} (${fmt(dxy.changePct,2)}%) | 🏦 US10Y: ${fmt(us10y.close,3)} (${fmt(us10y.changePct,2)}%)`);
  lines.push(`💱 USDTHB: ${fmt(usdthb.close,3)} (${fmt(usdthb.changePct,2)}%) | 📈 SPX: ${fmt(spx.close,2)} (${fmt(spx.changePct,2)}%)`);
  lines.push("");

  lines.push(`🤖 Buy Probability: ${buyProbability}%`);
  if (liquiditySweep)
  lines.push(liquiditySweep);
  if (reversalSignal)
  lines.push(reversalSignal);
  if (crashRisk)
  lines.push(crashRisk);

  lines.push(`🧠 Smart Money: ${sm.label}`);
  lines.push(`   มุมมอง: ${sm.note}`);
  
  lines.push(`📌 Action: ${trade.action} | เหตุผล: ${trade.reason}`);
  lines.push("");

  const trend = trendFromSR(xau.close, support, resistance);
  lines.push(`📈 Trend: ${trend}`);
  lines.push(`🎯 Buy Zone: ${buyInfo.label}`);
  lines.push(`   โซน: ${buyInfo.zone}`);
  lines.push("");

  lines.push(`🧭 แนวรับ/แนวต้าน (D1): S ${support ? fmt(support,2) : "-"} | R ${resistance ? fmt(resistance,2) : "-"}`);
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

  if(isFromManual) {
    return msg
  }

  const userIds = await listUserIds();
  for (const uid of userIds) {
    try { await pushText(uid, msg); } catch (e) { /* ignore */ }
  }
}
