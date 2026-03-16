import axios from "axios";
import { XMLParser } from "fast-xml-parser";

function toNumber(v) {
  return Number(String(v ?? "").replace(/,/g, "").trim());
}

function pickFromJsonArray(arr) {
  // prefer: GoldType=HSH, GoldCode=96.50
  const norm = (s) => String(s ?? "").trim().toUpperCase();
  const candidates = arr.filter(x => String(x?.GoldCode ?? "").trim() === "96.50");
  const item =
    candidates.find(x => norm(x.GoldType) === "HSH") ||
    candidates.find(x => norm(x.GoldType) === "REF") ||
    candidates.find(x => norm(x.GoldType) !== "JEWEL") ||
    candidates[0];

  if (!item) throw new Error("Cannot find GoldCode=96.50 in HSH JSON response");

  const buy = toNumber(item.Buy);
  const sell = toNumber(item.Sell);
  const fetchedAt = item.TimeUpdate ? new Date(item.TimeUpdate).toISOString() : new Date().toISOString();

  if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy <= 0 || sell <= 0) {
    throw new Error("HSH JSON matched but Buy/Sell invalid");
  }

  return { buy, sell, fetchedAt, source: "HSH", raw: { GoldType: item.GoldType, GoldCode: item.GoldCode } };
}

function pickFromXmlText(xmlText) {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true });
  const obj = parser.parse(xmlText);

  // path ปกติของ HSH XML
  const list = obj?.ArrayOfGoldPriceStruct?.GoldPriceStruct;
  const arr = Array.isArray(list) ? list : list ? [list] : [];
  if (!arr.length) throw new Error("HSH XML parsed but no GoldPriceStruct found");

  // map ให้มี shape คล้าย JSON
  const mapped = arr.map(x => ({
    GoldType: x.GoldType,
    GoldCode: x.GoldCode,
    Buy: x.Buy,
    Sell: x.Sell,
    TimeUpdate: x.TimeUpdate
  }));

  return pickFromJsonArray(mapped);
}

export async function fetchHSHGoldBar965() {
  const URL = "https://apicheckpricev3.huasengheng.com/api/Values/GetPrice";

  const res = await axios.get(URL, {
    timeout: 15000,
    responseType: "text",          // ✅ เอาเป็น text ก่อน จะได้ตรวจเอง
    validateStatus: () => true,    // ✅ ไม่ throw เพื่อ debug ได้
    headers: {
      Accept: "application/json, text/xml;q=0.9, */*;q=0.8",
      "User-Agent": "gold-bot/1.0"
    }
  });

  const body = typeof res.data === "string" ? res.data : String(res.data ?? "");
  const ct = String(res.headers?.["content-type"] ?? "");

  if (res.status !== 200) {
    throw new Error(`HSH http ${res.status} ct=${ct} head=${body.slice(0, 80)}`);
  }

  // ✅ JSON path (หลัก)
  if (ct.includes("application/json") || body.trim().startsWith("[")) {
    let arr;
    try {
      arr = JSON.parse(body);
    } catch (e) {
      throw new Error(`HSH JSON parse failed: ${e?.message || e}`);
    }
    if (!Array.isArray(arr)) throw new Error("HSH JSON is not array");
    return pickFromJsonArray(arr);
  }

  // ✅ XML fallback
  if (body.trim().startsWith("<")) {
    return pickFromXmlText(body);
  }

  throw new Error(`HSH unknown format ct=${ct} head=${body.slice(0, 120)}`);
}


export async function fetchHSHMarketStatus() {
  const URL = "https://apicheckpricev3.huasengheng.com/api/Values/GetMarketStatus";

  const res = await axios.get(URL, {
    timeout: 15000,
    responseType: "text",          // ✅ เอาเป็น text ก่อน จะได้ตรวจเอง
    validateStatus: () => true,    // ✅ ไม่ throw เพื่อ debug ได้
    headers: {
      Accept: "application/json, text/xml;q=0.9, */*;q=0.8",
      "User-Agent": "gold-bot/1.0"
    }
  });

  const body = typeof res.data === "string" ? res.data : String(res.data ?? "");
  const ct = String(res.headers?.["content-type"] ?? "");

  if (res.status !== 200) {
    throw new Error(`HSH http ${res.status} ct=${ct} head=${body.slice(0, 80)}`);
  }

  // ✅ JSON path (หลัก)
  if (ct.includes("application/json") || body.trim().startsWith("[")) {
    let arr;
    try {
      arr = JSON.parse(body);
    } catch (e) {
      throw new Error(`HSH JSON parse failed: ${e?.message || e}`);
    }
    if (!Array.isArray(arr)) throw new Error("HSH JSON is not array");
    return pickFromJsonArray(arr);
  }

  // ✅ XML fallback
  if (body.trim().startsWith("<")) {
    return pickMarketStatusFromXmlText(body);
  }

  throw new Error(`HSH unknown format ct=${ct} head=${body.slice(0, 120)}`);
}

function pickMarketStatusFromXmlText(xmlText) {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true });
  const obj = parser.parse(xmlText);

  // path ปกติของ HSH XML
  const objStatus = obj?.RMIStatusResModel?.MarketStatus;

  return objStatus;
}