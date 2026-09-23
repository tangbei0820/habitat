/**
 * 进程级键值状态（`app_kv` 表）。
 *
 * 目前只有一个用途：记住「环境变量里的 LLM 方案已经导入过」。
 *
 * 为什么不能拿「`api_profile` 表是否为空」当判据：用户完全可能把方案全删光再重启 ——
 * 那时表是空的，env 种子就会**复活**，等于他白删了。判据必须是「导入过」这个事实本身，
 * 与表里现存多少条无关。
 */
import { eq } from 'drizzle-orm'
import { db } from './index.js'
import { appKv } from './schema.js'

export function getKv(key: string): string | null {
  const row = db.select().from(appKv).where(eq(appKv.key, key)).get()
  return row === undefined ? null : row.value
}

export function setKv(key: string, value: string): void {
  db.insert(appKv)
    .values({ key, value })
    .onConflictDoUpdate({ target: appKv.key, set: { value } })
    .run()
}

export function hasKv(key: string): boolean {
  return getKv(key) !== null
}
