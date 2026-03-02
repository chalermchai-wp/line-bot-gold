import "dotenv/config";
import express from "express";
import cron from "node-cron";
import { webhookApp } from "./webhook.js";
import { runOnce } from "./worker.js";
import { initDb } from "./db.js";

const app = express();
app.use(webhookApp);

app.get("/", (_, res) => res.send("gold-bot running"));

const port = Number(process.env.PORT || 3000);

await initDb();

app.listen(port, () => console.log(`Listening on :${port}`));

cron.schedule(process.env.CRON || "*/15 * * * *", async () => {
  try {
    await runOnce();
  } catch (e) {
    console.error(e);
  }
});