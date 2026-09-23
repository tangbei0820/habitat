import { useLayoutEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'

const TABS = [
  { to: '/chat', label: 'Chat', icon: '💬' },
  { to: '/llm', label: 'LLM', icon: '🌙' },
  { to: '/home', label: 'Home', icon: '🏠' },
  { to: '/life', label: 'Life', icon: '📅' },
  { to: '/setting', label: 'Setting', icon: '⚙️' },
] as const

/**
 * 底部导航。高度通过 ResizeObserver 实测后写回 `--bottom-nav-height`，
 * AppShell 的避让（以及聊天页以外的所有页面）自动跟随 —— 改图标 / 字号不再需要手动同步。
 */
export function BottomNav() {
  const navRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const nav = navRef.current
    if (nav === null) return
    const publish = (): void => {
      document.documentElement.style.setProperty('--bottom-nav-height', `${nav.offsetHeight}px`)
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [])

  return (
    <nav
      ref={navRef}
      className="safe-bottom fixed bottom-0 left-0 right-0 border-t"
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      <div className="mx-auto flex max-w-md">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
                isActive ? 'font-semibold' : ''
              }`
            }
            style={({ isActive }) => ({
              color: isActive ? 'var(--color-primary)' : 'var(--color-text-dim)',
            })}
          >
            <span className="text-lg leading-none">{tab.icon}</span>
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
