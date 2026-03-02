import "dotenv/config";
import express from "express";
import cron from "node-cron";
import { webhookApp } from "./webhook.js";
import { runOnce } from "./worker.js";
import { initDb } from "./db.js";

const app = express();
app.use(webhookApp);

app.get("/", (_, res) => res.send("gold-bot running"));

const port = Number(process.env.PORT);
if (!port) {
  console.error("PORT is missing (Plesk should provide it)");
  process.exit(1);
}

app.listen(port, "0.0.0.0", () => console.log(`Listening on :${port}`));

// init DB after server is up (important for Plesk)
initDb().then(
  () => console.log("✅ MariaDB initialized"),
  (e) => console.error("❌ initDb failed:", e)
);

cron.schedule(process.env.CRON || "*/15 * * * *", async () => {
  try {
    await runOnce();
  } catch (e) {
    console.error(e);
  }
});