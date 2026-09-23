/**
 * 消息操作菜单（SPEC §1.3 / §2.3.3）
 *
 * 为什么做成**底部弹出**而不是气泡旁的浮层：
 * 1. 移动端优先 —— 长按后从底部滑出是这个形态的惯例，拇指够得着；
 * 2. 气泡贴着屏幕左 / 右边缘，浮层很容易被挤到可视区外；
 * 3. 菜单项会随对象类型与状态增减（AI 消息多「换一个」、撤回态只剩「恢复」），
 *    统一容器才能保证「同一套操作逻辑」，而不是每个模块各发明一套（SPEC §1.3 明确反对）。
 *
 * ⚠️ 关闭时**不渲染任何 DOM**（而不是用 CSS 藏起来）：验收脚本会整页读 `innerText`，
 * 藏起来的菜单项若还在 DOM 里，会让「这个按钮到底出现了没有」这类断言失真。
 */
import { useEffect } from 'react'

export interface MessageAction {
  id: string
  label: string
  /** 破坏性操作（删除）用危险色，并排在最后 */
  danger?: boolean
}

export function MessageActionSheet({
  actions,
  onSelect,
  onClose,
}: {
  /** null = 关闭；渲染与否则由它决定 */
  actions: MessageAction[] | null
  onSelect: (id: string) => void
  onClose: () => void
}) {
  // Esc 关闭：键盘用户不该只能靠点空白退出
  useEffect(() => {
    if (actions === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actions, onClose])

  if (actions === null) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      {/* 遮罩：点空白关闭。用 <button> 而不是 <div>，键盘也能关 */}
      <button
        type="button"
        aria-label="关闭菜单"
        data-testid="action-sheet-backdrop"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.35)' }}
      />
      <div
        data-testid="action-sheet"
        className="safe-bottom relative mx-2 mb-2 overflow-hidden rounded-2xl"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
        }}
      >
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            data-testid={`action-${action.id}`}
            onClick={() => onSelect(action.id)}
            className="block w-full px-4 py-3 text-left text-sm"
            style={{
              borderBottom: '1px solid var(--color-border)',
              color: action.danger === true ? 'var(--color-danger)' : 'var(--color-text)',
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}
