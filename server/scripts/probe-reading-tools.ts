/** V2-D 共读 Runtime 工具探针：验证书架窗口、段落读取与 Companion 批注闭环。 */
import { CAPABILITY_DEFINITIONS, type CapabilitySnapshot } from '@shared/capabilities'
import type { ChatReadingBookItem } from '@shared/events'
import { buildBoundTools, executeTool, type ToolRuntime } from '../src/capabilities/tools.js'
import type { CapabilityService } from '../src/capabilities/registry.js'

let passed = 0
let failed = 0

function check(label: string, ok: boolean): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}`) }
  else { failed += 1; console.log(`  ✗ ${label}`) }
}

const definitions = CAPABILITY_DEFINITIONS.filter((item) => item.module === 'reading')
const snapshot: CapabilitySnapshot[] = definitions.map((item) => ({
  id: item.id,
  module: item.module,
  label: item.label,
  summary: item.summary,
  modelHint: item.modelHint,
  enabled: true,
  autonomy: item.autonomy,
  ...(item.tool === undefined ? {} : { toolName: item.tool.name }),
}))
const tools = buildBoundTools(snapshot)
const book: ChatReadingBookItem = {
  id: 'reading-probe-book',
  title: '探针之书',
  author: '探针作者',
  format: 'txt',
  currentParagraph: 1,
  bookmarkParagraph: 0,
  readingSeconds: 42,
  totalParagraphs: 3,
  paragraphOffset: 0,
  paragraphs: ['第一段。', '第二段写着一盏灯。', '第三段。'],
  annotations: [],
}
const runtime: ToolRuntime = {
  memory: null,
  state: null,
  capabilities: {} as CapabilityService,
  readingCatalog: [book],
  readingAnnotationKeys: new Set<string>(),
}

async function call(name: string, args: Record<string, unknown>) {
  const tool = tools.find((item) => item.name === name)
  if (tool === undefined) throw new Error(`missing tool ${name}`)
  return executeTool(tool, { id: `probe-${name}`, name, arguments: JSON.stringify(args) }, runtime)
}

console.log('\n=== Reading Runtime tools probe ===')
check('三项共读能力都绑定为模型工具', ['reading_context', 'reading_read', 'reading_annotate'].every((name) => tools.some((tool) => tool.name === name)))

const context = await call('reading_context', {})
check('reading_context 返回书架与进度', context.ok && context.text.includes('探针之书') && context.text.includes('第 2/3 段'))

const read = await call('reading_read', { bookId: book.id, paragraphIndex: 1 })
check('reading_read 返回指定段落原文', read.ok && read.text.includes('第二段写着一盏灯'))

const outside = await call('reading_read', { bookId: book.id, paragraphIndex: 4 })
check('reading_read 拒绝超出全局范围的位置', !outside.ok)

const annotation = await call('reading_annotate', { bookId: book.id, paragraphIndex: 1, text: '第二段写着一盏灯。', note: '这盏灯像是给夜路留下的方向。' })
check('reading_annotate 返回浏览器写回所需的批注锚点', annotation.ok && annotation.readingAnnotation?.bookId === book.id && annotation.readingAnnotation.note.includes('夜路'))

const duplicate = await call('reading_annotate', { bookId: book.id, paragraphIndex: 1, text: '第二段写着一盏灯。', note: '这盏灯像是给夜路留下的方向。' })
check('相同批注在同一轮内不会重复写入', duplicate.ok && duplicate.readingAnnotation === undefined && duplicate.summary.includes('相同'))

console.log(`\nReading Runtime probe: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1

export {}
