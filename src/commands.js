import { BAHT_GOLD_GRAMS, getPortfolio, savePortfolio, insertTrade } from "./db.js";

function parseQty(qtyStr) {
  // "5g" => { grams:5, amountTHB:0 }
  // "10000" => { grams:null, amountTHB:10000 }
  const s = String(qtyStr).trim().toLowerCase();
  if (s.endsWith("g")) {
    return { grams: Number(s.slice(0, -1)), amountTHB: 0 };
  }
  return { grams: null, amountTHB: Number(s) };
}

function toNumber(x) {
  return Number(String(x).replace(/,/g, "").trim());
}

export function handleCommand(text, currentSellPerBaht /* number */) {
  const t = String(text || "").trim();
  if (!t) return null;

  const parts = t.split(/\s+/);
  const cmd = (parts[0] || "").toLowerCase();

  if (cmd === "status") {
    return buildStatus(currentSellPerBaht);
  }

  if (cmd !== "buy" && cmd !== "sell") return null;

  const pricePerBaht = toNumber(parts[1]);
  const qty = parts[2];

  if (!pricePerBaht || !qty) {
    return "รูปแบบไม่ถูกต้อง\nตัวอย่าง:\nbuy 77500 10000\nbuy 77500 5g\nsell 78900 5000\nsell 78900 2g\nstatus";
  }

  const pricePerGram = pricePerBaht / BAHT_GOLD_GRAMS;
  const { grams, amountTHB } = parseQty(qty);

  const portfolio = getPortfolio();
  const oldGrams = Number(portfolio.grams);
  const oldAvg = Number(portfolio.avg_cost_per_gram);
  const oldRealized = Number(portfolio.realized_pnl);

  let tradeGrams = grams;
  let tradeAmount = amountTHB;

  // ถ้าระบุเป็นเงิน -> แปลงเป็นกรัม
  if (tradeGrams == null) {
    if (!tradeAmount || tradeAmount <= 0) return "จำนวนเงินต้องมากกว่า 0";
    tradeGrams = tradeAmount / pricePerGram;
  } else {
    if (!tradeGrams || tradeGrams <= 0) return "จำนวนกรัมต้องมากกว่า 0";
    // ถ้าระบุเป็นกรัม -> คำนวณเงินคร่าว ๆ
    tradeAmount = tradeGrams * pricePerGram;
  }

  if (cmd === "buy") {
    const newGrams = oldGrams + tradeGrams;
    const newAvg =
      newGrams === 0 ? 0 : (oldAvg * oldGrams + pricePerGram * tradeGrams) / newGrams;

    savePortfolio({ grams: newGrams, avg_cost_per_gram: newAvg, realized_pnl: oldRealized });
    insertTrade({ side: "BUY", pricePerBaht, pricePerGram, amountTHB: tradeAmount, grams: tradeGrams });

    return buildStatus(currentSellPerBaht, `✅ BUY บันทึกแล้ว: ~${tradeAmount.toFixed(2)} บาท ได้ ${tradeGrams.toFixed(4)}g @ ${pricePerBaht}`);
  }

  // SELL
  if (tradeGrams > oldGrams) {
    return `❌ SELL ไม่ได้: คุณมี ${oldGrams.toFixed(4)}g แต่จะขาย ${tradeGrams.toFixed(4)}g`;
  }

  const realizedThis = (pricePerGram - oldAvg) * tradeGrams;
  const newRealized = oldRealized + realizedThis;
  const newGrams = oldGrams - tradeGrams;

  savePortfolio({ grams: newGrams, avg_cost_per_gram: oldAvg, realized_pnl: newRealized });
  insertTrade({ side: "SELL", pricePerBaht, pricePerGram, amountTHB: tradeAmount, grams: tradeGrams });

  return buildStatus(
    currentSellPerBaht,
    `✅ SELL บันทึกแล้ว: ${tradeGrams.toFixed(4)}g @ ${pricePerBaht}\nRealized รอบนี้: ${realizedThis.toFixed(2)} บาท`
  );
}

export function buildStatus(currentSellPerBaht, headerNote = "") {
  const p = getPortfolio();
  const grams = Number(p.grams);
  const avg = Number(p.avg_cost_per_gram);
  const realized = Number(p.realized_pnl);

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