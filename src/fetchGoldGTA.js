import axios from "axios";
import { XMLParser } from "fast-xml-parser";

function toNumber(v) {
  return Number(String(v ?? "").replace(/,/g, "").trim());
}

// หา key ใน object แบบ recursive
function findAllByKey(obj, targetKey, out = []) {
  if (!obj || typeof obj !== "object") return out;

  if (Object.prototype.hasOwnProperty.call(obj, targetKey)) {
    out.push(obj[targetKey]);
  }

  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === "object") findAllByKey(v, targetKey, out);
  }
  return out;
}

export async function fetchHSHGoldBar965() {
  const URL = "https://apicheckpricev3.huasengheng.com/api/Values/GetPrice";

  const res = await axios.get(URL, {
    timeout: 15000,
    responseType: "text",
    headers: {
      Accept: "*/*",
      "User-Agent": "gold-bot/1.0"
    }
  });

  const xml = res.data;
  if (typeof xml !== "string" || !xml.trim().startsWith("<")) {
    throw new Error("HSH response is not XML text");
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    trimValues: true
  });

  const obj = parser.parse(xml);

  // ดึง GoldPriceStruct จากที่ไหนก็ได้
  const hits = findAllByKey(obj, "GoldPriceStruct");
  if (!hits.length) {
    console.error("HSH parsed root keys:", Object.keys(obj || {}));
    throw new Error("HSH XML parsed but no GoldPriceStruct found (structure mismatch)");
  }

  // hits อาจเป็น array หรือ object หรือ array ซ้อน
  const list = hits
    .flatMap((x) => (Array.isArray(x) ? x : [x]))
    .flatMap((x) => (Array.isArray(x) ? x : [x]))
    .filter((x) => x && typeof x === "object");

  if (!list.length) {
    throw new Error("HSH XML parsed but GoldPriceStruct list empty");
  }

  // เลือก: GoldCode=96.50 และ prefer GoldType=HSH > REF และไม่เอา JEWEL
  const candidates = list.filter((x) => String(x.GoldCode ?? "").trim() === "96.50");

  const normType = (x) => String(x.GoldType ?? "").trim().toUpperCase();
  const pick =
    candidates.find((x) => normType(x) === "HSH") ||
    candidates.find((x) => normType(x) === "REF") ||
    candidates.find((x) => normType(x) !== "JEWEL") ||
    candidates[0];

  if (!pick) {
    // log ช่วยดู schema จริง
    console.error("HSH list sample:", list.slice(0, 5));
    throw new Error("Cannot find GoldCode=96.50 in HSH XML response");
  }

  const buy = toNumber(pick.Buy);
  const sell = toNumber(pick.Sell);
  const fetchedAt = pick.TimeUpdate ? new Date(pick.TimeUpdate).toISOString() : new Date().toISOString();

  if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy <= 0 || sell <= 0) {
    console.error("HSH matched but Buy/Sell invalid:", pick);
    throw new Error("HSH matched item but Buy/Sell invalid");
  }

  return {
    buy,
    sell,
    fetchedAt,
    source: "HSH",
    raw: { GoldCode: pick.GoldCode, GoldType: pick.GoldType }
  };
}