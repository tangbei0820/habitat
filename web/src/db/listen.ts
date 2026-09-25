/**
 * 听音时长统计（第 6 批：一起听真播放 / 独处听雨）。
 *
 * 设计：`listenSessions` 一天一行（id = `${kind}:${dayKey}`），播放中每 15 秒（以及暂停 /
 * 离开页面时）把积攒的秒数**累加**上去。为什么是累加而不是一行一次会话：
 * 「这周一起听了多久」只需要一个和，分行的会话明细没人看。
 *
 * ⚠️ 这两张新表（listenSessions / studyTasks）**暂时不在备份里** —— 备份是逐表枚举的
 * 白名单（`lib/backup.ts`，格式 v8），加表要升格式并处理旧版兼容，本批刻意不碰，见 TASKS 遗留。
 */
import type { ListenKind } from '@shared/types'
import { db } from './db'

export function dayKeyOf(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 把这一段秒数累加进今天（不足 1 秒的尾巴忽略） */
export async function addListenSeconds(kind: ListenKind, seconds: number): Promise<void> {
  const whole = Math.floor(seconds)
  if (whole <= 0) return
  const dayKey = dayKeyOf()
  const id = `${kind}:${dayKey}`
  await db.transaction('rw', db.listenSessions, async () => {
    const existing = await db.listenSessions.get(id)
    if (existing === undefined) {
      await db.listenSessions.add({ id, kind, dayKey, seconds: whole, updatedAt: Date.now(), createdAt: Date.now() })
    } else {
      await db.listenSessions.update(id, { seconds: existing.seconds + whole, updatedAt: Date.now() })
    }
  })
}

/** 最近 7 天（含今天）某类收听的累计秒数 */
export async function weekListenSeconds(kind: ListenKind): Promise<number> {
  const from = new Date()
  from.setDate(from.getDate() - 6)
  const floor = dayKeyOf(from)
  const rows = await db.listenSessions.where('kind').equals(kind).toArray()
  return rows.filter((row) => row.dayKey >= floor).reduce((sum, row) => sum + row.seconds, 0)
}
