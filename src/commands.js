import { BAHT_GOLD_GRAMS, getPortfolio, savePortfolio, insertTrade } from "./db.js";

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

export async function handleCommand(text, currentSellPerBaht /* number */) {
  const t = String(text || "").trim();
  if (!t) return null;

  const parts = t.split(/\s+/);
  const cmd = (parts[0] || "").toLowerCase();

  if (cmd === "status") {
    return await buildStatus(currentSellPerBaht);
  }

  if (cmd !== "buy" && cmd !== "sell") return null;

  const pricePerBaht = toNumber(parts[1]);
  const qty = parts[2];

  if (!Number.isFinite(pricePerBaht) || pricePerBaht <= 0 || !qty) {
    return "รูปแบบไม่ถูกต้อง\nตัวอย่าง:\nbuy 77500 10000\nbuy 77500 5g\nsell 78900 5000\nsell 78900 2g\nstatus";
  }

  const pricePerGram = pricePerBaht / BAHT_GOLD_GRAMS;
  if (!Number.isFinite(pricePerGram) || pricePerGram <= 0) {
    return "❌ ราคาไม่ถูกต้อง (คำนวณราคา/กรัมไม่ได้)";
  }

  const { grams, amountTHB } = parseQty(qty);

  const portfolio = await getPortfolio(); // ✅ await
  const oldGrams = Number(portfolio.grams);
  const oldAvg = Number(portfolio.avg_cost_per_gram);
  const oldRealized = Number(portfolio.realized_pnl);

  if (!Number.isFinite(oldGrams) || !Number.isFinite(oldAvg) || !Number.isFinite(oldRealized)) {
    return "❌ อ่านพอร์ตจาก DB ไม่สำเร็จ (ค่าไม่ถูกต้อง)";
  }

  let tradeGrams = grams;
  let tradeAmount = amountTHB;

  // ระบุเป็นเงิน -> แปลงเป็นกรัม
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
    const newAvg =
      newGrams === 0 ? 0 : (oldAvg * oldGrams + pricePerGram * tradeGrams) / newGrams;

    // ✅ กัน NaN ก่อนเขียน DB
    ensureFinite(newGrams, "newGrams");
    ensureFinite(newAvg, "newAvg");
    ensureFinite(oldRealized, "oldRealized");

    await savePortfolio({ grams: newGrams, avg_cost_per_gram: newAvg, realized_pnl: oldRealized }); // ✅ await
    await insertTrade({ side: "BUY", pricePerBaht, pricePerGram, amountTHB: tradeAmount, grams: tradeGrams }); // ✅ await

    return await buildStatus(
      currentSellPerBaht,
      `✅ BUY บันทึกแล้ว: ~${tradeAmount.toFixed(2)} บาท ได้ ${tradeGrams.toFixed(4)}g @ ${pricePerBaht}`
    );
  }

  // SELL
  if (tradeGrams > oldGrams) {
    return `❌ SELL ไม่ได้: คุณมี ${oldGrams.toFixed(4)}g แต่จะขาย ${tradeGrams.toFixed(4)}g`;
  }

  const realizedThis = (pricePerGram - oldAvg) * tradeGrams;
  const newRealized = oldRealized + realizedThis;
  const newGrams = oldGrams - tradeGrams;

  // ถ้าขายหมด ให้ reset avg เป็น 0 กันค้างค่าเก่า
  const newAvg = newGrams === 0 ? 0 : oldAvg;

  ensureFinite(newGrams, "newGrams");
  ensureFinite(newAvg, "newAvg");
  ensureFinite(newRealized, "newRealized");

  await savePortfolio({ grams: newGrams, avg_cost_per_gram: newAvg, realized_pnl: newRealized }); // ✅ await
  await insertTrade({ side: "SELL", pricePerBaht, pricePerGram, amountTHB: tradeAmount, grams: tradeGrams }); // ✅ await

  return await buildStatus(
    currentSellPerBaht,
    `✅ SELL บันทึกแล้ว: ${tradeGrams.toFixed(4)}g @ ${pricePerBaht}\nRealized รอบนี้: ${realizedThis.toFixed(2)} บาท`
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
  lines.push(`ต้นทุนเฉลี่ย: ${avgPerBahtGold.toFixed(2)} บาท/บาททอง (≈ ${avg.toFixed(2)} บาท/กรัม)`);
  lines.push("");
  lines.push("💰 PnL");
  lines.push(`Realized: ${realized.toFixed(2)} บาท`);
  lines.push(`Unrealized: ${unrealized.toFixed(2)} บาท (อิงขายออก ${currentSellPerBaht})`);
  lines.push(`Total: ${total.toFixed(2)} บาท`);

  return lines.join("\n");
}