// src/webhook.js
import express from "express";
import { middleware, Client } from "@line/bot-sdk";
import "dotenv/config";
import { upsertUserId } from "./db.js";
import { fetchHSHGoldBar965 } from "./fetchGoldGTA.js";
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
        if (userId) await upsertUserId(userId);

        if (ev.type === "message" && ev.message?.type === "text") {
          const text = ev.message.text;

          const p = await fetchHSHGoldBar965();
          const reply = await handleCommand(text, p.sell); // ✅ await

          await client.replyMessage(ev.replyToken, {
            type: "text",
            text:
              reply ||
              "พิมพ์คำสั่งได้ เช่น:\nbuy 77500 10000\nbuy 77500 5g\nsell 78900 5000\nsell 78900 2g\nstatus"
          });
        }
      }

      res.status(200).end();
    } catch (e) {
      console.error(e);
      res.status(500).end();
    }
  }
);