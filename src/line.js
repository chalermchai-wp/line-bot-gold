import { Client } from "@line/bot-sdk";
import "dotenv/config";

const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

export async function pushText(userId, text) {
  await client.pushMessage(userId, { type: "text", text });
}