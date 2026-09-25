/**
 * 学习伴学 · 「今天的三件小事」（第 6 批）。
 *
 * 为什么按 dayKey 归组而不是给任务加「完成于」：设计语义是**每天一页新纸** ——
 * 昨天没做完的事不追到今天（那会变成催促），隔天列表自然为空、自然重新写。
 */
import type { StudyTask } from '@shared/types'
import { db } from './db'
import { dayKeyOf } from './listen'

export async function listTodayTasks(): Promise<StudyTask[]> {
  return db.studyTasks.where('dayKey').equals(dayKeyOf()).sortBy('createdAt')
}

export async function createTask(label: string): Promise<StudyTask> {
  const trimmed = label.trim()
  if (trimmed === '') throw new Error('先写一句话，再添加。')
  const item: StudyTask = { id: crypto.randomUUID(), dayKey: dayKeyOf(), label: trimmed, done: false, createdAt: Date.now() }
  await db.studyTasks.add(item)
  return item
}

export async function toggleTask(id: string): Promise<void> {
  await db.transaction('rw', db.studyTasks, async () => {
    const item = await db.studyTasks.get(id)
    if (item === undefined) return
    await db.studyTasks.update(id, { done: !item.done })
  })
}

export async function deleteTask(id: string): Promise<void> {
  await db.studyTasks.delete(id)
}
