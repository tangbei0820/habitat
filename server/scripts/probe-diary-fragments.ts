/** AI 私密日记片段级权限：数据过滤 + 能力工具探针。 */
import { eq } from 'drizzle-orm'
import { CAPABILITY_DEFINITIONS } from '@shared/capabilities.js'
import { db } from '../src/db/index.js'
import { diary } from '../src/db/schema.js'
import { createCompanionDiary, getDiaryView } from '../src/db/diary.js'
import { executeTool, type BoundTool } from '../src/capabilities/tools.js'
import { requestDiaryAccess, decideEvent } from '../src/services/event-inbox.js'
import { listEvents } from '../src/db/event.js'
import { listNotifications } from '../src/db/activity.js'
import { runtimeEvent } from '../src/db/schema.js'

let passed = 0
let failed = 0
function check(label: string, ok: boolean): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}`) }
  else { failed += 1; console.log(`  ✗ ${label}`) }
}

const definition = CAPABILITY_DEFINITIONS.find((item) => item.id === 'diary.set_fragment_visibility')
if (definition?.tool === undefined) throw new Error('片段权限能力未登记')
const tool: BoundTool = {
  name: definition.tool.name,
  capabilityId: definition.id,
  label: definition.label,
  source: '日记',
  description: definition.tool.description,
  parameters: definition.tool.parameters,
  autonomy: definition.autonomy,
}

const created = createCompanionDiary({ title: `探针片段日记 ${process.pid}`, content: '第一段仍然私密\n第二段可以分享\n第三段继续锁住', entryDate: '2026-09-27' })
const eventIds: string[] = []
console.log('\n=== Diary fragment privacy probe ===')
try {
  const initial = getDiaryView(created.id)
  check('默认整篇私密且三段均不下发', initial !== null && initial.readable === false && initial.fragments.length === 3 && initial.fragments.every((fragment) => fragment.content === null))

  const opened = await executeTool(tool, { id: 'fragment-probe', name: tool.name, arguments: JSON.stringify({ id: created.id, fragmentId: 'fragment-1', visibility: 'open' }) }, { memory: null, state: null, capabilities: {} as never })
  check('AI 工具可只开放第二段', opened.ok && opened.text.includes('fragment-1'))

  const partial = getDiaryView(created.id)
  check('用户只读到已开放片段', partial !== null && partial.readable && partial.content === null && partial.fragments[0]?.content === null && partial.fragments[1]?.content === '第二段可以分享' && partial.fragments[2]?.content === null)

  const locked = await executeTool(tool, { id: 'fragment-probe', name: tool.name, arguments: JSON.stringify({ id: created.id, fragmentId: 'fragment-1', visibility: 'locked' }) }, { memory: null, state: null, capabilities: {} as never })
  check('AI 工具可把片段重新锁住', locked.ok && getDiaryView(created.id)?.readable === false)

  const bad = await executeTool(tool, { id: 'fragment-probe', name: tool.name, arguments: JSON.stringify({ id: created.id, fragmentId: 'fragment-99', visibility: 'open' }) }, { memory: null, state: null, capabilities: {} as never })
  check('不存在的片段不会被写入', !bad.ok)
  const request = requestDiaryAccess(created.id, 'fragment-1')
  if (request.ok) eventIds.push(request.event.id)
  check('用户可为指定片段发起请求且事件标出片段', request.ok && request.event.targetId === created.id && request.event.targetFragmentId === 'fragment-1')
  const duplicate = requestDiaryAccess(created.id, 'fragment-1')
  check('同一片段重复请求复用原事件', request.ok && duplicate.ok && duplicate.event.id === request.event.id)
  if (request.ok) {
    const decision = await decideEvent(request.event.id, 'companion', true)
    check('AI 同意后只开放被请求片段', decision.ok && getDiaryView(created.id)?.fragments.find((fragment) => fragment.id === 'fragment-1')?.readable === true)
    const settled = listEvents({ decider: 'companion' }).find((item) => item.id === request.event.id)
    check('已结算的片段申请仍出现在申请历史', settled?.status === 'approved' && settled.result !== null)
    check('片段申请结算会生成可追溯的站内通知', listNotifications().some((item) => item.metadata.eventId === request.event.id && item.metadata.category === 'diary'))
  }
  const deniedRequest = requestDiaryAccess(created.id, 'fragment-2')
  if (deniedRequest.ok) eventIds.push(deniedRequest.event.id)
  if (deniedRequest.ok) await decideEvent(deniedRequest.event.id, 'companion', false)
  check('AI 拒绝片段请求时该段仍保持锁定', deniedRequest.ok && getDiaryView(created.id)?.fragments.find((fragment) => fragment.id === 'fragment-2')?.readable === false)
} finally {
  for (const id of eventIds) db.delete(runtimeEvent).where(eq(runtimeEvent.id, id)).run()
  db.delete(diary).where(eq(diary.id, created.id)).run()
}

console.log(`\nDiary fragment probe: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1

export {}
