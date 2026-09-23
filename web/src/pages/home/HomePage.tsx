import { Link } from 'react-router-dom'
import { greetingByHour } from '../../features/home/welcome'
import { HOME_MODULES } from '../../features/home/modules'
import { HomeWidgets } from '../../features/home/HomeWidgets'

export function HomePage() {
  const greeting = greetingByHour(new Date().getHours())

  return (
    <div className="px-4 py-6">
      <header className="mb-6 text-center">
        <div className="mb-2 text-4xl">🌿</div>
        <h1 className="text-xl font-semibold">栖息地</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-dim)' }}>
          {greeting}
        </p>
      </header>

      {/* 主屏 Widget 区：问候语之下、功能入口之上（SPEC §1.4）；一张都没有时它自己什么都不渲染 */}
      <HomeWidgets />

      <ul className="flex flex-col gap-2" data-testid="home-entries">
        {HOME_MODULES.map((mod) => (
          <li key={mod.key}>
            <Link
              to={`/home/${mod.key}`}
              className="flex items-center gap-3 rounded-lg border px-4 py-3"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-surface)',
              }}
            >
              <span>{mod.icon}</span>
              <span className="flex-1">{mod.name}</span>
              <span style={{ color: 'var(--color-text-dim)' }}>›</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
