import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { LifeLedgerView, LifeMonthSummary, LifeRuntimeView, NotificationPreferences, NotificationRecord, PushStatus, RuntimeEvent } from '@shared/types'
import { listEvents } from '../../db/events'
import { weekListenSeconds } from '../../db/listen'
import { listDiaries } from '../../db/home'
import { EventConfirmCard } from '../../features/chat/EventConfirmCard'
import {
  IconBook, IconDrop, IconHeart, IconMoon, IconNote,
} from '../../components/qixi/Icons'
import {
  addPriceSnapshot, addWalletTransaction, loadLifeDay, loadLifeLedger, loadLifeMonth,
  loadLifeRuntime, loadNotificationPreferences, loadNotifications, loadPushStatus, loadSurfFeeds, markAllNotificationsRead,
  markNotificationRead, runAutomationCheck, saveNotificationPreferences, saveSurfFeeds, sendPushTest, type LifeDayDetail,
} from '../../features/life/api'
import { ApiRequestError } from '../../lib/api'
import { browserPushSupported, currentPushSubscription, disablePush, enablePush } from '../../features/life/push'
import { useOnlineStatus } from '../../features/offline/useOnlineStatus'
import { stateValue } from '../../lib/format'

type LifeTab = 'calendar' | 'ledger' | 'notifications' | 'events' | 'runtime'
const TABS: Array<{ id: LifeTab; label: string }> = [
  { id: 'calendar', label: '月历' }, { id: 'ledger', label: '账本' },
  { id: 'notifications', label: '通知' }, { id: 'events', label: '事件' }, { id: 'runtime', label: '运行' },
]

function initialMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
function moveMonth(month: string, offset: number): string {
  const [year, value] = month.split('-').map(Number)
  const next = new Date(Date.UTC(year, value - 1 + offset, 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
}
function dateTime(value: number | null): string {
  return value === null ? '尚无' : new Intl.DateTimeFormat('zh-CN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(value)
}
function money(cents: number): string { return `${(cents / 100).toFixed(2)} 元` }
function durationMinutes(milliseconds: number): string {
  const minutes = Math.round(Math.max(0, milliseconds) / 60000)
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}
function Panel({ children, className = '', testId }: { children: ReactNode; className?: string; testId?: string }) {
  return <section data-testid={testId} className={`rounded-xl border p-4 ${className}`} style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-surface-solid)' }}>{children}</section>
}
function ErrorLine({ value }: { value: string | null }) {
  return value === null ? null : <p className="rounded-lg p-3 text-sm" style={{ color: 'var(--danger)', background: 'var(--bg-subtle)' }}>{value}</p>
}
function LoadingOrEmpty({ loading, empty, children }: { loading: boolean; empty: boolean; children: ReactNode }) {
  if (loading) return <p className="py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>正在读取…</p>
  if (empty) return <p className="py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>这里还没有记录</p>
  return <>{children}</>
}

function CalendarView({ month, setMonth }: { month: string; setMonth: (value: string) => void }) {
  const [summary, setSummary] = useState<LifeMonthSummary | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<LifeDayDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setLoading(true); setError(null); setSelected(null); setDetail(null)
    loadLifeMonth(month).then(setSummary).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setLoading(false))
  }, [month])
  const selectDay = useCallback((dayKey: string) => {
    setSelected(dayKey); setDetail(null); setError(null)
    void loadLifeDay(dayKey).then(setDetail).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [])
  const cells = useMemo(() => {
    const [year, value] = month.split('-').map(Number)
    const count = new Date(Date.UTC(year, value, 0)).getUTCDate()
    const offset = new Date(Date.UTC(year, value - 1, 1)).getUTCDay()
    return [...Array<number | null>(offset).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)]
  }, [month])
  const summaries = new Map(summary?.days.map((day) => [day.dayKey, day]) ?? [])
  return <div className="space-y-3">
    <div className="flex items-center justify-between"><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setMonth(moveMonth(month, -1))}>上月</button><div className="text-center"><strong>{month}</strong><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{summary?.timeZone ?? '用户时区'}</p></div><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setMonth(moveMonth(month, 1))}>下月</button></div>
    <button className="text-xs underline" style={{ color: 'var(--text-secondary)' }} onClick={() => setMonth(initialMonth())}>回到本月</button><ErrorLine value={error}/>
    <LoadingOrEmpty loading={loading} empty={false}><Panel><div className="grid grid-cols-7 gap-1 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>{'日一二三四五六'.split('').map((day) => <span key={day} className="py-1">{day}</span>)}{cells.map((day, index) => {
      if (day === null) return <span key={`empty-${index}`}/>
      const key = `${month}-${String(day).padStart(2, '0')}`; const item = summaries.get(key)
      return <button key={key} onClick={() => selectDay(key)} className="min-h-14 rounded-lg border p-1 text-left" style={{ borderColor: selected === key ? 'var(--accent-strong)' : 'var(--border-soft)', background: item ? 'var(--bg-subtle)' : 'transparent' }}><span>{day}</span>{item && <span className="mt-1 block text-[10px]" style={{ color: item.failedEventCount > 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>{item.eventCount}事 · {item.apiCalls}次</span>}</button>
    })}</div></Panel>
    {summary && <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-9"><Panel><strong className="block text-base">{summary.totals.eventCount}</strong>本月事件</Panel><Panel><strong className="block text-base">{summary.totals.totalTokens}</strong>Token</Panel><Panel><strong className="block text-base">{durationMinutes(summary.totals.callDurationMs)}</strong>通话</Panel><Panel><strong className="block text-base">{durationMinutes(summary.totals.listeningDurationMs)}</strong>一起听</Panel><Panel><strong className="block text-base">{summary.totals.studyActivityCount}</strong>学习活动</Panel><Panel><strong className="block text-base">{summary.totals.countdownActivityCount}</strong>倒数日</Panel><Panel><strong className="block text-base">{summary.totals.bookmarkActivityCount}</strong>收藏活动</Panel><Panel><strong className="block text-base">{summary.totals.wishlistActivityCount}</strong>愿望</Panel><Panel><strong className="block text-base">{money(summary.totals.pricedCostCents)}</strong>{summary.totals.unpricedCalls > 0 ? `另 ${summary.totals.unpricedCalls} 次未定价` : '已全部定价'}</Panel></div>}
    {selected && <Panel>
      <div className="mb-3 flex items-start justify-between gap-3"><div><h2 className="font-medium">{selected} · 共同生活</h2><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>按发生时间整理的聊天、主动行为与生活记录</p></div><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{detail?.timeline.length ?? 0} 件事</span></div>
      {detail === null ? <p className="text-sm">正在读取…</p> : <>
        {detail.timeline.length === 0 ? <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>当天还没有共同生活事件</p> : <div className="space-y-2">{detail.timeline.map((item) => <article key={item.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-subtle)' }}><div className="flex items-start gap-3"><time className="w-12 shrink-0 pt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(item.at)}</time><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full px-2 py-0.5 text-[11px]" style={{ color: 'var(--accent-strong)', background: 'var(--bg-surface-solid)' }}>{item.source}</span><strong>{item.title}</strong></div>{item.detail && <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{item.detail}</p>}<details className="mt-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}><summary className="cursor-pointer">查看来源</summary><p className="mt-1 break-all">{item.eventType}{item.refId ? ` · ${item.refId}` : ''}</p></details></div></div></article>)}</div>}
        {detail.usage.length > 0 && <details className="mt-4 rounded-lg border p-3" style={{ borderColor: 'var(--border-soft)' }}><summary className="cursor-pointer text-sm font-medium">系统统计 · {detail.usage.length} 次模型调用</summary><div className="mt-2 space-y-2">{detail.usage.map((usage) => <div key={`usage-${usage.id}`} className="rounded-lg p-2 text-sm" style={{ background: 'var(--bg-subtle)' }}><div className="flex justify-between gap-3"><strong>{usage.service} · {usage.model}</strong><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{dateTime(usage.at)}</span></div><span className="block text-xs" style={{ color: 'var(--text-secondary)' }}>{usage.totalTokens} Token · {usage.cost === null ? '未定价' : money(usage.cost)}</span></div>)}</div></details>}
      </>}
    </Panel>}
    </LoadingOrEmpty>
  </div>
}

function LedgerView({ month }: { month: string }) {
  const [ledger, setLedger] = useState<LifeLedgerView | null>(null); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null)
  const [walletDelta, setWalletDelta] = useState(''); const [walletReason, setWalletReason] = useState('')
  const [provider, setProvider] = useState('openai-compat'); const [model, setModel] = useState(''); const [promptPrice, setPromptPrice] = useState(''); const [completionPrice, setCompletionPrice] = useState(''); const [validDate, setValidDate] = useState(`${month}-01`)
  const refresh = useCallback(() => loadLifeLedger(month).then(setLedger), [month])
  useEffect(() => { setLedger(null); setError(null); void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))) }, [refresh])
  async function submitWallet(event: FormEvent) { event.preventDefault(); setError(null); setNotice(null); try { await addWalletTransaction(Number(walletDelta), walletReason.trim()); setWalletDelta(''); setWalletReason(''); setNotice('钱包流水已追加'); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } }
  async function submitPrice(event: FormEvent) { event.preventDefault(); setError(null); setNotice(null); try { const result = await addPriceSnapshot({ provider: provider.trim(), model: model.trim(), promptCentsPerMillion: Number(promptPrice), completionCentsPerMillion: Number(completionPrice), validFrom: new Date(`${validDate}T00:00:00`).getTime() }); setNotice(`价格快照已新增，补价 ${result.repriced} 条`); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } }
  return <div className="space-y-3"><ErrorLine value={error}/>{notice && <p className="text-sm" style={{ color: 'var(--accent-strong)' }}>{notice}</p>}<LoadingOrEmpty loading={ledger === null && error === null} empty={false}>{ledger && <>
    <div className="grid grid-cols-2 gap-2 text-sm"><Panel><span style={{ color: 'var(--text-secondary)' }}>本月 API</span><strong className="block text-xl">{ledger.summary.totals.apiCalls} 次</strong></Panel><Panel><span style={{ color: 'var(--text-secondary)' }}>已定价费用</span><strong className="block text-xl">{money(ledger.summary.totals.pricedCostCents)}</strong><small>{ledger.summary.totals.unpricedCalls} 次未定价</small></Panel></div>
    <Panel><h2 className="mb-2 font-medium">按服务</h2>{ledger.byService.length === 0 ? <p className="text-sm">暂无用量</p> : ledger.byService.map((item) => <div key={item.key} className="flex justify-between border-t py-2 text-sm"><span>{item.key}</span><span>{item.calls} 次 · {item.totalTokens} Token · {money(item.pricedCostCents)}{item.unpricedCalls > 0 ? ` +${item.unpricedCalls} 未定价` : ''}</span></div>)}</Panel>
    <Panel><h2 className="mb-2 font-medium">按方案与模型</h2>{ledger.byModel.length === 0 ? <p className="text-sm">暂无用量</p> : ledger.byModel.map((item) => <div key={item.key} className="border-t py-2 text-sm"><strong>{item.key}</strong><small className="block" style={{ color: 'var(--text-secondary)' }}>{item.calls} 次 · {item.totalTokens} Token · {money(item.pricedCostCents)}{item.unpricedCalls > 0 ? ` · ${item.unpricedCalls} 次未定价` : ''}</small></div>)}</Panel>
    <Panel><h2 className="mb-2 font-medium">小栖钱包</h2><strong className="text-2xl">{ledger.wallet.balance}</strong><form className="mt-3 grid gap-2" onSubmit={(event) => void submitWallet(event)}><input required type="number" value={walletDelta} onChange={(event) => setWalletDelta(event.target.value)} placeholder="变化量：正数充值，负数支出" className="rounded-lg border bg-transparent px-3 py-2 text-sm"/><input required maxLength={200} value={walletReason} onChange={(event) => setWalletReason(event.target.value)} placeholder="原因（必填）" className="rounded-lg border bg-transparent px-3 py-2 text-sm"/><button className="rounded-lg px-3 py-2 text-sm text-white" style={{ background: 'var(--accent-strong)' }}>追加流水</button></form><div className="mt-3 space-y-2">{ledger.walletTransactions.map((item) => <div key={item.id} className="flex justify-between text-sm"><span>{item.reason}<small className="block" style={{ color: 'var(--text-secondary)' }}>{dateTime(item.createdAt)} · 余额 {item.balanceAfter}</small></span><strong style={{ color: item.delta >= 0 ? 'var(--accent-strong)' : 'var(--danger)' }}>{item.delta >= 0 ? '+' : ''}{item.delta}</strong></div>)}</div></Panel>
    <Panel><h2 className="font-medium">价格快照</h2><p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>单位：分 / 百万 Token。快照新增后不可修改。</p><form className="grid gap-2" onSubmit={(event) => void submitPrice(event)}><input required value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="Provider" className="rounded-lg border bg-transparent px-3 py-2 text-sm"/><input required value={model} onChange={(event) => setModel(event.target.value)} placeholder="模型名" className="rounded-lg border bg-transparent px-3 py-2 text-sm"/><div className="grid grid-cols-2 gap-2"><input required min="0" type="number" value={promptPrice} onChange={(event) => setPromptPrice(event.target.value)} placeholder="输入单价" className="rounded-lg border bg-transparent px-3 py-2 text-sm"/><input required min="0" type="number" value={completionPrice} onChange={(event) => setCompletionPrice(event.target.value)} placeholder="输出单价" className="rounded-lg border bg-transparent px-3 py-2 text-sm"/></div><input required type="date" value={validDate} onChange={(event) => setValidDate(event.target.value)} className="rounded-lg border bg-transparent px-3 py-2 text-sm"/><button className="rounded-lg border px-3 py-2 text-sm">新增价格版本</button></form><div className="mt-3 space-y-2">{ledger.priceSnapshots.map((item) => <div key={item.id} className="text-sm"><strong>{item.provider} · {item.model}</strong><small className="block" style={{ color: 'var(--text-secondary)' }}>输入 {item.promptCentsPerMillion} / 输出 {item.completionCentsPerMillion} · {new Date(item.validFrom).toLocaleDateString()}</small></div>)}</div></Panel>
  </>}</LoadingOrEmpty></div>
}

function NotificationsView() {
  const navigate = useNavigate()
  const [items, setItems] = useState<NotificationRecord[] | null>(null)
  const [push, setPush] = useState<PushStatus | null>(null)
  const [subscribed, setSubscribed] = useState(false)
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const categoryLabels: Array<[keyof NotificationPreferences['categories'], string]> = [
    ['proactive', 'AI 主动消息'], ['messageboard', '留言板'], ['diary', '日记授权结果'], ['moment', '朋友圈互动'],
    ['countdown', '倒数日'], ['listening', '一起听'], ['wake', 'Wake'], ['task', '工具任务完成'], ['relationship', '关系恢复申请'], ['call', '通话邀请'],
  ]
  const refresh = useCallback(async () => {
    const [notifications, status, prefs] = await Promise.all([loadNotifications(), loadPushStatus(), loadNotificationPreferences()])
    setItems(notifications); setPush(status); setPreferences(prefs); setSubscribed((await currentPushSubscription()) !== null)
  }, [])
  useEffect(() => { void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))) }, [refresh])
  async function togglePush() {
    setError(null); setNotice(null)
    try { if (subscribed) await disablePush(); else if (push?.publicKey) await enablePush(push.publicKey); await refresh() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  async function savePreferences() {
    if (preferences === null) return
    setSaving(true); setError(null); setNotice(null)
    try { setPreferences(await saveNotificationPreferences(preferences)); setNotice('通知偏好已保存') }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSaving(false) }
  }
  async function testPush() {
    setTesting(true); setError(null); setNotice(null)
    try {
      const result = await sendPushTest()
      setNotice(result.sent > 0 ? '测试通知已发送' : (result.reason ?? '测试通知未送达'))
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setTesting(false) }
  }
  async function openNotification(item: NotificationRecord): Promise<void> {
    try {
      if (item.readAt === null) await markNotificationRead(item.id)
      const route = item.metadata.route
      if (typeof route === 'string' && route.startsWith('/')) navigate(route)
      else await refresh()
    } catch (reason) { report(reason) }
  }
  const report = (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))
  return <div className="space-y-3"><ErrorLine value={error}/>{notice !== null && <p className="rounded-lg p-3 text-sm" style={{ color: 'var(--accent-strong)', background: 'var(--bg-subtle)' }}>{notice}</p>}
    <Panel><div className="flex items-center justify-between gap-3"><div><h2 className="font-medium">通知偏好</h2><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>只影响推送与主动打扰，站内通知仍会保留。</p></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={preferences?.enabled ?? true} disabled={preferences === null} onChange={(event) => preferences !== null && setPreferences({ ...preferences, enabled: event.target.checked })}/>总开关</label></div>
      {preferences !== null && <><div className="mt-3 flex flex-wrap items-center gap-3 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={preferences.quietHoursEnabled} onChange={(event) => setPreferences({ ...preferences, quietHoursEnabled: event.target.checked })}/>免打扰</label><label className="flex items-center gap-2">从 <input type="time" value={preferences.quietStart} onChange={(event) => setPreferences({ ...preferences, quietStart: event.target.value })} className="rounded border bg-transparent px-2 py-1"/></label><label className="flex items-center gap-2">到 <input type="time" value={preferences.quietEnd} onChange={(event) => setPreferences({ ...preferences, quietEnd: event.target.value })} className="rounded border bg-transparent px-2 py-1"/></label></div><div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">{categoryLabels.map(([key, label]) => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={preferences.categories[key]} onChange={(event) => setPreferences({ ...preferences, categories: { ...preferences.categories, [key]: event.target.checked } })}/>{label}</label>)}</div><div className="mt-3 flex justify-end"><button disabled={saving} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" onClick={() => void savePreferences()}>{saving ? '保存中…' : '保存通知偏好'}</button></div></>}
    </Panel>
    <Panel><div className="flex items-center justify-between gap-3"><div><h2 className="font-medium">Web Push</h2><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{!browserPushSupported() ? '当前浏览器不支持' : !push?.configured ? '服务端尚未配置 VAPID，站内通知仍可用' : subscribed ? '已启用' : '可选启用'}</p>{push?.lastError && <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>最近失败：{push.lastError}</p>}</div><div className="flex gap-2"><button disabled={!browserPushSupported() || !push?.configured} onClick={() => void togglePush()} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">{subscribed ? '关闭' : '启用'}</button><button disabled={!subscribed || testing} onClick={() => void testPush()} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">{testing ? '发送中…' : '发送测试通知'}</button></div></div></Panel>
    <div className="flex items-center justify-between"><span className="text-sm">未读 {items?.filter((item) => item.readAt === null).length ?? 0}</span><button className="text-sm underline" onClick={() => void markAllNotificationsRead().then(refresh).catch(report)}>全部已读</button></div><LoadingOrEmpty loading={items === null && error === null} empty={items?.length === 0}>{items?.map((item) => <button key={item.id} className="block w-full text-left" onClick={() => void openNotification(item)}><Panel className={item.readAt === null ? 'border-l-4' : 'opacity-70'}><div className="flex justify-between gap-3"><strong>{item.title}</strong><small>{dateTime(item.createdAt)}</small></div><p className="mt-1 whitespace-pre-wrap text-sm">{item.body}</p>{typeof item.metadata.route === 'string' && <span className="mt-2 block text-xs underline" style={{ color: 'var(--accent-strong)' }}>打开相关页面</span>}</Panel></button>)}</LoadingOrEmpty></div>
}

/**
 * 事件收件箱（Phase 6.5 P1）。
 *
 * 与「通知」tab 的区别值得说清：通知是 AI 主动跟你说的话（单向、只读、读过就完了）；
 * 事件是**一件等着被决定的事**（双向、有状态、决定之后会真的执行）。
 * 所以这里对「等北北确认」的条目直接渲染确认卡 —— 那件事需要动手，不是一个可读可不读的提醒。
 */
function eventStatusLabel(event: RuntimeEvent): string {
  if (event.status === 'pending') return event.decider === 'user' ? '等你确认' : '等小栖决定'
  if (event.status === 'approved') return '已完成'
  if (event.status === 'denied') return '已拒绝'
  return '执行失败'
}

function EventsView() {
  const [items, setItems] = useState<RuntimeEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(() => listEvents().then(setItems), [])
  useEffect(() => { void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))) }, [refresh])
  const waitingForMe = (items ?? []).filter((item) => item.decider === 'user' && item.status === 'pending')
  const rest = (items ?? []).filter((item) => !(item.decider === 'user' && item.status === 'pending'))
  return <div className="space-y-3"><ErrorLine value={error}/><LoadingOrEmpty loading={items === null && error === null} empty={items?.length === 0}>
    <>{waitingForMe.length > 0 && <><h2 className="text-sm font-semibold">等着你点头（{waitingForMe.length}）</h2>{waitingForMe.map((item) => <EventConfirmCard key={item.id} eventId={item.id} fallbackTitle={item.title} onDecided={() => void refresh().catch(() => undefined)}/>)}</>}
    {rest.length > 0 && <><h2 className="text-sm font-semibold">其它事件</h2>{rest.map((item) => <Panel key={item.id}><div className="flex justify-between gap-3"><strong>{item.title}</strong><small>{dateTime(item.createdAt)}</small></div>{item.detail !== '' && <p className="mt-1 whitespace-pre-wrap text-sm" style={{ color: 'var(--text-secondary)' }}>{item.detail}</p>}<p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{eventStatusLabel(item)}{item.result !== null ? ` · ${item.result}` : ''}</p></Panel>)}</>}</>
  </LoadingOrEmpty></div>
}

function statusLabel(ok: boolean, configured = true): string { return !configured ? '未配置' : ok ? '正常' : '异常' }
function RuntimeView() {
  const online = useOnlineStatus()
  const [runtime, setRuntime] = useState<LifeRuntimeView | null>(null); const [error, setError] = useState<string | null>(null); const [checking, setChecking] = useState(false)
  const refresh = useCallback(() => loadLifeRuntime().then(setRuntime), [])
  useEffect(() => { void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))) }, [refresh])
  async function checkNow() { setChecking(true); setError(null); try { await runAutomationCheck(); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setChecking(false) } }
  // 「未配置」看 gateway 下发的 configured 字段（没配 URL），别拿 lastError 字符串猜——
  // 那是两种病：未配置 ≠ 异常（gateway.health 注释原文）
  const mcpUnconfigured = runtime?.mcp.servers.length === 0
    || runtime?.mcp.servers.every((server) => !server.configured) === true
  return <div className="space-y-3"><ErrorLine value={error}/><LoadingOrEmpty loading={runtime === null && error === null} empty={false}>{runtime && <><div className="grid grid-cols-2 gap-2 text-sm"><Panel><span>habitat-server</span><strong className="block">{statusLabel(runtime.server.ok)}</strong></Panel><Panel><span>Eventide</span><strong className="block">{statusLabel(runtime.eventide.ok, runtime.eventide.configured)}</strong></Panel><Panel><span>MCP</span><strong className="block">{mcpUnconfigured ? '未配置' : statusLabel(runtime.mcp.ok)}</strong></Panel><Panel><span>主动行为</span><strong className="block">{runtime.automation.policy.enabled ? '已开启' : '已关闭'}</strong></Panel></div><div className="flex justify-end"><Link to="/life/eventide" data-testid="eventide-open" className="text-xs underline" style={{ color: 'var(--accent-strong)' }}>看状态详情（趋势 / 变化 / raw）</Link></div><Panel><h2 className="mb-2 font-medium">当前状态</h2>{runtime.bodyState === null ? <p className="text-sm">暂无 Eventide 快照</p> : <div className="grid grid-cols-2 gap-2 text-sm">{Object.entries(runtime.bodyState.payload).map(([key, value]) => <div key={key}><span style={{ color: 'var(--text-secondary)' }}>{key}</span><strong className="ml-2">{stateValue(value)}</strong></div>)}</div>}</Panel><Panel><div className="flex items-center justify-between"><h2 className="font-medium">主动行为运行态</h2><button disabled={checking || !online} onClick={() => void checkNow()} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{checking ? '检查中…' : '立即检查'}</button></div><div className="mt-3 grid grid-cols-2 gap-2 text-sm"><span>最近互动<strong className="block">{dateTime(runtime.automation.runtime.lastCounterpartAt)}</strong></span><span>最近唤醒<strong className="block">{dateTime(runtime.automation.runtime.lastWakeAt)}</strong></span><span>连续未回复<strong className="block">{runtime.automation.runtime.unansweredWakes}</strong></span><span>时区<strong className="block">{runtime.automation.policy.timeZone}</strong></span></div></Panel><Panel><h2 className="mb-2 font-medium">最近运行</h2>{runtime.automation.runs.length === 0 ? <p className="text-sm">尚无运行记录</p> : runtime.automation.runs.map((run) => <div key={run.id} className="border-t py-2 text-sm"><strong>{run.kind} · {run.status}</strong><small className="block" style={{ color: 'var(--text-secondary)' }}>{dateTime(run.at)}{run.reason ? ` · ${run.reason}` : ''}</small></div>)}</Panel><SurfFeedsView/></>}</LoadingOrEmpty></div>
}

/**
 * Surf 订阅源管理（Phase 7C 收口）。独处时小栖从这些源里挑一篇读 ——
 * 源就是她的「视野」，给北北一个看得见、改得动的入口，而不是只在 API 里存在。
 * 最多 10 条、必须 http(s)（服务端同规则校验，这里只是提前拦）。
 */
function SurfFeedsView() {
  const [feeds, setFeeds] = useState<string[] | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(() => loadSurfFeeds().then(setFeeds), [])
  useEffect(() => { void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))) }, [refresh])
  function persist(next: string[] | null) {
    setBusy(true); setError(null)
    saveSurfFeeds(next)
      .then((saved) => { setFeeds(saved); setDraft('') })
      .catch((reason: unknown) => setError(reason instanceof ApiRequestError ? reason.message : String(reason)))
      .finally(() => setBusy(false))
  }
  function addFeed(event: FormEvent) {
    event.preventDefault()
    const url = draft.trim()
    if (url === '' || feeds === null || busy) return
    if (!/^https?:\/\//i.test(url)) { setError('订阅源必须是 http(s) 链接'); return }
    if (feeds.includes(url)) { setError('这条订阅源已经在列表里了'); return }
    if (feeds.length >= 10) { setError('订阅源最多 10 条'); return }
    persist([...feeds, url])
  }
  return <Panel data-testid="surf-feeds-panel"><div className="flex items-center justify-between"><h2 className="font-medium">Surf 订阅源</h2><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>独处时从这里挑一篇读</span></div>
    <ErrorLine value={error}/>
    {feeds === null ? <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>正在读取…</p> : (
      <>
        <div className="mt-3 space-y-2">{feeds.map((feed) => <div key={feed} data-testid="surf-feed-item" className="flex items-center justify-between gap-2 text-sm"><span className="break-all" style={{ color: 'var(--text-secondary)' }}>{feed}</span><button type="button" data-testid="surf-feed-remove" disabled={busy || feeds.length <= 1} aria-label={`移除 ${feed}`} onClick={() => persist(feeds.filter((item) => item !== feed))} className="shrink-0 text-xs underline disabled:opacity-40" style={{ color: 'var(--danger)' }}>移除</button></div>)}</div>
        <form className="mt-3 flex gap-2" onSubmit={addFeed}><input data-testid="surf-feed-input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="https://…（RSS 地址）" className="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm"/><button data-testid="surf-feed-add" disabled={busy || draft.trim() === ''} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">添加</button></form>
        <div className="mt-2 flex justify-end"><button type="button" data-testid="surf-feed-reset" disabled={busy} onClick={() => persist(null)} className="text-xs underline" style={{ color: 'var(--text-secondary)' }}>恢复默认订阅源</button></div>
      </>
    )}
  </Panel>
}

/**
 * 生活痕迹（设计稿 screens-life.jsx）：心情 / 睡眠 / 日记 / 一起听 / 雨。
 *
 * ⚠️ 数据口径（铁律：假数据一律不搬）：设计稿里的「7h12m 睡眠」「心情曲线」「3.5 小时」全是占位。
 *  心情 / 睡眠目前**没有任何真实来源**（Eventide 的 bodyState 快照字段由上游自定，不保证有这些键），
 *  所以这两格诚实空态；日记是本周真篇数（按作者分）；一起听 / 雨的时长来自 `listenSessions`
 *  （第 6 批：真播放 / 程序化雨声落盘），格子本身是真入口 —— 没听过也能点进去。
 */
function TracesView() {
  const [weekDiary, setWeekDiary] = useState<{ companion: number; user: number } | null>(null)
  const [listen, setListen] = useState<{ music: number; rain: number } | null>(null)
  useEffect(() => {
    listDiaries()
      .then((items) => {
        const from = new Date()
        from.setDate(from.getDate() - 6)
        const floor = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`
        const week = items.filter((item) => item.entryDate >= floor)
        setWeekDiary({
          companion: week.filter((item) => item.author === 'companion').length,
          user: week.filter((item) => item.author === 'user').length,
        })
      })
      .catch(() => setWeekDiary(null))
    Promise.all([weekListenSeconds('music'), weekListenSeconds('rain')])
      .then(([music, rain]) => setListen({ music, rain }))
      .catch(() => setListen(null))
  }, [])
  /** 秒数 → 人话：0 秒回到诚实空态；不足一分钟说「刚开了个头」，够一小时带小时 */
  const listenText = (seconds: number, empty: string): string => {
    if (seconds <= 0) return empty
    if (seconds < 60) return '本周刚开了个头'
    const minutes = Math.floor(seconds / 60)
    return minutes < 60 ? `本周 ${minutes} 分钟` : `本周 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
  }
  const emptyCell = (label: string, icon: ReactNode, text: string) => (
    <div className="bento-cell">
      <div className="cell-label">{icon} {label}</div>
      <div className="t-caption" style={{ color: 'var(--text-tertiary)' }}>{text}</div>
    </div>
  )
  return (
    <div className="bento" style={{ paddingTop: 8, paddingBottom: 8 }}>
      {/* 心情 · 本周：还没有真实来源，诚实空态 */}
      {emptyCell('心情 · 本周', <IconHeart size={13} />, '还没有心情记录')}

      {/* 睡眠：同上 */}
      {emptyCell('睡眠', <IconMoon size={13} />, '还没有睡眠记录')}

      {/* 日记：本周真篇数，按作者分 */}
      <div className="bento-cell">
        <div className="cell-label"><IconBook size={13} /> 日记</div>
        <div>
          <span style={{ fontSize: 30, fontWeight: 700 }}>{weekDiary === null ? 0 : weekDiary.companion + weekDiary.user}</span>
          <span className="t-caption" style={{ color: 'var(--text-secondary)', marginLeft: 4 }}>篇</span>
        </div>
        <span className="t-caption" style={{ color: 'var(--text-secondary)' }}>
          {weekDiary === null ? '日记还空着' : `小栖写了 ${weekDiary.companion} 篇，你 ${weekDiary.user} 篇`}
        </span>
      </div>

      {/* 一起听 / 雨：真时长（第 6 批落盘）+ 真入口；没听过也是能点的入口 */}
      <Link to="/home/music" className="bento-cell pressable" data-testid="traces-music">
        <div className="cell-label"><IconNote size={13} /> 一起听</div>
        <div className="t-caption" style={{ color: (listen?.music ?? 0) > 0 ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>
          {listenText(listen?.music ?? 0, '还没一起听过歌')}
        </div>
      </Link>
      <Link to="/solo" className="bento-cell pressable" data-testid="traces-rain">
        <div className="cell-label"><IconDrop size={13} /> 雨</div>
        <div className="t-caption" style={{ color: (listen?.rain ?? 0) > 0 ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>
          {listenText(listen?.rain ?? 0, '还没听过雨声')}
        </div>
      </Link>

      <div className="t-caption" style={{ gridColumn: 'span 2', textAlign: 'center', color: 'var(--text-tertiary)', paddingBottom: 4 }}>
        数据只记录，不评判。
      </div>
    </div>
  )
}

export function LifePage() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab: LifeTab = TABS.some((item) => item.id === requested) ? requested as LifeTab : 'calendar'
  // 两套并排（拍板）：默认「生活痕迹」；老链接 ?tab=… 仍然直达「记录」里对应的那页（不丢书签）
  const view: 'traces' | 'records' = params.get('view') === 'records' || requested !== null ? 'records' : 'traces'
  const [month, setMonth] = useState(initialMonth())
  const switchTo = (next: 'traces' | 'records') => {
    if (next === 'records') setParams(tab === 'calendar' ? { view: 'records' } : { view: 'records', tab })
    else setParams({})
  }
  return (
    <div>
      <div className="topbar">
        <div>
          <div className="t-h1">生活</div>
          <div className="t-caption" style={{ color: 'var(--text-tertiary)', marginTop: 3 }}>这一周的栖居痕迹</div>
        </div>
      </div>
      <div style={{ padding: '0 20px' }}>
        <div className="seg" data-testid="life-view-switch" style={{ marginBottom: 12 }}>
          <button type="button" className={`seg-item${view === 'traces' ? ' is-on' : ''}`} onClick={() => switchTo('traces')}>生活痕迹</button>
          <button type="button" className={`seg-item${view === 'records' ? ' is-on' : ''}`} onClick={() => switchTo('records')}>记录</button>
        </div>
        {view === 'traces' && <TracesView />}
        {view === 'records' && (
          <div className="pb-6">
            <div className="mb-4 grid grid-cols-5 rounded-xl p-1" style={{ background: 'var(--bg-subtle)' }}>{TABS.map((item) => <button key={item.id} onClick={() => setParams(item.id === 'calendar' ? { view: 'records' } : { view: 'records', tab: item.id })} className="rounded-lg px-2 py-2 text-sm" style={tab === item.id ? { background: 'var(--bg-surface-solid)', color: 'var(--text-primary)' } : { color: 'var(--text-secondary)' }}>{item.label}</button>)}</div>
            {tab === 'calendar' && <CalendarView month={month} setMonth={setMonth}/>}
            {tab === 'ledger' && <LedgerView month={month}/>}
            {tab === 'notifications' && <NotificationsView/>}
            {tab === 'events' && <EventsView/>}
            {tab === 'runtime' && <RuntimeView/>}
          </div>
        )}
      </div>
    </div>
  )
}
