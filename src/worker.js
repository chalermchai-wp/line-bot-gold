// src/worker.js
import "dotenv/config";
import { fetchThaiGoldBar965 } from "./fetchGoldGTA.js";
import {
  insertPrice,
  getLastNCloses,
  getLastTwoSells,
  listUserIds,
  getAlertState,
  setAlertState
} from "./db.js";
import { ema, rsi } from "./indicators.js";
import { pushText } from "./line.js";

function fmt(n) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(n);
}

export async function runOnce() {
  const p = await fetchThaiGoldBar965();

  insertPrice({ ts: p.fetchedAt, buy: p.buy, sell: p.sell });

  const closes = getLastNCloses(200);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const r = rsi(closes, 14);

  const over = Number(process.env.ALERT_SELL_OVER || 80000);
  const under = Number(process.env.ALERT_SELL_UNDER || 78000);

  const signals = [];

  // ----- existing alerts -----
  if (p.sell >= over) signals.push(`🚀 แตะเป้า: ขายออก ≥ ${fmt(over)} (ตอนนี้ ${fmt(p.sell)})`);
  if (p.sell <= under) signals.push(`⚠️ หลุดแนวรับ: ขายออก ≤ ${fmt(under)} (ตอนนี้ ${fmt(p.sell)})`);

  if (e9 && e21) {
    const trend = e9 > e21 ? "ขาขึ้น" : "ขาลง/พักตัว";
    signals.push(`📈 Trend(EMA9/21): ${trend} (EMA9=${fmt(e9)} / EMA21=${fmt(e21)})`);
  }
  if (r != null) {
    const zone = r >= 70 ? "Overbought" : r <= 30 ? "Oversold" : "Neutral";
    signals.push(`📊 RSI14: ${fmt(r)} (${zone})`);
  }

  // ----- ✅ NEW: diff alerts (+/-100, +/-200) -----
  const diffCfg100 = Number(process.env.ALERT_DIFF_100 || 100);
  const diffCfg200 = Number(process.env.ALERT_DIFF_200 || 200);

  const two = getLastTwoSells();
  if (two) {
    const diff = two.currSell - two.prevSell;
    const abs = Math.abs(diff);

    // last level: "0" | "100" | "200"
    const lastLevel = Number(getAlertState("last_diff_level", "0"));

    let level = 0;
    if (abs >= diffCfg200) level = 200;
    else if (abs >= diffCfg100) level = 100;

    // กันสแปม:
    // - ส่งเมื่อ "level > lastLevel" (เช่น 0->100, 100->200)
    // - ถ้ากลับมา <100 ให้ reset เป็น 0 เพื่อรอรอบใหม่
    if (level === 0 && lastLevel !== 0) {
      setAlertState("last_diff_level", "0");
    } else if (level > lastLevel) {
      const dir = diff > 0 ? "ขึ้น" : "ลง";
      const emoji = diff > 0 ? "📈" : "📉";
      signals.unshift(
        `${emoji} เปลี่ยนจากรอบก่อน: ${dir} ${fmt(abs)} บาท (จาก ${fmt(two.prevSell)} → ${fmt(two.currSell)})`
      );
      setAlertState("last_diff_level", String(level));
    }
  }

  const msg =
    `ราคาทองคำแท่ง 96.5% (สมาคมค้าทองคำ)\n` +
    `รับซื้อ: ${fmt(p.buy)} | ขายออก: ${fmt(p.sell)}\n` +
    `เวลา: ${p.fetchedAt}\n\n` +
    signals.join("\n");

  const userIds = listUserIds();

  // ✅ ส่งเฉพาะเมื่อมีสัญญาณ
  if (userIds.length && signals.length) {
    await Promise.all(userIds.map(uid => pushText(uid, msg)));
  }

  return { ...p, e9, e21, r, signalsCount: signals.length };
}