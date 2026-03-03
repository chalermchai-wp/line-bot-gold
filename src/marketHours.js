import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = "Asia/Bangkok";

function parseHHMM(s, fallback) {
  const v = (s || "").trim() || fallback;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v);
  if (!m) throw new Error(`Invalid HH:MM time: ${s}`);
  return { h: Number(m[1]), m: Number(m[2]) };
}

/**
 * Returns true if current TH time is within [open, close], supporting ranges that cross midnight.
 * Example: open=06:00, close=02:00 => active from 06:00..23:59 and 00:00..02:00.
 */
export function isWithinThaiHours(now = dayjs()) {
  const openStr = process.env.MARKET_OPEN || "06:00";
  const closeStr = process.env.MARKET_CLOSE || "02:00";
  const open = parseHHMM(openStr, "06:00");
  const close = parseHHMM(closeStr, "02:00");

  const t = now.tz(TZ);
  const minutes = t.hour() * 60 + t.minute();
  const openMin = open.h * 60 + open.m;
  const closeMin = close.h * 60 + close.m;

  if (openMin <= closeMin) {
    return minutes >= openMin && minutes <= closeMin;
  }
  // crosses midnight
  return minutes >= openMin || minutes <= closeMin;
}

export function thaiNow() {
  return dayjs().tz(TZ);
}

export const THAI_TZ = TZ;
