/**
 * LLM 页面（小栖档案）的模块目录 —— 能力的「分组 + 启动目标」。
 *
 * 这里**只描述外观与去向**，不描述「有哪些能力、能不能用」：
 * 那些一律来自 `GET /api/capabilities`。两张表分开，是为了避免
 * 「模块元数据里悄悄长出一份能力清单」—— 那会立刻变成第二份真相。
 */
import type { CapabilityAutonomy, CapabilityModule } from '@shared/capabilities'
import type { IconName } from '../../components/qixi/Icons'

export interface CapabilityModuleMeta {
  key: CapabilityModule
  name: string
  /** 图标名（见 components/qixi/Icons.tsx 的 QIXI_ICONS），不存 emoji */
  icon: IconName
  /**
   * 该模块对应的「应用」位置。
   * `null` = 前端暂时没有可进入的页面 —— 此时卡片**不可点**，
   * 并用 `noPageHint` 说清这件事发生在哪儿（不做假入口，SPEC §9.1.1）。
   */
  launch: { to: string; label: string } | null
  /** 没有界面时的说明；有界面时不使用 */
  noPageHint?: string
}

/** 顺序即页面上的顺序：先「小栖自己用」的，再「你们共用的」 */
export const CAPABILITY_MODULES: readonly CapabilityModuleMeta[] = [
  {
    key: 'memory',
    name: '记忆',
    icon: 'brain',
    // 7A：记忆页（/llm/memory）落地，不再是「暂无界面」
    launch: { to: '/llm/memory', label: '查看记忆' },
  },
  {
    key: 'state',
    name: '状态',
    icon: 'thermometer',
    launch: { to: '/life?tab=runtime', label: '查看状态' },
  },
  {
    key: 'diary',
    name: '日记',
    icon: 'journal',
    launch: { to: '/home/diary', label: '打开日记' },
  },
  {
    key: 'board',
    name: '留言板',
    icon: 'mail',
    launch: { to: '/home/board', label: '打开留言板' },
  },
  {
    key: 'relationship',
    name: '关系互动',
    icon: 'heart',
    launch: null,
    noPageHint: '暂无独立页面 · 拍一拍、暂停与恢复申请发生在聊天页',
  },
  {
    key: 'tools',
    name: '工具',
    icon: 'toolbox',
    launch: null,
    noPageHint: '暂无界面 · 调用结果在聊天里以工具卡片出现',
  },
  {
    key: 'web',
    name: '联网',
    icon: 'sparkle',
    launch: null,
    noPageHint: '暂无独立页面 · 只能从聊天中明确发起联网搜索',
  },
]

/** 自主级别的**面向用户**说法。别把内部枚举名直接显示给用户。 */
export const AUTONOMY_LABELS: Record<CapabilityAutonomy, string> = {
  autonomous: '小栖自主使用',
  confirm: '需你确认后执行',
  'user-only': '只有你能发起',
  unavailable: '暂不可用',
}
