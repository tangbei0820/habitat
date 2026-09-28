/**
 * Codex Subscription Provider（实验性）。
 *
 * 只通过官方 app-server 的 stdio JSON-RPC 事件工作，不读取浏览器 Cookie，也不伪造
 * OpenAI API 凭据。app-server 尚未承诺生产稳定性，所以这个适配器必须显式配置命令，
 * 失败时给出可操作错误，而不是静默退回另一套 Agent Runtime。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import type { LLMProvider, LlmChatMessage, LlmStreamChunk, StreamChatOptions } from '@shared/providers.js'
import type { ApiProfile } from '@shared/types.js'
import { ErrorCodes } from '@shared/errors.js'
import { ProviderError } from './errors.js'

type Json = Record<string, unknown>
type Pending = { resolve: (value: Json) => void; reject: (error: Error) => void }

function asRecord(value: unknown): Json | null {
  return typeof value === 'object' && value !== null ? value as Json : null
}

function stringAt(value: unknown, ...keys: string[]): string | undefined {
  let current: unknown = value
  for (const key of keys) {
    const record = asRecord(current)
    if (record === null) return undefined
    current = record[key]
  }
  return typeof current === 'string' && current !== '' ? current : undefined
}

function commandParts(raw: string): { command: string; args: string[] } {
  const parts = raw.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) throw new ProviderError(ErrorCodes.ProviderUpstreamError, 'Codex app-server 命令为空')
  return { command: parts[0], args: parts.slice(1) }
}

/** 一个适配器实例只串行处理一个 turn，避免通知被两个 Habitat 请求相互消费。 */
export class CodexAppServerProvider implements LLMProvider {
  readonly profileId: string
  readonly defaultModel: string
  private child: ChildProcessWithoutNullStreams | null = null
  private lines: Interface | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private initialized: Promise<void> | null = null
  private readonly threads = new Map<string, string>()
  private activeQueue: { values: Json[]; waiters: Array<(value: Json | null) => void> } | null = null

  constructor(profile: ApiProfile) {
    this.profileId = profile.id
    this.defaultModel = profile.modelMap.chat ?? 'gpt-5'
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.child !== null && !this.child.killed) return this.child
    const raw = process.env.HABITAT_CODEX_APP_SERVER_COMMAND ?? 'codex app-server --stdio'
    const { command, args } = commandParts(raw)
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
    this.child = child
    this.lines = createInterface({ input: child.stdout })
    this.lines.on('line', (line) => this.handleLine(line))
    child.stderr.on('data', (chunk) => {
      // stderr 不进模型上下文；保留最近错误给 health / next request 使用即可。
      if (chunk.toString().trim() !== '') process.emitWarning(`Codex app-server: ${chunk.toString().trim()}`)
    })
    child.on('exit', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Codex app-server 已退出'))
      this.pending.clear()
      this.child = null
      this.lines?.close()
      this.lines = null
      this.initialized = null
      this.threads.clear()
      const queue = this.activeQueue
      if (queue !== null) {
        const waiter = queue.waiters.shift()
        if (waiter !== undefined) waiter(null)
      }
    })
    child.on('error', (error) => {
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
      const queue = this.activeQueue
      if (queue !== null) {
        const waiter = queue.waiters.shift()
        if (waiter !== undefined) waiter(null)
      }
    })
    return child
  }

  private handleLine(line: string): void {
    let parsed: unknown
    try { parsed = JSON.parse(line) } catch { return }
    const message = asRecord(parsed)
    if (message === null) return
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (pending === undefined) return
      this.pending.delete(message.id)
      if (message.error !== undefined) pending.reject(new Error(stringAt(message.error, 'message') ?? 'Codex app-server 请求失败'))
      else pending.resolve(message)
      return
    }
    const queue = this.activeQueue
    if (queue === null) return
    const waiter = queue.waiters.shift()
    if (waiter !== undefined) waiter(message)
    else queue.values.push(message)
  }

  private send(message: Json): void {
    const child = this.ensureProcess()
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private request(method: string, params: Json, timeoutMs = 30_000): Promise<Json> {
    const id = this.nextId++
    return new Promise<Json>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex app-server ${method} 超时`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  private async initialize(): Promise<void> {
    if (this.initialized !== null) return this.initialized
    this.initialized = (async () => {
      await this.request('initialize', {
        clientInfo: { name: 'habitat', title: 'Habitat', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      })
      this.send({ jsonrpc: '2.0', method: 'initialized', params: {} })
    })().catch((error) => {
      this.initialized = null
      throw new ProviderError(ErrorCodes.ProviderUpstreamError, `Codex app-server 不可用：${error instanceof Error ? error.message : String(error)}`)
    })
    return this.initialized
  }

  private async threadFor(conversationId: string): Promise<string> {
    const existing = this.threads.get(conversationId)
    if (existing !== undefined) return existing
    const result = await this.request('thread/start', {
      cwd: process.cwd(),
      approvalPolicy: 'never',
      sandbox: 'read-only',
    })
    const threadId = stringAt(result, 'result', 'thread', 'id') ?? stringAt(result, 'result', 'id')
    if (threadId === undefined) throw new ProviderError(ErrorCodes.ProviderUpstreamError, 'Codex app-server 未返回 thread id')
    this.threads.set(conversationId, threadId)
    return threadId
  }

  async *streamChat(messages: LlmChatMessage[], opts: StreamChatOptions = {}): AsyncIterable<LlmStreamChunk> {
    await this.initialize()
    const conversationId = opts.conversationId ?? '__default__'
    const threadId = await this.threadFor(conversationId)
    const input = messages.map((message) => `[${message.role}]\n${message.content}`).join('\n\n')
    const queue = { values: [] as Json[], waiters: [] as Array<(value: Json | null) => void> }
    this.activeQueue = queue
    const requestId = this.nextId++
    this.send({
      jsonrpc: '2.0',
      id: requestId,
      method: 'turn/start',
      params: { threadId, model: opts.model ?? this.defaultModel, input: [{ type: 'text', text: input }] },
    })
    let done = false
    try {
      while (!done) {
        const message = queue.values.shift() ?? await new Promise<Json | null>((resolve) => queue.waiters.push(resolve))
        if (message === null) throw new ProviderError(ErrorCodes.ProviderUpstreamError, 'Codex app-server 连接中断')
        const method = typeof message.method === 'string' ? message.method : ''
        const params = asRecord(message.params)
        const text = stringAt(params, 'delta') ?? stringAt(params, 'text') ?? stringAt(params, 'item', 'text') ?? stringAt(params, 'item', 'content')
        if (text !== undefined && (method.includes('agentMessage') || method.includes('delta') || method.includes('message'))) {
          yield { type: 'delta', delta: { content: text } }
        }
        if (method.includes('turn/completed') || method.includes('turn/failed') || method.includes('turn/cancelled')) {
          done = true
        }
      }
      yield { type: 'done', finishReason: 'stop' }
    } finally {
      if (this.activeQueue === queue) this.activeQueue = null
    }
  }

  async listModels(): Promise<string[]> {
    await this.initialize()
    const result = await this.request('model/list', {})
    const value = asRecord(result.result)?.data ?? asRecord(result.result)?.models
    if (!Array.isArray(value)) return []
    return value.flatMap((item) => {
      if (typeof item === 'string') return [item]
      const id = stringAt(item, 'id')
      return id === undefined ? [] : [id]
    })
  }
}
