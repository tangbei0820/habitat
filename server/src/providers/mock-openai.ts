/**
 * 开发用 mock「OpenAI 兼容」上游（技术方案 §9 风险1 的同款思路：先验客户端代码，再排真实链路）。
 *
 * 零额外运行时依赖：node:http。独立进程 `npm run dev:mock-openai`，默认 :3334。
 * 覆盖三条真实世界最常见的分支：
 * - 无 `Authorization` → 401（验证 ProviderUnauthorized 的映射）
 * - `stream: true` → 逐块 SSE（验证增量解析、思维链、usage、[DONE] 收口）
 * - **`[[tool]]` 标记 → 下发 tool_calls**（Phase 6.5：验证工具调用闭环与协议一致性）
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

const MODELS = ['mock-chat-small', 'mock-chat-pro', 'mock-tts', 'mock-transcription', 'mock-vision', 'mock-image', 'mock-embedding']
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const SILENT_WAV = Buffer.from('UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=', 'base64')

/** 回复正文，故意切成多块发送，用来验证增量拼接 */
const REPLY_PIECES = ['收到，', '这是来自 ', 'mock 上游的 ', '流式回复。', '\n链路正常。']
/** 思维链增量（验证 reasoning_content → reasoning 的映射） */
const REASONING_PIECES = ['先看看用户说了什么', '，然后组织一句简短的回复']
/** 每块之间的间隔，用来验证空闲超时不会误伤正常流 */
const CHUNK_INTERVAL_MS = 60
/** 把 SSE 分片到「一个事件可能跨 TCP 分片」的程度，验证解析器不依赖整包 */
const WRITE_SPLIT = 3

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 最近一次 `/v1/chat/completions` 的请求体。
 *
 * 存在理由是「客户端到底发了什么」没法从响应侧推断 —— 例如 `stream_options`
 * 究竟有没有按方案的开关带上去。验收脚本读 `GET /__last-body` 断言真实报文，
 * 比断言「请求成功」强得多（后者在开 / 关两种模式下都会通过）。
 */
let lastChatBody: unknown = null

/**
 * 后台决策的脚本队列（Phase 7B 验收钩子）。
 *
 * 唤醒决策 / Surf 选题 / Surf 记录这三类后台调用的内容由探针经 `POST /__script`
 * 预先排队，mock 每收到对应块名的调用就 `shift` 一个出来 ——
 * 这样探针可以精确控制「这轮决策做什么」而不用碰 prompt。
 */
const script: { wake: string[]; surfSelect: string[]; surfRecord: string[] } = {
  wake: [],
  surfSelect: [],
  surfRecord: [],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function openAiError(status: number, message: string): {
  error: { message: string; type: string; code: number }
} {
  return { error: { message, type: 'invalid_request_error', code: status } }
}

/** 原样写一帧 SSE，并故意拆成几个 TCP 分片，验证解析器不依赖「一次收到完整事件」 */
async function sendRaw(res: ServerResponse, frame: string): Promise<void> {
  for (let i = 0; i < frame.length; i += WRITE_SPLIT) {
    res.write(frame.slice(i, i + WRITE_SPLIT))
    await sleep(1)
  }
  await sleep(CHUNK_INTERVAL_MS)
}

async function sendEvent(res: ServerResponse, payload: unknown): Promise<void> {
  await sendRaw(res, `data: ${JSON.stringify(payload)}\n\n`)
}

async function handleStream(
  res: ServerResponse,
  model: string,
  replyPieces: string[] = REPLY_PIECES,
  reasoningPieces: string[] = REASONING_PIECES,
): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    // 反代场景下禁止缓冲（§9 风险2 的同款处理）
    'x-accel-buffering': 'no',
  })

  for (const piece of reasoningPieces) {
    await sendEvent(res, { choices: [{ index: 0, delta: { reasoning_content: piece }, finish_reason: null }] })
  }
  for (const piece of replyPieces) {
    await sendEvent(res, { choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })
  }
  // 末包把 finish_reason 与 usage 塞在一起（DeepSeek 就是这么发的，顺便验证顺序保证）
  await sendEvent(res, {
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 11, completion_tokens: 13, total_tokens: 24 },
    model,
  })
  await sendRaw(res, 'data: [DONE]\n\n')
  res.end()
}

/* ---------------------------------------------------------------- 工具调用场景（Phase 6.5） */

/**
 * 触发标记：`[[tool]]` 调清单里的第一个工具，`[[tool:名字]]` 指定工具，
 * `[[tool:名字 {"k":"v"}]]` 还能**带上参数**（Phase 6.5 P1 起）。
 *
 * 为什么要带参数：写类工具（写日记 / 写留言）全都要参数，而它们在 P1 之前不可调用 ——
 * 不能带参数的 mock 等于「永远验不了写类工具」。参数是单层 JSON 对象，够用即可。
 *
 * 之所以要**显式标记**而不是「只要有 tools 就调」：Phase 6.5 起每轮聊天都会带上
 * tools 参数，若按后者实现，所有既有验收脚本（期望普通文本回复）都会被带偏。
 */
const TOOL_MARKER = /\[\[tool(?::([A-Za-z_][A-Za-z0-9_]*))?(?:\s+(\{[^}]*\}))?\]\]/

interface ToolScenario {
  name: string
  args: Record<string, unknown>
}

function messagesOf(body: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(body.messages) ? body.messages.filter(isRecord) : []
}

function toolScenario(body: Record<string, unknown>): ToolScenario | null {
  const tools = Array.isArray(body.tools) ? body.tools.filter(isRecord) : []
  if (tools.length === 0) return null
  const messages = messagesOf(body)
  // 已经出现过工具结果 = 这是**续跑轮**，必须收口，否则会无限循环调工具
  if (messages.some((message) => message.role === 'tool')) return null
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')
  const text = typeof lastUser?.content === 'string' ? lastUser.content : ''
  const match = TOOL_MARKER.exec(text)
  if (match === null) return null

  const first = tools[0]
  const fn = first !== undefined && isRecord(first.function) ? first.function : {}
  const fallback = typeof fn.name === 'string' ? fn.name : ''
  const name = match[1] ?? fallback
  if (name === '') return null
  // 参数优先取标记里显式给定的 JSON。解析不了就发空对象 —— 那也是一种要覆盖的路：
  // 服务端拿到空参数会以 ok:false 回灌，模型据此知道该怎么改。
  let args: Record<string, unknown> = {}
  const rawArgs = match[2]
  if (rawArgs !== undefined) {
    try {
      const parsed: unknown = JSON.parse(rawArgs)
      if (isRecord(parsed)) args = parsed
    } catch {
      args = {}
    }
  } else if (name === 'memory_search') {
    args = { query: '北北' }
  }
  return { name, args }
}

/**
 * 续跑轮的回复：**引用工具返回的内容**。
 *
 * 这是「AI 知道刚刚发生了工具调用」这条验收的可观测证据 ——
 * 若服务端没把 tool 结果回灌进上下文，这里读到的就是空，回复会退化成占位文案。
 */
function toolFollowUpReply(body: Record<string, unknown>): string[] | null {
  const toolMessages = messagesOf(body).filter((message) => message.role === 'tool')
  if (toolMessages.length === 0) return null
  const last = toolMessages[toolMessages.length - 1]
  const content = last !== undefined && typeof last.content === 'string' ? last.content : ''
  const failed = content.includes('执行失败') || content.includes('未执行')
  return [
    `（mock 续跑）我看到了工具返回：${content.slice(0, 60).replace(/\s+/g, ' ')}`,
    failed ? '，这次没成功，我换个办法。' : '，我用它来回答你。',
  ]
}

function backgroundReply(body: Record<string, unknown>): string[] | null {
  const messages = messagesOf(body)
  const names = messages.map((message) => (typeof message.name === 'string' ? message.name : ''))
  if (messages.some((message) => message.role === 'system' && typeof message.content === 'string' && message.content.includes('会话摘要器'))) {
    return ['用户喜欢雨天散步；小栖已记住这一偏好，后续可继续围绕共同散步与天气展开。']
  }
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')
  const lastUserText = typeof lastUser?.content === 'string' ? lastUser.content : ''
  if (lastUserText.includes('学习主题：')) {
    return [JSON.stringify({ cards: [
      { front: 'hello', back: '你好；用于打招呼', example: 'Hello, nice to meet you.', hint: '想象见面时先说 hello。' },
      { front: 'kind', back: '友善的；体贴的', example: 'It is kind of you to help.', hint: 'kind 和 kindness 都与善意有关。' },
      { front: 'practice', back: '练习；实践', example: 'Practice makes progress.', hint: '把 practice 想成反复做来变熟。' },
    ] })]
  }
  if (names.includes('eventide_settlement')) {
    return [JSON.stringify({
      settlement_reason: 'mock 结算：本轮为普通延续。',
      settlement_result: 'continued',
      ejaculated: false,
      heat_delta: 1,
      pressure_delta: 0,
      control_delta: 0,
      sensitivity_delta: 1,
      reserve_delta: 1,
      possessiveness_delta: 0,
      fatigue_delta: 0,
    })]
  }
  if (names.includes('eventide_dream')) {
    return [JSON.stringify({ content: '梦里有一盏一直亮着的小灯，醒来时心情很柔软。', after_effect_tags: ['tender'] })]
  }
  // Phase 7B 后台决策：从脚本队列取下一个响应（probe-decision-contract 用），
  // 队列空时给安全默认值 —— 唤醒默认发一条消息（与 Phase 3B 唤醒语义一致，
  // probe-phase3b 的「通知持久化 / 未回复上限」依赖它），Surf 默认选第一篇。
  if (names.includes('proactive_wake_decision')) {
    return [script.wake.length > 0
      ? (script.wake.shift() as string)
      : JSON.stringify({ actions: [{ type: 'message', content: '刚刚想起你，今天过得还好吗？' }] })]
  }
  if (names.includes('surf_select')) {
    return [script.surfSelect.length > 0 ? (script.surfSelect.shift() as string) : '{"idx":0,"why":"mock 默认选第一篇"}']
  }
  if (names.includes('surf_record')) {
    return script.surfRecord.length > 0
      ? [script.surfRecord.shift() as string]
      : ['mock 默认记录：我把这篇文章的要点记下来了。']
  }
  // 兼容 Phase 3B/6.5 的旧探针（probe-automation 等）仍用旧块名
  if (names.includes('proactive_wake')) return ['刚刚想起你，', '今天过得还好吗？']
  if (names.includes('solitude_reflection')) return ['我安静地整理了一下今天的感受，', '把想记住的温柔片段放在心里。']
  return null
}

function publicThoughtReply(body: Record<string, unknown>): string[] | null {
  const messages = messagesOf(body)
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')
  const text = typeof lastUser?.content === 'string' ? lastUser.content : ''
  if (!text.includes('公开思绪验收')) return null
  return ['[[思考：我注意到这是一轮公开思绪验收。]]', '这是公开思绪协议的正文。']
}

/**
 * 协议一致性校验：`role='tool'` 消息必须**紧跟**在带 `tool_calls` 的 assistant 消息之后，
 * 且自身带 `tool_call_id`。
 *
 * 真实上游（OpenAI / DeepSeek）对这条是硬性 400。mock 也照做 ——
 * 一个只在真上游才炸的协议缺陷，本地放过等于没有验收（§9 风险1 的同款思路：
 * 客户端代码必须在**会拒绝你的**上游面前验过）。
 */
function protocolViolation(messages: Record<string, unknown>[]): string | null {
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message === undefined || message.role !== 'tool') continue
    const previous = messages[index - 1]
    if (
      previous === undefined ||
      previous.role !== 'assistant' ||
      !Array.isArray(previous.tool_calls) ||
      previous.tool_calls.length === 0
    ) {
      return `messages[${index}] 是 tool 消息，但它前面不是带 tool_calls 的 assistant 消息`
    }
    if (typeof message.tool_call_id !== 'string' || message.tool_call_id === '') {
      return `messages[${index}] 缺少 tool_call_id`
    }
  }
  return null
}

/** 逐块下发一次 `tool_calls`：先给 id 与 name，再把参数切碎分片发（模拟真实上游） */
async function handleToolCallStream(res: ServerResponse, model: string, scenario: ToolScenario): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })

  await sendEvent(res, { choices: [{ index: 0, delta: { content: '我先查一下。' }, finish_reason: null }] })
  await sendEvent(res, {
    choices: [
      {
        index: 0,
        delta: { tool_calls: [{ index: 0, id: 'call_mock_1', type: 'function', function: { name: scenario.name, arguments: '' } }] },
        finish_reason: null,
      },
    ],
  })
  // 参数故意切成三段，且切点落在 JSON 中间（`{"qu` / `ery":` / `"北北"}`）——
  // 调用方若在分片中途就尝试解析，这里必炸
  const serialized = JSON.stringify(scenario.args)
  const third = Math.max(1, Math.ceil(serialized.length / 3))
  for (let i = 0; i < serialized.length; i += third) {
    await sendEvent(res, {
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: serialized.slice(i, i + third) } }] },
          finish_reason: null,
        },
      ],
    })
  }
  await sendEvent(res, {
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 21, completion_tokens: 7, total_tokens: 28 },
    model,
  })
  await sendRaw(res, 'data: [DONE]\n\n')
  res.end()
}


const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    console.log('[mock-openai]', req.method, url.pathname, 'auth:', req.headers.authorization ?? '(none)')

    // 调试钩子（故意放在鉴权之前）：只回本进程内存里的快照，不代理任何东西，验收脚本用
    if (req.method === 'GET' && url.pathname === '/__last-body') {
      writeJson(res, 200, { body: lastChatBody })
      return
    }

    // Phase 7B 验收钩子：排后台决策的脚本（只改本进程内存，不代理任何东西）
    if (req.method === 'POST' && url.pathname === '/__script') {
      const raw = await readBody(req)
      try {
        const body: unknown = JSON.parse(raw)
        if (isRecord(body)) {
          if (Array.isArray(body.wake)) script.wake.push(...body.wake.filter((item): item is string => typeof item === 'string'))
          if (Array.isArray(body.surfSelect)) script.surfSelect.push(...body.surfSelect.filter((item): item is string => typeof item === 'string'))
          if (Array.isArray(body.surfRecord)) script.surfRecord.push(...body.surfRecord.filter((item): item is string => typeof item === 'string'))
        }
        writeJson(res, 200, { ok: true, queued: { wake: script.wake.length, surfSelect: script.surfSelect.length, surfRecord: script.surfRecord.length } })
      } catch {
        writeJson(res, 400, openAiError(400, 'invalid JSON body'))
      }
      return
    }

    const auth = req.headers.authorization
    if (auth === undefined || auth.trim() === '') {
      writeJson(res, 401, openAiError(401, 'missing or invalid api key'))
      return
    }

    if (req.method === 'GET' && url.pathname === '/v1/models') {
      writeJson(res, 200, {
        object: 'list',
        data: MODELS.map((id) => ({ id, object: 'model', owned_by: 'mock' })),
      })
      return
    }

    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const raw = await readBody(req)
      let body: unknown
      try {
        body = JSON.parse(raw)
      } catch {
        writeJson(res, 400, openAiError(400, 'invalid JSON body'))
        return
      }
      const record = isRecord(body) ? body : {}
      // 记下真实报文，供验收脚本用 GET /__last-body 断言客户端发了什么
      lastChatBody = record
      const model = typeof record.model === 'string' ? record.model : 'mock-chat-small'

      // 协议一致性：tool 消息前必须有带 tool_calls 的 assistant（真实上游会 400，这里也照做）
      const violation = protocolViolation(messagesOf(record))
      if (violation !== null) {
        writeJson(res, 400, openAiError(400, violation))
        return
      }

      if (record.stream === true) {
        const scenario = toolScenario(record)
        if (scenario !== null) {
          await handleToolCallStream(res, model, scenario)
          return
        }
        // 续跑轮（上下文里已有工具结果）优先于后台任务分支：两者不会同时出现
        const followUp = toolFollowUpReply(record)
        if (followUp !== null) {
          await handleStream(res, model, followUp, [])
          return
        }
        const background = backgroundReply(record)
        const publicThought = publicThoughtReply(record)
        await handleStream(
          res,
          model,
          publicThought ?? background ?? REPLY_PIECES,
          publicThought === null && background === null ? REASONING_PIECES : [],
        )
        return
      }
      const isVision = Array.isArray(record.messages) && record.messages.some((message) =>
        isRecord(message) && Array.isArray(message.content) && message.content.some((part) => isRecord(part) && part.type === 'image_url'))
      writeJson(res, 200, {
        id: 'mock-cmpl',
        object: 'chat.completion',
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: isVision ? '一张用于验收的图片' : REPLY_PIECES.join('') },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 13, total_tokens: 24 },
      })
      return
    }

    if (req.method === 'POST' && url.pathname === '/v1/audio/transcriptions') {
      await readBody(req)
      writeJson(res, 200, { text: '这是 mock 转写文本。' })
      return
    }

    if (req.method === 'POST' && url.pathname === '/v1/audio/speech') {
      await readBody(req)
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': SILENT_WAV.byteLength })
      res.end(SILENT_WAV)
      return
    }

    if (req.method === 'POST' && url.pathname === '/v1/images/generations') {
      await readBody(req)
      writeJson(res, 200, { data: [{ b64_json: ONE_PIXEL_PNG }] })
      return
    }

    writeJson(res, 404, openAiError(404, `unknown path ${url.pathname}`))
  })().catch((err: unknown) => {
    console.error('[mock-openai] request failed', err)
    if (!res.headersSent) writeJson(res, 500, openAiError(500, String(err)))
  })
})

const port = Number(process.env.MOCK_OPENAI_PORT ?? 3334)
httpServer.listen(port, () => {
  console.log(`[mock-openai] OpenAI 兼容上游已就绪：http://localhost:${port}/v1`)
})
