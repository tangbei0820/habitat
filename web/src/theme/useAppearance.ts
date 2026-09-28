import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AppearanceValues {
  fontScale: number
  lineHeight: number
  chatBubbleWidth: number
  chatBubbleRadius: number
  homeGap: number
  homeOpacity: number
  css: string
}

export const DEFAULT_APPEARANCE: AppearanceValues = {
  fontScale: 1,
  lineHeight: 1.6,
  chatBubbleWidth: 82,
  chatBubbleRadius: 16,
  homeGap: 8,
  homeOpacity: 1,
  css: '',
}

interface AppearanceState {
  saved: AppearanceValues
  preview: AppearanceValues | null
  save: (values: AppearanceValues) => void
  setPreview: (values: AppearanceValues) => void
  clearPreview: () => void
  reset: () => void
}

/**
 * 高级 CSS 只允许主题根内的普通规则：不允许远程资源、脚本、import 或 at-rule。
 * 这不是完整 CSS parser，但把最危险的跨站 / 远程加载入口挡在保存前。
 */
export function validateAppearanceCss(css: string): string | null {
  if (css.length > 20_000) return '自定义 CSS 不能超过 20,000 个字符'
  if (/@import|url\s*\(|expression\s*\(|javascript\s*:|<|>|^\s*@/im.test(css)) return 'CSS 只允许本地样式规则，不能包含远程资源或脚本'
  let depth = 0
  for (const char of css) {
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth < 0) return 'CSS 大括号不匹配'
  }
  return depth === 0 ? null : 'CSS 大括号不匹配'
}

/** 把用户选择器限制在 Habitat 主题根，避免污染站点外部页面。 */
export function scopeAppearanceCss(css: string): string {
  const error = validateAppearanceCss(css)
  if (error !== null || css.trim() === '') return ''
  return css.split('}').map((chunk) => {
    const brace = chunk.indexOf('{')
    if (brace < 0) return ''
    const selector = chunk.slice(0, brace).trim()
    const declarations = chunk.slice(brace + 1).trim()
    if (selector === '' || declarations === '') return ''
    const scoped = selector.split(',').map((part) => {
      const trimmed = part.trim()
      return trimmed.startsWith('[data-habitat-theme-root]') ? trimmed : `[data-habitat-theme-root] ${trimmed}`
    }).join(', ')
    return `${scoped} { ${declarations} }`
  }).filter(Boolean).join('\n')
}

export function appearanceCss(values: AppearanceValues): string {
  return `
[data-habitat-theme-root] {
  --habitat-font-scale: ${values.fontScale};
  --habitat-line-height: ${values.lineHeight};
  --habitat-chat-bubble-width: ${values.chatBubbleWidth}%;
  --habitat-chat-bubble-radius: ${values.chatBubbleRadius}px;
  --habitat-home-gap: ${values.homeGap}px;
  --habitat-home-opacity: ${values.homeOpacity};
  font-size: calc(100% * var(--habitat-font-scale));
  line-height: var(--habitat-line-height);
}
[data-habitat-theme-root] [data-chat-part="assistant-bubble"],
[data-habitat-theme-root] [data-chat-part="user-bubble"] {
  max-width: var(--habitat-chat-bubble-width);
  border-radius: var(--habitat-chat-bubble-radius);
}
[data-habitat-theme-root] [data-home-part="widget-grid"] { gap: var(--habitat-home-gap); opacity: var(--habitat-home-opacity); }
${scopeAppearanceCss(values.css)}
`.trim()
}

export const useAppearance = create<AppearanceState>()(
  persist(
    (set) => ({
      saved: DEFAULT_APPEARANCE,
      preview: null,
      save: (saved) => set({ saved, preview: null }),
      setPreview: (preview) => set({ preview }),
      clearPreview: () => set({ preview: null }),
      reset: () => set({ saved: DEFAULT_APPEARANCE, preview: null }),
    }),
    { name: 'habitat-appearance', version: 1 },
  ),
)
