import axios from "axios";

const TV_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  Origin: "https://www.tradingview.com",
  Referer: "https://www.tradingview.com/",
};

// เลือก endpoint ตามประเภทตลาด + มี fallback
function scanEndpointsFor(symbol) {
  const s = String(symbol || "").toUpperCase();

  // ทอง spot หลายทีอยู่หมวด CFD/FOREX ใน TV
  if (s.startsWith("OANDA:") || s.startsWith("FX_IDC:")) {
    return [
      "https://scanner.tradingview.com/forex/scan",
      "https://scanner.tradingview.com/cfd/scan",
      "https://scanner.tradingview.com/global/scan",
    ];
  }

  // ดัชนี/ยีลด์ (TVC:...) มักอยู่ global ได้ แต่ใส่ fallback ไว้
  if (s.startsWith("TVC:") || s.startsWith("SP:") || s.startsWith("CBOE:")) {
    return [
      "https://scanner.tradingview.com/global/scan",
      "https://scanner.tradingview.com/america/scan",
    ];
  }

  // default
  return [
    "https://scanner.tradingview.com/global/scan",
    "https://scanner.tradingview.com/forex/scan",
    "https://scanner.tradingview.com/cfd/scan",
    "https://scanner.tradingview.com/america/scan",
  ];
}

async function postScan(url, payload) {
  const res = await axios.post(url, payload, {
    headers: TV_HEADERS,
    timeout: 15000,
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`TV scan HTTP ${res.status} from ${url}`);
  }
  return res.data;
}

/**
 * ดึง quote แบบเร็ว (close + %change 1D + high/low 1D ถ้ามี)
 */
export async function tvScan(symbol) {
  const payload = {
    symbols: { tickers: [symbol] },
    columns: ["close", "change", "change_abs", "high", "low", "description"],
  };

  const endpoints = scanEndpointsFor(symbol);
  let lastErr = null;

  for (const url of endpoints) {
    try {
      const data = await postScan(url, payload);
      const row = data?.data?.[0];

      if (!row?.d) {
        lastErr = new Error(`TradingView scan returned no data for ${symbol} via ${url}`);
        continue;
      }

      const d = row.d;
      return {
        symbol,
        price: Number(d[0]),
        changePct: Number(d[1]),
        changeAbs: Number(d[2]),
        high: d[3] != null ? Number(d[3]) : null,
        low: d[4] != null ? Number(d[4]) : null,
        description: d[5] ?? null,
        source: url,
      };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr ?? new Error(`TradingView scan failed for ${symbol}`);
}

/**
 * ดึงแท่งเทียน (history) เพื่อคำนวณ EMA/RSI + D1 high/low
 * ใช้ UDF history endpoint (unofficial) — ใส่ headers ให้คล้าย browser
 */
export async function tvHistory(symbol, resolution = "D", bars = 120) {
  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = nowSec - bars * 86400;

  // UDF history endpoint
  const url = "https://www.tradingview.com/charting_library/datafeed/udf/history";

  const res = await axios.get(url, {
    headers: TV_HEADERS,
    timeout: 20000,
    params: {
      symbol,
      resolution,
      from: fromSec,
      to: nowSec,
    },
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`TV history HTTP ${res.status}`);
  }
  const data = res.data;

  if (data?.s !== "ok") {
    throw new Error(`TV history not ok for ${symbol}: ${JSON.stringify(data)?.slice?.(0, 200)}`);
  }

  // data: { t:[], o:[], h:[], l:[], c:[], v:[] }
  return data;
}