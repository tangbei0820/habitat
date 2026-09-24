/**
 * Diary 数据访问（SPEC §3.4 / §6.2）。**服务端是权威源**。
 *
 * ⚠️ 本文件是权限过滤的**唯一关口**：所有对外返回的日记都必须经过 `toDiaryView()`。
 * 把过滤放在这里而不是路由层，是因为路由以后会越来越多（用户侧 / AI 工具侧 / 主动行为侧），
 * 而「漏一处就是把 AI 的私密日记漏给用户」这种错，不该靠每个新路由作者记得加一行 if。
 *
 * 用户自己的日记（`author='user'`）不受这条限制 —— 那本来就是他的内容（SPEC §6.1）。
 * 所以 2026-09-24 的迁移不会让北北已经写好的日记失去读写能力：搬上来时它们就是 `user`。
 */
import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import type { DiaryView } from '@shared/types'
import { db } from './index.js'
import { diary, type DiaryRow } from './schema.js'

/** 用户视角能否读正文：自己的日记全能读；AI 的日记只有它明确开放了才能读。 */
function isReadable(row: DiaryRow): boolean {
  return row.author === 'user' || row.visibility === 'open'
}

/** 唯一的出口。任何返回给前端或模型的日记都要过这里。 */
export function toDiaryView(row: DiaryRow): DiaryView {
  const readable = isReadable(row)
  return {
    id: row.id,
    title: row.title,
    entryDate: row.entryDate,
    author: row.author,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // ⚠️ 无权限时给 `null` 而不是空串：前端要靠 `readable` 区分「没权限」与「正文为空」
    content: readable ? row.content : null,
    readable,
    editable: row.author === 'user',
  }
}

export function listDiaryViews(): DiaryView[] {
  return db
    .select()
    .from(diary)
    .orderBy(desc(diary.entryDate), desc(diary.createdAt))
    .all()
    .map(toDiaryView)
}

export function getDiaryView(id: string): DiaryView | null {
  const row = db.select().from(diary).where(eq(diary.id, id)).get()
  return row === undefined ? null : toDiaryView(row)
}

export interface DiaryInput {
  title: string
  content: string
  entryDate: string
}

/**
 * 用户新建自己的日记。
 *
 * `author` / `visibility` **刻意不接受入参** —— 用户建不出 AI 日记（SPEC §3.4.2），
 * 让调用方传这两个字段，就等于把「不许伪造 AI 私有内容」这条规则交给每个调用方自觉。
 */
export function createUserDiary(input: DiaryInput): DiaryView {
  const at = Date.now()
  const row: DiaryRow = {
    id: `diary-${randomUUID()}`,
    title: input.title,
    content: input.content,
    entryDate: input.entryDate,
    author: 'user',
    visibility: 'open',
    createdAt: at,
    updatedAt: at,
  }
  db.insert(diary).values(row).run()
  return toDiaryView(row)
}

/** 只能改 `author='user'` 的日记。返回 `null` 表示「不存在，或不该动它」——对调用方是同一件事。 */
export function updateUserDiary(id: string, input: DiaryInput): DiaryView | null {
  const existing = db.select().from(diary).where(eq(diary.id, id)).get()
  if (existing === undefined || existing.author !== 'user') return null
  const updatedAt = Date.now()
  db.update(diary)
    .set({ title: input.title, content: input.content, entryDate: input.entryDate, updatedAt })
    .where(eq(diary.id, id))
    .run()
  return toDiaryView({ ...existing, ...input, updatedAt })
}

export function deleteUserDiary(id: string): boolean {
  const existing = db.select().from(diary).where(eq(diary.id, id)).get()
  if (existing === undefined || existing.author !== 'user') return false
  db.delete(diary).where(eq(diary.id, id)).run()
  return true
}

/**
 * 搬迁专用：把浏览器里已有的旧日记原样搬上来。
 *
 * **已存在则跳过**（返回 `false`）。两个理由：
 * ① 搬迁可能被重复触发（换设备、清缓存后重进、用户手动重跑）—— 不能因此产生副本；
 * ② 更不能覆盖：用户可能在服务端已经改过这一篇，本地那份是旧的。
 */
export function importDiaryIfAbsent(row: DiaryRow): boolean {
  const existing = db.select({ id: diary.id }).from(diary).where(eq(diary.id, row.id)).get()
  if (existing !== undefined) return false
  db.insert(diary).values(row).run()
  return true
}
