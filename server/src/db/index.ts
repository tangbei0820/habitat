/**
 * 服务端 SQLite 连接 + 启动时幂等 bootstrap 迁移。
 * Phase 0 只此一张表，用 CREATE TABLE IF NOT EXISTS 即可；
 * drizzle-kit 正式迁移随 Phase 2 账本落地时引入（届时有多表演进需求）。
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

const dbPath = resolve(process.env.HABITAT_DB_PATH ?? './data/habitat.db')
mkdirSync(dirname(dbPath), { recursive: true })

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')

sqlite.exec(`
CREATE TABLE IF NOT EXISTS mcp_diagnostic_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  method TEXT NOT NULL,
  http_status INTEGER,
  handshake INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  error TEXT,
  at INTEGER NOT NULL
)
`)

sqlite.exec(`
CREATE TABLE IF NOT EXISTS usage_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL,
  service TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost INTEGER,
  day_key TEXT NOT NULL,
  at INTEGER NOT NULL
)
`)
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_usage_record_day ON usage_record (day_key)`)
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_usage_record_profile ON usage_record (profile_id, at)`)

export const db = drizzle(sqlite, { schema })

export function closeDb(): void {
  sqlite.close()
}
