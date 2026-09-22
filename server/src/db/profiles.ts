/**
 * LLM 方案仓储层（§6.2 ApiProfile / ApiSecret）
 *
 * 唯一碰 `api_profile` / `api_secret` 两张表的地方 —— 上层（registry / routes）只认域类型。
 *
 * 设计要点
 * - **服务端 SQLite 是权威源**（偏离 §6.2 的「本地存 + 服务端副本」，理由见 docs/TASKS.md）
 * - **密钥与配置分表**：配置可以被随意读，凭据只能写不能读回
 * - 「设为默认」是**互斥**操作：任何时刻至多一条 isActive
 */
import { asc, eq, ne } from 'drizzle-orm'
import type { ApiProfile, ApiProfileCreateInput, ApiProfileUpdateInput } from '@shared/types'
import { db } from './index.js'
import { apiProfile, apiSecret, type ApiProfileRow } from './schema.js'

/**
 * 由名称派生 id。
 *
 * **保留中文字符**：id 会出现在 `usage_record.profile_id`、诊断日志和启动日志里，
 * 全是 `p-muda8ngu` 这种时间戳的话没人看得懂。代价只是 URL 里要编码（前端已做）。
 * 白名单之外（空格、标点、斜杠等）一律压成 `-`，避免在 URL / 日志里惹麻烦。
 */
function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  // 名字全是标点时兜底，否则会得到空 id
  return slug === '' ? `p-${Date.now().toString(36)}` : slug
}

/** id 在库内唯一即可 —— 撞了就加序号，不打扰用户 */
function generateId(name: string): string {
  const base = slugify(name)
  let candidate = base
  let suffix = 1
  while (db.select({ id: apiProfile.id }).from(apiProfile).where(eq(apiProfile.id, candidate)).get() !== undefined) {
    suffix += 1
    candidate = `${base}-${suffix}`
  }
  return candidate
}

/** 行 → 域类型。JSON 列由 drizzle 的 json mode 自动解析；headers 允许缺失 */
function toProfile(row: ApiProfileRow): ApiProfile {
  return {
    id: row.id,
    name: row.name,
    provider: 'openai-compat',
    baseUrl: row.baseUrl,
    keyRef: row.keyRef,
    modelMap: row.modelMap,
    ...(row.headers === null || row.headers === undefined ? {} : { headers: row.headers }),
    isActive: row.isActive,
  }
}

function nextSortOrder(): number {
  const rows = db
    .select({ sortOrder: apiProfile.sortOrder })
    .from(apiProfile)
    .orderBy(asc(apiProfile.sortOrder))
    .all()
  const last = rows[rows.length - 1]
  return last === undefined ? 0 : last.sortOrder + 1
}

/** 默认方案互斥：置某条为 active 时，其余全部取消 */
function setActiveExclusive(id: string): void {
  db.update(apiProfile).set({ isActive: false }).where(ne(apiProfile.id, id)).run()
  db.update(apiProfile).set({ isActive: true }).where(eq(apiProfile.id, id)).run()
}

/** 删掉当前默认方案后，把剩下第一条顶上（否则会出现「有方案但没有默认」的空窗） */
function ensureActiveExists(): void {
  const hasActive = db.select({ id: apiProfile.id }).from(apiProfile).where(eq(apiProfile.isActive, true)).get()
  if (hasActive !== undefined) return
  const first = db.select({ id: apiProfile.id }).from(apiProfile).orderBy(asc(apiProfile.sortOrder)).get()
  if (first !== undefined) setActiveExclusive(first.id)
}

export function countProfiles(): number {
  return db.select({ id: apiProfile.id }).from(apiProfile).all().length
}

export function listProfiles(): ApiProfile[] {
  return db
    .select()
    .from(apiProfile)
    .orderBy(asc(apiProfile.sortOrder), asc(apiProfile.createdAt))
    .all()
    .map(toProfile)
}

export function getProfile(id: string): ApiProfile | null {
  const row = db.select().from(apiProfile).where(eq(apiProfile.id, id)).get()
  return row === undefined ? null : toProfile(row)
}

export function createProfile(input: ApiProfileCreateInput): ApiProfile {
  const id = generateId(input.name)
  const now = Date.now()
  // 库里一条方案都没有时自动设为默认 —— 单方案场景不该还要用户多按一次
  const isActive = input.isActive === true || countProfiles() === 0
  db.insert(apiProfile)
    .values({
      id,
      name: input.name,
      provider: 'openai-compat',
      baseUrl: input.baseUrl,
      keyRef: input.keyRef ?? '',
      modelMap: input.modelMap,
      headers: input.headers ?? null,
      isActive,
      sortOrder: nextSortOrder(),
      createdAt: now,
      updatedAt: now,
    })
    .run()
  if (isActive) setActiveExclusive(id)
  // createProfile 刚插进去的必然存在；用 require 语义会让调用方多一次判空
  const created = getProfile(id)
  if (created === null) throw new Error(`新建方案 '${id}' 后读回失败`)
  return created
}

/** 局部更新：只改送来的字段（`undefined` 一律视为「不改」） */
export function updateProfile(id: string, patch: ApiProfileUpdateInput): ApiProfile {
  const current = getProfile(id)
  if (current === null) throw new Error(`方案 '${id}' 不存在`)

  const values: Partial<ApiProfileRow> = { updatedAt: Date.now() }
  if (patch.name !== undefined) values.name = patch.name
  if (patch.baseUrl !== undefined) values.baseUrl = patch.baseUrl
  if (patch.keyRef !== undefined) values.keyRef = patch.keyRef
  if (patch.modelMap !== undefined) values.modelMap = patch.modelMap
  // 空对象 = 明确要清空（否则会留下 `{}` 这种「看着有、其实没有」的值）
  if (patch.headers !== undefined) {
    values.headers = Object.keys(patch.headers).length > 0 ? patch.headers : null
  }

  db.update(apiProfile).set(values).where(eq(apiProfile.id, id)).run()
  // isActive 单独走互斥路径，别塞进上面的 set（否则会留下两条 active）
  if (patch.isActive === true) setActiveExclusive(id)
  else if (patch.isActive === false) {
    db.update(apiProfile).set({ isActive: false }).where(eq(apiProfile.id, id)).run()
    ensureActiveExists()
  }

  const updated = getProfile(id)
  if (updated === null) throw new Error(`方案 '${id}' 更新后读回失败`)
  return updated
}

export function deleteProfile(id: string): boolean {
  const existing = getProfile(id)
  if (existing === null) return false
  // 密钥一并清掉：留着孤儿记录等于把废弃凭据永久留在库里
  db.transaction((tx) => {
    tx.delete(apiSecret).where(eq(apiSecret.profileId, id)).run()
    tx.delete(apiProfile).where(eq(apiProfile.id, id)).run()
  })
  ensureActiveExists()
  return true
}

export function activateProfile(id: string): ApiProfile {
  const existing = getProfile(id)
  if (existing === null) throw new Error(`方案 '${id}' 不存在`)
  setActiveExclusive(id)
  const activated = getProfile(id)
  if (activated === null) throw new Error(`方案 '${id}' 激活后读回失败`)
  return activated
}

/* ---------- 凭据（只写不读回；读只发生在服务端内部，用于装配 Adapter） ---------- */

export function getSecret(profileId: string): string | null {
  const row = db.select().from(apiSecret).where(eq(apiSecret.profileId, profileId)).get()
  return row === undefined ? null : row.secret
}

export function setSecret(profileId: string, secret: string): void {
  const now = Date.now()
  db.insert(apiSecret)
    .values({ profileId, secret, updatedAt: now })
    .onConflictDoUpdate({ target: apiSecret.profileId, set: { secret, updatedAt: now } })
    .run()
}

export function clearSecret(profileId: string): boolean {
  const row = db.select().from(apiSecret).where(eq(apiSecret.profileId, profileId)).get()
  if (row === undefined) return false
  db.delete(apiSecret).where(eq(apiSecret.profileId, profileId)).run()
  return true
}

/**
 * 环境变量方案的一次性导入（仅在表为空时调用）。
 *
 * 为什么要它：切片一/二让北北把方案写在 `.env` 里跑通了链路，直接换成 DB 会让那些配置凭空消失。
 * 导入后 **DB 即权威** —— 之后改 `.env` 不再生效（启动日志会说明，避免「改了没反应」的困惑）。
 */
export function importProfiles(profiles: readonly ApiProfile[]): number {
  if (profiles.length === 0 || countProfiles() > 0) return 0
  const now = Date.now()
  const noneActive = !profiles.some((p) => p.isActive)
  db.transaction((tx) => {
    profiles.forEach((profile, index) => {
      tx.insert(apiProfile)
        .values({
          id: profile.id, // 沿用 env 里的 id，避免用户已有的 curl / 笔记里的 id 失效
          name: profile.name,
          provider: profile.provider,
          baseUrl: profile.baseUrl,
          keyRef: profile.keyRef,
          modelMap: profile.modelMap,
          headers: profile.headers ?? null,
          isActive: profile.isActive || (noneActive && index === 0),
          sortOrder: index,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    })
  })
  return profiles.length
}
