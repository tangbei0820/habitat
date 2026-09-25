/**
 * 独处空间（第 6 批；设计源 `designs/qixi-habitat/screens-solo.jsx`，Tears & Glass）。
 *
 * 三件事都是真的：
 *  - 计时是真的（5 / 10 / 15 分钟，到点自然停）；
 *  - 雨声是真的 —— **程序化生成**（Web Audio 白噪 + 低通 + 轻微起伏），不是一段假「正在播放」；
 *    没有任何音频资产，也没有任何「假装在响」的状态；
 *  - 听的秒数累计进 `listenSessions`（kind='rain'），「生活 → 生活痕迹」的「雨」格子读的就是它。
 *
 * 一句「小栖也在听」都没写 —— 这个页面是**你不生产、也不回应**的地方。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { RainBackdrop } from '../../components/qixi/RainBackdrop'
import { IconChevronLeft, IconPlay, IconTimer } from '../../components/qixi/Icons'
import { addListenSeconds } from '../../db/listen'

const QUOTES = ['不用回复任何人。', '雨声会替你挡一挡。', '就这样，待一会儿。', '慢一点，也算在前进。']
const CHOICES = [5, 10, 15]

/** 程序化雨声：白噪 → 低通 → 缓慢的音量起伏。返回停止函数；同一时刻只需要一个实例 */
function startRainNoise(): () => void {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (Ctx === undefined) return () => undefined
  const ctx = new Ctx()

  // 两秒的白噪 buffer 循环，比持续生成省得多
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1

  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = true

  // 低通切掉刺耳的高频，留下「沙沙」那一段
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 900
  filter.Q.value = 0.6

  const gain = ctx.createGain()
  gain.gain.value = 0.035

  // 缓慢的随机起伏：像雨忽大忽小
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 0.07
  const lfoGain = ctx.createGain()
  lfoGain.gain.value = 0.012
  lfo.connect(lfoGain).connect(gain.gain)

  source.connect(filter).connect(gain).connect(ctx.destination)
  source.start()
  lfo.start()

  return () => {
    try {
      source.stop()
      lfo.stop()
      void ctx.close()
    } catch {
      /* 已停止的上下文再 stop 是无害的 */
    }
  }
}

export function SoloPage() {
  const [minutes, setMinutes] = useState(10)
  const [running, setRunning] = useState(false)
  const [left, setLeft] = useState(minutes * 60)
  const [quoteIdx, setQuoteIdx] = useState(0)
  const stopNoiseRef = useRef<(() => void) | null>(null)
  /** 本轮已计时的秒数；结束 / 离开页面时一次性落盘 */
  const elapsedRef = useRef(0)

  const flush = useCallback((): void => {
    if (elapsedRef.current > 0) {
      void addListenSeconds('rain', elapsedRef.current).catch(() => undefined)
      elapsedRef.current = 0
    }
  }, [])

  /* 倒计时 */
  useEffect(() => {
    if (!running) return undefined
    const timer = window.setInterval(() => {
      elapsedRef.current += 1
      setLeft((s) => {
        if (s <= 1) {
          setRunning(false)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [running])

  /* 到点或手动结束时：停雨声 + 落盘 */
  useEffect(() => {
    if (running || left !== 0) return
    stopNoiseRef.current?.()
    stopNoiseRef.current = null
    flush()
  }, [running, left, flush])

  /* 运行中每 8 秒换一句短句 */
  useEffect(() => {
    if (!running) return undefined
    const timer = window.setInterval(() => setQuoteIdx((i) => (i + 1) % QUOTES.length), 8000)
    return () => window.clearInterval(timer)
  }, [running])

  /* 离开页面：一切归位 */
  useEffect(
    () => () => {
      stopNoiseRef.current?.()
      stopNoiseRef.current = null
      flush()
    },
    [flush],
  )

  const pick = (m: number): void => {
    setMinutes(m)
    if (!running) setLeft(m * 60)
  }

  const toggle = (): void => {
    if (running) {
      setRunning(false)
      setLeft(minutes * 60)
      stopNoiseRef.current?.()
      stopNoiseRef.current = null
      flush()
      return
    }
    setLeft(minutes * 60)
    elapsedRef.current = 0
    setRunning(true)
    if (stopNoiseRef.current === null) stopNoiseRef.current = startRainNoise()
  }

  const mmss = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`

  return (
    <div className="relative flex min-h-full flex-col overflow-y-auto" style={{ background: 'var(--bg-base)' }}>
      <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
        <RainBackdrop />
        <div className="absolute inset-0" style={{ background: 'rgba(10,14,20,0.42)' }} />
      </div>

      <div className="relative z-10 flex min-h-full flex-col" style={{ minHeight: '100vh' }}>
        {/* 低存在感顶栏（玻璃字色，跟欢迎页同一套） */}
        <div className="sub-header" style={{ paddingTop: 18 }}>
          <Link to="/life" aria-label="返回生活" data-testid="solo-back" className="icon-btn" style={{ color: 'var(--wg-text-dim)' }}>
            <IconChevronLeft size={20} />
          </Link>
          <div className="sub-header-main">
            <span className="sub-title" style={{ color: 'var(--wg-text)' }}>独处空间</span>
            <span className="sub-caption" style={{ color: 'var(--wg-text-dim)' }}>不生产什么，只是待着</span>
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center" style={{ padding: '12px 28px 44px' }}>
          {/* 呼吸圆 + 计时 */}
          <div className="flex w-full flex-1 items-center justify-center">
            <div className={`breath-circle${running ? ' breathing' : ''}`} data-testid="solo-circle">
              <div className="relative text-center">
                <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--wg-text)', fontVariantNumeric: 'tabular-nums' }} data-testid="solo-clock">
                  {mmss}
                </div>
                <div style={{ fontSize: 11, letterSpacing: '0.24em', marginTop: 6, color: 'var(--wg-text-dim)' }}>
                  {running ? (left > 0 ? '跟着圆，慢慢呼吸' : '时间到了') : '安静待命'}
                </div>
              </div>
            </div>
          </div>

          {/* 轮换短句（纯文案，不是数据） */}
          <div className="flex items-center justify-center" style={{ minHeight: 44 }}>
            <span
              key={running ? quoteIdx : 'idle'}
              className="t-caption"
              style={{ fontSize: 13.5, letterSpacing: '0.12em', color: 'var(--wg-text-dim)', animation: 'rise-in 600ms var(--ease-out) both' }}
              data-testid="solo-quote"
            >
              {running ? QUOTES[quoteIdx] : '「点开始，雨声就来了」'}
            </span>
          </div>

          {/* 时长选择 */}
          <div className="flex" style={{ gap: 8, marginTop: 18 }}>
            {CHOICES.map((m) => (
              <button
                key={m}
                type="button"
                className="chip pressable"
                style={
                  minutes === m
                    ? { color: 'var(--wg-text)', borderColor: 'rgba(255,255,255,0.5)', background: 'var(--glass-surface)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }
                    : { background: 'var(--glass-surface)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', borderColor: 'var(--glass-border)', color: 'var(--wg-text-dim)' }
                }
                onClick={() => pick(m)}
              >
                {m} 分钟
              </button>
            ))}
          </div>

          {/* 开始 / 提前结束 */}
          <button
            type="button"
            data-testid="solo-toggle"
            className="btn-pill pressable flex items-center justify-center gap-2"
            style={{
              marginTop: 16, minWidth: 190,
              background: running ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.94)',
              color: running ? 'rgba(255,255,255,0.9)' : '#171b21',
              border: running ? '1px solid rgba(255,255,255,0.3)' : 'none',
              backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
            }}
            onClick={toggle}
          >
            {running ? (
              <>
                <IconTimer size={16} /> 提前结束也很好
              </>
            ) : (
              <>
                <IconPlay size={15} filled /> 开始独处
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
