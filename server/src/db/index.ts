/**
 * 服务端 SQLite 连接 + 启动时幂等 bootstrap 迁移。
 * 当前仍以 CREATE TABLE IF NOT EXISTS 做本地幂等 bootstrap；
 * 表结构已覆盖基础诊断、API/用量及 Phase 3B 主动行为链路。
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
// 诊断日志只增不改：查询一律「按 id 倒序取一页」，故索引都带 id 收尾，
// 让筛选 + 排序走同一条索引，不必回表排序（日志会越长越多，这里不能指望数据量小）
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_mcp_diag_server ON mcp_diagnostic_log (server_id, id)`)
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_mcp_diag_handshake ON mcp_diagnostic_log (handshake, id)`)
// 部分索引：绝大多数记录 error 为 NULL，只给「有错」的那少量行建索引才划算
sqlite.exec(
  `CREATE INDEX IF NOT EXISTS idx_mcp_diag_error ON mcp_diagnostic_log (id) WHERE error IS NOT NULL`,
)

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

// LLM 方案（Phase 1 切片三）。密钥独立成表，见 schema.ts 的说明
sqlite.exec(`
CREATE TABLE IF NOT EXISTS api_profile (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  key_ref TEXT NOT NULL DEFAULT '',
  model_map TEXT NOT NULL,
  headers TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
`)
// v3 之后的列用「缺则补」的方式演进：CREATE TABLE 只建初版，老库靠这几行补齐
const profileColumns = sqlite.pragma('table_info(api_profile)') as Array<{ name: string }>
if (!profileColumns.some((col) => col.name === 'stream_options')) {
  sqlite.exec('ALTER TABLE api_profile ADD COLUMN stream_options INTEGER NOT NULL DEFAULT 1')
}
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_api_profile_order ON api_profile (sort_order, created_at)`)
sqlite.exec(`
CREATE TABLE IF NOT EXISTS api_secret (
  profile_id TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)
`)
// 进程级键值状态（方案种子导入标记等）
sqlite.exec(`
CREATE TABLE IF NOT EXISTS app_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)
`)

// Eventide 宿主持久化（Phase 3B 切片一）。单人格阶段只写 id='primary' 的一行；
// sidecar 保持无状态，重启不会丢周期进度。
sqlite.exec(`
CREATE TABLE IF NOT EXISTS body_state_snapshot (
  id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  state_card TEXT,
  payload TEXT NOT NULL,
  settled_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
`)

sqlite.exec(`
CREATE TABLE IF NOT EXISTS automation_policy (
  id TEXT PRIMARY KEY,
  policy_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_state (
  id TEXT PRIMARY KEY,
  last_counterpart_at INTEGER,
  last_wake_at INTEGER,
  unanswered_wakes INTEGER NOT NULL DEFAULT 0,
  last_solitude_day_key TEXT,
  last_dream_day_key TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_run (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  usage_record_id INTEGER,
  reserved_tokens INTEGER NOT NULL DEFAULT 0,
  day_key TEXT NOT NULL,
  at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_automation_run_day ON automation_run (day_key, status, kind);
CREATE TABLE IF NOT EXISTS event_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  day_key TEXT NOT NULL,
  hour_key TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  ref_id TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_log_day ON event_log (day_key, id);
CREATE INDEX IF NOT EXISTS idx_event_log_type ON event_log (event_type, id);
CREATE TABLE IF NOT EXISTS notification (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_created ON notification (created_at DESC);
CREATE TABLE IF NOT EXISTS solitude_entry (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_solitude_created ON solitude_entry (created_at DESC);
CREATE TABLE IF NOT EXISTS wallet (
  id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wallet_transaction (
  id TEXT PRIMARY KEY,
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_created ON wallet_transaction (created_at DESC);
`)

export const db = drizzle(sqlite, { schema })

export function closeDb(): void {
  sqlite.close()
}
