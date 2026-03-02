import axios from "axios";

function toNumber(v) {
  // API บางทีส่งเป็น string เช่น "79,550" หรือ "79550"
  return Number(String(v).replace(/,/g, "").trim());
}

function parseNumber(str) {
  // "78,750.00" -> 78750
  return Number(String(str).replace(/,/g, "").trim());
}

export async function fetchHSHGoldBar965() {
  const URL = "https://apicheckpricev3.huasengheng.com/api/Values/GetPrice";

  const { data } = await axios.get(URL, { timeout: 15000 });

  if (!Array.isArray(data)) {
    throw new Error("Unexpected HSH API response (not array)");
  }

  // ต้อง “ดูค่าจริง” ว่า GoldType/GoldCode ของ “ทองคำแท่ง 96.5%” คืออะไร
  // ตัวอย่าง filter แบบยืดหยุ่น:
  const item =
    data.find(x => String(x.GoldType || "").includes("96.5") && String(x.GoldType || "").includes("แท่ง")) ||
    data.find(x => String(x.GoldCode || "").includes("BAR") && String(x.GoldType || "").includes("96.5")) ||
    data.find(x => String(x.GoldType || "").includes("96.5"));

  if (!item) {
    // แนะนำให้ log data ครั้งแรกเพื่อดูค่า GoldType/GoldCode แล้วล็อก filter ให้ชัวร์
    throw new Error("Cannot find 96.5 gold bar item in HSH response");
  }

  return {
    buy: toNumber(item.Buy),
    sell: toNumber(item.Sell),
    fetchedAt: item.TimeUpdate ? new Date(item.TimeUpdate).toISOString() : new Date().toISOString(),
    raw: { GoldType: item.GoldType, GoldCode: item.GoldCode, StrTimeUpdate: item.StrTimeUpdate }
  };
}


// import axios from "axios";
// import * as cheerio from "cheerio";

// // แหล่งข้อมูล: classic.goldtraders.or.th แสดงราคาทองตามประกาศ

export async function fetchThaiGoldBar965() {
  const URL = "https://classic.goldtraders.or.th/";

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