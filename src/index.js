import "dotenv/config";
import express from "express";
import cron from "node-cron";
import { webhookApp } from "./webhook.js";
import { runOnce } from "./worker.js";

const app = express();
app.use(webhookApp);

app.get("/", (_, res) => res.send("gold-bot ok"));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Listening on :${port}`));

const spec = process.env.CRON || "*/5 * * * *";
cron.schedule(spec, async () => {
  try {
    const r = await runOnce();
    console.log("tick", r.sell, r.signalsCount);
  } catch (e) {
    console.error("tick error", e);
  }
});