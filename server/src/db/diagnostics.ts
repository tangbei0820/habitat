import { db } from './index.js'
import { mcpDiagnosticLog, type NewMcpDiagnosticLog } from './schema.js'

/** 诊断中间件的唯一写入口：同步落一条 MCP 请求/响应记录（§7.2② 全量留痕） */
export function insertMcpDiagnostic(entry: NewMcpDiagnosticLog): void {
  db.insert(mcpDiagnosticLog).values(entry).run()
}
