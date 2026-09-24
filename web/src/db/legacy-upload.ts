/**
 * 一次性搬迁：把 v4/v5 时代还留在浏览器里的日记 / 留言板送到服务端。
 *
 * ⚠️ 为什么整套搬运在**启动期**、而不在 Dexie 的 `upgrade` 回调里 —— 两个原因：
 * ① `diaries` / `moments` 的**表壳删不掉**：Dexie 的 `stores()` 是跨版本累加的
 *    （源码里 `extend(storesSpec, version._cfg.storesSource)` 层层合并，删表也只认这份合并结果），
 *    所以「新版本不声明某张表」**≠** 删掉它。旧表会一直在，旧数据也就一直有。
 * ② upgrade 回调**一辈子只跑一次**：万一那次没搬干净（当时离线、浏览器中途关掉，
 *    或者跑的是还没写搬迁逻辑的旧构建），就再也没有第二次机会。
 *    放启动期则**每次启动都收敛** —— 表里还剩什么，就搬什么。
 *
 * 三轮，**顺序不可换**：
 * ① **收编**：旧表里还有的行，登记进中转表 `legacyUploads`（按 `kind:id` 去重，重复跑不产生副本）。
 * ② **上传**：把中转表整批发给服务端。服务端 `import` 端点对已存在 id 是「跳过」而不是「覆盖」，
 *    所以重复跑既不产生副本，也不会盖掉用户后来在服务端改过的内容。
 * ③ **清源**：**服务端确认收下之后**，才删中转行 + 从旧表里删掉那几行。
 *    不成功就不删源 —— 传一半就清，等于把用户的东西弄丢。
 *
 * 三条纪律：不成功就不删源 / 幂等 / 不阻塞启动（离线或后端没起会抛错，下次启动再试）。
 */
import { fetchJson } from '../lib/api'
import { db, type LegacyUpload } from './db'

export interface LegacyUploadResult {
  diaries: number
  moments: number
}

/**
 * 搬迁源。表名写成**字符串 + `db.table()`** 是刻意的：
 * 这两张表不在 v11 的 `stores()` 声明里（声明也没用，见模块注释），
 * 类型层面也不该有 `db.diaries` 这种「看起来还在用」的入口 —— 但它们运行时确实在（schema 累加），
 * 所以 `db.table('diaries')` 取得到。
 */
const SOURCES: ReadonlyArray<{ kind: LegacyUpload['kind']; table: string; path: string }> = [
  { kind: 'diary', table: 'diaries', path: '/api/diary/import' },
  { kind: 'moment', table: 'moments', path: '/api/moments/import' },
]

/** 表壳理论上一定在；真不在（手删过库）就当没有这一源，不抛。 */
function tableOf(name: string) {
  return db.tables.some((table) => table.name === name) ? db.table(name) : null
}

/** ① 收编：旧表里**还没登记**的行走一遍。已登记的不覆盖 —— 那行可能正在上传或在等服务端确认。 */
async function collectFromLegacyTables(): Promise<void> {
  const at = Date.now()
  for (const { kind, table } of SOURCES) {
    const store = tableOf(table)
    if (store === null) continue
    const rows = (await store.toArray()) as Array<{ id?: unknown }>
    for (const row of rows) {
      const id = typeof row.id === 'string' ? row.id : ''
      if (id === '') continue
      const key = `${kind}:${id}`
      if ((await db.legacyUploads.get(key)) !== undefined) continue
      await db.legacyUploads.put({ id: key, kind, payload: JSON.stringify(row), createdAt: at })
    }
  }
}

/**
 * 把待传数据送出去。表里没有待传数据时返回 `null`（绝大多数启动都是这个结果，不进网络）。
 *
 * 抛错是**预期内**的（断网、后端没起）：调用方负责吞掉并留个记录。
 */
export async function runLegacyUpload(): Promise<LegacyUploadResult | null> {
  await collectFromLegacyTables()
  const pending = await db.legacyUploads.toArray()
  if (pending.length === 0) return null

  const send = async (source: (typeof SOURCES)[number]): Promise<number> => {
    const rows = pending.filter((row) => row.kind === source.kind)
    if (rows.length === 0) return 0
    const result = await fetchJson<{ imported: number }>(source.path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: rows.map((row) => JSON.parse(row.payload) as unknown) }),
    })
    // ③ 服务端收下了，才动本地：先删登记，再从旧表删掉这几行。
    //    登记 id 带 `kind:` 前缀（否则两张表的同 id 行会互撞），删旧表时要剥回来。
    //    用「只删这一批」而不是「清空整张表」：万一旧表里混着登记不上的行（id 不是字符串），
    //    那行至少还看得见，不会被顺手抹掉。
    await db.legacyUploads.bulkDelete(rows.map((row) => row.id))
    const store = tableOf(source.table)
    if (store !== null) {
      await store.bulkDelete(rows.map((row) => row.id.slice(source.kind.length + 1)))
    }
    return result.imported
  }

  const result: LegacyUploadResult = { diaries: 0, moments: 0 }
  for (const source of SOURCES) {
    const imported = await send(source)
    if (source.kind === 'diary') result.diaries = imported
    else result.moments = imported
  }
  return result
}
