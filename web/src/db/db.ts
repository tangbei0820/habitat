import Dexie, { type Table } from 'dexie'
import type { ChatMessage, ChatSession } from '@shared/types'

/**
 * 本地数据层（铁律5）：第一天就版本化迁移。
 * 后续结构变更一律新增 version(n+1).upgrade()，禁止改历史版本。
 *
 * v1：sessions / messages 基础索引
 * v2：messages 补 `[sessionId+createdAt]` 复合索引 —— 长会话要按时间分页拉取（§9 风险8），
 *     只靠 `sessionId` 单键索引取回来后还得在内存里排序，消息上万条时每次进页面都白排一遍。
 */
export class HabitatDb extends Dexie {
  sessions!: Table<ChatSession, string>
  messages!: Table<ChatMessage, string>

  constructor() {
    super('habitat-db')
    this.version(1).stores({
      sessions: 'id, updatedAt, pinnedAt, archivedAt',
      messages: 'id, sessionId, createdAt',
    })
    // 只加索引、不改字段，Dexie 会自动为既有数据重建索引，无需 upgrade 回调
    this.version(2).stores({
      sessions: 'id, updatedAt, pinnedAt, archivedAt',
      messages: 'id, sessionId, createdAt, [sessionId+createdAt]',
    })
  }
}

export const db = new HabitatDb()

/** 水合失败必须拦截用户（float-phone 教训），由启动流程调用并捕获 */
export async function hydrateDb(): Promise<void> {
  await db.open()
}
