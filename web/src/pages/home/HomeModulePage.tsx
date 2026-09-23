import { Link, useParams } from 'react-router-dom'
import { homeModuleName } from '../../features/home/modules'
import { BoardModule } from '../../features/home/BoardModule'
import { CountdownModule } from '../../features/home/CountdownModule'
import { WishlistModule } from '../../features/home/WishlistModule'
import { DiaryModule } from '../../features/home/DiaryModule'
import { BookmarksModule } from '../../features/home/BookmarksModule'
import { WorksModule } from '../../features/home/WorksModule'
import { AlbumModule } from '../../features/home/AlbumModule'

function moduleContent(module: string | undefined, name: string) {
  if (module === 'board') return <BoardModule />
  if (module === 'countdown') return <CountdownModule />
  if (module === 'wishlist') return <WishlistModule />
  if (module === 'diary') return <DiaryModule />
  if (module === 'bookmarks') return <BookmarksModule />
  if (module === 'works') return <WorksModule />
  if (module === 'album') return <AlbumModule />
  return (
    <div
      className="rounded-lg border p-6 text-center text-sm"
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        color: 'var(--color-text-dim)',
      }}
    >
      「{name}」模块将在 Phase 2 后续切片接入
    </div>
  )
}

export function HomeModulePage() {
  const { module } = useParams<{ module: string }>()
  const name = homeModuleName(module)

  return (
    <div className="px-4 py-6">
      <Link to="/home" className="text-sm" style={{ color: 'var(--color-primary)' }}>
        ‹ 返回首页
      </Link>
      <h1 className="mb-4 mt-2 text-lg font-semibold">{name}</h1>
      {moduleContent(module, name)}
    </div>
  )
}
