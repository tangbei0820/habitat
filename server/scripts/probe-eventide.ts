/** Phase 3B 切片一：真实 Eventide sidecar + Node Provider + SQLite 持久化验收。 */
import '../src/lib/env.js'

import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

const DB_PATH = `./data/probe-eventide-${process.pid}.db`
process.env.HABITAT_DB_PATH = DB_PATH
for (const suffix of ['', '-shm', '-wal']) rmSync(resolve(`${DB_PATH}${suffix}`), { force: true })

const { EventideStateProvider } = await import('../src/providers/eventide-state.js')
const { closeDb } = await import('../src/db/index.js')

const url = (process.env.EVENTIDE_URL ?? 'http://127.0.0.1:8234').replace(/\/+$/, '')
const serverUrl = process.env.PROBE_SERVER?.replace(/\/+$/, '')
const provider = new EventideStateProvider(url)
let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}${detail === '' ? '' : `  ${detail}`}`) }
  else { failed += 1; console.log(`  ✗ ${label}${detail === '' ? '' : `  ${detail}`}`) }
}

try {
  console.log('\n=== 1. sidecar 健康 ===')
  const health = await provider.health()
  check('健康检查通过', health.ok, health.lastError ?? '')
  check('回报固定 Eventide revision', health.revision === '5d8bef965137427e41d97f5b60e5a14c24dd812c', String(health.revision))

  console.log('\n=== 2. 首次状态 ===')
  const start = new Date('2026-09-23T00:00:00.000Z')
  const first = await provider.tick(start)
  check('首次 tick 创建 stable 状态', first.state.cycle_key === 'stable', String(first.state.cycle_key))
  check('状态卡是 ephemeral_state', first.stateCard?.includes('<ephemeral_state') === true)
  check('结构化 payload 含七项身体数值', Object.keys(first.payload).length === 7, `fields=${Object.keys(first.payload).length}`)
  check('settledAt 使用调用方时间', first.settledAt === start.getTime())
  check('SQLite 可立即读回同一状态', provider.current()?.settledAt === first.settledAt)

  console.log('\n=== 3. 时间推进与重建 ===')
  const later = new Date('2026-09-23T02:00:00.000Z')
  const second = await provider.tick(later, { lastCounterpartMessageAt: new Date('2026-09-22T22:00:00.000Z') })
  check(
    '第二次 tick 复用并推进旧状态',
    Date.parse(String(second.state.last_tick_at)) === later.getTime(),
    String(second.state.last_tick_at),
  )
  check('新快照覆盖旧 settledAt', provider.current()?.settledAt === later.getTime())
  const reloaded = new EventideStateProvider(url)
  check(
    '重建 Provider 后仍从 SQLite 读回',
    Date.parse(String(reloaded.current()?.state.last_tick_at)) === later.getTime(),
  )

  console.log('\n=== 3B. 并发串行与时间单调 ===')
  const third = new Date('2026-09-23T03:00:00.000Z')
  const fourth = new Date('2026-09-23T04:00:00.000Z')
  await Promise.all([reloaded.tick(third), reloaded.tick(fourth)])
  check('并发 tick 不互相覆盖', reloaded.current()?.settledAt === fourth.getTime())
  const rewind = await reloaded.tick(new Date('2026-09-23T01:00:00.000Z'))
  check('旧时间请求不会让 settledAt 倒退', rewind.settledAt === fourth.getTime())
  check('Eventide 内部 last_tick_at 同样不倒退', Date.parse(String(rewind.state.last_tick_at)) === fourth.getTime())

  console.log('\n=== 4. 故障不静默 ===')
  const broken = new EventideStateProvider('http://127.0.0.1:1', 500)
  const brokenHealth = await broken.health()
  check('不可达时 health 返回 ok=false 而非抛出', !brokenHealth.ok)
  check('不可达原因可读', brokenHealth.lastError?.includes('连接 Eventide sidecar 失败') === true, brokenHealth.lastError ?? '')

  if (serverUrl !== undefined) {
    console.log('\n=== 5. habitat-server HTTP 全链 ===')
    const healthResponse = await fetch(`${serverUrl}/api/health/state`)
    const stateHealth = await healthResponse.json() as { ok?: unknown; revision?: unknown }
    check('聚合健康端点识别 sidecar', healthResponse.ok && stateHealth.ok === true)
    check('聚合健康端点下发 revision', stateHealth.revision === '5d8bef965137427e41d97f5b60e5a14c24dd812c')
    const tickResponse = await fetch(`${serverUrl}/api/state/tick`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    const tickBody = await tickResponse.json() as { settledAt?: unknown; stateCard?: unknown }
    check('HTTP tick 返回状态卡', tickResponse.ok && typeof tickBody.stateCard === 'string' && tickBody.stateCard.includes('<ephemeral_state'))
    const currentResponse = await fetch(`${serverUrl}/api/state`)
    const currentBody = await currentResponse.json() as { snapshot?: { settledAt?: unknown } | null }
    check('HTTP 读取拿到刚持久化的快照', currentResponse.ok && currentBody.snapshot?.settledAt === tickBody.settledAt)
  }
} finally {
  closeDb()
  for (const suffix of ['', '-shm', '-wal']) rmSync(resolve(`${DB_PATH}${suffix}`), { force: true })
}

console.log(`\n=== Eventide probe：${passed} passed / ${failed} failed ===`)
process.exitCode = failed === 0 ? 0 : 1
