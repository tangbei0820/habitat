/** V2-D 一起听第一切片：服务端共享会话契约探针。 */
const base = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3101').replace(/\/$/, '')
const headers = { 'content-type': 'application/json' }
let passed = 0
let failed = 0

function check(label: string, ok: boolean): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}`) }
  else { failed += 1; console.log(`  ✗ ${label}`) }
}

async function request(path: string, init?: RequestInit): Promise<{ status: number; body: unknown; text: string }> {
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  let body: unknown = null
  try { body = text === '' ? null : JSON.parse(text) } catch { body = text }
  return { status: response.status, body, text }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

console.log(`\n=== Listening session probe (${base}) ===`)
await request('/api/listening/queue', { method: 'POST', headers, body: JSON.stringify({ action: 'clear' }) })
const initial = await request('/api/listening/session')
check('当前会话可读且默认为空', initial.status === 200 && record(initial.body).id === 'main' && record(initial.body).track === null && Array.isArray(record(initial.body).queue))

const track = { id: `probe-track-${process.pid}`, title: '探针曲目', artist: '探针歌手', externalUrl: 'https://example.com/probe.mp3' }
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const month = today.slice(0, 7)
const baselineMonth = await request(`/api/life/month?month=${month}`)
const baselineDay = ((record(baselineMonth.body).days as Array<Record<string, unknown>> | undefined) ?? []).find((day) => day.dayKey === today)
const baselineListeningMs = typeof baselineDay?.listeningDurationMs === 'number' ? baselineDay.listeningDurationMs : 0
const updated = await request('/api/listening/session', { method: 'PUT', headers, body: JSON.stringify({ track, state: 'playing', positionSeconds: 12.5 }) })
check('可写入播放中的曲目快照', updated.status === 200 && record(updated.body).state === 'playing' && record(record(updated.body).track).title === '探针曲目')
const persisted = await request('/api/listening/session')
check('刷新读取仍保留曲目与播放位置', persisted.status === 200 && record(persisted.body).positionSeconds === 12.5 && record(record(persisted.body).track).id === track.id)

const queued = await request('/api/listening/queue', { method: 'POST', headers, body: JSON.stringify({ action: 'add', track }) })
const duplicated = await request('/api/listening/queue', { method: 'POST', headers, body: JSON.stringify({ action: 'add', track }) })
check('曲目可以加入共享队列且重复加入幂等', queued.status === 200 && Array.isArray(record(queued.body).items) && (record(queued.body).items as unknown[]).length === 1 && duplicated.status === 200 && (record(duplicated.body).items as unknown[]).length === 1)
const comment = await request('/api/listening/comments', { method: 'POST', headers, body: JSON.stringify({ track, content: '这首歌留给我们。' }) })
const comments = await request(`/api/listening/comments?trackId=${encodeURIComponent(track.id)}`)
check('逐曲评论可写入并按曲目读取', comment.status === 200 && record(comment.body).author === 'user' && comments.status === 200 && (record(comments.body).items as unknown[]).length === 1)

await request('/api/listening/session', { method: 'PUT', headers, body: JSON.stringify({ track, state: 'playing', positionSeconds: 22.5 }) })
await request('/api/listening/session', { method: 'PUT', headers, body: JSON.stringify({ track, state: 'paused', positionSeconds: 25.5 }) })
const history = await request('/api/listening/history?limit=10')
const historyItems = (record(history.body).items as Array<Record<string, unknown>> | undefined) ?? []
const historyTrack = historyItems.find((item) => item.trackId === track.id)
check('共同听历史聚合播放次数与真实时长', history.status === 200 && historyTrack?.title === track.title && historyTrack?.playCount === 1 && historyTrack?.totalSeconds === 13)
const lifeDay = await request(`/api/life/day/${today}`)
const lifeMonth = await request(`/api/life/month?month=${month}`)
const daySummary = (record(lifeMonth.body).days as Array<Record<string, unknown>> | undefined)?.find((day) => day.dayKey === today)
const timeline = record(lifeDay.body).timeline as Array<Record<string, unknown>> | undefined
check('播放事实进入 Life 时间线且按曲目合并', lifeDay.status === 200 && timeline?.some((item) => item.eventType === 'listening.track.started') === true && timeline?.some((item) => item.eventType === 'listening.progress' && item.detail === '累计 13 秒') === true)
check('月历汇总真实一起听秒数', lifeMonth.status === 200 && daySummary?.listeningDurationMs === baselineListeningMs + 13_000)

const bad = await request('/api/listening/session', { method: 'PUT', headers, body: JSON.stringify({ track: { ...track, externalUrl: 'javascript:alert(1)' }, state: 'paused', positionSeconds: 0 }) })
check('拒绝非 HTTP(S) 音源地址', bad.status === 400)

const cleared = await request('/api/listening/session', { method: 'PUT', headers, body: JSON.stringify({ track: null, state: 'idle', positionSeconds: 0 }) })
check('可清空当前会话且不残留播放状态', cleared.status === 200 && record(cleared.body).track === null && record(cleared.body).state === 'idle')
const removed = await request('/api/listening/queue', { method: 'POST', headers, body: JSON.stringify({ action: 'remove', track }) })
check('队列曲目可以移除', removed.status === 200 && (record(removed.body).items as unknown[]).length === 0)

console.log(`\nListening session probe: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1

export {}
