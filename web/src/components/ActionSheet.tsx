/**
 * 通用底部动作菜单（SPEC §1.3 / §2.3.3）
 *
 * 消息气泡与会话列表行**共用同一个菜单**，而不是各写一套：
 * SPEC §1.3 明确要求「同一套操作逻辑」，两处各发明一套的下场是
 * 「长按出来的菜单」和「⋯ 出来的菜单」行为渐渐分叉。
 *
 * 为什么做成**底部弹出**而不是贴着触发元素的浮层：
 * 1. 移动端优先 —— 长按 / 点 ⋯ 后从底部滑出是这个形态的惯例，拇指够得着；
 * 2. 触发元素可能贴着屏幕左 / 右边缘，浮层很容易被挤到可视区外；
 * 3. 菜单项会随对象类型与状态增减（AI 消息多「换一个」、撤回态只剩「恢复」、
 *    已置顶会话显示「取消置顶」），统一容器才能保证同一套增删规则。
 *
 * ⚠️ 关闭时**不渲染任何 DOM**（而不是用 CSS 藏起来）：验收脚本会整页读 `innerText`，
 * 藏起来的菜单项若还在 DOM 里，会让「这个按钮到底出现了没有」这类断言失真。
 */
import { useEffect } from 'react'

export interface SheetAction {
  id: string
  label: string
  /** 破坏性操作（删除）用危险色，并排在最后 */
  danger?: boolean
}

export function ActionSheet({
  actions,
  title,
  onSelect,
  onClose,
}: {
  /** null = 关闭；渲染与否则由它决定 */
  actions: SheetAction[] | null
  /** 可选标题，用来指明「这是对哪个对象操作」（会话行 / 分组标题都可能有重名的） */
  title?: string
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
        {title !== undefined && title !== '' && (
          <p
            data-testid="action-sheet-title"
            className="truncate px-4 pt-3 pb-2 text-xs"
            style={{ color: 'var(--color-text-dim)' }}
          >
            {title}
          </p>
        )}
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
