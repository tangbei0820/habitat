/**
 * 设置页「数据备份」区块：导出全量本地数据 / 从备份恢复。
 *
 * 导入是**整体替换**语义，所以给两步确认（选文件 → 看清后果 → 再点导入），
 * 与删除方案 / 会话同一套交互口径，不用原生 confirm。
 *
 * Phase 6 增补（技术方案 §9 风险7「本地数据损坏/丢失」的对策）：
 * - **导入前提醒**：覆盖是不可逆的，所以在确认导入前先把「先导一份」摆在手边
 * - **久未导出提醒**：光有按钮不够，得有人提醒该导了
 * 两条都刻意留在这里、不弹全局弹窗 —— 备份是低频动作，弹窗只会变成噪音。
 */
import { useEffect, useRef, useState } from 'react'
import { IconAlert } from '../../components/qixi/Icons'
import { downloadBackup, exportAll, importAll, readLastExportAt } from '../../lib/backup'
import { db } from '../../db/db'
import { runLegacyUpload } from '../../db/legacy-upload'
import { log } from '../../lib/log'

/** 超过这个天数没导出就提醒。个人自用、数据变动不频繁，7 天太吵、30 天太晚 */
const STALE_DAYS = 14

/** 相对时间文案：备份提醒里「今天 / 3 天前」比一串时间戳好读得多 */
function describeAge(days: number): string {
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  return `${days} 天前`
}

function ageInDays(at: number): number {
  return Math.floor((Date.now() - at) / 86_400_000)
}

export function BackupPanel() {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [pendingFile, setPendingFile] = useState<{ name: string; size: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [lastExportAt, setLastExportAt] = useState<number | null>(() => readLastExportAt())
  const [hasData, setHasData] = useState(false)

  useEffect(() => {
    // 空库还催人备份纯属噪音 —— 先问库本身有没有东西，任一表非空都算
    void Promise.all(db.tables.map((table) => table.count()))
      .then((counts) => setHasData(counts.some((count) => count > 0)))
      .catch(() => setHasData(false))
  }, [])

  async function handleExport(): Promise<void> {
    setBusy(true)
    setMessage(null)
    try {
      const backup = await exportAll()
      downloadBackup(backup)
      setLastExportAt(backup.exportedAt)
      setIsError(false)
      const homeCount = backup.wishlist.length + backup.countdowns.length + backup.bookmarks.length + backup.artworks.length + backup.photos.length + backup.readingNotes.length + backup.dailyReadings.length + backup.musicTracks.length + backup.studyRecords.length
      setMessage(`已导出 ${backup.sessions.length} 个会话、${backup.messages.length} 条消息、${homeCount} 条生活记录（日记与留言板在服务端，不在本地备份内）`)
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
      // 旧备份里救出来的日记 / 留言立刻送上服务端。传不动**不算导入失败** ——
      // 它们还在中转表里，下次启动会自动重试，没必要让用户为此重来一遍。
      let rescued = counts.legacyDiaries + counts.legacyMoments
      try {
        const uploaded = await runLegacyUpload()
        if (uploaded !== null) rescued = uploaded.diaries + uploaded.moments
      } catch (err: unknown) {
        log.warn('旧备份数据上传未完成，下次启动会重试', err)
      }
      const homeCount = counts.wishlist + counts.countdowns + counts.bookmarks + counts.artworks + counts.photos + counts.readingNotes + counts.dailyReadings + counts.musicTracks + counts.studyRecords
      setMessage(
        `导入完成：${counts.sessions} 个会话、${counts.messages} 条消息、${homeCount} 条生活记录。` +
          (rescued > 0 ? `另有 ${counts.legacyDiaries} 篇日记、${counts.legacyMoments} 条留言已恢复到服务端。` : '') +
          '刷新页面后生效。',
      )
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

  const stale = lastExportAt === null ? null : ageInDays(lastExportAt)
  const shouldRemind = hasData && !busy && (stale === null || stale >= STALE_DAYS)

  return (
    <section
      className="mb-4 rounded-lg border p-4"
      style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}
    >
      <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
        数据备份
      </h2>
      <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
        导出全部本地聊天与共同生活记录（JSON 文件）。换浏览器 / 清站点数据前先导一份。
        <br />
        日记与留言板存在服务端，<strong>不在这份本地备份里</strong> —— 它们随服务端数据一起备份（sqlite 文件）。
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="backup-export"
          onClick={() => void handleExport()}
          disabled={busy}
          className="rounded-full border px-3 py-1 text-sm disabled:opacity-50"
          style={{ borderColor: 'var(--border-soft)' }}
        >
          导出备份
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          // ⚠️ 设置页上现在有多个 input[type=file]（身份区的头像上传也在），验收要精确点名这一个
          data-testid="backup-import-file"
          className="hidden"
          onChange={(e) => handleFileChosen(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          data-testid="backup-choose"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="rounded-full border px-3 py-1 text-sm disabled:opacity-50"
          style={{ borderColor: 'var(--border-soft)' }}
        >
          选择备份文件…
        </button>

        {pendingFile !== null && (
          <>
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {pendingFile.name}（{Math.max(1, Math.round(pendingFile.size / 1024))} KB）
            </span>
            <button
              type="button"
              data-testid="backup-import-confirm"
              onClick={() => void handleImport()}
              disabled={busy}
              className="rounded-full px-3 py-1 text-sm disabled:opacity-50"
              style={{ backgroundColor: 'var(--danger)', color: '#fff' }}
            >
              {busy ? '导入中…' : '确认导入（覆盖现有数据）'}
            </button>
            <button
              type="button"
              data-testid="backup-import-cancel"
              onClick={() => {
                setPendingFile(null)
                if (fileRef.current !== null) fileRef.current.value = ''
              }}
              className="text-xs underline"
              style={{ color: 'var(--text-secondary)' }}
            >
              取消
            </button>
          </>
        )}
      </div>

      {/* 导入前提醒：覆盖不可逆，所以在确认按钮已经出现在手边时，把「先导一份」也摆出来 */}
      {pendingFile !== null && (
        <div
          data-testid="backup-import-warning"
          className="mt-3 rounded border p-2 text-xs"
          style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
        >
          导入会<strong>整体覆盖</strong>当前全部本地数据，现有会话、日记、相册等都会被替换且不可撤销。
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={busy}
            className="ml-1 underline disabled:opacity-50"
          >
            先导出一份现在的备份
          </button>
        </div>
      )}

      {/* 上次导出时间 / 久未导出提醒 */}
      <p data-testid="backup-last-export" className="mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
        {lastExportAt === null ? '这台设备还没有导出过备份' : `上次导出：${describeAge(stale ?? 0)}`}
      </p>
      {shouldRemind && (
        <p data-testid="backup-stale-hint" className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>
          {stale === null
            ? `本地已经有数据了，建议导出一份留在自己手里 —— 清站点数据或换浏览器都会让它们消失。`
            : `已经 ${stale} 天没导出了，中间产生的内容还只在这台设备的浏览器里。`}
        </p>
      )}

      {message !== null && (
        <p
          className="mt-3 flex items-center gap-1.5 text-xs"
          style={{ color: isError ? 'var(--danger)' : 'var(--text-secondary)' }}
        >
          {isError && <IconAlert size={13} />}
          <span>{message}</span>
        </p>
      )}
    </section>
  )
}
