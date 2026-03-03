// src/marketHours.js
// Thai market window utility (Asia/Bangkok)

export const TH_TZ = "Asia/Bangkok";

function parseHHMM(s) {
  const m = String(s || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`Invalid HH:MM time: ${s}`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) throw new Error(`Invalid HH:MM time: ${s}`);
  return hh * 60 + mm;
}

function nowMinutesInTH() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TH_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const hh = Number(parts.find(p => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find(p => p.type === "minute")?.value ?? "0");
  return hh * 60 + mm;
}

/**
 * Returns true if current Thailand time is inside the window.
 * Default window (requested): 06:00–02:00 (wraps midnight)
 */
export function isInThaiMarketWindow() {
  const open = parseHHMM(process.env.MARKET_OPEN || "06:00");
  const close = parseHHMM(process.env.MARKET_CLOSE || "02:00");
  const now = nowMinutesInTH();

  // Normal window (e.g., 09:00–17:00)
  if (open <= close) return now >= open && now <= close;

  // Wrap window (e.g., 06:00–02:00)
  return now >= open || now <= close;
}
