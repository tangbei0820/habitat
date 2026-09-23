import { useEffect, useState, type FormEvent } from 'react'
import type { CountdownDay } from '@shared/types'
import { createCountdown, deleteCountdown, listCountdowns } from '../../db/home'

function dayDistance(targetDate: string): number {
  const [year, month, day] = targetDate.split('-').map(Number)
  const target = new Date(year, month - 1, day)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

function distanceLabel(days: number): string {
  if (days === 0) return '就是今天'
  if (days > 0) return `还有 ${String(days)} 天`
  return `已过 ${String(Math.abs(days))} 天`
}

export function CountdownModule() {
  const [items, setItems] = useState<CountdownDay[]>([])
  const [title, setTitle] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    setItems(await listCountdowns())
  }

  useEffect(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false))
  }, [])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    try {
      await createCountdown(title, targetDate)
      setTitle('')
      setTargetDate('')
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function remove(id: string): Promise<void> {
    if (deleting !== id) {
      setDeleting(id)
      return
    }
    await deleteCountdown(id)
    setDeleting(null)
    await refresh()
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(event) => void submit(event)} className="grid gap-2 rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <label htmlFor="countdown-title" className="text-sm font-medium">新倒数日</label>
        <input id="countdown-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="例如：相识纪念日" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }} />
        <input aria-label="目标日期" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }} />
        <button type="submit" disabled={title.trim() === '' || targetDate === ''} className="mt-1 justify-self-end rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)' }}>添加</button>
      </form>
      {error !== null && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {loading ? <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>正在读取倒数日…</p> : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-dim)' }}>还没有需要一起期待的日子。</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const days = dayDistance(item.targetDate)
            return (
              <li key={item.id} className="flex items-center gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium">{item.title}</p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--color-text-dim)' }}>{item.targetDate}</p>
                </div>
                <strong className="shrink-0 text-sm" style={{ color: days < 0 ? 'var(--color-text-dim)' : 'var(--color-primary)' }}>{distanceLabel(days)}</strong>
                <button type="button" onClick={() => void remove(item.id)} onBlur={() => setDeleting(null)} className="shrink-0 text-xs" style={{ color: deleting === item.id ? 'var(--color-danger)' : 'var(--color-text-dim)' }}>{deleting === item.id ? '确认？' : '删除'}</button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
