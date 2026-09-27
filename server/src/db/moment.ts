/**
 * Moment（留言板）数据访问（SPEC §3.3）。服务端权威源，理由同 `db/diary.ts`。
 *
 * 留言板比日记简单：内容没有「私密」一说（写出来就是给人看的），
 * 所以这里不做可见性过滤，只区分作者权限 —— 用户 / AI 各自只能改自己的，用户只能删自己发的。
 */
import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import type { Moment } from '@shared/types'
import { db } from './index.js'
import { moment, type MomentRow } from './schema.js'

function toMoment(row: MomentRow): Moment {
  return {
    id: row.id,
    type: 'moment',
    content: row.content,
    author: row.author,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listMoments(): Moment[] {
  return db.select().from(moment).orderBy(desc(moment.createdAt)).all().map(toMoment)
}

export function getMoment(id: string): Moment | null {
  const row = db.select().from(moment).where(eq(moment.id, id)).get()
  return row === undefined ? null : toMoment(row)
}

/** 用户留言。`author` 固定为 `user` —— AI 的留言走自己的写入路径（Phase 6.5 P1 工具层）。 */
export function createUserMoment(content: string): Moment {
  const at = Date.now()
  const row: MomentRow = {
    id: `moment-${randomUUID()}`,
    content,
    author: 'user',
    createdAt: at,
    updatedAt: at,
  }
  db.insert(moment).values(row).run()
  return toMoment(row)
}

/** 用户只能改自己的留言。返回 `null` 表示不存在，或作者不是用户。 */
export function updateUserMoment(id: string, content: string): Moment | null {
  const existing = db.select().from(moment).where(eq(moment.id, id)).get()
  if (existing === undefined || existing.author !== 'user') return null
  const updatedAt = Math.max(Date.now(), existing.updatedAt + 1)
  db.update(moment).set({ content, updatedAt }).where(eq(moment.id, id)).run()
  return toMoment({ ...existing, content, updatedAt })
}

/** 用户只能删自己的留言。AI 的留言不归用户处置（SPEC §6.2）。 */
export function deleteUserMoment(id: string): boolean {
  const existing = db.select().from(moment).where(eq(moment.id, id)).get()
  if (existing === undefined || existing.author !== 'user') return false
  db.delete(moment).where(eq(moment.id, id)).run()
  return true
}

/**
 * AI 留言（Phase 6.5 P1）。
 *
 * `author` 固定 `companion`，**不接受入参** —— 与 `createUserMoment` 对称：
 * 每条留言的作者由它的入口决定，不由调用方声明。让调用方传，就等于把
 * 「用户产不出 AI 留言、AI 产不出用户留言」这条交给每个调用方自觉。
 *
 * 留言板没有可见性过滤，所以这里不需要第二个「AI 视角」出口。
 */
export function createCompanionMoment(content: string): Moment {
  const at = Date.now()
  const row: MomentRow = {
    id: `moment-${randomUUID()}`,
    content,
    author: 'companion',
    createdAt: at,
    updatedAt: at,
  }
  db.insert(moment).values(row).run()
  return toMoment(row)
}

/** AI 只能改自己的留言；保留原始创建时间，让收藏与时间线仍可追溯。 */
export function updateCompanionMoment(id: string, content: string): Moment | null {
  const existing = db.select().from(moment).where(eq(moment.id, id)).get()
  if (existing === undefined || existing.author !== 'companion') return null
  const updatedAt = Math.max(Date.now(), existing.updatedAt + 1)
  db.update(moment).set({ content, updatedAt }).where(eq(moment.id, id)).run()
  return toMoment({ ...existing, content, updatedAt })
}

/** 搬迁专用，语义同 `importDiaryIfAbsent`：已存在则跳过，不覆盖。 */
export function importMomentIfAbsent(row: MomentRow): boolean {
  const existing = db.select({ id: moment.id }).from(moment).where(eq(moment.id, row.id)).get()
  if (existing !== undefined) return false
  db.insert(moment).values(row).run()
  return true
}
