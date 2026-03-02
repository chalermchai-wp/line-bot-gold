import axios from "axios";
import { XMLParser } from "fast-xml-parser";

function toNumber(v) {
  return Number(String(v ?? "").replace(/,/g, "").trim());
}

export async function fetchHSHGoldBar965() {
  const URL = "https://apicheckpricev3.huasengheng.com/api/Values/GetPrice";

  const res = await axios.get(URL, {
    timeout: 15000,
    // บังคับรับเป็น text เพื่อ parse XML แน่นอน
    responseType: "text",
    headers: {
      Accept: "*/*",
      "User-Agent": "gold-bot/1.0"
    }
  });

  const xml = res.data;

  const parser = new XMLParser({
    ignoreAttributes: false,
    // กันเคส tag เดี่ยว/หลายตัว
    isArray: (name) => name === "GoldPriceStruct"
  });

  const obj = parser.parse(xml);

  // โครงสร้างตามตัวอย่าง:
  // obj.ArrayOfGoldPriceStruct.GoldPriceStruct = [ ... ]
  const list =
    obj?.ArrayOfGoldPriceStruct?.GoldPriceStruct ||
    obj?.["ArrayOfGoldPriceStruct"]?.["GoldPriceStruct"];

  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("HSH XML parsed but no GoldPriceStruct found");
  }

  // filter: 96.50 + prefer GoldType=HSH, fallback REF, exclude JEWEL
  const candidates = list.filter((x) => String(x.GoldCode).trim() === "96.50");

  const prefer = (type) => candidates.find((x) => String(x.GoldType).trim().toUpperCase() === type);

  const item = prefer("HSH") || prefer("REF") || candidates.find((x) => String(x.GoldType).trim().toUpperCase() !== "JEWEL");

  if (!item) {
    throw new Error("Cannot find GoldCode=96.50 in HSH XML response");
  }

  const buy = toNumber(item.Buy);
  const sell = toNumber(item.Sell);
  const fetchedAt = item.TimeUpdate ? new Date(item.TimeUpdate).toISOString() : new Date().toISOString();

  if (!Number.isFinite(buy) || !Number.isFinite(sell)) {
    throw new Error("HSH matched item but Buy/Sell invalid");
  }

  return { buy, sell, fetchedAt, source: "HSH", raw: { GoldCode: item.GoldCode, GoldType: item.GoldType } };
}