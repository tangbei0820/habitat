import type { StudyCard, StudyCardDraft } from '@shared/types'
import { fetchJson } from '../lib/api'
import { db } from './db'
import { dayKeyOf } from './listen'

export type StudyCardFilter = 'due' | 'all' | 'mature'

/** 到期卡片包括今天与之前到期的卡片；日期比较使用本地日历，不受 UTC 偏移影响。 */
export function isStudyCardDue(card: StudyCard, today = dayKeyOf()): boolean {
  return card.dueOn <= today
}

/** “成熟”只表示已经形成可复习间隔，不等同于永久掌握。 */
export function isStudyCardMature(card: StudyCard): boolean {
  return card.repetitions >= 3 || card.intervalDays >= 7
}

export function filterStudyCards(cards: StudyCard[], filter: StudyCardFilter, today = dayKeyOf()): StudyCard[] {
  if (filter === 'all') return cards
  if (filter === 'mature') return cards.filter(isStudyCardMature)
  return cards.filter((card) => isStudyCardDue(card, today))
}

export interface StudyCardSummary {
  total: number
  due: number
  reviewedToday: number
  mature: number
}

export function summarizeStudyCards(cards: StudyCard[], now = new Date()): StudyCardSummary {
  const today = dayKeyOf(now)
  return {
    total: cards.length,
    due: cards.filter((card) => isStudyCardDue(card, today)).length,
    reviewedToday: cards.filter((card) => card.lastReviewedAt !== null && dayKeyOf(new Date(card.lastReviewedAt)) === today).length,
    mature: cards.filter(isStudyCardMature).length,
  }
}

function addDays(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T12:00:00`)
  date.setDate(date.getDate() + days)
  return dayKeyOf(date)
}

export async function listStudyCards(subject?: string): Promise<StudyCard[]> {
  const cards = await db.studyCards.orderBy('dueOn').toArray()
  return subject === undefined || subject === '' ? cards : cards.filter((card) => card.subject === subject)
}

export async function generateStudyCards(input: { subject: string; goal: string; level: string; count: number }): Promise<StudyCard[]> {
  const data = await fetchJson<{ cards: StudyCardDraft[] }>('/api/study/cards/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const today = dayKeyOf()
  const now = Date.now()
  const items: StudyCard[] = data.cards.map((card, index) => ({
    id: `study-card-${crypto.randomUUID()}-${String(index)}`,
    type: 'study-card',
    subject: input.subject.trim(),
    front: card.front,
    back: card.back,
    example: card.example,
    hint: card.hint,
    source: 'ai',
    dueOn: today,
    intervalDays: 1,
    ease: 2.5,
    repetitions: 0,
    lastReviewedAt: null,
    createdAt: now + index,
    updatedAt: now + index,
  }))
  await db.studyCards.bulkAdd(items)
  return items
}

export async function reviewStudyCard(id: string, grade: 'again' | 'good' | 'easy'): Promise<StudyCard> {
  const current = await db.studyCards.get(id)
  if (current === undefined) throw new Error('这张卡已经不存在')
  const now = Date.now()
  const today = dayKeyOf(new Date(now))
  const nextEase = grade === 'again' ? Math.max(1.3, current.ease - 0.2) : grade === 'easy' ? Math.min(3.2, current.ease + 0.15) : current.ease
  const nextRepetitions = grade === 'again' ? 0 : current.repetitions + 1
  const nextInterval = grade === 'again'
    ? 1
    : Math.max(1, Math.round(current.intervalDays * (grade === 'easy' ? nextEase + 0.35 : nextEase)))
  const updated: StudyCard = {
    ...current,
    dueOn: addDays(today, nextInterval),
    intervalDays: nextInterval,
    ease: nextEase,
    repetitions: nextRepetitions,
    lastReviewedAt: now,
    updatedAt: now,
  }
  await db.studyCards.put(updated)
  return updated
}

export async function deleteStudyCard(id: string): Promise<void> {
  await db.studyCards.delete(id)
}
