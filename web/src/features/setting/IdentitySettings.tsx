/**
 * 身份设置（SPEC §9.1.3，Post-v1 Phase 7A）。
 *
 * 配置双方的头像图与昵称 —— 这是「内容」，与聊天设置里的三个「显示开关」分工不同：
 * 这里管「是什么」，那边管「显不显示」。
 *
 * 数据归宿：zustand persist → localStorage。刻意**不进备份、不上传服务器**（SPEC 铁律：
 * 显示偏好不落 Dexie、不进备份）—— 换设备重配一次，不算丢数据。
 *
 * 头像图：上传后在本地用 canvas 裁成 128px 方形（中置 cover），存 data URL。
 * 不落文件、不占服务端存储；失败就报错并保留原头像。
 */
import { useRef, useState, type ChangeEvent } from 'react'
import {
  AVATAR_DATA_URL_LIMIT,
  DEFAULT_COMPANION_NAME,
  DEFAULT_USER_NAME,
  identityName,
  type IdentityRole,
  useChatDisplay,
} from '../../app/useChatDisplay'

const PREVIEW_SIZE = 52

/** 把用户挑的图裁成 128px 方形 data URL（中置 cover 裁剪，WebP 优先） */
async function fileToAvatarDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('图片读取失败，换一张试试'))
      element.src = url
    })
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('当前浏览器不支持本地裁剪')
    // JPEG/WebP 没有透明通道，先铺底色，避免透明 PNG 裁出来变黑块
    ctx.fillStyle = '#efe9df'
    ctx.fillRect(0, 0, size, size)
    const scale = Math.max(size / image.width, size / image.height)
    const width = image.width * scale
    const height = image.height * scale
    ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
    const dataUrl = canvas.toDataURL('image/webp', 0.85)
    if (dataUrl.length > AVATAR_DATA_URL_LIMIT) throw new Error('图片太大，换张小一点的')
    return dataUrl
  } finally {
    URL.revokeObjectURL(url)
  }
}

const ROWS: Array<{ role: IdentityRole; label: string; nameTestId: string; fileTestId: string; removeTestId: string }> = [
  {
    role: 'companion', label: '小栖',
    nameTestId: 'identity-companion-name', fileTestId: 'identity-companion-avatar-file', removeTestId: 'identity-companion-avatar-remove',
  },
  {
    role: 'user', label: '我',
    nameTestId: 'identity-user-name', fileTestId: 'identity-user-avatar-file', removeTestId: 'identity-user-avatar-remove',
  },
]

export function IdentitySettings() {
  const companionName = useChatDisplay((state) => state.companionName)
  const userName = useChatDisplay((state) => state.userName)
  const companionAvatar = useChatDisplay((state) => state.companionAvatar)
  const userAvatar = useChatDisplay((state) => state.userAvatar)
  const setNickname = useChatDisplay((state) => state.setNickname)
  const setAvatar = useChatDisplay((state) => state.setAvatar)
  const [message, setMessage] = useState<string | null>(null)
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})

  const values: Record<IdentityRole, { name: string; avatar: string | null }> = {
    companion: { name: companionName, avatar: companionAvatar },
    user: { name: userName, avatar: userAvatar },
  }

  async function onPickFile(role: IdentityRole, event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = '' // 同一张图选两次也要触发 change
    if (file === undefined) return
    setMessage(null)
    try {
      setAvatar(role, await fileToAvatarDataUrl(file))
      setMessage('头像已更新（只存在本机）')
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <div className="setting-group-label" style={{ marginTop: 18 }} data-testid="identity-group">身份</div>
      <section className="setting-group" style={{ marginTop: 0 }}>
        {ROWS.map((row) => {
          const current = values[row.role]
          const effectiveName = identityName(
            { companionName, userName },
            row.role,
          )
          return (
            <div key={row.role} className="setting-row" data-testid={`identity-row-${row.role}`}>
              {current.avatar !== null ? (
                <img
                  alt=""
                  aria-hidden
                  data-testid={`${row.role}-avatar-preview`}
                  src={current.avatar}
                  className="flex-none object-cover"
                  style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE, borderRadius: '50%' }}
                />
              ) : (
                <span
                  aria-hidden
                  data-testid={`${row.role}-avatar-preview`}
                  className="flex flex-none items-center justify-center"
                  style={{
                    width: PREVIEW_SIZE, height: PREVIEW_SIZE, borderRadius: '50%',
                    background: row.role === 'user'
                      ? 'var(--accent-strong)'
                      : 'linear-gradient(145deg, #8b95a3, #4c5560 72%)',
                    color: 'var(--accent-on-strong)', fontSize: 21, fontWeight: 500,
                  }}
                >
                  {[...effectiveName][0] ?? '?'}
                </span>
              )}
              <div className="setting-row-main">
                <input
                  type="text"
                  data-testid={row.nameTestId}
                  value={current.name}
                  maxLength={12}
                  placeholder={row.role === 'companion' ? DEFAULT_COMPANION_NAME : DEFAULT_USER_NAME}
                  aria-label={`${row.label}的昵称`}
                  onChange={(event) => setNickname(row.role, event.target.value)}
                  className="w-full rounded-lg border bg-transparent px-3 py-1.5 text-sm outline-none"
                  style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
                />
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => fileInputs.current[row.role]?.click()}
                    className="rounded-lg border px-2.5 py-1"
                    style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}
                  >
                    上传头像
                  </button>
                  {current.avatar !== null && (
                    <button
                      type="button"
                      data-testid={row.removeTestId}
                      onClick={() => { setAvatar(row.role, null); setMessage('已恢复首字头像') }}
                      className="rounded-lg px-2.5 py-1 underline"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      移除
                    </button>
                  )}
                  <input
                    ref={(element) => { fileInputs.current[row.role] = element }}
                    type="file"
                    accept="image/*"
                    data-testid={row.fileTestId}
                    aria-label={`${row.label}的头像图片`}
                    onChange={(event) => void onPickFile(row.role, event)}
                    className="hidden"
                  />
                </div>
              </div>
            </div>
          )
        })}
        <p className="px-4 pb-3 pt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {message ?? '头像与昵称只存在这台设备（不进备份、不上传服务器）；聊天设置里可分别控制显隐。'}
        </p>
      </section>
    </>
  )
}
