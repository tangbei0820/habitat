import { Outlet, useLocation } from 'react-router-dom'
import { UpdatePrompt } from '../features/pwa/UpdatePrompt'
import { BottomNav } from './BottomNav'

/**
 * 会话窗口是**沉浸式**的：自持滚动容器（虚拟列表要自己控制 scrollTop），
 * 且不显示底部导航 —— 否则 fixed 的导航栏会直接盖住输入区，
 * 而聊天页要的正是最大化可用高度（§9 风险8）。返回入口在会话页 header 里。
 */
const FULLSCREEN_ROUTE = /^\/chat\/[^/]+$/

/** AppShell：移动端优先；Safe Area 在底部导航统一处理 */
export function AppShell() {
  const { pathname } = useLocation()
  const isFullscreen = FULLSCREEN_ROUTE.test(pathname)

  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      {/* 新版本 / 可离线横幅：放文档流里，出现时把内容推下去而不是盖住 */}
      <UpdatePrompt />
      <main
        className={isFullscreen ? 'min-h-0 flex-1' : 'flex-1 overflow-y-auto'}
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
