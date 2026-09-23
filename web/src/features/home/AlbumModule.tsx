import { useEffect, useRef, useState, type FormEvent } from 'react'
import { MAX_PHOTO_BYTES, type Photo, type PhotoMime } from '@shared/types'
import { createPhoto, deletePhoto, listPhotos } from '../../db/home'
import { ContentSourceLink } from './ContentSourceLink'

const ALLOWED_MIMES: readonly PhotoMime[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

function todayKey(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('无法读取图片'))
    reader.onerror = () => reject(reader.error ?? new Error('无法读取图片'))
    reader.readAsDataURL(file)
  })
}

export function AlbumModule() {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [items, setItems] = useState<Photo[]>([])
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [takenAt, setTakenAt] = useState(todayKey)
  const [selected, setSelected] = useState<{ name: string; dataUrl: string; mimeType: PhotoMime; size: number } | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    setItems(await listPhotos())
  }

  useEffect(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false))
  }, [])

  async function chooseFile(file: File | null): Promise<void> {
    setSelected(null)
    if (file === null) return
    if (!ALLOWED_MIMES.includes(file.type as PhotoMime)) {
      setError('只支持 PNG、JPEG、WebP 或 GIF 图片')
      return
    }
    if (file.size <= 0 || file.size > MAX_PHOTO_BYTES) {
      setError('图片大小必须在 3 MB 以内')
      return
    }
    try {
      const dataUrl = await readAsDataUrl(file)
      setSelected({ name: file.name, dataUrl, mimeType: file.type as PhotoMime, size: file.size })
      if (title.trim() === '') setTitle(file.name.replace(/\.[^.]+$/, ''))
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (selected === null) return
    setBusy(true)
    try {
      await createPhoto({ title, caption, imageDataUrl: selected.dataUrl, mimeType: selected.mimeType, sizeBytes: selected.size, takenAt })
      setTitle('')
      setCaption('')
      setTakenAt(todayKey())
      setSelected(null)
      if (fileRef.current !== null) fileRef.current.value = ''
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string): Promise<void> {
    if (deletingId !== id) {
      setDeletingId(id)
      return
    }
    try {
      await deletePhoto(id)
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
        <h2 className="text-sm font-semibold">放进一张照片</h2>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)} className="text-sm" />
        <p className="text-xs" style={{ color: 'var(--color-text-dim)' }}>PNG / JPEG / WebP / GIF，单张不超过 3 MB；照片保存在当前浏览器并进入备份。</p>
        {selected !== null && <img src={selected.dataUrl} alt="待保存预览" className="max-h-56 w-full rounded-lg object-contain" style={{ backgroundColor: 'var(--color-surface-alt)' }} />}
        <label htmlFor="photo-title" className="sr-only">照片名称</label>
        <input id="photo-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="照片名称" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }} />
        <label htmlFor="photo-date" className="text-xs" style={{ color: 'var(--color-text-dim)' }}>拍摄日期</label>
        <input id="photo-date" type="date" value={takenAt} onChange={(event) => setTakenAt(event.target.value)} className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }} />
        <label htmlFor="photo-caption" className="sr-only">照片说明</label>
        <textarea id="photo-caption" value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={500} rows={2} placeholder="这张照片的故事（可选）" className="resize-none rounded-lg border bg-transparent p-3 text-sm" style={{ borderColor: 'var(--color-border)' }} />
        <button type="submit" disabled={busy || selected === null || title.trim() === '' || takenAt === ''} className="justify-self-end rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)' }}>{busy ? '保存中…' : '保存照片'}</button>
      </form>

      {error !== null && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {loading ? <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>正在翻看相册……</p> : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-dim)' }}>相册还是空的。第一张照片会留住一个开始。</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3">
          {items.map((item) => (
            <li key={item.id} className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <img src={item.imageDataUrl} alt={item.title} className="aspect-square w-full object-cover" loading="lazy" />
              <div className="p-3">
                <h3 className="break-words text-sm font-medium">{item.title}</h3>
                <time className="mt-1 block text-xs" style={{ color: 'var(--color-text-dim)' }}>{item.takenAt}</time>
                {item.caption !== null && <p className="mt-2 break-words text-xs">{item.caption}</p>}
                <ContentSourceLink item={item} />
                <button type="button" onClick={() => void remove(item.id)} onBlur={() => setDeletingId(null)} className="mt-3 text-xs" style={{ color: deletingId === item.id ? 'var(--color-danger)' : 'var(--color-text-dim)' }}>{deletingId === item.id ? '确认删除？' : '删除'}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
