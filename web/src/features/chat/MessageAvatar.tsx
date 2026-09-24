/**
 * 消息头像（SPEC §9.1.3）。
 *
 * 刻意**不用图片**：现在没有任何地方能配置头像（AI 身份档案见 SPEC §9.4，尚未定义），
 * 引入图片只会多出一套「没有来源的占位资源」。用首字 + 主题色即可，换真头像时只动这一个文件。
 */
import type { MessageRole } from '@shared/types'

/**
 * ⚠️ 头像文字的**唯一定义处** —— 想换称呼只改这两行，别在调用点写死。
 * AI 身份档案落地后，这里改为读配置。
 */
const COMPANION_INITIAL = '栖'
const USER_INITIAL = '北'

/** 只给「人」画头像：`tool` / `system` 消息不是对话的一方，画出来只会让人以为多了个角色 */
export function MessageAvatar({ role }: { role: MessageRole }) {
  if (role !== 'user' && role !== 'assistant') return null
  const isUser = role === 'user'

  return (
    <span
      aria-hidden
      data-testid="message-avatar"
      data-avatar-role={isUser ? 'user' : 'companion'}
      className="mt-0.5 flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-full text-xs"
      style={{
        backgroundColor: isUser ? 'var(--color-primary)' : 'var(--color-surface-alt)',
        color: isUser ? 'var(--color-primary-contrast)' : 'var(--color-text)',
        border: isUser ? 'none' : '1px solid var(--color-border)',
      }}
    >
      {isUser ? USER_INITIAL : COMPANION_INITIAL}
    </span>
  )
}
