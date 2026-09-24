import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { markEntered } from '../../app/entry'
import { IconChevronRight, IconDrop } from '../../components/qixi/Icons'
import { RainBackdrop } from '../../components/qixi/RainBackdrop'
import { listMessagesPage, listSessions, messageText } from '../../db/chat'
import { formatRelativeTime } from '../../lib/format'
import { log } from '../../lib/log'

/**
 * 欢迎页（SPEC §9.8.2）—— 打开栖息地先看到的那一屏。
 *
 * 三件事：雨幕背景、现在几点、小栖最后说了什么。
 *
 * ⚠️ 叠卡展示的是**真实**的最近一条小栖消息：
 * 设计原型里写的是「2 条未读 / 雨下了一整天…」，那是占位。栖息地没有「未读」这个概念，
 * 硬造一个数字就是在骗人（SPEC §6.3）—— 没有消息就显示空态引导。
 */

interface Peek {
  text: string
  at: number
}

/** 简短问候。注意与 Home 页的长句问候（`greetingByHour`）不是一套语料 */
function shortGreeting(hour: number): string {
  if (hour < 5) return '夜深了'
  if (hour < 9) return '早上好'
  if (hour < 12) return '上午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

const WEEKDAYS = '日一二三四五六'

/** 交错入场用：`--i` 控制每一项的延迟（见 components.css 的 `.rise`） */
function rise(index: number): CSSProperties {
  return { '--i': index } as CSSProperties
}

export function WelcomePage() {
  const navigate = useNavigate()
  const [now, setNow] = useState(() => new Date())
  const [peek, setPeek] = useState<Peek | null>(null)
  const [peekLoaded, setPeekLoaded] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 20_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const sessions = await listSessions()
        const latest = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0]
        if (latest !== undefined) {
          // 只读**尾部一页**：长会话有几千条，欢迎页不该把它整个捞出来（§9 风险8）
          const tail = await listMessagesPage(latest.id, 20)
          const last = [...tail]
            .reverse()
            .find((m) => m.role === 'assistant' && messageText(m).trim() !== '')
          if (!cancelled && last !== undefined) {
            setPeek({ text: messageText(last), at: last.createdAt })
          }
        }
      } catch (err) {
        // 读不到就显示空态，不挡住「进入栖息地」这个主路径
        log.warn('欢迎页读取最近消息失败', err)
      } finally {
        if (!cancelled) setPeekLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const hour = now.getHours()
  const minute = String(now.getMinutes()).padStart(2, '0')
  const dateLine = `${now.getMonth() + 1}月${now.getDate()}日 · 周${WEEKDAYS[now.getDay()]}`

  const enter = (): void => {
    markEntered()
    // replace：历史里不留欢迎页，进来之后按返回不会又被弹回去
    navigate('/chat', { replace: true })
  }

  return (
    <div className="welcome-root" data-testid="welcome">
      <RainBackdrop />

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '58px 26px 34px',
        }}
      >
        <div>
          <div className="rise" style={{ ...rise(0), display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <span
              style={{
                fontSize: 46,
                fontWeight: 700,
                letterSpacing: '0.02em',
                lineHeight: 1.05,
                color: 'var(--wg-text)',
                textShadow: '0 2px 18px rgba(0,0,0,0.14)',
              }}
            >
              {hour}
              <span style={{ opacity: 0.55, fontWeight: 500 }}>:</span>
              {minute}
            </span>
          </div>
          <div className="rise" style={{ ...rise(1), marginTop: 12 }}>
            <span
              style={{
                fontSize: 13,
                letterSpacing: '0.14em',
                color: 'var(--wg-text-dim)',
                textShadow: '0 1px 10px rgba(0,0,0,0.1)',
              }}
            >
              {dateLine} · {shortGreeting(hour)}
            </span>
          </div>
        </div>

        <div className="rise" style={{ ...rise(2), position: 'absolute', right: 26, top: 148 }}>
          <span className="vertical-note">慢慢来的，都是礼物</span>
        </div>

        {/* 小栖的最后一句：叠卡（§7.2 允许错位 / overlap / blur depth） */}
        <div className="deck rise" style={{ ...rise(3), marginTop: 'auto', marginBottom: 26, height: 176 }}>
          <div className="deck-card back-2 glass" />
          <div className="deck-card back-1 glass" />
          <div
            className="glass pressable"
            role="button"
            tabIndex={0}
            data-testid="welcome-peek"
            onClick={enter}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                enter()
              }
            }}
            style={{
              position: 'relative',
              height: '100%',
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="dot pulse" />
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--wg-text)' }}>小栖</span>
              <span style={{ fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--wg-text-dim)' }}>
                {peek === null ? '' : formatRelativeTime(peek.at, now.getTime())}
              </span>
              <span style={{ flex: 1 }} />
              <IconChevronRight size={16} style={{ color: 'var(--wg-text-dim)' }} />
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 14.5,
                lineHeight: 1.8,
                color: 'var(--wg-text)',
                textWrap: 'pretty',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {peek !== null ? peek.text : peekLoaded ? '还没有聊过天 —— 进去说第一句话吧。' : '…'}
            </p>
            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconDrop size={13} style={{ color: 'var(--wg-text-dim)' }} />
              <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--wg-text-dim)' }}>
                {peek !== null ? '来自对话' : '栖息地'}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div className="rise welcome-symbol" style={rise(4)}>
            ˚ ༘♡ ⋆｡˚
          </div>
          <button
            type="button"
            className="btn-pill btn-strong rise"
            data-testid="welcome-enter"
            onClick={enter}
            style={{ ...rise(5), minWidth: 216, boxShadow: '0 14px 40px rgba(0,0,0,0.28)' }}
          >
            进入栖息地
            <IconChevronRight size={16} />
          </button>
          <span
            className="rise"
            style={{ ...rise(6), fontSize: 11, letterSpacing: '0.18em', color: 'var(--wg-text-faint)' }}
          >
            今天也谢谢你回来
          </span>
        </div>
      </div>
    </div>
  )
}
