/**
 * Solitude Surf 数据层（Phase 7B）。
 *
 * - 订阅源配置存 `app_kv`（就几个 URL，不值得一张表）；
 * - Surf 记录复用独处记录表（`solitude_entry`，metadata 里带 `kind: 'surf'` 与来源信息）
 *   —— 它本来就是「AI 私有的独处产物」， Surf 是独处的一种，不该另立门户；
 * - 去重键 = 规范化 URL 的指纹：近 14 天记过的不再选（朴素但诚实，
 *   「同话题不同文章」的去重留给后续批次，见 TASKS）。
 */
import { gt } from 'drizzle-orm'
import { db } from './index.js'
import { solitudeEntry } from './schema.js'
import { getKv, setKv } from './kv.js'
import { createSolitudeEntry, listSolitudeEntries } from './activity.js'

const FEEDS_KEY = 'surf.feeds'

/** 默认订阅源：国内可达、无需鉴权的公开 RSS。用户可整体替换。 */
export const DEFAULT_SURF_FEEDS: readonly string[] = [
  'https://sspai.com/feed',
  'https://36kr.com/feed',
]

const FEEDS_MAX = 10

export function getSurfFeeds(): string[] {
  const raw = getKv(FEEDS_KEY)
  if (raw === null) return [...DEFAULT_SURF_FEEDS]
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_SURF_FEEDS]
    return parsed.filter((item): item is string => typeof item === 'string' && /^https?:\/\//i.test(item))
  } catch {
    return [...DEFAULT_SURF_FEEDS]
  }
}

/** 覆盖订阅源；`null` = 恢复默认。非法条目直接拒（URL 必须是 http/https）。 */
export function setSurfFeeds(feeds: string[] | null): string[] {
  if (feeds === null) {
    setKv(FEEDS_KEY, JSON.stringify(DEFAULT_SURF_FEEDS))
    return [...DEFAULT_SURF_FEEDS]
  }
  const trimmed = [...new Set(feeds.map((item) => item.trim()))]
  if (trimmed.length < 1 || trimmed.length > FEEDS_MAX) {
    throw new Error(`订阅源需要 1..${FEEDS_MAX} 条`)
  }
  if (trimmed.some((item) => {
    try {
      const url = new URL(item)
      return url.protocol !== 'http:' && url.protocol !== 'https:'
    } catch {
      return true
    }
  })) {
    throw new Error('订阅源必须是合法的 http(s) URL')
  }
  setKv(FEEDS_KEY, JSON.stringify(trimmed))
  return trimmed
}

/** URL 指纹：去查询串里的常见跟踪参数、统一尾斜杠 —— 同一篇文章换跟踪参数不该记两次 */
export function fingerprintOf(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    const tracking = [...url.searchParams.keys()].filter((key) =>
      /^(utm_|spm|from|ref|share)/i.test(key) || /^(fbclid|gclid|igshid)$/i.test(key),
    )
    for (const key of tracking) url.searchParams.delete(key)
    url.hash = ''
    return `${url.host}${url.pathname.replace(/\/+$/, '')}${url.search}`
  } catch {
    return rawUrl
  }
}

export interface SurfRecordMetadata {
  kind: 'surf'
  url: string
  fingerprint: string
  title: string
  sourceFeed: string
  selectedWhy: string
  runId: string
}

/** 落一条 Surf 记录（AI 私有独处产物的一种，带完整来源） */
export function createSurfRecord(
  body: string,
  meta: Omit<SurfRecordMetadata, 'kind' | 'fingerprint'> & { fingerprint?: string },
  at = Date.now(),
): { id: string; fingerprint: string } {
  const fingerprint = meta.fingerprint ?? fingerprintOf(meta.url)
  const record = createSolitudeEntry(body, { ...meta, kind: 'surf', fingerprint }, at)
  return { id: record.id, fingerprint }
}

/** 近 `days` 天记过的 Surf 指纹 —— 选题时排除，避免反复分享同一篇 */
export function recentSurfFingerprints(days = 14): Set<string> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const fingerprints = new Set<string>()
  // 独处记录量很小（每天至多一条），全量过滤比 JSON SQL 查询便宜且可读
  for (const entry of listSolitudeEntries(200)) {
    if (entry.createdAt < cutoff) continue
    const meta = entry.metadata as Record<string, unknown>
    if (meta.kind === 'surf' && typeof meta.fingerprint === 'string') {
      fingerprints.add(meta.fingerprint)
    }
  }
  // listSolitudeEntries 有 limit，保险起见再按时间窗补一遍（两条路取并集，重复无妨）
  for (const row of db
    .select({ metadataJson: solitudeEntry.metadataJson })
    .from(solitudeEntry)
    .where(gt(solitudeEntry.createdAt, cutoff))
    .all()) {
    const meta = row.metadataJson as Record<string, unknown>
    if (meta?.kind === 'surf' && typeof meta.fingerprint === 'string') fingerprints.add(meta.fingerprint)
  }
  return fingerprints
}
