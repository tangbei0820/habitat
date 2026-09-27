/**
 * 思绪折叠卡（SPEC §2.3.6，Post-v1 Phase 7A）。
 *
 * 公开思绪与供应商 reasoning 共用折叠外观，但两者由调用方分开传入。
 * 公开思绪默认显示；Provider reasoning 只有用户在高级设置中显式打开才会到这里。
 *
 * ⚠️ 纯文本渲染 —— 两种内容都**不解析 Markdown、不渲染 HTML**，只走 `whitespace-pre-wrap`。
 */
import { useState } from 'react'

export function ReasoningCard({ reasoning, variant = 'thought' }: { reasoning: string; variant?: 'thought' | 'provider' }) {
  const [open, setOpen] = useState(false)
  const provider = variant === 'provider'
  return (
    <div className="mb-1.5" data-testid={provider ? 'provider-reasoning-card' : 'reasoning-card'}>
      <button
        type="button"
        data-testid={provider ? 'provider-reasoning-toggle' : 'reasoning-toggle'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="text-xs underline decoration-dotted"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {open ? (provider ? '收起 Provider reasoning' : '收起思绪') : (provider ? '查看 Provider reasoning' : '看它的思绪')}
      </button>
      {open && (
        <div
          data-testid={provider ? 'provider-reasoning-content' : 'reasoning-content'}
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
