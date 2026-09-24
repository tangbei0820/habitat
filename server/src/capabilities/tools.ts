/**
 * Tool Binding —— 把能力注册表里的能力真正接成「AI 可以调的东西」（Phase 6.5 · P0-3）
 *
 * 三层分开，别混：
 *   1. `shared/capabilities.ts`  声明**有什么**能力、绑什么工具名（静态）
 *   2. `server/src/capabilities/registry.ts` 判断**现在能用哪几个**（运行时）
 *   3. 本文件   把「现在能用的」变成 **function definitions** 并**真的执行**
 *
 * 为什么工具名和 MCP 实例的工具名要分开（`memory_search` vs 实例的 `trace`）：
 * 见 `shared/capabilities.ts` 的 `CapabilityToolBinding` 注释 —— 换实例不该让 AI 有感知。
 *
 * ⚠️ 一次调用失败**不抛异常**，而是返回 `ok: false` 的 `ToolOutcome`：
 * 工具失败是**模型需要知道的信息**（它得决定重试还是换条路），不是要中断整轮的异常。
 * 抛出去只会让整轮回复变成一条错误，模型永远学不到「刚才那次没成功」。
 */
import type { CapabilityId, CapabilityModule, CapabilitySnapshot, CapabilityToolSchema } from '@shared/capabilities.js'
import { CAPABILITY_DEFINITIONS } from '@shared/capabilities.js'
import type { LlmToolCall, MemoryProvider, StateProvider } from '@shared/providers.js'
import { describeState } from '@shared/state-summary.js'
import type { CapabilityService } from './registry.js'

/** 一个绑定好的工具：从能力声明来，能被执行 */
export interface BoundTool {
  /** 内建工具名，会写进 function definition */
  name: string
  capabilityId: CapabilityId
  label: string
  /** 展示来源（卡片上「✅ Nocturne · 搜索记忆」的那个 Nocturne） */
  source: string
  description: string
  parameters: CapabilityToolSchema
}

/** 模块 → 展示来源。**唯一**的定义处，卡片与工具结果共用。 */
const MODULE_SOURCE: Readonly<Record<CapabilityModule, string>> = {
  memory: 'Nocturne',
  state: 'Eventide',
  diary: '日记',
  board: '留言板',
  tools: '系统',
}

/** 工具返回给模型 / 给用户看的统一形状 */
export interface ToolOutcome {
  ok: boolean
  /** 进 `role='tool'` 消息的正文 —— 给模型读的 */
  text: string
  /** 面向用户的一句话结果（卡片标题行） */
  summary: string
  /** 面向用户的可折叠详情；**必须已裁剪**，原始返回值不往界面送 */
  detail?: string
}

/** 工具正文进模型上下文的上限：记忆全文可能很长，但也不能无界 */
const TOOL_TEXT_LIMIT = 16_000
/** 卡片详情上限 —— 界面是给人扫一眼的，不是日志面板 */
const DETAIL_LIMIT = 600

/**
 * 由能力快照生成可用工具表。
 *
 * 只收 `enabled` 且真的绑了 `toolName` 的 —— 这一条就是「**不伪造能力**」在工具层的落点：
 * 声明里写着 `memory.search`，但实例没配时它 `enabled=false`，于是**根本不会**出现在
 * 传给模型的 tools 里。模型看不到它，就不可能去调一个不存在的东西。
 */
export function buildBoundTools(snapshot: readonly CapabilitySnapshot[]): BoundTool[] {
  const bound: BoundTool[] = []
  for (const item of snapshot) {
    if (!item.enabled || item.toolName === undefined) continue
    const definition = CAPABILITY_DEFINITIONS.find((candidate) => candidate.id === item.id)
    if (definition?.tool === undefined) continue
    // **只把「AI 可自主调用」的工具交给模型**。`confirm` / `user-only` 一律不绑：
    // 确认卡与逐次授权协议还没实现（P1），此时放给模型等于没有闸门。失败方向必须朝「关」。
    if (!isAutoCallable(item.autonomy)) continue
    bound.push({
      name: definition.tool.name,
      capabilityId: item.id,
      label: item.label,
      source: MODULE_SOURCE[item.module],
      description: definition.tool.description,
      parameters: definition.tool.parameters,
    })
  }
  return bound
}

/**
 * 目前只读能力会被绑成工具（写能力本阶段都 `unavailable`），所以 `confirm` 级别
 * 的工具表实际为空。确认卡协议落地后（P1），这里要多一层「未经确认不执行」的闸门 ——
 * 在那之前**绝不能**把 `confirm` 工具直接放给模型，那等于把 §9.7 要的授权协议跳过去了。
 */
export function isAutoCallable(autonomy: CapabilitySnapshot['autonomy']): boolean {
  return autonomy === 'autonomous'
}

/** 转成 OpenAI 兼容协议的 `tools` 参数 */
export function toLlmTools(tools: readonly BoundTool[]): unknown[] {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }))
}

/** 执行工具要用到的依赖。都可能是 null（未配置），那种情况下能力快照里就不会有它们。 */
export interface ToolRuntime {
  memory: MemoryProvider | null
  state: StateProvider | null
  capabilities: CapabilityService
}

type ParsedArgs = { ok: true; value: Record<string, unknown> } | { ok: false; error: string }

/**
 * 解析模型给的参数。
 *
 * 三重防御都必要：模型可能发空串、发数组、发一段被截断的 JSON。
 * 任何一条都不该把整轮对话炸掉 —— 返回失败让模型自己重来。
 */
function parseArgs(raw: string): ParsedArgs {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, value: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (err) {
    return { ok: false, error: `参数不是合法 JSON：${err instanceof Error ? err.message : String(err)}` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: `参数必须是 JSON 对象，收到 ${Array.isArray(parsed) ? '数组' : typeof parsed}` }
  }
  return { ok: true, value: parsed as Record<string, unknown> }
}

function failure(tool: BoundTool, message: string): ToolOutcome {
  // 对模型：说清哪次调用失败了，它才能自己决定下一步
  return {
    ok: false,
    text: `工具 ${tool.name} 执行失败：${message}`,
    summary: `${tool.label} 执行失败`,
    detail: clip(message, DETAIL_LIMIT),
  }
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…（已截断）`
}

/**
 * 执行一次工具调用。
 *
 * @param tool 由 `buildBoundTools` 产出 —— 传进来的工具一定已在能力快照里确认为可用。
 * @param call 上游给的调用（`arguments` 是 JSON 字符串）。
 */
export async function executeTool(tool: BoundTool, call: LlmToolCall, runtime: ToolRuntime): Promise<ToolOutcome> {
  const args = parseArgs(call.arguments)
  if (!args.ok) return failure(tool, args.error)
  const value = args.value

  try {
    switch (tool.capabilityId) {
      case 'memory.read': {
        if (runtime.memory === null) return failure(tool, '记忆链路当前不可用')
        const text = (await runtime.memory.recall()).text.trim()
        if (text === '') return { ok: true, text: '(记忆是空的)', summary: '记忆是空的' }
        return {
          ok: true,
          text: clip(text, TOOL_TEXT_LIMIT),
          summary: `已取回记忆（${text.length} 字）`,
        }
      }

      case 'memory.search': {
        if (runtime.memory === null) return failure(tool, '记忆链路当前不可用')
        const query = typeof value.query === 'string' ? value.query.trim() : ''
        if (query === '') return failure(tool, '缺少必填参数 query')
        const limit = normalizeLimit(value.limit)
        const text = (await runtime.memory.search(query, limit === undefined ? {} : { limit })).text.trim()
        if (text === '') return { ok: true, text: '(没有匹配的记忆)', summary: `没有找到与「${query}」相关的记忆` }
        return {
          ok: true,
          text: clip(text, TOOL_TEXT_LIMIT),
          summary: `按「${query}」检索到记忆`,
          detail: clip(text, DETAIL_LIMIT),
        }
      }

      case 'state.read': {
        if (runtime.state === null) return failure(tool, 'Eventide 未配置')
        const summary = describeState(runtime.state.current())
        return {
          ok: summary.available,
          text: summary.text,
          summary: summary.headline,
          detail: clip(summary.text, DETAIL_LIMIT),
        }
      }

      case 'tools.list': {
        // 自我认知能力：清单必须现取，不能缓存 —— 缓存会让 AI 拿着过期能力表说话
        const snapshot = await runtime.capabilities.snapshot()
        const lines = snapshot.map((item) => {
          const state = item.enabled ? `可用（${item.autonomy}）` : `不可用：${item.reason ?? '未知原因'}`
          return `- ${item.label}（${item.id}）：${state}`
        })
        const text = `# 当前能力清单\n\n${lines.join('\n')}`
        return { ok: true, text, summary: `已列出 ${snapshot.length} 项能力`, detail: clip(text, DETAIL_LIMIT) }
      }

      default:
        return failure(tool, '该能力尚未绑定执行逻辑')
    }
  } catch (err) {
    // MCP / sidecar 的故障在这里被降级成「一次失败的调用」，而不是整轮回复崩掉
    return failure(tool, err instanceof Error ? err.message : String(err))
  }
}

/** `limit` 参数兜底：非数字 / 越界一律忽略，交给记忆系统的默认值 */
function normalizeLimit(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const rounded = Math.round(raw)
  if (rounded < 1) return undefined
  return Math.min(rounded, 20)
}
