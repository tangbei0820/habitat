/**
 * 消息头像（SPEC §9.1.3）。
 *
 * 优先用设置页「身份」区配置的头像图（128px 方形 data URL，localStorage）；
 * 没配置时显示**昵称首字** + 主题色 —— 原先写死的「栖 / 北」已退役，
 * 首字跟着昵称走，改称呼不用再动这个文件。
 */
import type { MessageRole } from '@shared/types'
import { identityName, type IdentityRole, useChatDisplay } from '../../app/useChatDisplay'

/**
 * ⚠️ 头像文字的**唯一定义处**已迁往 `useChatDisplay`（identityName + 默认值）——
 * 这里只负责渲染。想换默认称呼去改那边的 `DEFAULT_*_NAME`。
 */
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
  const identity: IdentityRole = role === 'user' ? 'user' : 'companion'
  const isUser = role === 'user'

  // 都走订阅而不是 getState()：昵称改了首字要跟着变，不能靠别处重渲染碰巧带一下
  const name = useChatDisplay((state) => identityName(state, identity))
  const avatar = useChatDisplay((state) =>
    identity === 'user' ? state.userAvatar : state.companionAvatar,
  )

  const shape = {
    width: size,
    height: size,
    borderRadius: '50%',
  } as const

  if (avatar !== null) {
    return (
      <img
        alt=""
        aria-hidden
        {...(inMessage ? { 'data-testid': 'message-avatar' } : {})}
        data-avatar-role={isUser ? 'user' : 'companion'}
        data-avatar-kind="image"
        className="msg-avatar select-none object-cover"
        src={avatar}
        style={shape}
      />
    )
  }

  return (
    <span
      aria-hidden
      {...(inMessage ? { 'data-testid': 'message-avatar' } : {})}
      data-avatar-role={isUser ? 'user' : 'companion'}
      data-avatar-kind="initial"
      className="msg-avatar select-none"
      style={{
        ...shape,
        fontSize: Math.round(size * 0.44),
        // 小栖那头走 `.msg-avatar` 自带的深色渐变（设计里就是这么画的）；
        // 北北这头用强调色实底，两边一眼能分开
        ...(isUser
          ? { background: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }
          : {}),
      }}
    >
      {[...name][0] ?? '?'}
    </span>
  )
}
