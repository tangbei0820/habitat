import type { CountdownDay, Moment, WishlistItem } from '@shared/types'
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
