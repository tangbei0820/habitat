import { Link } from 'react-router-dom'
import { greetingByHour } from '../../features/home/welcome'

const MODULES = [
  { key: 'board', name: '留言板', icon: '💌' },
  { key: 'countdown', name: '倒数日', icon: '⏳' },
  { key: 'wishlist', name: '愿望清单', icon: '♡' },
  { key: 'diary', name: '日记', icon: '📔' },
  { key: 'bookmarks', name: '收藏', icon: '🔖' },
  { key: 'works', name: '作品', icon: '🎨' },
  { key: 'album', name: '相册', icon: '🖼' },
  { key: 'reading', name: '读书', icon: '📚' },
  { key: 'music', name: '音乐', icon: '🎵' },
  { key: 'study', name: '学习', icon: '✏️' },
] as const

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

      <ul className="flex flex-col gap-2">
        {MODULES.map((mod) => (
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
