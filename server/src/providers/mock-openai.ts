/**
 * 开发用 mock「OpenAI 兼容」上游（技术方案 §9 风险1 的同款思路：先验客户端代码，再排真实链路）。
 *
 * 零额外运行时依赖：node:http。独立进程 `npm run dev:mock-openai`，默认 :3334。
 * 覆盖两条真实世界最常见的分支：
 * - 无 `Authorization` → 401（验证 ProviderUnauthorized 的映射）
 * - `stream: true` → 逐块 SSE（验证增量解析、思维链、usage、[DONE] 收口）
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

const MODELS = ['mock-chat-small', 'mock-chat-pro', 'mock-embedding']

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

async function handleStream(res: ServerResponse, model: string): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    // 反代场景下禁止缓冲（§9 风险2 的同款处理）
    'x-accel-buffering': 'no',
  })

  for (const piece of REASONING_PIECES) {
    await sendEvent(res, { choices: [{ index: 0, delta: { reasoning_content: piece }, finish_reason: null }] })
  }
  for (const piece of REPLY_PIECES) {
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

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    console.log('[mock-openai]', req.method, url.pathname, 'auth:', req.headers.authorization ?? '(none)')

    // 调试钩子（故意放在鉴权之前）：只回本进程内存里的快照，不代理任何东西，验收脚本用
    if (req.method === 'GET' && url.pathname === '/__last-body') {
      writeJson(res, 200, { body: lastChatBody })
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
      if (record.stream === true) {
        await handleStream(res, model)
        return
      }
      writeJson(res, 200, {
        id: 'mock-cmpl',
        object: 'chat.completion',
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: REPLY_PIECES.join('') },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 13, total_tokens: 24 },
      })
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
