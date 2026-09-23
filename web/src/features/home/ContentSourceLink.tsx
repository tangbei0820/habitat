import { Link } from 'react-router-dom'
import type { BaseObject } from '@shared/types'

function roleLabel(metadata: Record<string, unknown> | undefined): string | null {
  const role = metadata?.sourceRole
  if (role === 'user') return '你'
  if (role === 'assistant') return '小栖'
  if (role === 'system') return '系统'
  if (role === 'tool') return '工具'
  return null
}

/** 收藏 / 作品 / 相册共用的来源展示；只读统一基座，不另造一套来源字段。 */
export function ContentSourceLink({ item }: { item: BaseObject }) {
  if (item.sessionId === undefined || item.sourceId === undefined) return null
  const actor = roleLabel(item.metadata)
  const sourceAt = item.metadata?.sourceCreatedAt
  const timestamp = typeof sourceAt === 'number'
    ? new Date(sourceAt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null
  const href = `/chat/${encodeURIComponent(item.sessionId)}?message=${encodeURIComponent(item.sourceId)}`
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: 'var(--color-text-dim)' }}>
      <span>来源：聊天{actor === null ? '' : ` · ${actor}`}{timestamp === null ? '' : ` · ${timestamp}`}</span>
      <Link to={href} className="underline underline-offset-2" style={{ color: 'var(--color-primary)' }}>
        查看来源
      </Link>
    </div>
  )
}
