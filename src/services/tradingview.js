// src/services/tradingview.js
import axios from "axios";

/**
 * Fetch quotes from TradingView scanner endpoint.
 * NOTE: This is an unofficial endpoint used by TradingView's own screener.
 * It usually works without auth, but TradingView may change/limit it anytime.
 */
export async function fetchTradingViewQuotes(tickers) {
  if (!Array.isArray(tickers) || tickers.length === 0) return {};

  const url = "https://scanner.tradingview.com/global/scan";
  const body = {
    symbols: {
      tickers,
      query: { types: [] },
    },
    columns: [
      "name",
      "close",
      "change",
      "change_abs",
      "high",
      "low",
      "description",
      "type",
    ],
  };

  const { data } = await axios.post(url, body, {
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "gold-bot/1.0",
    },
    timeout: 15000,
  });

  const out = {};
  const rows = data?.data || [];
  for (const r of rows) {
    const ticker = r?.s;
    const d = r?.d;
    if (!ticker || !Array.isArray(d)) continue;
    out[ticker] = {
      ticker,
      name: d[0] ?? ticker,
      price: num(d[1]),
      changePct: num(d[2]),
      changeAbs: num(d[3]),
      high: num(d[4]),
      low: num(d[5]),
      description: d[6] ?? "",
      type: d[7] ?? "",
    };
  }
  return out;
}

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
