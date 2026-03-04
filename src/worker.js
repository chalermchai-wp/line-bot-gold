// src/worker.js
import "dotenv/config";
import { fetchHSHGoldBar965 } from "./fetchGoldGTA.js"; // ถ้าใช้ HSH ให้เปลี่ยน import/เรียกฟังก์ชันตรงนี้
import {
  insertPrice,
  getLastTwoSells,
  listUserIds,
  getAlertState,
  setAlertState,
  BAHT_GOLD_GRAMS,
  getPortfolio
} from "./db.js";
import { pushText } from "./line.js";

function fmt(n) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(n);
}

async function calcPnL(currentSellPerBaht) {
  const p = await getPortfolio(); // ✅ await
  const grams = Number(p.grams);
  const avg = Number(p.avg_cost_per_gram);
  const realized = Number(p.realized_pnl);

  const sellPerGram = currentSellPerBaht / BAHT_GOLD_GRAMS;
  const unrealized = (sellPerGram - avg) * grams;
  const total = realized + unrealized;

  return { grams, avg, realized, unrealized, total, sellPerGram, avgPerBaht: avg * BAHT_GOLD_GRAMS };
}

async function diffAlert(currSell, prevSell) {
  const diff100 = Number(process.env.ALERT_DIFF_100 || 100);
  const diff200 = Number(process.env.ALERT_DIFF_200 || 200);

  const diff = currSell - prevSell;
  const abs = Math.abs(diff);

  const lastLevel = Number(await getAlertState("last_diff_level", "0"));
  let level = 0;
  if (abs >= diff200) level = 200;
  else if (abs >= diff100) level = 100;

  if (level === 0 && lastLevel !== 0) {
    await setAlertState("last_diff_level", "0");
    return null;
  }
  if (level > lastLevel) {
    await setAlertState("last_diff_level", String(level));
    const dir = diff > 0 ? "ขึ้น" : "ลง";
    const emoji = diff > 0 ? "📈" : "📉";
    return `${emoji} ราคา${dir} ${fmt(abs)} บาท (จาก ${fmt(prevSell)} → ${fmt(currSell)})`;
  }
  return null;
}

async function shouldSendReport({ currSell, totalPnL }) {
  const priceStep = Number(process.env.REPORT_PRICE_STEP || 100);
  const pnlStep = Number(process.env.REPORT_PNL_STEP || 500);

  const lastSell = Number(await getAlertState("last_report_sell", "0"));
  const lastPnl = Number(await getAlertState("last_report_total", "0"));

  const priceChanged = Math.abs(currSell - lastSell) >= priceStep;
  const pnlChanged = Math.abs(totalPnL - lastPnl) >= pnlStep;

  if (priceChanged || pnlChanged) {
    await setAlertState("last_report_sell", String(currSell));
    await setAlertState("last_report_total", String(totalPnL));
    return true;
  }
  return false;
}

async function milestoneAlerts(totalPnL) {
  const milestones = (process.env.PNL_MILESTONES || "10000,20000,50000")
    .split(",")
    .map(x => Number(x.trim()))
    .filter(Boolean)
    .sort((a, b) => a - b);

  const lastMilestone = Number(await getAlertState("last_pnl_milestone", "0"));
  for (const m of milestones) {
    if (totalPnL >= m && lastMilestone < m) {
      await setAlertState("last_pnl_milestone", String(m));
      return `🏁 Total PnL ทะลุ ${fmt(m)} บาท (ตอนนี้ ${fmt(totalPnL)})`;
    }
  }

  const lastSign = await getAlertState("last_pnl_sign", "unknown");
  const signNow = totalPnL >= 0 ? "pos" : "neg";
  if (lastSign !== "unknown" && lastSign !== signNow) {
    await setAlertState("last_pnl_sign", signNow);
    return signNow === "neg"
      ? `🔴 Total PnL กลับมาติดลบ (${fmt(totalPnL)})`
      : `🟢 Total PnL กลับมาเป็นบวก (${fmt(totalPnL)})`;
  }
  await setAlertState("last_pnl_sign", signNow);

  return null;
}

export async function runOnce() {
  // ✅ fetch ราคา (ตอนนี้ใช้ GTA)
  const price = await fetchHSHGoldBar965(); // { buy, sell, fetchedAt }

  await insertPrice({ ts: price.fetchedAt, buy: price.buy, sell: price.sell });

  const pnl = await calcPnL(price.buy);

  const userIds = await listUserIds();
  if (!userIds.length) return;

  const signals = [];

  // 1) diff alert ±100/±200
  const two = await getLastTwoSells();
  if (two) {
    const s = await diffAlert(two.currSell, two.prevSell);
    if (s) signals.push(s);
  }

  // 2) PnL milestone/sign alerts
  const m = await milestoneAlerts(pnl.total);
  if (m) signals.push(m);

  // 3) รายงานพอร์ต (ส่งเมื่อเปลี่ยนเยอะพอ)
  const sendReport = await shouldSendReport({ currSell: price.sell, totalPnL: pnl.total });

  if (!sendReport && signals.length === 0) return;

  const msg =
    `ราคาทองคำแท่ง 96.5%\n` +
    `รับซื้อ: ${fmt(price.buy)} | ขายออก: ${fmt(price.sell)}\n` +
    `เวลา: ${price.fetchedAt}\n\n` +
    `📌 Portfolio\n` +
    `ถือ: ${pnl.grams.toFixed(4)} g\n` +
    `ต้นทุนเฉลี่ย: ${fmt(pnl.avgPerBaht)} บาท/บาททอง\n\n` +
    `💰 PnL\n` +
    `Realized: ${fmt(pnl.realized)}\n` +
    `Unrealized: ${fmt(pnl.unrealized)}\n` +
    `Total: ${fmt(pnl.total)}\n` +
    (signals.length ? `\n🔔 Alerts\n${signals.join("\n")}` : "");

  await Promise.all(userIds.map(uid => pushText(uid, msg)));
}