/**
 * 应用状态横幅：新版本就绪 / 已可离线使用。
 *
 * 刻意放在**正常文档流**里（AppShell 的 main 之上）而不是 fixed 悬浮 ——
 * 悬浮条会盖住页面内容，还得为它反算 padding；放流里出现时自然把内容推下去，收起时自动还原。
 */
import { useAppUpdate } from './useAppUpdate'

export function UpdatePrompt() {
  const { needRefresh, offlineReady, applyUpdate, dismiss } = useAppUpdate()

  if (!needRefresh && !offlineReady) return null

  return (
    <div
      data-testid="app-update-prompt"
      className="flex items-center justify-between gap-3 border-b px-4 py-2 text-sm"
      style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-subtle)' }}
    >
      <span style={{ color: 'var(--text-primary)' }}>
        {needRefresh ? '有新版本可用' : '已缓存，断网也能打开'}
      </span>

      <div className="flex shrink-0 items-center gap-3">
        {needRefresh ? (
          <button
            type="button"
            data-testid="app-update-apply"
            onClick={applyUpdate}
            className="rounded-full px-3 py-1 text-xs"
            style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}
          >
            刷新
          </button>
        ) : null}
        <button
          type="button"
          data-testid="app-update-dismiss"
          onClick={dismiss}
          className="text-xs underline"
          style={{ color: 'var(--text-secondary)' }}
        >
          {needRefresh ? '稍后' : '知道了'}
        </button>
      </div>
    </div>
  )
}
