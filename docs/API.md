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

服务端链路：**校验 → 组装隐藏上下文 → 转发 LLM 流 →（有工具调用就执行并续跑）→ 记账**。

> ⚠️ 按 §6.2，`ChatMessage` 归属**本地**（前端 Dexie），服务端**不落聊天记录** —— 所以历史每轮都由前端组装后送来。
> Phase 3B 已接入 Eventide 状态卡；**Phase 6.5 起服务端自己构造 system 段**
> （规则 + 能力清单 + 记忆 + 状态卡），能力清单由 Capability Registry 生成，
> 详见 `docs/AI_RUNTIME.md`。本接口形态不变，前端仍只提交本地聊天历史。

**服务端注入的 system 段**（顺序固定，插在已有 persona 之后、第一条对话之前）：

| name | 何时注入 | 内容 |
| --- | --- | --- |
| `runtime_rules` | 每轮 | 恒定三条规则（以能力清单为准 / 已执行的调用是既成事实 / 直接调用而不是嘴上说） |
| `runtime_capabilities` | 每轮 | **当前真实可用**的能力清单（Registry 生成，绝不写死） |
| `nocturne_memory` | 仅会话开头一次 | 长期记忆全文（超过 16 000 字截断并标注） |
| `eventide_state` | 每轮 | Eventide 状态卡 |

**Eventide 注入规则**：

- 每轮聊天在连接 LLM 前先 tick；当前用户消息视作“对方刚发言”，传给 Eventide 的最后互动时间为当前时刻
- 状态卡插在**已有 system/persona 指令之后、第一条对话之前**
- 状态卡只发给上游模型，不进入 SSE、不回写前端消息，也不改写请求里的历史数组
- Eventide 未配置、返回空卡或暂时不可达时，记录服务端警告并按原始历史继续聊天；状态增强不能成为聊天单点故障
- 同一进程内的 tick 串行执行，且推进时间不允许倒退，避免并发聊天互相覆盖状态

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
| `tool-call` | `ChatToolCallPayload` | **AI 自主发起**的一次工具调用**已执行完**（见下） |
| `chat-usage` | `{ profileId, model, promptTokens, completionTokens, totalTokens }` | 上游末包用量（多轮工具调用时是**合计**） |
| `chat-done` | `{ finishReason, usage, usageRecordId }` | 正常收口；`usageRecordId` 为 UsageRecord 主键 |
| `chat-error` | `{ code, message }` | **流开始之后**才出现的故障（空闲超时、传输中断） |

#### 工具调用（Phase 6.5）

服务端从能力快照生成 `tools` 交给模型；模型要调工具时，服务端**攒齐分片的参数 → 执行 → 回灌结果 → 再流一轮**，
最多 3 轮（防打转）。每执行完一次工具发一帧：

```jsonc
{
  "id": "call_abc",           // 上游给的调用 id
  "name": "memory_search",    // 内建工具名（不是 MCP 实例的工具名）
  "capabilityId": "memory.search",
  "label": "搜索记忆",         // 面向用户的短名
  "source": "Nocturne",       // 展示来源
  "ok": true,
  "summary": "按「散步」检索到记忆",
  "detail": "…"               // 可折叠详情，**服务端已裁剪**；失败时是给用户看的错误说明
}
```

三条纪律：

- **只发结果，不发「开始执行」**：上游按 index 分片下发参数，中间态是半截 JSON，对界面没有意义
- **帧里不带工具原始返回值**：原始返回只进模型上下文（`role='tool'` 消息）；界面上要展开的是裁剪后的 `detail`
- **失败不抛异常**：降级成 `ok:false` 的一次调用结果回灌给模型 —— 它得知道刚才没成功才能决定下一步

> ⚠️ 工具调用**不会**以 `role='tool'` 消息出现在请求里：前端拿到的是 `tool-call` 帧，
> 它负责落一条本地消息（刷新后卡片还在）。服务端在同一轮内自己维护含 `tool_calls` 的对话副本。

**两类错误的分界**：服务端**先取到上游第一个 chunk 才写响应头**，所以密钥没配、方案不存在、上游不可达、鉴权被拒这些都在写头之前抛出，走统一 `ApiError` + 4xx/5xx。
⚠️ 多轮工具调用中，**第二轮起**的上游故障已经在响应头之后，只能走 `chat-error` 事件。

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
- **发生了工具调用的一轮，各轮次的 token 合计成一条记录** —— 一次用户请求算一次调用；
  多轮工具续跑都发生在同一次请求内，拆成多条会让「API 调用次数」这一列失真
- `cost` 需配合 PriceSnapshot（价格版本化）才能算，Phase 4 账本落地时回填
- `day_key` 是**本地时区**的 `YYYY-MM-DD`（按天聚合必须与用户看到的「今天」一致，不能用 UTC）

## Phase 6.5 已实现（AI 运行时 · 能力面）

### `GET /api/capabilities`

LLM 页面「能力卡片」的数据来源，也是**用户能自己核对 AI 到底有什么能力**的入口。
返回的是与 system context、tool schemas **完全同一份**运行时快照。

无参数、**只读**（刻意没有写端点：能力可用性由服务端按依赖真实情况判定，
提供一个「手动改成可用」的开关会立刻把这份快照变成谎言）。

```json
{
  "capabilities": [
    {
      "id": "memory.search",
      "module": "memory",
      "label": "搜索记忆",
      "summary": "按关键词在长期记忆里检索",
      "modelHint": "按关键词在长期记忆中检索。需要想起某个具体的人、事或片段时调用，比整篇读取更省。",
      "enabled": true,
      "autonomy": "autonomous",
      "toolName": "memory_search"
    },
    {
      "id": "diary.create",
      "module": "diary",
      "label": "写日记",
      "summary": "写一篇只有小栖自己能看的日记",
      "modelHint": "…",
      "enabled": false,
      "autonomy": "unavailable",
      "reason": "AI 私有日记的权威存储尚未迁到服务端（P1）"
    }
  ]
}
```

- `enabled=false` 时 **`reason` 必填** —— 不许静默降级，用户有权知道「为什么不能用」
- `enabled=true` 且绑定工具的能力，**必有 `toolName`**（否则模型无从调用）
- `autonomy`：`autonomous` / `confirm` / `user-only` / `unavailable`


## Phase 6.5 已实现（共同生活数据 · 服务端权威）

日记与留言板自 2026-09-24 起**权威存储在服务端 SQLite**（`diary` / `moment` 两张表），
前端 Dexie 不再有这两张表（v11 起）。搬家理由：AI 也在服务端跑，
「AI 写日记」「用户请求查看某篇」「AI 决定放不放」都只能在这里发生 ——
数据留在浏览器里，AI 就只能对着假数据演戏（SPEC §6.3 明确禁止）。

### 权限模型：`author` 就是权限位

| `author` | 谁写的 | 用户能读正文？ | 用户能改 / 删？ |
| --- | --- | --- | --- |
| `user` | 用户自己（含迁移上来的旧日记） | ✅ 总是能 | ✅ |
| `companion` | AI（小栖） | 仅 `visibility = 'open'` 时 | ❌ |

`visibility` 三态：`private`（默认）/ `open` / `locked`。用户自己的日记恒为 `open` ——
所以本次迁移**不会让北北已写好的日记变成只读**。

下发形状 `DiaryView`：

```ts
{
  id, title, entryDate, author, visibility, createdAt, updatedAt,
  content: string | null,   // 无权限时是 null（**不是空串**）
  readable: boolean,        // 当前用户能否读正文
  editable: boolean         // 当前用户能否改 / 删
}
```

⚠️ 用 `content === null` 去猜「是没权限还是还没写」是两件完全不同的事，所以权限另给显式字段。
过滤发生在数据访问层（`server/src/db/diary.ts` 的 `toDiaryView`），**不在路由层** ——
路由以后会多，漏一处就是把 AI 的私密日记漏给用户。

### `GET /api/diary` → `{ items: DiaryView[] }`

列表**包含** AI 的私密日记 —— 用户看得到「有几篇、都是哪天」（封面可见，SPEC §3.4.2），
但它们的 `content` 为 `null`。

### `GET /api/diary/:id`

单篇。无权限时同样只给封面，仍然返回 **200**（它确实存在）；id 不存在才 404。

### `POST /api/diary` / `PATCH /api/diary/:id` / `DELETE /api/diary/:id`

用户对自己日记的增删改。`author` / `visibility` **不接受入参** ——
用户建不出 AI 日记（SPEC §3.4.2），把这两个字段交给调用方自觉就等于没规则。

| 情况 | 状态码 | code |
| --- | --- | --- |
| `title` 空或超 120 字 / `content` 空或超 10000 字 | 400 | `BAD_REQUEST` |
| `entryDate` 非 `YYYY-MM-DD` | 400 | `BAD_REQUEST` |
| 改 / 删 AI 的日记，或 id 不存在 | **404** | `NOT_FOUND` |

> 「没权限」也是 404 而非 403：单用户场景下这两件事对调用方没有区别，
> 而 404 少泄漏一层 —— AI 私密日记**存在与否**本身也算信息。

### `POST /api/diary/import` —— 一次性搬迁

请求体 `{ items: [...] }`，把浏览器里残留的旧日记搬上来。
`author` / `visibility` / 时间戳可缺省（旧数据里没有这些字段）。

**幂等**：已存在的 id 跳过并计入 `skipped`，**不覆盖** ——
重复调不产生副本，也不会盖掉用户后来在服务端改过的内容。

### 留言板：`GET/POST /api/moments`、`DELETE /api/moments/:id`、`POST /api/moments/import`

与日记的差别：**没有可见性过滤**（留言写出来就是给人看的），只有「谁能删」——
用户只能删自己的，AI 的留言不归用户处置（SPEC §6.2）。

`GET /api/moments?limit=N` 供主屏 Widget 取最近 N 条 ——
不然每次渲染主屏都要把全表拉过来再切片。`limit` 非正整数 → 400。

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

## Phase 3A 已实现（长期记忆 · 经 MCP 单通道 · **只读**）

前端只走到这里；服务端内部统一走 `MemoryProvider` → `ToolGateway` → Nocturne MCP
（**不用 Nocturne 的 REST**，见 `AGENTS.md` §3 铁律 4）。

所有记忆端点的返回体都是同一个形状：

```ts
interface MemoryTextResult { text: string }
```

即 Nocturne 工具返回的**给模型阅读的文本** —— 栖息地不解析、不依赖它的内部 schema
（技术方案 §9 风险 5 的对策）。

⚠️ **只有两个端点，且全是只读**（2026-09-24 对齐自部署实例的真实工具面后收敛）。
原先的 `GET read` / `POST` / `PATCH` / `DELETE` 四个写端点**已移除** ——
实例既没有 `uri` 概念，也没有「原地编辑 / 删除」语义，那四个端点从来不可能工作，
且前端一个都没调用过。留着返回 500 只会让人误以为「配好就能用」。

> 只读是**本阶段的刻意选择**：实例的 `hold` / `wander_mark` / `drive` 都能写，
> 但 Phase 3A 不做写记忆。详见 `docs/MEMORY.md` 的「定稿映射」。

### `GET /api/memory/boot`

一次性取回全部长期记忆（实例工具 `breath`，**无参数**）。新窗 / 会话开头用它。

```json
{ "text": "- [memory] 我是用于 Habitat 验收的 mock 记忆，北北晚上会去散步。\n- [feel] 傍晚的风让人安静下来，适合散步。" }
```

### `GET /api/memory/search`

| 查询参数 | 说明 | 取值 |
| --- | --- | --- |
| `q` | 检索词，**必填** | 1–500 字 |
| `limit` | 条数（可选） | 1–100 的整数；省略 = 交给实例默认 |

**没有 `domain` 参数** —— 实例的 `trace` 不认这个维度（原设计按「域」划分是错的假设，已删除）。

| 非法输入 | 状态码 | code |
| --- | --- | --- |
| `q` 缺失 / 非字符串 / 空串 / 超 500 字 | 400 | `BAD_REQUEST` |
| `limit` 非 1–100 的整数 | 400 | `BAD_REQUEST` |
| 同名参数重复传（被解析成数组） | 400 | `BAD_REQUEST` |
| MCP 未配置 / 未 ready / 工具调用失败 | **502** | `MCP_HANDSHAKE_FAILED` / `MCP_TOOL_CALL_FAILED` |

> ⚠️ 记忆端点**依赖外部 MCP server**。没配 `MCP_NOCTURNE_URL` 时它们返回 502
> （`{"error":{"code":"MCP_HANDSHAKE_FAILED","message":"MCP server 'nocturne' is not ready (state=error, lastError=not configured)"}}`）
> —— 这是**设计行为而非故障**；真实状态看 `GET /api/health/mcp`。
>
> 工具面漂移（实例改名 / 换血统）也走这条路：启动期自检会 warn，调用时返回 `MCP_TOOL_CALL_FAILED`。
> 排查见 `docs/MEMORY.md` 的「侦察脚本」。

## Phase 3B 已实现（Eventide 状态 + 主动行为）

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

聊天成功收口后，服务端会在**不阻塞已送达回复**的后台任务里生成结构化互动结算，再交给 Eventide
归一化、限幅并写回。结算调用同样落 `UsageRecord`；失败只写 `EventLog` 与服务端 warning。

### 主动行为与 BudgetGuard

| 接口 | 说明 |
|---|---|
| `GET /api/automation` | 当前策略 + 运行态（最后用户互动、最后唤醒、连续未回复、每日独处 / 梦境标记） |
| `PATCH /api/automation` | 部分更新策略；主动行为默认关闭，时间为 `HH:mm`，时区为 IANA 名称 |
| `POST /api/automation/check` | 立即执行一轮与定时器相同的检查；请求体 `{}`，不接受客户端自报时间 |
| `GET /api/automation/runs?limit=` | BudgetGuard 预约 / 完成 / 失败 / 跳过记录 |
| `GET /api/events?limit=` | EventLog，供 Phase 4 Life 统计使用 |

BudgetGuard 在调用 LLM **之前**以 SQLite 事务预约预算，检查总开关、功能开关、免打扰、静默、冷却、
连续未回复、每日主动次数、API 次数、Token 与费用。普通聊天不受免打扰 / 主动总开关影响，但仍过
API / Token / 费用上限；拒绝时返回 `429 BUDGET_EXCEEDED`。费用上限开启后，只要当天存在未定价
调用，后续调用会被安全拒绝为“费用不可计算”，不会拿 `0` 假装真实费用。

### 主动产出

| 接口 | 说明 |
|---|---|
| `GET /api/notifications?limit=` | 主动唤醒先进入服务端通知收件箱，不伪造前端 Dexie 聊天消息 |
| `PATCH /api/notifications/:id/read` | 标记通知已读 |
| `PATCH /api/notifications/read-all` | 原子标记全部未读通知为已读，返回 `updated` 数量 |
| `GET /api/solitude?limit=` | AI 私有的独处记录；梦卡以 `metadata.kind="dream"` 区分 |

调度器默认每分钟检查。Eventide 状态即使主动总开关关闭也可推进；真正的 wake / solitude / dream
只有分别开启且通过 BudgetGuard 才会调用 LLM。用户真实发言会清零连续未回复计数。

### 钱包

| 接口 | 说明 |
|---|---|
| `GET /api/wallet` | 当前余额 |
| `GET /api/wallet/transactions?limit=` | 不可变流水，最新在前 |
| `POST /api/wallet/transactions` | `{ delta, reason, refType?, refId? }`；余额不足时拒绝，不允许无流水改余额 |

## Phase 4 已实现（Life）

| 接口 | 说明 |
|---|---|
| `GET /api/life/month?month=YYYY-MM` | 用户时区月历摘要：事件 / 失败 / 调用 / Token / 已定价费用 / 未定价数 |
| `GET /api/life/day/:dayKey` | 日期下钻；返回当天 EventLog 与 UsageRecord，不反查聊天库 |
| `GET /api/life/ledger?month=YYYY-MM` | 用量总计、按服务 / 模型聚合、价格快照、钱包与最近流水 |
| `GET /api/life/runtime` | 聚合 server、Eventide、MCP、当前状态、主动策略 / 运行态 / 最近任务 |
| `GET /api/prices` | 全部不可变 PriceSnapshot，按生效时间倒序 |
| `POST /api/prices` | 新增 `{ provider, model, promptCentsPerMillion, completionCentsPerMillion, validFrom }` |
| `GET /api/push/status` | VAPID 是否配置、公钥、订阅数与最近错误 |
| `PUT /api/push/subscription` | 保存浏览器 `PushSubscription`；VAPID 未配置时拒绝 |
| `DELETE /api/push/subscription` | 按 endpoint 取消订阅 |

价格单位是**分 / 百万 Token**。每条 UsageRecord 在写入时绑定当时适用的最新快照，费用按分向上取整；
新增快照会给符合有效期、仍为 `cost=null` 的历史调用补价，但不会重算已经绑定快照的历史。没有匹配价格时
继续明确显示“未定价”，BudgetGuard 的费用上限保持 fail-closed。

Web Push 仅是站内通知的尽力而为副本：VAPID 环境变量不完整时接口明确返回 `configured=false`；Push 失败
不回滚通知，404 / 410 的失效订阅会自动清除。

## Phase 5 已实现（媒体与用户工具）

媒体接口统一使用当前启用的 API 方案，也可在请求体传 `profileId` 指定方案。浏览器只到 habitat-server，
不会拿到上游密钥。成功调用均写 UsageRecord（没有 token 明细的媒体服务以 0 token 留下调用事实）。

| 接口 | 说明 |
|---|---|
| `POST /api/media/transcriptions` | `{ dataUrl, profileId? }`；只收 `audio/*` base64 data URL，解码后最大 8 MB |
| `POST /api/media/speech` | `{ text, voice?, profileId? }`；返回音频二进制，正文最多 4,000 字 |
| `POST /api/media/vision` | `{ dataUrl, prompt?, profileId? }`；只收白名单前端产生的 `image/*`，解码后最大 3 MB |
| `POST /api/media/images` | `{ prompt, profileId? }`；要求上游返回 `b64_json`，服务端转成可本地保存的 PNG data URL |
| `GET /api/tools` | 从当前 ready 的 MCP Server 聚合脱敏工具描述与 `inputSchema` |
| `POST /api/tools/call` | `{ serverId, name, args }`；用户在 Mini Terminal 显式确认后调用 |

`modelMap` 对应槽位为 `transcription / tts / vision / image`。未配置返回
`400 PROVIDER_NOT_CONFIGURED`；上游鉴权 / 网络 / 非 2xx 继续使用统一 Provider 错误码。
媒体路由的 Fastify 总体请求上限是 12 MB（容纳 base64 膨胀），端点内部再按上述解码后大小收紧。

## 待实现（按阶段）

- Phase 3A：自部署实例已完成 Namespace / 反代 / 会话 / `breath` / `trace` 与生产鉴权真机 **26/26**；Dashboard/API 由 `OMBRE_API_PASSWORD` 保护，MCP Bearer 由宿主 nginx 校验
- Phase 6：已完成；实时双工与带逐次授权的 AI 自主工具循环仍需独立协议，不属于本阶段欠项
- 诊断日志的留存策略（表只增不减，目前没有清空 / 归档入口）
