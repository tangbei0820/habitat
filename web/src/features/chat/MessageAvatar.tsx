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

export function MessageAvatar({
  role,
  size = 32,
  inMessage = true,
}: {
  role: MessageRole
  /** 边长（px）。气泡里 32、会话顶栏 36 */
  size?: number
  /**
   * 是否属于「某条消息的头像」。
   *
   * ⚠️ 这不是装饰性开关，它决定要不要挂 `data-testid="message-avatar"` ——
   * 那个 id 的语义是「这条消息的头像」，验收靠它**数个数**（关掉头像开关后必须为 0）
   * 以及判断「头像在气泡外侧」。会话顶栏也有一个同款头像，但它是页面的门面、
   * 不受「显示头像」开关管辖 —— 让它也挂那个 id，会直接把上面两条断言搞坏。
   */
  inMessage?: boolean
}) {
  // 只给「人」画头像：`tool` / `system` 消息不是对话的一方，画出来只会让人以为多了个角色
  if (role !== 'user' && role !== 'assistant') return null
  const isUser = role === 'user'

  return (
    <span
      aria-hidden
      {...(inMessage ? { 'data-testid': 'message-avatar' } : {})}
      data-avatar-role={isUser ? 'user' : 'companion'}
      className="msg-avatar select-none"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.44),
        // 小栖那头走 `.msg-avatar` 自带的深色渐变（设计里就是这么画的）；
        // 北北这头用强调色实底，两边一眼能分开
        ...(isUser
          ? { background: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }
          : {}),
      }}
    >
      {isUser ? USER_INITIAL : COMPANION_INITIAL}
    </span>
  )
}
