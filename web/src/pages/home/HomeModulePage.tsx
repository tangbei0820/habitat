import { Link, useParams } from 'react-router-dom'
import { homeModuleName } from '../../features/home/modules'

export function HomeModulePage() {
  const { module } = useParams<{ module: string }>()
  const name = homeModuleName(module)

  return (
    <div className="px-4 py-6">
      <Link to="/home" className="text-sm" style={{ color: 'var(--color-primary)' }}>
        ‹ 返回首页
      </Link>
      <h1 className="mb-4 mt-2 text-lg font-semibold">{name}</h1>
      <div
        className="rounded-lg border p-6 text-center text-sm"
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-text-dim)',
        }}
      >
        「{name}」模块占位 —— Phase 2（Home 生活模块）接入
      </div>
    </div>
  )
}
