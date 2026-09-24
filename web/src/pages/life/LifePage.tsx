import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { LifeLedgerView, LifeMonthSummary, LifeRuntimeView, NotificationRecord, PushStatus } from '@shared/types'
import {
  addPriceSnapshot, addWalletTransaction, loadLifeDay, loadLifeLedger, loadLifeMonth,
  loadLifeRuntime, loadNotifications, loadPushStatus, markAllNotificationsRead,
  markNotificationRead, runAutomationCheck, type LifeDayDetail,
} from '../../features/life/api'
import { browserPushSupported, currentPushSubscription, disablePush, enablePush } from '../../features/life/push'
import { useOnlineStatus } from '../../features/offline/useOnlineStatus'

type LifeTab = 'calendar' | 'ledger' | 'notifications' | 'runtime'
const TABS: Array<{ id: LifeTab; label: string }> = [
  { id: 'calendar', label: '月历' }, { id: 'ledger', label: '账本' },
  { id: 'notifications', label: '通知' }, { id: 'runtime', label: '运行' },
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
function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border p-4 ${className}`} style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>{children}</section>
}
function ErrorLine({ value }: { value: string | null }) {
  return value === null ? null : <p className="rounded-lg p-3 text-sm" style={{ color: 'var(--color-danger)', background: 'var(--color-surface-alt)' }}>{value}</p>
}
function LoadingOrEmpty({ loading, empty, children }: { loading: boolean; empty: boolean; children: ReactNode }) {
  if (loading) return <p className="py-8 text-center text-sm" style={{ color: 'var(--color-text-dim)' }}>正在读取…</p>
  if (empty) return <p className="py-8 text-center text-sm" style={{ color: 'var(--color-text-dim)' }}>这里还没有记录</p>
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
    <div className="flex items-center justify-between"><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setMonth(moveMonth(month, -1))}>上月</button><div className="text-center"><strong>{month}</strong><p className="text-xs" style={{ color: 'var(--color-text-dim)' }}>{summary?.timeZone ?? '用户时区'}</p></div><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setMonth(moveMonth(month, 1))}>下月</button></div>
    <button className="text-xs underline" style={{ color: 'var(--color-text-dim)' }} onClick={() => setMonth(initialMonth())}>回到本月</button><ErrorLine value={error}/>
    <LoadingOrEmpty loading={loading} empty={false}><Panel><div className="grid grid-cols-7 gap-1 text-center text-xs" style={{ color: 'var(--color-text-dim)' }}>{'日一二三四五六'.split('').map((day) => <span key={day} className="py-1">{day}</span>)}{cells.map((day, index) => {
      if (day === null) return <span key={`empty-${index}`}/>
      const key = `${month}-${String(day).padStart(2, '0')}`; const item = summaries.get(key)
      return <button key={key} onClick={() => selectDay(key)} className="min-h-14 rounded-lg border p-1 text-left" style={{ borderColor: selected === key ? 'var(--color-accent)' : 'var(--color-border)', background: item ? 'var(--color-surface-alt)' : 'transparent' }}><span>{day}</span>{item && <span className="mt-1 block text-[10px]" style={{ color: item.failedEventCount > 0 ? 'var(--color-danger)' : 'var(--color-text-dim)' }}>{item.eventCount}事 · {item.apiCalls}次</span>}</button>
    })}</div></Panel>
    {summary && <div className="grid grid-cols-3 gap-2 text-center text-xs"><Panel><strong className="block text-base">{summary.totals.eventCount}</strong>本月事件</Panel><Panel><strong className="block text-base">{summary.totals.totalTokens}</strong>Token</Panel><Panel><strong className="block text-base">{money(summary.totals.pricedCostCents)}</strong>{summary.totals.unpricedCalls > 0 ? `另 ${summary.totals.unpricedCalls} 次未定价` : '已全部定价'}</Panel></div>}
    {selected && <Panel><h2 className="mb-3 font-medium">{selected} 明细</h2>{detail === null ? <p className="text-sm">正在读取…</p> : detail.events.length + detail.usage.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>当天没有事实记录</p> : <div className="space-y-2 text-sm">{detail.events.map((event) => <div key={`event-${event.id}`} className="rounded-lg p-2" style={{ background: 'var(--color-surface-alt)' }}><strong>{event.eventType}</strong><span className="ml-2 text-xs">{dateTime(event.at)}</span></div>)}{detail.usage.map((usage) => <div key={`usage-${usage.id}`} className="rounded-lg p-2" style={{ background: 'var(--color-surface-alt)' }}><strong>{usage.service}</strong> · {usage.model}<span className="block text-xs">{usage.totalTokens} Token · {usage.cost === null ? '未定价' : money(usage.cost)}</span></div>)}</div>}</Panel>}
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
  return <div className="space-y-3"><ErrorLine value={error}/>{notice && <p className="text-sm" style={{ color: 'var(--color-accent)' }}>{notice}</p>}<LoadingOrEmpty loading={ledger === null && error === null} empty={false}>{ledger && <>
    <div className="grid grid-cols-2 gap-2 text-sm"><Panel><span style={{ color: 'var(--color-text-dim)' }}>本月 API</span><strong className="block text-xl">{ledger.summary.totals.apiCalls} 次</strong></Panel><Panel><span style={{ color: 'var(--color-text-dim)' }}>已定价费用</span><strong className="block text-xl">{money(ledger.summary.totals.pricedCostCents)}</strong><small>{ledger.summary.totals.unpricedCalls} 次未定价</small></Panel></div>
    <Panel><h2 className="mb-2 font-medium">按服务</h2>{ledger.byService.length === 0 ? <p className="text-sm">暂无用量</p> : ledger.byService.map((item) => <div key={item.key} className="flex justify-between border-t py-2 text-sm"><span>{item.key}</span><span>{item.calls} 次 · {item.totalTokens} Token · {money(item.pricedCostCents)}{item.unpricedCalls > 0 ? ` +${item.unpricedCalls} 未定价` : ''}</span></div>)}</Panel>
    <Panel><h2 className="mb-2 font-medium">按方案与模型</h2>{ledger.byModel.length === 0 ? <p className="text-sm">暂无用量</p> : ledger.byModel.map((item) => <div key={item.key} className="border-t py-2 text-sm"><strong>{item.key}</strong><small className="block" style={{ color: 'var(--color-text-dim)' }}>{item.calls} 次 · {item.totalTokens} Token · {money(item.pricedCostCents)}{item.unpricedCalls > 0 ? ` · ${item.unpricedCalls} 次未定价` : ''}</small></div>)}</Panel>
    <Panel><h2 className="mb-2 font-medium">小栖钱包</h2><strong className="text-2xl">{ledger.wallet.balance}</strong><form className="mt-3 grid gap-2" onSubmit={(event) => void submitWallet(event)}><input required type="number" value={walletDelta} onChange={(event) => setWalletDelta(event.target.value)} placeholder="变化量：正数充值，负数支出" className="rounded-lg border bg-transparent px-3 py-2 text-sm"/><input required maxLength={200} value={walletReason} onChange={(event) => setWalletReason(event.target.value)} placeholder="原因（必填）" className="rounded-lg border bg-transparent px-3 py-2 text-sm"/><button className="rounded-lg px-3 py-2 text-sm text-white" style={{ background: 'var(--color-accent)' }}>追加流水</button></form><div className="mt-3 space-y-2">{ledger.walletTransactions.map((item) => <div key={item.id} className="flex justify-between text-sm"><span>{item.reason}<small className="block" style={{ color: 'var(--color-text-dim)' }}>{dateTime(item.createdAt)} · 余额 {item.balanceAfter}</small></span><strong style={{ color: item.delta >= 0 ? 'var(--color-accent)' : 'var(--color-danger)' }}>{item.delta >= 0 ? '+' : ''}{item.delta}</strong></div>)}</div></Panel>
    <Panel><h2 className="font-medium">价格快照</h2><p className="mb-3 text-xs" style={{ color: 'var(--color-text-dim)' }}>单位：分 / 百万 Token。快照新增后不可修改。</p><form className="grid gap-2" onSubmit={(event) => void submitPrice(event)}><input required value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="Provider" className="rounded-lg border bg-transparent px-3 py-2 text-sm"/><input required value={model} onChange={(event) => setModel(event.target.value)} placeholder="模型名" className="rounded-lg border bg-transparent px-3 py-2 text-sm"/><div className="grid grid-cols-2 gap-2"><input required min="0" type="number" value={promptPrice} onChange={(event) => setPromptPrice(event.target.value)} placeholder="输入单价" className="rounded-lg border bg-transparent px-3 py-2 text-sm"/><input required min="0" type="number" value={completionPrice} onChange={(event) => setCompletionPrice(event.target.value)} placeholder="输出单价" className="rounded-lg border bg-transparent px-3 py-2 text-sm"/></div><input required type="date" value={validDate} onChange={(event) => setValidDate(event.target.value)} className="rounded-lg border bg-transparent px-3 py-2 text-sm"/><button className="rounded-lg border px-3 py-2 text-sm">新增价格版本</button></form><div className="mt-3 space-y-2">{ledger.priceSnapshots.map((item) => <div key={item.id} className="text-sm"><strong>{item.provider} · {item.model}</strong><small className="block" style={{ color: 'var(--color-text-dim)' }}>输入 {item.promptCentsPerMillion} / 输出 {item.completionCentsPerMillion} · {new Date(item.validFrom).toLocaleDateString()}</small></div>)}</div></Panel>
  </>}</LoadingOrEmpty></div>
}

function NotificationsView() {
  const [items, setItems] = useState<NotificationRecord[] | null>(null); const [push, setPush] = useState<PushStatus | null>(null); const [subscribed, setSubscribed] = useState(false); const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => { const [notifications, status] = await Promise.all([loadNotifications(), loadPushStatus()]); setItems(notifications); setPush(status); setSubscribed((await currentPushSubscription()) !== null) }, [])
  useEffect(() => { void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))) }, [refresh])
  async function togglePush() { setError(null); try { if (subscribed) await disablePush(); else if (push?.publicKey) await enablePush(push.publicKey); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } }
  const report = (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))
  return <div className="space-y-3"><ErrorLine value={error}/><Panel><div className="flex items-center justify-between"><div><h2 className="font-medium">Web Push</h2><p className="text-xs" style={{ color: 'var(--color-text-dim)' }}>{!browserPushSupported() ? '当前浏览器不支持' : !push?.configured ? '服务端尚未配置 VAPID，站内通知仍可用' : subscribed ? '已启用' : '可选启用'}</p>{push?.lastError && <p className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>最近失败：{push.lastError}</p>}</div><button disabled={!browserPushSupported() || !push?.configured} onClick={() => void togglePush()} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">{subscribed ? '关闭' : '启用'}</button></div></Panel><div className="flex items-center justify-between"><span className="text-sm">未读 {items?.filter((item) => item.readAt === null).length ?? 0}</span><button className="text-sm underline" onClick={() => void markAllNotificationsRead().then(refresh).catch(report)}>全部已读</button></div><LoadingOrEmpty loading={items === null && error === null} empty={items?.length === 0}>{items?.map((item) => <button key={item.id} className="block w-full text-left" onClick={() => item.readAt === null && void markNotificationRead(item.id).then(refresh).catch(report)}><Panel className={item.readAt === null ? 'border-l-4' : 'opacity-70'}><div className="flex justify-between gap-3"><strong>{item.title}</strong><small>{dateTime(item.createdAt)}</small></div><p className="mt-1 whitespace-pre-wrap text-sm">{item.body}</p></Panel></button>)}</LoadingOrEmpty></div>
}

function statusLabel(ok: boolean, configured = true): string { return !configured ? '未配置' : ok ? '正常' : '异常' }
function RuntimeView() {
  const online = useOnlineStatus()
  const [runtime, setRuntime] = useState<LifeRuntimeView | null>(null); const [error, setError] = useState<string | null>(null); const [checking, setChecking] = useState(false)
  const refresh = useCallback(() => loadLifeRuntime().then(setRuntime), [])
  useEffect(() => { void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))) }, [refresh])
  async function checkNow() { setChecking(true); setError(null); try { await runAutomationCheck(); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setChecking(false) } }
  const mcpUnconfigured = runtime?.mcp.servers.length === 0
    || runtime?.mcp.servers.every((server) => server.lastError === 'not configured') === true
  return <div className="space-y-3"><ErrorLine value={error}/><LoadingOrEmpty loading={runtime === null && error === null} empty={false}>{runtime && <><div className="grid grid-cols-2 gap-2 text-sm"><Panel><span>habitat-server</span><strong className="block">{statusLabel(runtime.server.ok)}</strong></Panel><Panel><span>Eventide</span><strong className="block">{statusLabel(runtime.eventide.ok, runtime.eventide.configured)}</strong></Panel><Panel><span>MCP</span><strong className="block">{mcpUnconfigured ? '未配置' : statusLabel(runtime.mcp.ok)}</strong></Panel><Panel><span>主动行为</span><strong className="block">{runtime.automation.policy.enabled ? '已开启' : '已关闭'}</strong></Panel></div><Panel><h2 className="mb-2 font-medium">当前状态</h2>{runtime.bodyState === null ? <p className="text-sm">暂无 Eventide 快照</p> : <div className="grid grid-cols-2 gap-2 text-sm">{Object.entries(runtime.bodyState.payload).map(([key, value]) => <div key={key}><span style={{ color: 'var(--color-text-dim)' }}>{key}</span><strong className="ml-2">{String(value)}</strong></div>)}</div>}</Panel><Panel><div className="flex items-center justify-between"><h2 className="font-medium">主动行为运行态</h2><button disabled={checking || !online} onClick={() => void checkNow()} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{checking ? '检查中…' : '立即检查'}</button></div><div className="mt-3 grid grid-cols-2 gap-2 text-sm"><span>最近互动<strong className="block">{dateTime(runtime.automation.runtime.lastCounterpartAt)}</strong></span><span>最近唤醒<strong className="block">{dateTime(runtime.automation.runtime.lastWakeAt)}</strong></span><span>连续未回复<strong className="block">{runtime.automation.runtime.unansweredWakes}</strong></span><span>时区<strong className="block">{runtime.automation.policy.timeZone}</strong></span></div></Panel><Panel><h2 className="mb-2 font-medium">最近运行</h2>{runtime.automation.runs.length === 0 ? <p className="text-sm">尚无运行记录</p> : runtime.automation.runs.map((run) => <div key={run.id} className="border-t py-2 text-sm"><strong>{run.kind} · {run.status}</strong><small className="block" style={{ color: 'var(--color-text-dim)' }}>{dateTime(run.at)}{run.reason ? ` · ${run.reason}` : ''}</small></div>)}</Panel></>}</LoadingOrEmpty></div>
}

export function LifePage() {
  const [params, setParams] = useSearchParams(); const requested = params.get('tab')
  const tab: LifeTab = TABS.some((item) => item.id === requested) ? requested as LifeTab : 'calendar'
  const [month, setMonth] = useState(initialMonth())
  return <div className="px-4 py-6"><h1 className="mb-4 text-lg font-semibold">生活</h1><div className="mb-4 grid grid-cols-4 rounded-xl p-1" style={{ background: 'var(--color-surface-alt)' }}>{TABS.map((item) => <button key={item.id} onClick={() => setParams(item.id === 'calendar' ? {} : { tab: item.id })} className="rounded-lg px-2 py-2 text-sm" style={tab === item.id ? { background: 'var(--color-surface)', color: 'var(--color-text)' } : { color: 'var(--color-text-dim)' }}>{item.label}</button>)}</div>{tab === 'calendar' && <CalendarView month={month} setMonth={setMonth}/>} {tab === 'ledger' && <LedgerView month={month}/>} {tab === 'notifications' && <NotificationsView/>} {tab === 'runtime' && <RuntimeView/>}</div>
}
