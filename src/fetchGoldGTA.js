import axios from "axios";
import * as cheerio from "cheerio";

// แหล่งข้อมูล: classic.goldtraders.or.th แสดงราคาทองตามประกาศ
const URL = "https://classic.goldtraders.or.th/";

function parseNumber(str) {
  // "78,750.00" -> 78750
  return Number(String(str).replace(/,/g, "").trim());
}

export async function fetchThaiGoldBar965() {
  const { data: html } = await axios.get(URL, { timeout: 15000 });
  const $ = cheerio.load(html);

  // หน้า classic มีข้อความแนวนี้:
  // "ทองคำแท่ง 96.5%  ขายออก  78,750.00  รับซื้อ  78,550.00"
  const text = $.text().replace(/\s+/g, " ");

  const m = text.match(
    /ทองคำแท่ง\s*96\.5%.*?ขายออก\s*([0-9,]+\.[0-9]+).*?รับซื้อ\s*([0-9,]+\.[0-9]+)/i
  );

  if (!m) {
    throw new Error("Cannot parse gold bar 96.5% price from GTA classic page.");
  }

  const sell = parseNumber(m[1]);
  const buy = parseNumber(m[2]);

  // เวลาอัปเดต (ถ้าอยากแยกเพิ่มทีหลังค่อย parse)
  return {
    source: URL,
    buy,
    sell,
    fetchedAt: new Date().toISOString()
  };
}