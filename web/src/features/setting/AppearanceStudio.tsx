import { useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_APPEARANCE, useAppearance, validateAppearanceCss, type AppearanceValues } from '../../theme/useAppearance'

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return <label className="setting-row"><span className="setting-row-main"><span className="setting-row-title">{label}</span><span className="setting-row-sub">{hint}</span></span>{children}</label>
}

export function AppearanceStudio() {
  const saved = useAppearance((state) => state.saved)
  const save = useAppearance((state) => state.save)
  const setPreview = useAppearance((state) => state.setPreview)
  const clearPreview = useAppearance((state) => state.clearPreview)
  const [draft, setDraft] = useState<AppearanceValues>(saved)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setDraft(saved)
    clearPreview()
  }, [saved, clearPreview])

  useEffect(() => () => clearPreview(), [clearPreview])

  function update<K extends keyof AppearanceValues>(key: K, value: AppearanceValues[K]): void {
    const next = { ...draft, [key]: value }
    setDraft(next)
    setPreview(next)
    setMessage(null)
  }

  function preview(): void {
    const error = validateAppearanceCss(draft.css)
    if (error !== null) {
      setMessage(error)
      return
    }
    setPreview(draft)
    setMessage('预览已应用；点击保存后才会保留')
  }

  function commit(): void {
    const error = validateAppearanceCss(draft.css)
    if (error !== null) {
      setMessage(error)
      return
    }
    save(draft)
    setMessage('外观已保存')
  }

  function reset(): void {
    setDraft(DEFAULT_APPEARANCE)
    save(DEFAULT_APPEARANCE)
    setMessage('已恢复默认外观')
  }

  return (
    <>
      <div className="setting-group-label">外观工作室</div>
      <section className="setting-group" data-testid="appearance-studio" style={{ marginTop: 0 }}>
        <Field label="字体大小" hint="只影响当前 Habitat 界面"><input data-testid="appearance-font-scale" type="range" min="0.9" max="1.2" step="0.05" value={draft.fontScale} onChange={(event) => update('fontScale', Number(event.target.value))} /></Field>
        <Field label="行高" hint="聊天正文与卡片共同使用"><input data-testid="appearance-line-height" type="range" min="1.3" max="2" step="0.05" value={draft.lineHeight} onChange={(event) => update('lineHeight', Number(event.target.value))} /></Field>
        <Field label="聊天气泡宽度" hint={`${draft.chatBubbleWidth}%`}><input data-testid="appearance-bubble-width" type="range" min="60" max="96" step="1" value={draft.chatBubbleWidth} onChange={(event) => update('chatBubbleWidth', Number(event.target.value))} /></Field>
        <Field label="聊天气泡圆角" hint={`${draft.chatBubbleRadius}px`}><input data-testid="appearance-bubble-radius" type="range" min="8" max="28" step="1" value={draft.chatBubbleRadius} onChange={(event) => update('chatBubbleRadius', Number(event.target.value))} /></Field>
        <Field label="主屏卡片间距" hint={`${draft.homeGap}px`}><input data-testid="appearance-home-gap" type="range" min="4" max="20" step="1" value={draft.homeGap} onChange={(event) => update('homeGap', Number(event.target.value))} /></Field>
        <Field label="主屏卡片透明度" hint={`${Math.round(draft.homeOpacity * 100)}%`}><input data-testid="appearance-home-opacity" type="range" min="0.75" max="1" step="0.05" value={draft.homeOpacity} onChange={(event) => update('homeOpacity', Number(event.target.value))} /></Field>
        <label className="block p-4"><span className="setting-row-title">高级 CSS</span><span className="setting-row-sub mt-1 block">支持 [data-page] / [data-chat-part] / [data-home-part]；仅保存本地规则</span><textarea data-testid="appearance-css" className="mt-3 min-h-32 w-full rounded-lg border p-3 font-mono text-xs" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }} value={draft.css} onChange={(event) => update('css', event.target.value)} placeholder={'[data-page="chat"] [data-chat-part="thought-card"] {\n  opacity: 0.9;\n}'} /></label>
        <div className="flex flex-wrap gap-2 p-4 pt-0"><button type="button" data-testid="appearance-preview" className="btn-pill btn-ghost" onClick={preview}>预览</button><button type="button" data-testid="appearance-save" className="btn-pill btn-strong" onClick={commit}>保存外观</button><button type="button" data-testid="appearance-reset" className="btn-pill btn-ghost" onClick={reset}>恢复默认</button></div>
        {message !== null && <p data-testid="appearance-message" className="px-4 pb-4 text-xs" style={{ color: message.includes('失败') || message.includes('不能') || message.includes('不匹配') ? 'var(--danger)' : 'var(--text-secondary)' }}>{message}</p>}
      </section>
    </>
  )
}
