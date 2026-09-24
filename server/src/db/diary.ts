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
import type { DiaryView, DiaryVisibility } from '@shared/types'
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

/* ------------------------------------------------------------------ AI 视角（Phase 6.5 P1）
 *
 * ⚠️ 本文件有两个出口，各自对应一个**视角**，别拿错：
 *
 *   · `toDiaryView()`          —— **用户视角**：AI 的私密日记只给封面
 *   · `toCompanionDiaryView()` —— **AI 视角**：只给自己的日记，且给全文
 *
 * 为什么不能共用一个：日记「私密」的含义就是「**只有作者能看到正文**」。
 * 用用户视角的出口去给 AI 读它自己的日记，AI 会得到 `content: null` —— 它写的东西它自己读不到。
 * 反过来用 AI 视角去给用户查列表，就是直接把私密正文漏出去。
 * 两个方向都会出错，所以是两个函数，不是同一个函数加参数。
 *
 * `DiaryView` 上的 `readable` / `editable` 因此是**相对调用方视角**的：
 * 同一条 companion 日记，对用户是 `readable=false, editable=false`，对 AI 是两者皆真。
 */

/** AI 视角出口。仅用于「AI 读 / 改自己的日记」，**绝不**用它回应前端请求。 */
export function toCompanionDiaryView(row: DiaryRow): DiaryView {
  return {
    id: row.id,
    title: row.title,
    entryDate: row.entryDate,
    author: row.author,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    content: row.content,
    readable: true,
    editable: row.author === 'companion',
  }
}

/** AI 自己的日记列表（含未开放的）—— `diary.list_own` 工具的数据源。 */
export function listCompanionDiaryViews(limit = 50): DiaryView[] {
  return db
    .select()
    .from(diary)
    .where(eq(diary.author, 'companion'))
    .orderBy(desc(diary.entryDate), desc(diary.createdAt))
    .limit(limit)
    .all()
    .map(toCompanionDiaryView)
}

/** 读 AI 自己的某篇。**别人的日记一律返回 `null`** —— 与「不存在」对调用方是同一件事。 */
export function getCompanionDiaryView(id: string): DiaryView | null {
  const row = db.select().from(diary).where(eq(diary.id, id)).get()
  if (row === undefined || row.author !== 'companion') return null
  return toCompanionDiaryView(row)
}

export interface CompanionDiaryInput {
  title: string
  content: string
  entryDate: string
}

/**
 * AI 写日记。
 *
 * `visibility` 固定 `private` 起手 —— 「写的时候顺手决定要不要给人看」不该是默认动作，
 * 开放是**另一件事**（北北请求 → AI 决定，走 `setDiaryVisibility`）。
 */
export function createCompanionDiary(input: CompanionDiaryInput): DiaryView {
  const at = Date.now()
  const row: DiaryRow = {
    id: `diary-${randomUUID()}`,
    title: input.title,
    content: input.content,
    entryDate: input.entryDate,
    author: 'companion',
    visibility: 'private',
    createdAt: at,
    updatedAt: at,
  }
  db.insert(diary).values(row).run()
  return toCompanionDiaryView(row)
}

/** AI 改自己的日记。改不到（不存在 / 不是它的）返回 `null`。 */
export function updateCompanionDiary(id: string, input: CompanionDiaryInput): DiaryView | null {
  const existing = db.select().from(diary).where(eq(diary.id, id)).get()
  if (existing === undefined || existing.author !== 'companion') return null
  const updatedAt = Date.now()
  db.update(diary)
    .set({ title: input.title, content: input.content, entryDate: input.entryDate, updatedAt })
    .where(eq(diary.id, id))
    .run()
  return toCompanionDiaryView({ ...existing, ...input, updatedAt })
}

/**
 * 改可见性（`diary.allow_access` 的落点）。
 *
 * **只对 companion 的日记生效**：用户自己的日记本来就是 `open`，让别人（AI）去改它的可见性
 * 属于越界 —— 返回 `false` 而不是静默改成一样。
 */
export function setDiaryVisibility(id: string, visibility: DiaryVisibility): DiaryView | null {
  const existing = db.select().from(diary).where(eq(diary.id, id)).get()
  if (existing === undefined || existing.author !== 'companion') return null
  db.update(diary).set({ visibility, updatedAt: Date.now() }).where(eq(diary.id, id)).run()
  return toCompanionDiaryView({ ...existing, visibility })
}
