import Dexie, { type Table } from 'dexie'
import type { ChatMessage, ChatSession } from '@shared/types'

/**
 * 本地数据层（铁律5）：第一天就版本化迁移。
 * Phase 0 建 v1；后续结构变更一律新增 version(n+1).upgrade()，禁止改历史版本。
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
  }
}

export const db = new HabitatDb()

/** 水合失败必须拦截用户（float-phone 教训），由启动流程调用并捕获 */
export async function hydrateDb(): Promise<void> {
  await db.open()
}
