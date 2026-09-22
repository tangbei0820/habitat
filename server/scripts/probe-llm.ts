/**
 * LLM 方案 / Adapter 验收脚本：不用真实密钥，靠本地 mock 上游把整条链路跑通。
 * 用法：
 *   1) npm run dev:mock-openai        # 另开终端，:3334
 *   2) npx tsx scripts/probe-llm.ts
 *
 * 覆盖：环境变量解析 / 种子导入 / 脱敏视图（含凭据来源 keySource）/ 表内密钥优先于环境变量 /
 *       listModels / 流式增量（思维链、usage、done）/ 四类错误路径 / 取消（AbortSignal）。
 * 退出码非 0 表示有断言失败。
 *
 * ⚠️ 两条实现上的讲究：
 *   ① `HABITAT_DB_PATH` 必须在 `db/index.js` **求值之前**设好，而 import 声明会被提升到文件顶部，
 *      所以这里用「顶层 await + 动态 import」而不是普通 import。
 *   ② 每次运行先删掉临时库，让「表为空 → 环境变量种子导入」这条路径被真实走到（否则它永不被覆盖）。
 */
import { rmSync } from 'node:fs'
import type { ApiProfile } from '@shared/types.js'

const BASE_URL = process.env.PROBE_BASE_URL ?? 'http://127.0.0.1:3334/v1'
const DB_PATH = './data/probe.db'

process.env.HABITAT_DB_PATH = DB_PATH
for (const suffix of ['', '-shm', '-wal']) rmSync(`${DB_PATH}${suffix}`, { force: true })

const { LlmRegistry, loadProfiles } = await import('../src/providers/registry.js')
const { countProfiles, importProfiles, setSecret } = await import('../src/db/profiles.js')
const { ProviderError } = await import('../src/providers/errors.js')

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

function makeProfile(id: string, name: string, keyRef: string, isActive = false): ApiProfile {
  return {
    id,
    name,
    provider: 'openai-compat',
    baseUrl: BASE_URL,
    keyRef,
    modelMap: { chat: 'mock-chat-small' },
    isActive,
  }
}

console.log('\n=== 0. 环境变量解析（loadProfiles，纯函数） ===')
const parsed = loadProfiles({
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
check('合法方案被解析', parsed.profiles.length === 1 && parsed.profiles[0]?.id === 'env-a')
check('坏方案被跳过且给出原因', parsed.problems.length === 2, parsed.problems.join(' | '))
check('未设置环境变量时不报错', loadProfiles({}).profiles.length === 0)
const badJson = loadProfiles({ HABITAT_LLM_PROFILES: '{oops' })
check('坏 JSON 被兜住且提示写成单行', badJson.problems.length === 1 && badJson.problems[0]!.includes('单行'))

console.log('\n=== 1. 种子导入（环境变量 → 数据库，仅首次） ===')
const seed: ApiProfile[] = [
  makeProfile('ok', '正常方案', 'MOCK_KEY', true),
  makeProfile('no-key-env', '缺密钥方案', 'MOCK_KEY_NOT_SET'),
  makeProfile('no-auth', '无需鉴权方案', ''),
]
const imported = importProfiles(seed)
check('首次导入生效', imported === 3 && countProfiles() === 3, `imported=${imported}`)
check('再次导入不生效（DB 已是权威源）', importProfiles(seed) === 0)

const registry = new LlmRegistry({ MOCK_KEY: 'sk-mock-123' })

console.log('\n=== 2. 脱敏视图 / 凭据来源 ===')
const view = (id: string) => registry.list().find((p) => p.id === id)
check('环境变量供钥 → keySource=env', view('ok')?.keySource === 'env' && view('ok')?.hasKey === true)
check(
  'keyRef 已声明但环境变量没设 → keySource=missing',
  view('no-key-env')?.keySource === 'missing' && view('no-key-env')?.hasKey === false,
)
check(
  'keyRef 留空（上游不需鉴权）→ keySource=not-required',
  view('no-auth')?.keySource === 'not-required' && view('no-auth')?.hasKey === true,
)
check('视图里绝不出现密钥', !JSON.stringify(registry.list()).includes('sk-mock-123'))
check('默认方案取 isActive', registry.active()?.id === 'ok')

console.log('\n=== 3. listModels ===')
try {
  const models = await registry.provider('ok').listModels()
  check('取到模型列表', models.length === 3, JSON.stringify(models))
} catch (err) {
  check('取到模型列表', false, err instanceof Error ? err.message : String(err))
}

console.log('\n=== 4. streamChat（流式增量） ===')
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

console.log('\n=== 5. 错误路径 ===')
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
  check('密钥不可得 → PROVIDER_NOT_CONFIGURED', false)
} catch (err) {
  check(
    '密钥不可得 → PROVIDER_NOT_CONFIGURED',
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

console.log('\n=== 6. 取消（AbortSignal） ===')
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

console.log('\n=== 7. 表内密钥（UI 填的）优先于环境变量 ===')
// 给「环境变量没设」的方案填密钥 → 应当起死回生
setSecret('no-key-env', 'sk-from-ui')
const healed = view('no-key-env')
check('填密钥后 keySource=stored 且可用', healed?.keySource === 'stored' && healed?.hasKey === true)
try {
  const models = await registry.provider('no-key-env').listModels()
  check('原本配错的方案现在真的能调通', models.length === 3)
} catch (err) {
  check('原本配错的方案现在真的能调通', false, err instanceof Error ? err.message : String(err))
}

// 给「keyRef 留空」的方案也填一把 → 说明表内密钥会真的被送去上游（否则 mock 仍回 401）
setSecret('no-auth', 'sk-from-ui')
const authNow = view('no-auth')
check('表内密钥覆盖 not-required → stored', authNow?.keySource === 'stored')
try {
  const models = await registry.provider('no-auth').listModels()
  check('表内密钥确实被送去上游（不再是 401）', models.length === 3)
} catch (err) {
  check('表内密钥确实被送去上游（不再是 401）', false, err instanceof Error ? err.message : String(err))
}

console.log(`\n=== 汇总：通过 ${passed} / ${passed + failed} ===`)
if (failed > 0) {
  console.log('提示：先确认 mock 上游已起（npm run dev:mock-openai）')
  process.exitCode = 1
}
