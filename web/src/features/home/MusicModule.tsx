import { useEffect, useState, type FormEvent } from 'react'
import type { MusicTrack } from '@shared/types'
import { createMusicTrack, deleteMusicTrack, listMusicTracks, updateMusicTrack } from '../../db/home'

export function MusicModule() {
  const [items, setItems] = useState<MusicTrack[]>([])
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [note, setNote] = useState('')
  const [externalUrl, setExternalUrl] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> { setItems(await listMusicTracks()) }
  useEffect(() => { refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false)) }, [])
  function reset(): void { setTitle(''); setArtist(''); setNote(''); setExternalUrl(''); setEditingId(null) }
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    try {
      if (editingId === null) await createMusicTrack(title, artist, note, externalUrl)
      else await updateMusicTrack(editingId, title, artist, note, externalUrl)
      reset(); setError(null); await refresh()
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }
  function edit(item: MusicTrack): void { setTitle(item.title); setArtist(item.artist ?? ''); setNote(item.note ?? ''); setExternalUrl(item.externalUrl ?? ''); setEditingId(item.id); setError(null); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  async function remove(id: string): Promise<void> {
    if (deletingId !== id) { setDeletingId(id); return }
    try { await deleteMusicTrack(id); if (editingId === id) reset(); setDeletingId(null); await refresh() }
    catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }
  return <div className="space-y-4">
    <form onSubmit={(event) => void submit(event)} className="grid gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{editingId === null ? '收下一首歌' : '编辑音乐记录'}</h2>{editingId !== null && <button type="button" onClick={reset} className="text-xs" style={{ color: 'var(--text-secondary)' }}>取消编辑</button>}</div>
      <label htmlFor="music-title" className="sr-only">歌曲名称</label><input id="music-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="歌曲名称" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
      <label htmlFor="music-artist" className="sr-only">音乐人</label><input id="music-artist" value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={120} placeholder="音乐人（可选）" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
      <label htmlFor="music-note" className="sr-only">听歌备注</label><textarea id="music-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} placeholder="为什么想把它留下（可选）" className="resize-y rounded-lg border bg-transparent p-3 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
      <label htmlFor="music-url" className="sr-only">音乐链接</label><input id="music-url" type="url" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="音乐链接（可选）" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
      <button type="submit" disabled={title.trim() === ''} className="justify-self-end rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}>{editingId === null ? '保存音乐' : '保存修改'}</button>
    </form>
    {error !== null && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
    {loading ? <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>正在整理歌单……</p> : items.length === 0 ? <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>这里还没有音乐。遇到想一起听的歌，就留下来。</p> : <ul className="space-y-3">{items.map((item) => <li key={item.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
      <h3 className="font-medium">{item.title}</h3>{item.artist !== null && <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{item.artist}</p>}{item.note !== null && <p className="mt-3 whitespace-pre-wrap break-words text-sm">{item.note}</p>}{item.externalUrl !== null && <a href={item.externalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block break-all text-xs underline" style={{ color: 'var(--accent-strong)' }}>打开音乐链接</a>}
      <div className="mt-3 flex justify-end gap-3 text-xs"><button type="button" onClick={() => edit(item)} style={{ color: 'var(--accent-strong)' }}>编辑</button><button type="button" onClick={() => void remove(item.id)} onBlur={() => setDeletingId(null)} style={{ color: deletingId === item.id ? 'var(--danger)' : 'var(--text-secondary)' }}>{deletingId === item.id ? '确认删除？' : '删除'}</button></div>
    </li>)}</ul>}
  </div>
}
