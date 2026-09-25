import { Outlet, useLocation } from 'react-router-dom'
import { OfflineBanner } from '../features/offline/OfflineBanner'
import { UpdatePrompt } from '../features/pwa/UpdatePrompt'
import { BottomNav } from './BottomNav'
import { WELCOME_PATH } from './entry'

/**
 * 会话窗口是**沉浸式**的：自持滚动容器（虚拟列表要自己控制 scrollTop），
 * 且不显示底部导航 —— 否则 fixed 的导航栏会直接盖住输入区，
 * 而聊天页要的正是最大化可用高度（§9 风险8）。
 * 独处空间同理（设计稿 screens-solo.jsx 只有返回键）：那里是「不生产、不回应」的地方，
 * 一条五个标签的胶囊底栏会把人拽回任务模式。
 */
const FULLSCREEN_ROUTE = /^\/(chat\/[^/]+|solo)$/

/**
 * 欢迎页也是整屏的（SPEC §9.8.2）：它是「进去之前」的那一屏，
 * 还没有导航可言 —— 显示底栏会让人以为已经进到某个标签页里了。
 */
const isWelcome = (pathname: string): boolean => pathname === WELCOME_PATH

/** AppShell：移动端优先；Safe Area 在底部导航统一处理 */
export function AppShell() {
  const { pathname } = useLocation()
  const isFullscreen = FULLSCREEN_ROUTE.test(pathname) || isWelcome(pathname)

  return (
    // ⚠️ `relative` 是必需的：底栏是**浮起**的绝对定位胶囊（`.bottom-nav`），
    // 没有这个定位祖先，它会相对视口展开、在桌面宽屏上横跨整个屏幕而不是这个 448px 列。
    <div className="relative mx-auto flex h-full max-w-md flex-col">
      {/* 新版本 / 可离线横幅：放文档流里，出现时把内容推下去而不是盖住 */}
      <UpdatePrompt />
      {/* 离线横幅同理；两条都只在「有事」时才占位 */}
      <OfflineBanner />
      <main
        // `overflow-x-clip`：子页面进场是「从右侧滑入」，动画期间会横向溢出。
        // 用 clip 而不是 hidden —— 它不创建滚动容器，不会顺带改掉 fixed/sticky 的行为。
        className={isFullscreen ? 'min-h-0 flex-1' : 'flex-1 overflow-y-auto overflow-x-clip'}
        // 避让 fixed 底栏：高度取自 token，Safe Area 由 env() 附加（不再用魔法数字 pb-16）
        style={
          isFullscreen
            ? undefined
            : { paddingBottom: 'calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px))' }
        }
      >
        <Outlet />
      </main>
      {!isFullscreen && <BottomNav />}
    </div>
  )
}
