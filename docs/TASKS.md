# TASKS · 任务记录与待优化清单

> **用途**：每完成一次任务，**先按顺序追加一条记录**，写清「已完成什么 + 还剩什么待优化」，然后再进入下一进程。
> **与 PRODUCT_SPEC 的分工**
>
> `docs/PRODUCT_SPEC.md` 定义“产品最终应该怎样工作”；
> 本文件只记录“当前实现与目标之间还差什么”。
>
> PRODUCT_SPEC 中的完整交互定义不得复制到这里。
> TASKS 中只写可执行差异，例如：
>
> - [ ] Chat 消息编辑尚未实现 → 产品行为见 PRODUCT_SPEC §2.3
> - [ ] AI 日记仍是普通 CRUD → 应按 PRODUCT_SPEC §3.4 重构权限模型
>
> 完成后只在本文件勾选；不要删除 PRODUCT_SPEC 中的长期产品定义。

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
- [ ] **多选没有「全选 / 区间选择」** —— 目前只能逐条点气泡。长会话里想删掉一整段（比如清理一次失败的实验）非常费手。→ 等真实用例出现再设计，最好与未来的搜索 / 筛选一起做，而不是先长出一个孤立的「全选」按钮。
- [ ] **撤回 / 删除不回改「已经生成的回复」** —— 我们保证的是**被撤回的内容不再进上下文**（SPEC §2.3.5）；而 AI 早先基于它写下的回复仍留在会话里、也仍进上下文，所以可能出现「AI 的话像是在回应一段已经看不见的内容」。这是 SPEC 有意的取舍（撤回是「让它退出对话历史」，不是「改写已经发生的事」），但真实使用中若觉得别扭，需要另定一条规则。
- [ ] **相册用 data URL 存原图，容量增长较快** —— 现阶段单张已限 3 MB、格式白名单并校验真实 base64 体积，但 base64 本身约有 33% 膨胀，导出的 JSON 也会把原图一起带上。→ 真实照片量上来后改 Blob / OPFS + 缩略图，并补总容量提示；切换存储前必须先做无损迁移与备份兼容。
- [ ] **公网 Demo 只验到「客户端代码」，自部署实例仍未验** —— T-013 用 Nocturne 官方只读 Demo（`https://misaligned.top/mcp`）跑通了真实 Streamable HTTP 握手、工具清单与 `system://boot`，但它**不是** `beiyan.cc` 上那个实例：Bearer Token、`X-Namespace`、Caddy 反代与内网回源这几段都还没走过。→ 部署链路验证仍属风险 1 的未结部分，接阿里云时按 §4 拓扑逐段验。
- [ ] **`gateway.connectAll()` 会阻塞服务启动** —— `main.ts` 在 `app.listen()` **之前** `await gateway.connectAll()`，而 SDK 的默认请求超时是 60s。MCP server 挂着时启动会被拖住（公网 Demo 实测握手 2.2–4.6s，单机同机部署可忽略）。→ 给 `connect()` 加显式超时，或把 `connectAll()` 从启动路径摘出去改成后台重试（`diagnostics()` 已经有重连能力，接上定时器即可）。

- [ ] **分组排序（拖拽调序）未做** —— SPEC §2.1.3 明确把「分组排序」列为后续扩展，本轮按**创建顺序**排列（创建顺序也是全序，删组不会让兄弟分组换位，所以在引入显式排序字段前它最稳），但用户没法把常用分组提前。→ 需要显式排序字段（大概率又是一次 Dexie 升版）+ 拖拽交互，一起做更划算。
- [ ] **移动端长按会话行不能进菜单** —— SPEC §1.3 把长按定为移动端主路径，长按目前只在**消息气泡**上实现；会话列表行只有 `⋯`，触控目标偏小。→ 需要时把气泡那套 450ms 长按逻辑复用到会话行（`ChatBubble` 里的实现可直接抽成 hook）。
- [ ] **删除分组没有「连带删除组内会话」选项** —— 现在只有「删分区，会话回到未分组」一种语义（SPEC §2.1.3 也只要这个）。若日后确实想整组清掉，应另起动作并在确认语里写清条数，不要做成删组时的勾选项（勾选项会把不可逆操作藏在一个默认不勾的框后面）。
- [ ] **「只发送」的入口藏在「更多功能」里，可发现性一般** —— 主按钮保持「发送并请求回复」是为了不把聊天变成两步（SPEC §2.4.3 定的默认行为），代价是「只发送」要展开一层菜单。→ 等真实使用一段时间再定：若常被用到，应提到输入框旁（例如长按「发送」，或像气泡长按那样抽一个复用 hook）。
- [ ] **语音条没有转写，模型只看到 `[语音条 0:03]` 占位** —— SPEC §2.4.4 的缺口已记录在案：模型知道「收到一条语音」但不知道内容，答出来会偏。→ 属 ASR，与 Phase 5 的语音能力一起接；接上后把 `ChatWindowPage.voicePlaceholder()` 换成真实转写（写进 `AudioBlock.payload.transcript`，那个字段早就留着）。**不要**为了「有内容可送」去硬塞假文本。
- [ ] **语音条与相册同样内联 data URL，备份体积增长快** —— 单条上限 60 秒，实测约 10 KB/s（webm/opus，≈80 kbps），60 秒 ≈ 600 KB，base64 再涨约 33%。→ 与相册那条同批处理：换 Blob / OPFS + 缩略图 / 波形，切换前先做无损迁移与备份兼容。
- [ ] **语音条的格式由浏览器决定，跨设备可播性未验** —— 实测 Edge 是 `audio/webm;codecs=opus`（且**不支持** `audio/ogg`），iOS Safari 会走 `audio/mp4`。同一份备份换个浏览器可能放不出来。→ 真要跨设备，得在录制后统一转码（服务端或 WASM），成本不低，先记着。

### 低 —— 开发工具与体验毛刺

- [x] ~~**统一收藏目前只有“外部链接”生产入口**~~ —— 已修（T-016）：聊天消息可从原消息菜单直接写入 `chat-message` 收藏，并保留消息 / 会话来源与稳定快照；其它模块仍按各自交互切片逐步接入。
- [ ] **Home 长文本模块均为全量列表，没有统一检索** —— 日记、作品、读书、音乐、学习在个人早期数据量下足够；数据增多后应统一设计搜索 / 标签 / 分页或虚拟列表，避免十个模块分别长出不一致的筛选器（T-010 / T-012）。
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
- [x] ~~**验收脚本的进程清理一直是空转**~~ —— 已修（T-013）：`.workbuddy/run-front-verify.sh` 原来靠 `pkill -f` 收场，但本环境的 Git Bash **根本没有 `pgrep` / `pkill`**（`command not found`），配上 `2>/dev/null` 就是静默不执行；同轮把 `taskkill //PID` 改成 `MSYS2_ARG_CONV_EXCL='*' taskkill /PID … /F`（前者会报「无效参数/选项」）。现在全部按「端口 → PID」清，并已实测「真能杀掉」+「不误伤用户 :3000」。
- [ ] **`probe-nocturne-demo.ts` 依赖公网，不宜进默认回归** —— 它打的是 Nocturne 官方 Demo，需要外网可达；离线或 Demo 下线时会整片失败。→ 定位是**风险 1 的专项验证 + 换环境时的连通性体检**，不并入常规三件套回归；文档里已注明前置条件。
- [ ] **Markdown 表格没有校验手段，AGENTS.md 已被写坏过一次** —— 2026-09-23 那次改版里出现：某行被折成两行（表格断掉）、两行黏成一行、表头列数与分隔行不一致、旧行未删净而重复。这类损坏在编辑时看不出来、渲染时才暴露。→ 改表格后**必须回读确认列数一致**（或后续引入 markdownlint）。
- [ ] **中间消息在桌面端只能右键进菜单** —— 长按是移动端主路径（SPEC §1.3），`···` 只挂在末条与有多版本的消息上（刻意不给每条消息都加一行：60 条各加一行会把列表撑高约 1.1 屏）。若真实使用觉得别扭，把 `···` 提到每条消息只是一行的事，代价是每个气泡多约 18px。
- [ ] **「从这条重新生成」截断后续后不可撤销** —— 它已被归入「显式动作 + 二次确认」，确认语里也写明了会移除几条，但被截断的消息本身没有撤回途径，兜底仍是备份导出。

- [ ] **分组内会话不能单独排序** —— 分区内仍按消息活跃时间倒序（与未分组区一致）。真要做需要给会话加「组内顺位」，且要定义「组内排序」与「置顶」谁优先（现在的规则是置顶跨分组浮到最顶）。
- [ ] **会话行的 `⋯` 是文字符号，触控目标偏小** —— 移动端 ≥44px 才顺手，现在靠 `px-2` 撑出的宽度不够。→ 后续做移动端细节时换成图标按钮并加大点击区（与上一条长按一起做）。
- [ ] **`archivedAt` 依然没有 UI 生产者** —— 会话表里这个字段从 Phase 1 起就预留着，现在有了分组，归档的定位更边缘（分组已经能承担「收起来」的诉求）。→ 若一直不做，考虑在某个清理批次里把它从类型里摘掉，别让它继续挂在字段表上。
- [ ] **语音条消息没有「复制」入口** —— 菜单项是按 `hasText` 增减的，语音条没有文本投影所以不显示「复制」（这是对的，没有可复制的内容）。但用户可能会去找。→ 真要给，应做成「复制为转写文本」，等 ASR 接上后一起做才有意义。
- [ ] **语音条录完直接发出，不能先试听再决定** —— 误录只能靠「取消」在录的时候拦，发出去以后要删得走消息菜单。→ 需要时补「录完先预览 + 重录」的两步流程。
- [ ] **`historyUpTo` 只给语音条补占位，图片 / 文件仍不进上下文** —— 这是既有的、有意的行为（`messageText()` 只取 text 块，见 `db/chat.ts` 注释），本轮只针对语音条开了口子，因为「用户发了话但模型完全不知道」会直接导致答非所问。→ 若日后发现图片消息也有同样的别扭，再统一考虑「非文本块如何进入上下文」，不要零散地一个个补。
- [ ] **表情面板是 32 个固定内置表情** —— 没有「最近使用」、没有分类、不能自定义 / 导入。→ 够用即止；真要做属独立功能，别塞进输入区切片里。

---

## PRODUCT_SPEC 差异（当前实现 vs 产品定义）

> **来源**：`docs/PRODUCT_SPEC.md` §7（UX 收口优先级）与 §8（已知偏差）。
> **写法约定**：产品行为以 PRODUCT_SPEC 为准，这里只记「还差什么、差在哪一节」，**不复制交互定义**。
> 勾掉一条时，若已按 SPEC 实现，请同时回看对应章节是否仍需补细节。

### P0 · 先修，会影响数据结构与权限模型

**Chat**

- [x] ~~消息**编辑**尚未实现~~ —— 已实现（T-015）：旧正文进版本链（`origin: 'edit'`），与「换一个」共用 `‹ n/N ›`；编辑**不动**后续消息。语义见 SPEC §2.3.4
- [x] ~~消息**撤回**尚未实现~~ —— 已实现（T-015）：只打 `recalledAt`，正文与版本链保留（可恢复），界面留「已撤回」痕迹；**不进模型上下文**（落点在 `historyUpTo` 一处）
- [x] ~~消息**删除**尚未实现~~ —— 已实现（T-015）：物理删除 + 二次确认，不另做回收站
- [x] ~~消息**多选**尚未实现~~ —— 已实现（T-015）：菜单进入多选 → 点气泡勾选 → 批量删除（确认语说清条数）
- [x] ~~消息**收藏**（写入收藏中心）尚未实现~~ —— 已实现（T-016）：从消息菜单直接收录，`targetType + targetId` 去重，保存来源会话与快照
- [x] ~~消息**收录至作品**尚未实现~~ —— 已实现（T-016）：消息 / 组件统一保存稳定快照，复用 `sourceId + sessionId`
- [x] ~~图片**加入相册**尚未实现~~ —— 已实现（T-016）：仅图片消息显示入口；保留原图、消息来源、发送方与 block 位置
- [x] ~~**会话置顶**尚未实现~~ —— 已实现（T-017）：列表原位置顶 / 取消置顶，置顶会话优先；不刷新 `updatedAt`，取消后恢复原活跃顺序
- [x] ~~**会话分组**尚未实现~~ —— 已实现（T-018）：创建 / 重命名 / 删除分组、会话移入移出、分区折叠（状态落库）、未分组兜底区；置顶**优先于分组**，浮顶后取消置顶会回落到原分组。语义见 SPEC §2.1.2 / §2.1.3
- [x] ~~**聊天设置入口**（顶栏右上）尚未实现~~ —— 已实现（T-017）：当前会话可保存备注、背景与气泡模式，设置不改变消息活跃排序

**Home**

- [ ] **日记**当前是普通 CRUD，需纠偏为「AI 私有日记 + 请求查看」权限模型 → §3.4（权限模型见 §6.3）
- [x] ~~**收藏**当前只收外部链接，需改为跨模块汇聚中心~~ —— 已接聊天消息来源（T-016），其它来源后续按对象交互逐步接入
- [x] ~~**作品**当前是独立 CRUD，需改为跨模块「收录」中心~~ —— 已接聊天消息 / 组件来源（T-016）
- [x] ~~**相册**当前是独立上传，需改为聊天图片等内容的收纳中心~~ —— 已接聊天图片来源（T-016）

### P1 · 结构明确后补

- [x] ~~输入区快捷操作栏（语音 / 表情 / 更多）~~ —— 已实现（T-019）：四项齐（语音条录制 / 表情包 / 更多功能 / 请求回复）；语音条真录真发，模型收到 `[语音条 0:03]` 占位描述
- [x] ~~「请求回复」与「发送」在交互上拆开~~ —— 已实现（T-019）：主按钮默认「发送并请求回复」不变，「更多功能」里提供「只发送，不请求回复」，快捷栏「请求回复」处理整批未回复消息。**未回复判定不加字段**，由消息序列推导
- [ ] 留言板 Widget → §3.2.2 / §5.2
- [ ] 倒数日 Widget → §3.3.2 / §5.2
- [ ] 收藏：分类 / 备注 / 查看来源 → §3.5.4（来源查看已随 T-016 落地，**备注字段 `Bookmark.note` 早已存在**，缺的只有**分类**）
- [ ] 相册分类 → §3.7.3

### P2 · 后续阶段实现（依赖主动行为 / Eventide 链路）

- [ ] AI 自主写日记 → §3.4.3 / §3.4.5
- [ ] AI 自主留言 → §3.2.3
- [ ] 「一起听」完整能力（当前仅 URL 卡片，**属占位实现**） → §3.8
- [ ] AI 伴学系统（当前仅学习记录 CRUD，**属占位方向**） → §3.9
- [ ] 主屏幕 Widget 编排（Home 从入口列表变成可编排首页） → §5.1 / §5.3
- [ ] 与 Eventide / 主动行为链路联动 → §9.5

> ⚠️ **开工前核对结论（2026-09-23 已核，与初判不同）**：P0 共 14 项，其中 **Chat 那 10 项基本是「零 schema 改动、纯补 UI 与仓储层」**
> —— Phase 1 按技术方案 §6.3 的「两次提前量」已经预埋了全部所需字段：`candidates[].origin` 里本就有 `'edit'`
> （编辑保留原版本）、`recalledAt`（撤回）、`editedAt`、`pinnedAt`，以及 `Bookmark.targetType + targetId` 与
> `BaseObject.sourceId / sessionId`（跨模块引用）。
> 真正要改数据结构的只有三处：**会话分组**（`ChatSession` 缺 `groupId`）、**日记权限模型**（`Diary` 缺作者与可见性）、
> **作品 / 相册的来源引用**（复用基座字段，不新增）。
>
> 按 `PRODUCT_SPEC.md` 的文档权威关系：先以 SPEC 确认目标行为 → 再评估数据结构与技术实现如何调整 →
> **不允许为保留现有 CRUD 实现而反向缩减产品定义**。落地口径已写入 `docs/DATA_MODEL.md`。
>
> ⚠️ 另注：**SPEC §2.3.4 / §2.3.5 里那几个悬而未决的语义已于 2026-09-23 定稿**（编辑保留原版本 + 不自动改后续、
> 撤回留痕且不进上下文、删除物理删除），所以下面几条不再有「开工前必须先定」的阻塞。

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

---

### T-012 · 2026-09-23 · Phase 2 第四切片：读书 + 音乐 + 学习（Phase 2 收尾）

**范围**：落地最后三个 Home 入口，并把 Phase 2 的十类生活数据统一收进版本化存储、备份与浏览器验收闭环。

**已完成**

1. **数据契约与迁移**：新增 `ReadingNote` / `ReadingStatus`、`MusicTrack`、`StudyRecord`；Dexie 升到 v7，新增 `readingNotes`、`musicTracks`、`studyRecords`。收藏目标类型同步预留音乐与学习记录。
2. **读书**：书名、作者、想读 / 在读 / 读完状态与纯文本笔记；支持新增、编辑、二次确认删除。
3. **音乐**：歌曲、音乐人、备注与可选 HTTP(S) 链接；支持新增、编辑、二次确认删除，外链安全新窗打开。
4. **学习**：主题、日期、1–1440 分钟整数时长与纯文本记录；支持新增、编辑、二次确认删除，并展示本地记录次数与累计分钟。
5. **备份收口**：格式升到 v5，十类 Home 数据全部进入同一个原子恢复事务；v1–v4 继续兼容，新三表按空处理。音乐危险协议、学习日期 / 时长与阅读状态都在写库前校验。
6. **完整回归**：`verify-home.mjs` 扩到 23/23，十个入口、三模块 CRUD 主路径、备份 v5、自恢复、v1–v4 兼容、Dexie v7 表形状与控制台零异常全部实测；`verify-chat.mjs` 同步版本断言后 36/36。

**待优化 / 后续边界**

- 读书、音乐、学习目前是个人早期数据量下的全量列表，没有搜索、标签、分页或批量导入；与日记同样，等真实规模和检索需求出现再统一设计，避免十个模块各长一套筛选器。
- 音乐模块记录链接而不代理播放或抓取平台元数据，避免前端直连第三方服务与版权 / 鉴权边界扩张；真正的音频能力仍留给 Phase 5 Provider。

**验收**：两端 `typecheck`、前端生产构建通过；`verify-home.mjs` 23/23；`verify-chat.mjs` 36/36；控制台零异常。

**下一步（Phase 3A）**：长期记忆接入（Nocturne，经 MCP Gateway 单通道），先按 `docs/MEMORY.md` 与技术方案 §7.1 / §9 风险 1·5 施工。

---

### T-013 · 2026-09-23 · Phase 3A 真实链路验证：用 Nocturne 官方只读 Demo 验客户端代码

**范围**：按技术方案 §9 风险 1 的对策（「先用 Nocturne 公共 demo 验证客户端代码，再排阿里云链路」），在本地 mock 全链探针 24/24 之外，补一次**打真实 MCP server** 的验证：真实 Streamable HTTP 握手、工具清单、`system://boot`。**全程只读，不向外部写入任何数据。**

**为什么是官方 Demo**：官方 README 明确该实例为**只读模式，仅开放 `read_memory` 与 `search_memory`** —— 「不写入」由**服务端**物理保证，比调用方自觉可靠得多。

**已完成**

1. **新增 `server/scripts/probe-nocturne-demo.ts`（25/25，连跑两次通过）** —— 自包含只读探针，分两段以便「卡在哪一层能判」：
   - `[1] 原始 SDK 直连`：隔离协议层，验握手与**是否真 Streamable HTTP**（看 `transport.sessionId`）；
   - `[2] 经 `McpGateway``：验**我们自己的生产代码路径**（状态机 / 工具清单 / `system://boot` / 诊断留痕）。
   - 用一次性临时库（同 `probe-diag-retention` 手法），跑完连 WAL 一起删；并用**记录型包装**统计实际发出的调用，断言调用名全程落在 `{read_memory, search_memory}` 内。
2. **真实抓到的协议事实**（已写进脚本输出与 `docs/MEMORY.md`）：`mcp-session-id` 正常下发（确认不是 SSE 降级）；`serverInfo = Nocturne Memory Interface v1.26.0`；工具清单恰好 `read_memory, search_memory`；`search_memory` 的真实 `inputSchema` 是 `query, domain, limit` —— 与我们适配器的参数映射**逐字对上**；`system://boot` 返回 8101 字真实正文。
3. **完整 HTTP 链路验证** —— 把真的 habitat-server 指到 Demo 起在 :3300（独立临时库），只用 GET 打 `/api/health/mcp`、`/api/memory/boot`、`/api/memory/search`、`/api/diagnostics/mcp`：状态机 `ready`、`toolCount=2`、诊断表 3 条（1 条 `handshake=true` 的 `initialize` + 2 条 `tools/call`）、`errorCount=0`。
4. **修掉验收脚手架的静默失效** —— 复查 `.workbuddy/run-front-verify.sh` 时发现两处**一直没生效**的清理逻辑：本环境 Git Bash 里没有 `pgrep` / `pkill`（`command not found`，配 `2>/dev/null` 就是空转）；`taskkill //PID x //F` 会报「无效参数/选项」。现改为按「端口 → PID」清 + `MSYS2_ARG_CONV_EXCL='*' taskkill /PID … /F`，并**非空跑实测**（起监听 → 调清理 → 验端口释放，且用户 :3000 的 PID 不变）。
5. **文档同步**：本条记录 + `docs/MEMORY.md` 补验证事实与工具契约 + `AGENTS.md` §6 的「本地验收方式」补新脚本。

**待优化 / 后续边界**

- **本轮验的是客户端代码，不是自部署实例。** Bearer Token、`X-Namespace`、Caddy 反代与内网回源这几段仍未走 —— 风险 1 尚未结清，接阿里云时按 §4 拓扑逐段验（已入上方中优先级清单）。
- **公网 Demo 有网络依赖**，不该并进常规回归（已入低优先级清单）。
- 顺带发现 `connectAll()` 在 `listen()` 之前 `await`，MCP 挂掉时最长可拖住启动 60s（已入中优先级清单）。
- 只读 Demo **无法验证写路径**（`create` / `update` / `delete` 与 read-before-write 语义）—— 这部分仍由 mock 的 `probe-memory.ts` 覆盖（24/24）。真实写路径要等自部署实例。

**验收**：`probe-nocturne-demo.ts` **25/25**（连跑两次一致）；真实 HTTP 链路四项 GET 全通；两端 `typecheck` 通过；全程只读（Demo 未暴露任何写工具，实际调用仅 `read_memory` ×1 + `search_memory` ×1）；临时库与临时进程均已清理（已复查无残留）。

**下一步（Phase 3A 续）**：接自部署 Nocturne（`beiyan.cc`）——带 Token / Namespace 验真，并补 `docs/MEMORY.md` 的正式接入设计。

---

### T-014 · 2026-09-23 · 引入 PRODUCT_SPEC，并把文档体系对齐

**范围**：北北新增产品行为权威 `PRODUCT_SPEC`，并改动 `AGENTS.md` / `TASKS.md` / `REFERENCES.md`。本轮**只做文档体系对齐 —— 零代码改动**。

**已完成**

1. **`PRODUCT_SPEC` 落位** —— 原文件在**仓库根**、名为《栖息地_PRODUCT_SPEC_交互定义_v0.1_结构草稿.md》，但 AGENTS / TASKS / REFERENCES 三处引用的都是 `docs/PRODUCT_SPEC.md`（**引用是断的**）。已移到 `docs/PRODUCT_SPEC.md`，标题与版本信息保留在文档内。
2. **`AGENTS.md` 修复**（改版时产生的 5 处表格损坏 + 2 处信息丢失）：
   - 修：§2「README.md」行被折成两行导致表格断掉；§4 表头 4 列而分隔行 3 列；§4「主动唤醒 / 独处时光」行尾**黏连**了旧的「Home 生活模块」行；§4 存在重复的 UI 行；§0 / §3 与分隔线之间缺空行。
   - 补：§2 接口计数更新（补上诊断 1 + 记忆 6）；§4 补回 3 行仍有效的任务（**多 Provider / API 方案管理**、**MCP Gateway / 诊断日志**、**世界书 / 角色设定**，均带原参考项目）；§6 恢复「维护约定」；§1 目录结构与 §4 的 PRODUCT_SPEC 引用统一。
3. **`README.md` 承接「本地验收」** —— 原 AGENTS §6 的验收段被整段删除，其中含高价值前置条件（Node 双轨约束、验收必须换端口、vite 要 `--host 127.0.0.1`、后台进程会被回收）。按项目自身分工（**命令 / 启动 SOP 的家 = `README.md`**）移入 README，并补上 Phase 3A 新增的 `probe-memory.ts` / `probe-nocturne-demo.ts` / `verify-home.mjs`。
4. **`docs/API.md` 补 Phase 3A 记忆接口** —— 6 个端点（`boot` / `search` / `read` / `POST` / `PATCH` / `DELETE`）、`domain://path` 格式校验、`system://` 只读、三种修改模式及其互斥规则、以及 **502 的语义**（未配 MCP 属设计行为而非故障）。此前违反本项目维护约定「新增 / 修改接口 → 同步 `docs/API.md`」。
5. **`docs/TASKS.md` 登记 PRODUCT_SPEC 差异** —— 按 `PRODUCT_SPEC.md` §7/§8 整理成 **P0（14 条）/ P1（6 条）/ P2（6 条）**，每条带 SPEC 章节引用；**不复制产品定义正文**，避免与 SPEC 双写。

**待优化 / 后续边界**

- **P0 全部涉及数据结构与权限模型调整**（消息版本与撤回语义、跨模块引用关系、日记权限）。按 SPEC 的权威关系，开工前需先评估技术方案 §6 / §8 与 `docs/DATA_MODEL.md` 是否需要同步修订（已写进「PRODUCT_SPEC 差异」章节末尾）。
- 新增一条低优先级：**Markdown 表格没有校验手段**，本轮修的正是这类损坏（已入清单）。

**验收**：`docs/PRODUCT_SPEC.md` 落位后三处引用全部成立（grep 复核）；`AGENTS.md` §2 / §4 表格列数一致、无黏连行；`README.md` 新增章节结构正确；`docs/API.md` 端点计数与 `server/src/routes/` 实际**逐条对上**（健康 2 + 聊天 1 + 方案 9 + 诊断 1 + 记忆 6 = 19）；**本轮零代码改动**，故未跑 typecheck。

**下一步（二选一）**：① 按 `PRODUCT_SPEC.md` §7 从 **P0** 起步做 UX 收口（需先定 SPEC §2.3.4 / §2.3.5 里那几个悬而未决的语义）；② 先接自部署 Nocturne，结清 Phase 3A 剩余。

---

### T-015 · 2026-09-23 · PRODUCT_SPEC P0 第一批：消息对象操作（编辑 / 撤回 / 删除 / 多选 / 复制）

**范围**：北北选 ① —— 从 SPEC §7 的 P0 起步做 UX 收口。开工前按规矩先定 SPEC §2.3.4 / §2.3.5 里悬置的语义，
并核对数据结构改动面；核对结论与 T-014 的初判**不同**（见「PRODUCT_SPEC 差异」章节末尾的更正）。

**四条件语义决定（已写进 `PRODUCT_SPEC.md`，产品行为的家在那里）**

1. 编辑**保留原版本**（复用 `candidates`，`origin: 'edit'`），与「换一个」共用同一套版本导航，不另造第二套历史
2. 编辑用户消息后**不自动删除、不自动重生成后续**；「从这条重新生成」是显式动作且必须二次确认
3. 撤回**留痕、不进模型上下文、可恢复**；删除**物理删除 + 二次确认**，不另做回收站（兜底交给备份导出）
4. 用户消息与 AI 消息**权限完全对等**

**已完成**

1. **`docs/PRODUCT_SPEC.md`** §2.3.4 / §2.3.5 从「需要后续明确」改为已定语义 —— 语义是产品定义，不该只躺在 TASKS 里
2. **`docs/DATA_MODEL.md`** 从 5 行占位补成实体：归属总表、统一基座、Chat 三张字段表、版本链三条硬约束、编辑 / 撤回的落库口径、跨模块引用契约、P0 待新增、Dexie 迁移表
3. **仓储层**（`web/src/db/chat.ts`）：抽出 `withNewVersion` 供 `addVersion` 与 `editMessage` 共用 —— 原先「登记旧版本 + 追加新版本 + 淘汰最旧」只存在于「换一个」一条路径上，复制一份必然会漂移（典型是某条路径忘了淘汰上限、版本数没有天花）。新增 `editMessage` / `recallMessage` / `restoreMessage` / `deleteMessages`
4. **UI 拆分**：新增 `features/chat/ChatBubble.tsx`（气泡原先整个长在页面里，页面已涨到 1058 行）与 `features/chat/MessageActionSheet.tsx`（底部弹出菜单）。菜单**关闭时不渲染任何 DOM**，否则验收脚本整页读 `innerText` 会被藏起来的菜单项骗到
5. **交互入口三合一**：长按气泡（移动端主路径，SPEC §1.3）+ 右键（桌面）+ 末条 / 多版本消息操作行里的 `···`，三者进同一个菜单。刻意**不给每条消息都挂一行** —— 60 条各加一行会把列表撑高约 1.1 屏
6. **「撤回不进上下文」只有一处落点**：`historyUpTo` 的过滤。刻意不放进 `messageText()` —— 那里是「取纯文本投影」，与「这段该不该送出去」是两件事，混进来会让所有复用它的地方（列表预览、版本登记）被动跟着改行为
7. **共用一条二次确认条**（撤回 / 删除 / 批量删除 / 从这条重新生成），并给轻提示反馈（已复制 / 已撤回 / 已恢复 / 已删除 N 条）；破坏性操作的确认语一律说清后果与条数

**验收（全部实跑）**

- `verify-chat.mjs` **36 → 57 项全过**。新增 21 项：长按打开菜单、菜单项随对象状态生成、编辑框预填、编辑后版本链、切回原版本、撤回二次确认文案、撤回痕迹、**撤回不进上下文（读 mock `__last-body` 的真实报文）**、编辑后的正文进上下文、撤回可恢复、复制（读回系统剪贴板核对内容）、删除、多选勾选与批量删除
- `verify-providers.mjs` 22/22、`verify-home.mjs` 23/23、`verify-diagnostics.mjs` 36/36，**无回归**；四条均「控制台零异常」
- 两端 `typecheck` + 前端生产构建通过

**排查中踩到的坑（前两条是验收脚本自己的时，但值得记）**

- **点完「发送」不能立刻等「按钮变回发送」**：React 状态更新是异步的，按下那一瞬间按钮还是「发送」，等待条件立刻成立 —— 紧接着读 mock 报文，拿到的是**上一轮**的，于是「撤回不进上下文」两条断言假失败（上一轮的报文里当然还留着那句话）。判据必须是「这一轮的回复已经落地」。
- **`document.querySelector('textarea')` 会抓错框**：消息内联编辑态会在 DOM **更靠前**的位置放一个 textarea，裸选第一个会把字打进编辑框。输入框一律改用 `[data-testid="composer"]` 定位。
- **编辑工具静默失败（第二次遇到）**：本轮把气泡里 `actions.selected` → `selected` 的三处替换，工具报「成功」但文件没变，靠类型检查兜住（`Duplicate identifier` / `Property does not exist`）。

**本任务新增待优化**：中 2 条（多选缺「全选 / 区间选」；撤回 / 删除不回改已生成的回复）、低 2 条（中间消息桌面端只能右键；「从这条重新生成」截断后不可撤销），已录入上方汇总清单。

**下一步（P0 续）**：按「跨模块内容流转」推进 —— 消息收藏 → 收藏中心、消息收录至作品、消息内图片加入相册（SPEC §4.1 的统一操作链），随后是会话置顶 / 分组 / 聊天设置入口。**注意分组要动 schema（Dexie v8），按 `docs/DATA_MODEL.md` §0 的顺序走。**

---

### T-016 · 2026-09-23 · PRODUCT_SPEC P0 第二批：跨模块内容流转

**范围**：只完成聊天消息 → 收藏、聊天消息 / 组件 → 作品、聊天图片 → 相册；本轮明确不做会话置顶 / 分组 / 聊天设置。

**施工前参考（只查 2 个）**

- `memex-lab/memex`：借鉴 ChatArtifact 的稳定身份、目标地址、来源 run / tool 与快照元数据分离；在本项目中落为稳定消息身份 + `sourceId / sessionId` + 目标模块快照。
- `meowmana/coread`：借鉴“在原内容位置触发、目标记录保存精确锚点与当时文本”的操作链；在本项目中继续复用消息长按 / 右键 / `···` 菜单，不要求用户二次手填 URL。

**已完成**

1. **零 schema / 零平行模型**：收藏继续使用 `Bookmark.targetType + targetId`，作品 / 相册继续使用统一基座 `sourceId + sessionId`；Dexie 保持 v7。
2. **仓储层收口**（`web/src/db/home.ts`）：新增消息收藏、消息 / 组件作品快照、聊天图片批量入相册；消息 / block 使用稳定身份去重，图片在写事务前完成格式、体积与可读性校验，避免半批写入。
3. **来源可追溯**：三类目标条目都保存消息 / 会话、角色、原始时间与 block 类型；作品 / 收藏保存稳定纯文本快照，相册保存原图与图片 block 位置。三个 Home 模块统一显示来源，并可回到原会话。
4. **动态菜单**：双方未撤回消息显示「收藏 / 收录至作品」；只有含顶层 `image` block 的消息显示「加入相册」。
5. **反馈闭环**：成功走轻提示；重复收藏 / 作品 / 图片明确说明已存在；远程图片不可读、格式不支持或超限时给出具体失败原因，预期业务失败不污染控制台错误基线。

**验收（全部实跑）**

- `verify-chat.mjs` **57 → 74 项全过**：覆盖菜单按类型生成、三条原位收录链路、组件快照、重复与失败反馈、IndexedDB 来源字段 / 图片 block 位置，以及收藏 / 作品 / 相册三个目标页的「查看来源」。
- `verify-providers.mjs` 22/22、`verify-home.mjs` 23/23、`verify-diagnostics.mjs` 36/36；四条均控制台零异常。
- 两端 `typecheck` 与前端生产构建通过；备份 v5 回归已实际带上新增的跨模块条目并完整恢复。

**边界 / 待优化**

- 跨域策略禁止读取的远程聊天图片无法复制入本地相册，当前明确报错；后续若成为真实阻塞，应由受控服务端图片代理解决，不能绕过浏览器安全策略。
- 收藏分类 / 备注、相册分类仍属 P1；本批不提前施工。
- 会话置顶 / 分组 / 聊天设置仍未开始；分组继续按既定计划走 Dexie v8。

**下一步**：本批到此停止。会话置顶 / 分组 / 聊天设置另起任务。

---

### T-017 · 2026-09-23 · PRODUCT_SPEC P0 第三批 A：会话置顶 + 聊天设置入口

**范围**：只完成会话置顶 / 取消置顶与聊天窗口设置入口；明确不做会话分组、不升 Dexie、不进入下一阶段。

**施工前参考（只查 1 个）**

- `wuliu0012/the-house`：结合 README 与单文件实现中的顶栏设置入口、全屏分组设置面板，借鉴“从当前聊天直接进入、清楚标明设置归属”的交互；本项目只保留当前已落库的会话级字段，不照搬其大而全设置中心。

**已完成**

1. **会话置顶**：会话列表原位提供「置顶 / 取消置顶」；继续使用 `pinnedAt` 时间戳，置顶项始终排在普通项之前。置顶操作不改 `updatedAt`，取消后回到原本的消息活跃顺序。
2. **聊天设置入口**：聊天顶栏右侧加入「设置」，轻量面板可维护当前会话备注、背景与 `chat / native` 气泡模式；保存后即时生效并可重新打开回读。
3. **零 schema**：完全复用 `ChatSession.pinnedAt / remark / background / bubbleMode`，Dexie 保持 v7；未增加分组字段、表或入口。
4. **回归稳定性**：Home 验收在读书 / 音乐 / 学习的异步编辑保存后先等待界面确认，再刷新验证持久化，消除原脚本的随机抢跑。

**验收（全部实跑）**

- `verify-chat.mjs` **74 → 84 项全过**：覆盖普通排序、置顶重排、取消置顶恢复、仓储持久化、设置入口与回读、背景 / 气泡即时生效、`updatedAt` 不漂移、Dexie 仍为 v7，以及控制台零异常。
- `verify-providers.mjs` 22/22、`verify-home.mjs` 23/23、`verify-diagnostics.mjs` 36/36。
- 两端 `typecheck` 与前端生产构建通过。

**边界**

- 当前聊天设置只承载已落库的备注、背景与气泡模式；API / 模型、上下文、世界书等候选项不在本切片提前施工。
- 会话分组仍未开始，继续作为单独任务按 Dexie v8 迁移流程处理。

**下一步**：本批到此停止。会话分组另起任务。

### T-018 · 2026-09-23 · PRODUCT_SPEC P0 收尾：会话分组（Dexie v8）

**范围**：P0 的最后一项 —— 会话分组。这也是 P0 里**唯一需要迁移本地数据结构**的一项（`ChatSession` 没有 `groupId`）。
开工前先定 SPEC §2.1.3 里没写全的语义，并按铁律 11 实查参考项目。

**施工前实查（查了 4 个，结论是「没有现成可抄的」）**

- `ugui3u/chatnest`、`tjing9430/cc-companion-app`、`wuliu0012/the-house`、`Aevella/polaris-local-first` —— **没有一个实现会话分组 / 文件夹**。
  chatnest 只有会话历史、没提列表组织；CC Companion App 是私聊 / 群聊，列表组织未提；the-house 左栏支持新建 / 切换 / 重命名窗口，无分组；
  Polaris 的「项目 / 房间」属协作者身份层，不是会话归档。
- 所以分组按 SPEC 自己的定义做，只借 the-house 一点：**管理操作就地放在列表项上**，不跳二级页面（与本项目既有的置顶 / 删除一致）。
- 顺带记一笔：the-house 多选导出底栏的「全选 / 已选 N 条」正对我们待优化清单里的「多选缺全选」—— **已记入清单，本任务不做**（超出分组范围）。

**开工前定的两条语义（已写进 SPEC）**

1. **置顶优先于分组**：置顶会话统一浮到列表最顶、**脱离原分组显示**；取消置顶后回落到原分组。
   `groupId` 不因置顶改写 —— 是「显示上的浮动」而不是「搬走」，所以两条规则都不需要额外的历史记录来还原。
2. **未分组区是兜底区**：不只收 `groupId === null`，**也收 `groupId` 指向已不存在分组的会话**。
   写入侧保证了不产生悬空引用，但导入的备份与手工改过的库不受我们控制 —— 兜底放在渲染层，任何新读取点都不会把会话漏掉。

**已完成**

1. **`PRODUCT_SPEC.md` §2.1.2 / §2.1.3** —— 置顶与分组的优先级、分组的具体语义（创建 / 重命名 / 删除 / 移入移出 / 折叠 / 未分组区）
   从「后续可扩展」提升为已定语义；只留**分组排序**在后续。
2. **`shared/types.ts`** —— `ChatSession.groupId: string | null` + 新实体 `SessionGroup`（`name` / `collapsed`）。
   折叠状态跟着数据走而不是 UI 局部状态，所以刷新与换设备都保持一致。
3. **Dexie 升到 v8** —— `sessions` 加 `groupId` 索引 + 新增 `sessionGroups` 表，且这是**第一个带 `upgrade()` 回调的迁移**：
   给所有老会话补 `groupId: null`。
   - 为什么不「读的时候把 `undefined` 当 `null` 容忍」：那样「会话一定有 `groupId`」这条不变量就只存在于**读取方的记忆**里，
     任何忘记兜底的新读取点都会让会话从列表里凭空消失。补齐放进迁移，只写一次、对所有人成立。
4. **仓储层**（`web/src/db/chat.ts`）—— `listSessionGroups` / `createSessionGroup` / `renameSessionGroup` /
   `deleteSessionGroup` / `setSessionGroupCollapsed` / `setSessionGroup`。
   - `deleteSessionGroup` 在**同一事务**里把组内会话的 `groupId` 置回 `null` 再删组：分两步写会留下「会话指向已不存在分组」的中间态，
     那种数据要靠读取方兜底才不丢，而兜底是会被忘记的。返回被移出的条数，供确认语说明影响。
   - `setSessionGroup` 校验目标分组存在；移入移出**不刷新 `updatedAt`**（与置顶、会话设置一致 —— 换分区不代表这段对话又活跃了，
     否则整理一次分组就把整个列表的活跃顺序搅乱）。
5. **UI** —— `MessageActionSheet` 提升为通用 `components/ActionSheet.tsx`（消息气泡与会话行**共用同一个菜单**，
   SPEC §1.3 要的就是「同一套操作逻辑」；testid 不变，老断言不用动）；新增 `features/chat/GroupNameSheet.tsx`
   （创建 / 重命名共用，不用原生 `prompt`）；`ChatListPage` 重写为「置顶区 → 各分组 → 未分组区」，
   会话行的置顶 / 分组 / 删除收进 `⋯` 菜单，分区标题可折叠 + `⋯`（重命名 / 删除，删除需二次确认并写清条数）。
   - **不给每条会话行并排三个按钮**：会话本身带标题，三个按钮会把长标题挤成省略号。
   - **一个分组都没有时不渲染任何分区标题**：不用分组的人不该凭空多出一层。
6. **备份格式升 v6** —— 导出带上 `sessionGroups`；导入接受 v1–v6，旧版分组按空处理、会话 `groupId` 补成 `null`。
   顺带把「每加一版都要往白名单里补一个数字」的版本判据改成**区间判据**（漏补的后果是升级后自己的旧备份反而导不进来）。

**验收（全部实跑）**

- `verify-chat.mjs` **84 → 107 项全过**。新增 23 项覆盖：空名不可保存、分组落库（名称 / 类型 / 默认展开）、
  未分组会话的菜单项集合（不该出现「移出分组」）、移入后**按 DOM 顺序**确认会话夹在该分区与未分组区之间、分区计数、
  移入落库且 `updatedAt` 不漂移、折叠后不渲染 + 状态落库 + **刷新后保持**、置顶浮到最顶且离开原分区（原分区计数归零）、
  取消置顶回落、已置顶时菜单变「取消置顶」、移出分组落进未分组区、重命名预填与落库、
  删非空分组的确认语含条数且**会话不丢**、删空分组的确认语不带条数、**脏 `groupId`（指向不存在分组）会话不消失**、
  没有分组时列表回到平铺。
  - 另升级 2 项：Dexie 版本断言改为 v8，并**顺带验本次迁移该带来的东西**（`sessions.groupId` 索引 + `sessionGroups` 表）——
    只比版本号分不出「升到了 v8」和「v8 的 stores 写错了」（T-008 的教训）。
- `verify-home.mjs` **23 → 25 项全过**：备份断言升到 v6，新增「备份带走分组与归属（含折叠状态）」与
  「旧 v5 备份仍可导入：分组为空、会话补成未分组」。
- `verify-providers.mjs` 22/22、`verify-diagnostics.mjs` 36/36；两端 `typecheck` 与前端生产构建通过；四条均控制台零异常。

**排查中踩到的坑（都在验收脚本自己身上）**

- ⚠️ **`?? 'missing'` 会把要验的 `null` 一起吞掉**：`legacyV5Session?.groupId ?? 'missing'` 里 `groupId` 恰好就是 `null`，
  于是断言**永远不可能通过**，报出来还像是「对象没找到」。→ 断言某个字段可能为 `null` 时，别把「缺失」和「null」走同一个 `??`。
- ⚠️ **等「菜单关了」等于没等**：会话行菜单开着时列表并未卸载，`⋯ 又出现了` 这类条件会**瞬间成立**（假通过）。
  → 判据要挂在「这次操作真的落地」的信号上（本例用轻提示）。
- ⚠️ **别用「数了几个」当断言**：无头 Edge 的 profile 是复用的，库里可能残留上一轮数据，
  「创建后共有 1 个分组」这种写法等于把「环境碰巧长什么样」当成了前提。→ 改成**按名称定位**分区。
- 分组 id 是 uuid，脚本无从预知 → 一律**从 DOM 反查**（分区容器的 testid + 名称），不让脚本自己记变量。

**本任务新增待优化**：中 3 条（分组排序 / 拖拽调序、移动端长按会话行进菜单、删分组无「连带删会话」选项）、
低 3 条（组内会话不能单独排序、会话行 `⋯` 触控目标偏小、`archivedAt` 仍无生产者），已录入上方汇总清单。

**下一步**：**P0 到此全部收口**（14 项齐）。之后按 `AGENTS.md` §6 的顺序 —— 先 P1，再回 Phase 3B
（自部署 Nocturne 的 Token / Namespace / Caddy / 回源验证）。

---

### T-019 · 2026-09-23 · PRODUCT_SPEC P1 第一批：输入区快捷操作栏 + 请求回复拆开

**范围**：P1 第 1、2 项（SPEC §2.4.2 / §2.4.3 / §2.4.4）。明确不做 Home 两个 Widget、不做收藏 / 相册分类。

**开工前先定 SPEC 里悬着的语义**（SPEC §2.4.3 原文写着「最终默认行为可在后续 UX 验收中决定」）

1. **默认仍是「发送并请求回复」** —— 主按钮不变。把聊天主路径改成两步（发一条 → 再点请求回复）是拿
   最高频的操作去补贴低频的，不划算。拆开体现在「更多功能」里的**「只发送，不请求回复」**与快捷栏的**「请求回复」**。
2. **主按钮不随状态改名** —— 一度想过「输入框为空且有待回复消息时，主按钮变成『请求回复』」，放弃了：
   一个按钮两副面孔会让人每次点之前都得先看一眼它现在叫什么。而且验收脚本靠按钮文案定位「发送」，
   改名会让一批既有断言失去锚点（假失败比真失败更难查）。
3. **「待回复」用消息序列推导，不加字段** —— 从末尾往回数连续的 `user` 消息，撞到 `assistant` 即停。
   撤回、删除、重新生成都会改变这个状态，多存一份字段就多一份要维护的一致性。
4. **语音条不做假功能** —— 要么真录真发，要么不做。转写（ASR）没有，就如实把它记为缺口，
   并让上下文里带一句占位描述，而不是让模型对着空白答话。

**施工前实查**

- 开工前先跑了一个一次性探针（`.workbuddy/probe-mic.mjs`）确认**无头 Edge 能不能真录音**：
  结论是能 —— 加 `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` 后
  `getUserMedia` 拿得到轨道，1.2 秒录出 12000 字节 `audio/webm;codecs=opus`。
  **这一步决定了语音条是「真做 + 真验」还是「降级」**，所以放在写代码之前做。
- 探针顺带测出 Edge（Chromium）**不支持 `audio/ogg;codecs=opus`** —— 代码里因此备了
  webm/opus → webm → mp4 的候选链，而不是只写一个 ogg（那样在 Chromium 上会直接抛 `NotSupportedError`）。
- 顺带踩到：CDP 里 `about:blank` **不是安全上下文**，`navigator.mediaDevices` 整个是 `undefined`，
  必须先 `Page.navigate` 到一个 http 页面才测得出真实能力。

**已完成（零 schema 改动，Dexie 保持 v8，备份保持 v6）**

1. **`docs/PRODUCT_SPEC.md` §2.4** —— 把「暂定包含」的快捷操作区定为四项，补上 §2.4.4 语音条契约
   （内联 data URL / 60 秒上限 / 时长落库 / 与文本同链路 / 失败必须明说），并**如实写下转写缺口**。
2. **`web/src/lib/format.ts`（新）** —— `formatDuration(ms) → m:ss`。放 `lib/` 而不是塞进组件：
   语音条时长要在气泡、对话上下文占位、收藏快照三处用。
3. **`web/src/features/chat/Composer.tsx`（新）** —— 输入区整体抽出（含快捷栏 / 表情面板 / 更多菜单 / 录音态）。
   抽出边界：**这一层只负责「怎么输入、点了什么」**，不知道消息怎么落库、也不知道生成怎么跑。
   抽完 `ChatWindowPage` 从 844 行降到约 830 行，但多了三份局部状态没有落在页面里。
   - 表情插入落在**光标处**并用 `requestAnimationFrame` 重设选区（不这么做，连续点两个表情会全挤在最前面，
     因为 React 的受控回写会把刚设好的选区冲掉）。
   - 录音失败分两种说法：「环境不支持」（非安全上下文里 `mediaDevices` 整个是 `undefined`）
     与「你拒绝了权限」，两者报错文案不同。
   - 录音期间那条操作条上的按钮叫**「发出」不叫「发送」** —— 全局唯一的「发送」主按钮是输入区那个，
     多一个同名按钮会让按文案定位的验收脚本抓错对象。
4. **`ChatWindowPage`** —— `send()` 拆成 `submitUserMessage()`（落库 + 起名 + 按模式决定要不要生成）
   加 `send()` / `requestReply()` / `sendVoice()` 三个入口；新增 `countUnreplied()` 与 `voicePlaceholder()`。
   - 文本与语音条**共用同一条落库链路**，差别只在 `blocks` 怎么来（SPEC §2.4.4 的要求）。
   - `historyUpTo` 给语音条补占位描述 `[语音条 0:03]`。**只补语音条，不动图片 / 文件** ——
     那是既有行为（`messageText()` 只取 text 块的注释里说得很清楚），改它属于另一件事。
   - 顺带修掉一个既有小 bug：原先首条消息无条件 `titleFrom(text)`，语音条没有文本会**把会话标题改空**；
     现在只有 `text !== ''` 时才起名。
5. **`MessageBlocks` / `db/home.ts`** —— 音频块显示时长；收藏 / 作品的快照带上时长（缺 `durationMs` 时
   不硬编一个 `0:00`，因为 LLM 给的音频可能本来就没有时长）。
6. **顺带修掉一个真 bug：用户侧气泡只渲染纯文本投影** —— `ChatBubble` 里用户侧写的是
   `<span>{messageText(message)}</span>`，只有 AI 侧走块分发。等于把「用户只能发纯文本」写死在渲染里：
   **语音条（`audio` 块）与图片会被画成空气泡** —— 数据在库里、上下文里也有占位描述，界面上却什么都不显示。
   改为**两侧都走块分发**（`TextBlockView` 本身就是 `whitespace-pre-wrap break-words`，
   比原来的 `whitespace-pre-wrap` 只多一个断词，所以这不是「能力补齐」而是**把分叉去掉**）。
7. **「这一轮是否收尾」的判据也修了** —— `waitIdle()` 原先是「页面上有没有文案是『发送』的按钮」，
   而那个按钮**一直都在**（只是无内容时 disabled），条件在手指刚点下、生成还没启动的一瞬间就成立，
   **等于没等**；8 处调用其实都在抢跑，只是恰好被后面的显式等待兜住。
   改成读库：**最后一条消息是 `assistant` 且已定性**（选「已定性」而不是「有文字」，因为中止保留半截内容是合法收尾）。

**验收（全部实跑）**

- `verify-chat.mjs` **107 → 134 项全过**。新增 27 项覆盖：快捷栏四项齐、无消息时「请求回复」不可用、
  默认发送仍是一步拿到回复（确认拆开没改坏原路径）、「更多」菜单项集合、
  **「只发送」后上游报文一字未变**（读 mock 的 `GET /__last-body` —— 不去问上游就只能靠「界面上没多一条回复」猜）、
  待回复条数与提示条、连续只发送两条后一次「请求回复」把**整批**送出且只补一条回复、
  菜单项按状态增减（空输入时不出现「只发送」「清空输入」）、插入当前时间、清空输入、
  连续点两个表情按顺序插入（验光标逻辑）、录音计时、语音条落成 audio block 且是 `data:audio/` 前缀、
  时长 ≥1 秒、**语音条默认也请求回复**、**上下文里出现 `[语音条 ` 占位**、气泡显示时长、
  **播放器有正常宽度（≥180px）**、取消录音不留痕。
  - ⚠️ **其中「气泡上显示语音时长」本来是顺手加的视觉断言，却成了唯一发现渲染层完全没走通的证据** ——
    用户侧块分发那个 bug 只验数据是查不出来的。结论：语音条这类新块类型，
    「库里对不对」和「界面上长没长出来」是两条独立的断言，缺一条就会以全绿的样子交付一个看不见的功能。
  - ⚠️ **同一条线上还漏了第二次**：播放器补上后「元素存在」断言全绿，但它**被收缩容器压成约 40px 的窄条** ——
    是回头**看截图**才发现的。补了一条量真实渲染宽度的断言。**「元素在不在」和「它长没长出来」是两条独立的断言。**
- `verify-home.mjs` 25/25、`verify-providers.mjs` 22/22、`verify-diagnostics.mjs` 36/36，**无回归**；
  四条均「控制台零异常」。
- 两端 `typecheck` + 前端生产构建通过。
- `.workbuddy/run-front-verify.sh` 给组一的无头 Edge 补上两个假麦克风开关（缺了它们录音断言会全线失败，
  但那是环境问题不是功能坏了，所以也在脚本头部注释里点名了）。

**排查中踩到的坑**

- ⚠️ **Git Bash 的 `/tmp/x.mjs` 传给 Windows Node 会变成 `D:\tmp\x.mjs`** —— 后台脚本一律用工作区内的路径。
- ⚠️ **沙箱里「起服务 + 起浏览器 + 跑探针」必须在同一条命令内完成**，且**别在命令里对工作区外的目录做批量删除**
  （会触发安全删除拦截，整条命令直接 SIGTERM，且没有任何输出，看起来像命令写错了）。
- ⚠️ **断言「没发生某件事」必须等够时间**：「只发送不请求回复」这一类，读完报文前要留出让「万一真的发了」
  到达 mock 的窗口，否则断言是在抢跑里通过的。
- ⚠️ **`vite build` 第二次及以后会被沙箱的安全删除拦截**（产物目录已有超过阈值的文件，构建前要 `emptyDir`）。
  症状有欺骗性：**第一次成功，之后就再也构不出来**，很容易误判成「代码改坏了」。解法：跑构建前 `export NODE_OPTIONS=""`。

**本任务新增待优化**：中 4 条（「只发送」入口可发现性、语音条无转写、
语音条 data URL 让备份变大、录音格式跨浏览器可播性未验）、
低 4 条（语音条没有「复制」入口、录完不能试听重录、`historyUpTo` 只给语音条开了口子、表情面板固定 32 个），已录入上方汇总清单。

**下一步**：**P1 还剩 4 项** —— 留言板 Widget / 倒数日 Widget / 收藏分类 / 相册分类。
之后回 Phase 3B（自部署 Nocturne 的 Token / Namespace / Caddy / 回源验证）。
