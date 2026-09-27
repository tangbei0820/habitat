/** V2-A Provider Center 四通道验收。要求 mock :3334、habitat-server :3100 与独立探针库。 */
import type {
  ApiProfilePublic,
  ProviderCapability,
  ProviderCenterState,
  ProviderDraftModelsResult,
  ProviderDraftTestResult,
  ProviderScheme,
} from '@shared/types.js'

const BASE = process.env.PROBE_SERVER ?? 'http://127.0.0.1:3100'
const UPSTREAM = process.env.PROBE_BASE_URL ?? 'http://127.0.0.1:3334/v1'
const SECRET = 'sk-provider-center-probe'
let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail === '' ? '' : `  ${detail}`}`)
  if (ok) passed += 1
  else failed += 1
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown; text: string }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let parsed: unknown = text
  try { parsed = text === '' ? null : JSON.parse(text) } catch { /* 二进制接口不在此 helper */ }
  return { status: response.status, body: parsed, text }
}

console.log('\n=== 1. 建连接（密钥仍只写不读） ===')
const createdRes = await call('POST', '/api/providers', {
  name: '四通道验收连接', baseUrl: UPSTREAM,
  modelMap: { chat: 'mock-chat-small', tts: 'mock-tts', transcription: 'mock-transcription', vision: 'mock-vision', image: 'mock-image' },
})
const profile = createdRes.body as ApiProfilePublic
check('连接创建成功', createdRes.status === 201 && profile.id !== '')
await call('PUT', `/api/providers/${encodeURIComponent(profile.id)}/secret`, { secret: SECRET })
const listText = (await call('GET', '/api/providers')).text
check('密钥不从列表回显', !listText.includes(SECRET))

console.log('\n=== 2. 未保存草稿拉模型 ===')
const draftModelsRes = await call('POST', '/api/providers/draft/models', { baseUrl: UPSTREAM, apiKey: SECRET })
const draftModels = draftModelsRes.body as ProviderDraftModelsResult
check('草稿可拉模型', draftModels.ok && draftModels.models.includes('mock-image'), JSON.stringify(draftModels.models))
check('草稿响应不回显密钥', !draftModelsRes.text.includes(SECRET))

console.log('\n=== 3. 四类真实能力测试 ===')
const models: Record<ProviderCapability, string> = { chat: 'mock-chat-small', voice: 'mock-tts', vision: 'mock-vision', image: 'mock-image' }
const tests = new Map<ProviderCapability, ProviderDraftTestResult>()
for (const capability of Object.keys(models) as ProviderCapability[]) {
  const response = await call('POST', '/api/providers/draft/test', {
    profileId: profile.id, capability, model: models[capability],
    ...(capability === 'voice' ? { secondaryModel: 'mock-transcription' } : {}),
  })
  const result = response.body as ProviderDraftTestResult
  tests.set(capability, result)
  check(`${capability} 执行真实最小调用`, result.ok, result.error ?? '')
  check(`${capability} 测试不回显密钥`, !response.text.includes(SECRET))
}
check('语音测试返回可试听音频', tests.get('voice')?.previewDataUrl?.startsWith('data:audio/') === true)
check('识图测试返回描述', (tests.get('vision')?.description?.length ?? 0) > 0)
check('生图测试返回预览', tests.get('image')?.previewDataUrl?.startsWith('data:image/') === true)

console.log('\n=== 4. 保存四个独立绑定 ===')
for (const capability of Object.keys(models) as ProviderCapability[]) {
  const test = tests.get(capability)
  const saved = await call('PUT', '/api/provider-center/bindings', {
    capability, profileId: profile.id, model: models[capability],
    secondaryModel: capability === 'voice' ? 'mock-transcription' : null,
    lastTestedAt: test?.testedAt, lastLatencyMs: test?.latencyMs, lastError: test?.error,
  })
  check(`${capability} 绑定保存`, saved.status === 200)
}
const center = (await call('GET', '/api/provider-center')).body as ProviderCenterState
check('四个绑定彼此独立且齐全', center.bindings.length === 4, center.bindings.map((item) => item.capability).join(','))

console.log('\n=== 5. 默认业务路径读取绑定 ===')
const chat = await fetch(`${BASE}/api/chat`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Provider Center 验收' }] }),
})
const chatText = await chat.text()
check('不传 profileId 的聊天走主聊天绑定', chat.status === 200 && chatText.includes('event: chat-done'))
const speech = await fetch(`${BASE}/api/media/speech`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '测试' }),
})
check('不传 profileId 的 TTS 走语音绑定', speech.status === 200 && (speech.headers.get('content-type') ?? '').startsWith('audio/'))

console.log('\n=== 6. 方案快照与原子切换 ===')
const schemeRes = await call('POST', '/api/provider-center/schemes', { name: '完整四通道' })
const scheme = schemeRes.body as ProviderScheme
check('四通道可存为完整方案', schemeRes.status === 201 && scheme.isActive)
await call('PUT', '/api/provider-center/bindings', {
  capability: 'chat', profileId: profile.id, model: 'mock-chat-pro', secondaryModel: null,
})
const afterManual = (await call('GET', '/api/provider-center')).body as ProviderCenterState
check('手改单卡后不再冒充命名方案', !afterManual.schemes.some((item) => item.isActive))
const activated = await call('POST', `/api/provider-center/schemes/${scheme.id}/activate`)
const afterActivate = (await call('GET', '/api/provider-center')).body as ProviderCenterState
check('切换方案成功', activated.status === 200 && afterActivate.schemes.some((item) => item.id === scheme.id && item.isActive))
check('切换原子恢复四张卡', afterActivate.bindings.length === 4 && afterActivate.bindings.find((item) => item.capability === 'chat')?.model === 'mock-chat-small')
const renamed = await call('PATCH', `/api/provider-center/schemes/${scheme.id}`, { name: '完整四通道（改名）' })
check('方案可重命名', (renamed.body as ProviderScheme).name.includes('改名'))
const copied = await call('POST', `/api/provider-center/schemes/${scheme.id}/copy`, { name: '完整四通道副本' })
check('方案可复制', copied.status === 201)
check('方案副本可删除', (await call('DELETE', `/api/provider-center/schemes/${(copied.body as ProviderScheme).id}`)).status === 200)

console.log('\n=== 7. 引用保护 ===')
const blocked = await call('DELETE', `/api/providers/${encodeURIComponent(profile.id)}`)
check('仍被绑定/方案引用的连接禁止删除', blocked.status === 400 && blocked.text.includes('仍被引用'))

console.log(`\n=== 汇总：通过 ${passed} / ${passed + failed} ===`)
if (failed > 0) process.exitCode = 1
