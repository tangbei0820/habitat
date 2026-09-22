import { NavLink } from 'react-router-dom'

const TABS = [
  { to: '/chat', label: 'Chat', icon: '💬' },
  { to: '/llm', label: 'LLM', icon: '🌙' },
  { to: '/home', label: 'Home', icon: '🏠' },
  { to: '/life', label: 'Life', icon: '📅' },
  { to: '/setting', label: 'Setting', icon: '⚙️' },
] as const

export function BottomNav() {
  return (
    <nav
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
