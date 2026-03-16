import "dotenv/config";
import express from "express";
import cron from "node-cron";
import { isWithinThaiHours, thaiNow, THAI_TZ } from "./marketHours.js";
import { runDailyBrief } from "./dailyBrief.js";
import { webhookApp } from "./webhook.js";
import { runOnce } from "./worker.js";
import { initDb } from "./db.js";

const app = express();
app.use(webhookApp);

app.get("/", (_, res) => res.send("gold-bot running"));

const port = Number(process.env.PORT);
const host = process.env.HOST || "0.0.0.0";
if (!port) {
  console.error("PORT is missing (Plesk should provide it)");
  process.exit(1);
}

app.listen(port, host, () => console.log(`Listening on host: ${host},  :${port}`));

// init DB after server is up (important for Plesk)
initDb().then(
  () => console.log("✅ MariaDB initialized"),
  (e) => console.error("❌ initDb failed:", e)
);

// Market-time watcher (runs only within MARKET_OPEN..MARKET_CLOSE, TH time)
cron.schedule(process.env.CRON || "* */4 * * *", async () => {
  try {
    if (!isWithinThaiHours(thaiNow())) return;
    await runOnce();
  } catch (e) {
    console.error(e);
  }
}, { timezone: THAI_TZ });

// Daily 06:00 brief
cron.schedule(process.env.DAILY_BRIEF_CRON || "0 6 * * *", async () => {
  try {
    const now = thaiNow();
    await runDailyBrief(now.format("DD/MM/YYYY HH:mm:ss"), false);
  } catch (e) {
    console.error(e);
  }
}, { timezone: THAI_TZ });
