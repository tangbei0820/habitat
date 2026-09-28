/** 朋友圈回应数据访问（P1）。服务端权威、按动态分组返回，保留父回应关系。 */
import { randomUUID } from 'node:crypto'
import { asc, eq, inArray } from 'drizzle-orm'
import type { ContentAuthor, MomentComment } from '@shared/types'
import { db } from './index.js'
import { moment, momentComment, type MomentCommentRow } from './schema.js'
import { appendEventLog } from './activity.js'

function toComment(row: MomentCommentRow): MomentComment {
  return {
    id: row.id,
    type: 'moment-comment',
    momentId: row.momentId,
    parentId: row.parentId ?? null,
    content: row.content,
    author: row.author,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listMomentComments(momentId: string): MomentComment[] {
  return db.select().from(momentComment)
    .where(eq(momentComment.momentId, momentId))
    .orderBy(asc(momentComment.createdAt), asc(momentComment.id))
    .all()
    .map(toComment)
}

function parentBelongsToMoment(momentId: string, parentId: string): boolean {
  const parent = db.select({ momentId: momentComment.momentId })
    .from(momentComment)
    .where(eq(momentComment.id, parentId))
    .get()
  return parent?.momentId === momentId
}

function momentExists(momentId: string): boolean {
  return db.select({ channel: moment.channel }).from(moment).where(eq(moment.id, momentId)).get()?.channel === 'feed'
}

function create(momentId: string, content: string, author: ContentAuthor, parentId: string | null): MomentComment | null {
  if (!momentExists(momentId)) return null
  if (parentId !== null && !parentBelongsToMoment(momentId, parentId)) return null
  const at = Date.now()
  const row: MomentCommentRow = {
    id: `moment-comment-${randomUUID()}`,
    momentId,
    parentId,
    content,
    author,
    createdAt: at,
    updatedAt: at,
  }
  db.insert(momentComment).values(row).run()
  appendEventLog('moment.feed.comment.created', { author, momentId, parentId }, row.id, at)
  return toComment(row)
}

export function createUserMomentComment(momentId: string, content: string, parentId: string | null = null): MomentComment | null {
  return create(momentId, content, 'user', parentId)
}

export function createCompanionMomentComment(momentId: string, content: string, parentId: string | null = null): MomentComment | null {
  return create(momentId, content, 'companion', parentId)
}

export function updateUserMomentComment(id: string, content: string): MomentComment | null {
  const existing = db.select().from(momentComment).where(eq(momentComment.id, id)).get()
  if (existing === undefined || existing.author !== 'user') return null
  const updatedAt = Math.max(Date.now(), existing.updatedAt + 1)
  db.update(momentComment).set({ content, updatedAt }).where(eq(momentComment.id, id)).run()
  return toComment({ ...existing, content, updatedAt })
}

export function updateCompanionMomentComment(id: string, content: string): MomentComment | null {
  const existing = db.select().from(momentComment).where(eq(momentComment.id, id)).get()
  if (existing === undefined || existing.author !== 'companion') return null
  const updatedAt = Math.max(Date.now(), existing.updatedAt + 1)
  db.update(momentComment).set({ content, updatedAt }).where(eq(momentComment.id, id)).run()
  return toComment({ ...existing, content, updatedAt })
}

export function deleteUserMomentComment(id: string): boolean {
  const existing = db.select({ author: momentComment.author }).from(momentComment).where(eq(momentComment.id, id)).get()
  if (existing?.author !== 'user') return false
  const result = db.transaction((tx) => {
    // 收集整棵子树，而不是只删一层；否则三级回应会变成没有父级的孤儿。
    const ids = [id]
    for (let cursor = 0; cursor < ids.length; cursor += 1) {
      const children = tx.select({ id: momentComment.id })
        .from(momentComment)
        .where(eq(momentComment.parentId, ids[cursor]))
        .all()
      for (const child of children) ids.push(child.id)
    }
    return tx.delete(momentComment).where(inArray(momentComment.id, ids)).run()
  })
  return result.changes > 0
}

export function deleteMomentComments(momentId: string): number {
  return db.delete(momentComment).where(eq(momentComment.momentId, momentId)).run().changes
}
