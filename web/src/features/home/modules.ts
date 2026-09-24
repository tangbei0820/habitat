/**
 * Home 生活模块目录（§8）：入口列表与子页共用同一份，标题反查也走这里，
 * 避免 `/home/board` 的标题和入口名字对不上（见 docs/TASKS.md）。
 *
 * ⚠️ `icon` 存的是**图标名**而不是 emoji，也不是 SVG 组件：名字可序列化、
 * 能进备份、能跟旧数据比对；换成组件会让这份纯数据文件依赖 React。
 * 渲染走 `<QixiIcon name={...} />`（见 components/qixi/Icons.tsx）。
 */
import type { IconName } from '../../components/qixi/Icons'

export interface HomeModule {
  key: string
  name: string
  icon: IconName
}

export const HOME_MODULES: readonly HomeModule[] = [
  { key: 'board', name: '留言板', icon: 'mail' },
  { key: 'countdown', name: '倒数日', icon: 'timer' },
  { key: 'wishlist', name: '愿望清单', icon: 'heart' },
  { key: 'diary', name: '日记', icon: 'journal' },
  { key: 'bookmarks', name: '收藏', icon: 'bookmark' },
  { key: 'works', name: '作品', icon: 'palette' },
  { key: 'album', name: '相册', icon: 'image' },
  { key: 'reading', name: '读书', icon: 'book' },
  { key: 'music', name: '音乐', icon: 'music' },
  { key: 'study', name: '学习', icon: 'pencil' },
]

/** 按路由 key 反查中文名；查不到（手输 URL）就退回显示原 key */
export function homeModuleName(key: string | undefined): string {
  if (key === undefined) return ''
  return HOME_MODULES.find((mod) => mod.key === key)?.name ?? key
}
