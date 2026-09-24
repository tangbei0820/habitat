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
