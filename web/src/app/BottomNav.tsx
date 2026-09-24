import { useLayoutEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'
import {
  IconBrain,
  IconChat,
  IconHome,
  IconLife,
  IconSetting,
} from '../components/qixi/Icons'

/**
 * 底部导航（SPEC §9.8.1）：浮起胶囊 + 线框图标，当前项**变实心**。
 *
 * 顺序与名字照设计：对话 / 家 / 大脑 / 生活 / 设置。
 * ⚠️ 「大脑」= `/llm`（小栖能力档案）；换模型**不在这里**，在设置页。
 */
const TABS = [
  { to: '/chat', label: '对话', Icon: IconChat },
  { to: '/home', label: '家', Icon: IconHome },
  { to: '/llm', label: '大脑', Icon: IconBrain },
  { to: '/life', label: '生活', Icon: IconLife },
  { to: '/setting', label: '设置', Icon: IconSetting },
] as const

/**
 * 底部导航。高度通过 ResizeObserver 实测后写回 `--bottom-nav-height`，
 * AppShell 的避让（以及聊天页以外的所有页面）自动跟随 —— 改图标 / 字号不再需要手动同步。
 *
 * ⚠️ 量的是「胶囊高度 + 它离视口底边的距离」：胶囊是**浮起**的，
 * 只算高度会让页面内容被它压住一截。离底距离从计算样式读，
 * 不在 JS 里另写一份 —— 否则 CSS 改了 14px、JS 还按老值算，底部就会多出或少掉一条空白。
 */
export function BottomNav() {
  const navRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const nav = navRef.current
    if (nav === null) return
    const publish = (): void => {
      const gap = Number.parseFloat(window.getComputedStyle(nav).bottom)
      document.documentElement.style.setProperty(
        '--bottom-nav-height',
        `${nav.offsetHeight + (Number.isFinite(gap) ? gap : 0)}px`,
      )
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [])

  return (
    <nav ref={navRef} className="bottom-nav" aria-label="主导航" data-testid="bottom-nav">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}
        >
          {({ isActive }) => (
            <>
              {/* 选中态靠**形状**（线框 → 实心）而不是换色，深浅两套配色都成立 */}
              <tab.Icon size={21} filled={isActive} />
              <span>{tab.label}</span>
              <span className="nav-dot" />
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
