/** T-078：表情包自主工具纯逻辑验收。 */
import type { CapabilitySnapshot } from '@shared/capabilities.js'
import { buildBoundTools, executeTool } from '../src/capabilities/tools.js'

const catalog = [
  { id: 'sticker-happy', name: '开心抱抱', category: '情绪', tags: ['开心', '拥抱'] },
  { id: 'sticker-night', name: '晚安小熊', category: '日常', tags: ['晚安', '睡觉'] },
] as const

const snapshot: CapabilitySnapshot[] = [
  { id: 'sticker.search', module: 'tools', label: '搜索表情包', summary: '', modelHint: '', enabled: true, autonomy: 'autonomous', toolName: 'sticker_search' },
  { id: 'sticker.send', module: 'tools', label: '发送表情包', summary: '', modelHint: '', enabled: true, autonomy: 'autonomous', toolName: 'sticker_send' },
]
const tools = buildBoundTools(snapshot)
const runtime = { memory: null, state: null, capabilities: {} as never, stickerCatalog: catalog }
let passed = 0
let failed = 0

function check(label: string, condition: boolean): void {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    console.log(`  ✗ ${label}`)
  }
}

const search = tools.find((tool) => tool.name === 'sticker_search')
const send = tools.find((tool) => tool.name === 'sticker_send')
if (search === undefined || send === undefined) {
  console.error('表情工具未绑定')
  process.exit(1)
}

const found = await executeTool(search, { id: 'probe-search', name: 'sticker_search', arguments: JSON.stringify({ query: '晚安' }) }, runtime)
check('搜索只返回匹配的本地元数据', found.ok && found.text.includes('sticker-night') && !found.text.includes('sticker-happy'))

const sent = await executeTool(send, { id: 'probe-send', name: 'sticker_send', arguments: JSON.stringify({ stickerId: 'sticker-night' }) }, runtime)
check('发送返回成功与稳定 stickerId', sent.ok && sent.stickerId === 'sticker-night')

const unknownRuntime = { memory: null, state: null, capabilities: {} as never, stickerCatalog: catalog }
const rejected = await executeTool(send, { id: 'probe-bad-send', name: 'sticker_send', arguments: JSON.stringify({ stickerId: 'not-in-catalog' }) }, unknownRuntime)
check('不能发送本轮图库之外的 id', !rejected.ok && rejected.text.includes('不在本轮可用图库'))

const duplicate = await executeTool(send, { id: 'probe-duplicate-send', name: 'sticker_send', arguments: JSON.stringify({ stickerId: 'sticker-night' }) }, runtime)
check('同一轮不会重复发送第二张', !duplicate.ok && duplicate.text.includes('未重复发送'))

console.log(`probe-sticker-tools: ${passed}/${passed + failed}`)
if (failed > 0) process.exit(1)
