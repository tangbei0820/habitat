/** Core-5 核心联调探针：结构化结算 outbox、恢复 / 幂等、状态降级与下一轮召回上下文。 */
import '../src/lib/env.js'

import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CapabilitySnapshot } from '@shared/capabilities.js'
import type { MemoryProvider, StateProvider } from '@shared/providers.js'

const dbPath = `./data/probe-core5-${process.pid}.db`
process.env.HABITAT_DB_PATH = dbPath
for (const suffix of ['', '-shm', '-wal']) rmSync(resolve(`${dbPath}${suffix}`), { force: true })

const { closeDb } = await import('../src/db/index.js')
const { assembleChatContext } = await import('../src/context/chat-context.js')
const {
  enqueueCoreSettlement,
  getCoreSettlement,
  listPendingCoreSettlements,
} = await import('../src/db/core-settlement.js')
const { listDesireAudits } = await import('../src/db/desire.js')
const { DesireEngine } = await import('../src/services/desire.js')
const { retryPendingCoreSettlements, settleChatInteraction } = await import('../src/services/settlement.js')

let passed = 0
let failed = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}${detail === '' ? '' : `  ${detail}`}`) }
  else { failed += 1; console.log(`  ✗ ${label}${detail === '' ? '' : `  ${detail}`}`) }
}

const start = Date.parse('2026-09-29T00:00:00.000Z')
const result = { settlement_result: 'continued', stress_delta: 0.02, fatigue_delta: 0.01 }
let settleCalls = 0
const state = {
  current: () => null,
  health: async () => ({ ok: true, configured: true, service: 'eventide' as const, revision: 'probe', lastError: null, lastCheckedAt: start }),
  tick: async () => ({ state: {}, stateCard: '<ephemeral_state />', payload: {}, settledAt: start }),
  settlementPrompt: async () => '{"ok":true}',
  settle: async () => {
    settleCalls += 1
    if (settleCalls === 1) throw new Error('probe sidecar temporarily offline')
    return { state: { cycle_key: 'stable' }, stateCard: '<ephemeral_state />', payload: { stress: 0.7, fatigue: 0.4 }, settledAt: start + 1 }
  },
  checkEvents: async () => ({ snapshot: { state: {}, stateCard: null, payload: {}, settledAt: start }, eventKey: null, started: false }),
  checkDream: async () => null,
  applyDreamTags: async () => ({ state: {}, stateCard: null, payload: {}, settledAt: start }),
} satisfies StateProvider

const logger = { warn: () => undefined } as unknown as Parameters<typeof retryPendingCoreSettlements>[2]
const desire = new DesireEngine()

try {
  const interactionId = 'core5-probe-interaction'
  const queued = enqueueCoreSettlement(interactionId, result, start - 6_000)
  const duplicate = enqueueCoreSettlement(interactionId, { should_not_replace: true }, start - 5_000)
  check('结算 outbox 只保存结构化结果', queued.status === 'pending' && !JSON.stringify(queued).includes('聊天正文'))
  check('重复交互 id 不覆盖原结算结果', duplicate.result.settlement_result === 'continued' && duplicate.result.should_not_replace === undefined)
  check('服务中断时结算保留待恢复状态', (await retryPendingCoreSettlements(state, desire, logger, start)).toString() === '0' && (getCoreSettlement(interactionId)?.attemptCount ?? 0) === 1)
  check('恢复扫描只重试结构化结果而不重调模型', (await retryPendingCoreSettlements(state, desire, logger, start + 6_000)) === 1 && settleCalls === 2)
  check('恢复成功后标记 applied 且不再重复应用', getCoreSettlement(interactionId)?.status === 'applied' && (await retryPendingCoreSettlements(state, desire, logger, start + 12_000)) === 0 && settleCalls === 2)
  check('Eventide 恢复结果进入 Desire 审计', listDesireAudits(50).some((item) => item.signal === 'eventide.settlement.retry'))
  check('服务重启前后的 outbox 状态可读回', listPendingCoreSettlements(20, start + 12_000).length === 0)

  let providerCalls = 0
  let directSettles = 0
  const directState = {
    ...state,
    settlementPrompt: async () => 'probe settlement prompt',
    settle: async () => {
      directSettles += 1
      return { state: { cycle_key: 'direct' }, stateCard: '<ephemeral_state />', payload: { stress: 0.2 }, settledAt: start + 2 }
    },
  } satisfies StateProvider
  const provider = {
    profileId: 'core5-probe',
    defaultModel: 'core5-probe-model',
    async *streamChat() {
      providerCalls += 1
      yield { type: 'delta' as const, delta: { content: JSON.stringify(result) } }
      yield { type: 'usage' as const, usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 } }
      yield { type: 'done' as const, finishReason: 'stop' }
    },
    listModels: async () => ['core5-probe-model'],
  }
  const directInput = {
    state: directState,
    provider,
    model: provider.defaultModel,
    messages: [{ role: 'user' as const, content: '把这轮互动记入状态。' }],
    assistantText: '我会处理。',
    logger,
    desire,
    interactionId: 'core5-direct-interaction',
  }
  await settleChatInteraction(directInput)
  await settleChatInteraction(directInput)
  check('聊天结算首次调用模型并落 Eventide', providerCalls === 1 && directSettles === 1 && getCoreSettlement('core5-direct-interaction')?.status === 'applied')
  check('聊天重放按 interaction id 幂等且不重复消耗', providerCalls === 1 && directSettles === 1)

  const memory: MemoryProvider = {
    recall: async () => ({ text: 'Nocturne 召回：北北喜欢雨天散步。' }),
    search: async () => ({ text: '搜索结果' }),
    write: async () => ({ text: '已写入', status: 'written' }),
    verifyToolFace: async () => [],
  }
  const capabilities: CapabilitySnapshot[] = [{
    id: 'memory.write', module: 'memory', label: '记忆写入', summary: 'probe', modelHint: 'probe', enabled: true, autonomy: 'autonomous', toolName: 'memory_write',
  }]
  const context = await assembleChatContext(
    [{ role: 'user', content: '下一轮继续聊雨天散步。' }],
    state,
    capabilities,
    new Date(start + 20_000),
    { memory, lastCounterpartMessageAt: new Date(start + 20_000) },
  )
  const names = context.messages.map((message) => message.name)
  check('下一轮上下文同时召回 Nocturne 与 Eventide', context.memory === 'injected' && context.eventide === 'empty' && names.includes('nocturne_memory') && names.includes('runtime_capabilities'))
  check('恢复 / 召回失败不会吞掉用户对话', context.messages.some((message) => message.role === 'user' && message.content.includes('雨天散步')))

  const brokenState = { ...state, checkEvents: async () => { throw new Error('sidecar offline') } } as StateProvider
  const degraded = await assembleChatContext([{ role: 'user', content: '网络中断时仍可聊天。' }], brokenState, capabilities, new Date(start + 30_000), { memory })
  check('Eventide 网络中断时只降级状态卡', degraded.eventide === 'unavailable' && degraded.memory === 'injected' && degraded.messages.some((message) => message.role === 'user'))
} finally {
  closeDb()
  for (const suffix of ['', '-shm', '-wal']) rmSync(resolve(`${dbPath}${suffix}`), { force: true })
}

console.log(`\n=== Core-5 integration：${passed} passed / ${failed} failed ===`)
process.exitCode = failed === 0 ? 0 : 1
