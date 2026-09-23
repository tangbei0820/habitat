import type { Bookmark, CountdownDay, Diary, Moment, WishlistItem } from '@shared/types'
import { db } from './db'

function nowId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim()
  if (normalized === '') throw new Error(`${label}不能为空`)
  return normalized
}

export async function listMoments(): Promise<Moment[]> {
  return db.moments.orderBy('createdAt').reverse().toArray()
}

export async function createMoment(content: string): Promise<Moment> {
  const at = Date.now()
  const item: Moment = {
    id: nowId('moment'),
    type: 'moment',
    content: requiredText(content, '留言'),
    author: 'user',
    createdAt: at,
    updatedAt: at,
  }
  await db.moments.add(item)
  return item
}

export async function deleteMoment(id: string): Promise<void> {
  await db.moments.delete(id)
}

export async function listWishlist(): Promise<WishlistItem[]> {
  const items = await db.wishlist.orderBy('updatedAt').reverse().toArray()
  return items.sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done'))
}

export async function createWishlistItem(title: string): Promise<WishlistItem> {
  const at = Date.now()
  const item: WishlistItem = {
    id: nowId('wish'),
    type: 'wishlist-item',
    title: requiredText(title, '愿望'),
    status: 'open',
    completedAt: null,
    createdAt: at,
    updatedAt: at,
  }
  await db.wishlist.add(item)
  return item
}

export async function toggleWishlistItem(id: string): Promise<void> {
  const item = await db.wishlist.get(id)
  if (item === undefined) return
  const done = item.status === 'open'
  const at = Date.now()
  await db.wishlist.update(id, {
    status: done ? 'done' : 'open',
    completedAt: done ? at : null,
    updatedAt: at,
  })
}

export async function deleteWishlistItem(id: string): Promise<void> {
  await db.wishlist.delete(id)
}

export async function listCountdowns(): Promise<CountdownDay[]> {
  return db.countdowns.orderBy('targetDate').toArray()
}

export async function createCountdown(title: string, targetDate: string): Promise<CountdownDay> {
  const normalizedDate = targetDate.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) throw new Error('请选择有效日期')
  const at = Date.now()
  const item: CountdownDay = {
    id: nowId('countdown'),
    type: 'countdown-day',
    title: requiredText(title, '倒数日名称'),
    targetDate: normalizedDate,
    createdAt: at,
    updatedAt: at,
  }
  await db.countdowns.add(item)
  return item
}

export async function deleteCountdown(id: string): Promise<void> {
  await db.countdowns.delete(id)
}

function requiredDate(value: string): string {
  const normalized = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error('请选择有效日期')
  return normalized
}

export async function listDiaries(): Promise<Diary[]> {
  return db.diaries.orderBy('entryDate').reverse().toArray()
}

export async function createDiary(title: string, content: string, entryDate: string): Promise<Diary> {
  const at = Date.now()
  const item: Diary = {
    id: nowId('diary'),
    type: 'diary',
    title: requiredText(title, '日记标题'),
    content: requiredText(content, '日记正文'),
    entryDate: requiredDate(entryDate),
    createdAt: at,
    updatedAt: at,
  }
  await db.diaries.add(item)
  return item
}

export async function updateDiary(id: string, title: string, content: string, entryDate: string): Promise<void> {
  const changed = await db.diaries.update(id, {
    title: requiredText(title, '日记标题'),
    content: requiredText(content, '日记正文'),
    entryDate: requiredDate(entryDate),
    updatedAt: Date.now(),
  })
  if (changed === 0) throw new Error('这篇日记已经不存在')
}

export async function deleteDiary(id: string): Promise<void> {
  await db.diaries.delete(id)
}

export async function listBookmarks(): Promise<Bookmark[]> {
  return db.bookmarks.orderBy('createdAt').reverse().toArray()
}

function normalizeExternalUrl(value: string): string {
  const normalized = value.trim()
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new Error('请输入完整链接（含 http:// 或 https://）')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('收藏链接只支持 http:// 或 https://')
  }
  return url.toString()
}

export async function createExternalBookmark(title: string, href: string, note: string): Promise<Bookmark> {
  const targetId = normalizeExternalUrl(href)
  const existing = await db.bookmarks.where('[targetType+targetId]').equals(['external-link', targetId]).first()
  if (existing !== undefined) throw new Error('这个链接已经收藏过了')
  const at = Date.now()
  const item: Bookmark = {
    id: nowId('bookmark'),
    type: 'bookmark',
    targetType: 'external-link',
    targetId,
    title: requiredText(title, '收藏名称'),
    note: note.trim() === '' ? null : note.trim(),
    createdAt: at,
    updatedAt: at,
  }
  await db.bookmarks.add(item)
  return item
}

export async function deleteBookmark(id: string): Promise<void> {
  await db.bookmarks.delete(id)
}
