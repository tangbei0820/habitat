/**
 * LLM Adapter 验收脚本：不用真实密钥，靠本地 mock 上游把整条链路跑通。
 * 用法：
 *   1) npm run dev:mock-openai        # 另开终端，:3334
 *   2) npx tsx scripts/probe-llm.ts
 *
 * 覆盖：方案装载 / 脱敏视图 / listModels / 流式增量（含思维链、usage、done）/ 三种错误路径。
 * 退出码非 0 表示有断言失败。
 */
import type { ApiProfile } from '@shared/types.js'
import { ProviderError } from '../src/providers/errors.js'
import { LlmRegistry, loadProfiles } from '../src/providers/registry.js'

const BASE_URL = process.env.PROBE_BASE_URL ?? 'http://127.0.0.1:3334/v1'

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

function makeProfile(id: string, keyRef: string, isActive = false): ApiProfile {
  return {
    id,
    name: id,
    provider: 'openai-compat',
    baseUrl: BASE_URL,
    keyRef,
    modelMap: { chat: 'mock-chat-small' },
    isActive,
  }
}

const registry = new LlmRegistry(
  [
    makeProfile('ok', 'MOCK_KEY', true),
    makeProfile('no-key-env', 'MOCK_KEY_NOT_SET'),
    makeProfile('no-auth', ''), // keyRef 留空 = 不发鉴权头 → mock 必然 401
  ],
  { MOCK_KEY: 'sk-mock-123' },
)

console.log('\n=== 0. 方案装载（环境变量解析） ===')
const { profiles, problems } = loadProfiles({
  HABITAT_LLM_PROFILES: JSON.stringify([
    {
      id: 'env-a',
      name: '环境变量方案',
      provider: 'openai-compat',
      baseUrl: BASE_URL,
      keyRef: 'MOCK_KEY',
      modelMap: { chat: 'mock-chat-small' },
      isActive: true,
    },
    { id: 'bad-no-model', baseUrl: BASE_URL }, // 缺 modelMap.chat → 应被跳过
    { id: 'env-a', baseUrl: BASE_URL, modelMap: { chat: 'x' } }, // id 重复 → 应被跳过
  ]),
})
check('合法方案被装载', profiles.length === 1 && profiles[0]?.id === 'env-a')
check('坏方案被跳过且给出原因', problems.length === 2, problems.join(' | '))
check('未设置环境变量时不报错', loadProfiles({}).profiles.length === 0)
check('坏 JSON 被兜住', loadProfiles({ HABITAT_LLM_PROFILES: '{oops' }).problems.length === 1)

console.log('\n=== 1. 脱敏视图 ===')
check('含密钥的方案 hasKey=true', registry.list().find((p) => p.id === 'ok')?.hasKey === true)
check('缺密钥的方案 hasKey=false', registry.list().find((p) => p.id === 'no-key-env')?.hasKey === false)
check('不需要鉴权的方案 hasKey=true', registry.list().find((p) => p.id === 'no-auth')?.hasKey === true)
check('视图里绝不出现密钥', !JSON.stringify(registry.list()).includes('sk-mock-123'))

console.log('\n=== 2. listModels ===')
try {
  const models = await registry.provider('ok').listModels()
  check('取到模型列表', models.length === 3, JSON.stringify(models))
} catch (err) {
  check('取到模型列表', false, err instanceof Error ? err.message : String(err))
}

console.log('\n=== 3. streamChat（流式增量） ===')
try {
  const provider = registry.provider('ok')
  check('默认模型取自 modelMap.chat', provider.defaultModel === 'mock-chat-small')
  const startedAt = Date.now()
  const arrivals: number[] = []
  let content = ''
  let reasoning = ''
  let totalTokens: number | null = null
  let finishReason: string | null = null
  let doneCount = 0

  for await (const chunk of provider.streamChat(
    [
      { role: 'system', content: '你是小栖。' },
      { role: 'user', content: '在吗' },
    ],
    { temperature: 0.7 },
  )) {
    arrivals.push(Date.now() - startedAt)
    if (chunk.type === 'delta') {
      content += chunk.delta.content ?? ''
      reasoning += chunk.delta.reasoning ?? ''
    } else if (chunk.type === 'usage') {
      totalTokens = chunk.usage.totalTokens
    } else {
      doneCount += 1
      finishReason = chunk.finishReason
    }
  }

  const span = (arrivals.at(-1) ?? 0) - (arrivals[0] ?? 0)
  check('正文完整拼接', content === '收到，这是来自 mock 上游的 流式回复。\n链路正常。', JSON.stringify(content))
  check('思维链被识别（reasoning_content → reasoning）', reasoning === '先看看用户说了什么，然后组织一句简短的回复')
  check('usage 已透传', totalTokens === 24, `total=${String(totalTokens)}`)
  check('finish_reason 已透传', finishReason === 'stop')
  check('done 恰好一次', doneCount === 1)
  check('确实是逐块到达（非一次性缓冲）', span > 100, `首末 chunk 相隔 ${span}ms`)
} catch (err) {
  check('streamChat 成功', false, err instanceof Error ? err.message : String(err))
}

console.log('\n=== 4. 错误路径 ===')
try {
  registry.provider('不存在的方案')
  check('未知方案 → PROVIDER_NOT_FOUND', false)
} catch (err) {
  check(
    '未知方案 → PROVIDER_NOT_FOUND',
    err instanceof ProviderError && err.code === 'PROVIDER_NOT_FOUND',
    err instanceof Error ? err.message : String(err),
  )
}

try {
  await registry.provider('no-key-env').listModels()
  check('密钥环境变量未设置 → PROVIDER_NOT_CONFIGURED', false)
} catch (err) {
  check(
    '密钥环境变量未设置 → PROVIDER_NOT_CONFIGURED',
    err instanceof ProviderError && err.code === 'PROVIDER_NOT_CONFIGURED',
    err instanceof Error ? err.message : String(err),
  )
}

try {
  await registry.provider('no-auth').listModels()
  check('上游 401 → PROVIDER_UNAUTHORIZED', false)
} catch (err) {
  const detail = err instanceof ProviderError && err.detail !== undefined ? String(err.detail) : ''
  check(
    '上游 401 → PROVIDER_UNAUTHORIZED',
    err instanceof ProviderError && err.code === 'PROVIDER_UNAUTHORIZED',
    `${err instanceof Error ? err.message : String(err)}${detail === '' ? '' : ` | detail=${detail}`}`,
  )
}

console.log('\n=== 5. 取消（AbortSignal） ===')
try {
  const controller = new AbortController()
  const provider = registry.provider('ok')
  const iterator = provider.streamChat([{ role: 'user', content: '你好' }], {
    signal: controller.signal,
  })[Symbol.asyncIterator]()
  await iterator.next()
  controller.abort()
  let aborted = false
  try {
    for (;;) {
      const step = await iterator.next()
      if (step.done === true) break
    }
  } catch {
    aborted = true
  }
  check('中途 abort 能中断流（不静默挂住）', aborted)
} catch (err) {
  check('中途 abort 能中断流（不静默挂住）', false, err instanceof Error ? err.message : String(err))
}

console.log(`\n=== 汇总：通过 ${passed} / ${passed + failed} ===`)
if (failed > 0) {
  console.log('提示：先确认 mock 上游已起（npm run dev:mock-openai）')
  process.exitCode = 1
}
