/**
 * 栖息地 · 「下着雨的玻璃」背景 + 玻璃拟态卡（Tears & Glass，规范 §8.1/§8.2）
 *
 * 来源：D:/我搓/designs/qixi-habitat/textures.jsx（原型 = 唯一参考源）
 *
 * 关键设计意图：雨滴和雨痕是**程序生成**的，不是图片。
 * 好处是零网络请求、任意屏幕尺寸都清晰、改数量只需改常量。
 *
 * ⚠️ 必须用**确定性**伪随机（seededRandom）：直接用 Math.random() 的话，
 * 每次组件重渲染雨点都会重新分布 —— 用户看到的是一场"闪烁跳动的雨"。
 */
import type { CSSProperties, ReactNode } from 'react'

/* 确定性伪随机（线性同余），保证每次渲染完全一致 */
function seededRandom(seed: number) {
  let s = seed >>> 0
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

interface Drop { x: number; y: number; r: number; opacity: number; squish: number; id: number }
interface Streak { x: number; y: number; h: number; opacity: number; id: number }

const RAIN_DROPS: Drop[] = (() => {
  const rand = seededRandom(20260923)
  const drops: Drop[] = []
  for (let i = 0; i < 52; i++) {
    drops.push({
      x: rand() * 100,
      y: rand() * 100,
      r: 1.1 + rand() * 2.6, // 水滴半径（viewBox 百分比单位，渲染时换算）
      opacity: 0.25 + rand() * 0.5,
      squish: 0.72 + rand() * 0.5, // 竖向压扁，模拟贴在玻璃上
      id: i,
    })
  }
  return drops
})()

const RAIN_STREAKS: Streak[] = (() => {
  const rand = seededRandom(1123)
  const streaks: Streak[] = []
  for (let i = 0; i < 14; i++) {
    streaks.push({
      x: rand() * 100,
      y: 8 + rand() * 70,
      h: 6 + rand() * 16,
      opacity: 0.08 + rand() * 0.16,
      id: i,
    })
  }
  return streaks
})()

/**
 * 雨幕。铺满最近的定位祖先（.welcome-root / .sub-layer 这类 `position: absolute` 容器）。
 * 只作装饰 —— `aria-hidden`，读屏器不会念到它。
 */
export function RainBackdrop() {
  return (
    <div className="rain-backdrop" aria-hidden="true">
      <div className="rain-clouds" />
      <svg className="rain-drops" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <radialGradient id="drop-grad" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="rgba(235,242,250,0.5)" />
            <stop offset="45%" stopColor="rgba(220,232,245,0.15)" />
            <stop offset="100%" stopColor="rgba(220,232,245,0.02)" />
          </radialGradient>
        </defs>
        {RAIN_DROPS.map((d) => (
          <ellipse
            key={d.id}
            cx={d.x}
            cy={d.y}
            rx={d.r * 0.62}
            ry={d.r * d.squish}
            fill="url(#drop-grad)"
            opacity={d.opacity}
          />
        ))}
      </svg>
      {RAIN_STREAKS.map((s) => (
        <div
          key={s.id}
          className="rain-streak"
          style={{
            left: s.x + '%',
            top: s.y + '%',
            height: s.h + '%',
            opacity: s.opacity,
          }}
        />
      ))}
    </div>
  )
}

/**
 * 玻璃拟态卡。**只给情绪页用**（欢迎页 / 独处 / 日记封面）——
 * 规范 §2.2 明确「玻璃是例外，不是默认」，满屏玻璃会让文本对比度全线下降。
 */
export function GlassCard({
  className = '',
  style,
  children,
  onClick,
}: {
  className?: string
  style?: CSSProperties
  children?: ReactNode
  onClick?: () => void
}) {
  return (
    <div className={'glass ' + className} style={style} onClick={onClick}>
      {children}
    </div>
  )
}
