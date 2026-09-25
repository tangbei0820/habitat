import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'light' | 'dark'

interface ThemeState {
  mode: ThemeMode
  toggle: () => void
  /** 设置页的分段控件用：直接指定目标模式，不用先算「当前是什么再翻转」 */
  setMode: (mode: ThemeMode) => void
}

/** store → DOM 的唯一副作用出口，保证「状态」与「DOM 属性」永不脱钩 */
function applyMode(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode
}

/** 首次访问（无持久化记录）时跟随系统偏好 */
const initialMode: ThemeMode = window.matchMedia('(prefers-color-scheme: dark)').matches
  ? 'dark'
  : 'light'

// 首帧兜底：任何情况下 data-theme 都有合法值（持久化值在下方 rehydrate 时覆盖）
applyMode(initialMode)

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: initialMode,
      toggle: () => set({ mode: get().mode === 'dark' ? 'light' : 'dark' }),
      setMode: (mode) => set({ mode }),
    }),
    {
      name: 'habitat-theme',
      // 刷新后把持久化的 mode 重新写回 DOM；localStorage 是同步存储，
      // rehydrate 在 create() 期间同步完成，不会出现主题闪变。
      onRehydrateStorage: () => (state) => {
        if (state) applyMode(state.mode)
      },
    },
  ),
)

// 单向同步：无论变更来自 toggle 还是 rehydrate，DOM 都跟着 store 走
useTheme.subscribe((state) => applyMode(state.mode))
