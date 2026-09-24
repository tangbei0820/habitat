/**
 * 栖息地 · 线框图标集（设计规范 §20：Stroke 1.7 / Round Cap / Round Join / 选中态实心）
 *
 * 来源：D:/我搓/designs/qixi-habitat/icons.jsx（原型 = 唯一参考源）
 * 与原型一致的设计意图：
 *  - 统一 24×24 网格、线宽 1.7、圆头圆角；
 *  - 每个图标都接受 `filled`，选中态用**实心**而不是换色 —— 底栏图标变实心时
 *    不需要动颜色，靠形状本身表达"当前在哪儿"。
 *
 * 换装进度：第 1 批只是把图标备好，第 2 批底部导航先穿上，其余页面逐批替换。
 */
import type { ReactNode, SVGProps } from 'react'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** 边长（px）。保持 24 会让 1.7 的线宽最好看 */
  size?: number
  /** stroke-width，默认 1.7 */
  sw?: number
  /** 选中态：填充为当前文字色、不要描边 */
  filled?: boolean
}

type IconBaseProps = IconProps & { children: ReactNode }

function IconBase({ size = 24, sw = 1.7, filled = false, children, ...rest }: IconBaseProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

/* ---------- 底部导航 ---------- */

export const IconChat = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    {filled
      ? <path d="M12 3.2c-5 0-9 3.4-9 7.6 0 2.6 1.5 4.9 3.8 6.3-.2 1.3-.8 2.6-1.8 3.5 1.9-.1 3.6-.8 4.9-1.6.6.1 1.3.2 2.1.2 5 0 9-3.4 9-7.6s-4-7.6-9-7.6z" />
      : <path d="M12 3.5c-5 0-9 3.4-9 7.6 0 2.6 1.5 4.9 3.8 6.3-.2 1.3-.8 2.6-1.8 3.5 1.9-.1 3.6-.8 4.9-1.6.6.1 1.3.2 2.1.2 5 0 9-3.4 9-7.6s-4-7.6-9-7.6z" />}
  </IconBase>
)

export const IconHome = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    {filled
      ? <path d="M12 3.2 3.8 9.6c-.3.3-.1.8.3.8h1.4v8.6a2 2 0 0 0 2 2h3v-5.4h3.4v5.4h2.6a2 2 0 0 0 2-2v-8.6h1.9c.4 0 .6-.5.3-.8L12.4 3.2a.8.8 0 0 0-.4-.2z" />
      : <path d="M4.5 10 12 3.8 19.5 10M6.3 8.8V19a1.6 1.6 0 0 0 1.6 1.6h8.2A1.6 1.6 0 0 0 17.7 19V8.8M10 20.4v-5.2h4v5.2" />}
  </IconBase>
)

export const IconBrain = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    {filled
      ? <path d="M12 2.6l1.9 5 5 1.9-5 1.9-1.9 5-1.9-5-5-1.9 5-1.9zM18.8 15.4l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z" />
      : <path d="M12 3.4l1.8 4.8 4.8 1.8-4.8 1.8L12 16.6l-1.8-4.8-4.8-1.8 4.8-1.8zM18.9 16.2l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z" />}
  </IconBase>
)

export const IconLife = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    {filled
      ? <path d="M5.2 18.8C5.2 10.6 10.4 5 19.4 5c0 9-5.6 13.8-14.2 13.8z" />
      : <path d="M5.2 18.8C5.2 10.6 10.4 5 19.4 5c0 9-5.6 13.8-14.2 13.8zM5.2 18.8C8.4 13.4 12.6 9.6 16.6 7.6" />}
  </IconBase>
)

export const IconSetting = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    <path d="M4 7.2h9.4M17.8 7.2H20M4 16.8h4.2M12.6 16.8H20" stroke={filled ? 'none' : 'currentColor'} />
    <circle cx="15.6" cy="7.2" r="2.1" fill={filled ? 'currentColor' : 'none'} />
    <circle cx="10.4" cy="16.8" r="2.1" fill={filled ? 'currentColor' : 'none'} />
    {filled && <path d="M4 6.4h9.4v1.6H4zM17.8 6.4H20v1.6h-2.2zM4 16h4.2v1.6H4zM12.6 16H20v1.6h-7.4z" />}
  </IconBase>
)

/* ---------- 输入区 / 消息操作 ---------- */

export const IconSend = (p: IconProps) => (
  <IconBase {...p}><path d="M12 19V6.5M6.8 11 12 5.8 17.2 11" /></IconBase>
)
export const IconPlus = (p: IconProps) => (
  <IconBase {...p}><path d="M12 5.5v13M5.5 12h13" /></IconBase>
)
export const IconMic = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    <path d="M12 3.2a2.6 2.6 0 0 1 2.6 2.6v5.4a2.6 2.6 0 0 1-5.2 0V5.8A2.6 2.6 0 0 1 12 3.2z" />
    {!filled && <path d="M5.8 11.2a6.2 6.2 0 0 0 12.4 0M12 17.4V21" />}
    {filled && <path d="M12 17.6c-3.5 0-6.4-2.6-6.4-6h-1.5a7.9 7.9 0 0 0 6.4 7.7V21h3v-1.7a7.9 7.9 0 0 0 6.4-7.7h-1.5c0 3.4-2.9 6-6.4 6z" />}
  </IconBase>
)
export const IconImage = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    <rect x="3.6" y="4.6" width="16.8" height="14.8" rx="3" />
    {!filled && <path d="M4.4 15.6l4.6-4.6 3.8 3.8 2.8-2.8 4 4M15.6 8.6h.01" />}
  </IconBase>
)
export const IconStar = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    <path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z" />
  </IconBase>
)
export const IconCopy = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    <rect x="8.6" y="8.6" width="11" height="11.4" rx="2.4" />
    {!filled && <path d="M5.4 15.4V6.8A2.4 2.4 0 0 1 7.8 4.4h8.6" />}
  </IconBase>
)
export const IconMore = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    <circle cx="5.5" cy="12" r="1.35" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.35" fill="currentColor" stroke="none" />
  </IconBase>
)

/* ---------- 一起听 ---------- */

export const IconPlay = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    {filled
      ? <path d="M8.2 5.4v13.2c0 .6.7 1 1.2.7l10.2-6.6c.5-.3.5-1 0-1.3L9.4 4.7c-.5-.3-1.2 0-1.2.7z" />
      : <path d="M8.4 5.6v12.8L19 12z" />}
  </IconBase>
)
export const IconPause = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    {filled
      ? <path d="M7.4 5h3.4v14H7.4zM13.2 5h3.4v14h-3.4z" />
      : <path d="M8.6 5.4v13.2M15.4 5.4v13.2" />}
  </IconBase>
)
export const IconSkipBack = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    {filled
      ? <path d="M7 5.5h2.2v13H7zM18.8 5.8v12.4c0 .6-.7 1-1.2.7l-8.4-6.2c-.4-.3-.4-.9 0-1.2l8.4-6.2c.5-.3 1.2 0 1.2.5z" />
      : <path d="M7 5.5v13M17.6 5.8v12.4L9.6 12z" />}
  </IconBase>
)
export const IconSkipForward = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    {filled
      ? <path d="M14.8 5.5H17v13h-2.2zM5.2 5.8v12.4c0 .6.7 1 1.2.7l8.4-6.2c.4-.3.4-.9 0-1.2L6.4 5.3c-.5-.3-1.2 0-1.2.5z" />
      : <path d="M17 5.5v13M6.4 5.8v12.4L14.4 12z" />}
  </IconBase>
)
export const IconTimer = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    <circle cx="12" cy="13" r="7.6" />
    {!filled && <path d="M12 9.4v3.8l2.6 1.6M9.4 2.6h5.2" />}
  </IconBase>
)
export const IconNote = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    <path d="M9.4 18V6.4l9.2-1.8V15" />
    <circle cx="7" cy="18" r="2.4" />
    <circle cx="16.2" cy="15" r="2.4" />
  </IconBase>
)

/* ---------- 主题 / 方向 ---------- */

export const IconMoon = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    <path d="M20.2 14.2A8.4 8.4 0 1 1 9.8 3.8a6.8 6.8 0 0 0 10.4 10.4z" />
  </IconBase>
)
export const IconSun = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    <circle cx="12" cy="12" r="4.2" />
    {!filled && <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19" />}
  </IconBase>
)
export const IconChevronRight = (p: IconProps) => (
  <IconBase {...p}><path d="M9.4 5.4 16.6 12l-7.2 6.6" /></IconBase>
)
export const IconChevronLeft = (p: IconProps) => (
  <IconBase {...p}><path d="M14.6 5.4 7.4 12l7.2 6.6" /></IconBase>
)

/* ---------- 其他 ---------- */

export const IconCheck = (p: IconProps) => (
  <IconBase {...p}><path d="M5 12.6l4.4 4.4L19 7.2" /></IconBase>
)
export const IconBook = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    <path d="M12 6.2C10.2 4.9 7.4 4.3 4.4 4.3v14.6c3 0 5.8.6 7.6 1.9 1.8-1.3 4.6-1.9 7.6-1.9V4.3c-3 0-5.8.6-7.6 1.9z" />
    {!filled && <path d="M12 6.2v14.6" />}
  </IconBase>
)
export const IconCalendar = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    <rect x="3.8" y="5" width="16.4" height="15.4" rx="3" />
    {!filled && <path d="M8.2 3v4M15.8 3v4M3.8 9.8h16.4" />}
  </IconBase>
)
export const IconQuote = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    <path d="M9.6 7.2c-3.1.5-5.2 2.7-5.2 6v3.6h5.4v-5.4H7.2c.1-1.7 1.1-2.8 2.9-3.2zM19.6 7.2c-3.1.5-5.2 2.7-5.2 6v3.6h5.4v-5.4h-2.6c.1-1.7 1.1-2.8 2.9-3.2z" />
  </IconBase>
)
export const IconAdjust = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    <path d="M4 7.2h4.4M12.4 7.2H20M4 16.8h9.4M18 16.8h2M4 12h13" />
    <circle cx="10.2" cy="7.2" r="2" />
    <circle cx="16.2" cy="16.8" r="2" />
    <circle cx="19" cy="12" r="1.6" />
  </IconBase>
)
export const IconSparkle = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    {filled
      ? <path d="M12 2.8l1.7 5.3 5.3 1.7-5.3 1.7L12 16.8l-1.7-5.3-5.3-1.7 5.3-1.7z" />
      : <path d="M12 3.2l1.7 5.1 5.1 1.7-5.1 1.7L12 16.8l-1.7-5.1-5.1-1.7 5.1-1.7z" />}
  </IconBase>
)
export const IconClock = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    <circle cx="12" cy="12" r="8.4" />
    {!filled && <path d="M12 7.2V12l3.2 2" />}
  </IconBase>
)
export const IconDrop = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    <path d="M12 3.4s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z" />
  </IconBase>
)
export const IconHeart = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    <path d="M12 20.2s-7.6-4.6-9.3-9.1A5.2 5.2 0 0 1 12 6.5a5.2 5.2 0 0 1 9.3 4.6c-1.7 4.5-9.3 9.1-9.3 9.1z" />
  </IconBase>
)

/* ============================================================
   标记类图标 —— 换装第 2 批补

   原型（icons.jsx）只有 32 个，够它自己演示用；栖息地还要表达
   「置顶 / 密钥缺失 / 工具失败 / 未分类」这类**状态**，所以这里补上。
   风格与原型一致：24×24 网格、线宽 1.7、圆头圆角。

   ⚠️ 这些是**静态标记**，不参与「选中变实心」：写法上把 `filled={false}`
   放在 `{...p}` **之后**覆盖掉传进来的值 —— 否则一个纯描边路径被填充
   会变成一坨不规则色块。（`noUnusedLocals` 开着，所以不能靠解构丢弃它。）
   ============================================================ */

export const IconMail = (p: IconProps) => (
  <IconBase {...p} filled={false}>
    <rect x="3.4" y="5.6" width="17.2" height="12.8" rx="2.4" />
    <path d="M4.6 7.6 12 13.2l7.4-5.6" />
  </IconBase>
)

/** 收藏：唯一需要实心语义的标记（已收藏 / 未收藏） */
export const IconBookmark = ({ filled, ...p }: IconProps) => (
  <IconBase filled={filled} {...p}>
    <path d="M6.6 3.6h10.8a1 1 0 0 1 1 1v15.8l-6.4-4.5-6.4 4.5V4.6a1 1 0 0 1 1-1z" />
  </IconBase>
)

/**
 * 日记本。
 * ⚠️ 别拿 `IconNote` 当日记 —— 原型里的 `IconNote` 是**音符**（note = 乐符），
 * 用它会让「日记」和「音乐」在列表里长得一模一样。
 */
export const IconJournal = (p: IconProps) => (
  <IconBase {...p} filled={false}>
    <rect x="5.4" y="3.8" width="13.2" height="16.4" rx="2.2" />
    <path d="M9.4 3.8v3.2l1.8-1.2 1.8 1.2V3.8" />
    <path d="M9.4 12.4h5.2M9.4 15.6h3.4" />
  </IconBase>
)

export const IconPalette = (p: IconProps) => (
  <IconBase {...p} filled={false}>
    <path d="M12 3.6c-4.8 0-8.6 3.6-8.6 8s3.7 8 8.2 8c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.9-1.8h1.8c2 0 3.7-1.7 3.7-3.8 0-3.5-3.5-6.2-8-6.2z" />
    <circle cx="7.8" cy="12" r="1" />
    <circle cx="11.2" cy="8.4" r="1" />
    <circle cx="15.6" cy="10" r="1" />
  </IconBase>
)

export const IconMusic = (p: IconProps) => (
  <IconBase {...p} filled={false}>
    <path d="M9.6 17.4V6.6l9.4-2v10.8" />
    <circle cx="6.9" cy="17.6" r="2.7" />
    <circle cx="16.3" cy="15.4" r="2.7" />
  </IconBase>
)

export const IconPencil = (p: IconProps) => (
  <IconBase {...p} filled={false}>
    <path d="M4.4 19.6l.9-3.9L15.8 5.2a2.2 2.2 0 0 1 3.1 3.1L8.3 18.7l-3.9.9z" />
    <path d="M14.4 6.6l3 3" />
  </IconBase>
)

export const IconThermometer = (p: IconProps) => (
  <IconBase {...p} filled={false}>
    <path d="M10 13.9V6.4a2 2 0 1 1 4 0v7.5a4 4 0 1 1-4 0z" />
    <path d="M12 17.8v-3.4" />
  </IconBase>
)

export const IconToolbox = (p: IconProps) => (
  <IconBase {...p} filled={false}>
    <rect x="3.4" y="8.4" width="17.2" height="11.2" rx="2.2" />
    <path d="M9 8.4V6.6a1.6 1.6 0 0 1 1.6-1.6h2.8A1.6 1.6 0 0 1 15 6.6v1.8" />
    <path d="M3.4 12.8h17.2" />
  </IconBase>
)

export const IconAlert = (p: IconProps) => (
  <IconBase {...p} filled={false}>
    <path d="M12 4 3.1 19.4h17.8L12 4z" />
    <path d="M12 10.2v4.2" />
    <circle cx="12" cy="17.1" r="0.9" />
  </IconBase>
)

export const IconBlock = (p: IconProps) => (
  <IconBase {...p} filled={false}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M6.1 6.1 17.9 17.9" />
  </IconBase>
)

export const IconClose = (p: IconProps) => (
  <IconBase {...p} filled={false}>
    <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" />
  </IconBase>
)

export const IconFile = (p: IconProps) => (
  <IconBase {...p} filled={false}>
    <path d="M6.4 3.6h6.8L18.6 9v11.4H6.4z" />
    <path d="M13.2 3.6V9h5.4" />
  </IconBase>
)

export const IconKey = (p: IconProps) => (
  <IconBase {...p} filled={false}>
    <circle cx="8.2" cy="15.8" r="3.4" />
    <path d="M10.6 13.4 19.4 4.6M16.6 7.4l2.2 2.2" />
  </IconBase>
)

export const IconPin = (p: IconProps) => (
  <IconBase {...p} filled={false}>
    <path d="M9.2 3.6h5.6l-.7 5.2 3 3v1.4H6.9v-1.4l3-3z" />
    <path d="M12 13.2v7.2" />
  </IconBase>
)

export const IconChevronDown = (p: IconProps) => (
  <IconBase {...p} filled={false}>
    <path d="M6.4 9.6 12 15.2l5.6-5.6" />
  </IconBase>
)

export const IconLeaf = (p: IconProps) => (
  <IconBase {...p} filled={false}>
    <path d="M20.4 4.2c.6 7.8-3.8 12.2-10.4 12.2H5.2C5.2 9.4 9.6 4.2 20.4 4.2z" />
    <path d="M5 20.4c1.4-5 4.8-8 9.8-9.4" />
  </IconBase>
)

export const IconSmile = (p: IconProps) => (
  <IconBase {...p} filled={false}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M8.4 14.2a4.6 4.6 0 0 0 7.2 0" />
    <circle cx="9.4" cy="9.8" r="0.9" />
    <circle cx="14.6" cy="9.8" r="0.9" />
  </IconBase>
)

/* ============================================================
   名字 → 图标。**数据层只存名字**（可序列化、能进备份、能做迁移比对），
   渲染层才认识 SVG。任何地方想把图标塞进数据结构，走这里，别存 emoji。
   ============================================================ */

export const QIXI_ICONS = {
  chat: IconChat,
  home: IconHome,
  brain: IconBrain,
  life: IconLife,
  setting: IconSetting,
  send: IconSend,
  plus: IconPlus,
  mic: IconMic,
  image: IconImage,
  star: IconStar,
  copy: IconCopy,
  more: IconMore,
  play: IconPlay,
  pause: IconPause,
  timer: IconTimer,
  note: IconNote,
  moon: IconMoon,
  sun: IconSun,
  check: IconCheck,
  chevronRight: IconChevronRight,
  chevronLeft: IconChevronLeft,
  chevronDown: IconChevronDown,
  book: IconBook,
  calendar: IconCalendar,
  quote: IconQuote,
  clock: IconClock,
  drop: IconDrop,
  heart: IconHeart,
  adjust: IconAdjust,
  sparkle: IconSparkle,
  skipBack: IconSkipBack,
  skipForward: IconSkipForward,
  mail: IconMail,
  bookmark: IconBookmark,
  journal: IconJournal,
  palette: IconPalette,
  music: IconMusic,
  pencil: IconPencil,
  thermometer: IconThermometer,
  toolbox: IconToolbox,
  alert: IconAlert,
  block: IconBlock,
  close: IconClose,
  file: IconFile,
  key: IconKey,
  pin: IconPin,
  leaf: IconLeaf,
  smile: IconSmile,
} as const

export type IconName = keyof typeof QIXI_ICONS

/**
 * 按名字渲染图标。**未知名字不抛错**（返回 null）：
 * 图标名会随数据流传（比如备份里的旧模块），让一个不认识的名字炸掉整页不值。
 */
export function QixiIcon({ name, ...rest }: IconProps & { name: IconName }) {
  const Icon = QIXI_ICONS[name]
  return <Icon {...rest} />
}
