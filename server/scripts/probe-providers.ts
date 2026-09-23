/**
 * API 方案路由验收脚本（**要求 server 已启动**）
 *
 * 前置：
 *   1) npm run dev:mock-openai                              # mock 上游 :3334
 *   2) PORT=3100 HABITAT_DB_PATH=./data/probe.db npm run dev:server
 *   3) npx tsx scripts/probe-providers.ts
 *
 * 覆盖：列表 / 新建 / 字段校验 / 更新 / 凭据生命周期（写入 → 生效 → 清除 → 回落）/
 *       设为默认（互斥）/ 删除（含 active 自动转移）/ id 生成 / 视图脱敏 / 端到端聊天 /
 *       stream_options 兼容开关的读写与校验。
 *
 * ⚠️ 脚本自己建的方案会在结束前删掉，可重复运行。
 * 退出码非 0 表示有断言失败。
 */
import type { ApiProfilePublic, LlmProbeResult } from '@shared/types.js'

const BASE = process.env.PROBE_SERVER ?? 'http://127.0.0.1:3100'
const MOCK_BASE_URL = process.env.PROBE_BASE_URL ?? 'http://127.0.0.1:3334/v1'
/** 用来验证「写进去的密钥不会从任何接口读出来」 */
const SECRET = 'sk-ui-secret-9f3a'

let passed = 0
let failed = 0

function check(label: string, ok: boolean, extra = ''): void {
  const suffix = extra === '' ? '' : `  ${extra}`
  if (ok) {
    passed += 1
    console.log(`  ✓ ${label}${suffix}`)
  } else {
    failed += 1
    console.log(`  ✗ ${label}${suffix}`)
  }
}

interface Res {
  status: number
  body: unknown
}

async function call(method: string, path: string, body?: unknown): Promise<Res> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text === '' ? null : JSON.parse(text)
  } catch {
    parsed = text
  }
  return { status: res.status, body: parsed }
}

interface ProviderListBody {
  active: ApiProfilePublic | null
  profiles: ApiProfilePublic[]
}

async function listProfiles(): Promise<ProviderListBody> {
  return (await call('GET', '/api/providers')).body as ProviderListBody
}

function errorCode(res: Res): string {
  const body = res.body as { error?: { code?: string } }
  return body.error?.code ?? '(无 error.code)'
}

/** 本次脚本建出来的方案，结束前统一清掉 */
const created: string[] = []

function remember(profile: ApiProfilePublic): ApiProfilePublic {
  created.push(profile.id)
  return profile
}

const validInput = {
  name: 'UI 方案',
  baseUrl: MOCK_BASE_URL,
  modelMap: { chat: 'mock-chat-small' },
}

console.log('\n=== 0. 列表与脱敏 ===')
const initial = await listProfiles()
check('GET /api/providers 可读', Array.isArray(initial.profiles))
console.log(`    当前方案：${initial.profiles.map((p) => `${p.id}(${p.keySource})`).join(', ') || '（无）'}`)
check('视图里不含任何密钥明文', !JSON.stringify(initial).includes(SECRET))
if (initial.active !== null) {
  check('active 指向的 id 确实在列表里', initial.profiles.some((p) => p.id === initial.active?.id))
}

console.log('\n=== 1. 新建 ===')
// 先把「库里已有一个默认」这个前提**显式造出来**。
// 之前这里直接断言 made.isActive === false，隐含假设库里已有默认 —— 空库跑就必然假失败，
// 而空库首条自动成为默认是 createProfile 的**设计行为**（单方案场景不该还要多按一次）。
if (initial.active === null) {
  const seeded = remember(
    (await call('POST', '/api/providers', { ...validInput, name: '默认占位', isActive: true }))
      .body as ApiProfilePublic,
  )
  check('空库首条自动成为默认（设计如此）', seeded.isActive === true, `isActive=${seeded.isActive}`)
}

const createRes = await call('POST', '/api/providers', validInput)
check('新建返回 201', createRes.status === 201, `status=${createRes.status}`)
const made = remember(createRes.body as ApiProfilePublic)
check('id 由名称生成（UI 方案 → ui-方案）', made.id === 'ui-方案', `id=${made.id}`)
check('keyRef 留空 → keySource=not-required', made.keySource === 'not-required' && made.hasKey === true)
check('已有默认方案时不抢默认', made.isActive === false, `isActive=${made.isActive}`)
const afterCreate = await listProfiles()
check('列表里多了一条', afterCreate.profiles.some((p) => p.id === made.id))

console.log('\n=== 2. 字段校验 ===')
const badInputs: Array<[string, unknown]> = [
  ['缺 name', { ...validInput, name: undefined }],
  ['baseUrl 不是 URL', { ...validInput, baseUrl: '不是网址' }],
  ['baseUrl 协议不支持', { ...validInput, baseUrl: 'ftp://example.com/v1' }],
  ['modelMap 缺 chat', { ...validInput, modelMap: {} }],
  ['keyRef 不是环境变量名', { ...validInput, keyRef: '123bad' }],
]
for (const [label, input] of badInputs) {
  const res = await call('POST', '/api/providers', input)
  check(`${label} → 400 BAD_REQUEST`, res.status === 400 && errorCode(res) === 'BAD_REQUEST', `status=${res.status} ${errorCode(res)}`)
}

const emptyPatch = await call('PATCH', `/api/providers/${made.id}`, {})
check('PATCH 空对象 → 400', emptyPatch.status === 400, `status=${emptyPatch.status}`)
const patchMissing = await call('PATCH', '/api/providers/不存在的方案', { name: 'x' })
check('PATCH 未知 id → 404 PROVIDER_NOT_FOUND', patchMissing.status === 404 && errorCode(patchMissing) === 'PROVIDER_NOT_FOUND')
const delMissing = await call('DELETE', '/api/providers/不存在的方案')
check('DELETE 未知 id → 404', delMissing.status === 404)
const modelsMissing = await call('GET', '/api/providers/不存在的方案/models')
check('GET /models 未知 id → 404', modelsMissing.status === 404)

console.log('\n=== 3. 更新 ===')
const patchRes = await call('PATCH', `/api/providers/${made.id}`, {
  name: 'UI 方案（改名）',
  modelMap: { chat: 'mock-chat-pro' },
})
const patched = patchRes.body as ApiProfilePublic
check('name 已更新', patched.name === 'UI 方案（改名）', patched.name)
check('modelMap.chat 已更新', patched.modelMap.chat === 'mock-chat-pro', String(patched.modelMap.chat))
check('未送来的字段保持不变', patched.baseUrl === MOCK_BASE_URL)

const trailing = await call('POST', '/api/providers', { ...validInput, name: '尾斜杠', baseUrl: `${MOCK_BASE_URL}/` })
const trailingProfile = remember(trailing.body as ApiProfilePublic)
check('baseUrl 结尾斜杠被去掉', trailingProfile.baseUrl === MOCK_BASE_URL, trailingProfile.baseUrl)

console.log('\n=== 4. 凭据生命周期 ===')
const beforeKey = await call('POST', `/api/providers/${made.id}/test`)
check(
  '无密钥（keyRef 留空）→ 上游 401，探测 ok=false',
  (beforeKey.body as LlmProbeResult).ok === false,
  (beforeKey.body as LlmProbeResult).error ?? '',
)

const putKey = await call('PUT', `/api/providers/${made.id}/secret`, { secret: SECRET })
check('写入密钥 → keySource=stored', putKey.status === 200 && (putKey.body as { keySource: string }).keySource === 'stored')
check('写入回执不含密钥本身', !JSON.stringify(putKey.body).includes(SECRET))

const viewAfterKey = await listProfiles()
check('列表接口依然读不到密钥', !JSON.stringify(viewAfterKey).includes(SECRET))

const afterKey = await call('POST', `/api/providers/${made.id}/test`)
const afterKeyBody = afterKey.body as LlmProbeResult
check('填了密钥后连得上', afterKeyBody.ok === true, afterKeyBody.error ?? `modelCount=${afterKeyBody.modelCount}`)
check('探测回执里也不含密钥', !JSON.stringify(afterKey.body).includes(SECRET))

const modelsRes = await call('GET', `/api/providers/${made.id}/models`)
check(
  'GET /models 取到 mock 的 3 个模型',
  (modelsRes.body as { models: string[] }).models.length === 3,
  JSON.stringify((modelsRes.body as { models: string[] }).models),
)

const clearRes = await call('DELETE', `/api/providers/${made.id}/secret`)
check(
  '清除密钥后回落到 not-required（keyRef 留空）',
  clearRes.status === 200 && (clearRes.body as { keySource: string }).keySource === 'not-required',
)
const afterClear = await call('POST', `/api/providers/${made.id}/test`)
check('清除后确实调不通了', (afterClear.body as LlmProbeResult).ok === false)

// 恢复密钥，供后面端到端聊天用
await call('PUT', `/api/providers/${made.id}/secret`, { secret: SECRET })

console.log('\n=== 5. 设为默认（互斥） ===')
const activateRes = await call('POST', `/api/providers/${made.id}/activate`)
check('激活返回 active', activateRes.status === 200 && (activateRes.body as { active: ApiProfilePublic }).active.id === made.id)
const afterActivate = await listProfiles()
check('恰好一条 active', afterActivate.profiles.filter((p) => p.isActive).length === 1, JSON.stringify(afterActivate.profiles.map((p) => `${p.id}:${p.isActive}`)))
check('active 就是刚激活的那条', afterActivate.active?.id === made.id)

console.log('\n=== 6. id 生成 ===')
const dup1 = remember((await call('POST', '/api/providers', { ...validInput, name: '同名方案' })).body as ApiProfilePublic)
const dup2 = remember((await call('POST', '/api/providers', { ...validInput, name: '同名方案' })).body as ApiProfilePublic)
check('同名方案 id 不冲突', dup1.id !== dup2.id, `${dup1.id} / ${dup2.id}`)
const cjk = remember(
  (await call('POST', '/api/providers', { ...validInput, name: '本地测试上游' })).body as ApiProfilePublic,
)
check('中文名原样保留在 id 里（账本 / 日志看得懂）', cjk.id === '本地测试上游', cjk.id)
check('中文名原文保留在 name', cjk.name === '本地测试上游')

console.log('\n=== 7. 删除与 active 转移 ===')
const delRes = await call('DELETE', `/api/providers/${dup1.id}`)
check('删除返回 deleted', delRes.status === 200 && (delRes.body as { deleted: boolean }).deleted === true)
const afterDelete = await listProfiles()
check('列表里已消失', !afterDelete.profiles.some((p) => p.id === dup1.id))
check('删掉非默认方案不影响 active', afterDelete.active?.id === made.id)

// 删掉当前默认方案 → active 必须自动落到剩下的某一条上，不能出现「有方案但无默认」
await call('DELETE', `/api/providers/${made.id}`)
created.splice(created.indexOf(made.id), 1)
const afterDeleteActive = await listProfiles()
if (afterDeleteActive.profiles.length > 0) {
  check('删掉默认方案后 active 自动转移', afterDeleteActive.active !== null, afterDeleteActive.active?.id ?? 'null')
  check('仍然恰好一条 active', afterDeleteActive.profiles.filter((p) => p.isActive).length === 1)
} else {
  check('删掉默认方案后 active 自动转移', afterDeleteActive.active === null, '（库已空，active 为 null 正确）')
}

console.log('\n=== 8. 端到端：用数据库里的方案聊天 ===')
const chatTarget = remember((await call('POST', '/api/providers', { ...validInput, name: '端到端', isActive: true })).body as ApiProfilePublic)
await call('PUT', `/api/providers/${chatTarget.id}/secret`, { secret: SECRET })
const chatRes = await fetch(`${BASE}/api/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ profileId: chatTarget.id, messages: [{ role: 'user', content: '你好' }] }),
})
const chatText = await chatRes.text()
check('聊天流 200', chatRes.status === 200, `status=${chatRes.status}`)
check('收到 chat-delta', chatText.includes('event: chat-delta'))
check('收到 chat-done', chatText.includes('event: chat-done'))
check('流里不含密钥', !chatText.includes(SECRET))

console.log('\n=== 9. stream_options 兼容开关 ===')
// 老自建上游见到它就 400，所以这个开关必须能存、能读、能改，非法值还得挡住
const defaultSwitch = remember(
  (await call('POST', '/api/providers', { ...validInput, name: '缺省开关' })).body as ApiProfilePublic,
)
check('新建不带该字段 → 默认开', defaultSwitch.streamOptions === true, `${defaultSwitch.streamOptions}`)

const switchedOff = remember(
  (await call('POST', '/api/providers', { ...validInput, name: '关掉开关', streamOptions: false }))
    .body as ApiProfilePublic,
)
check('新建时显式关掉 → 视图为 false', switchedOff.streamOptions === false, `${switchedOff.streamOptions}`)
check('是布尔而不是 0/1', typeof switchedOff.streamOptions === 'boolean', typeof switchedOff.streamOptions)

const switchedBack = await call('PATCH', `/api/providers/${encodeURIComponent(switchedOff.id)}`, {
  streamOptions: true,
})
check('PATCH 改回开 → 视图为 true', (switchedBack.body as ApiProfilePublic).streamOptions === true)

const badPatch = await call('PATCH', `/api/providers/${encodeURIComponent(switchedOff.id)}`, {
  streamOptions: 'no',
})
check(
  'PATCH 非布尔 → 400 BAD_REQUEST',
  badPatch.status === 400 && errorCode(badPatch) === 'BAD_REQUEST',
  `${badPatch.status} ${errorCode(badPatch)}`,
)

const badCreate = await call('POST', '/api/providers', { ...validInput, name: '坏开关', streamOptions: 1 })
check(
  '新建非布尔 → 400 BAD_REQUEST',
  badCreate.status === 400 && errorCode(badCreate) === 'BAD_REQUEST',
  `${badCreate.status} ${errorCode(badCreate)}`,
)

console.log('\n=== 10. 清理脚本自建的方案 ===')
for (const id of [...created]) {
  await call('DELETE', `/api/providers/${encodeURIComponent(id)}`)
}
const finalList = await listProfiles()
check('本次自建的方案已全部清掉', finalList.profiles.every((p) => !created.includes(p.id)), `剩余：${finalList.profiles.map((p) => p.id).join(', ') || '（无）'}`)

console.log(`\n=== 汇总：通过 ${passed} / ${passed + failed} ===`)
if (failed > 0) {
  console.log('提示：先确认 mock 上游（:3334）与 server（:3100）都已启动')
  process.exitCode = 1
}
