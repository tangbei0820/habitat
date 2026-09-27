import { MAX_PHOTO_BYTES, type PhotoMime, type Sticker } from '@shared/types'
import { db } from './db'

const STICKER_MIMES: readonly PhotoMime[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_NAME_LENGTH = 80
const MAX_CATEGORY_LENGTH = 30
const MAX_TAG_LENGTH = 24
const MAX_TAGS = 8

function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeName(value: string): string {
  const name = value.trim()
  if (name === '') throw new Error('表情包名称不能为空')
  if (name.length > MAX_NAME_LENGTH) throw new Error(`表情包名称不能超过 ${MAX_NAME_LENGTH} 字`)
  return name
}

function normalizeCategory(value: string | null | undefined): string | null {
  const category = value?.trim() ?? ''
  if (category === '') return null
  if (category.length > MAX_CATEGORY_LENGTH) throw new Error(`表情包分类不能超过 ${MAX_CATEGORY_LENGTH} 字`)
  return category
}

function normalizeTags(values: readonly string[] | undefined): string[] {
  const tags = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
  if (tags.length > MAX_TAGS) throw new Error(`表情包最多添加 ${MAX_TAGS} 个标签`)
  if (tags.some((tag) => tag.length > MAX_TAG_LENGTH)) throw new Error(`表情包标签不能超过 ${MAX_TAG_LENGTH} 字`)
  return tags
}

function assertMime(mimeType: string): asserts mimeType is PhotoMime {
  if (!STICKER_MIMES.includes(mimeType as PhotoMime)) throw new Error('只支持 JPEG、PNG、WebP 或 GIF 表情包')
}

function assertDataUrl(dataUrl: string, mimeType: PhotoMime, sizeBytes: number): void {
  const prefix = `data:${mimeType};base64,`
  if (!dataUrl.startsWith(prefix)) throw new Error('表情包图片格式无效')
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_PHOTO_BYTES) {
    throw new Error('表情包必须在 1 B–3 MB 之间')
  }
}

export async function listStickers(): Promise<Sticker[]> {
  return db.stickers.orderBy('updatedAt').reverse().toArray()
}

export async function createSticker(input: {
  name: string
  imageDataUrl: string
  mimeType: PhotoMime
  sizeBytes: number
  category?: string | null
  tags?: readonly string[]
  source?: Sticker['source']
}): Promise<Sticker> {
  assertMime(input.mimeType)
  assertDataUrl(input.imageDataUrl, input.mimeType, input.sizeBytes)
  const name = normalizeName(input.name)
  const category = normalizeCategory(input.category)
  const tags = normalizeTags(input.tags)
  const duplicate = await db.stickers.filter((sticker) => sticker.imageDataUrl === input.imageDataUrl).first()
  if (duplicate !== undefined) throw new Error('这张表情包已经在图库中了')
  const at = Date.now()
  const sticker: Sticker = {
    id: nowId('sticker'),
    type: 'sticker',
    name,
    imageDataUrl: input.imageDataUrl,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    category,
    tags,
    source: input.source ?? 'user',
    createdAt: at,
    updatedAt: at,
  }
  await db.stickers.add(sticker)
  return sticker
}

export async function createStickerFromFile(
  file: File,
  options: { name?: string; category?: string | null; tags?: readonly string[] } = {},
): Promise<Sticker> {
  assertMime(file.type)
  if (file.size <= 0 || file.size > MAX_PHOTO_BYTES) throw new Error('表情包必须在 1 B–3 MB 之间')
  const imageDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('表情包读取失败'))
    reader.onerror = () => reject(new Error('表情包读取失败'))
    reader.readAsDataURL(file)
  })
  return createSticker({
    name: options.name ?? (file.name.replace(/\.[^.]+$/, '') || '未命名表情包'),
    imageDataUrl,
    mimeType: file.type,
    sizeBytes: file.size,
    category: options.category,
    tags: options.tags,
  })
}

export async function deleteSticker(id: string): Promise<void> {
  await db.stickers.delete(id)
}
