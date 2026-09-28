/**
 * 相册自动收集偏好（PRODUCT_SPEC §3.7.2）。
 *
 * 这是本机的隐私 / 存储偏好，不属于照片内容本身：跟主题、聊天显示偏好一样放在
 * localStorage，不进入 Dexie 备份，也不上传服务器。三个来源刻意拆开，避免用户
 * 为了收集 AI 生成图而被迫收集自己发出的所有图片。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface PhotoCollectionSettingsState {
  collectUserSent: boolean
  collectAssistantSent: boolean
  collectAssistantGenerated: boolean
  setCollectUserSent: (value: boolean) => void
  setCollectAssistantSent: (value: boolean) => void
  setCollectAssistantGenerated: (value: boolean) => void
}

export const usePhotoCollectionSettings = create<PhotoCollectionSettingsState>()(
  persist(
    (set) => ({
      // SPEC 默认关闭：图片会占用本机空间，必须由用户主动选择。
      collectUserSent: false,
      collectAssistantSent: false,
      collectAssistantGenerated: false,
      setCollectUserSent: (value) => set({ collectUserSent: value }),
      setCollectAssistantSent: (value) => set({ collectAssistantSent: value }),
      setCollectAssistantGenerated: (value) => set({ collectAssistantGenerated: value }),
    }),
    {
      name: 'habitat-photo-collection',
      version: 1,
    },
  ),
)

