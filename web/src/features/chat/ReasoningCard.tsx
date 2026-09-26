/**
 * 思绪折叠卡（SPEC §2.3.6，Post-v1 Phase 7A）。
 *
 * 上游模型返回的 reasoning 已随消息落库（`metadata.reasoning`，`capReasoning` 截断过）。
 * 这里只做「有才渲染」的折叠展示：默认收起，点开看全文。
 *
 * ⚠️ 纯文本渲染 —— reasoning 是供应商原始产物，**不解析 Markdown、不渲染 HTML**，
 * 只走 `whitespace-pre-wrap`。它不是回复内容本身，是过程痕迹。
 */
import { useState } from 'react'

export function ReasoningCard({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-1.5" data-testid="reasoning-card">
      <button
        type="button"
        data-testid="reasoning-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="text-xs underline decoration-dotted"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {open ? '收起思绪' : '看它的思绪'}
      </button>
      {open && (
        <div
          data-testid="reasoning-content"
          className="mt-1 whitespace-pre-wrap break-words rounded-lg border px-2 py-1.5 text-xs"
          style={{
            borderColor: 'var(--border-soft)',
            backgroundColor: 'var(--bg-subtle)',
            color: 'var(--text-secondary)',
          }}
        >
          {reasoning}
        </div>
      )}
    </div>
  )
}
