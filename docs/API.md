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
> 切片三起，密钥还可以直接存在服务端（见下），但**任何端点都不会把它读回来** —— 前端只能拿到 `hasKey` / `keySource`。

### `GET /api/providers`

列出全部方案 + 当前生效的那一个。

```json
{
  "active": {
    "id": "deepseek", "name": "DeepSeek 官方", "provider": "openai-compat",
    "baseUrl": "https://api.deepseek.com/v1", "keyRef": "DEEPSEEK_API_KEY",
    "hasKey": true, "keySource": "env",
    "modelMap": { "chat": "deepseek-chat" }, "headerNames": [],
    "streamOptions": true, "isActive": true
  },
  "profiles": [ /* 同上结构 */ ]
}
```

- `hasKey`：凭据**是否已就绪、可直接发起调用**（即 `keySource !== 'missing'`）
- `keySource`：凭据从哪来，UI 文案据此区分四种情况（`hasKey` 单独看会把「不需要密钥」和「已配好」混为一谈）
- `streamOptions`：流式请求是否带 `stream_options: { include_usage: true }`。**缺省 `true`** —— 绝大多数上游靠它在末包回 `usage`，账本（`usage_record`）才有 token 可记。只有老自建上游（老版 vLLM、部分代理）会因这个字段回 400，那时按方案关掉

| `keySource` | 含义 | 能否直接用 |
| --- | --- | --- |
| `stored` | 密钥存在服务端（在此页填的） | ✅ |
| `env` | 来自 `keyRef` 指向的环境变量 | ✅ |
| `missing` | 声明了 `keyRef` 但环境变量没设 | ❌ |
| `not-required` | `keyRef` 为空串：该上游不需要鉴权 | ✅ |

**凭据来源优先级：`stored` > `env`**。这样可以为已按环境变量配好的方案补填密钥（覆盖生效），而不必把密钥搬进库里。

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

## Phase 1 已实现（切片三 · 方案管理）

让方案能在设置页里增删改，不必手写 `.env`。

> **权威源 = 服务端 SQLite**（表 `api_profile` / `api_secret`）。
> `HABITAT_LLM_PROFILES` 降级为**首次种子**：仅在表为空时导入一次，之后改 `.env` 不再生效（启动日志会说明）。
> 这偏离了 §6.2 的「本地 Dexie + 服务端副本」，理由见 `docs/TASKS.md`。

### `POST /api/providers`

新建。**密钥不在这里** —— 配置与凭据分两个端点，好处是改 baseUrl 不会误清密钥。

```json
{
  "name": "DeepSeek 官方",
  "baseUrl": "https://api.deepseek.com/v1",
  "modelMap": { "chat": "deepseek-chat" },
  "keyRef": "DEEPSEEK_API_KEY",
  "headers": { "X-Custom": "…" },
  "streamOptions": true,
  "isActive": false
}
```

返回 `201` + 脱敏视图。`id` 由 `name` 派生：小写、**中文字符原样保留**（它会出现在账本与日志里，可读比好看重要）、其余字符压成 `-`；冲突自动加 `-2`、`-3`。

- 忽略 `isActive`，**库里一条方案都没有时自动设为默认**（单方案场景不该还要多点一次）
- 除 `name` / `baseUrl` / `modelMap.chat` 外均可省略；`keyRef` 留空 = 该上游不需要鉴权
- `streamOptions` 缺省 `true`；**必须传布尔值**，传其它类型返回 `400 BAD_REQUEST`。要关就显式传 `false`

### `PATCH /api/providers/:id`

局部更新，字段**不出现 = 不改**（显式传 `keyRef: ""` 才是清空）。请求体形状同 `POST`，全字段可选；空对象返回 `400`。`streamOptions` 同样只收布尔值。

### `DELETE /api/providers/:id`

删除方案，连带清掉它的密钥（不留孤儿凭据）。返回：

```json
{ "deleted": true, "id": "deepseek", "active": { /* 删除后的默认方案 */ } }
```

- 删掉的是默认方案时，**自动把剩下第一条顶为默认** —— 不会出现「有方案但没有默认」的空窗
- 顺带把新的 `active` 一并返回，省一次往返

### `POST /api/providers/:id/activate`

设为默认。默认方案**互斥**，任何时刻至多一条 `isActive`。

```json
{ "active": { "id": "deepseek", "isActive": true, "…": "…" } }
```

### `PUT /api/providers/:id/secret` · `DELETE /api/providers/:id/secret`

写入 / 清除该方案的密钥。请求体 `{ "secret": "sk-…" }`（不能为空串）。

两者都只返回**凭据状态**，**绝不回显密钥**：

```json
{ "id": "deepseek", "hasKey": true, "keySource": "stored" }
```

- `DELETE` 后 `keySource` 会重新解析 —— 若该方案还配着 `keyRef`，会**回落到环境变量**（`env`），而不是变成 `missing`
- `DELETE` 对没有密钥的方案是**幂等成功**（返回当前状态），不算错误

### 字段校验

| 情况 | 状态码 | code |
| --- | --- | --- |
| `name` 缺失 / 超 60 字 | 400 | `BAD_REQUEST` |
| `baseUrl` 非法 URL 或非 http(s) | 400 | `BAD_REQUEST` |
| `modelMap.chat` 缺失 | 400 | `BAD_REQUEST` |
| `keyRef` 不是合法环境变量名 | 400 | `BAD_REQUEST` |
| `PATCH` 请求体为空对象 | 400 | `BAD_REQUEST` |
| `POST /:id/secret` 的 `secret` 为空 | 400 | `BAD_REQUEST` |
| 方案 id 不存在（PATCH / DELETE / activate / secret） | 404 | `PROVIDER_NOT_FOUND` |

`baseUrl` 结尾的斜杠会被**自动去掉**（否则会拼出 `//chat/completions`）。

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
| 方案没有可用凭据（未存密钥且 `keyRef` 环境变量未设） | 400 | `PROVIDER_NOT_CONFIGURED` |
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

## Phase 1 已实现（切片五 · 诊断日志查询）

设置页「诊断日志」时间线的数据源。**只读**，把 `mcp_diagnostic_log` 里的原始字段**原样**下发 —— 诊断日志是排障证据，在服务端做二次解释只会让「页面看到的」与「库里存的」对不上。

### `GET /api/diagnostics/mcp`

| 查询参数 | 说明 | 取值 |
| --- | --- | --- |
| `serverId` | 只看某个 MCP server | 字符串；省略 / 空串 = 全部 |
| `handshake` | 按阶段筛（**三态**） | `1`/`true` = 仅握手；`0`/`false` = 仅工具调用；省略 = 全部 |
| `errorsOnly` | 只看有 `error` 的记录 | `1`/`true`；省略 / `0`/`false` = 不筛 |
| `limit` | 每页条数 | 正整数，1–200，默认 50 |
| `before` | 游标：只取 `id` **小于**它的（即更早的记录） | 正整数 |

```json
{
  "entries": [
    {
      "id": 42,
      "serverId": "nocturne",
      "direction": "out",
      "method": "tools/call",
      "httpStatus": null,
      "handshake": false,
      "latencyMs": 45,
      "error": "connect ECONNREFUSED 127.0.0.1:3333",
      "at": 1790126460730
    }
  ],
  "total": 137,
  "errorCount": 9,
  "hasMore": true
}
```

- `entries` 按 `id` **倒序**（最新在前）；`direction`：`out` = Gateway→Server 请求，`in` = Server→Gateway 响应 / 通知
- `at` 是毫秒时间戳；`httpStatus` / `latencyMs` 无值时是 `null`（官方 SDK 的 transport 不暴露 HTTP 状态码，故多数为空）
- **`total` / `errorCount` 不含游标** —— 说的是「符合筛选条件的记录有多少」，所以翻页时不会越翻越小
- 翻页：把上一页最后一条的 `id` 当 `before` 再请求一次；`hasMore=false` 表示到底了

| 非法输入 | 状态码 | code |
| --- | --- | --- |
| `limit` 非数字 / < 1 / > 200 | 400 | `BAD_REQUEST` |
| `before` 非正整数 | 400 | `BAD_REQUEST` |
| `handshake` / `errorsOnly` 不是布尔字面量 | 400 | `BAD_REQUEST` |
| 同名参数重复传（会被解析成数组） | 400 | `BAD_REQUEST` |

> `serverId` 传一个不存在的服务**不是错误** —— 返回空页（`total: 0`），因为它是个筛选条件而不是资源标识。

## Phase 3A 已实现（长期记忆 · 经 MCP 单通道）

前端只走到这里；服务端内部统一走 `MemoryProvider` → `ToolGateway` → Nocturne MCP
（**不用 Nocturne 的 REST**，见 `AGENTS.md` §3 铁律 4）。

所有记忆端点的返回体都是同一个形状：

```ts
interface MemoryTextResult { text: string }
```

即 Nocturne 工具返回的**给模型阅读的文本** —— 栖息地不解析、不依赖它的内部 schema
（技术方案 §9 风险 5 的对策）。`uri` 一律是 `domain://path` 形式，且 **`system://` 是只读视图**，
任何写操作都会被拒。

### `GET /api/memory/boot`

一次性取回「开机记忆」（Nocturne 的 `system://boot` 视图）。无参数。

```json
{ "text": "# Core Memories\nLoaded: 3/3\n..." }
```

### `GET /api/memory/search`

| 查询参数 | 说明 | 取值 |
| --- | --- | --- |
| `q` | 检索词，**必填** | 1–500 字 |
| `domain` | 限定域（可选） | `^[A-Za-z_][A-Za-z0-9_]*$`；省略 = 全域 |
| `limit` | 条数（可选） | 1–100 的整数；省略 = 交给 Nocturne 默认 |

### `GET /api/memory/read`

| 查询参数 | 说明 |
| --- | --- |
| `uri` | **必填**，`domain://path` |

### `POST /api/memory` —— 新建记忆节点

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `parentUri` | ✅ | `domain://path`；**不接受 `system://`** |
| `content` | ✅ | ≤ 100 000 字 |
| `priority` | ✅ | 0–1 000 000 的整数 |
| `disclosure` | ✅ | ≤ 2 000 字（对模型披露可见性的说明） |
| `title` | — | ≤ 120 字，**且只允许 `[A-Za-z0-9_-]`**（会被当成路径段） |

成功返回 **201** + `MemoryTextResult`。

### `PATCH /api/memory` —— 修改

`uri` 必填（同样拒绝 `system://`）。三种修改模式：

| 模式 | 字段 | 说明 |
| --- | --- | --- |
| 替换 | `oldString` + `newString` | 精确 / `...` 块匹配；**两者必须同时提供** |
| 追加 | `append` | 与替换模式**互斥** |
| 元信息 | `priority` / `disclosure` | 可单独提供 |

- 至少要提供一项修改，否则 400
- **没有「全文覆盖」** —— Nocturne 刻意不提供该语义（避免误删整段）

### `DELETE /api/memory`

| 查询参数 | 说明 |
| --- | --- |
| `uri` | **必填**，`domain://path`（不接受 `system://`） |

| 非法输入 | 状态码 | code |
| --- | --- | --- |
| `uri` 不是 `domain://path` 形式 | 400 | `BAD_REQUEST` |
| 对 `system://` 发起写（POST / PATCH / DELETE） | 400 | `BAD_REQUEST` |
| `q` / `uri` 缺失，或 `domain` 格式非法 | 400 | `BAD_REQUEST` |
| `limit` 非 1–100 的整数 | 400 | `BAD_REQUEST` |
| `title` 含白名单外的字符 | 400 | `BAD_REQUEST` |
| `oldString` / `newString` 只给其一，或与 `append` 同时给 | 400 | `BAD_REQUEST` |
| 同名参数重复传（被解析成数组） | 400 | `BAD_REQUEST` |
| MCP 未配置 / 未 ready / 工具调用失败 | **502** | `MCP_HANDSHAKE_FAILED` / `MCP_TOOL_CALL_FAILED` |

> ⚠️ 记忆端点**依赖外部 MCP server**。没配 `MCP_NOCTURNE_URL` 时它们全部返回 502
> （`{"error":{"code":"MCP_HANDSHAKE_FAILED","message":"MCP server 'nocturne' is not ready (state=error, lastError=not configured)"}}`）
> —— 这是**设计行为而非故障**；真实状态看 `GET /api/health/mcp`。

## Phase 3B 已实现（切片一 · Eventide 状态底座）

Eventide 作为**无状态 Python sidecar**运行；habitat-server 持有并持久化唯一的当前状态。
上游依赖锁在 commit `5d8bef965137427e41d97f5b60e5a14c24dd812c`。

### `GET /api/health/state`

始终返回 200，供聚合状态页消费。未配置 `EVENTIDE_URL` 时 `configured=false`；sidecar 不可达时
`configured=true, ok=false` 并保留可读错误，不拖垮主服务。

```json
{
  "ok": true,
  "configured": true,
  "service": "eventide",
  "revision": "5d8bef965137427e41d97f5b60e5a14c24dd812c",
  "lastError": null,
  "lastCheckedAt": 1790180000000
}
```

### `GET /api/state`

只读最近一次已持久化快照，**不推进时间**。首次 tick 前返回 `{ "snapshot": null }`；之后：

```json
{
  "snapshot": {
    "state": { "cycle_key": "stable", "values": {} },
    "stateCard": "<ephemeral_state ...>",
    "payload": { "heat": { "value": 30, "level": "中低" } },
    "settledAt": 1790180000000
  }
}
```

`state` 是 Eventide 的往返 JSON，不对前端承诺内部字段；消费方应使用 `payload`。

### `POST /api/state/tick`

请求体用空 JSON `{}`。服务端只采用自己的当前时间，不接受客户端自报时间；读取旧快照、调用 sidecar
推进、拿到完整结果后原子覆盖 SQLite，再直接返回新的 `BodyStateSnapshot`。

| 情况 | 状态码 | code |
|---|---|---|
| `EVENTIDE_URL` 未配置 | 400 | `PROVIDER_NOT_CONFIGURED` |
| sidecar 不可达 / 非 2xx / 响应形状损坏 | 502 | `PROVIDER_UPSTREAM_ERROR` |

## 待实现（按阶段）

- Phase 3A 剩余：**自部署 Nocturne 实例**的 Token / Namespace / 反代链路验证（客户端代码已用官方只读 Demo 验通，见 `docs/TASKS.md` T-013）
- Phase 3B 剩余：状态卡注入聊天上下文、互动结算、事件抽取、主动唤醒 / 独处时光与 BudgetGuard
- Phase 4：Life 统计 / 账本 / 通知
- 诊断日志的留存策略（表只增不减，目前没有清空 / 归档入口）
