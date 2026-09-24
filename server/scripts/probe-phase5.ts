/** Phase 5 媒体 / 工具 API 全链探针：需先启动 mock OpenAI 与隔离 habitat-server。 */
export {}

const base = process.env.PROBE_SERVER ?? 'http://127.0.0.1:3239'
const headers = { 'content-type': 'application/json' }
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const tinyWav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}${detail === '' ? '' : `  ${detail}`}`) }
  else { failed += 1; console.log(`  ✗ ${label}${detail === '' ? '' : `  ${detail}`}`) }
}

async function json(path: string, body?: unknown): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, body === undefined ? undefined : { method: 'POST', headers, body: JSON.stringify(body) })
  return { response, body: await response.json() as Record<string, unknown> }
}

console.log('\n=== Phase 5 media/tool probe ===')
const transcription = await json('/api/media/transcriptions', { dataUrl: tinyWav })
check('音频经服务端转写', transcription.response.ok && transcription.body.text === '这是 mock 转写文本。')

const vision = await json('/api/media/vision', { dataUrl: tinyPng })
check('图片经服务端视觉模型描述', vision.response.ok && vision.body.description === '一张用于验收的图片')

const image = await json('/api/media/images', { prompt: '一片叶子' })
check('图片生成返回可本地保存的 data URL', image.response.ok && String(image.body.dataUrl).startsWith('data:image/png;base64,'))

const speech = await fetch(`${base}/api/media/speech`, { method: 'POST', headers, body: JSON.stringify({ text: '你好' }) })
const speechBytes = await speech.arrayBuffer()
check('TTS 返回音频流', speech.ok && speech.headers.get('content-type') === 'audio/wav' && speechBytes.byteLength > 40)

const tooLarge = await json('/api/media/vision', { dataUrl: `data:image/png;base64,${Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64')}` })
check('媒体上传大小有硬上限', tooLarge.response.status === 400)

const badMime = await json('/api/media/transcriptions', { dataUrl: tinyPng })
check('音频端点拒绝图片 MIME', badMime.response.status === 400)

const tools = await json('/api/tools')
check('无 MCP 时工具清单真实为空', tools.response.ok && Array.isArray(tools.body.tools) && tools.body.tools.length === 0)

const badTool = await json('/api/tools/call', { serverId: '', name: '', args: {} })
check('工具调用校验显式目标', badTool.response.status === 400)

console.log(`\n=== Phase 5 API：通过 ${passed}/${passed + failed} ===`)
if (failed > 0) process.exitCode = 1
