/**
 * 一起听（V2-D 第一切片：真播放 + 共享会话）。
 *
 * 播放器是**真的**：`<audio>` 直接播 `externalUrl`，进度 / 时长 / 上一首下一首都是真实控件；
 * 听的秒数会累计进 `listenSessions`（播放中每 15 秒落一次盘，暂停 / 切歌 / 离开页面也落），
 * 「生活 → 生活痕迹」的「一起听」格子读的就是它。
 *
 * 边界（诚实原则）：
 *  - 「小栖也在听」这句**不搬** —— 没有任何机制让小栖真的在听，写上就是假装；
 *  - 没填链接的曲目不能播（按钮禁用 + 明说原因），不装会在转的假进度条；
 *  - 下方的「收下一首歌」表单与歌单列表继续复用本地 MusicTrack；网易云搜索 / 歌词 / AI 选歌留给后续 MCP 切片。
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { ListeningSessionView, MusicTrack } from '@shared/types'
import { IconNote, IconPause, IconPlay, IconSkipBack, IconSkipForward } from '../../components/qixi/Icons'
import { createMusicTrack, deleteMusicTrack, listMusicTracks, updateMusicTrack } from '../../db/home'
import { addListenSeconds } from '../../db/listen'
import { getListeningSession, updateListeningSession } from '../../lib/listening'

function mm(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

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

  /* ---- 播放器状态 ---- */
  const [currentIndex, setCurrentIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [duration, setDuration] = useState(0)
  const [sharedSession, setSharedSession] = useState<ListeningSessionView | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  /** 还没落盘的收听秒数；攒够 15 秒（或暂停 / 切歌 / 卸载）就写进 listenSessions */
  const pendingRef = useRef(0)
  const playingRef = useRef(false)
  const sharedUpdatedAtRef = useRef(0)
  const lastSharedSyncRef = useRef(0)

  const flushListen = useCallback((): void => {
    if (pendingRef.current > 0) {
      void addListenSeconds('music', pendingRef.current).catch(() => undefined)
      pendingRef.current = 0
    }
  }, [])

  async function refresh(): Promise<void> { setItems(await listMusicTracks()) }
  useEffect(() => { refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false)) }, [])

  useEffect(() => {
    let alive = true
    const pull = async (): Promise<void> => {
      try {
        const next = await getListeningSession()
        if (!alive || next.updatedAt <= sharedUpdatedAtRef.current) return
        sharedUpdatedAtRef.current = next.updatedAt
        setSharedSession(next)
      } catch (err: unknown) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    }
    void pull()
    const timer = window.setInterval(() => void pull(), 5000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    const session = sharedSession
    if (session === null || session.track === null) return
    const track = session.track
    const index = items.findIndex((item) => item.id === track.id)
    if (index >= 0) {
      setCurrentIndex(index)
      setPos(session.positionSeconds)
    }
  }, [items, sharedSession?.positionSeconds, sharedSession?.track?.id, sharedSession?.updatedAt])

  /* 播放中每秒记一笔，攒够 15 秒落一次盘 */
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!playingRef.current) return
      pendingRef.current += 1
      if (pendingRef.current >= 15) flushListen()
    }, 1000)
    return () => { window.clearInterval(timer) }
  }, [flushListen])

  /* 离开页面也要把尾巴落盘 */
  useEffect(() => () => flushListen(), [flushListen])

  const current = items[currentIndex] ?? null

  function snapshot(item: MusicTrack | null): Pick<MusicTrack, 'id' | 'title' | 'artist' | 'externalUrl'> | null {
    if (item === null) return null
    return { id: item.id, title: item.title, artist: item.artist, externalUrl: item.externalUrl }
  }

  function syncShared(state: ListeningSessionView['state'], positionSeconds = pos, item = current): void {
    if (item === null) return
    lastSharedSyncRef.current = Date.now()
    void updateListeningSession({ track: snapshot(item), state, positionSeconds })
      .then((next) => { sharedUpdatedAtRef.current = next.updatedAt; setSharedSession(next) })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  const step = useCallback((offset: number): void => {
    if (items.length === 0) return
    flushListen()
    const nextIndex = (currentIndex + offset + items.length) % items.length
    const next = items[nextIndex] ?? null
    setCurrentIndex(nextIndex)
    setPos(0)
    setDuration(0)
    if (next !== null) syncShared('paused', 0, next)
  }, [currentIndex, items, flushListen])

  function togglePlay(): void {
    const audio = audioRef.current
    if (audio === null || current === null) return
    if (current.externalUrl === null || current.externalUrl === '') {
      setError('这一条还没有可播的链接 —— 编辑它补上一个能直接出声的地址。')
      return
    }
    if (audio.paused) {
      audio.play().catch((err: unknown) => {
        setError(`这条链接播不出来（${err instanceof Error ? err.message : String(err)}）。检查一下链接是不是直连音频文件。`)
      })
    } else {
      audio.pause()
    }
  }

  /* 切歌后自动接着播（上一首/下一首不打断听歌的手） */
  useEffect(() => {
    const audio = audioRef.current
    if (audio === null || current === null) return
    if (playing && current.externalUrl) {
      audio.play().catch(() => setPlaying(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex])

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
    try {
      await deleteMusicTrack(id)
      if (editingId === id) reset()
      setDeletingId(null)
      await refresh()
      setCurrentIndex(0)
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }

  return <div className="space-y-4">
    {/* ---------- 播放器（真播放） ---------- */}
    {items.length > 0 && (
      <section
        data-testid="music-player"
        className="rounded-lg border p-5"
        style={{
          borderColor: 'var(--border-soft)',
          background:
            'radial-gradient(90% 55% at 50% 12%, rgba(96,112,132,0.16), transparent 70%), var(--bg-surface-solid)',
        }}
      >
        <div className="flex flex-col items-center">
          {/* 大封面（程序化雨痕，确定性布局，不闪） */}
          <div
            className="relative flex items-center justify-center overflow-hidden"
            style={{
              width: 210, height: 210, borderRadius: 28, flex: 'none',
              background: 'linear-gradient(160deg, #6b7a8e 0%, #3d4856 45%, #232b36 100%)',
              boxShadow: '0 24px 54px rgba(0,0,0,0.28), inset 0 2px 3px rgba(255,255,255,0.2)',
            }}
          >
            <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.5 }}>
              {Array.from({ length: 9 }).map((_, i) => (
                <line
                  key={i}
                  x1={24 + i * 22} y1={18 + (i % 4) * 12}
                  x2={17 + i * 22} y2={72 + (i % 4) * 15}
                  stroke="rgba(255,255,255,0.25)" strokeWidth="1.4" strokeLinecap="round"
                />
              ))}
            </svg>
            <IconNote size={56} style={{ color: 'rgba(255,255,255,0.9)', position: 'relative' }} />
          </div>

          {/* 曲目信息 */}
          <div className="mt-6 text-center">
            <div className="t-h1" style={{ fontSize: 20 }}>{current?.title ?? ''}</div>
            <div className="t-body" style={{ color: 'var(--text-secondary)', marginTop: 6, fontSize: 13 }}>
              {current?.artist !== null && current?.artist !== undefined && current.artist !== ''
                ? current.artist
                : current?.externalUrl ? '本地播放 · 戴耳机更好听' : '还没填可播的链接'}
            </div>
          </div>

          {/* 进度（真实 currentTime / duration） */}
          <div className="w-full" style={{ marginTop: 26 }}>
            <div style={{ height: 3, borderRadius: 2, background: 'var(--bg-subtle)', overflow: 'hidden' }}>
              <div
                data-testid="music-progress"
                style={{
                  width: `${duration > 0 ? Math.min(100, (pos / duration) * 100) : 0}%`,
                  height: '100%', background: 'var(--accent-strong)', borderRadius: 2,
                  transition: 'width 1s linear',
                }}
              />
            </div>
            <div className="flex justify-between" style={{ marginTop: 8 }}>
              <span className="t-micro" data-testid="music-pos" style={{ color: 'var(--text-tertiary)' }}>{mm(pos)}</span>
              <span className="t-micro" data-testid="music-dur" style={{ color: 'var(--text-tertiary)' }}>{duration > 0 ? mm(duration) : '--:--'}</span>
            </div>
          </div>

          {/* 控制（黑白高对比） */}
          <div className="flex items-center" style={{ gap: 30, marginTop: 20 }}>
            <button type="button" data-testid="music-prev" aria-label="上一首" className="icon-btn pressable" style={{ color: 'var(--text-secondary)' }} onClick={() => step(-1)}>
              <IconSkipBack size={24} />
            </button>
            <button
              type="button"
              data-testid="music-play"
              aria-label={playing ? '暂停' : '播放'}
              className="pressable flex items-center justify-center"
              style={{
                width: 64, height: 64, borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: 'var(--accent-strong)', color: 'var(--accent-on-strong)',
                boxShadow: '0 12px 28px rgba(0,0,0,0.2)',
              }}
              onClick={togglePlay}
            >
              {playing ? <IconPause size={26} filled /> : <IconPlay size={26} filled />}
            </button>
            <button type="button" data-testid="music-next" aria-label="下一首" className="icon-btn pressable" style={{ color: 'var(--text-secondary)' }} onClick={() => step(1)}>
              <IconSkipForward size={24} />
            </button>
          </div>

          <div className="t-caption" style={{ color: 'var(--text-tertiary)', marginTop: 18 }}>
            听着的时候，这里会替你把时长记进「生活痕迹」。
          </div>
          {/* 真正出声的元素；preload=none 别偷流量 */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            ref={audioRef}
            src={current?.externalUrl ?? undefined}
            preload="none"
            onPlay={() => { playingRef.current = true; setPlaying(true); syncShared('playing', audioRef.current?.currentTime ?? pos) }}
            onPause={() => { playingRef.current = false; setPlaying(false); flushListen(); syncShared('paused', audioRef.current?.currentTime ?? pos) }}
            onEnded={() => { playingRef.current = false; setPlaying(false); flushListen(); step(1) }}
            onTimeUpdate={(e) => {
              const position = e.currentTarget.currentTime
              setPos(position)
              if (playingRef.current && Date.now() - lastSharedSyncRef.current >= 5000) syncShared('playing', position)
            }}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          />
        </div>
      </section>
    )}

    {error !== null && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}

    <section className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }} data-testid="music-shared-session">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">共同听 · 当前会话</h2>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>播放状态由服务端同步；浏览器负责真正出声。</p>
        </div>
        <span className="rounded-full px-2 py-1 text-xs" style={{ background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}>{sharedSession?.listeners.companion === true ? '小栖在场' : '小栖未加入'}</span>
      </div>
      {sharedSession?.track === null || sharedSession === null ? (
        <p className="mt-3 text-sm" style={{ color: 'var(--text-tertiary)' }}>还没有共同曲目。把一首可播放的歌放进歌单后，点击播放就会同步到这里。</p>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate">{sharedSession.track.title}{sharedSession.track.artist ? ` · ${sharedSession.track.artist}` : ''}</span>
          <span className="shrink-0 text-xs" style={{ color: 'var(--text-secondary)' }}>{sharedSession.state === 'playing' ? '播放中' : '已暂停'} · {mm(sharedSession.positionSeconds)}</span>
        </div>
      )}
    </section>

    {/* ---------- 收歌单（Phase 2 原能力，字段与文案一个没动：验收依赖） ---------- */}
    <form onSubmit={(event) => void submit(event)} className="grid gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{editingId === null ? '收下一首歌' : '编辑音乐记录'}</h2>{editingId !== null && <button type="button" onClick={reset} className="text-xs" style={{ color: 'var(--text-secondary)' }}>取消编辑</button>}</div>
      <label htmlFor="music-title" className="sr-only">歌曲名称</label><input id="music-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="歌曲名称" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
      <label htmlFor="music-artist" className="sr-only">音乐人</label><input id="music-artist" value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={120} placeholder="音乐人（可选）" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
      <label htmlFor="music-note" className="sr-only">听歌备注</label><textarea id="music-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} placeholder="为什么想把它留下（可选）" className="resize-y rounded-lg border bg-transparent p-3 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
      <label htmlFor="music-url" className="sr-only">音乐链接</label><input id="music-url" type="url" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="音乐链接（可选，直连音频文件才能在这里播）" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
      <button type="submit" disabled={title.trim() === ''} className="justify-self-end rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}>{editingId === null ? '保存音乐' : '保存修改'}</button>
    </form>
    {loading ? <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>正在整理歌单……</p> : items.length === 0 ? <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>这里还没有音乐。遇到想一起听的歌，就留下来。</p> : <ul className="space-y-3">{items.map((item, index) => <li key={item.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium">{item.title}</h3>
          {item.artist !== null && <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{item.artist}</p>}
        </div>
        {item.externalUrl !== null && item.externalUrl !== '' && (
          <button
            type="button"
            data-testid={`music-row-play-${item.id}`}
            className="btn-pill flex-none"
            style={{ minHeight: 34, padding: '0 14px', fontSize: 12 }}
            onClick={() => { flushListen(); setCurrentIndex(index); setPos(0); setDuration(0); syncShared('paused', 0, item) }}
          >
            {index === currentIndex ? '正在播' : '放到播放器'}
          </button>
        )}
      </div>
      {item.note !== null && <p className="mt-3 whitespace-pre-wrap break-words text-sm">{item.note}</p>}
      {item.externalUrl !== null && <a href={item.externalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block break-all text-xs underline" style={{ color: 'var(--accent-strong)' }}>打开音乐链接</a>}
      <div className="mt-3 flex justify-end gap-3 text-xs"><button type="button" onClick={() => edit(item)} style={{ color: 'var(--accent-strong)' }}>编辑</button><button type="button" onClick={() => void remove(item.id)} onBlur={() => setDeletingId(null)} style={{ color: deletingId === item.id ? 'var(--danger)' : 'var(--text-secondary)' }}>{deletingId === item.id ? '确认删除？' : '删除'}</button></div>
    </li>)}</ul>}
  </div>
}
