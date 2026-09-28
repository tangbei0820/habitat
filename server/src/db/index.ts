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
  price_snapshot_id TEXT,
  day_key TEXT NOT NULL,
  at INTEGER NOT NULL
)
`)
const usageColumns = sqlite.pragma('table_info(usage_record)') as Array<{ name: string }>
if (!usageColumns.some((col) => col.name === 'price_snapshot_id')) {
  sqlite.exec('ALTER TABLE usage_record ADD COLUMN price_snapshot_id TEXT')
}
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_usage_record_day ON usage_record (day_key)`)
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_usage_record_profile ON usage_record (profile_id, at)`)
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_usage_record_price ON usage_record (price_snapshot_id)`)

sqlite.exec(`
CREATE TABLE IF NOT EXISTS price_snapshot (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_cents_per_million INTEGER NOT NULL,
  completion_cents_per_million INTEGER NOT NULL,
  valid_from INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_snapshot_lookup ON price_snapshot (provider, model, valid_from DESC);
CREATE TABLE IF NOT EXISTS push_subscription (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_success_at INTEGER,
  last_error TEXT
);
`)

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
sqlite.exec(`
CREATE TABLE IF NOT EXISTS provider_capability_binding (
  capability TEXT PRIMARY KEY CHECK (capability IN ('chat', 'voice', 'vision', 'image')),
  profile_id TEXT NOT NULL,
  model TEXT NOT NULL,
  secondary_model TEXT,
  last_tested_at INTEGER,
  last_latency_ms INTEGER,
  last_error TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_provider_binding_profile ON provider_capability_binding (profile_id);
CREATE TABLE IF NOT EXISTS provider_scheme (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  bindings_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_provider_scheme_active ON provider_scheme (is_active, updated_at DESC);

CREATE TABLE IF NOT EXISTS mcp_server (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  headers TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  allow_autonomous INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mcp_server_enabled ON mcp_server (enabled, updated_at DESC);
CREATE TABLE IF NOT EXISTS mcp_server_secret (
  server_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
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
CREATE TABLE IF NOT EXISTS call_session (
  id TEXT PRIMARY KEY,
  chat_session_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('user', 'companion')),
  status TEXT NOT NULL CHECK (status IN ('ringing', 'active', 'ended', 'rejected', 'missed', 'cancelled')),
  created_at INTEGER NOT NULL,
  answered_at INTEGER,
  ended_at INTEGER,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_call_session_chat ON call_session (chat_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_session_inbox ON call_session (status, direction, created_at DESC);
CREATE TABLE IF NOT EXISTS call_turn (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  speaker TEXT NOT NULL CHECK (speaker IN ('user', 'companion')),
  text TEXT NOT NULL,
  at INTEGER NOT NULL,
  UNIQUE (call_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_call_turn_call ON call_turn (call_id, sequence);
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

// 共同生活数据（Phase 6.5 起从 web 的 Dexie 迁入）。搬家的理由见 schema.ts 的 Diary 注释：
// AI 跑在服务端，「AI 写日记 / 用户请求查看 / AI 决定放不放」都只能在这里发生。
sqlite.exec(`
CREATE TABLE IF NOT EXISTS diary (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'companion',
  visibility TEXT NOT NULL DEFAULT 'private',
  fragment_visibility_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_diary_entry ON diary (entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_diary_author ON diary (author, entry_date DESC);
CREATE TABLE IF NOT EXISTS moment (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  group_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moment_created ON moment (created_at DESC);
CREATE TABLE IF NOT EXISTS moment_group (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moment_group_order ON moment_group (updated_at DESC, created_at DESC);
`)

// 分组与留言归属是后续追加的列；老库的留言统一落到“未分组”，不需要回填数据。
const momentColumns = sqlite.pragma('table_info(moment)') as Array<{ name: string }>
if (!momentColumns.some((col) => col.name === 'group_id')) {
  sqlite.exec('ALTER TABLE moment ADD COLUMN group_id TEXT')
}
// 朋友圈复用 Moment 的内容基座，但用 channel 与留言板分开查询；老留言全部留在 board。
if (!momentColumns.some((col) => col.name === 'channel')) {
  sqlite.exec("ALTER TABLE moment ADD COLUMN channel TEXT NOT NULL DEFAULT 'board'")
}
sqlite.exec('CREATE INDEX IF NOT EXISTS idx_moment_group_created ON moment (group_id, created_at DESC)')
sqlite.exec('CREATE INDEX IF NOT EXISTS idx_moment_channel_created ON moment (channel, created_at DESC)')

const diaryColumns = sqlite.pragma('table_info(diary)') as Array<{ name: string }>
if (!diaryColumns.some((col) => col.name === 'fragment_visibility_json')) {
  sqlite.exec("ALTER TABLE diary ADD COLUMN fragment_visibility_json TEXT NOT NULL DEFAULT '{}'")
}

// Event Inbox（Phase 6.5 P1）。为什么单独一张表、为什么不并进 notification：
// 见 schema.ts 的 runtimeEvent 注释 —— 那张是单向广播，这张是双向待决。
sqlite.exec(`
CREATE TABLE IF NOT EXISTS runtime_event (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  decider TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  result TEXT,
  result_delivered_at INTEGER,
  capability_id TEXT,
  target_id TEXT,
  target_fragment_id TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
-- 「谁待决什么」是最热的查询：注入上下文取 companion 的，确认卡取 user 的，两边都带 status
CREATE INDEX IF NOT EXISTS idx_runtime_event_inbox ON runtime_event (decider, status, created_at DESC);
-- 注入已决结果时按「未送达」筛，用部分索引只给那一小撮建
CREATE INDEX IF NOT EXISTS idx_runtime_event_undelivered ON runtime_event (created_at) WHERE decided_at IS NOT NULL AND result_delivered_at IS NULL;
`)
// target_id 是后加的列，已有库要补上（`CREATE TABLE IF NOT EXISTS` 不会给已存在的表加列）
const runtimeEventColumns = sqlite.pragma('table_info(runtime_event)') as Array<{ name: string }>
if (!runtimeEventColumns.some((col) => col.name === 'target_id')) {
  sqlite.exec('ALTER TABLE runtime_event ADD COLUMN target_id TEXT')
}
if (!runtimeEventColumns.some((col) => col.name === 'target_fragment_id')) {
  sqlite.exec('ALTER TABLE runtime_event ADD COLUMN target_fragment_id TEXT')
}
if (!runtimeEventColumns.some((col) => col.name === 'expires_at')) {
  sqlite.exec('ALTER TABLE runtime_event ADD COLUMN expires_at INTEGER')
}

export const db = drizzle(sqlite, { schema })

export function closeDb(): void {
  sqlite.close()
}

// 世界书（Phase 7A · SPEC §9.4.2）。人格 Prompt 走 app_kv（单值，不值得一张表）
sqlite.exec(`
CREATE TABLE IF NOT EXISTS worldbook_entry (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  keys TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('always', 'keyword')),
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_worldbook_order ON worldbook_entry (sort_order, created_at);
`)

// Eventide 历史快照（Phase 7A）：状态页趋势 / 最近变化用。行数有上限，写入时裁剪
sqlite.exec(`
CREATE TABLE IF NOT EXISTS eventide_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state_json TEXT NOT NULL,
  payload TEXT NOT NULL,
  settled_at INTEGER NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_eventide_history_at ON eventide_history (settled_at DESC, id DESC);
`)

// 自主行动审计（Phase 7B）：决策契约的 outcome 落点。(run_id, idx) 唯一 = 行动幂等
sqlite.exec(`
CREATE TABLE IF NOT EXISTS automation_action (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('message', 'messageboard', 'diary', 'surf')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'skipped')),
  reason TEXT,
  ref_id TEXT,
  at INTEGER NOT NULL,
  UNIQUE (run_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_automation_action_run ON automation_action (run_id, idx);
`)
