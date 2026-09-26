/**
 * Event Inbox 服务 —— 决策之后**到底执行什么**（Phase 6.5 P1）。
 *
 * 一层职责：把「一条已决策的事件」翻译成「一次真实的副作用」，并留下结果给模型读。
 * 仓储（`db/event.ts`）只管存取，执行规则全在这里 —— 因为执行规则跟**能力面**走，
 * 加一个 confirm 工具只需要在这里加一个分支。
 *
 * ⚠️ 两条纪律，别在这里破例：
 *
 * 1. **挂起阶段绝不产生副作用**。`requestToolConfirm()` 只建事件、只校验参数格式，
 *    绝不写日记。副作用只能发生在 `decide*()` 里 —— 这是 `confirm` 级能力的全部意义，
 *    一旦挂起时顺手写了，「确认」就成了摆设。
 *
 * 2. **失败也要落定**。执行失败把事件标成 `failed` 并把原因写进 `result`，
 *    而不是抛出去让调用方处理 —— 模型需要知道「北北点了允许，但没写成，因为正文太长」。
 *    抛异常会让这条事件永远停在 `pending`，用户再点就说「已决过」，彻底说不清。
 */
import type { RuntimeEvent } from '@shared/types'
import { createEvent, findPendingEvent, getEvent, readEventPayload, settleEvent } from '../db/event.js'
import {
  createCompanionDiary,
  getCompanionDiaryView,
  setDiaryVisibility,
  updateCompanionDiary,
} from '../db/diary.js'
import { createCompanionMoment } from '../db/moment.js'
import { dayKeyOf } from '../db/usage.js'

/* ---------------------------------------------------------------- 参数校验
 *
 * 上限与 `routes/diary.ts` / `routes/moment.ts` 的用户侧接口保持一致：
 * 同一份数据两条写入路径（用户写 / AI 写），上限不一致就会出现
 * 「用户写得进、AI 写不进」这种说不通的现象。
 */
export const DIARY_TITLE_MAX = 120
export const DIARY_CONTENT_MAX = 10_000
export const MOMENT_CONTENT_MAX = 500

/** 事件详情里给用户预览的正文长度：确认卡是给人扫一眼的，不是阅读器 */
const PREVIEW_LIMIT = 160

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function preview(text: string): string {
  return text.length <= PREVIEW_LIMIT ? text : `${text.slice(0, PREVIEW_LIMIT)}…`
}

/** 校验结果：通过则给出「已净化」的参数（长度已校验、日期已兜底） */
type Validated =
  | { ok: true; payload: Record<string, unknown>; title: string; detail: string }
  | { ok: false; error: string }

const ENTRY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** 校验 AI 写日记的参数。日期省略时兜底为「今天」（AI 通常不该关心日期格式）。 */
function validateDiaryArgs(args: Record<string, unknown>): Validated {
  const title = str(args.title)
  const content = str(args.content)
  if (title === '') return { ok: false, error: '缺少 title（日记标题不能为空）' }
  if (title.length > DIARY_TITLE_MAX) return { ok: false, error: `title 最多 ${DIARY_TITLE_MAX} 字（收到 ${title.length}）` }
  if (content === '') return { ok: false, error: '缺少 content（日记正文不能为空）' }
  if (content.length > DIARY_CONTENT_MAX) {
    return { ok: false, error: `content 最多 ${DIARY_CONTENT_MAX} 字（收到 ${content.length}）` }
  }
  const rawDate = str(args.entryDate)
  const entryDate = ENTRY_DATE_PATTERN.test(rawDate) ? rawDate : dayKeyOf(Date.now())
  return {
    ok: true,
    payload: { title, content, entryDate },
    title: `写一篇日记：《${title}》`,
    detail: preview(content),
  }
}

/** 校验 AI 改日记的参数：只带要改的字段，其余沿用原文 —— 模型不必为了改一句重发全文。 */
function validateDiaryUpdateArgs(args: Record<string, unknown>): Validated {
  const id = str(args.id)
  if (id === '') return { ok: false, error: '缺少 id（要修改哪篇日记）' }
  const target = getCompanionDiaryView(id)
  // 这里就拦下「不是自己的日记」：等到执行阶段才报错，用户会先看到一张无意义的确认卡
  if (target === null) return { ok: false, error: `找不到你写的日记 ${id}` }

  const title = args.title === undefined ? target.title : str(args.title)
  const content = args.content === undefined ? (target.content ?? '') : str(args.content)
  if (title === '') return { ok: false, error: 'title 不能改成空' }
  if (title.length > DIARY_TITLE_MAX) return { ok: false, error: `title 最多 ${DIARY_TITLE_MAX} 字` }
  if (content === '') return { ok: false, error: 'content 不能改成空' }
  if (content.length > DIARY_CONTENT_MAX) return { ok: false, error: `content 最多 ${DIARY_CONTENT_MAX} 字` }
  const rawDate = str(args.entryDate)
  const entryDate = ENTRY_DATE_PATTERN.test(rawDate) ? rawDate : target.entryDate
  return {
    ok: true,
    payload: { id, title, content, entryDate },
    title: `修改日记：《${title}》`,
    detail: preview(content),
  }
}

function validateMomentArgs(args: Record<string, unknown>): Validated {
  const content = str(args.content)
  if (content === '') return { ok: false, error: '缺少 content（留言内容不能为空）' }
  if (content.length > MOMENT_CONTENT_MAX) {
    return { ok: false, error: `content 最多 ${MOMENT_CONTENT_MAX} 字（收到 ${content.length}）` }
  }
  return { ok: true, payload: { content }, title: '在留言板上留一条话', detail: preview(content) }
}

/* ---------------------------------------------------------------- 挂起（不执行） */

export type RequestConfirmResult = { ok: true; event: RuntimeEvent } | { ok: false; error: string }

/**
 * 把一个 `confirm` 级工具调用挂成待确认事件。**不执行任何副作用。**
 *
 * 校验放在这里而不是执行阶段：模型给的参数不合法时应当**立刻**告诉它，
 * 让它自己改一次重发 —— 而不是先让北北看到一张注定失败的确认卡。
 *
 * ⚠️ Phase 7B 起日记三能力与留言板已自主化（不再产生新的确认卡），本入口目前
 * **没有**现役工具会走到 —— 保留它是因为确认协议本身还在（`memory.write` 落地时
 * 第一个用）。上面的校验函数随之保留：它们同时服务于新数据上限的一致性。
 */
export function requestToolConfirm(input: {
  capabilityId: string
  toolName: string
  args: Record<string, unknown>
}): RequestConfirmResult {
  const validated = ((): Validated => {
    switch (input.toolName) {
      case 'diary_create':
        return validateDiaryArgs(input.args)
      case 'diary_update':
        return validateDiaryUpdateArgs(input.args)
      case 'messageboard_write':
        return validateMomentArgs(input.args)
      default:
        return { ok: false, error: `工具 ${input.toolName} 不是待确认工具` }
    }
  })()

  if (!validated.ok) return { ok: false, error: validated.error }

  const event = createEvent({
    kind: 'tool_confirm',
    decider: 'user',
    title: validated.title,
    detail: validated.detail,
    payload: { toolName: input.toolName, args: validated.payload },
    capabilityId: input.capabilityId,
    // 改日记时指向那一篇；写日记 / 写留言还没有目标对象，就没有
    ...(typeof validated.payload.id === 'string' ? { targetId: validated.payload.id } : {}),
  })
  return { ok: true, event }
}

/**
 * 北北请求查看某篇 AI 日记（SPEC §3.4.3）。
 *
 * 对同一篇日记**不重复建请求**：已经有待决的就把那一条还回去。
 * 否则用户连点两下，AI 下一轮会看到两条一模一样的请求。
 */
export function requestDiaryAccess(diaryId: string): { ok: true; event: RuntimeEvent } | { ok: false; error: string } {
  const target = getCompanionDiaryView(diaryId)
  if (target === null) return { ok: false, error: '这篇日记不存在，或者不是小栖写的' }
  if (target.visibility === 'open') return { ok: false, error: '这篇日记已经开放了' }

  const existing = findPendingEvent('diary_access_request', (payload) => payload.diaryId === diaryId)
  if (existing !== null) return { ok: true, event: existing }

  const event = createEvent({
    kind: 'diary_access_request',
    decider: 'companion',
    title: `北北想看看你写的《${target.title}》`,
    detail: `日期：${target.entryDate}\n这篇日记目前是私密的。你可以同意（正文对北北开放），也可以拒绝（不需要理由）。`,
    payload: { diaryId },
    capabilityId: 'diary.allow_access',
    targetId: diaryId,
  })
  return { ok: true, event }
}

/* ---------------------------------------------------------------- 决策（执行副作用） */

type ExecOutcome = { status: 'approved' | 'denied' | 'failed'; result: string }

/** `tool_confirm` 的执行：批准才真写，拒绝就什么都不做。
 *
 * ⚠️ Phase 7B 起日记/留言板自主化后，**新**的确认事件不会再产生；
 * 这个执行器保留是为了消化升级时刻仍然 `pending` 的历史挂起事件 ——
 * 删掉它，老确认卡会永远卡在「待确认」，用户点了也说不清。
 */
function executeToolConfirm(payload: Record<string, unknown>, approved: boolean): ExecOutcome {
  const toolName = str(payload.toolName)
  const args = typeof payload.args === 'object' && payload.args !== null ? (payload.args as Record<string, unknown>) : {}

  if (!approved) {
    return { status: 'denied', result: `北北拒绝了你这次的「${toolName}」请求，没有执行。不要重试，也不要装作已经做了。` }
  }

  switch (toolName) {
    case 'diary_create': {
      const created = createCompanionDiary({
        title: str(args.title),
        content: str(args.content),
        entryDate: str(args.entryDate),
      })
      return {
        status: 'approved',
        result: `北北已确认，日记《${created.title}》已写入（id: ${created.id}，日期 ${created.entryDate}）。这篇日记目前是私密的，只有你能看到正文。`,
      }
    }
    case 'diary_update': {
      const updated = updateCompanionDiary(str(args.id), {
        title: str(args.title),
        content: str(args.content),
        entryDate: str(args.entryDate),
      })
      if (updated === null) return { status: 'failed', result: '这篇日记已经不在（可能被删了），修改没有生效。' }
      return { status: 'approved', result: `北北已确认，日记《${updated.title}》已更新。` }
    }
    case 'messageboard_write': {
      const created = createCompanionMoment(str(args.content))
      return { status: 'approved', result: `北北已确认，留言已写到留言板上（id: ${created.id}）。` }
    }
    default:
      return { status: 'failed', result: `不认识这个待确认工具：${toolName}` }
  }
}

/** `diary_access_request` 的执行：同意就把可见性打开。 */
function executeDiaryAccess(payload: Record<string, unknown>, approved: boolean): ExecOutcome {
  const diaryId = str(payload.diaryId)
  if (!approved) {
    return { status: 'denied', result: '你拒绝了这次查看请求。日记保持私密，正文没有给北北看。拒绝不需要理由。' }
  }
  const updated = setDiaryVisibility(diaryId, 'open')
  if (updated === null) return { status: 'failed', result: '这篇日记已经不在（可能被删了），没能开放。' }
  return { status: 'approved', result: `你同意了。日记《${updated.title}》正文已对北北开放。` }
}

function runDecision(event: RuntimeEvent, approved: boolean): ExecOutcome | null {
  const payload = readEventPayload(event.id)
  if (payload === null) return null
  if (event.kind === 'tool_confirm') return executeToolConfirm(payload, approved)
  if (event.kind === 'diary_access_request') return executeDiaryAccess(payload, approved)
  return null
}

export type DecideResult =
  | { ok: true; event: RuntimeEvent }
  /** 事件不存在 / 已决过 / 不属于这个决策方 / 载荷坏了 —— 对调用方都是「这条不能决」 */
  | { ok: false; error: string }

/**
 * 代表某一方做决策。
 *
 * `decider` 必须与事件上的 `decider` 一致 —— 这是**权限检查**，不是参数检查：
 * 用户不能替 AI 决定要不要开放日记（那等于自己给自己开门），
 * AI 也不能替用户确认「北北同意写这篇日记」。
 */
export function decideEvent(eventId: string, decider: 'user' | 'companion', approved: boolean): DecideResult {
  const event = getEvent(eventId)
  if (event === null) return { ok: false, error: '这条事件不存在' }
  if (event.decider !== decider) {
    return {
      ok: false,
      error: decider === 'user' ? '这条事件要小栖自己决定，你不能替它决定' : '这条事件要北北确认，你不能替北北决定',
    }
  }
  if (event.status !== 'pending') return { ok: false, error: '这条事件已经处理过了' }

  const outcome = runDecision(event, approved)
  if (outcome === null) return { ok: false, error: '这条事件的执行数据损坏了，无法处理' }

  const settled = settleEvent(eventId, outcome.status, outcome.result)
  if (settled === null) {
    // 并发：两次决策挤在同一条上，后到的这次没改到任何行
    return { ok: false, error: '这条事件已经被处理过了' }
  }
  return { ok: true, event: settled }
}
