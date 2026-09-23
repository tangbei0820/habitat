import { useEffect, useState, type FormEvent } from 'react'
import type { Artwork, ArtworkCategory } from '@shared/types'
import { createArtwork, deleteArtwork, listArtworks, updateArtwork } from '../../db/home'

const CATEGORY_LABELS: Record<ArtworkCategory, string> = {
  writing: '文字',
  visual: '绘画 / 视觉',
  audio: '音乐 / 声音',
  other: '其他',
}

export function WorksModule() {
  const [items, setItems] = useState<Artwork[]>([])
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<ArtworkCategory>('writing')
  const [description, setDescription] = useState('')
  const [externalUrl, setExternalUrl] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    setItems(await listArtworks())
  }

  useEffect(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false))
  }, [])

  function resetForm(): void {
    setTitle('')
    setCategory('writing')
    setDescription('')
    setExternalUrl('')
    setEditingId(null)
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    try {
      if (editingId === null) await createArtwork(title, category, description, externalUrl)
      else await updateArtwork(editingId, title, category, description, externalUrl)
      resetForm()
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function startEditing(item: Artwork): void {
    setTitle(item.title)
    setCategory(item.category)
    setDescription(item.description)
    setExternalUrl(item.externalUrl ?? '')
    setEditingId(item.id)
    setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function remove(id: string): Promise<void> {
    if (deletingId !== id) {
      setDeletingId(id)
      return
    }
    try {
      await deleteArtwork(id)
      if (editingId === id) resetForm()
      setDeletingId(null)
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(event) => void submit(event)} className="grid gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{editingId === null ? '登记一件作品' : '编辑作品'}</h2>
          {editingId !== null && <button type="button" onClick={resetForm} className="text-xs" style={{ color: 'var(--color-text-dim)' }}>取消编辑</button>}
        </div>
        <label htmlFor="work-title" className="sr-only">作品名称</label>
        <input id="work-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="作品名称" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }} />
        <label htmlFor="work-category" className="text-xs" style={{ color: 'var(--color-text-dim)' }}>类型</label>
        <select id="work-category" value={category} onChange={(event) => setCategory(event.target.value as ArtworkCategory)} className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }}>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label htmlFor="work-description" className="sr-only">作品说明</label>
        <textarea id="work-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={3000} rows={5} placeholder="写下作品的内容、灵感或进度……" className="resize-y rounded-lg border bg-transparent p-3 text-sm leading-6" style={{ borderColor: 'var(--color-border)' }} />
        <label htmlFor="work-url" className="sr-only">作品链接</label>
        <input id="work-url" type="url" inputMode="url" value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="作品链接（可选）" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }} />
        <button type="submit" disabled={title.trim() === '' || description.trim() === ''} className="justify-self-end rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)' }}>{editingId === null ? '保存作品' : '保存修改'}</button>
      </form>

      {error !== null && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {loading ? <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>正在整理作品……</p> : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-dim)' }}>这里还空着。完成或正在进行的作品，都可以留下来。</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-medium">{item.title}</h3>
                <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-dim)' }}>{CATEGORY_LABELS[item.category]}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{item.description}</p>
              {item.externalUrl !== null && <a href={item.externalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block break-all text-xs underline" style={{ color: 'var(--color-primary)' }}>打开作品链接</a>}
              <div className="mt-3 flex justify-end gap-3 text-xs">
                <button type="button" onClick={() => startEditing(item)} style={{ color: 'var(--color-primary)' }}>编辑</button>
                <button type="button" onClick={() => void remove(item.id)} onBlur={() => setDeletingId(null)} style={{ color: deletingId === item.id ? 'var(--color-danger)' : 'var(--color-text-dim)' }}>{deletingId === item.id ? '确认删除？' : '删除'}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
