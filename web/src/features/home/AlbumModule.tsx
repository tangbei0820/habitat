/**
 * 相册（SPEC §3.7.3）
 *
 * 与收藏分类同构：**单归属**（一张照片最多属于一个相册），筛选条形态也一样。
 * 区别只在文案 —— 这里是「相册」而不是「分类」，以及「移出相册」与「删除照片」是两件事：
 * 前者只是把归属置空（照片还在），后者不可逆。菜单里两个动作都有，措辞不混用。
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { MAX_PHOTO_BYTES, type Photo, type PhotoCollection, type PhotoMime } from '@shared/types'
import { ActionSheet, type SheetAction } from '../../components/ActionSheet'
import {
  createPhoto,
  createPhotoCollection,
  deletePhoto,
  deletePhotoCollection,
  listPhotoCollections,
  listPhotos,
  renamePhotoCollection,
  setPhotoCollection,
} from '../../db/home'
import { CategoryBar } from './CategoryBar'
import {
  countByCategory,
  filterByCategory,
  normalizeSelection,
  type CategorySelection,
} from './categories'
import { ContentSourceLink } from './ContentSourceLink'

const ALLOWED_MIMES: readonly PhotoMime[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

type SheetTarget = { kind: 'item'; id: string } | { kind: 'move'; id: string }

const CONFIRM_MS = 3000
const TOAST_MS = 2500

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
  const [collections, setCollections] = useState<PhotoCollection[]>([])
  const [selection, setSelection] = useState<CategorySelection>({ kind: 'all' })
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [takenAt, setTakenAt] = useState(todayKey)
  const [selected, setSelected] = useState<{ name: string; dataUrl: string; mimeType: PhotoMime; size: number } | null>(null)
  const [sheet, setSheet] = useState<SheetTarget | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [pendingMoveId, setPendingMoveId] = useState<string | null>(null)
  const [createToken, setCreateToken] = useState(0)
  const confirmTimerRef = useRef<number | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  useEffect(() => {
    void refresh()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(
    () => () => {
      for (const ref of [confirmTimerRef, toastTimerRef]) {
        if (ref.current !== null) window.clearTimeout(ref.current)
      }
    },
    [],
  )

  async function refresh(): Promise<void> {
    const [nextItems, nextCollections] = await Promise.all([listPhotos(), listPhotoCollections()])
    setItems(nextItems)
    setCollections(nextCollections)
    setSelection((prev) => normalizeSelection(prev, nextCollections))
  }

  function showToast(message: string): void {
    setToast(message)
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), TOAST_MS)
  }

  function askRemove(id: string): void {
    if (confirmTimerRef.current !== null) window.clearTimeout(confirmTimerRef.current)
    setConfirmingId(id)
    confirmTimerRef.current = window.setTimeout(() => setConfirmingId(null), CONFIRM_MS)
  }

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
      // 与收藏同理：新照片落在「未分类」，正筛着某个相册时会「看不见刚加的」
      setSelection({ kind: 'all' })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await deletePhoto(id)
      setConfirmingId(null)
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function applyMove(photoId: string, collectionId: string | null): Promise<void> {
    await setPhotoCollection(photoId, collectionId)
    await refresh()
    setError(null)
    const name = collectionId === null ? null : (collections.find((c) => c.id === collectionId)?.name ?? null)
    showToast(name === null ? '已移出相册' : `已移入「${name}」`)
  }

  async function removeCollection(collectionId: string): Promise<void> {
    const moved = await deletePhotoCollection(collectionId)
    await refresh()
    showToast(moved === 0 ? '已删除相册' : `已删除相册，${moved} 张回到未分类`)
  }

  const counts = useMemo(
    () => countByCategory(items, collections, (item) => item.collectionId),
    [items, collections],
  )
  const visible = useMemo(
    () => filterByCategory(items, selection, collections, (item) => item.collectionId),
    [items, selection, collections],
  )

  const sheetActions = useMemo<SheetAction[] | null>(() => {
    if (sheet === null) return null
    const photo = items.find((item) => item.id === sheet.id)
    if (photo === undefined) return null
    if (sheet.kind === 'move') {
      const current = photo.collectionId
      return [
        ...collections
          .filter((collection) => collection.id !== current)
          .map((collection) => ({ id: `collection:${collection.id}`, label: collection.name })),
        { id: 'move-new-collection', label: '＋ 新建相册' },
        ...(current === null ? [] : [{ id: 'move-none', label: '移出相册' }]),
      ]
    }
    return [
      { id: 'move', label: '移入相册' },
      ...(photo.collectionId === null ? [] : [{ id: 'unassign', label: '移出相册' }]),
      { id: 'delete', label: '删除照片', danger: true },
    ]
  }, [sheet, items, collections])

  const sheetTitle = useMemo(() => {
    if (sheet === null) return undefined
    const photo = items.find((item) => item.id === sheet.id)
    if (photo === undefined) return undefined
    return sheet.kind === 'move' ? `把「${photo.title}」移到…` : photo.title
  }, [sheet, items])

  async function runSheetAction(actionId: string): Promise<void> {
    if (sheet === null) return
    const target = sheet
    setSheet(null)
    try {
      if (target.kind === 'move') {
        if (actionId === 'move-new-collection') {
          setPendingMoveId(target.id)
          setCreateToken((token) => token + 1)
        } else if (actionId === 'move-none') {
          await applyMove(target.id, null)
        } else if (actionId.startsWith('collection:')) {
          await applyMove(target.id, actionId.slice('collection:'.length))
        }
        return
      }
      if (actionId === 'move') setSheet({ kind: 'move', id: target.id })
      else if (actionId === 'unassign') await applyMove(target.id, null)
      else if (actionId === 'delete') askRemove(target.id)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const filteredOut = !loading && items.length > 0 && visible.length === 0

  return (
    <div className="space-y-4">
      <form onSubmit={(event) => void submit(event)} className="grid gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
        <h2 className="text-sm font-semibold">放进一张照片</h2>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)} className="text-sm" />
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>PNG / JPEG / WebP / GIF，单张不超过 3 MB；照片保存在当前浏览器并进入备份。</p>
        {selected !== null && <img src={selected.dataUrl} alt="待保存预览" className="max-h-56 w-full rounded-lg object-contain" style={{ backgroundColor: 'var(--bg-subtle)' }} />}
        <label htmlFor="photo-title" className="sr-only">照片名称</label>
        <input id="photo-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="照片名称" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
        <label htmlFor="photo-date" className="text-xs" style={{ color: 'var(--text-secondary)' }}>拍摄日期</label>
        <input id="photo-date" type="date" value={takenAt} onChange={(event) => setTakenAt(event.target.value)} className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
        <label htmlFor="photo-caption" className="sr-only">照片说明</label>
        <textarea id="photo-caption" value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={500} rows={2} placeholder="这张照片的故事（可选）" className="resize-none rounded-lg border bg-transparent p-3 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
        <button type="submit" disabled={busy || selected === null || title.trim() === '' || takenAt === ''} className="justify-self-end rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}>{busy ? '保存中…' : '保存照片'}</button>
      </form>

      {error !== null && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}

      <CategoryBar
        noun="相册"
        unit="张"
        categories={collections}
        selection={selection}
        counts={counts}
        createToken={createToken}
        onSelect={setSelection}
        onCreate={async (name) => {
          const created = await createPhotoCollection(name)
          await refresh()
          if (pendingMoveId !== null) {
            await applyMove(pendingMoveId, created.id)
            setPendingMoveId(null)
          }
        }}
        onRename={async (id, name) => {
          await renamePhotoCollection(id, name)
          await refresh()
        }}
        onDelete={removeCollection}
      />

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>正在翻看相册……</p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>相册还是空的。第一张照片会留住一个开始。</p>
      ) : filteredOut ? (
        <p data-testid="photo-filter-empty" className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>这个筛选下还没有照片。</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3">
          {visible.map((item) => (
            <li key={item.id} data-testid={`photo-row-${item.id}`} className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
              <img src={item.imageDataUrl} alt={item.title} className="aspect-square w-full object-cover" loading="lazy" />
              <div className="p-3">
                <h3 className="break-words text-sm font-medium">{item.title}</h3>
                <time className="mt-1 block text-xs" style={{ color: 'var(--text-secondary)' }}>{item.takenAt}</time>
                {item.caption !== null && <p className="mt-2 break-words text-xs">{item.caption}</p>}
                <ContentSourceLink item={item} />
                <div className="mt-3 flex justify-end">
                  {confirmingId === item.id ? (
                    <button
                      type="button"
                      data-testid={`photo-confirm-${item.id}`}
                      onClick={() => void remove(item.id)}
                      className="rounded border px-2 py-0.5 text-xs"
                      style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                    >
                      确认删除？
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid={`photo-menu-${item.id}`}
                      aria-label={`照片操作：${item.title}`}
                      onClick={() => setSheet({ kind: 'item', id: item.id })}
                      className="px-2 text-sm"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      ⋯
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {toast !== null && (
        <p
          data-testid="list-toast"
          className="fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-full px-4 py-2 text-sm"
          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-primary)' }}
        >
          {toast}
        </p>
      )}

      <ActionSheet
        actions={sheetActions}
        title={sheetTitle}
        onSelect={(id) => void runSheetAction(id)}
        onClose={() => setSheet(null)}
      />
    </div>
  )
}
