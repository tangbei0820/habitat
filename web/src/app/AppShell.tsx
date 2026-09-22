import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'

/** AppShell：移动端优先；Safe Area 在底部导航统一处理 */
export function AppShell() {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <main className="flex-1 overflow-y-auto pb-16">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
