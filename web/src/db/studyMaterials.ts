import type { StudyMaterial } from '@shared/types'
import { db } from './db'

const MAX_TITLE = 120
const MAX_SUBJECT = 80
const MAX_CONTENT = 200_000

function requiredText(value: string, field: string, max: number): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new Error(`${field}不能为空`)
  if (trimmed.length > max) throw new Error(`${field}不能超过 ${max} 字`)
  return trimmed
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('链接必须使用 http(s)')
    return url.toString()
  } catch {
    throw new Error('请输入有效的 http(s) 学习资料链接')
  }
}

export async function listStudyMaterials(subject?: string): Promise<StudyMaterial[]> {
  const rows = await db.studyMaterials.orderBy('updatedAt').reverse().toArray()
  const normalized = subject?.trim()
  return normalized === undefined || normalized === '' ? rows : rows.filter((item) => item.subject === normalized)
}

export async function createStudyTextMaterial(subject: string, title: string, content: string): Promise<StudyMaterial> {
  const trimmedContent = content.trim()
  if (trimmedContent === '') throw new Error('资料内容不能为空')
  if (trimmedContent.length > MAX_CONTENT) throw new Error(`资料内容不能超过 ${MAX_CONTENT} 字`)
  const now = Date.now()
  const item: StudyMaterial = {
    id: `study-material-${crypto.randomUUID()}`,
    type: 'study-material',
    subject: requiredText(subject, '学习主题', MAX_SUBJECT),
    title: requiredText(title, '资料标题', MAX_TITLE),
    kind: 'text',
    content: trimmedContent,
    url: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.studyMaterials.add(item)
  return item
}

export async function createStudyLinkMaterial(subject: string, title: string, url: string): Promise<StudyMaterial> {
  const now = Date.now()
  const item: StudyMaterial = {
    id: `study-material-${crypto.randomUUID()}`,
    type: 'study-material',
    subject: requiredText(subject, '学习主题', MAX_SUBJECT),
    title: requiredText(title, '资料标题', MAX_TITLE),
    kind: 'link',
    content: null,
    url: safeUrl(url),
    createdAt: now,
    updatedAt: now,
  }
  await db.studyMaterials.add(item)
  return item
}

export async function deleteStudyMaterial(id: string): Promise<void> {
  await db.studyMaterials.delete(id)
}
