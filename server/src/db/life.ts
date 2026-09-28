/** Life 页面查询模型：只聚合服务端事实表，不反查前端聊天库。 */
import type { LifeDaySummary, LifeLedgerView, LifeMonthSummary, LifeTimelineItem, UsageBreakdown } from '@shared/types.js'
import { and, desc, eq, gte, lt } from 'drizzle-orm'
import { db } from './index.js'
import { eventLog, usageRecord } from './schema.js'
import { getAutomationPolicy } from './automation.js'
import { listPriceSnapshots } from './pricing.js'
import { getWallet, listWalletTransactions } from './wallet.js'

function nextMonth(month: string): string {
  const [year, number] = month.split('-').map(Number)
  if (number === 12) return `${year + 1}-01`
  return `${year}-${String(number + 1).padStart(2, '0')}`
}

function emptyDay(dayKey: string): LifeDaySummary {
  return {
    dayKey,
    eventCount: 0,
    failedEventCount: 0,
    apiCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    callDurationMs: 0,
    pricedCostCents: 0,
    unpricedCalls: 0,
    listeningDurationMs: 0,
    studyActivityCount: 0,
    countdownActivityCount: 0,
    bookmarkActivityCount: 0,
    wishlistActivityCount: 0,
  }
}

function addUsage(target: LifeDaySummary, row: typeof usageRecord.$inferSelect): void {
  target.apiCalls += 1
  target.promptTokens += row.promptTokens
  target.completionTokens += row.completionTokens
  target.totalTokens += row.totalTokens
  if (row.cost === null) target.unpricedCalls += 1
  else target.pricedCostCents += row.cost
}

export function getLifeMonthSummary(month: string): LifeMonthSummary {
  const end = nextMonth(month)
  const days = new Map<string, LifeDaySummary>()
  for (const row of db.select().from(eventLog).where(and(gte(eventLog.dayKey, `${month}-01`), lt(eventLog.dayKey, `${end}-01`))).all()) {
    const day = days.get(row.dayKey) ?? emptyDay(row.dayKey)
    day.eventCount += 1
    if (row.eventType.endsWith('.failed')) day.failedEventCount += 1
    if (row.eventType === 'call.ended' && typeof row.metricsJson.durationMs === 'number') day.callDurationMs += Math.max(0, row.metricsJson.durationMs)
    if (row.eventType === 'listening.progress' && typeof row.metricsJson.deltaSeconds === 'number') day.listeningDurationMs += Math.max(0, row.metricsJson.deltaSeconds * 1000)
    if (row.eventType.startsWith('study.')) day.studyActivityCount += 1
    if (row.eventType.startsWith('countdown.')) day.countdownActivityCount += 1
    if (row.eventType.startsWith('bookmark.')) day.bookmarkActivityCount += 1
    if (row.eventType.startsWith('wishlist.')) day.wishlistActivityCount += 1
    days.set(row.dayKey, day)
  }
  for (const row of db.select().from(usageRecord).where(and(gte(usageRecord.dayKey, `${month}-01`), lt(usageRecord.dayKey, `${end}-01`))).all()) {
    const day = days.get(row.dayKey) ?? emptyDay(row.dayKey)
    addUsage(day, row)
    days.set(row.dayKey, day)
  }
  const ordered = [...days.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey))
  const totals = emptyDay('')
  for (const day of ordered) {
    totals.eventCount += day.eventCount
    totals.failedEventCount += day.failedEventCount
    totals.apiCalls += day.apiCalls
    totals.promptTokens += day.promptTokens
    totals.completionTokens += day.completionTokens
    totals.totalTokens += day.totalTokens
    totals.callDurationMs += day.callDurationMs
    totals.listeningDurationMs += day.listeningDurationMs
    totals.studyActivityCount += day.studyActivityCount
    totals.countdownActivityCount += day.countdownActivityCount
    totals.bookmarkActivityCount += day.bookmarkActivityCount
    totals.wishlistActivityCount += day.wishlistActivityCount
    totals.pricedCostCents += day.pricedCostCents
    totals.unpricedCalls += day.unpricedCalls
  }
  const { dayKey: _dayKey, ...totalValues } = totals
  return { month, timeZone: getAutomationPolicy().timeZone, days: ordered, totals: totalValues }
}

function breakdown(rows: Array<typeof usageRecord.$inferSelect>, keyOf: (row: typeof usageRecord.$inferSelect) => string): UsageBreakdown[] {
  const groups = new Map<string, UsageBreakdown>()
  for (const row of rows) {
    const key = keyOf(row)
    const group = groups.get(key) ?? { key, calls: 0, totalTokens: 0, pricedCostCents: 0, unpricedCalls: 0 }
    group.calls += 1
    group.totalTokens += row.totalTokens
    if (row.cost === null) group.unpricedCalls += 1
    else group.pricedCostCents += row.cost
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.totalTokens - a.totalTokens || a.key.localeCompare(b.key))
}

export function getLifeLedger(month: string): LifeLedgerView {
  const end = nextMonth(month)
  const rows = db.select().from(usageRecord).where(and(
    gte(usageRecord.dayKey, `${month}-01`),
    lt(usageRecord.dayKey, `${end}-01`),
  )).orderBy(desc(usageRecord.at)).all()
  return {
    summary: getLifeMonthSummary(month),
    byService: breakdown(rows, (row) => row.service),
    byModel: breakdown(rows, (row) => `${row.profileId} · ${row.model}`),
    priceSnapshots: listPriceSnapshots(),
    wallet: getWallet(),
    walletTransactions: listWalletTransactions(100),
  }
}

export function getLifeDay(dayKey: string): {
  events: Array<typeof eventLog.$inferSelect>
  usage: Array<typeof usageRecord.$inferSelect>
  timeline: LifeTimelineItem[]
} {
  const events = db.select().from(eventLog).where(eq(eventLog.dayKey, dayKey)).orderBy(desc(eventLog.at)).all()
  return {
    events,
    usage: db.select().from(usageRecord).where(eq(usageRecord.dayKey, dayKey)).orderBy(desc(usageRecord.at)).all(),
    timeline: collapseListeningTimeline(events
      .slice()
      .sort((left, right) => left.at - right.at || left.id - right.id)
      .map(toTimelineItem)),
  }
}

function collapseListeningTimeline(items: LifeTimelineItem[]): LifeTimelineItem[] {
  const result: LifeTimelineItem[] = []
  const progressIndex = new Map<string, number>()
  for (const item of items) {
    if (item.eventType !== 'listening.progress') {
      result.push(item)
      continue
    }
    const key = item.refId ?? item.id
    const seconds = typeof item.metrics.deltaSeconds === 'number' ? Math.max(0, item.metrics.deltaSeconds) : 0
    const existingIndex = progressIndex.get(key)
    if (existingIndex === undefined) {
      progressIndex.set(key, result.length)
      result.push({ ...item, detail: `累计 ${listenDuration(seconds)}` })
      continue
    }
    const existing = result[existingIndex]
    const total = typeof existing.metrics.deltaSeconds === 'number' ? existing.metrics.deltaSeconds + seconds : seconds
    result[existingIndex] = { ...existing, metrics: { ...existing.metrics, deltaSeconds: total }, detail: `累计 ${listenDuration(total)}` }
  }
  return result
}

function listenDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} 秒`
  return `${Math.max(1, Math.round(seconds / 60))} 分钟`
}

function metricText(metrics: Record<string, unknown>, key: string): string | null {
  const value = metrics[key]
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function titleForAction(eventType: string): string {
  const action = eventType.slice('automation.action.'.length).replace(/\.(completed|failed)$/, '')
  const labels: Record<string, string> = {
    message: '发送了一条主动消息',
    diary: '写下了一篇日记',
    messageboard: '留下一条留言',
    surf: '进行了一次自主冲浪',
    call: '发起了一次通话',
  }
  return labels[action] ?? `完成了主动行为：${action || '未知'}`
}

function toTimelineItem(row: typeof eventLog.$inferSelect): LifeTimelineItem {
  const metrics = row.metricsJson
  let source = '系统'
  let title = '生活事件'
  let detail: string | null = null
  const metricTitle = metricText(metrics, 'title')
  const error = metricText(metrics, 'error')

  if (row.eventType.startsWith('reading.')) {
    source = metrics.mode === 'daily' ? '每日品读' : '共读'
    const bookTitle = metricText(metrics, 'bookTitle')
    const book = bookTitle ? `《${bookTitle}》` : '书籍'
    if (row.eventType === 'reading.daily.swapped') title = `换了一段品读 · ${book}`
    else if (row.eventType === 'reading.daily.annotation') title = `写下品读批注 · ${book}`
    else if (row.eventType === 'reading.daily.comment') title = `小栖回应品读 · ${book}`
    else if (row.eventType === 'reading.opened') title = `打开 ${book}`
    else if (row.eventType === 'reading.progress') {
      title = `阅读 ${book}`
      const percent = metricText(metrics, 'progressPercent')
      const seconds = metricText(metrics, 'readingSecondsDelta')
      detail = [percent ? `进度 ${percent}%` : null, seconds ? `本次 ${Math.round(Number(seconds) / 60)} 分钟` : null].filter(Boolean).join(' · ') || null
    } else if (row.eventType === 'reading.bookmark') title = `${metrics.enabled === true ? '夹入' : '移除'}书签 · ${book}`
    else if (row.eventType === 'reading.annotation') title = `写下批注 · ${book}`
    else if (row.eventType === 'reading.vocabulary') title = `收入生词 · ${book}`
  } else if (row.eventType === 'call.ring') {
    source = '通话'; title = '发起通话邀请'; detail = '等待接听或拒绝'
  } else if (row.eventType === 'call.ended') {
    source = '通话'; title = '通话结束'
    const duration = metricText(metrics, 'durationMs')
    detail = duration ? `时长 ${Math.max(0, Math.round(Number(duration) / 60000))} 分钟` : metricText(metrics, 'status')
  } else if (row.eventType === 'chat.turn.completed') {
    source = '聊天'
    title = '聊了一会儿'
    const messageCount = metricText(metrics, 'messageCount')
    const toolRounds = metricText(metrics, 'toolRounds')
    detail = [messageCount ? `上下文 ${messageCount} 条` : null, toolRounds && Number(toolRounds) > 0 ? `工具 ${toolRounds} 轮` : null].filter(Boolean).join(' · ') || null
  } else if (row.eventType === 'listening.track.started' || row.eventType === 'listening.progress') {
    source = '一起听'
    const trackTitle = metricText(metrics, 'title') ?? '这首歌'
    title = row.eventType === 'listening.track.started' ? `开始一起听《${trackTitle}》` : `一起听《${trackTitle}》`
    detail = row.eventType === 'listening.progress' ? null : metricText(metrics, 'artist')
  } else if (row.eventType.startsWith('study.')) {
    source = '学习'
    const subject = metricText(metrics, 'subject')
    const label = metricText(metrics, 'label')
    if (row.eventType === 'study.cards.generated') {
      const count = metricText(metrics, 'count')
      title = `生成了${count ?? '几'}张${subject ?? ''}学习卡片`
      detail = '小栖为今天准备的复习内容'
    } else if (row.eventType === 'study.card.reviewed') {
      title = `复习了一张${subject ?? ''}卡片`
      const grade = metricText(metrics, 'grade')
      const interval = metricText(metrics, 'intervalDays')
      detail = [grade ? `自评 ${grade}` : null, interval ? `下次间隔 ${interval} 天` : null].filter(Boolean).join(' · ') || null
    } else if (row.eventType === 'study.record.created') {
      title = `记录学习 · ${subject ?? '学习'}`
      const minutes = metricText(metrics, 'durationMinutes')
      detail = minutes ? `${minutes} 分钟` : null
    } else {
      title = '完成了一件学习小事'
      detail = label
    }
  } else if (row.eventType.startsWith('countdown.')) {
    source = '倒数日'
    const countdownTitle = metricText(metrics, 'title') ?? '一个重要日子'
    const targetDate = metricText(metrics, 'targetDate')
    if (row.eventType === 'countdown.created') title = `记下了「${countdownTitle}」`
    else if (row.eventType === 'countdown.updated') title = `更新了「${countdownTitle}」`
    else if (row.eventType === 'countdown.deleted') title = `移除了「${countdownTitle}」`
    else title = `${metricText(metrics, 'action') === 'pinned' ? '把' : '从主屏撤下'}「${countdownTitle}」`
    detail = targetDate ? `日期 ${targetDate}` : null
  } else if (row.eventType.startsWith('bookmark.')) {
    source = '收藏'
    const bookmarkTitle = metricText(metrics, 'title') ?? '一条内容'
    const targetType = metricText(metrics, 'targetType')
    const targetLabel: Record<string, string> = {
      'chat-message': '聊天消息',
      moment: '留言',
      'external-link': '链接',
      artwork: '作品',
      photo: '图片',
      diary: '日记',
      'reading-note': '共读',
      'reading-excerpt': '每日品读',
      'reading-annotation': '品读批注',
      'music-track': '音乐',
      'study-record': '学习记录',
    }
    if (row.eventType === 'bookmark.created') title = `收藏了「${bookmarkTitle}」`
    else if (row.eventType === 'bookmark.deleted') title = `移除了收藏「${bookmarkTitle}」`
    else if (row.eventType === 'bookmark.tags.updated') title = `调整了收藏「${bookmarkTitle}」的标签`
    else title = `调整了收藏「${bookmarkTitle}」的分类`
    const categoryName = metricText(metrics, 'categoryName')
    const tags = Array.isArray(metrics.tags) ? metrics.tags.filter((tag): tag is string => typeof tag === 'string') : []
    detail = [targetType ? `来源 ${targetLabel[targetType] ?? targetType}` : null, row.eventType === 'bookmark.tags.updated' ? (tags.length > 0 ? `标签 ${tags.map((tag) => `#${tag}`).join(' ')}` : '已清空标签') : (categoryName ? `归入「${categoryName}」` : '未分类')].filter(Boolean).join(' · ')
  } else if (row.eventType.startsWith('wishlist.')) {
    source = '愿望'
    const wishlistTitle = metricText(metrics, 'title') ?? '一个愿望'
    const status = metricText(metrics, 'status')
    const statusLabel: Record<string, string> = { open: '进行中', done: '已完成', paused: '已暂停', abandoned: '已放弃' }
    if (row.eventType === 'wishlist.created') title = `记下了愿望「${wishlistTitle}」`
    else if (row.eventType === 'wishlist.updated') title = `更新了愿望「${wishlistTitle}」`
    else if (row.eventType === 'wishlist.status.updated') title = `愿望「${wishlistTitle}」状态变为${statusLabel[status ?? ''] ?? status ?? '未知'}`
    else if (row.eventType === 'wishlist.progress.added') title = `给愿望「${wishlistTitle}」记了一步进展`
    else title = `移除了愿望「${wishlistTitle}」`
    const targetDate = metricText(metrics, 'targetDate')
    const reason = metricText(metrics, 'reason')
    const progressNote = metricText(metrics, 'progressNote')
    detail = [targetDate ? `目标 ${targetDate}` : null, progressNote ?? reason].filter(Boolean).join(' · ') || null
  } else if (row.eventType === 'capability.diary.create' || row.eventType === 'capability.diary.update') {
    source = '日记'; title = row.eventType.endsWith('.create') ? '写下了一篇日记' : '更新了一篇日记'; detail = metricTitle
  } else if (row.eventType === 'capability.messageboard.write' || row.eventType === 'capability.messageboard.update') {
    source = '留言板'; title = row.eventType.endsWith('.write') ? '留下一条留言' : '更新了一条留言'; detail = metricTitle
  } else if (row.eventType.startsWith('automation.wake.')) {
    source = '主动行为'; title = 'Wake 主动行为'; detail = row.eventType.endsWith('.failed') ? error : row.eventType.endsWith('.actions_dropped') ? '部分行动被丢弃' : '本轮行动已完成'
  } else if (row.eventType.startsWith('automation.solitude.') || row.eventType.startsWith('automation.surf.')) {
    source = '独处时光'; title = row.eventType.includes('surf') ? '自主冲浪记录' : '独处时光'; detail = error ?? metricText(metrics, 'url')
  } else if (row.eventType.startsWith('automation.action.')) {
    source = '主动行为'; title = titleForAction(row.eventType); detail = error ?? (row.eventType.endsWith('.failed') ? '执行失败' : '执行完成')
  } else if (row.eventType.startsWith('automation.dream.')) {
    source = '独处时光'; title = '梦境记录'; detail = error ?? '已完成一次梦境整理'
  } else if (row.eventType.startsWith('eventide.')) {
    source = '状态'; title = row.eventType.includes('settlement') ? '状态结算' : '状态事件'; detail = error ?? metricText(metrics, 'reason')
  } else {
    detail = error ?? metricTitle ?? metricText(metrics, 'reason')
  }

  return {
    id: `event:${row.id}`,
    eventId: row.id,
    eventType: row.eventType,
    at: row.at,
    source,
    title,
    detail,
    refId: row.refId,
    metrics,
  }
}
