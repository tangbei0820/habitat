/** Phase 3B 调度器：Eventide 检查、BudgetGuard、唤醒、独处与梦境。 */
import type { FastifyBaseLogger } from 'fastify'
import type { AutomationKind } from '@shared/types.js'
import type { MemoryProvider, StateProvider } from '@shared/providers.js'
import {
  getAutomationPolicy,
  getAutomationRuntimeState,
  finishAutomationRun,
  markDreamCompleted,
  markSolitudeCompleted,
  markWakeSent,
} from '../db/automation.js'
import {
  appendEventLog,
  createNotification,
  createSolitudeEntry,
} from '../db/activity.js'
import type { LlmRegistry } from '../providers/registry.js'
import { BudgetGuard } from '../lib/budget-guard.js'
import { parseJsonText, runBackgroundLlm } from '../lib/llm-call.js'
import { localClock } from '../lib/time-window.js'
import { sendWebPush } from './push.js'

export interface AutomationActionResult {
  kind: AutomationKind | 'event'
  status: 'completed' | 'skipped' | 'failed'
  reason: string | null
  refId: string | null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function trimContext(text: string, limit = 4_000): string {
  return text.length <= limit ? text : text.slice(-limit)
}

export class AutomationService {
  private running = false

  constructor(
    private readonly registry: LlmRegistry,
    private readonly state: StateProvider | null,
    private readonly memory: MemoryProvider,
    private readonly logger: FastifyBaseLogger,
    private readonly guard = new BudgetGuard(),
  ) {}

  async checkNow(now = new Date()): Promise<AutomationActionResult[]> {
    if (this.running) return [{ kind: 'event', status: 'skipped', reason: '已有一轮调度在运行', refId: null }]
    this.running = true
    try {
      return await this.performCheck(now)
    } finally {
      this.running = false
    }
  }

  private async performCheck(now: Date): Promise<AutomationActionResult[]> {
    const results: AutomationActionResult[] = []
    const policy = getAutomationPolicy()
    const runtime = getAutomationRuntimeState()
    if (this.state !== null) {
      try {
        const event = await this.state.checkEvents(now, {
          ...(runtime.lastCounterpartAt === null ? {} : { lastCounterpartMessageAt: new Date(runtime.lastCounterpartAt) }),
          triggerWords: policy.triggerWords,
          timeZone: policy.timeZone,
        })
        if (event.started) {
          appendEventLog('eventide.event.started', { eventKey: event.eventKey })
          results.push({ kind: 'event', status: 'completed', reason: event.eventKey, refId: null })
        }
      } catch (error) {
        const reason = errorMessage(error)
        appendEventLog('eventide.event.failed', { error: reason })
        results.push({ kind: 'event', status: 'failed', reason, refId: null })
      }
    }

    if (!policy.enabled) {
      results.push({ kind: 'event', status: 'skipped', reason: '主动行为总开关已关闭', refId: null })
      return results
    }

    // 私有后台动作先跑；主动打扰最后跑，且每个出口都独立过 BudgetGuard。
    if (policy.dreamEnabled) results.push(await this.runDream(now))
    if (policy.solitudeEnabled) results.push(await this.runSolitude(now))
    if (policy.wakeEnabled) results.push(await this.runWake(now))
    return results
  }

  private activeProvider(): { provider: ReturnType<LlmRegistry['provider']>; model: string } {
    const profile = this.registry.active()
    if (profile === null) throw new Error('没有可供主动行为使用的 LLM 方案')
    const provider = this.registry.provider(profile.id)
    return { provider, model: provider.defaultModel }
  }

  private async memoryContext(): Promise<string> {
    try {
      return trimContext((await this.memory.recall()).text)
    } catch (error) {
      this.logger.warn({ err: error }, '主动行为读取 Nocturne 失败，本轮仅使用 Eventide 状态')
      return '长期记忆当前不可用；不要因此编造共同经历。'
    }
  }

  private async runWake(now: Date): Promise<AutomationActionResult> {
    const decision = this.guard.reserve('wake', 1_200, now)
    if (!decision.allowed || decision.reservationId === null) {
      return { kind: 'wake', status: 'skipped', reason: decision.reason, refId: null }
    }
    const runId = decision.reservationId
    try {
      const { provider, model } = this.activeProvider()
      const card = this.state?.current()?.stateCard ?? '(当前没有可用状态卡)'
      const memory = await this.memoryContext()
      const result = await runBackgroundLlm(provider, [{
        role: 'system',
        name: 'proactive_wake',
        content: [
          '你正在决定并生成一条主动发给用户的短消息。必须自然、符合人格，不提系统、状态数值或调度。',
          '只输出最终消息正文，不要标题、解释或 JSON。',
          card,
          `<recent_memory>${memory}</recent_memory>`,
        ].join('\n'),
      }], 'proactive-wake', { model, temperature: 0.8, maxTokens: 300, timeZone: getAutomationPolicy().timeZone })
      if (result.text === '') throw new Error('主动唤醒模型返回空正文')
      const notice = createNotification('wake', '小栖发来一条消息', result.text, { runId })
      void sendWebPush(notice).catch((error: unknown) => {
        this.logger.warn({ err: error }, 'Web Push 发送失败，站内通知已保留')
      })
      markWakeSent(now.getTime())
      finishAutomationRun(runId, 'completed', null, result.usageRecordId, now.getTime())
      appendEventLog('automation.wake.completed', { usageRecordId: result.usageRecordId }, notice.id, now.getTime())
      return { kind: 'wake', status: 'completed', reason: null, refId: notice.id }
    } catch (error) {
      const reason = errorMessage(error)
      finishAutomationRun(runId, 'failed', reason, null, now.getTime())
      appendEventLog('automation.wake.failed', { error: reason }, runId, now.getTime())
      this.logger.warn({ err: error }, '主动唤醒失败')
      return { kind: 'wake', status: 'failed', reason, refId: runId }
    }
  }

  private async runSolitude(now: Date): Promise<AutomationActionResult> {
    const decision = this.guard.reserve('solitude', 1_500, now)
    if (!decision.allowed || decision.reservationId === null) {
      return { kind: 'solitude', status: 'skipped', reason: decision.reason, refId: null }
    }
    const runId = decision.reservationId
    try {
      const { provider, model } = this.activeProvider()
      const card = this.state?.current()?.stateCard ?? '(当前没有可用状态卡)'
      const memory = await this.memoryContext()
      const result = await runBackgroundLlm(provider, [{
        role: 'system',
        name: 'solitude_reflection',
        content: [
          '这是你的独处整理时间。写一则简短、私密的自我整理记录，不是发给用户的消息。',
          '不要声称执行了未实际执行的工具或现实行动。只输出记录正文。',
          card,
          `<recent_memory>${memory}</recent_memory>`,
        ].join('\n'),
      }], 'solitude', { model, temperature: 0.7, maxTokens: 500, timeZone: getAutomationPolicy().timeZone })
      if (result.text === '') throw new Error('独处时光模型返回空正文')
      const entry = createSolitudeEntry(result.text, { runId }, now.getTime())
      const dayKey = localClock(now, getAutomationPolicy().timeZone).dayKey
      markSolitudeCompleted(dayKey, now.getTime())
      finishAutomationRun(runId, 'completed', null, result.usageRecordId, now.getTime())
      appendEventLog('automation.solitude.completed', { usageRecordId: result.usageRecordId }, entry.id, now.getTime())
      return { kind: 'solitude', status: 'completed', reason: null, refId: entry.id }
    } catch (error) {
      const reason = errorMessage(error)
      finishAutomationRun(runId, 'failed', reason, null, now.getTime())
      appendEventLog('automation.solitude.failed', { error: reason }, runId, now.getTime())
      this.logger.warn({ err: error }, '独处时光失败')
      return { kind: 'solitude', status: 'failed', reason, refId: runId }
    }
  }

  private async runDream(now: Date): Promise<AutomationActionResult> {
    const policy = getAutomationPolicy()
    const runtime = getAutomationRuntimeState()
    if (this.state === null) return { kind: 'dream', status: 'skipped', reason: 'Eventide 未配置', refId: null }
    if (runtime.lastCounterpartAt === null || policy.dreamSeed === null) {
      return { kind: 'dream', status: 'skipped', reason: '梦境缺少梦种或互动时间', refId: null }
    }
    const decision = this.guard.reserve('dream', 3_000, now)
    if (!decision.allowed || decision.reservationId === null) {
      return { kind: 'dream', status: 'skipped', reason: decision.reason, refId: null }
    }
    const runId = decision.reservationId
    try {
      const trigger = await this.state.checkDream(
        policy.dreamSeed,
        now,
        new Date(runtime.lastCounterpartAt),
        policy.timeZone,
      )
      const dayKey = localClock(now, policy.timeZone).dayKey
      if (trigger === null) {
        markDreamCompleted(dayKey, now.getTime())
        finishAutomationRun(runId, 'skipped', '本轮梦境概率未通过或不在窗口', null, now.getTime())
        return { kind: 'dream', status: 'skipped', reason: '本轮梦境概率未通过或不在窗口', refId: null }
      }
      try {
        const { provider, model } = this.activeProvider()
        const result = await runBackgroundLlm(provider, [{
          role: 'system',
          name: 'eventide_dream',
          content: `${trigger.prompt}\n只输出 JSON：{"content":"梦境正文","after_effect_tags":["tender"]}`,
        }], 'dream', { model, temperature: 0.9, maxTokens: 2_500, timeZone: policy.timeZone })
        const parsed = parseJsonText(result.text)
        if (typeof parsed !== 'object' || parsed === null) throw new Error('梦境结果不是对象')
        const body = parsed as Record<string, unknown>
        if (typeof body.content !== 'string' || !Array.isArray(body.after_effect_tags)) throw new Error('梦境结果缺少正文或标签')
        const tags = body.after_effect_tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 3)
        await this.state.applyDreamTags(tags, now)
        const entry = createSolitudeEntry(body.content, { runId, kind: 'dream', tags }, now.getTime())
        markDreamCompleted(dayKey, now.getTime())
        finishAutomationRun(runId, 'completed', null, result.usageRecordId, now.getTime())
        appendEventLog('automation.dream.completed', { tags, usageRecordId: result.usageRecordId }, entry.id, now.getTime())
        return { kind: 'dream', status: 'completed', reason: null, refId: entry.id }
      } catch (error) {
        const reason = errorMessage(error)
        finishAutomationRun(runId, 'failed', reason, null, now.getTime())
        appendEventLog('automation.dream.failed', { error: reason }, runId, now.getTime())
        return { kind: 'dream', status: 'failed', reason, refId: runId }
      }
    } catch (error) {
      const reason = errorMessage(error)
      finishAutomationRun(runId, 'failed', reason, null, now.getTime())
      this.logger.warn({ err: error }, '梦境检查失败')
      return { kind: 'dream', status: 'failed', reason, refId: runId }
    }
  }
}

export function startAutomationScheduler(
  service: AutomationService,
  logger: FastifyBaseLogger,
  intervalMs = Number(process.env.AUTOMATION_INTERVAL_MS ?? 60_000),
): () => void {
  const safeInterval = Number.isFinite(intervalMs) ? Math.max(10_000, intervalMs) : 60_000
  const timer = setInterval(() => {
    void service.checkNow().catch((error: unknown) => logger.error({ err: error }, '主动行为调度轮次失败'))
  }, safeInterval)
  timer.unref()
  return () => clearInterval(timer)
}
