import type { StudyCard, StudyCardDraft } from '@shared/types'
import { fetchJson } from '../lib/api'
import { db } from './db'
import { dayKeyOf } from './listen'

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

export async function reviewStudyCard(id: string, grade: 'again' | 'good' | 'easy'): Promise<void> {
  const current = await db.studyCards.get(id)
  if (current === undefined) throw new Error('这张卡已经不存在')
  const now = Date.now()
  const today = dayKeyOf(new Date(now))
  const nextEase = grade === 'again' ? Math.max(1.3, current.ease - 0.2) : grade === 'easy' ? Math.min(3.2, current.ease + 0.15) : current.ease
  const nextRepetitions = grade === 'again' ? 0 : current.repetitions + 1
  const nextInterval = grade === 'again'
    ? 1
    : Math.max(1, Math.round(current.intervalDays * (grade === 'easy' ? nextEase + 0.35 : nextEase)))
  await db.studyCards.update(id, {
    dueOn: addDays(today, nextInterval),
    intervalDays: nextInterval,
    ease: nextEase,
    repetitions: nextRepetitions,
    lastReviewedAt: now,
    updatedAt: now,
  })
}

export async function deleteStudyCard(id: string): Promise<void> {
  await db.studyCards.delete(id)
}
