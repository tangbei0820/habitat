/**
 * 离线横幅。
 *
 * 定位是「先说清能做什么」，而不是只喊一句「你断网了」——
 * 栖息地的聊天、日记、相册、账本**本来就全存在本机**，离线时照常能翻，
 * 真正不能用的只有「要发给模型」的那些动作。把它说明白，用户就不会以为数据丢了。
 */
import { useOnlineStatus } from './useOnlineStatus'

export function OfflineBanner() {
  const online = useOnlineStatus()
  if (online) return null

  return (
    <div
      data-testid="offline-banner"
      className="flex items-center gap-2 border-b px-4 py-2 text-sm"
      style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-subtle)' }}
    >
      <span
        className="shrink-0 rounded-full px-2 py-0.5 text-xs"
        style={{ backgroundColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
      >
        离线
      </span>
      <span style={{ color: 'var(--text-secondary)' }}>
        本地内容照常可看；需要联网的动作（发消息、生成、朗读等）暂时不可用
      </span>
    </div>
  )
}
