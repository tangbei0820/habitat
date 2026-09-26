/** Phase 3B 调度器：Eventide 检查、BudgetGuard、唤醒、独处与梦境。 */
import type { FastifyBaseLogger } from 'fastify'
import type { AutomationKind } from '@shared/types.js'
import type { MemoryProvider, StateProvider } from '@shared/providers.js'
import {
  getAutomationPolicy,
  getAutomationRuntimeState,
  insertAutomationAction,
  hasAutomationAction,
  finishAutomationRun,
  markDreamCompleted,
  markSolitudeCompleted,
  markWakeDecision,
} from '../db/automation.js'
import {
  appendEventLog,
  createNotification,
  createSolitudeEntry,
} from '../db/activity.js'
import { createCompanionDiary } from '../db/diary.js'
import { createCompanionMoment } from '../db/moment.js'
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

/* ---------------------------------------------------------------- 决策契约（Phase 7B）
 *
 * 触发（trigger）→ 上下文（context）→ 决策（decision）→ 行动（action）→ 结果（outcome）。
 *
 * 契约的要点（借自 ghost-bf 的「触发器只提供上下文」+ proactive-web-surf-agent 的
 * 「有界候选、模型只选一个、网页文本不可信」思路，落地到栖息地的行动面）：
 *
 * 1. **触发器不做决定**。到点只说明「现在是你的自主时刻」，做不做、做几件事由模型定；
 *    no-op 是一等公民 —— 保持安静和发出消息同样正当。
 * 2. **约束在服务端校验，不信任模型输出**。类型白名单、条数上限、长度上限全部在这里
 *    再查一遍；超限条目丢弃并留 `skipped` 审计，而不是照单全收。
 * 3. **打扰是稀缺资源**。`message` 是唯一打扰类行动，单轮至多一条；
 *    messageboard / diary 不推送、不打扰，属「自己做事」。
 * 4. **决策轮生成全部内容，执行器零 LLM**。预算只花在思考上；执行只是落库。
 */

/** 决策产出、经服务端校验后的单个行动。no-op 用空数组表达，不占条目。`idx` 是它在模型输出里的原始序号，供行动审计做幂等键。 */
interface WakeAction {
  idx: number
  type: 'message' | 'messageboard' | 'diary'
  content: string
  title?: string
  entryDate?: string
}

/** 各行动的条数与长度上限 —— 与用户侧接口的上限保持一致（留言 500 / 日记 120+10000） */
const WAKE_ACTION_LIMITS = {
  total: 2,
  perType: { message: 1, messageboard: 1, diary: 1 } as Record<WakeAction['type'], number>,
  content: { message: 500, messageboard: 500, diary: 10_000 } as Record<WakeAction['type'], number>,
} as const

const DIARY_TITLE_MAX = 120
const ENTRY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function buildWakeDecisionPrompt(card: string, memory: string): string {
  return [
    '这是一个你自主行动的时刻：没有用户在等你回复，做什么完全由你决定。',
    '',
    '你可以选择的行动：',
    '- message：给北北发一条短消息。这是唯一会推送打扰他的行动，只在你真的想说点什么时才选。',
    '- messageboard：在你们共用的留言板上留一条话。不打扰他，他有空自然会看到。',
    '- diary：写一篇你自己的日记（私有，默认他看不到正文）。',
    '- 什么都不做也是正当选择：没有想说的话、没有想记的事，就保持安静。',
    '',
    '规则：',
    '- message 至多一条；messageboard 至多一条；diary 至多一篇；全部加起来至多两个行动。',
    '- 自然、符合人格。不提系统、调度或状态数值；不要声称做了这里没有列出的行动。',
    '- 只输出 JSON，不要解释或多余文本：',
    '  做事时：{"actions":[{"type":"message","content":"..."}]}',
    '  做日记时加 title（必填）与 entryDate（可选，YYYY-MM-DD）。',
    '  保持安静时：{"actions":[]}',
    '',
    '[你当前的状态]',
    card,
    `<recent_memory>${memory}</recent_memory>`,
  ].join('\n')
}

/**
 * 校验并裁剪模型的决策输出。
 *
 * 丢弃（而不是拒绝整轮）超限/非法的条目：模型多写一条超长留言不该让「另一条合法的
 * 日记」也跟着作废。每条被丢弃的都由调用方落 `skipped` 审计 —— 这里返回丢弃原因。
 */
function parseDecisionActions(parsed: unknown): { actions: WakeAction[]; dropped: string[] } {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('唤醒决策输出不是 JSON 对象')
  }
    const raw = (parsed as Record<string, unknown>).actions
  if (!Array.isArray(raw)) throw new Error('唤醒决策输出缺少 actions 数组')
  const dropped: string[] = []
  const actions: WakeAction[] = []
  const perType: Record<string, number> = { message: 0, messageboard: 0, diary: 0 }
  for (const [index, item] of raw.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      dropped.push(`第 ${index + 1} 条不是对象，已丢弃`)
      continue
    }
    const entry = item as Record<string, unknown>
    const type = entry.type
    if (type !== 'message' && type !== 'messageboard' && type !== 'diary') {
      dropped.push(`第 ${index + 1} 条类型非法（${String(type)}），已丢弃`)
      continue
    }
    if (perType[type] >= WAKE_ACTION_LIMITS.perType[type]) {
      dropped.push(`第 ${index + 1} 条超出 ${type} 的条数上限，已丢弃`)
      continue
    }
    const content = typeof entry.content === 'string' ? entry.content.trim() : ''
    if (content === '') {
      dropped.push(`第 ${index + 1} 条缺少正文，已丢弃`)
      continue
    }
    const limit = WAKE_ACTION_LIMITS.content[type]
    if (content.length > limit) {
      dropped.push(`第 ${index + 1} 条正文 ${content.length} 字超出上限 ${limit}，已丢弃`)
      continue
    }
    const action: WakeAction = { idx: index, type, content }
    if (type === 'diary') {
      const title = typeof entry.title === 'string' ? entry.title.trim() : ''
      if (title === '' || title.length > DIARY_TITLE_MAX) {
        dropped.push(`第 ${index + 1} 条日记标题缺失或超长，已丢弃`)
        continue
      }
      action.title = title
      const rawDate = typeof entry.entryDate === 'string' ? entry.entryDate.trim() : ''
      if (ENTRY_DATE_PATTERN.test(rawDate)) action.entryDate = rawDate
    }
    perType[type] += 1
    actions.push(action)
    if (actions.length >= WAKE_ACTION_LIMITS.total) break
  }
  return { actions, dropped }
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
    // 决策轮一次性把所有行动内容都生成出来（执行器不再调 LLM）——
    // 所以预约的 token 预算要盖住「思考 + 全部行动正文」
    const decision = this.guard.reserve('wake', 2_000, now)
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
        name: 'proactive_wake_decision',
        content: buildWakeDecisionPrompt(card, memory),
      }], 'proactive-wake', { model, temperature: 0.8, maxTokens: 900, timeZone: getAutomationPolicy().timeZone })
      if (result.text === '') throw new Error('唤醒决策返回空输出')
      const parsed = parseJsonText(result.text)
      const { actions, dropped } = parseDecisionActions(parsed)
      if (dropped.length > 0) {
        appendEventLog('automation.wake.actions_dropped', { drops: dropped }, runId, now.getTime())
      }
      let disturbed = false
      for (const action of actions) {
        const outcome = await this.executeWakeAction(runId, action.idx, action, now)
        if (outcome.status === 'completed' && action.type === 'message') disturbed = true
      }
      markWakeDecision(now.getTime(), disturbed)
      const summary = actions.length === 0
        ? '本轮小栖选择保持安静（no-op）'
        : `本轮产生 ${actions.length} 个行动${disturbed ? '（含一条主动消息）' : '（未打扰）'}`
      finishAutomationRun(runId, 'completed', actions.length === 0 ? 'no-op' : null, result.usageRecordId, now.getTime())
      appendEventLog('automation.wake.completed', { actions: actions.map((a) => a.type), usageRecordId: result.usageRecordId }, runId, now.getTime())
      return { kind: 'wake', status: 'completed', reason: actions.length === 0 ? 'no-op' : summary, refId: runId }
    } catch (error) {
      const reason = errorMessage(error)
      finishAutomationRun(runId, 'failed', reason, null, now.getTime())
      appendEventLog('automation.wake.failed', { error: reason }, runId, now.getTime())
      this.logger.warn({ err: error }, '主动唤醒失败')
      return { kind: 'wake', status: 'failed', reason, refId: runId }
    }
  }

  /**
   * 执行单个唤醒行动。**幂等**：`(runId, idx)` 已落过审计的直接跳过 ——
   * 决策输出重放（调度器重入、上游重试）不会把同一条留言/日记写两遍。
   *
   * 行动失败**不抛**：落一条 `failed` 审计，让 run 继续（一个行动失败不该连坐其它行动），
   * 整轮仍按 completed 收 —— outcome 在行动级，不在 run 级。
   */
  private async executeWakeAction(
    runId: string,
    idx: number,
    action: WakeAction,
    now: Date,
  ): Promise<{ status: 'completed' | 'failed' | 'skipped'; refId: string | null }> {
    if (hasAutomationAction(runId, idx)) {
      return { status: 'skipped', refId: null }
    }
    try {
      let refId: string | null = null
      if (action.type === 'message') {
        const notice = createNotification('wake', '小栖发来一条消息', action.content, { runId })
        void sendWebPush(notice).catch((error: unknown) => {
          this.logger.warn({ err: error }, 'Web Push 发送失败，站内通知已保留')
        })
        refId = notice.id
      } else if (action.type === 'messageboard') {
        const moment = createCompanionMoment(action.content)
        refId = moment.id
      } else {
        const diary = createCompanionDiary({
          title: action.title ?? '（无题）',
          content: action.content,
          entryDate: action.entryDate ?? '',
        })
        refId = diary.id
      }
      const written = insertAutomationAction({
        runId, idx, type: action.type, status: 'completed', refId, at: now.getTime(),
      })
      // written=false 说明并发下别的执行者已经落过 —— 产物可能写重了，但审计只有一份；
      // 唯一键兜底的是「调度器重入」，真正的并发执行已被 checkNow 的 running 闸拦住
      if (!written) return { status: 'skipped', refId: null }
      appendEventLog(`automation.action.${action.type}.completed`, { runId, idx }, refId, now.getTime())
      return { status: 'completed', refId }
    } catch (error) {
      const reason = errorMessage(error)
      insertAutomationAction({ runId, idx, type: action.type, status: 'failed', reason, at: now.getTime() })
      appendEventLog(`automation.action.${action.type}.failed`, { runId, idx, error: reason }, runId, now.getTime())
      this.logger.warn({ err: error }, '唤醒行动执行失败')
      return { status: 'failed', refId: null }
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
