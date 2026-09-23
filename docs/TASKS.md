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
- [x] ~~**`web` 缺备份导出**~~ —— 已修（T-008）：新增 `web/src/lib/backup.ts` + `features/backup/BackupPanel.tsx`。导出物是自描述 JSON（带 `format` / `version` / `exportedAt`），导入是**整体替换**语义且**先全量校验再动库**（校验不过一行都不写，不留半导入状态），导入走单个 Dexie 事务。设置页给两步确认，不用原生 confirm。
- [x] ~~**流式中的回复只活在内存，刷新即丢**~~ —— 已修（T-008）：`ChatWindowPage` 先落一条 `status='streaming'` 的草稿，流式增量按 **800ms 节流**合并写回，收尾一次性定性（内容 + 状态 + 思维链）。进页面时把「上一轮留下的 streaming 草稿」标成 `aborted`；失败换来的空回复直接删掉，不留垃圾记录。

### 中 —— 体验与一致性

- [x] ~~**聊天窗口避让底栏用的是魔法数字**~~ —— 已修（T-004）：底栏高度提为 token `--bottom-nav-height`，且会话窗口改为沉浸式（不渲染底栏，见 T-004）。
- [x] ~~**虚拟列表接「向上加载更早消息」后会跳位**~~ —— 已修（T-006）：改成**锚点补偿** —— 记上一帧的 `offsets`/`keys`，首项换人且用户未贴底时，用「盖住视口顶部的那一项」当锚点，按它在新几何里的位置重设 `scrollTop`。锚点用 item key 而不是下标。实测向上插入一页后 `scrollTop=3840`（若补偿失效会停在 0）。
- [x] ~~**`ChatMessage.blocks` 只渲染 `text`**~~ —— 已修（T-006）：`MessageBlock` 改成可辨识联合并补齐 8 种 kind 的载荷契约，新增 `features/chat/MessageBlocks.tsx` 按 kind 分发（5 种真渲染 / 3 种明确占位 / 未知 kind 降级占位）。
- [x] ~~**`listMessagesPage` 的分页游标没接 UI**~~ —— 已修（T-006）：聊天页滚到顶自动加载更早一页（`onReachTop` + 同步守卫防重复请求）。
- [x] ~~**发送失败 / 想换一个回答时没有出口**~~ —— 已修（T-006）：抽出 `runGeneration` 供 发送 / 重发 / 换一个 复用；气泡下方给 `‹ n/N ›` 候选导航、「换一个」、「重发」，版本历史落在 `candidates` 上并跨刷新保持。
- [x] ~~**分页游标的 `createdAt` 撞毫秒会漏条**~~ —— 已修（T-008）：Dexie 升到 `version(3)`，复合索引换成 `[sessionId+createdAt+id]`，游标改成 `{createdAt, id}`。三元组整体是「不含上界」语义，于是「同毫秒按 id 续取」成为索引的天然行为，不必在应用层特判。已确认全仓没有别处还依赖旧的 `[sessionId+createdAt]`（只会随 v3 重建被删掉）。
- [x] ~~**会话删除无确认**~~ —— 已修（T-008）：列表页点 ✕ 先进入「确认删除？」，再点一次才真删；3 秒无操作自动退回普通态，避免列表里长期挂着一个确认按钮。
- [x] ~~**Home 子模块标题显示原始 key**~~ —— 已修（T-008）：抽出 `features/home/modules.ts` 作**单一来源**，入口列表与子页标题都从它取；手输未知 key 时退回显示原 key 而不是空白。
- [x] ~~**原生模块 ABI 与 Node 版本绑定**~~ —— 已修（T-008）：仓库根加 `.nvmrc`（`20`）、`server/package.json` 加 `engines.node: "^20"`；`server/src/index.ts` 拆成**纯版本门禁**（`main.ts` 装应用本体，用动态 `import()` 保证检查先于一切原生模块），版本不符给一句人话再退出，不再让 `ERR_DLOPEN_FAILED` 炸出栈。⚠️ 解析 `engines` 时**不能把 `<` 上界当允许值** —— `>=20 <21` 会被解析成 `[20, 21]` 而放行 Node 21，故 `engines` 统一写成 `^20`，解析函数只取 `<` 之前的部分。
- [x] ~~**`stream_options` 可能被上游拒绝**~~ —— 已修（T-008）：`api_profile` 加 `stream_options` 列（缺省 `1`，老库靠「缺则补」的 ALTER 演进），全链打通 —— 仓储四个读写点（`toProfile` / `createProfile` / `updateProfile` / `importProfiles`）、env 种子解析、脱敏视图 `ApiProfilePublic.streamOptions`、适配器按方案决定是否带字段、路由 `POST` / `PATCH` 校验布尔值、表单「高级」区给开关。验收直接断言**真实报文**（mock 上游的 `GET /__last-body`）：缺省带 `{"include_usage":true}`、关掉后报文里没有该键、改回开又带上。
- [ ] **`.env` 里的 JSON 必须写成单行** —— 极简解析器逐行读，把 `HABITAT_LLM_PROFILES` 的 JSON 换行美化会被截断成非法 JSON。报错文案里已点明「请写成一行」。（T-005 起该变量只在**种子导入**时相关，影响面已缩小。）
- [x] ~~**`favicon.ico` 404**~~ —— 已修（T-008）：`web/index.html` 里内联一个 emoji（🌿）的 SVG data URI 图标，零文件、零请求。
- [x] ~~**React Router v7 future flag 警告**~~ —— 已修（T-008）：显式开 `v7_relativeSplatPath`（`createBrowserRouter`）与 `v7_startTransition`（`RouterProvider`），控制台噪音消失。
- [x] ~~**服务端 CORS 全开**~~ —— 已修（T-008）：`main.ts` 读 `CORS_ORIGIN`（逗号分隔），设了就按白名单收紧，没设才退回「反射任意来源」。⚠️ **默认仍是全开**（本地开发的便利），所以**上线前必须在 `server/.env` 里设好**，`.env.example` 已补该段与示例。
- [ ] **密钥在 SQLite 里是明文** —— `api_secret.secret` 直接存原文（个人自用单机，不做加密）。真正的风险点是**备份**：直接打包 `server/data/` 会把密钥一起带走。→ 做「导出 / 备份」功能时必须提供「**不含凭据**」选项（拆表就是为这个留的口子：只导 `api_profile` 即可）。
- [x] ~~**删光所有方案后重启，`.env` 里的种子会复活**~~ —— 已修（T-008）：新增 `server/src/db/kv.ts` 读写 `app_kv` 表，`importProfiles` 的判据换成持久标记 `llm_profiles_seeded`，**与表里现存条数无关**。升级路径也照顾到：老库若已有方案，这一轮会**补写**标记，否则下次他清空方案重启时同样的「复活」还会发生。
- [ ] **方案表单没接「选模型」下拉** —— `GET /api/providers/:id/models` 早已就绪，但表单里模型名只能手打，很容易打错。→ 表单里加「从上游拉取模型列表」并给候选。
- [ ] **`headers` 自定义请求头没有 UI 入口** —— 后端支持写入（`POST` / `PATCH` 都收），但前端表单没暴露。部分中转把凭证塞在自定义头里，这类用户目前只能走环境变量方案。→ 表单「高级」区补一个键值对编辑器。
- [ ] **诊断表只增不减** —— `mcp_diagnostic_log` 没有任何清理 / 归档 / 保留策略，每次查询还要全表 `count(*)`。MCP 一旦真跑起来（每次工具调用都落一条）它会持续长大。→ 定保留策略（按条数或天数裁），或给一个「清空」入口。
- [ ] **诊断面板不会自己刷新** —— 排查时得手点「刷新」；也没有「最近 N 分钟」这类时间范围筛选。→ 需要时加自动刷新开关 + 时间范围。
- [ ] **`direction: 'in'` 没有生产者** —— 表、类型、UI 都留了这个取值，但 Gateway 的四处 `insertMcpDiagnostic` **全是 `'out'`**，所以「响应方向」的记录从来没被写进去过，等于一段永远为空的分支。→ 要么补上响应侧记录（需要比 SDK 更底层的钩子），要么收窄契约并说明。
- [ ] **诊断里的 `httpStatus` 恒为 null** —— 官方 SDK 的 transport 不暴露 HTTP 状态码，所以这一列目前零信息量（UI 已按「无值不显示」处理）。→ 真需要它就得自己包一层 fetch，成本不低，先记着。
- [ ] **诊断面板没有折叠** —— 记录多时会把设置页拉得很长；超长的错误原文也只是 `break-all` 撑开行，没有折叠或截断。
- [ ] **诊断保留策略只在启动时裁一次** —— `pruneMcpDiagnostics` 挂在启动流程上，且 `MCP_DIAGNOSTIC_RETENTION` 是**写死的常量**。长期不重启的进程表可以涨过上限；想调小或调大只能改代码。→ 需要时补 env 开关（如 `HABITAT_MCP_DIAG_KEEP`）与「每天裁一次」的定时任务。
- [x] ~~**备份下载时 `URL.revokeObjectURL` 紧跟 `click()`**~~ —— 已修（T-009）：改为下一个事件循环再释放，避免 Firefox / 大文件被提前截断。
- [ ] **验收脚本对环境前提有隐含依赖** —— 已抓到的两类：`probe-providers.ts` 原先断言「新建方案不抢默认」，隐含假设库里已有默认方案，在**空库**上必然假失败（已改成显式造出前提）；`verify-providers.mjs` 则明确要求库里已有一个带密钥的种子方案（靠 `.env`）。→ 新脚本一律把前提**写进断言或自建**，别依赖环境碰巧的样子。
- [ ] **相册用 data URL 存原图，容量增长较快** —— 现阶段单张已限 3 MB、格式白名单并校验真实 base64 体积，但 base64 本身约有 33% 膨胀，导出的 JSON 也会把原图一起带上。→ 真实照片量上来后改 Blob / OPFS + 缩略图，并补总容量提示；切换存储前必须先做无损迁移与备份兼容。

### 低 —— 开发工具与体验毛刺

- [ ] **统一收藏目前只有“外部链接”生产入口** —— `Bookmark` 已按 `targetType + targetId` 建模，但聊天消息 / 日记 / 留言等页面尚未提供“收藏”按钮；等对应交互确定后逐个接，不在收藏页伪造跨模块关系（T-010）。
- [ ] **Home 第一批没有编辑 / 手动排序** —— 留言、愿望与倒数日目前只覆盖新增 / 状态 / 删除，真实使用中出现需求再补（T-009）。
- [x] ~~**`--bottom-nav-height` 是估的 4rem**~~ —— 已修（T-008）：`BottomNav` 用 `ResizeObserver` 实测自身高度后写回 `--bottom-nav-height`，改图标 / 字号自动跟随，不再需要手动同步。
- [x] ~~**思维链整段存进 `metadata.reasoning`，无长度上限**~~ —— 已修（T-008）：`db/chat.ts` 加 `capReasoning()` / `REASONING_LIMIT = 32000`，超限保留头尾并插入截断说明（头尾各半 —— 开头是推理起点、结尾是结论，中间最适合丢）。写入路径（`addVersion`、流式草稿、收尾定性）统一走它。
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
- [ ] **`html` / `widget` / `tab-group` 三种块目前只有占位** —— 渲染器已按 kind 留好分支，内容是「未启用」提示。接「小部件」（Phase 5）时落地：**必须**用 `sandbox=""` 的 iframe 或净化器，**绝不能** `dangerouslySetInnerHTML`（内容来自 LLM）。验收脚本里已埋一条断言盯着这点（渲染 html 块后页面上不应出现注入的 `<b>`）。
- [ ] **`tab-group` 里不能再嵌块组** —— 块里套块组会形成递归类型，Dexie 的键路径推导（`KeyPaths`）展开递归会报 `TS2615`，故 tab 内只允许叶子块（`LeafMessageBlock`）。真要支持任意嵌套，得连同存储层一起重新设计。
- [ ] **首屏不足一屏时无法触发向上加载** —— 「加载更早」挂在滚动事件上，若内容比视口还短就永远没有滚动事件。实践中一页 60 条必然超过一屏，故未处理。→ 真要处理：首屏渲染后量一次 `scrollHeight`，不足则直接续拉。
- [ ] **「换一个」只给最后一条 AI 回复** —— 改中间那条会让后续对话与它脱节（要么连带截断后续消息，要么放任不一致）。若日后要支持，得先定「之后的消息怎么办」。
- [ ] **候选版本没有删除入口，`origin: 'edit'` 也没有生产者** —— 版本只能靠 8 条上限自动淘汰；「手动编辑消息」功能未做，所以 `edit` 这个来源目前是空跑。
- [ ] **诊断相关：三个同形状的异常类** —— 新增的 `RequestError` 与既有的 `GatewayError` / `ProviderError` 只差一个「属于哪个子域」，错误处理器里要并列写三个 `instanceof`。→ 等第四个出现时合成一个基类（或让后两者继承它）。
- [ ] **诊断时间线不显示年份** —— 固定 `MM-DD HH:mm:ss.SSS`，跨年时看不出是哪年。
- [ ] **`probe-diagnostics.ts` 依赖「脚本与 server 用同一个 `HABITAT_DB_PATH`」** —— 对不上时会明确报错提示，但仍需人工对齐（脚本没有自己去问 server「你的库在哪」的手段）。
- [ ] **流式草稿的并发 flush 有理论上的乱序风险** —— 每次落库写的是**当前完整正文**（不是增量），若两次 flush 的写入真正并发且先后颠倒，库里可能短暂落后于最新内容。800ms 节流让两次 flush 至少隔这么远（IndexedDB 单次写入远快于此），且收尾还会 force 写一次，所以实践中撞不上。→ 真要做严就串行化 flush（排队 + 只保留最后一次）。
- [ ] **「重新从 `.env` 导入方案」没有入口** —— `app_kv` 的标记一旦写上就永久生效，改了 `HABITAT_LLM_PROFILES` 也不会再导。这本就是「DB 即权威」的应有之义，但用户想推倒重来时只能手动清库。→ 真要给，就在设置页放一个「重新导入环境变量种子」按钮（明确提示会做什么）。

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

### T-006 · 2026-09-23 · Phase 1 切片四：消息块分发 + 分页加载 + 重发 / 换一个

**范围**：把聊天窗口补成「能长久用」的形态。依据 §6.2（`MessageBlock` 可扩展块 / `MessageCandidate` 多候选）、§6.3（两次提前量）、§9 风险8（长会话性能）。

**已完成**

1. **块渲染从「只有 text」变成「按 kind 分发」**
   - `shared/types.ts`：`MessageBlock` 从 `{ kind, payload: unknown }` 改成**可辨识联合**，8 种 kind 各定载荷契约。这一步的价值不只是类型好看 —— switch 一下 payload 就自动收窄，渲染器里那层 `as { text: unknown }` 的运行时校验可以整段删掉
   - 新增 `web/src/features/chat/MessageBlocks.tsx`：`text` / `image` / `audio` / `file` / `tool-result` 真渲染；`html` / `widget` / `tab-group` 给**明确占位**（写清「未接入」而不是留空白，免得下一个人以为是漏写）
   - `html` 刻意不渲染：内容来自 LLM，直接 `dangerouslySetInnerHTML` 等于开门；等 Phase 5 做沙箱时再说
   - 运行时兜底：遇到不在联合里的 kind（旧版本读到新版本写的数据）降级成占位块 —— IndexedDB 不校验结构，未知数据不该让整页崩掉
2. **分页加载更早消息 + 虚拟列表向上插入的锚点补偿**
   - 虚拟列表新增 `onReachTop`；**补偿逻辑放在组件内部**（它自己就能识别「首项换人」＝向上插入），用「盖住视口顶部的那一项」当锚点还原 `scrollTop`，锚点用 item key 不用下标
   - 聊天页接 `listMessagesPage` 的 `before` 游标；`loadingEarlierRef` 做同步守卫（贴顶时回调会连着触发，state 更新是异步的，只靠 state 拦不住重复请求）
3. **「换一个」与「重发」出口**
   - `db/chat.ts` 新增 `addVersion` / `selectCandidateVersion`，把 `candidates` 真正用起来；首次换一个会把「当前正文」也登记成版本，否则无从切回上一版
   - `ChatWindowPage` 抽出 `runGeneration(history, targetId)`：发送 / 重发 / 换一个共用同一条生命周期，差别只在「结果写到哪」
   - 新增 `historyUpTo(messages, upToIndex)` 把「同一轮」钉住 —— 换一个时若不截断历史，等于让模型接着自己刚写的那段往下续
   - 气泡下方：`‹ n/N ›` 候选导航、「换一个」（仅末条 AI 回复）、「重发」（末条是用户消息 = 这一轮压根没拿到回复）
4. **验收**：`verify-chat.mjs` 从 13 项扩到 **35 项全过**；`verify-providers.mjs` 回归 22 项全过；两端 `typecheck` + `build` 通过，控制台零异常
   - 分页实测 `scrollHeight 3408 → 6934 → 7334`，且向上插入后 `scrollTop=3840`（补偿生效的直接证据）
   - 用量取证：一轮聊天 + 中止 + 换一个 + 重发共落 `usage_record` **4 条** —— 证明后两者确实各发起了一次上游调用，而不是只改了 UI

**排查中发现的真问题**

- **`TabGroupBlock` 的递归类型击穿 Dexie 的键路径推导**：`tabs[].blocks` 声明成 `MessageBlock[]` 会形成递归，Dexie 的 `KeyPaths`（`web/src/db/db.ts` 的 `Table<ChatMessage>`）展开时报 `TS2615`。改成 tab 内只放叶子块（`LeafMessageBlock`）解决，并把这条约束记进待优化。
- **验收脚本的 fixture 耦合**：`verify-providers.mjs` 把种子方案的显示名写死成 `Mock 上游`（切片三那次 `.env` 里的名字），这回换了个 `.env` 就整条挂掉。改为从 `GET /api/providers` 现取，没有方案时明确提示。**通则：脚本别写死 fixture 的显示名，从接口取。**
- **虚拟列表的 `block` 只在「首项换人」时才补偿**：会话切换（整段替换）也会命中这个条件，靠「锚点项在新 keys 里找不到就跳过」兜住。已写进代码注释，避免后人误改。

**本任务新增待优化**：中 1 条（分页游标撞毫秒会漏条）、低 5 条（三种块仍是占位 / `tab-group` 不能嵌套 / 首屏不足一屏无法触发加载 / 「换一个」只限末条 / 候选无删除入口且 `edit` 空跑），已录入上方汇总清单。同时勾掉中 4 条。

**验证命令**

- 两端：`npm run typecheck` + `npm run build`
- 端到端：四件套后 `node web/scripts/verify-chat.mjs`（35 项）、`node web/scripts/verify-providers.mjs`（22 项）
- ⚠️ 两个脚本共用同一后端与同一浏览器，串行跑；分页段落用 `Emulation.setDeviceMetricsOverride` 拉高视口，否则虚拟列表不会渲染全部块消息，断言会假失败

**下一步（Phase 1 最后一块）**：诊断日志查看页（`mcp_diagnostic_log` 已有数据，缺查询端点 + 设置页时间线）。

---

### T-007 · 2026-09-23 · Phase 1 切片五（收尾）：诊断日志查询 + 设置页时间线

**范围**：Phase 1 最后一块。依据 §7.2②（诊断中间件全量留痕 → 逐请求可回放）与 §8（设置页）。此前表已在写，但**从没人读过** —— 有数据、没出口，等于排障时还得去翻 SQLite。

**已完成**

1. **共享契约**（`shared/types.ts`）：`McpDiagnosticEntry` / `McpDiagnosticQuery` / `McpDiagnosticPage`。查询条件全部可选，`handshake` 用**三态**表达（`undefined` 全部 / `true` 仅握手 / `false` 仅工具调用）
2. **仓储层**（`server/src/db/diagnostics.ts`）：读写收口在一个文件，路由只做参数校验
   - 查询按 `id` 倒序（最新在前），`orderBy(desc(id)) + limit(limit+1)` —— **多取一条判断 `hasMore`**，省掉一次只为「还有没有」的 `count(*)`
   - **游标（`before`）不参与计数**：`total` / `errorCount` 说的是「符合筛选的记录有多少」，把游标算进去会让用户每翻一页就看到数字变小，像是日志在被删
   - `total` 与 `errorCount` 合并成**一次**聚合查询（`count(*)` + `sum(case when error is null then 0 else 1 end)`），不是两次扫表
3. **索引**（`server/src/db/index.ts`）：`(server_id, id)` / `(handshake, id)` + 一个 `error IS NOT NULL` 的**部分索引**（绝大多数记录 error 为空，只给有错的那少量行建索引才划算）
4. **新端点**（`server/src/routes/diagnostics.ts`）：`GET /api/diagnostics/mcp?serverId=&handshake=&errorsOnly=&limit=&before=`
   - 只读，字段**原样下发**：诊断日志是排障证据，在服务端做二次解释会让「页面看到的」和「库里存的」对不上
   - 参数校验从严：`limit` 1–200、`before` 正整数、布尔字面量、**同名参数重复传直接拒**（会被解析成数组，静默取第一个只会埋雷）
   - `serverId` 传不存在的服务**不是错误** —— 它是筛选条件不是资源标识，返回空页
5. **新增 `server/src/lib/errors.ts` 的 `RequestError`** —— 原先参数校验类错误既不属于 `ProviderError` 也不属于 `GatewayError`，只能落到「未识别异常 → 500」，等于把「你参数写错了」报成「服务端崩了」。现接进统一错误处理器
6. **前端**（`web/src/lib/diagnostics.ts` + `web/src/features/diagnostics/DiagnosticPanel.tsx`）：设置页「诊断日志」时间线
   - 顶部统计行（共 N 条 / 其中 M 条有错 / 已载入 K 条）、三个筛选（服务 / 阶段 / 只看错误）、「加载更早的记录」
   - 每行给：毫秒时间戳、方向（→ 请求 / ← 响应）、方法（中文label + 原始 `tools/xxx`）、握手徽标、server、耗时、HTTP 状态；错误原文**逐字显示**（`break-all`）
   - 筛选与翻页**全部交给服务端**；翻页用「上一页最后一条的 `id`」当游标；筛选变化时清空旧数据（留着上一份数据配上新条件会让人误读）
   - 替换掉设置页原先的「诊断日志查看 —— 待接入」占位段
7. **验收**
   - `server/scripts/probe-diagnostics.ts`：**48/48，连跑两次通过**（排序 / 字段原样回传 / 三类筛选 + 组合 / 三段游标分页「不重不漏、跨页仍倒序、total 不缩小」/ 7 种非法参数 / 未知 serverId 空页 / 真实启动记录可见）。fixture 由脚本直连 SQLite 写入（WAL 下多进程可读写），按唯一 `server_id` 标记清理，真实记录一条不动
   - `web/scripts/verify-diagnostics.mjs`：**36/36**（首屏只拉一页且有「加载更早」/ 翻页补齐 + 到底收按钮 / 只看错误后无错行确实消失 / 仅握手与仅工具调用互补 / 组合筛选出空态 / 服务筛选 / 刷新 / 错误原文逐字 / 控制台零异常）
   - 两端 `typecheck` + `build` 通过

**排查中发现的真问题（都是脚本自己的时，但一样值得记）**

- **vite 默认绑 `localhost` → 在 Windows 解析到 `::1`**，验收脚本里用 `127.0.0.1` 打不开（`curl` 返回 `000`，而 vite 日志明明写着 listening）。→ 起 dev server 一律加 `--host 127.0.0.1`
- **断言把「渲染行数」当成了「总数」**：仅工具调用时渲染 30 行（一页）而总数 41，`4+30 !== 45` 直接挂。→ 比数字就比统计行里的 `total`，别比一页的行数
- **长流水线单条命令会超时被杀**（`SIGTERM` 且管道缓冲导致输出全丢，看起来像「什么都没跑」）。→ 后台任务 + 输出落日志文件，再用另一条命令 tail
- **`better-sqlite3` 的 ABI 与 Node 版本绑定**，而 CDP 验收要 Node ≥22 的内置 `WebSocket`。→ 验收脚本改用 Node 22 内置的 `node:sqlite`，两头都不欠

**本任务新增待优化**：中 5 条（诊断表无保留策略 / 面板不自动刷新 / `direction:'in'` 无生产者 / `httpStatus` 恒为 null / 面板无折叠）、低 3 条（三个同形状异常类 / 时间线不显示年份 / 探针依赖同一 DB 路径），已录入上方汇总清单。

**验证命令**

- 两端：`npm run typecheck` + `npm run build`
- 端点：`PORT=3100 HABITAT_DB_PATH=./data/probe.db npm run dev:server`，再 `cd server && npx tsx scripts/probe-diagnostics.ts`
- 端到端：起 server（隔离端口）+ vite（`--host 127.0.0.1`）+ 无头 Edge，`node web/scripts/verify-diagnostics.mjs`（前置见文件头注释）
- ⚠️ 验收用的端口要与北北正在跑的实例**隔离**（server 用 3200、vite 用 5274、CDP 用 9333），否则删库文件会让在跑的那个进程握着一个幽灵文件

**下一步（Phase 2）**：Home 生活模块（留言板 / 日记 / 相册…），依据技术方案 §8。

### T-008 · 2026-09-23 · 审查并收口一批未提交改动（Phase 1 收尾的补给）

**范围**：北北带来一批未提交改动（20 个文件，工作区脏、HEAD 仍是 `1729c1c`），要求审查。这批的意图是**顺着上方待优化清单收口**（Node ABI 机器化 / `stream_options` 开关 / CORS / 诊断保留策略 / 撞毫秒漏条 / 流式草稿 / 备份导出 / 模块名单一来源 / 删除确认 / favicon / bottom-nav 高度 / router future flags）。审查后按北北的选择「修阻断 + 补齐半截」执行。

**审查结论（修复前）：1 处阻断 + 2 处编译错 + 2 处「看着做了、其实没做」+ 2 处配置对不上 + 文档未同步**

1. **阻断（实测复现）**：`server/src/main.ts:8` 导入 `pruneMcpDiagnostics`，但 `db/diagnostics.ts` 里没有这个导出 → 启动即 `SyntaxError: The requested module './db/diagnostics.js' does not provide an export named 'pruneMcpDiagnostics'`（Node 20，退出码 1）。**服务端完全起不来**，不只是类型检查错
2. **编译错**：`providers/registry.ts` 的 `toPublic()` 没带新增的 `streamOptions`（TS2741）；`web/src/pages/chat/ChatWindowPage.tsx` 的 `addVersion(targetId, …)` 里 `targetId` 是 `string | null`（TS2345，运行时不崩 —— 逻辑上 `draftId === null` 与 `targetId !== null` 等价）。⚠️ `vite build` **不做类型检查**，前端那个错被「构建成功」掩盖，只有 `npm run typecheck` 看得见
3. **半截 1 · `streamOptions` 是死开关**：有列、有 ALTER、有 shared 类型；但 `db/profiles.ts` 四个读写点一行没碰、`openai-compat.ts` 仍硬编码该字段且注释还是旧的、前端无入口 → 老自建上游用户**依然关不掉**，清单里那条「中」级**没被真正解决**
4. **半截 2 · `app_kv` 无生产者**：`schema.ts` 注释已宣称「不能用『表为空』当判据」，但 `importProfiles` 仍是 `countProfiles() > 0` → 注释承诺的行为**没有发生**（注释与实现不一致，比不写注释更容易骗到后来的人）
5. **配置对不上**：`main.ts` 注释指「见 `server/.env.example`」但该文件**没有 `CORS_ORIGIN` 条目**；`engines` 写 `>=20 <21` 而解析函数用 `matchAll(/\d+/g)` → 解析出 `[20, 21]`，**Node 21 会被误放行**（ABI 一样是错的）

**已完成**

1. **补上缺失的保留策略**（`db/diagnostics.ts`）：`pruneMcpDiagnostics(keep = MCP_DIAGNOSTIC_RETENTION /* 5000 */)`，走**主键**水位线（`limit 1 offset keep-1` 定位第 keep 条，再 `DELETE WHERE id < 水位线`），不物化「要保留的 id 列表」；非法 `keep` 直接返回 0
2. **`streamOptions` 全链打通**：`db/profiles.ts` 四个读写点（`toProfile` / `createProfile` / `updateProfile` / `importProfiles`）+ `registry.ts` 的 env 种子解析（只在显式 `false` 时记录，缺省开）+ 脱敏视图 + `openai-compat.ts` 按方案决定是否带字段 + `routes/providers.ts` 两个入口校验布尔值 + 表单「高级」区加开关
3. **`app_kv` 落地**：新增 `server/src/db/kv.ts`（`getKv` / `setKv` / `hasKv`）；`importProfiles` 判据换成持久标记 `llm_profiles_seeded`，**老库已有方案时也补写标记**（否则升级后同样的「复活」还会发生）
4. **配置对齐**：`server/.env.example` 补 `CORS_ORIGIN` 段（含示例与「默认全开的含义」说明）；`engines` 收紧为 `^20`；`index.ts` 的 `allowedMajors` 只取 `<` 之前的部分，杜绝「上界被当允许值」
5. **两处编译错**：`toPublic` 补字段；`ChatWindowPage` 的收尾写回改成**先判 `targetId`** 再判草稿分支（`targetId !== null` = 换一个 / 否则 = 新回复收尾），类型自然收窄，不再需要断言
6. **验收脚本同步**
   - 新增 `server/scripts/probe-diag-retention.ts`：**自带一次性临时库**（`HABITAT_DB_PATH` 先设好再用动态 import），验「不足上限不裁 / 超量裁掉最旧的 / 保留条数与留下的是哪些都对 / 幂等 / 非法 keep 不碰库」——**不拿真实记录做实验**
   - `probe-llm.ts` 新增第 8 节：`stream_options` 兼容开关，断言**真实报文**（借 mock 上游新增的 `GET /__last-body` 调试钩子，`mock-openai.ts` 顺带记录最近一次请求体）
   - `probe-providers.ts` 新增第 9 节：开关的 HTTP 层读写与非法值 400；并修掉一条**隐含依赖环境**的断言 —— 「新建方案不抢默认」在**空库**上必然假失败（空库首条自动成为默认是 `createProfile` 的设计行为），改成先显式造出「已有默认」这个前提
   - `verify-chat.mjs` 修掉写死的 Dexie 版本断言（`v2 → 20` 已过期），并**顺手验得更实**：不只比版本号（20/30），还把 v3 引入的三元复合索引取出来断言

**验收结果（全部实跑）**

- 两端 `typecheck` 通过；`web` 构建通过
- `probe-diag-retention.ts`：**15/15**
- `probe-llm.ts`：**32/32**（原 27 + 新增 5）
- `probe-providers.ts`：**52/52，空库与「有方案时」各跑一次都过**（原 46 + 新增 6）
- `probe-diagnostics.ts`：**48/48**
- `verify-chat.mjs` / `verify-providers.mjs` / `verify-diagnostics.mjs`：**35→36 / 22 / 36** 全过，三条均「控制台零异常」
- 启动冒烟：空库 + env 种子 → 首次导入；`PATCH streamOptions=false` 落库并在**报文**里生效；删光方案重启 → **种子不复活**（`app_kv` 标记生效）；Node 22 启动被门禁拦下并给出一句人话

**排查中踩到的坑（值得记的是前两条，属于工具行为而非代码）**

- **编辑工具偶发「报成功但没落盘」**：本轮 4 次编辑（`profiles.ts` 的 `updateProfile`、`routes/providers.ts` 的 `parseCreateInput`、`mock-openai.ts` 的变量声明）都以「Successfully edited」返回，但文件里没有改动。→ 每次编辑后**必须 grep 回读**关键行，不能凭返回消息判断
- **`noUnusedLocals` / `noUnusedParameters` 全开**，所以验收脚本里的 `for await (const _x of …)` 也会报错 —— 循环变量必须在断言里真的被用到
- `vite build` 不做类型检查：类型错能一路构建成功，**只能用 `typecheck` 兜**

**本任务新增待优化**：中 3 条（诊断保留策略只在启动时裁一次且阈值写死 / 备份下载同步 revoke 对象 URL / 验收脚本对环境前提有隐含依赖）、低 2 条（流式草稿并发 flush 的理论乱序 / 「重新从 `.env` 导入方案」无入口），已录入上方汇总清单。

**验证命令**

- 纯库（不需要 server）：`cd server && npx tsx scripts/probe-diag-retention.ts`
- 需要 mock 上游：起 `npm run dev:mock-openai`，再 `cd server && npx tsx scripts/probe-llm.ts`
- 需要 mock + server：`HABITAT_LLM_PROFILES='[…mock…]' MOCK_KEY=sk-mock PORT=3100 HABITAT_DB_PATH=./data/probe.db npm run dev:server`，再 `npx tsx scripts/probe-providers.ts` / `scripts/probe-diagnostics.ts`
- 端到端：起 mock + server（隔离端口）+ vite（`--host 127.0.0.1`）+ 无头 Edge，串行跑三条 `web/scripts/verify-*.mjs`（前置见各自文件头注释）

**下一步（Phase 2）**：Home 生活模块（留言板 / 日记 / 相册…），依据技术方案 §8。

---

### T-009 · 2026-09-23 · 施工接手复核 + Phase 2 第一批 Home 模块

**范围**：先复核 Phase 1 交接基线，再按 §8 与 Home UI 约束落地第一批三个生活入口：留言板 / 愿望清单 / 倒数日。

**已完成**

1. **交接复核**：工作树起始干净；Phase 1 的两端 typecheck / 构建、后端四组探针（15 / 32 / 52 / 48）与前端三组回归（36 / 22 / 36）全过。
2. **抓并修验收竞态**：`verify-chat.mjs` 回到 `/chat` 后原先只等“路径不同于旧会话”，这个条件在点“新建”前就已成立，会偶发把 fixture 的 `sessionId` 写成字面量 `chat`。改为必须进入新的 `/chat/:id`，复验 36/36。
3. **本地数据**：新增 `Moment` / `WishlistItem` / `CountdownDay` 契约，Dexie 升到 v4，三张表各自带稳定索引；仓储层统一做空值校验与 ID 生成。
4. **三个可用模块**：留言可新增 / 二次确认删除；愿望可新增 / 完成切换 / 删除；倒数日可新增 / 按日期排序 / 显示距离 / 删除。全部有加载、空态、错误态，只用现有 Tokens 做简单 UI。
5. **备份不丢新数据**：格式升到 v2，导出 / 整体恢复覆盖三张 Home 表；仍能导入 v1 聊天备份（Home 按空数组）。同时收口对象 URL 过早释放的旧欠项。
6. **新增浏览器验收**：`verify-home.mjs` 9/9，覆盖三模块的新增 / 状态 / 刷新持久、Dexie v4 表形状、备份 v2 自恢复、v1 兼容与控制台零异常。

**待优化 / 后续边界**

- 留言与愿望目前只有新增 / 状态 / 删除，没有编辑与手动排序；先记为低优先级，等真实使用需求出现再补。
- `Moment.author='companion'` 只是数据口预留，Phase 2 还没有让小栖主动写留言；该通道必须等 Phase 3 的上下文 / 主动行为链路，本切片不越界。

**验收**：两端 `typecheck` + 前端生产构建通过；`verify-home.mjs` 9/9；Phase 1 全套回归见上。

**下一步（Phase 2 第二切片）**：日记 + 收藏，延续同一套本地实体 / Dexie / 备份 / 浏览器验收闭环。

---

### T-010 · 2026-09-23 · Phase 2 第二切片：日记 + 收藏

**范围**：把 Home 的日记与收藏从占位页补成可日常使用的本地模块；继续遵守 §6.2 的统一实体与 `Bookmark.targetType + targetId` 约束。

**已完成**

1. **数据契约与迁移**：新增 `Diary` / `Bookmark` / `BookmarkTargetType`；Dexie 升到 v5，新增 `diaries` 与 `bookmarks`。收藏用唯一复合索引 `&[targetType+targetId]` 从数据层阻止同一目标重复收藏。
2. **日记闭环**：日期、标题、纯文本正文；支持新增、编辑、二次确认删除，列表按日记日期倒序；有加载、空态、错误态。正文不接 HTML，避免在富文本沙箱尚未落地时引入旁路。
3. **收藏闭环**：本切片先提供外部链接入口（名称 / URL / 备注）；只接受 HTTP(S)，新窗打开带 `noreferrer`，重复目标给明确提示，删除需二次确认。模型已预留聊天消息 / 日记 / 留言 / 作品 / 相片 / 读书笔记等目标类型。
4. **备份继续全量**：格式升到 v3，日记与收藏纳入同一个原子恢复事务；v1 / v2 仍可导入，新增表按空处理。导入校验会拒绝伪造的 `javascript:` 外部收藏，不能绕过表单协议限制。
5. **回归脚本同步**：`verify-home.mjs` 扩到 14/14，覆盖日记新增编辑、收藏持久化 / 新窗安全属性 / 去重、备份 v3 自恢复、v1/v2 兼容与恶意协议拒绝；`verify-chat.mjs` 的数据库总版本断言同步到 v5，聊天回归 36/36。

**待优化 / 后续边界**

- 统一收藏的跨模块入口尚未接；目前只有收藏页能生产 `external-link`。已收敛到上方低优先级清单，等各模块交互逐步接入。
- 日记当前是纯文本且一次加载全量；个人早期数据量足够。需要搜索、标签或分页时再根据真实规模补，不提前堆结构。

**验收**：两端 `typecheck`、前端生产构建通过；`verify-home.mjs` 14/14；`verify-chat.mjs` 36/36；控制台零异常。

**下一步（Phase 2 第三切片）**：作品 + 相册。

---

### T-011 · 2026-09-23 · Phase 2 第三切片：作品 + 相册

**范围**：把作品与相册从占位页补成可用的本地模块，并确保照片这种大字段不会绕过格式 / 体积校验或漏出备份闭环。

**已完成**

1. **数据契约与迁移**：新增 `Artwork` / `ArtworkCategory` / `Photo` / `PhotoMime`；Dexie 升到 v6，新增 `artworks`、`photos` 两表。
2. **作品闭环**：名称、分类、说明与可选 HTTP(S) 外链；支持新增、编辑、二次确认删除，外链用安全新窗打开；有加载、空态、错误态。
3. **相册闭环**：保存实际图片内容而非临时对象 URL；支持 PNG / JPEG / WebP / GIF，单张不超过 3 MB，明确拒绝 SVG。仓储层同时核对 MIME、base64 语法、编码后真实字节数与声明大小，不能靠伪造 `sizeBytes` 绕过限制。
4. **备份继续全量**：格式升到 v4，作品与照片纳入原子恢复；v1 / v2 / v3 仍可导入，新表按空处理。导入会在动库前拒绝危险协议、非白名单图片、超限或体积不一致的数据。
5. **回归脚本同步**：`verify-home.mjs` 扩到 18/18，覆盖作品新增编辑、相册实际图片跨刷新、备份 v4 自恢复、v1–v3 兼容与恶意图片拒绝；数据库形状断言同步到 v6。`verify-chat.mjs` 同步版本断言后 36/36。

**待优化 / 后续边界**

- 照片当前以 data URL 存 IndexedDB，适合早期小相册但有约 33% base64 膨胀，备份文件也会随原图线性变大；已记入上方中优先级清单，真实量上来后再迁 Blob / OPFS + 缩略图，不能在没有迁移方案时贸然换存储。
- 相册本切片只做新增与删除，未做编辑说明 / 日期、排序或批量导入；等实际使用反馈再决定交互，不提前堆功能。

**验收**：两端 `typecheck`、前端生产构建通过；`verify-home.mjs` 18/18；`verify-chat.mjs` 36/36；控制台零异常。

**下一步（Phase 2 第四切片）**：读书 + 音乐 + 学习，收口剩余三个 Home 入口。
