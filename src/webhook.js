import express from "express";
import { middleware, Client } from "@line/bot-sdk";
import "dotenv/config";
import { upsertUserId } from "./db.js";
import { fetchThaiGoldBar965 } from "./fetchGoldGTA.js"; // หรือ HSH ก็ได้
import { handleCommand } from "./commands.js";

export const webhookApp = express();

const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

webhookApp.post(
  "/webhook",
  middleware({
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
  }),
  async (req, res) => {
    try {
      const events = req.body.events || [];

      for (const ev of events) {
        const userId = ev?.source?.userId;
        if (userId) upsertUserId(userId);

        if (ev.type === "message" && ev.message?.type === "text") {
          const text = ev.message.text;

          // ดึงราคาปัจจุบัน (ขายออก) เพื่อคำนวณ unrealized
          const p = await fetchThaiGoldBar965();
          const reply = handleCommand(text, p.sell);

          if (reply) {
            await client.replyMessage(ev.replyToken, { type: "text", text: reply });
          } else {
            await client.replyMessage(ev.replyToken, {
              type: "text",
              text: "พิมพ์คำสั่งได้ เช่น:\nbuy 77500 10000\nbuy 77500 5g\nsell 78900 5000\nsell 78900 2g\nstatus"
            });
          }
        }
      }

      res.status(200).end();
    } catch (e) {
      console.error(e);
      res.status(500).end();
    }
  }
);