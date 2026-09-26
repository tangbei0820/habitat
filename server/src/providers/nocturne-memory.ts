/**
 * Nocturne Memory 适配器：唯一通道是 ToolGateway → MCP，绝不调用其 REST CRUD。
 * Nocturne 的 MCP 返回是面向模型的文本；这里只抽取文本块，不绑定它的内部数据库结构。
 *
 * ⚠️ 2026-09-24 修正：工具名原先按**官方只读 Demo**（v1.26）写死为
 * `read_memory` / `search_memory` / `create_memory` / `update_memory` / `delete_memory`，
 * 而自部署实例是另一套工具面（`breath` / `hold` / `trace` / `wander` / `drive` / `undercurrent` …），
 * 五个名字**一个都不存在**（实测 0/5 命中）—— 也就是说这条链路从来没有真正跑通过，
 * 之前所有「本地 mock 全绿」验的都是 mock 自己。
 *
 * 现在工具名收进 `NOCTURNE_TOOLS` 一张表：实例换名字时只改这一处，并由
 * `verifyToolFace()` 在启动时自检。**换实例或升级后先跑工具面侦察**
 * （开发机 `npm run probe:nocturne-tools`；服务器上 `bash probe-nocturne-tools-quick.sh`），
 * 以实例实际返回的工具面为准 —— 不以文档为准，也不以 Demo 为准。
 */
import { ErrorCodes } from '@shared/errors.js'
import type {
  MemoryProvider,
  MemorySearchOptions,
  MemoryTextResult,
  MemoryWriteInput,
  ToolGateway,
} from '@shared/providers.js'
import { GatewayError } from '../mcp/gateway.js'

interface McpTextBlock { type: 'text'; text: string }

/**
 * 适配层用到的实例工具名（**唯一映射表**）。
 * 对照依据与实测输出见 `docs/MEMORY.md`「自部署实例的工具面」。
 *
 * 注意实例还有一批我们尚未接入的能力（`wander` 抽屉漫游、`wander_mark` 认/不认/悬置、
 * `drive` 九维驱动、`undercurrent` 情绪天气、`trail_delta` / `trail_family` 轨迹家族）——
 * 那些属于产品设计，等真有产品需要时再谈，不要在这里顺手加。
 * （`hold` 写工具已于 Phase 7C 记忆沉淀批接入，2026-09-26。）
 */
export const NOCTURNE_TOOLS = {
  /** 新窗 / Compact 后读取记忆。无参数。 */
  recall: 'breath',
  /** 按关键词搜索记忆。入参 `query`（必填）+ `limit`。 */
  search: 'trace',
  /** 写入长期沉淀。入参 `content`（必填）+ `kind` / `name` / `tags` 等（可选）。 */
  write: 'hold',
} as const

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

  async recall(): Promise<MemoryTextResult> {
    // `breath` 不接受参数。旧实现是 `read('system://boot')` —— 那个 URI 在实例上并不存在；
    // 而 `breath` 本身的设计意图（「新窗或者 Compact 后读取 Nocturne 记忆」）与 recall 的
    // 用途完全一致（组装主动行为的上下文时把长期记忆读进来），换过去反而更贴。
    return this.callText(NOCTURNE_TOOLS.recall, {})
  }

  async search(query: string, options: MemorySearchOptions = {}): Promise<MemoryTextResult> {
    // 实例的 `trace` 只认 query 与 limit。旧实现里那个 `domain` 参数在实例上没有对应
    // （实例用 `wander(mode=…)` 按抽屉翻阅，不是按 domain 过滤），已随之删除。
    const args: Record<string, unknown> = { query }
    if (options.limit !== undefined) args.limit = options.limit
    return this.callText(NOCTURNE_TOOLS.search, args)
  }

  async write(input: MemoryWriteInput): Promise<MemoryTextResult> {
    // 实例的 `hold`：content 必填，kind / name / tags / importance / pinned / protected / drive …
    // 全是可选。适配层只透传 `MemoryWriteInput` 里声明过的四项 —— `pinned` / `protected`
    // 会锁重要度分，`drive` / `chord` 是实例自己的九维设计，模型不该碰（见接口注释）。
    const args: Record<string, unknown> = { content: input.content }
    if (input.kind !== undefined) args.kind = input.kind
    if (input.name !== undefined && input.name !== '') args.name = input.name
    if (input.tags !== undefined && input.tags !== '') args.tags = input.tags
    return this.callText(NOCTURNE_TOOLS.write, args)
  }

  async verifyToolFace(): Promise<string[]> {
    let listed: unknown[]
    try {
      listed = await this.gateway.listTools(this.serverId)
    } catch {
      // 实例未配置 / 连不上：那是健康检查的活，这里静默返回，免得同一件事报两遍。
      return []
    }
    const available = new Set<string>()
    for (const entry of listed) {
      if (!isRecord(entry) || !Array.isArray(entry.tools)) continue
      for (const tool of entry.tools) {
        if (isRecord(tool) && typeof tool.name === 'string') available.add(tool.name)
      }
    }
    // 一个工具都没列出来，说明不是「实例缺工具」而是没能问出工具面 —— 不下结论。
    if (available.size === 0) return []
    return Object.values(NOCTURNE_TOOLS).filter((name) => !available.has(name))
  }

  private async callText(name: string, args: Record<string, unknown>): Promise<MemoryTextResult> {
    const raw = await this.gateway.callTool(this.serverId, name, args)
    return { text: textFromToolResult(raw) }
  }
}
