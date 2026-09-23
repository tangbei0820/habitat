/**
 * Home 生活模块目录（§8）：入口列表与子页共用同一份，标题反查也走这里，
 * 避免 `/home/board` 的标题和入口名字对不上（见 docs/TASKS.md）。
 */
export interface HomeModule {
  key: string
  name: string
  icon: string
}

export const HOME_MODULES: readonly HomeModule[] = [
  { key: 'board', name: '留言板', icon: '💌' },
  { key: 'countdown', name: '倒数日', icon: '⏳' },
  { key: 'wishlist', name: '愿望清单', icon: '♡' },
  { key: 'diary', name: '日记', icon: '📔' },
  { key: 'bookmarks', name: '收藏', icon: '🔖' },
  { key: 'works', name: '作品', icon: '🎨' },
  { key: 'album', name: '相册', icon: '🖼' },
  { key: 'reading', name: '读书', icon: '📚' },
  { key: 'music', name: '音乐', icon: '🎵' },
  { key: 'study', name: '学习', icon: '✏️' },
]

/** 按路由 key 反查中文名；查不到（手输 URL）就退回显示原 key */
export function homeModuleName(key: string | undefined): string {
  if (key === undefined) return ''
  return HOME_MODULES.find((mod) => mod.key === key)?.name ?? key
}
