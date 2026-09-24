import { Link, useParams } from 'react-router-dom'
import { useSlideIn } from '../../components/qixi/useSlideIn'
import { homeModuleName } from '../../features/home/modules'
import { BoardModule } from '../../features/home/BoardModule'
import { CountdownModule } from '../../features/home/CountdownModule'
import { WishlistModule } from '../../features/home/WishlistModule'
import { DiaryModule } from '../../features/home/DiaryModule'
import { BookmarksModule } from '../../features/home/BookmarksModule'
import { WorksModule } from '../../features/home/WorksModule'
import { AlbumModule } from '../../features/home/AlbumModule'
import { ReadingModule } from '../../features/home/ReadingModule'
import { MusicModule } from '../../features/home/MusicModule'
import { StudyModule } from '../../features/home/StudyModule'

function moduleContent(module: string | undefined, name: string) {
  if (module === 'board') return <BoardModule />
  if (module === 'countdown') return <CountdownModule />
  if (module === 'wishlist') return <WishlistModule />
  if (module === 'diary') return <DiaryModule />
  if (module === 'bookmarks') return <BookmarksModule />
  if (module === 'works') return <WorksModule />
  if (module === 'album') return <AlbumModule />
  if (module === 'reading') return <ReadingModule />
  if (module === 'music') return <MusicModule />
  if (module === 'study') return <StudyModule />
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
  const slide = useSlideIn()

  return (
    // key={module}：换模块时强制重挂，进场动画才会重播
    // （同一个组件实例改 class 不会重放 animation）
    <div key={module} className={`px-4 py-6 ${slide}`}>
      <Link to="/home" className="text-sm" style={{ color: 'var(--color-primary)' }}>
        ‹ 返回首页
      </Link>
      <h1 className="mb-4 mt-2 text-lg font-semibold">{name}</h1>
      {moduleContent(module, name)}
    </div>
  )
}
