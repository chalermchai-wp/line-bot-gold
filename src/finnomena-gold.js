// finnomena-gold.js
// Node 18+ ใช้ fetch ได้เลย

const FINNOMENA_BASE = "https://www.finnomena.com";
const THAI_GOLD_FACTOR = 0.49 * 0.965; // 0.47285

function convertXauThbToBahtGold(xauthb, decimals = 2) {
  if (!Number.isFinite(xauthb)) {
    throw new Error(`Invalid XAUTHB price: ${xauthb}`);
  }

  const raw = xauthb * THAI_GOLD_FACTOR;
  return Number(raw.toFixed(decimals));
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "User-Agent": "gold-bot/1.0",
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }

  return res.json();
}

/**
 * ดึง XAU/THB last_quote จาก Finnomena
 * endpoint นี้คุณเจอจากหน้าเว็บ:
 * /fn3/api/v2/gold/spot/historical/C:XAUTHB/last_quote
 */
async function fetchFinnomenaXauThbLastQuote() {
  const url = `${FINNOMENA_BASE}/fn3/api/v2/gold/spot/historical/C:XAUTHB/last_quote`;
  const json = await fetchJson(url);

  const last = json?.data?.last;
  if (!last || !Number.isFinite(Number(last.ask))) {
    throw new Error("Invalid Finnomena last_quote response");
  }

  return {
    symbol: json?.data?.symbol ?? "XAU/THB",
    ask: Number(last.ask),
    bid: Number(last.bid),
    exchange: Number(last.exchange ?? 0),
    timestamp: Number(last.timestamp),
    raw: json,
  };
}

/**
 * ดึงราคาทองไทย realtime ตามสูตรเดียวกับหน้า Finnomena
 */
async function fetchFinnomenaThaiGoldRealtime() {
  const quote = await fetchFinnomenaXauThbLastQuote();

  return {
    source: "Finnomena",
    symbol: quote.symbol,
    xauthbAsk: quote.ask,
    xauthbBid: quote.bid,
    thaiGoldAsk: convertXauThbToBahtGold(quote.ask),
    thaiGoldBid: convertXauThbToBahtGold(quote.bid),
    factor: THAI_GOLD_FACTOR,
    timestamp: quote.timestamp,
    isoTime: new Date(quote.timestamp).toISOString(),
  };
}

/**
 * ดึงราคาสมาคมจาก Finnomena ด้วย
 * endpoint ที่คุณเจอ:
 * /fn3/api/gold/trader/present
 */
async function fetchFinnomenaTraderPresent() {
  const url = `${FINNOMENA_BASE}/fn3/api/gold/trader/present`;
  const json = await fetchJson(url);

  const data = json?.data;
  if (!data) {
    throw new Error("Invalid Finnomena trader/present response");
  }

  return {
    source: "Finnomena",
    barBuyPrice: Number(data.barBuyPrice),
    barSellPrice: Number(data.barSellPrice),
    ornamentBuyPrice: Number(data.ornamentBuyPrice),
    ornamentSellPrice: Number(data.ornamentSellPrice),
    barPriceChange: Number(data.barPriceChange),
    createdAt: data.createdAt,
    createdDateTime: data.createdDateTime,
    raw: json,
  };
}

module.exports = {
  THAI_GOLD_FACTOR,
  convertXauThbToBahtGold,
  fetchFinnomenaXauThbLastQuote,
  fetchFinnomenaThaiGoldRealtime,
  fetchFinnomenaTraderPresent,
};