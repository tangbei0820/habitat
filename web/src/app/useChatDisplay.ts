/**
 * 全局显示偏好（SPEC §9.1.3）。
 *
 * 与 `theme/useTheme.ts` **同款做法**：zustand + persist + localStorage。
 * 刻意**不落 Dexie、不进备份格式** —— 这些是「看着顺不顺眼」，
 * 不是数据；把它塞进备份会让「恢复备份」多出一些跟内容无关的差异。
 *
 * 与主题分开成一个 store（而不是塞进 useTheme）的原因：主题是「整个应用长什么样」，
 * 这里是「聊天怎么显示」。混在一起后，改任何一边都要动同一个文件、也共用同一个持久化键。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ChatDisplayState {
  /** 聊天气泡两侧是否显示头像。全局偏好，所有会话共用 */
  showAvatars: boolean
  toggleAvatars: () => void
}

export const useChatDisplay = create<ChatDisplayState>()(
  persist(
    (set, get) => ({
      // 默认显示：这是新增的可视元素，默认开着才看得见它存在
      showAvatars: true,
      toggleAvatars: () => set({ showAvatars: !get().showAvatars }),
    }),
    { name: 'habitat-chat-display' },
  ),
)
