// src/db.js
import Database from "better-sqlite3";
export const db = new Database("gold.sqlite");

db.exec(`
  CREATE TABLE IF NOT EXISTS prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    buy REAL NOT NULL,
    sell REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS line_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL UNIQUE
  );

  -- ✅ เพิ่มตารางเก็บ state กันสแปม
  CREATE TABLE IF NOT EXISTS alert_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

export function insertPrice({ ts, buy, sell }) {
  db.prepare("INSERT INTO prices(ts, buy, sell) VALUES(?,?,?)").run(ts, buy, sell);
}

export function getLastNCloses(n = 200) {
  const rows = db.prepare("SELECT sell FROM prices ORDER BY id DESC LIMIT ?").all(n);
  return rows.map(r => r.sell).reverse();
}

export function getLastTwoSells() {
  const rows = db
    .prepare("SELECT sell, ts FROM prices ORDER BY id DESC LIMIT 2")
    .all();
  if (rows.length < 2) return null;
  return {
    currSell: rows[0].sell,
    currTs: rows[0].ts,
    prevSell: rows[1].sell,
    prevTs: rows[1].ts
  };
}

export function upsertUserId(userId) {
  db.prepare("INSERT OR IGNORE INTO line_targets(user_id) VALUES(?)").run(userId);
}

export function listUserIds() {
  return db.prepare("SELECT user_id FROM line_targets").all().map(r => r.user_id);
}

// ✅ state helpers
export function getAlertState(key, defaultValue = null) {
  const row = db.prepare("SELECT value FROM alert_state WHERE key=?").get(key);
  return row ? row.value : defaultValue;
}

export function setAlertState(key, value) {
  db.prepare("INSERT INTO alert_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, String(value));
}