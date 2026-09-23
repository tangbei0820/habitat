/**
 * 设置页「数据备份」区块：导出全量本地数据 / 从备份恢复。
 *
 * 导入是**整体替换**语义，所以给两步确认（选文件 → 看清后果 → 再点导入），
 * 与删除方案 / 会话同一套交互口径，不用原生 confirm。
 */
import { useRef, useState } from 'react'
import { downloadBackup, exportAll, importAll } from '../../lib/backup'
import { log } from '../../lib/log'

export function BackupPanel() {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [pendingFile, setPendingFile] = useState<{ name: string; size: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  async function handleExport(): Promise<void> {
    setBusy(true)
    setMessage(null)
    try {
      const backup = await exportAll()
      downloadBackup(backup)
      setIsError(false)
      const homeCount = backup.moments.length + backup.wishlist.length + backup.countdowns.length
      setMessage(`已导出 ${backup.sessions.length} 个会话、${backup.messages.length} 条消息、${homeCount} 条生活记录`)
    } catch (err: unknown) {
      log.error('导出备份失败', err)
      setIsError(true)
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function handleFileChosen(file: File | null): void {
    setMessage(null)
    if (file === null) return
    setPendingFile({ name: file.name, size: file.size })
  }

  async function handleImport(): Promise<void> {
    const input = fileRef.current
    const file = input?.files?.[0]
    if (file === undefined || file === null) return
    setBusy(true)
    setMessage(null)
    try {
      const text = await file.text()
      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        throw new Error('文件不是合法 JSON')
      }
      const counts = await importAll(raw)
      setIsError(false)
      const homeCount = counts.moments + counts.wishlist + counts.countdowns
      setMessage(`导入完成：${counts.sessions} 个会话、${counts.messages} 条消息、${homeCount} 条生活记录。刷新页面后生效。`)
      setPendingFile(null)
      if (input !== null) input.value = ''
    } catch (err: unknown) {
      log.error('导入备份失败', err)
      setIsError(true)
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="mb-4 rounded-lg border p-4"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-text-dim)' }}>
        数据备份
      </h2>
      <p className="mb-3 text-xs" style={{ color: 'var(--color-text-dim)' }}>
        导出全部本地聊天与共同生活记录（JSON 文件）。换浏览器 / 清站点数据前先导一份。
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={busy}
          className="rounded-full border px-3 py-1 text-sm disabled:opacity-50"
          style={{ borderColor: 'var(--color-border)' }}
        >
          导出备份
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => handleFileChosen(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="rounded-full border px-3 py-1 text-sm disabled:opacity-50"
          style={{ borderColor: 'var(--color-border)' }}
        >
          选择备份文件…
        </button>

        {pendingFile !== null && (
          <>
            <span className="text-xs" style={{ color: 'var(--color-text-dim)' }}>
              {pendingFile.name}（{Math.max(1, Math.round(pendingFile.size / 1024))} KB）
            </span>
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={busy}
              className="rounded-full px-3 py-1 text-sm disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-danger)', color: '#fff' }}
            >
              {busy ? '导入中…' : '确认导入（覆盖现有数据）'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingFile(null)
                if (fileRef.current !== null) fileRef.current.value = ''
              }}
              className="text-xs underline"
              style={{ color: 'var(--color-text-dim)' }}
            >
              取消
            </button>
          </>
        )}
      </div>

      {message !== null && (
        <p className="mt-3 text-xs" style={{ color: isError ? 'var(--color-danger)' : 'var(--color-text-dim)' }}>
          {isError ? '⚠️ ' : ''}{message}
        </p>
      )}
    </section>
  )
}
