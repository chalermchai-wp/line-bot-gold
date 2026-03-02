// src/db.js
import mariadb from "mariadb";
import "dotenv/config";

export const BAHT_GOLD_GRAMS = 15.244;

const pool = mariadb.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: Number(process.env.DB_CONN_LIMIT || 5),
  timezone: "Z"
});

export async function initDb() {
  let conn;
  try {
    conn = await pool.getConnection();

    await conn.query(`
      CREATE TABLE IF NOT EXISTS prices (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        ts DATETIME(3) NOT NULL,
        buy DECIMAL(12,2) NOT NULL,
        sell DECIMAL(12,2) NOT NULL,
        INDEX idx_prices_ts (ts)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS line_targets (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL UNIQUE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS alert_state (
        \`key\` VARCHAR(128) NOT NULL PRIMARY KEY,
        \`value\` TEXT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS portfolio (
        id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
        grams DECIMAL(18,6) NOT NULL,
        avg_cost_per_gram DECIMAL(18,6) NOT NULL,
        realized_pnl DECIMAL(18,2) NOT NULL,
        updated_at DATETIME(3) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // ensure single row id=1 exists
    await conn.query(`
      INSERT INTO portfolio (id, grams, avg_cost_per_gram, realized_pnl, updated_at)
      VALUES (1, 0, 0, 0, NOW(3))
      ON DUPLICATE KEY UPDATE updated_at = updated_at;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        side ENUM('BUY','SELL') NOT NULL,
        price_per_baht DECIMAL(12,2) NOT NULL,
        price_per_gram DECIMAL(18,6) NOT NULL,
        amount_thb DECIMAL(18,2) NOT NULL,
        grams DECIMAL(18,6) NOT NULL,
        ts DATETIME(3) NOT NULL,
        INDEX idx_trades_ts (ts)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log("✅ MariaDB initialized");
  } finally {
    if (conn) conn.release();
  }
}

export async function insertPrice({ ts, buy, sell }) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      `INSERT INTO prices(ts, buy, sell) VALUES (?, ?, ?)`,
      [new Date(ts), buy, sell]
    );
  } finally {
    if (conn) conn.release();
  }
}

export async function getLastTwoSells() {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      `SELECT sell, ts FROM prices ORDER BY id DESC LIMIT 2`
    );
    if (!rows || rows.length < 2) return null;
    return {
      currSell: Number(rows[0].sell),
      currTs: rows[0].ts,
      prevSell: Number(rows[1].sell),
      prevTs: rows[1].ts
    };
  } finally {
    if (conn) conn.release();
  }
}

export async function upsertUserId(userId) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      `INSERT INTO line_targets(user_id) VALUES (?) 
       ON DUPLICATE KEY UPDATE user_id = user_id`,
      [userId]
    );
  } finally {
    if (conn) conn.release();
  }
}

export async function listUserIds() {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(`SELECT user_id FROM line_targets`);
    return rows.map(r => r.user_id);
  } finally {
    if (conn) conn.release();
  }
}

export async function getAlertState(key, defaultValue = null) {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(`SELECT value FROM alert_state WHERE \`key\`=?`, [key]);
    if (!rows || rows.length === 0) return defaultValue;
    return rows[0].value;
  } finally {
    if (conn) conn.release();
  }
}

export async function setAlertState(key, value) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      `INSERT INTO alert_state(\`key\`, \`value\`)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
      [key, String(value)]
    );
  } finally {
    if (conn) conn.release();
  }
}

export async function getPortfolio() {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      `SELECT grams, avg_cost_per_gram, realized_pnl FROM portfolio WHERE id=1`
    );
    const r = rows[0];
    return {
      grams: Number(r.grams),
      avg_cost_per_gram: Number(r.avg_cost_per_gram),
      realized_pnl: Number(r.realized_pnl)
    };
  } finally {
    if (conn) conn.release();
  }
}

export async function savePortfolio({ grams, avg_cost_per_gram, realized_pnl }) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      `UPDATE portfolio
       SET grams=?, avg_cost_per_gram=?, realized_pnl=?, updated_at=NOW(3)
       WHERE id=1`,
      [grams, avg_cost_per_gram, realized_pnl]
    );
  } finally {
    if (conn) conn.release();
  }
}

export async function insertTrade({ side, pricePerBaht, pricePerGram, amountTHB, grams }) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      `INSERT INTO trades(side, price_per_baht, price_per_gram, amount_thb, grams, ts)
       VALUES (?, ?, ?, ?, ?, NOW(3))`,
      [side, pricePerBaht, pricePerGram, amountTHB, grams]
    );
  } finally {
    if (conn) conn.release();
  }
}