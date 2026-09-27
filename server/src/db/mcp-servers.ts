/** MCP Manager 的服务端仓储：连接配置与 token 分表，列表永不读出 token。 */
import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { McpServerCreateInput, McpServerUpdateInput } from '@shared/types'
import { db } from './index.js'
import { mcpServer, mcpServerSecret, type McpServerRow } from './schema.js'
import type { McpServerConfig } from '../mcp/registry.js'

export interface McpServerRecord {
  row: McpServerRow
  hasToken: boolean
}

export interface McpSeedConfig extends McpServerConfig {
  name: string
}

function toRecord(row: McpServerRow): McpServerRecord {
  const secret = db.select({ serverId: mcpServerSecret.serverId }).from(mcpServerSecret)
    .where(eq(mcpServerSecret.serverId, row.id)).get()
  return { row, hasToken: secret !== undefined }
}

export function listMcpServers(): McpServerRecord[] {
  return db.select().from(mcpServer).orderBy(asc(mcpServer.createdAt), asc(mcpServer.id)).all().map(toRecord)
}

export function getMcpServer(id: string): McpServerRecord | null {
  const row = db.select().from(mcpServer).where(eq(mcpServer.id, id)).get()
  return row === undefined ? null : toRecord(row)
}

export function getMcpServerConfig(id: string): McpServerConfig | null {
  const record = getMcpServer(id)
  if (record === null) return null
  const secret = db.select().from(mcpServerSecret).where(eq(mcpServerSecret.serverId, id)).get()
  return {
    id: record.row.id,
    name: record.row.name,
    url: record.row.url,
    token: secret?.token ?? null,
    ...(record.row.headers === null || record.row.headers === undefined ? {} : { headers: record.row.headers }),
    enabled: record.row.enabled,
    allowAutonomous: record.row.allowAutonomous,
  }
}

export function listMcpServerConfigs(): McpServerConfig[] {
  return listMcpServers().map(({ row }) => {
    const secret = db.select().from(mcpServerSecret).where(eq(mcpServerSecret.serverId, row.id)).get()
    return {
      id: row.id,
      name: row.name,
      url: row.url === '' ? null : row.url,
      token: secret?.token ?? null,
      ...(row.headers === null || row.headers === undefined ? {} : { headers: row.headers }),
      enabled: row.enabled,
      allowAutonomous: row.allowAutonomous,
    }
  })
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^\p{Script=Han}a-z0-9]+/gu, '-').replace(/^-+|-+$/g, '')
  return slug === '' ? `mcp-${randomUUID().slice(0, 8)}` : slug
}

function uniqueId(name: string): string {
  const base = slugify(name)
  let id = base
  let suffix = 1
  while (db.select({ id: mcpServer.id }).from(mcpServer).where(eq(mcpServer.id, id)).get() !== undefined) {
    suffix += 1
    id = `${base}-${suffix}`
  }
  return id
}

export function seedMcpServers(seeds: readonly McpSeedConfig[]): number {
  let inserted = 0
  for (const seed of seeds) {
    if (getMcpServer(seed.id) !== null) continue
    const now = Date.now()
    db.transaction((tx) => {
      tx.insert(mcpServer).values({
        id: seed.id,
        name: seed.name,
        url: seed.url ?? '',
        headers: seed.headers ?? null,
        enabled: seed.enabled,
        allowAutonomous: seed.allowAutonomous,
        createdAt: now,
        updatedAt: now,
      }).run()
      if (seed.token !== null && seed.token !== '') {
        tx.insert(mcpServerSecret).values({ serverId: seed.id, token: seed.token, updatedAt: now }).run()
      }
    })
    inserted += 1
  }
  return inserted
}

export function createMcpServer(input: McpServerCreateInput & { id?: string }): McpServerRecord {
  const id = input.id ?? uniqueId(input.name)
  if (getMcpServer(id) !== null) throw new Error(`MCP server '${id}' 已存在`)
  const now = Date.now()
  db.transaction((tx) => {
    tx.insert(mcpServer).values({
      id,
      name: input.name,
      url: input.url,
      headers: input.headers ?? null,
      // 新注册的外部 server 默认不握手，避免填错地址时保存动作长时间阻塞。
      enabled: input.enabled ?? false,
      allowAutonomous: input.allowAutonomous ?? false,
      createdAt: now,
      updatedAt: now,
    }).run()
    if (input.token !== undefined && input.token !== '') {
      tx.insert(mcpServerSecret).values({ serverId: id, token: input.token, updatedAt: now }).run()
    }
  })
  const created = getMcpServer(id)
  if (created === null) throw new Error(`MCP server '${id}' 创建后读回失败`)
  return created
}

export function updateMcpServer(id: string, patch: McpServerUpdateInput): McpServerRecord {
  const current = getMcpServer(id)
  if (current === null) throw new Error(`MCP server '${id}' 不存在`)
  const values: Partial<typeof mcpServer.$inferInsert> = { updatedAt: Date.now() }
  if (patch.name !== undefined) values.name = patch.name
  if (patch.url !== undefined) values.url = patch.url
  if (patch.headers !== undefined) values.headers = Object.keys(patch.headers).length > 0 ? patch.headers : null
  if (patch.enabled !== undefined) values.enabled = patch.enabled
  if (patch.allowAutonomous !== undefined) values.allowAutonomous = patch.allowAutonomous
  db.transaction((tx) => {
    tx.update(mcpServer).set(values).where(eq(mcpServer.id, id)).run()
    if (patch.clearToken === true) tx.delete(mcpServerSecret).where(eq(mcpServerSecret.serverId, id)).run()
    if (patch.token !== undefined && patch.token !== '') {
      tx.insert(mcpServerSecret).values({ serverId: id, token: patch.token, updatedAt: Date.now() })
        .onConflictDoUpdate({ target: mcpServerSecret.serverId, set: { token: patch.token, updatedAt: Date.now() } }).run()
    }
  })
  const updated = getMcpServer(id)
  if (updated === null) throw new Error(`MCP server '${id}' 更新后读回失败`)
  return updated
}

export function deleteMcpServer(id: string): boolean {
  if (getMcpServer(id) === null) return false
  db.transaction((tx) => {
    tx.delete(mcpServerSecret).where(eq(mcpServerSecret.serverId, id)).run()
    tx.delete(mcpServer).where(eq(mcpServer.id, id)).run()
  })
  return true
}
