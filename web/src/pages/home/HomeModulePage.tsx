import { Link, useParams } from 'react-router-dom'
import { useSlideIn } from '../../components/qixi/useSlideIn'
import { IconChevronLeft } from '../../components/qixi/Icons'
import { homeModuleName } from '../../features/home/modules'
import { BoardModule } from '../../features/home/BoardModule'
import { FeedModule } from '../../features/home/FeedModule'
import { CountdownModule } from '../../features/home/CountdownModule'
import { WishlistModule } from '../../features/home/WishlistModule'
import { DiaryModule } from '../../features/home/DiaryModule'
import { BookmarksModule } from '../../features/home/BookmarksModule'
import { WorksModule } from '../../features/home/WorksModule'
import { AlbumModule } from '../../features/home/AlbumModule'
import { ReadingModule } from '../../features/home/ReadingModule'
import { DailyReadingModule } from '../../features/home/DailyReadingModule'
import { MusicModule } from '../../features/home/MusicModule'
import { StudyModule } from '../../features/home/StudyModule'

function moduleContent(module: string | undefined, name: string) {
  if (module === 'board') return <BoardModule />
  if (module === 'feed') return <FeedModule />
  if (module === 'countdown') return <CountdownModule />
  if (module === 'wishlist') return <WishlistModule />
  if (module === 'diary') return <DiaryModule />
  if (module === 'bookmarks') return <BookmarksModule />
  if (module === 'works') return <WorksModule />
  if (module === 'album') return <AlbumModule />
  if (module === 'reading') return <ReadingModule />
  if (module === 'daily-reading') return <DailyReadingModule />
  if (module === 'music') return <MusicModule />
  if (module === 'study') return <StudyModule />
  return (
    <div
      className="rounded-lg border p-6 text-center text-sm"
      style={{
        borderColor: 'var(--border-soft)',
        backgroundColor: 'var(--bg-surface-solid)',
        color: 'var(--text-secondary)',
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
    <div key={module} className={slide} data-page="home-module">
      {/* 顶栏与对话页同一套低存在感帽子：返回是图标按钮，不占一行文字 */}
      <div className="topbar">
        <Link
          to="/home"
          aria-label="返回首页"
          data-testid="module-back"
          className="icon-btn"
          style={{ flex: 'none' }}
        >
          <IconChevronLeft size={20} />
        </Link>
        <h1 className="topbar-title">{name}</h1>
      </div>
      <div className="px-5 pb-6 pt-2">{moduleContent(module, name)}</div>
    </div>
  )
}
