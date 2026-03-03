import axios from "axios";

/**
 * TradingView Scanner (unofficial) - good for latest quote & 1D change.
 * This often works without auth, but may change anytime.
 */
export async function tvScan(symbol, extraColumns = []) {
  const columns = [
    "name",
    "description",
    "close",
    "change",
    "change_abs",
    "high",
    "low",
  ].concat(extraColumns);

  const body = {
    filter: [{ left: "name", operation: "equal", right: symbol }],
    options: { lang: "en" },
    markets: ["forex", "indices", "futures", "crypto"],
    symbols: { query: { types: [] }, tickers: [symbol] },
    columns,
    sort: { sortBy: "name", sortOrder: "asc" },
    range: [0, 1],
  };

  const { data } = await axios.post("https://scanner.tradingview.com/global/scan", body, {
    timeout: 15000,
    headers: { "Content-Type": "application/json" },
  });

  const row = data?.data?.[0];
  if (!row?.d) throw new Error(`TradingView scan returned no data for ${symbol}`);
  const d = row.d;
  const idx = (col) => columns.indexOf(col);

  const close = Number(d[idx("close")]);
  const changePct = Number(d[idx("change")]); // percent
  const changeAbs = Number(d[idx("change_abs")]);
  const high = Number(d[idx("high")]);
  const low = Number(d[idx("low")]);

  return { symbol, close, changePct, changeAbs, high, low, raw: d, columns };
}

/**
 * TradingView UDF History (unofficial).
 * Works on many symbols: /history?symbol=OANDA:XAUUSD&resolution=D&from=...&to=...
 */
export async function tvHistory(symbol, resolution, fromSec, toSec) {
  const url = "https://www.tradingview.com/charting_library/datafeed/udf/history";
  const { data } = await axios.get(url, {
    timeout: 20000,
    params: { symbol, resolution, from: fromSec, to: toSec },
  });

  if (!data || data.s !== "ok") {
    throw new Error(`TradingView history not ok for ${symbol}: ${JSON.stringify(data)?.slice(0,200)}`);
  }
  return data; // {t,c,o,h,l,v}
}
