/** Core-3 记忆闭环验收：自主写入、no-op、去重、修正、来源回链与上下文回灌。 */
export {}

const SERVER = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3239').replace(/\/+$/, '')
const MOCK = (process.env.PROBE_MOCK ?? 'http://127.0.0.1:3334').replace(/\/+$/, '')
let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}${detail === '' ? '' : `  ${detail}`}`) }
  else { failed += 1; console.log(`  ✗ ${label}${detail === '' ? '' : `  ${detail}`}`) }
}

async function request(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string> | undefined) ?? {}) }
  if (init?.body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${SERVER}${path}`, { ...init, headers })
  const text = await response.text()
  let body: unknown = null
  try { body = text === '' ? null : JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}

async function chat(profileId: string, message: string): Promise<Array<{ event: string; data: unknown }>> {
  const response = await fetch(`${SERVER}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId, sessionId: 'probe-memory-core3', messages: [{ role: 'user', content: message }] }),
  })
  const raw = await response.text()
  const frames: Array<{ event: string; data: unknown }> = []
  for (const block of raw.split(/\r?\n\r?\n/)) {
    let event = ''
    const data: string[] = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      if (line.startsWith('data:')) data.push(line.slice(5).trim())
    }
    if (event === '' || data.length === 0) continue
    try { frames.push({ event, data: JSON.parse(data.join('\n')) }) } catch { /* ignore malformed keepalive */ }
  }
  return frames
}

const create = await request('/api/providers', {
  method: 'POST',
  body: JSON.stringify({ name: 'Core3 记忆验收', baseUrl: `${MOCK}/v1`, modelMap: { chat: 'mock-chat-small' } }),
})
const profileId = typeof create.body === 'object' && create.body !== null && 'id' in create.body
  ? String((create.body as { id: unknown }).id)
  : null
check('临时 Provider 就绪', create.status === 201 && profileId !== null, `status=${create.status}`)

if (profileId !== null) {
  await request(`/api/providers/${encodeURIComponent(profileId)}/secret`, { method: 'PUT', body: JSON.stringify({ secret: 'sk-probe-core3' }) })

  const capabilities = await request('/api/capabilities')
  const list = typeof capabilities.body === 'object' && capabilities.body !== null && 'capabilities' in capabilities.body
    ? (capabilities.body as { capabilities: Array<{ id: string; enabled: boolean; autonomy: string; toolName?: string }> }).capabilities
    : []
  const memoryWrite = list.find((item) => item.id === 'memory.write')
  check('memory.write 已启用且是 autonomous', memoryWrite?.enabled === true && memoryWrite.autonomy === 'autonomous' && memoryWrite.toolName === 'memory_write')

  const beforeAudit = ((await request('/api/memory/audit')).body as { items: unknown[] }).items.length
  const writtenFrames = await chat(profileId, '[[tool:memory_write {"content":"Core3 验收：北北喜欢雨天散步。","name":"验收偏好","kind":"memory","tags":"probe"}]]')
  const written = writtenFrames.find((frame) => frame.event === 'tool-call')?.data as { ok?: boolean; summary?: string; eventId?: string } | undefined
  check('自主写入返回成功卡片', written?.ok === true && (written.summary ?? '').includes('已写入'))
  check('自主写入不产生用户确认事件', written?.eventId === undefined)

  const auditsAfterWrite = (await request('/api/memory/audit')).body as { items: Array<{ status: string; source: Record<string, unknown>; contentPreview: string }> }
  const latest = auditsAfterWrite.items[0]
  check('审计状态为 written', latest?.status === 'written')
  check('审计保存聊天来源回链', latest?.source.kind === 'chat' && latest.source.sessionId === 'probe-memory-core3')
  check('审计不泄漏完整正文，只留预览', (latest?.contentPreview.length ?? 0) > 0 && (latest?.contentPreview.length ?? 0) <= 180)
  check('写入动作确实新增一条审计', auditsAfterWrite.items.length === beforeAudit + 1)

  const repeatFrames = await chat(profileId, '[[tool:memory_write {"content":"Core3 验收：北北喜欢雨天散步。","name":"验收偏好","kind":"memory","tags":"probe"}]]')
  const repeated = repeatFrames.find((frame) => frame.event === 'tool-call')?.data as { ok?: boolean; summary?: string } | undefined
  check('重复记忆被识别且不报失败', repeated?.ok === true && ((repeated.summary ?? '').includes('去重') || (repeated.summary ?? '').includes('没有重复写入')))
  check('重复记忆没有新增审计行', ((await request('/api/memory/audit')).body as { items: unknown[] }).items.length === beforeAudit + 1)

  const correctionFrames = await chat(profileId, '[[tool:memory_write {"content":"修正：北北更喜欢阴天散步。","mode":"correction","correctionOf":"验收偏好","kind":"memory"}]]')
  const correction = correctionFrames.find((frame) => frame.event === 'tool-call')?.data as { ok?: boolean; summary?: string } | undefined
  check('修正采用追加语义且真实写入', correction?.ok === true && (correction.summary ?? '').includes('已写入'))
  const auditsAfterCorrection = (await request('/api/memory/audit')).body as { items: Array<{ mode: string; correctionOf: string | null }> }
  check('修正来源与线索可追溯', auditsAfterCorrection.items.some((item) => item.mode === 'correction' && item.correctionOf === '验收偏好'))

  const noOpBefore = auditsAfterCorrection.items.length
  await chat(profileId, '普通聊天，不需要记住任何长期事实。')
  const noOpAfter = ((await request('/api/memory/audit')).body as { items: unknown[] }).items.length
  check('模型不调用 memory_write 时保持 no-op', noOpAfter === noOpBefore)

  const boot = await request('/api/memory/boot')
  check('下一次读取能看到真实写入结果', boot.status === 200 && typeof (boot.body as { text?: unknown }).text === 'string' && (boot.body as { text: string }).text.includes('Core3 验收'))
  const searched = await request('/api/memory/search?q=' + encodeURIComponent('阴天散步'))
  check('关键词搜索能看到修正记忆', searched.status === 200 && typeof (searched.body as { text?: unknown }).text === 'string' && (searched.body as { text: string }).text.includes('阴天散步'))

  await request(`/api/providers/${encodeURIComponent(profileId)}`, { method: 'DELETE' })
}

console.log(`\n=== Core-3 Nocturne memory：${passed} passed / ${failed} failed ===`)
process.exitCode = failed === 0 ? 0 : 1
