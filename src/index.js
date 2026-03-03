import "dotenv/config";
import express from "express";
import cron from "node-cron";
import { webhookApp } from "./webhook.js";
import { runOnce } from "./worker.js";
import { runDailyBrief } from "./dailyBrief.js";
import { initDb } from "./db.js";
import { isInThaiMarketWindow, TH_TZ } from "./marketHours.js";

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

// Price watcher schedule (every minute by default) but will execute only
// during the configured Thai market window.
cron.schedule(process.env.CRON || "* 2 * * *", async () => {
  try {
    if (!isInThaiMarketWindow()) return;
    await runOnce();
  } catch (e) {
    console.error(e);
  }
}, { timezone: TH_TZ });

// Daily brief at 06:00 Thailand time
cron.schedule(process.env.DAILY_BRIEF_CRON || "0 6 * * *", async () => {
  try {
    await runDailyBrief();
  } catch (e) {
    console.error(e);
  }
}, { timezone: TH_TZ });