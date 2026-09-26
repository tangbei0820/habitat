/**
 * 全局显示偏好 + 身份配置（SPEC §9.1.3）。
 *
 * 与 `theme/useTheme.ts` **同款做法**：zustand + persist + localStorage。
 * 刻意**不落 Dexie、不进备份格式** —— 这些是「看着顺不顺眼 / 叫着顺不顺口」，
 * 不是数据；把它塞进备份会让「恢复备份」多出一些跟内容无关的差异。
 *
 * 身份（头像图、昵称）也放在这里而不是单独建库：
 *  - 头像图是 128px 方形 data URL（几 KB～几十 KB），localStorage 装得下；
 *  - 它同样是「本机看着舒服」的偏好 —— 换设备后重新配一次，不算丢数据。
 *
 * 与主题分开成一个 store（而不是塞进 useTheme）的原因：主题是「整个应用长什么样」，
 * 这里是「聊天怎么显示」。混在一起后，改任何一边都要动同一个文件、也共用同一个持久化键。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** 头像 data URL 的体量上限（≈150KB）：超了宁可拒收，也别把 localStorage 撑爆 */
export const AVATAR_DATA_URL_LIMIT = 150_000

/** 昵称的兜底默认值 —— 头像首字也从这个名字取（MessageAvatar 唯一定义处的接棒者） */
export const DEFAULT_COMPANION_NAME = '小栖'
export const DEFAULT_USER_NAME = '北北'

export type IdentityRole = 'companion' | 'user'

interface ChatDisplayState {
  /** 小栖侧头像是否显示（SPEC §9.1.3 独立开关，全局偏好） */
  showCompanionAvatar: boolean
  /** 用户侧头像是否显示（同上，与另一侧互不牵连） */
  showUserAvatar: boolean
  /** 气泡上方是否显示昵称（默认关：气泡本身已能区分双方） */
  showNickname: boolean
  /** 小栖的昵称；空串回落默认值 */
  companionName: string
  /** 小栖头像（128px 方形 data URL）；null = 用首字 */
  companionAvatar: string | null
  /** 我的昵称；空串回落默认值 */
  userName: string
  /** 我的头像（同上） */
  userAvatar: string | null

  toggleCompanionAvatar: () => void
  toggleUserAvatar: () => void
  toggleNickname: () => void
  setNickname: (role: IdentityRole, name: string) => void
  setAvatar: (role: IdentityRole, dataUrl: string | null) => void
}

/**
 * 按角色取「实际生效」的昵称：没配过就用默认称呼。
 * 刻意做成函数而不是存进 store —— 默认值改名时只动这里，不用迁移已持久化数据。
 */
export function identityName(
  state: Pick<ChatDisplayState, 'companionName' | 'userName'>,
  role: IdentityRole,
): string {
  const raw = role === 'companion' ? state.companionName : state.userName
  const name = raw.trim()
  if (name !== '') return name
  return role === 'companion' ? DEFAULT_COMPANION_NAME : DEFAULT_USER_NAME
}

export const useChatDisplay = create<ChatDisplayState>()(
  persist(
    (set, get) => ({
      // 头像默认显示：这是新增的可视元素，默认开着才看得见它存在
      showCompanionAvatar: true,
      showUserAvatar: true,
      showNickname: false,
      companionName: '',
      companionAvatar: null,
      userName: '',
      userAvatar: null,

      toggleCompanionAvatar: () => set({ showCompanionAvatar: !get().showCompanionAvatar }),
      toggleUserAvatar: () => set({ showUserAvatar: !get().showUserAvatar }),
      toggleNickname: () => set({ showNickname: !get().showNickname }),
      setNickname: (role, name) =>
        set(role === 'companion' ? { companionName: name } : { userName: name }),
      setAvatar: (role, dataUrl) =>
        set(role === 'companion' ? { companionAvatar: dataUrl } : { userAvatar: dataUrl }),
    }),
    {
      name: 'habitat-chat-display',
      /**
       * v0 → v1：原来只有一个 `showAvatars` 总开关，拆成两侧独立开关时继承旧值 ——
       * 用户关掉过的偏好不能因为升级又冒出来。
       */
      version: 1,
      migrate: (persisted, version) => {
        const old = (persisted ?? {}) as Partial<ChatDisplayState> & { showAvatars?: boolean }
        if (version < 1 && typeof old.showAvatars === 'boolean') {
          return {
            ...old,
            showCompanionAvatar: old.showAvatars,
            showUserAvatar: old.showAvatars,
          } as ChatDisplayState
        }
        return old as ChatDisplayState
      },
    },
  ),
)
