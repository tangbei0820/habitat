/**
 * Phase 7A · Eventide 历史快照端点验收。
 *
 * 两次运行：
 *   SEED=1 tsx probe-eventide-history.ts   → 造一个独立库并写入若干历史行
 *   tsx probe-eventide-history.ts          → 对 PROBE_SERVER 发 HTTP 断言（历史/当前/raw 数据源）
 *
 * Eventide sidecar 不在本探针范围内（probe-eventide.ts 已覆盖 sidecar 链路）；
 * 这里只验「历史行 → HTTP 端点 → 形状与排序」这一段。
 */
export {}

const DB_PATH = process.env.HABITAT_DB_PATH ?? ''

if (process.env.SEED === '1') {
  if (DB_PATH === '') throw new Error('SEED=1 需要 HABITAT_DB_PATH')
  const { db } = await import('../src/db/index.js')
  const { eventideHistory } = await import('../src/db/schema.js')
  const now = Date.now()
  const rows = Array.from({ length: 5 }, (_, i) => ({
    stateJson: { cycle_key: 'stable', last_tick_at: new Date(now - (5 - i) * 3600_000).toISOString() },
    payload: {
      energy: 40 + i * 5,
      mood: 60 - i,
      note: `快照 ${i + 1}`,
    },
    settledAt: now - (5 - i) * 3600_000,
  }))
  db.insert(eventideHistory).values(rows).run()
  console.log(`seeded ${rows.length} history rows into ${DB_PATH}`)
  process.exit(0)
}

const SERVER = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3237').replace(/\/+$/, '')
let passed = 0
let failed = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}${detail === '' ? '' : `  ${detail}`}`) }
  else { failed += 1; console.log(`  ✗ ${label}${detail === '' ? '' : `  ${detail}`}`) }
}

console.log('\n=== Eventide history 端点 ===')
const history = await (await fetch(`${SERVER}/api/life/eventide/history?limit=200`)).json() as { points: Array<{ settledAt: number; payload: Record<string, unknown> }> }
check('返回 5 个历史点', history.points.length === 5, `points=${history.points.length}`)
check('按时间升序（画线方向正确）', history.points.every((p, i) => i === 0 || p.settledAt > history.points[i - 1].settledAt), '')
check('payload 是结构化对象（非字符串）', typeof history.points[0]?.payload === 'object' && history.points[0]?.payload !== null, '')
check('数值维度齐全（趋势数据源）', history.points.every((p) => typeof p.payload.energy === 'number' && typeof p.payload.mood === 'number'), '')

const limitBad = await fetch(`${SERVER}/api/life/eventide/history?limit=9999`)
check('limit 越界被拒收（400）', limitBad.status === 400, `status=${limitBad.status}`)

const current = await fetch(`${SERVER}/api/life/eventide/current`)
// 种子只写了历史表，没写主快照表 → 404 是正确行为（当前视图与历史是两份数据）
check('无主快照时 current 明确 404', current.status === 404, `status=${current.status}`)

console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`)
if (failed > 0) process.exit(1)
