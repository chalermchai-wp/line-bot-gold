import { BAHT_GOLD_GRAMS, getPortfolio, savePortfolio, insertTrade } from "./db.js";
import { runDailyBrief } from "./dailyBrief.js";
import { thaiNow } from "./marketHours.js";


function parseQty(qtyStr) {
  const s = String(qtyStr).trim().toLowerCase();
  if (s.endsWith("g")) return { grams: Number(s.slice(0, -1)), amountTHB: null };
  return { grams: null, amountTHB: Number(s) };
}

function toNumber(x) {
  const n = Number(String(x ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
}

function ensureFinite(n, label) {
  if (!Number.isFinite(n)) throw new Error(`Invalid ${label}: ${n}`);
  return n;
}

export async function handleCommand(text, currentSellPerBaht) {
    const t = String(text || "").trim();
    if (!t) return null;
  
    const parts = t.split(/\s+/);
    const cmd = (parts[0] || "").toLowerCase();
  
    if (cmd === "status") return await buildStatus(currentSellPerBaht);
    if (cmd === "new" || cmd === "news") {
      const now = thaiNow();
      return await runDailyBrief(now.format("DD/MM/YYYY"));
    }
    if (cmd !== "buy" && cmd !== "sell") return null;
  
    const pricePerBaht = toNumber(parts[1]);
    const qtyRaw = parts[2];                 // ✅ FIX
    const qtyToken = String(qtyRaw ?? "").trim().toLowerCase();
  
    if (!Number.isFinite(pricePerBaht) || pricePerBaht <= 0) {
      return "รูปแบบไม่ถูกต้อง\nตัวอย่าง:\nbuy 77500 10000\nbuy 77500 5g\nsell 78900 5000\nsell 78900 2g\nsell 78900 all\nstatus";
    }
  
    const pricePerGram = pricePerBaht / BAHT_GOLD_GRAMS;
    if (!Number.isFinite(pricePerGram) || pricePerGram <= 0) {
      return "❌ ราคาไม่ถูกต้อง (คำนวณราคา/กรัมไม่ได้)";
    }
  
    // ✅ qty validation (buy ต้องมีเสมอ, sell ต้องมีเสมอรวมถึง all)
    if (cmd === "buy" && !qtyRaw) {
      return "รูปแบบไม่ถูกต้อง\nตัวอย่าง:\nbuy 77500 10000\nbuy 77500 5g\nstatus";
    }
    if (cmd === "sell" && !qtyRaw) {
      return "รูปแบบไม่ถูกต้อง\nตัวอย่าง:\nsell 78900 5000\nsell 78900 2g\nsell 78900 all\nstatus";
    }
  
    const portfolio = await getPortfolio();
    const oldGrams = Number(portfolio.grams);
    const oldAvg = Number(portfolio.avg_cost_per_gram);
    const oldRealized = Number(portfolio.realized_pnl);
  
    if (!Number.isFinite(oldGrams) || !Number.isFinite(oldAvg) || !Number.isFinite(oldRealized)) {
      return "❌ อ่านพอร์ตจาก DB ไม่สำเร็จ (ค่าไม่ถูกต้อง)";
    }
  
    // ✅ SELL ALL ต้องเช็คก่อน parseQty
    if (cmd === "sell" && qtyToken === "all") {
      if (oldGrams <= 0) return "❌ ไม่มีทองให้ขาย (ถือ 0 g)";
  
      const tradeGrams = oldGrams;
      const tradeAmount = tradeGrams * pricePerGram;
  
      const realizedThis = (pricePerGram - oldAvg) * tradeGrams;
      const newRealized = oldRealized + realizedThis;
  
      ensureFinite(tradeGrams, "tradeGrams");
      ensureFinite(tradeAmount, "tradeAmount");
      ensureFinite(newRealized, "newRealized");
  
      await savePortfolio({ grams: 0, avg_cost_per_gram: 0, realized_pnl: newRealized });
      await insertTrade({ side: "SELL", pricePerBaht, pricePerGram, amountTHB: tradeAmount, grams: tradeGrams });
  
      return await buildStatus(
        currentSellPerBaht,
        `✅ SELL ALL บันทึกแล้ว: ${tradeGrams.toFixed(4)}g @ ${formatTHB(pricePerBaht)}\nRealized รอบนี้: ${formatTHB(realizedThis)} บาท`
      );
    }
  
    // ปกติ: buy/sell ด้วย qty เป็นเงินหรือกรัม
    const { grams, amountTHB } = parseQty(qtyRaw);
    let tradeGrams = grams;
    let tradeAmount = amountTHB;
  
    if (tradeGrams == null) {
      if (!Number.isFinite(tradeAmount) || tradeAmount <= 0) return "จำนวนเงินต้องมากกว่า 0";
      tradeGrams = tradeAmount / pricePerGram;
    } else {
      if (!Number.isFinite(tradeGrams) || tradeGrams <= 0) return "จำนวนกรัมต้องมากกว่า 0";
      tradeAmount = tradeGrams * pricePerGram;
    }
  
    if (!Number.isFinite(tradeGrams) || tradeGrams <= 0) return "❌ จำนวนซื้อ/ขายไม่ถูกต้อง";
    if (!Number.isFinite(tradeAmount) || tradeAmount <= 0) return "❌ มูลค่าซื้อ/ขายไม่ถูกต้อง";
  
    if (cmd === "buy") {
      const newGrams = oldGrams + tradeGrams;
      const newAvg = newGrams === 0 ? 0 : (oldAvg * oldGrams + pricePerGram * tradeGrams) / newGrams;
  
      ensureFinite(newGrams, "newGrams");
      ensureFinite(newAvg, "newAvg");
      ensureFinite(oldRealized, "oldRealized");
  
      await savePortfolio({ grams: newGrams, avg_cost_per_gram: newAvg, realized_pnl: oldRealized });
      await insertTrade({ side: "BUY", pricePerBaht, pricePerGram, amountTHB: tradeAmount, grams: tradeGrams });
  
      return await buildStatus(
        currentSellPerBaht,
        `✅ BUY บันทึกแล้ว: ~${formatTHB(tradeAmount)} บาท ได้ ${tradeGrams.toFixed(4)}g @ ${formatTHB(pricePerBaht, 0)}`
      );
    }
  
    // SELL (บางส่วน)
    if (tradeGrams > oldGrams) {
      return `❌ SELL ไม่ได้: คุณมี ${oldGrams.toFixed(4)}g แต่จะขาย ${tradeGrams.toFixed(4)}g`;
    }
  
    const realizedThis = (pricePerGram - oldAvg) * tradeGrams;
    const newRealized = oldRealized + realizedThis;
    const newGrams = oldGrams - tradeGrams;
    const newAvg = newGrams === 0 ? 0 : oldAvg;
  
    ensureFinite(newGrams, "newGrams");
    ensureFinite(newAvg, "newAvg");
    ensureFinite(newRealized, "newRealized");
  
    await savePortfolio({ grams: newGrams, avg_cost_per_gram: newAvg, realized_pnl: newRealized });
    await insertTrade({ side: "SELL", pricePerBaht, pricePerGram, amountTHB: tradeAmount, grams: tradeGrams });
  
    return await buildStatus(
      currentSellPerBaht,
      `✅ SELL บันทึกแล้ว: ${tradeGrams.toFixed(4)}g @ ${formatTHB(pricePerBaht, 0)}\nRealized รอบนี้: ${formatTHB(realizedThis)} บาท`
    );
  }

export async function buildStatus(currentSellPerBaht, headerNote = "") {
  const p = await getPortfolio(); // ✅ await
  const grams = Number(p.grams);
  const avg = Number(p.avg_cost_per_gram);
  const realized = Number(p.realized_pnl);

  if (!Number.isFinite(currentSellPerBaht) || currentSellPerBaht <= 0) {
    return "❌ ราคาปัจจุบันไม่ถูกต้อง";
  }

  const sellPerGram = currentSellPerBaht / BAHT_GOLD_GRAMS;
  const unrealized = (sellPerGram - avg) * grams;
  const total = realized + unrealized;

  const avgPerBahtGold = avg * BAHT_GOLD_GRAMS;

  const lines = [];
  if (headerNote) lines.push(headerNote);

  lines.push("📌 Portfolio");
  lines.push(`ถือ: ${grams.toFixed(4)} g`);
  lines.push(`ต้นทุนเฉลี่ย: ${formatTHB(avgPerBahtGold)} บาท/บาททอง (≈ ${formatTHB(avg)} บาท/กรัม)`);
  lines.push("");
  lines.push("💰 PnL");
  lines.push(`Realized: ${formatTHB(realized)} บาท`);
  lines.push(`Unrealized: ${formatTHB(unrealized)} บาท (อิงราคารับซื้อ ${formatTHB(currentSellPerBaht)})`);
  lines.push(`Total: ${formatTHB(total)} บาท`);

  return lines.join("\n");
}

function formatTHB(n, digits = 2) {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  }