/**
 * Nocturne Memory 适配器：唯一通道是 ToolGateway → MCP，绝不调用其 REST CRUD。
 * Nocturne 的 MCP 返回是面向模型的文本；这里只抽取文本块，不绑定它的内部数据库结构。
 */
import { ErrorCodes } from '@shared/errors.js'
import type {
  MemoryCreateInput,
  MemoryProvider,
  MemorySearchOptions,
  MemoryTextResult,
  MemoryUpdateInput,
  ToolGateway,
} from '@shared/providers.js'
import { GatewayError } from '../mcp/gateway.js'

interface McpTextBlock { type: 'text'; text: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function textFromToolResult(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    throw new GatewayError(ErrorCodes.McpToolCallFailed, 'Nocturne 返回了无法识别的 MCP 结果')
  }
  const blocks = value.content.filter(
    (block): block is McpTextBlock => isRecord(block) && block.type === 'text' && typeof block.text === 'string',
  )
  const text = blocks.map((block) => block.text).join('\n').trim()
  if (value.isError === true || text.startsWith('Error:')) {
    throw new GatewayError(ErrorCodes.McpToolCallFailed, text === '' ? 'Nocturne 工具调用失败' : text)
  }
  if (text === '') throw new GatewayError(ErrorCodes.McpToolCallFailed, 'Nocturne 没有返回文本内容')
  return text
}

export class NocturneMemoryProvider implements MemoryProvider {
  constructor(
    private readonly gateway: ToolGateway,
    private readonly serverId = 'nocturne',
  ) {}

  async search(query: string, options: MemorySearchOptions = {}): Promise<MemoryTextResult> {
    const args: Record<string, unknown> = { query }
    if (options.domain !== undefined) args.domain = options.domain
    if (options.limit !== undefined) args.limit = options.limit
    return this.callText('search_memory', args)
  }

  async recall(): Promise<MemoryTextResult> {
    return this.read('system://boot')
  }

  async read(uri: string): Promise<MemoryTextResult> {
    return this.callText('read_memory', { uri })
  }

  async create(input: MemoryCreateInput): Promise<MemoryTextResult> {
    const args: Record<string, unknown> = {
      parent_uri: input.parentUri,
      content: input.content,
      priority: input.priority,
      disclosure: input.disclosure,
    }
    if (input.title !== undefined) args.title = input.title
    return this.callText('create_memory', args)
  }

  async update(input: MemoryUpdateInput): Promise<MemoryTextResult> {
    // Nocturne 明确要求更新前先读全文；在适配层强制执行，避免任一调用方漏掉。
    await this.read(input.uri)
    const args: Record<string, unknown> = { uri: input.uri }
    if (input.oldString !== undefined) args.old_string = input.oldString
    if (input.newString !== undefined) args.new_string = input.newString
    if (input.append !== undefined) args.append = input.append
    if (input.priority !== undefined) args.priority = input.priority
    if (input.disclosure !== undefined) args.disclosure = input.disclosure
    return this.callText('update_memory', args)
  }

  async delete(uri: string): Promise<MemoryTextResult> {
    // 删除同样遵守 Nocturne 的 read-before-delete 前置条件。
    await this.read(uri)
    return this.callText('delete_memory', { uri })
  }

  private async callText(name: string, args: Record<string, unknown>): Promise<MemoryTextResult> {
    const raw = await this.gateway.callTool(this.serverId, name, args)
    return { text: textFromToolResult(raw) }
  }
}
