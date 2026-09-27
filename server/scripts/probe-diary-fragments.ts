/** AI 私密日记片段级权限：数据过滤 + 能力工具探针。 */
import { eq } from 'drizzle-orm'
import { CAPABILITY_DEFINITIONS } from '@shared/capabilities.js'
import { db } from '../src/db/index.js'
import { diary } from '../src/db/schema.js'
import { createCompanionDiary, getDiaryView } from '../src/db/diary.js'
import { executeTool, type BoundTool } from '../src/capabilities/tools.js'

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
} finally {
  db.delete(diary).where(eq(diary.id, created.id)).run()
}

console.log(`\nDiary fragment probe: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1

export {}
