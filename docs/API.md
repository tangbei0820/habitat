# API · 接口约定

> 施工依据：`栖息地初版技术方案分析.md` §7.2②（MCP Gateway 与诊断）、§8（页面）。  
> 本文件只记「面向前端的实际契约」；新增 / 修改接口必须同步此处。

所有响应：成功直接返回数据体；失败统一为 `ApiError` 形状（见 `shared/errors.ts`）：

```json
{ "error": { "code": "MCP_HANDSHAKE_FAILED", "message": "…", "detail": "…" } }
```

## Phase 0 已实现

### `GET /api/health`

服务存活探测。设置页「系统状态」数据源。

```json
{ "ok": true, "service": "habitat-server", "time": "2026-09-22T14:53:23.907Z" }
```

### `GET /api/health/mcp`

MCP Gateway 聚合健康。设置页「MCP 工具网关」数据源。

```json
{
  "ok": true,
  "servers": [
    { "serverId": "nocturne", "state": "ready", "toolCount": 1, "lastError": null, "lastCheckedAt": 1790085236155 }
  ]
}
```

- `state` 取值：`disconnected` / `connecting` / `handshake` / `ready` / `error`（状态机见 `server/src/mcp/gateway.ts`）
- 单 server 握手失败**不阻塞**服务启动，只把 `state` 置 `error` 并落诊断表
- 每次握手与工具调用全量写入 SQLite `mcp_diagnostic_log`（原因可逐请求回放）

## Phase 1 已实现（切片一 · 通用 OpenAI 兼容层）

方案（ApiProfile）以「baseUrl + 鉴权 + 模型映射」描述，任何 OpenAI Chat Completions 兼容的服务（DeepSeek 官方、各类中转、本地 vLLM / Ollama 的 `/v1`）都能直接接。

> ⚠️ **密钥永不下发**：响应里的 `keyRef` 只是「持有密钥的环境变量名」，不是密钥本身。`headerNames` 同理只给名字，因为部分中转把凭证放在自定义头里。

### `GET /api/providers`

列出全部方案 + 当前生效的那一个。

```json
{
  "active": {
    "id": "deepseek", "name": "DeepSeek 官方", "provider": "openai-compat",
    "baseUrl": "https://api.deepseek.com/v1", "keyRef": "DEEPSEEK_API_KEY",
    "hasKey": true, "modelMap": { "chat": "deepseek-chat" },
    "headerNames": [], "isActive": true
  },
  "profiles": [ /* 同上结构 */ ]
}
```

- `hasKey`：`keyRef` 指向的环境变量在服务端是否就绪（`keyRef` 为空串表示该上游不需要鉴权，恒为 `true`）
- 单个方案配置有误不会拖垮启动：该条被跳过，启动日志里打 `LLM 方案配置被跳过` 并附原因

### `GET /api/providers/:id/models`

取上游模型列表（「选模型」用）。失败按统一 `ApiError` 返回。

```json
{ "profileId": "deepseek", "models": ["deepseek-chat", "deepseek-reasoner"] }
```

| 情况 | 状态码 | code |
| --- | --- | --- |
| 方案 id 不存在 | 404 | `PROVIDER_NOT_FOUND` |
| `keyRef` 环境变量未设置 | 400 | `PROVIDER_NOT_CONFIGURED` |
| 上游 401 / 403 | 401 | `PROVIDER_UNAUTHORIZED` |
| 连接失败 / 其它非 2xx | 502 | `PROVIDER_UPSTREAM_ERROR` |

### `POST /api/providers/:id/test`

连通性探测。**探测失败是「结果」不是异常** —— 与 `/api/health/mcp` 同款处理，`ok:false` + 可读原因，由前端渲染成 ⚠️。

```json
{
  "profileId": "deepseek", "ok": true, "latencyMs": 218,
  "modelCount": 2, "sampleModels": ["deepseek-chat", "deepseek-reasoner"], "error": null
}
```

```json
{
  "profileId": "broken", "ok": false, "latencyMs": 5,
  "modelCount": 0, "sampleModels": [],
  "error": "连接 'broken' 失败：fetch failed（connect ECONNREFUSED 127.0.0.1:9999）"
}
```

（方案 id 不存在仍返回 404 —— 那是调用方错误，不是探测结果。）

## Phase 1 已实现（切片二 · 聊天流）

### `POST /api/chat`（SSE）

服务端只做三件事：**校验 → 转发 LLM 流 → 记账**。

> ⚠️ 按 §6.2，`ChatMessage` 归属**本地**（前端 Dexie），服务端**不落聊天记录** —— 所以历史每轮都由前端组装后送来。
> 完整上下文组装（世界书 + Eventide 状态卡 + Nocturne 召回）在 Phase 3 接入，届时在服务端侧插入，本接口形态不变。

请求：

```json
{
  "profileId": "deepseek",
  "model": "deepseek-chat",
  "messages": [{ "role": "user", "content": "你好" }],
  "temperature": 0.8,
  "maxTokens": 1024
}
```

`profileId` 缺省用注册表里 `isActive` 的方案；`model` 缺省用 `profile.modelMap.chat`。

响应为 `text/event-stream`，响应头带 `x-accel-buffering: no`（禁反代缓冲，对策 §9 风险2）：

| event | data | 说明 |
| --- | --- | --- |
| `chat-delta` | `{ content?, reasoning? }` | 正文 / 思维链增量，可能只带其一 |
| `chat-usage` | `{ profileId, model, promptTokens, completionTokens, totalTokens }` | 上游末包用量 |
| `chat-done` | `{ finishReason, usage, usageRecordId }` | 正常收口；`usageRecordId` 为 UsageRecord 主键 |
| `chat-error` | `{ code, message }` | **流开始之后**才出现的故障（空闲超时、传输中断） |

**两类错误的分界**：服务端**先取到上游第一个 chunk 才写响应头**，所以密钥没配、方案不存在、上游不可达、鉴权被拒这些都在写头之前抛出，走统一 `ApiError` + 4xx/5xx：

| 情况 | 状态码 | code |
| --- | --- | --- |
| `messages` 非数组 / 为空 / `role` 非法 / 超 200 条 | 400 | `BAD_REQUEST` |
| 方案 id 不存在 | 404 | `PROVIDER_NOT_FOUND` |
| 未配置任何方案 | 400 | `PROVIDER_NOT_CONFIGURED` |
| `keyRef` 环境变量未设置 | 400 | `PROVIDER_NOT_CONFIGURED` |
| 上游 401 / 403 | 401 | `PROVIDER_UNAUTHORIZED` |
| 连接失败 / 其它非 2xx | 502 | `PROVIDER_UPSTREAM_ERROR` |

只有**流已经开始之后**才出现的故障才走 `chat-error` 事件——这样前端不必为「HTTP 200 但流里带错误」再多备一条判错分支。

- 客户端断开 → 服务端立刻 abort 上游（不白烧 token），但已产生的用量仍落表
- 建连超时默认 30s；空闲超时默认 60s（上游多少毫秒没吐新数据即判定挂死并中断）
- `reasoning_content` 与正文分别以 `reasoning` / `content` 下发；前端 Phase 1 只渲染正文，思维链存进消息的 `metadata.reasoning` 备 Phase 3 用

### 用量落表（UsageRecord）

每次**成功**的 LLM 调用强制写一条 `usage_record`（§6.2 / §7.2①），字段：

```
profile_id / service / model / prompt_tokens / completion_tokens / total_tokens / cost / day_key / at
```

- 上游没回 usage 时按 0 落一条 —— 保证「这轮发生过」有据可查
- 这一轮**没跑成**（上游报错）则不记：`UsageRecord` 记的是消耗，不是尝试
- `cost` 需配合 PriceSnapshot（价格版本化）才能算，Phase 4 账本落地时回填
- `day_key` 是**本地时区**的 `YYYY-MM-DD`（按天聚合必须与用户看到的「今天」一致，不能用 UTC）

## 待实现（按阶段）

- Phase 1 其余：设置页 API 方案管理 UI、诊断日志查询、消息块扩展（`MessageBlock.kind`）
- Phase 3A：记忆检索与写入（经 MCP）
- Phase 4：Life 统计 / 账本 / 通知
