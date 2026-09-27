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
const initial = await request('/api/listening/session')
check('当前会话可读且默认为空', initial.status === 200 && record(initial.body).id === 'main' && record(initial.body).track === null)

const track = { id: `probe-track-${process.pid}`, title: '探针曲目', artist: '探针歌手', externalUrl: 'https://example.com/probe.mp3' }
const updated = await request('/api/listening/session', { method: 'PUT', headers, body: JSON.stringify({ track, state: 'playing', positionSeconds: 12.5 }) })
check('可写入播放中的曲目快照', updated.status === 200 && record(updated.body).state === 'playing' && record(record(updated.body).track).title === '探针曲目')
const persisted = await request('/api/listening/session')
check('刷新读取仍保留曲目与播放位置', persisted.status === 200 && record(persisted.body).positionSeconds === 12.5 && record(record(persisted.body).track).id === track.id)

const bad = await request('/api/listening/session', { method: 'PUT', headers, body: JSON.stringify({ track: { ...track, externalUrl: 'javascript:alert(1)' }, state: 'paused', positionSeconds: 0 }) })
check('拒绝非 HTTP(S) 音源地址', bad.status === 400)

const cleared = await request('/api/listening/session', { method: 'PUT', headers, body: JSON.stringify({ track: null, state: 'idle', positionSeconds: 0 }) })
check('可清空当前会话且不残留播放状态', cleared.status === 200 && record(cleared.body).track === null && record(cleared.body).state === 'idle')

console.log(`\nListening session probe: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1

export {}
