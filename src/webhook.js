import express from "express";
import { middleware } from "@line/bot-sdk";
import "dotenv/config";
import { upsertUserId } from "./db.js";

export const webhookApp = express();

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
      }
      res.status(200).end();
    } catch (e) {
      console.error(e);
      res.status(500).end();
    }
  }
);