import axios from "axios";

const FALLBACK_SYMBOLS = {
  XAUUSD: ["OANDA:XAUUSD", "FX_IDC:XAUUSD", "TVC:GOLD"],
  DXY: ["TVC:DXY"],
  US10Y: ["TVC:US10Y"],
  USDTHB: ["FX_IDC:USDTHB"],
  SPX: ["SP:SPX", "CBOE:SPX"]
};

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
// export async function tvScan(symbol) {
//   const payload = {
//     symbols: { tickers: [symbol] },
//     columns: ["close", "change", "change_abs", "high", "low", "description"],
//   };

//   const endpoints = scanEndpointsFor(symbol);
//   let lastErr = null;

//   for (const url of endpoints) {
//     try {
//       const data = await postScan(url, payload);
//       const row = data?.data?.[0];

//       if (!row?.d) {
//         lastErr = new Error(`TradingView scan returned no data for ${symbol} via ${url}`);
//         continue;
//       }

//       const d = row.d;
//       return {
//         symbol,
//         price: Number(d[0]),
//         changePct: Number(d[1]),
//         changeAbs: Number(d[2]),
//         high: d[3] != null ? Number(d[3]) : null,
//         low: d[4] != null ? Number(d[4]) : null,
//         description: d[5] ?? null,
//         source: url,
//       };
//     } catch (e) {
//       lastErr = e;
//     }
//   }

//   throw lastErr ?? new Error(`TradingView scan failed for ${symbol}`);
// }

export async function tvScan(symbolKey) {

  const symbols = FALLBACK_SYMBOLS[symbolKey] || [symbolKey];

  for (const symbol of symbols) {

    const payload = {
      symbols: { tickers: [symbol] },
      columns: ["close", "change", "change_abs", "high", "low", "description"]
    };

    const endpoints = scanEndpointsFor(symbol);

    for (const url of endpoints) {

      try {

        const data = await postScan(url, payload);
        const row = data?.data?.[0];

        if (row?.d && row.d.length > 0) {

          const d = row.d;

          return {
            symbol,
            close: Number(d[0]),
            changePct: Number(d[1]),
            changeAbs: Number(d[2]),
            high: d[3] != null ? Number(d[3]) : null,
            low: d[4] != null ? Number(d[4]) : null,
            description: d[5] ?? null,
            source: url
          };

        }

      } catch (err) {
        // ลอง endpoint ต่อไป
      }

    }

  }

  throw new Error(`TradingView scan returned no data for ${symbolKey}`);
}

/**
 * ดึงแท่งเทียน (history) เพื่อคำนวณ EMA/RSI + D1 high/low
 * ใช้ UDF history endpoint (unofficial) — ใส่ headers ให้คล้าย browser
 */

export async function tvHistory(symbol, resolution = "D", bars = 200) {

  const url = "https://min-api.cryptocompare.com/data/v2/histoday";

  const res = await axios.get(url, {
    params: {
      fsym: "XAU",
      tsym: "USD",
      limit: bars
    }
  });

  const data = res.data?.Data?.Data;

  if (!data || !data.length) {
    throw new Error("History fetch failed");
  }

  return {
    c: data.map(x => x.close),
    h: data.map(x => x.high),
    l: data.map(x => x.low)
  };

}