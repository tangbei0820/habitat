# TASKS · 任务记录与待优化清单

> **用途**：每完成一次任务，**先按顺序追加一条记录**，写清「已完成什么 + 还剩什么待优化」，然后再进入下一进程。
> **与 `docs/CHANGELOG.md` 的分工**：CHANGELOG 记「改了什么」（面向版本，按 Phase 组织）；本文件记「做到哪、还欠什么」（面向推进与排期）。
> **两条硬规矩**：① 已完成只写要点，正文链到 CHANGELOG，**不复制**；② **所有待优化一律收敛到本文件**，不许散落在对话、代码注释或临时文件里。
> 最后更新：2026-09-23

---

## 待优化清单（汇总）

做完就勾掉，并在下方对应任务记录里注明。

### 高 —— 影响正确性，容易踩

- [x] ~~**服务端不读 `.env`**~~ —— 已修（T-003）：新增 `server/src/lib/env.ts`，作为 `src/index.ts` 的**第一个 import** 把 `server/.env` 灌进 `process.env`。刻意不引 dotenv（它可用的 `process.loadEnvFile` 会覆盖既有变量），手写极简解析保证优先级为「**真实环境变量 > .env**」，路径按模块位置解析所以从哪启动都能找到。
- [ ] **`web` 缺备份导出** —— 铁律 5 要求「版本化迁移 **+ 备份导出**」。现在 Dexie 迁移有了（`version(1)` → `version(2)`），但导出 / 导入入口为零；水合失败只能引导用户「清理站点数据」= 数据直接丢。→ 在设置页补导出 / 导入。
- [ ] **流式中的回复只活在内存，刷新即丢** —— 流式增量刻意不写库（避免每 token 一次 IndexedDB 写），收尾才落一条。代价：用户在生成过程中刷新 / 关页，这一轮的正文全丢（用户消息已落库，所以会看到「问了没答」）。→ 按 ~500ms 节流落一次草稿，或复用已建好的 `candidates`。

### 中 —— 体验与一致性

- [x] ~~**聊天窗口避让底栏用的是魔法数字**~~ —— 已修（T-004）：底栏高度提为 token `--bottom-nav-height`，且会话窗口改为沉浸式（不渲染底栏，见 T-004）。
- [ ] **虚拟列表接「向上加载更早消息」后会跳位** —— 高度缓存的键已经是 item key 而非下标（这点做对了），但 `prepend` 之后 `scrollTop` 的绝对位置仍会错位，用户会被弹走。→ 插入前记 `scrollHeight`，插入后按差值补偿 `scrollTop`。
- [ ] **`ChatMessage.blocks` 只渲染 `text`** —— 另外 7 种 kind（`html` / `image` / `audio` / `file` / `tool-result` / `widget` / `tab-group`）渲染器未分发（§5.5 可扩展块）。→ 按 kind 建分发入口。
- [ ] **`listMessagesPage` 的分页游标没接 UI** —— 仓储层的 `before` 参数已就绪，聊天页目前固定只拉最近 60 条，再往前的看不到。
- [ ] **发送失败 / 想换一个回答时没有出口** —— 失败后系统气泡只显示原因，用户消息已落库但没有重发入口；§5.3 的「重roll」字段（`candidates`）已建好未用。
- [ ] **会话删除无确认** —— 列表页点 ✕ 直接连同该会话全部消息一起删（`deleteSession` 是事务删除）。
- [ ] **Home 子模块标题显示原始 key** —— `/home/board` 的标题渲染成 `Board`（对英文 key 做 `capitalize`），而入口列表里是「留言板」。→ 用同一份模块表反查中文名。
- [ ] **原生模块 ABI 与 Node 版本绑定** —— `better-sqlite3` 的二进制绑定**安装时**的 Node 版本；本仓库是在 Node 20 下装的，用 Node 22 启动会 `ERR_DLOPEN_FAILED`。已在 `README.md` 环境要求里写明，但还没做机器可读的约束。→ 加 `.nvmrc`（或 `package.json` 的 `engines`）+ 启动时校验版本并给一句人话提示。
- [ ] **`stream_options` 可能被上游拒绝** —— 兼容层无条件发 `stream_options: { include_usage: true }` 以换取末包 usage（账本要用）。极少数自建上游（老版 vLLM、部分代理）会回 400。→ 按方案加开关，默认开。
- [ ] **`.env` 里的 JSON 必须写成单行** —— 极简解析器逐行读，把 `HABITAT_LLM_PROFILES` 的 JSON 换行美化会被截断成非法 JSON。报错文案里已点明「请写成一行」。（T-005 起该变量只在**种子导入**时相关，影响面已缩小。）
- [ ] **`favicon.ico` 404** —— 每个页面控制台一条红字。→ 放个 favicon，或声明空 data URI 的 `<link rel="icon">`。
- [ ] **React Router v7 future flag 警告** —— 控制台噪音。→ 显式开 `v7_startTransition` / `v7_relativeSplatPath`。
- [ ] **服务端 CORS 全开** —— `origin: true` 会反射任意来源。本地开发可接受，**上线前必须收紧到具体域名**。
- [ ] **密钥在 SQLite 里是明文** —— `api_secret.secret` 直接存原文（个人自用单机，不做加密）。真正的风险点是**备份**：直接打包 `server/data/` 会把密钥一起带走。→ 做「导出 / 备份」功能时必须提供「**不含凭据**」选项（拆表就是为这个留的口子：只导 `api_profile` 即可）。
- [ ] **删光所有方案后重启，`.env` 里的种子会复活** —— `importProfiles` 的判据是「表为空」，于是用户清空方案 → 重启 → 环境变量里的旧方案又冒出来，违背他的意图。→ 改为持久标记「已导入过」（在库里记一条 kv），而不是看表是否为空。
- [ ] **方案表单没接「选模型」下拉** —— `GET /api/providers/:id/models` 早已就绪，但表单里模型名只能手打，很容易打错。→ 表单里加「从上游拉取模型列表」并给候选。
- [ ] **`headers` 自定义请求头没有 UI 入口** —— 后端支持写入（`POST` / `PATCH` 都收），但前端表单没暴露。部分中转把凭证塞在自定义头里，这类用户目前只能走环境变量方案。→ 表单「高级」区补一个键值对编辑器。

### 低 —— 开发工具与体验毛刺

- [ ] **`--bottom-nav-height` 是估的 4rem** —— 不是实测的底栏高度，改图标 / 字号后要手动同步。→ 用一次 `ResizeObserver` 实测后写回 CSS 变量。
- [ ] **思维链整段存进 `metadata.reasoning`，无长度上限** —— 长思维链（尤其 R1 类模型）会让单条消息记录明显膨胀。→ 落库前截断，或改为单独的块（`MessageBlock.kind` 已有扩展位）。
- [ ] **验收脚本的断言绑定了 mock 的固定回复文案** —— 改 `mock-openai.ts` 的回复就要同步改 `web/scripts/verify-chat.mjs` 的断言。→ 让 mock 回显请求内容，断言改成检查回显。
- [x] ~~**`ApiProfilePublic.hasKey` 语义有歧义**~~ —— 已修（T-005）：新增 `keySource`（`stored` / `env` / `missing` / `not-required`），UI 文案据此分别渲染「密钥已保存」/「密钥来自环境变量」/「缺密钥，现在调不通」/「无需密钥」。`hasKey` 保留（= `keySource !== 'missing'`），不破坏既有契约。
- [ ] **`modelMap` 的 tts / vision / embedding 槽位暂时无人消费** —— 已按 §6.2 预留，等 Phase 5 接语音 / 视觉时用。
- [ ] **mock MCP 的 GET / DELETE 分支取错 session id** —— `mock-server.ts` 的 POST 分支正确地读 `req.headers['mcp-session-id']`，但 GET / DELETE 分支读的是 `url.searchParams.get('sessionId')`；官方 SDK 明确是**发 header**（见 `node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js:427`）。后果：SSE 流与显式关会话两条路径必然 400（目前 Gateway 没用到，所以没暴露）。→ 统一改读 header。
- [x] ~~**`ApiProfile` 的权威存储还在环境变量**~~ —— 已改（T-005）：权威源换成**服务端 SQLite**（`api_profile` / `api_secret` 两表），`HABITAT_LLM_PROFILES` 降级为**首次种子**（仅在表为空时导入一次）。`LlmRegistry` 对外接口一字未改，调用方无感。
  > ⚠️ **这是对 §6.2 的有意偏离**：§6.2 写 `ApiProfile` 应「本地（前端 Dexie）+ 服务端同步副本」。理由：只有服务端能真正发起调用，双写只会引入一致性问题（两份数据谁赢、离线改了怎么办），而方案管理是低频操作、离线时也无法「测试连接」。→ 若日后真需要离线查看方案，再补本地只读副本。
- [ ] **删除方案会让历史 `usage_record` 的 `profile_id` 变成孤儿** —— 账本按方案聚合时会出现「已删除方案」这类条目。→ Phase 4 做账本时定：保留显示（钱确实花了）还是改用软删除。
- [ ] **方案列表没有排序入口** —— `sort_order` 字段已建（且删除时故意不重排，避免全表 UPDATE），但只能按创建顺序追加。方案不多时无感。
- [ ] **`ApiProfilePublic.hasKey` 现在是冗余字段** —— 可由 `keySource !== 'missing'` 完全推导。保留是为了不破坏既有契约（切片一的脚本与文档都在用）。
- [ ] **`LlmRegistry` 每次调用都读 DB** —— 本地 SQLite 是微秒级、方案改动低频，暂无影响。若日后出现「每次请求都枚举方案」的路径（如多方案自动路由），再评估加一层缓存。

---

## 任务记录（按时间顺序追加）

### T-001 · 2026-09-22 · Phase 0 收尾

**上下文**：上一会话已把 Phase 0 代码写完（含 MCP Gateway、诊断表、健康端点），但**从未在浏览器里验收过**、Phase 0 也没收口，就此中断。

**已完成**

1. **浏览器实测验收**（即原中断点）：用无头 Edge + CDP 裸驱动跑通 —— `/` 正确重定向 `/chat`；五路由 + `/home/:module` 全部渲染、底部导航高亮正确；主题切换 → 刷新 → 保持深色；新建会话落库、刷新后仍在列表；发送占位提示正常；设置页确认后端真实接通（`habitat-server 正常` + `nocturne ready / 1 个工具`）。**控制台零异常**。
2. **修 bug · 深色主题刷新后静默失效**：`web/src/theme/useTheme.ts` 裸读 `localStorage.getItem('habitat-theme')` 当主题值，而 zustand `persist` 存的是 `{"state":{"mode":…}}` 包裹结构 → `data-theme` 被赋成一坨 JSON 字符串，`[data-theme='dark']` 永远匹配不上。改法：删掉裸读，用 `onRehydrateStorage` 把持久化值写回 DOM + `useTheme.subscribe`，让 **store → DOM 单向同步**。
3. **修 bug · 本地 SQLite 会被提交进仓库**：`.gitignore` 漏了 `server/data/`。补 `server/data/*` + `!server/data/.gitkeep`。
4. **文档收口**：`docs/CHANGELOG.md` 补 Phase 0 记录；`docs/API.md` 从纯占位改为记录两个已实现端点（含 `ApiError` 形状与 `state` 取值）；`AGENTS.md` §1 / §2 / §6 同步。
5. **提交**：`f243daa docs: 建立 AI 工作入口…`、`380832a feat(phase0): 可视化三件套…`（仅本地，未推送）。

> 变更正文见 `docs/CHANGELOG.md` 的「Phase 0 · 可视化三件套 + MCP Gateway 最小可用」。

**本任务沉淀的待优化**：高 3 条 + 中 4 条 + 低 1 条，已全部录入上方汇总清单。

**复现 / 验证命令**：`npm run typecheck`、`npm run build`；三件套 `npm run dev:mock-mcp`（:3333）+ `npm run dev:server`（:3000）+ `npm run dev:web`（:5173）。

---

### T-002 · 2026-09-22 · 建立「任务记录 + 待优化清单」规范

**已完成**

1. 新增 `docs/TASKS.md`（本文件）：把「已完成的要点」与「**所有**待优化项」集中一处，按任务顺序追加。
2. `AGENTS.md` 同步：§0 四步收尾流程、§2 文档地图、§6 维护约定都补上「每次任务先追加 TASKS.md」；文件头「发现问题只记录」改为**明确指向本文件**（原先没说记到哪）。
3. 把 T-001 沉淀的 8 条待优化按高 / 中 / 低录入汇总清单。

**待优化**：无新增（本条本身是文档规范调整）。

---

### T-003 · 2026-09-22 · Phase 1 切片一：通用 OpenAI 兼容层

**范围**：北北拍板「先做通用 OpenAI 兼容层」。依据技术方案 §7.1（`LLMProvider` 以 OpenAI Chat Completions 兼容协议为最小公分母）与 §6.2（`ApiProfile` 实体）。

**已完成**

1. **`shared` 契约**（`providers.ts` / `types.ts` / `errors.ts`）
   - `LLMProvider`：`streamChat(messages, opts) → AsyncIterable<LlmStreamChunk>` + `listModels()`
   - `LlmStreamChunk` 只有三种：`delta`（正文 / 思维链 / tool_calls 增量）、`usage`、`done`；顺序保证 delta → usage → done
   - `ApiProfile`（baseUrl + keyRef + modelMap + headers + isActive）与**脱敏视图** `ApiProfilePublic`
   - 新增 4 个错误码：`PROVIDER_NOT_FOUND` / `PROVIDER_NOT_CONFIGURED` / `PROVIDER_UNAUTHORIZED` / `PROVIDER_UPSTREAM_ERROR`
2. **`OpenAICompatProvider`**（`server/src/providers/openai-compat.ts`）
   - 只用 `fetch` + 自写 SSE 解析，**不引第三方 SDK**（更好控错、更好排障）
   - 认 `reasoning_content`（DeepSeek-R1 式思维链）、`usage`、`tool_calls` 分片；`[DONE]` 收口，上游漏发 `finish_reason` 也保证 `done` 恰好一次
   - **空闲超时**：60s 没有新数据即中断——防「假死」而不是让调用方无限等
   - 建连超时用**自有 controller**，拿到响应头就解除计时（用 `AbortSignal.timeout` 会掐住响应体、误杀长回复）
   - `AbortSignal` 取消；非 2xx 映射到带错误码的 `ProviderError`，401/403 单列
3. **`LlmRegistry`**（`server/src/providers/registry.ts`）：方案装载 + Adapter 工厂 + 脱敏视图；坏配置**只跳过并告警**，不阻塞启动
4. **三条路由**（`server/src/routes/providers.ts`）：`GET /api/providers`、`GET /api/providers/:id/models`、`POST /api/providers/:id/test`（探测失败是「结果」不是异常，与 `/api/health/mcp` 一致）
5. **密钥模型**：方案里只存 `keyRef`（**环境变量名**），真值只活在服务端进程环境，**永不下发前端**；`headerNames` 同理只给名字（部分中转把凭证放自定义头）→ 落实铁律 3
6. **验收**：`src/providers/mock-openai.ts`（:3334，含「无鉴权 → 401」分支，SSE 故意按 3 字节切片以验证解析不依赖整包）+ `scripts/probe-llm.ts` —— **20 项断言全过**；三条路由 + 错误码 + 404 路径实测通过
7. **顺带修清单里的「高」#1：服务端不读 `.env`** —— 它正好卡在本切片关键路径上（方案本来就靠环境变量配），不修则文档写了也白写
8. **`server/tsconfig.json` 的 `include` 补上 `scripts`** —— 此前 `scripts/` 完全没被类型检查覆盖，是个静默真空

**本任务新增待优化**：中 3 条（Node ABI 约束机器化 / `stream_options` 兼容开关 / `.env` JSON 须单行）、低 3 条（`hasKey` 文案歧义 / `modelMap` 次要槽位未消费 / `ApiProfile` 权威存储仍是临时方案），已录入上方汇总清单。

**环境坑（已写进 README，别再踩）**

- 我的 shell 默认 Node 22，而 `better-sqlite3` 是为北北的 **Node 20** 编译的 → 用 Node 22 启动 `server` 直接 `ERR_DLOPEN_FAILED`。**不要 `npm rebuild`**（会打断他正在跑的 :3000）。跑 server 一律用系统 Node 20。
- 本机 `http_proxy` 指向沙箱代理，curl 打本地端口要走 `--noproxy '*'`。

**验证命令**：`npm run typecheck`（两端）、`npm run build`；`npm --prefix server run dev:mock-openai` + `cd server && npx tsx scripts/probe-llm.ts`。

**下一步**：`POST /api/chat`（SSE，§7.2①）把 Adapter 接上 + 消息落库；前端消息渲染 / 流式 / 虚拟滚动；§6.3 版本与多候选建表。

---

### T-004 · 2026-09-22 · Phase 1 切片二：本地存储的聊天链路（SSE 端到端）

**范围**：北北拍板「按 §6.2 本地存」—— 服务端纯中转、不落聊天记录。依据 §7.2①（聊天链路）、§6.2 / §6.3（数据模型与两次提前量）、§9 风险2（反代缓冲）与风险8（长会话性能）。

**已完成**

1. **`shared` 聊天流契约**（`events.ts`）：`ChatStreamRequest`（历史由前端组装送来）+ 四种事件载荷 `chat-delta` / `chat-usage` / `chat-done` / `chat-error`
2. **`POST /api/chat`（SSE）**（`server/src/routes/chat.ts`）
   - 三件事：**校验 → 转发 → 记账**；完整上下文组装（世界书 + Eventide 状态卡 + Nocturne 召回）留给 Phase 3，届时在服务端侧插入，接口形态不变
   - **关键设计：先取到上游第一个 chunk 才写响应头。** `streamChat` 是 async generator，函数体到第一次 `next()` 才跑，于是「密钥没配 / 上游不可达 / 鉴权被拒」这些都暴露在写头之前 → 走统一 `ApiError` + 4xx/5xx；**只有流开始之后**的故障（空闲超时、传输中断）才走 `chat-error` 事件。前端因此不必为「HTTP 200 但流里带错误」另备判错分支
   - 响应头带 `x-accel-buffering: no` + `cache-control: no-transform`（对策 §9 风险2）；客户端断开 → `res.on('close')` 里 abort 上游，不白烧 token
   - `reply.hijack()` 自己写响应（Fastify 要等 handler 返回才发头，流式必须立刻发）
3. **用量落表**（`db/schema.ts` + `db/index.ts` + `db/usage.ts`）：新增 `usage_record` 表（§6.2「每次调用强制落一条」）。上游没回 usage 时**按 0 落一条**（保证「这轮发生过」有据可查）；**没跑成则不记**（记的是消耗，不是尝试）；`day_key` 用**本地时区**（按天聚合不能跟用户看到的「今天」错开）
4. **前端 SSE 客户端**（`web/src/lib/chatStream.ts`）：`EventSource` 只支持 GET 而聊天要 POST，所以用 `fetch` + `ReadableStream` 自写 SSE 解析（空行分帧、`event:`/`data:` 取值、兼容 `\r\n`、末尾 flush）
5. **本地仓储层**（`web/src/db/chat.ts`）+ **Dexie `version(2)`**：补 `[sessionId+createdAt]` 复合索引，让「按时间取最近一页」不必先取回全部再内存排序（§9 风险8 的前提）。页面不再直接碰 Dexie
6. **聊天窗口端到端**（`ChatWindowPage.tsx`）：真实发送 → 流式累加渲染 → 中止（保留已收内容并标记「（已停止）」）→ 错误提示 → 首条消息自动命名会话 → 回车发送（**处理了中文输入法的 `isComposing`**，否则选词回车会把一句话切两半）
7. **自写虚拟列表**（`web/src/components/VirtualList.tsx`）：不定高（实测高度缓存 + 二分定位 + overscan + 贴底自动跟随）。高度缓存键用 **item key 而非下标**，为日后向上加载更早一页留了余量
8. **顺带修清单「高」#3**：底栏高度提为 token `--bottom-nav-height`；会话窗口改为**沉浸式**（不渲染底部导航）
9. **验收**：接口层 7/7（正常流 9 个事件顺序正确 + 5 类错误分支 + `usage_record` 落表实测）；前端 13/13（无头 Edge + CDP，含虚拟列表「渲染 13 条 / 已加载 60 条」）；两端 `typecheck` + `build` 通过；控制台零异常

**排查中发现的真 bug（截图才暴露）**

- **fixed 底栏盖住聊天输入区**：会话页原先只改了滚动容器，没考虑 `BottomNav` 是 `position: fixed` —— 输入框被压在导航栏底下。修法即上面第 8 条（沉浸式 + 移除底栏）。

**本任务新增待优化**：高 1 条（流式回复只在内存，刷新即丢）、中 6 条（虚拟列表 prepend 跳位 / 块渲染只支持 text / 分页游标未接 UI / 重roll 无出口 / 删会话无确认 / Home 标题）、低 3 条（底栏高度是估值 / 思维链无长度上限 / 验收断言绑定 mock 文案），已录入上方汇总清单。

**沉淀**：验收脚本收进 `web/scripts/verify-chat.mjs`（含前置条件说明），下次改聊天链路可直接复用。

**验证命令**

- 两端：`npm run typecheck` + `npm run build`
- 接口：`npm --prefix server run dev:mock-openai`（:3334）+ 起 server（.env 指向 mock 上游），`curl -N -X POST /api/chat`
- 端到端：`node web/scripts/verify-chat.mjs`（四件前置见文件头注释）

**下一步（Phase 1 剩余）**：设置页 API 方案管理 UI → 消息块按 `kind` 分发 → 分页加载更早消息 → 诊断日志查看。

---

### T-005 · 2026-09-23 · Phase 1 切片三：API 方案管理 UI

**范围**：Phase 1 最后一块 —— 让方案能在界面上管，不必手写 `.env` 里那行 JSON。依据 §6.2（ApiProfile 实体）、§7.1（多方案管理）。

**已完成**

1. **方案权威源从环境变量换成服务端 SQLite**
   - 新增 `api_profile` / `api_secret` 两表。**凭据独立成表**：任何「读方案」的代码路径都不可能顺带读出密钥，日后做备份导出也能只导配置不导凭据
   - `HABITAT_LLM_PROFILES` 降级为**首次种子**（仅在表为空时导入一次）。这样切片一/二里北北已配好的方案不会凭空消失，而之后以数据库为准（启动日志明说，避免「改了 `.env` 没反应」的困惑）
   - `LlmRegistry` 换成读 DB，**对外接口一字未改** —— 路由与聊天链路零改动
2. **`db/profiles.ts` 仓储层**：CRUD + 凭据读写 + `activate` 互斥 + 种子导入
   - 删掉默认方案 → 自动把剩下第一条顶为默认（不出现「有方案但没有默认」的空窗）
   - `id` 由名称派生：**中文字符原样保留**（`ui-方案`、`本地测试上游`），冲突加 `-2`。第一版用时间戳兜底得到 `p-muda8ngu` 这种不可读的 id，意识到它会出现在 `usage_record.profile_id` 与日志里，改掉了
3. **凭据模型**：优先级 **`stored` > `env`**，于是 UI 能为已按环境变量配好的方案补填密钥（覆盖生效），而不必把密钥搬进库里
4. **五个新端点**（`server/src/routes/providers.ts`）：`POST /api/providers`、`PATCH /:id`、`DELETE /:id`、`POST /:id/activate`、`PUT|DELETE /:id/secret`。**密钥只进不出** —— 没有任何端点会把它读回来，前端永远只能拿到 `hasKey` / `keySource`
5. **`keySource` 字段**（`shared`）：`stored` / `env` / `missing` / `not-required`，解决清单里「`hasKey` 把『不需要密钥』和『已配好』混为一谈」那条
6. **设置页 UI**（`web/src/features/providers/`）：列表（含凭据来源文案与探测结果）+ 行内表单 + 测试连接 + 设为默认 + 两步删除
   - 表单主路径只暴露「名称 / Base URL / 模型 / API Key」，`keyRef` 收进折叠的「高级」—— 「环境变量名」摆在主路径上只会让人犹豫该往哪填
   - DeepSeek / OpenAI / 本地 Ollama 三个**快捷填充**，省得手打 baseUrl
   - 删除用**两步确认**而不用 `window.confirm`：原生弹窗会阻塞页面、在无头浏览器里还要额外处理，两步确认同样拦得住误触
7. **验收**
   - `server/scripts/probe-providers.ts`：**46/46**（含「写进去的密钥绝不出现在任何响应里」的 4 处断言、凭据完整生命周期、删除后 active 自动转移、5 类字段校验）
   - `web/scripts/verify-providers.mjs`：**22/22 且连跑两次均通过**（可重复性）
   - `scripts/probe-llm.ts` 扩到 **27/27**，改为走真实 DB 路径
   - 两端 `typecheck` + `build` 通过，控制台零异常

**排查中发现的真问题**

- **验收脚本的竞态**：只等「API 方案」标题出现就开始读 `innerText`，会读到列表还在「读取中…」的空壳 —— 第一次跑抢赢了、第二次就 FAIL。改成等列表真正渲染完。这是同一个坑的第二次（切片二是「reload 后旧 DOM 骗过轮询」），已把通则补进 `headless-cdp-verify` 技能：**等数据渲染完，而不是等容器出现**。
- **`probe-llm.ts` 因换数据源而失效**：它原先把 profiles 注入构造函数，而 registry 现在读 DB。改成「设临时 `HABITAT_DB_PATH` → 顶层 await 动态 import → 走真实种子导入路径」。顺带让「表为空 → 种子导入」这条路径每次都被真实覆盖。

**本任务新增待优化**：中 4 条（密钥明文存储的备份风险 / 删光方案后重启种子复活 / 表单未接「选模型」下拉 / `headers` 没有 UI 入口）、低 4 条（账本 profile_id 孤儿 / 无排序 UI / `hasKey` 冗余 / registry 无缓存），已录入上方汇总清单。

**验证命令**

- 两端：`npm run typecheck` + `npm run build`
- 方案路由：起 `dev:mock-openai`（:3334）+ server，`cd server && npx tsx scripts/probe-providers.ts`
- 方案 UI：四件套后 `node web/scripts/verify-providers.mjs`

**下一步（Phase 1 收尾）**：消息块按 `kind` 分发 → 分页加载更早消息 → 消息「重发 / 换一个」→ 诊断日志查看页。

---
