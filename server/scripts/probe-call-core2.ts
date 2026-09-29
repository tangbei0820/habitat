/** Core-2 call lifecycle probe: idempotent transitions, ordered turns, and SSE ids. */
export {}

const base = process.env.PROBE_SERVER ?? 'http://127.0.0.1:3239'
const headers = { 'content-type': 'application/json' }
let passed = 0
let failed = 0
function check(label: string, ok: boolean): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}`) } else { failed += 1; console.log(`  ✗ ${label}`) }
}
async function json(path: string, body?: unknown): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, body === undefined ? undefined : { method: 'POST', headers, body: JSON.stringify(body) })
  return { response, body: await response.json() as Record<string, unknown> }
}

console.log('\n=== Core-2 call probe ===')
const chatSessionId = `probe-call-${Date.now()}`
const created = await json('/api/calls', { chatSessionId })
const call = created.body.call as { id?: string; status?: string } | undefined
check('创建应用内通话进入 ringing', created.response.status === 201 && call?.id !== undefined && call.status === 'ringing')
if (call?.id === undefined) process.exit(1)

const accepted = await json(`/api/calls/${encodeURIComponent(call.id)}/answer`, {})
check('接听进入 active', accepted.response.ok && (accepted.body.call as { status?: string })?.status === 'active')
const acceptedAgain = await json(`/api/calls/${encodeURIComponent(call.id)}/answer`, {})
check('重复接听幂等返回 active', acceptedAgain.response.ok && (acceptedAgain.body.call as { status?: string })?.status === 'active')

const firstTurn = await json(`/api/calls/${encodeURIComponent(call.id)}/turns`, { speaker: 'user', text: '第一句' })
const secondTurn = await json(`/api/calls/${encodeURIComponent(call.id)}/turns`, { speaker: 'companion', text: '第二句' })
check('逐句记录成功', firstTurn.response.status === 201 && secondTurn.response.status === 201)
const detail = await json(`/api/calls/${encodeURIComponent(call.id)}`)
const turns = detail.body.turns as Array<{ sequence?: number }> | undefined
check('历史按 sequence 保持顺序', Array.isArray(turns) && turns.length === 2 && turns[0]?.sequence === 0 && turns[1]?.sequence === 1)

const ended = await json(`/api/calls/${encodeURIComponent(call.id)}/hangup`, { status: 'ended' })
const endedAgain = await json(`/api/calls/${encodeURIComponent(call.id)}/hangup`, { status: 'ended' })
check('挂断写入 ended', ended.response.ok && (ended.body.call as { status?: string })?.status === 'ended')
check('重复挂断幂等返回 ended', endedAgain.response.ok && (endedAgain.body.call as { status?: string })?.status === 'ended')
const list = await json(`/api/calls?chatSessionId=${encodeURIComponent(chatSessionId)}`)
check('会话列表可回看通话', list.response.ok && Array.isArray(list.body.calls) && (list.body.calls as unknown[]).length === 1)

const sseCallResponse = await json('/api/calls', { chatSessionId: `${chatSessionId}-sse` })
const sseCall = sseCallResponse.body.call as { id?: string } | undefined
if (sseCall?.id !== undefined) {
  const controller = new AbortController()
  const stream = await fetch(`${base}/api/calls/${encodeURIComponent(sseCall.id)}/events`, { signal: controller.signal })
  const reader = stream.body?.getReader()
  await json(`/api/calls/${encodeURIComponent(sseCall.id)}/answer`, {})
  let frame = ''
  const deadline = Date.now() + 3_000
  while (reader !== undefined && Date.now() < deadline && !frame.includes('eventId')) {
    const next = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value?: Uint8Array }>((resolve) => setTimeout(() => resolve({ done: true }), 500)),
    ])
    if (next.done) continue
    frame += new TextDecoder().decode(next.value)
  }
  check('通话 SSE 帧带 event id', stream.ok && frame.includes('id: ') && frame.includes('eventId'))
  controller.abort()
  await json(`/api/calls/${encodeURIComponent(sseCall.id)}/hangup`, { status: 'ended' })
} else check('通话 SSE 帧带 event id', false)

console.log(`\nCore-2 call API：通过 ${passed}/${passed + failed}`)
if (failed > 0) process.exitCode = 1
