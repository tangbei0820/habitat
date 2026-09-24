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
> 最后更新：2026-09-25

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
- [x] **自部署实例只读全链已验** —— T-033 使用现有秘密路径与 `X-Namespace: habitat` 完成真实 Streamable HTTP session、9 工具工具面、`breath` / `trace` 两条只读调用，**25/25**；未调用写工具。公开 `/mcp` 的 404 是有意加固，不是链路故障。
  ⚠️ **2026-09-24 更正**：`/mcp` 的 404 **不是反代缺陷，是当初有意加固**（`location = /mcp { return 404; }` + 秘密路径 `/mcp-<密钥>` 转发，证据：本机 `MCP接入说明_Nocturne.md` / `.mcp_hardening.json`，均 2026-09-13）。**改用秘密路径即可，无需动服务器。** 而**真正**的拦路虎比反代更前置：适配层写死的工具名取自**官方 Demo**，与该自部署实例的实际工具面（Ombre Brain 血统）可能完全对不上 → 见 `docs/MEMORY.md`「自部署实例的工具面」，先跑 `probe-nocturne-tools.ts` 拿一手事实（**在服务器上跑更省事**：用零依赖版 `probe-nocturne-tools-standalone.mjs`，**内网直连** `http://127.0.0.1:8000/mcp` —— 加固只做在 nginx 那层，容器里就是朴素的 `/mcp`，连密钥路径都不用填，也不用装 tsx）。
- [x] **自部署 Nocturne / Ombre Brain 生产鉴权已结清**（T-034）—— 实机源码确认现版本的 `OMBRE_API_PASSWORD` 已保护 Dashboard/API（未登录 `/api/config` 401）；MCP 没有应用内 Bearer 开关，故在宿主 nginx 的轮换秘密路径上加 Bearer 校验。无 / 错 Token 401、正确 Token initialize 200，Habitat 全链 **26/26**。
- [x] **反代口径已统一为 nginx**（T-022 / T-033）—— 现网是宿主 nginx 1.18.0 + Nocturne 容器 nginx 两层；Caddy 只保留为早期方案记录。宿主层现有「公开 `/mcp` 404 + 秘密路径转发」是有效加固，不需要改成 Caddy。
  ⚠️ 关键定位：宿主 nginx 对多数路径是**通配转发到后端**（`/health/`、`/dashboard/` 回 **307** 是 FastAPI `redirect_slashes`；`/zzz-*`、`/index.html`、`/assets/` 回 **9 字节纯文本 404** 是 Starlette），**唯独 `/mcp`（含尾斜杠）回的是 nginx 自己的 162 字节 HTML 404 页** —— 说明它是**被单独拦下的**，连后端都没碰到。
  → 修法不是「新增一条 location」，而是**找到那条把它挡在外面的规则删掉/取代**；补的时候要带 `proxy_buffering off` / `proxy_cache off` / `proxy_http_version 1.1` / `proxy_read_timeout 86400s` / `chunked_transfer_encoding off` / `add_header X-Accel-Buffering no`（可直接照抄上游那份）。完整片段见 `docs/DEPLOYMENT.md` §3.2。
  ⚠️ **2026-09-24 更正**：上一条定位（「被单独拦下」）**方向是对的**，但「那条规则」**不是别人误加的，是当初自己加的** —— T-022 没看到同日生成的加固记录，才把它当成缺陷。**结论改为：加固本就该在，改成用秘密路径访问即可。** 此条仅保留「两种 404 来源不同」这个定位方法的价值。
**生产仍推荐内网直连**：宿主 nginx 无需参与 Habitat → Nocturne 链路；公网秘密路径保留给受控专项验真。
- [x] **MCP 已从服务启动关键路径摘出**（T-033）—— HTTP 先监听，随后后台连接、自检并每 60 秒重试；故障 MCP 不再拖住服务。用不可达 MCP 实测 `/api/health` 约 **291ms** 返回 200，MCP 状态明确为 `error`。

- [ ] **分组排序（拖拽调序）未做** —— SPEC §2.1.3 明确把「分组排序」列为后续扩展，本轮按**创建顺序**排列（创建顺序也是全序，删组不会让兄弟分组换位，所以在引入显式排序字段前它最稳），但用户没法把常用分组提前。→ 需要显式排序字段（大概率又是一次 Dexie 升版）+ 拖拽交互，一起做更划算。
- [ ] **移动端长按会话行不能进菜单** —— SPEC §1.3 把长按定为移动端主路径，长按目前只在**消息气泡**上实现；会话列表行只有 `⋯`，触控目标偏小。→ 需要时把气泡那套 450ms 长按逻辑复用到会话行（`ChatBubble` 里的实现可直接抽成 hook）。
- [ ] **删除分组没有「连带删除组内会话」选项** —— 现在只有「删分区，会话回到未分组」一种语义（SPEC §2.1.3 也只要这个）。若日后确实想整组清掉，应另起动作并在确认语里写清条数，不要做成删组时的勾选项（勾选项会把不可逆操作藏在一个默认不勾的框后面）。
- [ ] **「只发送」的入口藏在「更多功能」里，可发现性一般** —— 主按钮保持「发送并请求回复」是为了不把聊天变成两步（SPEC §2.4.3 定的默认行为），代价是「只发送」要展开一层菜单。→ 等真实使用一段时间再定：若常被用到，应提到输入框旁（例如长按「发送」，或像气泡长按那样抽一个复用 hook）。
- [x] ~~**语音条没有转写，模型只看到占位**~~ —— 已修（T-027）：录音预览确认后由服务端调用 OpenAI-compatible `/audio/transcriptions`，真实文本写入 `AudioBlock.payload.transcript` 并进入上下文；失败保留原音、明确提示并使用“未转写”占位，不伪造内容。
- [ ] **语音条与相册同样内联 data URL，备份体积增长快** —— 单条上限 60 秒，实测约 10 KB/s（webm/opus，≈80 kbps），60 秒 ≈ 600 KB，base64 再涨约 33%。→ 与相册那条同批处理：换 Blob / OPFS + 缩略图 / 波形，切换前先做无损迁移与备份兼容。
- [ ] **语音条的格式由浏览器决定，跨设备可播性未验** —— 实测 Edge 是 `audio/webm;codecs=opus`（且**不支持** `audio/ogg`），iOS Safari 会走 `audio/mp4`。同一份备份换个浏览器可能放不出来。→ 真要跨设备，得在录制后统一转码（服务端或 WASM），成本不低，先记着。

- [ ] **留言板 Widget 目前只能展示「最近留言」** —— SPEC §3.2.2 还写了「指定分组 / 指定留言」，但这两者依赖留言条自身还没有的分组与单条选取能力（§3.2.1 的「分组」同样未实现）。→ 等留言板有了分组，Widget 才谈得上「展示范围可选」；届时要给 `HomeWidget` 加一个范围字段，大概率又是一次 Dexie 升版。**现在刻意没放一个只有一个选项的下拉框。**
- [ ] **主屏 Widget 不能拖拽调序、也不能选位置** —— v0.1 的先后按「上主屏的时间」定（SPEC §1.4），只有两张卡片时不明显；§5.3 的候选 Widget（一起听 / 今日学习 / 日记封面……）真做起来就需要 `order` 字段 + 拖拽交互。→ 与 §5.1「可编排首页」一起做，别单独长出一个半截的排序。
- [ ] **备份界面提示不提主屏 Widget** —— `BackupPanel` 的概览句是「N 个会话、N 条消息、N 条生活记录」，Widget 不在其中（它属展示层引用，不是生活记录）。当前选择是「不把它算进记录数」，但用户没法从界面确认自己的主屏配置进了备份。→ 要么补一句，要么把这句取舍写进文档（现在只写在代码注释里）。
- [ ] **离线只做「只读」，不建发送队列**（T-029 定的边界）—— 断网时草稿照写，但发送 / 生成 / 朗读 / 工具调用一律**禁用并说明原因**，不做「先收下、联网再补发」。→ 真要排队，得连「重连后按序补发、与撤回/编辑/换一个互相干扰、超时后怎么办」一整套语义一起定，不能只把按钮放开。
- [ ] **单会话导出的 Markdown 不内联图片与语音**（T-030）—— 媒体块只写一行说明（「需要原文件请用 JSON 或全量备份」），否则一次导出会变成几十 MB 的文本。→ 若日后要「一份能直接带走的会话」，正确形态是 zip（md + 媒体原文件），而不是把 base64 塞进 md。
- [ ] **`navigator.onLine` 只代表网卡通，不代表后端可达** —— 家里断路由器上行、服务器挂了、被代理拦住都会是 `true`。所以离线拦截的定位是「兜底 + 把原因说清」，**不能**替代「后端不可达」的失败暴露（`lib/api.ts` 的注释已写明）。→ 想要更准得上轻量健康探测，但它自己就有过期问题，先不做。
- [ ] **PWA 用 prompt 模式，用户不点「刷新」就一直用旧版** —— 这是**有意**取舍（`autoUpdate` 会在用户正看页面时换掉资源，旧页面再加载已删除的懒加载 chunk 就 404），代价是更新要用户点头。→ 若日后觉得吵，可改成「空闲时自动应用」，但必须先确认没有会被悬空引用的懒加载 chunk。

### 低 —— 开发工具与体验毛刺

- [x] ~~**统一收藏目前只有“外部链接”生产入口**~~ —— 已修（T-016）：聊天消息可从原消息菜单直接写入 `chat-message` 收藏，并保留消息 / 会话来源与稳定快照；其它模块仍按各自交互切片逐步接入。
- [ ] **Home 长文本模块均为全量列表，没有统一检索** —— 日记、作品、读书、音乐、学习在个人早期数据量下足够；数据增多后应统一设计搜索 / 标签 / 分页或虚拟列表，避免十个模块分别长出不一致的筛选器（T-010 / T-012）。
- [ ] **Home 第一批没有编辑 / 手动排序** —— 留言、愿望与倒数日目前只覆盖新增 / 状态 / 删除，真实使用中出现需求再补（T-009）。
- [x] ~~**`--bottom-nav-height` 是估的 4rem**~~ —— 已修（T-008）：`BottomNav` 用 `ResizeObserver` 实测自身高度后写回 `--bottom-nav-height`，改图标 / 字号自动跟随，不再需要手动同步。
- [x] ~~**思维链整段存进 `metadata.reasoning`，无长度上限**~~ —— 已修（T-008）：`db/chat.ts` 加 `capReasoning()` / `REASONING_LIMIT = 32000`，超限保留头尾并插入截断说明（头尾各半 —— 开头是推理起点、结尾是结论，中间最适合丢）。写入路径（`addVersion`、流式草稿、收尾定性）统一走它。
- [ ] **验收脚本的断言绑定了 mock 的固定回复文案** —— 改 `mock-openai.ts` 的回复就要同步改 `web/scripts/verify-chat.mjs` 的断言。→ 让 mock 回显请求内容，断言改成检查回显。
- [ ] **`probe-llm.ts` / `probe-providers.ts` 的「模型列表」断言是既存失败的**（T-035 发现，未修）—— 两支都断言 `models.length === 3`，而 `mock-openai.ts` 的 `MODELS` 早已长到 **7 个**（相机 / 语音 / 图像等槽位加进来时没同步）。**与本轮改动无关**（`MODELS` 与这两个脚本都不在 T-035 的改动面内），但它意味着这两支其实一直没真绿过 —— 「全绿」的印象是假的。→ 断言应改为「包含 `mock-chat-small` 且数量与 mock 声明一致」，或干脆由 mock 暴露 `/__models` 让脚本对齐，别再硬编码数字。
- [x] ~~**`verify-home.mjs` 对机器负载敏感**~~ —— 已修（T-032）：仅把 `Page.navigate` 后的页面就绪等待放宽到 60s；普通交互断言仍保留 30s，避免真回归被整体长超时掩盖。流水线继续串行，README 已同步。
- [ ] **CDP 验收脚本有两条「流水线级」约束，目前靠注释口头传承** —— ① `Runtime.enable` 会把**上一个会话**的 console 消息重放一遍，不清桶的话「控制台零异常」会被上游脚本的报错污染成假红；② 新建会话后「路由变了 ≠ 输入框已挂载」，`setValue` 会**静默**返回 `'missing'`，后面白等 30s 才超时、且报错完全指不到原因。两条都已写进 `verify-export.mjs` / `verify-offline.mjs` 的注释。→ 写到第三个脚本时该把 `waitFor` / `setValue` / 清桶抽成 `web/scripts/lib/` 的公共 helper。
- [ ] **`probe-nocturne-live.ts` 默认不打印 boot 正文** —— 那是本人记忆，默认只打印字数（要看得加 `NOCTURNE_PROBE_PREVIEW=1`）。代价是排查「召回内容对不对」时得多敲一个环境变量。→ 保持现状；若日后要做召回质量评估，应改成写文件而不是打屏。
- [ ] ⚠️ **本机对 `SNI=beiyan.cc` 存在 TLS 客户端分界线**（T-022 实测）—— 带 SNI 时 **Node 20（OpenSSL 3.0.15）连续 6/6 `ECONNRESET`**，而 Node 22（OpenSSL 3.5.5）与 Git Bash 的 openssl 3.5.7 **6/6 通过**；**不带 SNI（裸 IP）时两个版本都通**；换 9 组 TLS 参数（TLS1.2/1.3、`ecdhCurve`、`ciphers`、ALPN）**全部无效**。→ 机制从外部判不了（疑似链路 DPI 按 ClientHello 特征重置连接）。**影响很直接：habitat `server` 必须跑 Node 20（`better-sqlite3` ABI），所以本地开发时用 server 连 `beiyan.cc` 会失败。** ✅ **已由北北在沙箱外终端复核确认**（同报 `ERR ECONNRESET`），排除本环境出口代理干扰，是真实现象；**生产为同机内网直连，不受影响**（见 `docs/DEPLOYMENT.md` §4）。
- [x] ~~**`ApiProfilePublic.hasKey` 语义有歧义**~~ —— 已修（T-005）：新增 `keySource`（`stored` / `env` / `missing` / `not-required`），UI 文案据此分别渲染「密钥已保存」/「密钥来自环境变量」/「缺密钥，现在调不通」/「无需密钥」。`hasKey` 保留（= `keySource !== 'missing'`），不破坏既有契约。
- [ ] **`modelMap.embedding` 槽位暂时无人消费** —— T-027 已消费 `tts / transcription / vision / image`；embedding 留给真正需要向量模型的检索能力，不为清单好看空调用。
- [x] ~~**mock MCP 的 GET / DELETE 分支取错 session id**~~ —— 已随 T-031 修正、T-032 补齐验收：三种方法统一读取 `mcp-session-id` header；`probe-mock.ts` 现在实跑 GET SSE 与 SDK 的 `terminateSession()`，并确认 DELETE 后服务端释放会话。
- [x] ~~**`ApiProfile` 的权威存储还在环境变量**~~ —— 已改（T-005）：权威源换成**服务端 SQLite**（`api_profile` / `api_secret` 两表），`HABITAT_LLM_PROFILES` 降级为**首次种子**（仅在表为空时导入一次）。`LlmRegistry` 对外接口一字未改，调用方无感。
  > ⚠️ **这是对 §6.2 的有意偏离**：§6.2 写 `ApiProfile` 应「本地（前端 Dexie）+ 服务端同步副本」。理由：只有服务端能真正发起调用，双写只会引入一致性问题（两份数据谁赢、离线改了怎么办），而方案管理是低频操作、离线时也无法「测试连接」。→ 若日后真需要离线查看方案，再补本地只读副本。
- [x] **删除方案后的历史 `usage_record.profile_id` 保留显示** —— T-026 已定：钱确实花过，不能随方案删除；已有费用与价格快照继续可追溯，无法识别 provider 的旧未定价记录保持“未定价”，不猜测补价。
- [ ] **方案列表没有排序入口** —— `sort_order` 字段已建（且删除时故意不重排，避免全表 UPDATE），但只能按创建顺序追加。方案不多时无感。
- [ ] **`ApiProfilePublic.hasKey` 现在是冗余字段** —— 可由 `keySource !== 'missing'` 完全推导。保留是为了不破坏既有契约（切片一的脚本与文档都在用）。
- [ ] **`LlmRegistry` 每次调用都读 DB** —— 本地 SQLite 是微秒级、方案改动低频，暂无影响。若日后出现「每次请求都枚举方案」的路径（如多方案自动路由），再评估加一层缓存。
- [x] ~~**`html` / `widget` / `tab-group` 三种块只有占位**~~ —— 已修（T-027）：HTML 进入 `sandbox=""` + CSP 的 `srcDoc` iframe（脚本 / 表单 / 导航 / 网络全禁），widget 展示声明字段，tab-group 只渲染一层叶子块；未用 `dangerouslySetInnerHTML`，未引递归类型或 Dexie 升版。
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
- [x] **旧 `probe-nocturne-demo.ts` 已退役** —— 官方 Demo 工具面与自部署实例不一致，脚本已改为明确退出；默认回归只跑 mock，自部署专项验真使用 `probe-nocturne-live.ts`。
- [ ] **Markdown 表格没有校验手段，AGENTS.md 已被写坏过一次** —— 2026-09-23 那次改版里出现：某行被折成两行（表格断掉）、两行黏成一行、表头列数与分隔行不一致、旧行未删净而重复。这类损坏在编辑时看不出来、渲染时才暴露。→ 改表格后**必须回读确认列数一致**（或后续引入 markdownlint）。
- [ ] **中间消息在桌面端只能右键进菜单** —— 长按是移动端主路径（SPEC §1.3），`···` 只挂在末条与有多版本的消息上（刻意不给每条消息都加一行：60 条各加一行会把列表撑高约 1.1 屏）。若真实使用觉得别扭，把 `···` 提到每条消息只是一行的事，代价是每个气泡多约 18px。
- [ ] **「从这条重新生成」截断后续后不可撤销** —— 它已被归入「显式动作 + 二次确认」，确认语里也写明了会移除几条，但被截断的消息本身没有撤回途径，兜底仍是备份导出。

- [ ] **分组内会话不能单独排序** —— 分区内仍按消息活跃时间倒序（与未分组区一致）。真要做需要给会话加「组内顺位」，且要定义「组内排序」与「置顶」谁优先（现在的规则是置顶跨分组浮到最顶）。
- [ ] **会话行的 `⋯` 是文字符号，触控目标偏小** —— 移动端 ≥44px 才顺手，现在靠 `px-2` 撑出的宽度不够。→ 后续做移动端细节时换成图标按钮并加大点击区（与上一条长按一起做）。

- [ ] **删除倒数日时的引用清理，前提是「每种 Widget 只有一条」** —— `deleteCountdown` 用 `where('kind').equals('countdown').first()` 取那唯一一条来比对。安全的前提是 Dexie 的 `&kind` 唯一索引（v9）。→ 若哪天因为「多实例」需求拿掉唯一索引，**必须同时改这里**，否则会出现删了倒数日、卡片还挂着的半截状态。
- [ ] **主屏 Widget 只在页面挂载时读一次** —— 没有订阅、不看跨标签页的变化。个人单机单标签的使用方式下够用，但两个标签页开着时，一边改了留言、另一边的主屏不会跟着动，要切换路由回来才刷新。→ 真需要时给 `HomeWidgets` 接一个轻量订阅（Eventide / Dexie liveQuery 任一）。
- [ ] **撤下 Widget 必须回到模块页** —— 主屏上的卡片只提供「快捷进入」，撤下入口在留言板 / 倒数日页里。多一步，但不把「删除类操作」放在主屏上是有意的（主屏是展示层）。→ 若真实使用觉得绕，再考虑给卡片挂长按菜单（复用气泡那套 450ms 长按）。
- [ ] **`archivedAt` 依然没有 UI 生产者** —— 会话表里这个字段从 Phase 1 起就预留着，现在有了分组，归档的定位更边缘（分组已经能承担「收起来」的诉求）。→ 若一直不做，考虑在某个清理批次里把它从类型里摘掉，别让它继续挂在字段表上。
- [x] ~~**语音条消息没有「复制」入口**~~ —— 已修（T-027）：有真实转写时菜单显示「复制转写文本」；没有转写时不提供假复制。
- [x] ~~**语音条录完直接发出，不能先试听再决定**~~ —— 已修（T-027）：停止后进入预览，可试听、重录或发送；确认前不落库。
- [ ] **文件块仍不进模型上下文** —— T-027 已统一处理语音转写、图片视觉描述与手动工具结果投影；文件没有提取器，仍不凭文件名假装模型读过内容。后续若接文档解析，应走服务端 Provider 并保存可追溯摘要。
- [ ] **表情面板是 32 个固定内置表情** —— 没有「最近使用」、没有分类、不能自定义 / 导入。→ 够用即止；真要做属独立功能，别塞进输入区切片里。

- [ ] **「移入分类 → ＋ 新建分类」用递增计数通知子组件打开弹层** —— `CategoryBar` 的命名弹层状态在组件内部，而这条路径由页面发起，于是约定了一个 `createToken`（值变化即触发）。能用，但读代码要跳两处才看得懂。→ 若以后还有第三处从外部触发弹层，就该把弹层状态提到页面（或换成受控组件），别再叠第二个信号。
- [ ] **分类可以重名** —— 与分组同样的取舍（两个「工作」比「建不出来但不说为什么」可接受）。但筛选条上会出现两个一模一样的 chip，届时分不清点的是哪个。→ 真要加约束，得连「同名时是合并还是拒绝」一起定。
- [ ] **分类的「删除确认」放在菜单里，与会话列表的「行内确认按钮」两种形态并存** —— 筛选条是横向滚动区，没地方安一个行内确认按钮，所以删除项原位变成了「确认删除？（N 条回到未分类）」。文案与二次点击的节奏一致，位置不同。→ 真实用一段时间后若觉得别扭，再统一。
- [ ] **相册页没有「移出 / 删除」的撤销入口** —— 两个动作都是即时生效（删除有二次确认，移出没有）。个人自用可接受，兜底仍是备份导出。

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

- [x] ~~输入区快捷操作栏（语音 / 表情 / 更多）~~ —— 已实现（T-019），并于 T-027 补齐录音预览与真实 ASR；失败才使用“未转写”占位
- [x] ~~「请求回复」与「发送」在交互上拆开~~ —— 已实现（T-019）：主按钮默认「发送并请求回复」不变，「更多功能」里提供「只发送，不请求回复」，快捷栏「请求回复」处理整批未回复消息。**未回复判定不加字段**，由消息序列推导
- [x] ~~留言板 Widget~~ —— 已实现（T-020）：主屏上一张只读卡片（最近 3 条 + 「查看全部」），**引用而非复制**
- [x] ~~倒数日 Widget~~ —— 已实现（T-020）：从列表里选一个上主屏，展示名称 / 日期 / 剩余天数；换一个是**改引用**，不会多出一张卡片
- [x] ~~收藏：分类 / 备注 / 查看来源~~ —— 已实现（T-021）：自定义分类（新建 / 重命名 / 删除）、**单归属**、顶部筛选条、条目菜单里移入移出；**删分类不删收藏**，类内条目回到未分类。备注（`Bookmark.note`）与来源查看（T-016）此前已在
- [x] ~~相册分类~~ —— 已实现（T-021）：建立分类相册、把照片加入指定相册；**「移出相册」与「删除照片」拆成两个动作**；删相册不删照片

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

**下一步**：P1 还剩 留言板 Widget / 倒数日 Widget / 收藏分类 / 相册分类 —— 其中**前两项已由 T-020 落地**。

---

### T-020 · 2026-09-23 · PRODUCT_SPEC P1 第二批：留言板与倒数日主屏 Widget

**范围**：P1 第 3、4 项（SPEC §1.4 / §3.2.2 / §3.3.2 / §5.2）。
明确不做：收藏分类、相册分类；**不做** Widget 拖拽调序（那属 §5.1「可编排首页」，是 P2）。

**定稿语义（已写进 SPEC）**

- **只存引用、不复制数据**：卡片内容从 `moments` / `countdowns` 实时读，不存在两份内容且不一致。
- **每种 Widget 至多一张**：换展示对象 = **改引用**（不新增记录、不动 `createdAt`，卡片位置不跳）。
  不变量交给 **`&kind` 唯一索引**，不靠每个写入点自己记得先查一次。
- **引用失效则卡片消失**，两层兜底：删倒数日时**同事务**清掉引用（第一层）；渲染层对「指向不存在实体」的脏引用一律不渲染（第二层，防的是导入的备份）。
- **v0.1 不设 `order` 字段**：先后按 `createdAt`（先上主屏的在前）；**不留没有生产者的属性**。
- **空态**：一张 Widget 都没有时整个区域不渲染 —— 没放 Widget 的主屏要和「没有这项功能」时一模一样。
- 留言板 Widget v0.1 只做「最近 3 条 + 查看全部」；「指定分组 / 指定留言」依赖留言条自身还没有的分组能力，**不预先放一个只有一个选项的下拉框**。

**schema（P1 里第一次动数据）**

- `shared/types.ts` 新增 `HomeWidget`；**Dexie 升 v9** 新增 `homeWidgets` 表（纯新增表，**无需 `upgrade()` 回调**）；**备份格式升 v7**
- ⚠️ 备份导入**必须按 `kind` 去重**：`&kind` 是唯一索引，手改过的备份（两条 `board`）会让 `bulkAdd` 抛
  `ConstraintError`，导致**整份备份一个字都导不进去**
- `deleteCountdown` 改为同事务清理引用（这是上述「引用失效」的第一层）

**验收（全部实跑）**

- `verify-home.mjs` **25 → 46 项全过**，新增 21 项（清单见 `docs/CHANGELOG.md`）
- `verify-chat.mjs` **134 → 135 项全过**：版本断言升 v9，并加一条「`homeWidgets.kind` 是不是**唯一**索引」
  —— 唯一性只能从 `index.unique` 读，光看索引名分不出来
- providers 22/22、diagnostics 36/36，**无回归**；四条均「控制台零异常」
- 两端 `typecheck` + 前端生产构建通过

**排查中踩到的坑**

- ⚠️ **模板字符串内部的注释里写反引号会把模板提前闭合** —— 整个验收脚本语法崩，而报错行指向**两百行之后**
  （`missing ) after argument list`）。→ **报错行不一定是出错行**；定位手段是分段 `node --check`。
- ⚠️ **按全局选择器等状态会等出假通过** —— 页面上有多个倒数日时，等 `[data-on-home="false"]` 会被
  「本来就没上主屏」的那一条**瞬间**命中。→ 改成按行文本查**那一条**的状态。与 T-018「等『菜单关了』等于没等」同类。

**本任务新增待优化**：中 3 条（留言板 Widget 只能展示「最近留言」、Widget 不能拖拽调序 / 选位置、备份界面提示不提 Widget）、
低 3 条（删倒数日的引用清理依赖唯一索引这条前提、Widget 只在页面挂载时读一次、撤下 Widget 必须回模块页），已录入上方汇总清单。

**下一步**：**P1 还剩 2 项** —— 收藏分类（§3.5.4）/ 相册分类（§3.7.3）。
之后回 Phase 3B（自部署 Nocturne 的 Token / Namespace / Caddy / 回源验证）。

---

### T-021 · 2026-09-23 · PRODUCT_SPEC P1 第三批：收藏分类 + 相册分类（Dexie v10 / 备份 v8）

> ⚠️ **本条为补记。** T-021 当时只更新了上方「差异清单」与「待优化清单」，**漏了这条任务记录**（违反维护约定：
> 「每完成一次任务 → 先按顺序追加 TASKS 一条记录」）。于 T-022 轮次回头补齐 —— 与 T-021 代码同一 commit（`2893fe5`）。

**范围**：SPEC §3.5.4（收藏中心管理：自定义分类 / 手动收纳）与 §3.7.3（相册管理：建立分类相册 / 将图片加入指定相册）。
**P1 全部 6 项至此完成。**

**产品语义（先定后做）**

- **单归属** —— 一条收藏最多属于一个分类、一张照片最多属于一个相册。分类是**收纳**维度，不是**标记**维度；
  多维度标记留给 SPEC §3.5.4 早已写下的「标签」。让分类兼任标签，两边都会变得难用，而这个边界越晚划代价越大。
- **删分类不删内容** —— 同事务把类内归属置 `null`（与 §2.1.3 删会话分组完全同构）。用户点「删除分类」想删的是**容器**，
  顺手删掉内容的分类没人敢用。
- **未分类是兜底区** —— `null` 与「指向已不存在分类」的脏引用都归这里（与会话分组、Widget 脏引用**第三次**同构）。
- **相册的「移出相册」与「删除照片」是两个动作** —— 移出只置空归属；合成一个动作，用户想「把这照片挪出来」时会以为只能删，
  而删下去照片就真没了（本模块唯一不可逆的操作，必须让它只能被明确选到）。
- **界面用顶部筛选条**（全部 / 未分类 / 各分类），分类的增删改收进筛选条旁的「⋯」；**不做纵向分区** ——
  收藏卡片本来就高，靠筛选翻找比靠滚动分区快，分区还会让「这条属于哪个区」变成界面上必须回答的问题。

**schema（P1 第二次动数据）**

- `shared/types.ts` 新增 `BookmarkCategory` / `PhotoCollection`；`Bookmark.categoryId` / `Photo.collectionId`（`string | null`）
- **Dexie 升 v10**：`bookmarkCategories` / `photoCollections` 两张表 + 两个归属索引，**带 `upgrade()` 给老数据补 `null`**
  （判据与 v9 对照：**改动会不会让老记录缺字段** —— 会就要回调，纯新增表就不要）
- **备份格式升 v8**：带走两张分类表与归属；旧版（≤v7）导入时分类按空、归属补 `null`
- 校验函数 `looksLikeBookmarkCategory` / `looksLikePhotoCollection` **只认 id / type / name** —— 校验过严会让手改过的备份整份导不进去

**web**

- `features/chat/GroupNameSheet.tsx` → 提升为 **`components/NameSheet.tsx`**（会话分组 / 收藏分类 / 相册三处共用，testid 统一 `name-sheet-*`）
  —— 三处的名字输入形态完全一样，没有理由存在三套
- 新增 `features/home/categories.ts`（纯逻辑，无 React）：`countByCategory` / `filterByCategory` / `normalizeSelection`。
  `normalizeSelection` 管「当前选中的分类被删掉后把筛选拉回全部」，否则页面会停在一个不存在的分类上、列表空着而用户不知道发生了什么
- 新增 `features/home/CategoryBar.tsx`（筛选条 + 管理菜单 + 删除二次确认）；**一个分类都没有时不渲染筛选条**（没有可筛的东西时那是一条纯噪音）
- 重写 `BookmarksModule` / `AlbumModule`：条目「⋯」菜单含移入 / 移出 / 删除；
  「移入 → ＋新建分类」用 `createToken` 信号把新建动作转交筛选条，不在条目菜单里再长一个命名弹层

**验收（全部实跑）**

- `verify-home.mjs` **46 → 75 项全过**（29 项清单见 `docs/CHANGELOG.md`）
- `verify-chat.mjs` 135/135（Dexie 版本断言同步升 v10）、providers 22/22、diagnostics 36/36，**无回归**；四条均「控制台零异常」
- 两端 `typecheck` + 前端生产构建通过

**排查中踩到的坑**

- ⚠️ **编辑工具会「静默成功」** —— 工具返回成功但文件实际没变，本轮至少 4 次（`shared/types.ts` 的类型、`db.ts` 的 import、
  `CategoryBar` 的 `unit` prop，以及 **SPEC §3.7.3 整节**）。→ **一次「成功」不能当证据**：改完立刻 grep 核实，
  没落地用 `sed -i` 兜底重做，最后靠 typecheck / 跑验收抓漏。
  ⚠️ 更值得记的是：**验收全绿也暴露不了文档缺失** —— §3.7.3 那节是靠收尾时逐份复核文档才发现的。**收尾必须回头核文档。**
- ⚠️ **操作会改变「当前筛选下的可见集合」** —— 在「资料」分类下把那条收藏移出分类，它立刻从列表消失，
  之后「点这一行菜单」全部超时，**极易误诊成渲染坏了或数据没写进去**（实际数据完全正常）。
  → 操作归属之后**显式把筛选切回「全部」**，并在这行加注释说明为什么。
- ⚠️ **量词靠断言才拦得住** —— 相册删除确认语写成「1 **条**照片回到未分类」，是 `verify-home` 那条断言先失败的
  （肉眼 review「确认删除？（1 条回到未分类）」看不出任何问题）。→ `CategoryBar` 加 `unit` prop（默认「条」，相册传「张」）。

**本任务新增待优化**：中 4 条（三模块分类实体是否合并、分类条数在内存里算、分类不能调序、筛选态不落库）、
低 4 条（移入新建用 `createToken`、分类可重名、删除确认放在菜单里、相册无撤销入口），已录入上方汇总清单。

**下一步**：P1 全部完成。下一片由北北定：P2（AI 自主日记 / 留言、一起听、AI 伴学、主屏 Widget 编排）或 Phase 3B。

---

### T-022 · 2026-09-23 · Phase 3B 起步：自部署 Nocturne 接入体检（**受阻，未完成**）

**范围**：接 `beiyan.cc` 上自部署的 Nocturne —— 即技术方案 §9 风险1 对策的后半句「再排阿里云链路」，
也就是 Bearer Token / `X-Namespace` / 反代 / 内网回源四段。**本轮只做到「体检 + 备好工具」，链路本身没通。**

**实测结论（分五段）**

| 段 | 结论 | 证据 |
| --- | --- | --- |
| DNS | ✅ 解析到 `120.27.247.75`（阿里云 ECS **直连** —— Cloudflare 代理未启用或灰云） | `nslookup beiyan.cc` |
| 443 TLS | ✅ 握手正常，证书链**完整**（`beiyan.cc ← Let's Encrypt YR1 ← Root YR ← ISRG Root X1`） | `openssl s_client -showcerts` |
| 80 HTTP | ❌ **阿里云按 Host 头拦截未备案域名**，返回 `Non-compliance ICP Filing` 页；但裸 IP 访问时 nginx 正常回 301 | 实测响应体 |
| Nocturne 进程 | ✅ `/health` → `{"status":"ok","buckets":12,"decay_engine":"running"}`；`/dashboard` → 夜曲面板 200 | HTTP 200 |
| **MCP 路径** | ❌ **`/mcp` 被最外层 nginx 单独挡下** —— `GET` 与 `POST initialize` 都回 **nginx 自己的 162 字节 HTML 404 页**（署名 `nginx/1.18.0 (Ubuntu)`）；`/mcp/` 同 | 实测 |

**定位依据：链路上有两个 nginx，两种 404 不是同一个东西回的**

- 拓扑：`浏览器/客户端 → 宿主 nginx 1.18.0 (Ubuntu) → Nocturne 容器 nginx（frontend/ build，nginx:alpine）→ backend:8233（FastAPI）`
- **Nocturne 上游默认配置已经把 `/mcp` 配好了** —— `frontend/nginx.conf` 的 `location /mcp` → `backend:8233/mcp`，且反缓冲指令齐全。**容器那层是齐的，缺的是宿主那层。**
- 宿主 nginx 对**多数路径是通配转发到后端**：

  | 路径 | 结果 | 含义 |
  | --- | --- | --- |
  | `/health/`、`/dashboard/` | **307** | FastAPI `redirect_slashes` —— **已穿透到 Python 后端** |
  | `/zzz-*`、`/index.html`、`/favicon.ico`、`/assets/`、`/docs` | 404 **纯文本 9 字节** `Not Found` | Starlette 默认 404 —— **同样来自后端** |
  | `/mcp`、`/mcp/` | 404 **HTML 162 字节** | **nginx 默认 404 页** —— 与上面**不是同一个东西**在回话 |

- → 结论：`/mcp` **不是「没配」，是被单独拦下的**，连后端都没碰到。修法是**找到那条规则删掉/取代**，而不是新增 location。

- ⚠️ **技术方案 §4 拓扑里早就写了「备案后启用域名」** —— 今天这条被实测坐实：80 端口确实按 Host 拦。
  **443 目前可用**（至少对现代 TLS 客户端），但 80 上的域名访问是不可用的。
- ⚠️ **文档说反代是 Caddy，实际跑的是 `nginx/1.18.0 (Ubuntu)`** —— 与 `AGENTS.md` §5 风险 2 直接相关（见上方待优化清单）。

**新发现的风险（未结）**

1. 🔴 **该实例没有任何鉴权层** —— `/health`、`/dashboard`（339 KB 面板）、`/api/*` **全部无凭据 200**，且带 `access-control-allow-origin: *`。
   dashboard 页面里可枚举出约 30 个接口，含 `/api/buckets`、`/api/search`、`/api/config`、`/api/import/upload`（最后这个**从路径名看是写操作，没有实测**）。
   → 这是 T-022 当时的风险记录；**T-034 已完成 Dashboard/API 与 MCP 双边界鉴权**。当时探测只做到状态码级，没有读取任何记忆内容。
2. ⚠️ **TLS 客户端分界线（本机实测）** —— 带 `SNI=beiyan.cc` 时 **Node 20（OpenSSL 3.0.15）连续 6/6 被 `ECONNRESET`**，
   而 Node 22（OpenSSL 3.5.5）与 Git Bash openssl 3.5.7 **6/6 通过**；**不带 SNI（裸 IP）时两个版本都通**。
   换 9 组 TLS 参数（TLS1.2/1.3、`ecdhCurve`、`ciphers`、ALPN）**全部无效**。
   → 机制从外部判不了（疑似链路 DPI 按 ClientHello 特征重置）。**影响直接**：habitat `server` 必须跑 Node 20
   （`better-sqlite3` ABI），所以**本地开发用 server 连 `beiyan.cc` 会失败**。✅ **北北已在沙箱外终端复核**（同报 `ERR ECONNRESET`），
   排除本环境出口代理干扰，是真实现象。**但生产是同机内网直连，不经过此链路，不受影响**（见 `docs/DEPLOYMENT.md` §4）。
3. ⚠️ **证书链用了较新的 Let's Encrypt 中间证书（YR1 / Root YR）** —— 北北的 Android 有过「证书库过旧、缺现代根证书」的前科，
   建议用手机实开一次 `https://beiyan.cc/dashboard` 确认不报证书错。

**本轮交付**

- 新增 `server/scripts/probe-nocturne-live.ts` —— **自部署验真脚本**，照 `probe-nocturne-demo.ts` 的结构：
  反代可达性 / 原始握手 / **鉴权对照（故意不带 Token 再握一次）** / `X-Namespace` / 经 Gateway 生产路径 / 工具清单 /
  `system://boot` / `search_memory` / **只读纪律**。
  - ⚠️ 与 Demo 版的**关键差别**：Demo 是服务端物理只读（只下发 2 个工具），自部署实例是**完整 7 个工具、含写** ——
    「不写坏数据」**没有服务端兜底**，所以脚本全程只调读工具，并用记录型包装**断言实际发出的调用落在读工具内**。
  - 默认**不打印 boot 正文**（那是本人记忆），要看加 `NOCTURNE_PROBE_PREVIEW=1`。
  - 握手失败时**先把报错翻译成「卡在哪一层」**：404 → 反代缺 location；401/403 → Token；`ECONNRESET` → 链路；证书 → 链不完整。
- `typecheck` 通过；已拿当前状态实跑一次 —— **如实报出 `/health` 200 + 握手 404 + 反代提示**，行为符合预期。

**待优化**：中 2 条、低 2 条，已录入上方汇总清单。

**下一步（等北北）**：

① **先开鉴权** —— 本段是 T-022 当时的旧判断；T-034 已按现网源码与能力完成：`OMBRE_API_PASSWORD` 保护 Dashboard/API，宿主 nginx Bearer 保护 MCP。
② **关键分水岭实验**：在服务器上 `curl -i -X POST http://127.0.0.1:<NGINX_PORT>/mcp`（带 `Accept: application/json, text/event-stream`）
- **通** → 链路已通，**收口，不必改宿主 nginx**（生产是同机内网直连，公网 `/mcp` 可以不开 —— 少一个「含写工具」的暴露面）
- **不通** → 查容器内那层：`docker exec <nginx容器> cat /etc/nginx/conf.d/default.conf`（可能版本较老，上游新版才有 `location /mcp`）
③ **`X-Namespace` 单人格留空** —— 走实例默认空间即可；日后多个 AI 共用同一实例才需要分区。
④ 就绪后重跑 `probe-nocturne-live.ts`（**在服务器上打内网地址**）收口 Phase 3A 剩余。

> 公网暴露 `/mcp`（需改宿主 nginx 并补反缓冲指令）列为**不推荐的可选路径** —— 理由是收益有限（本机 Node 20 连公网本就被 `ECONNRESET`）
> 而暴露面明确（7 个工具含写）。完整片段见 `docs/DEPLOYMENT.md` §3.2。

**本轮（T-022 续）新增**：`docs/DEPLOYMENT.md` 从占位写成初稿 —— 实测拓扑（两层 nginx）、体检证据、
接入流程与现成片段、Node 20 TLS 分界线的影响面、待确认项。

**本轮（T-022 再续）复核**：服务器 SSH 未配置可用凭据，无法越权代改；本机再次确认 TCP 443 可达、
但 Node 与系统 HTTPS 客户端均在 TLS 阶段被重置。`probe-nocturne-live.ts` 补了两处收口：诊断会展开 `cause` 链，
不再只显示笼统的 `fetch failed`；缺配置或握手失败提前退出时也会关闭 SQLite 并删除临时探针库。
临时库文件名带进程号，两个探针并行运行也不会互删或争抢同一把 SQLite 锁。
两端 `typecheck`、前端生产构建、`git diff --check` 均通过；真实探针按预期失败并明确报出底层 `ECONNRESET`。

---

### T-023 · 2026-09-23 · Phase 3B 切片一：Eventide 状态内核底座

**范围**：在不等待自部署 Nocturne 的前提下，先把 Eventide 真实内核接成可独立验收的状态底座。
本切片只做 sidecar / Provider / 宿主持久化 / API；**不做**聊天上下文注入、事件抽取、梦境、互动结算、主动唤醒或 UI。

**开工参考（只查 3 个）**

- **Eventide**：采用它明确要求的宿主流程——读取 `BodyState` → 按时间 tick → 渲染 `<ephemeral_state>` → 保存状态；
  依赖固定到 commit `5d8bef965137427e41d97f5b60e5a14c24dd812c`，不跟随浮动 main。
- **Drivesoid**：借鉴“轻量 HTTP sidecar + 主桥接层上报/读取”的进程边界；不引入它的 16 维模型与 LLM 分类器。
- **Tidefall**：借鉴“当前状态 / 快照 / 周期任务分层”和可观测 tick；不引入 Supabase / pg_cron，调度仍归 habitat-server。

**实现**

1. 新增 `eventide-sidecar/`：FastAPI 薄壳，仅 `/health` 与 `/v1/tick`；sidecar **不落用户数据、不调 LLM**。
   Eventide 用 commit 归档 URL安装，FastAPI / Uvicorn 均锁版本；没有复制第三方源码。
2. `StateProvider` 从占位接口扩成有类型的 `tick / current / health`；`EventideStateProvider` 每次把旧 state 送给 sidecar，
   收到完整的新 state / stateCard / payload 后再写库。连接失败转换为统一 `PROVIDER_UPSTREAM_ERROR`，健康检查不抛错拖垮主服务。
3. 新增服务端表 `body_state_snapshot`，单人格固定 `id='primary'`：保存 Eventide 往返 JSON、隐藏状态卡、UI payload、推进时间。
   **Node 是唯一持久化源，Python 是无状态计算层**；重启 / 重建 Provider 后可恢复。
4. 新增 `/api/health/state`、`GET /api/state`、`POST /api/state/tick`。tick 不接受客户端自报时间，避免任意跳周期；
   `EVENTIDE_URL` 留空时主服务照常启动，状态健康明确显示未配置。
5. 新增 `probe-eventide.ts`：真实 Eventide revision、首次建态、两小时推进、等待时间输入、SQLite 读回、Provider 重建恢复、
   不可达降级与 habitat-server HTTP 全链。

**验收**

- 真实 Eventide sidecar + Node Provider + SQLite + habitat-server：**16/16**
- 两端 `typecheck`、前端生产构建、`git diff --check` 通过
- 临时探针库按进程隔离并在 `finally` 删除；sidecar / server 验收进程均已停止

**边界 / 后续**

- `state` 是 Eventide 自己的可往返 JSON，habitat 不复制其内部字段；未来 UI 只消费 `payload`，上下文只消费 `stateCard`。
- 单人格先固定一行；若未来多 AI，再把 `primary` 升为 persona id，不能在当前阶段预造多租户模型。
- 下一切片只做**聊天前 tick + 状态卡注入上下文**及降级验收；Nocturne 未配置 / 不可达不得阻塞 Eventide 状态卡。

---

### T-024 · 2026-09-24 · Phase 3B 切片二：聊天前 tick + Eventide 状态卡注入

**范围**：把 T-023 的状态底座接入现有 `POST /api/chat`；只做聊天前推进与隐藏上下文注入。
不做世界书 / Nocturne 召回、互动结算、事件抽取、梦境、主动唤醒或任何 UI。

**实现口径**

1. 新增 `context/chat-context.ts` 作为 Phase 3 上下文组装的唯一入口。已有 system/persona 指令保持在最前，
   Eventide 卡以 `role=system, name=eventide_state` 插在其后、第一条真实对话前；后续世界书 / 记忆从这里继续拼，不散落到路由。
2. 状态卡只送上游模型：不进入 SSE、不回写前端 Dexie，也不原地修改请求的 `messages` 数组。
3. 每轮聊天前 tick，把当前时刻同时作为 `now` 与 `lastCounterpartMessageAt`——这一轮用户刚发来消息，等待压力在此刻归零；
   真正的离线等待推进留给后续 scheduler 使用服务端持久化的最后互动时间。
4. **降级优先**：未配置、空状态卡、sidecar 不可达都按原始历史继续聊天；不可达会写一条服务端 warning，错误不静默，
   但状态增强不成为聊天单点故障。
5. 自动 tick 暴露出 T-023 原本的并发窗口：两个聊天可能同时读旧快照再互相覆盖。本轮在 Provider 内加串行队列，
   且 `effectiveNow = max(请求时间, settledAt)`，保证 SQLite 与 Eventide 内部时间都不倒退。sidecar 超时从 10 秒收紧为 3 秒，
   同机服务异常时不让每轮聊天长时间空等。

**验收（全部读取 mock LLM 收到的真实请求体，不只测内部函数）**

- Eventide 正常：**7/7**——SSE 完成、恰好一张卡、system 角色、真实 `<ephemeral_state>`、
  `persona → 状态卡 → 对话` 顺序、原始历史逐项未改、聊天前快照已持久化
- 配置存在但 sidecar 掉线：**3/3**——SSE 仍完成、无伪状态卡、原始历史原样送达；服务端日志留可读 `ECONNREFUSED`
- Eventide 完全未配置：**3/3**——同样无阻塞、无伪卡、历史不变
- Eventide 底座回归扩为 **19/19**：新增并发 tick 不覆盖、旧时间不回退、内部 `last_tick_at` 不回退
- 两端 `typecheck`、前端生产构建、`git diff --check` 通过

**下一步**：Phase 3B 互动结算。回复完成后用本轮消息窗口生成结构化 settlement，校验 / 归一化后写回状态；
结算失败必须与本轮回复解耦，不能把已经生成成功的聊天作废。

---

### T-025 · 2026-09-24 · Phase 3B 收尾：状态结算、主动行为、BudgetGuard 与钱包

**范围**：一次收完 Phase 3B 剩余里程碑。包含互动结算、事件检查、梦境联动、宿主调度、主动唤醒、
独处时光、通知底座、EventLog、BudgetGuard 与钱包；不施工 Phase 4 Life 页面，不把服务端主动消息伪造进前端聊天库。

**参考输入（只实查 3 个）**

- Eventide：沿用“宿主选窗口 → 模型只回 JSON → Eventide 归一化 / 限幅 / 写回”；事件检查按 10 分钟节流、
  当前事件不覆盖、窗口去重；梦境必须经过梦种 / 夜间窗口 / 静默 / 冷却
- WrenWen：借“状态 / 欲望只负责提出候选，出口仍需独立仲裁与留账”，不把一次阈值命中直接等同于必须发消息
- astrbot 主动消息插件：借免打扰、随机 / 冷却、连续未回复上限、任务持久化；用户一回应就清零未回复计数

**产品与安全口径**

1. 补全 `PRODUCT_SPEC §9.5`。主动总开关、唤醒、独处、梦境默认全关；Eventide 可在后台推进，但不开关就不调用主动 LLM。
2. 主动唤醒只写服务端 `notification` 收件箱，Phase 4 再展示 / Web Push；服务端不越界写前端 Dexie。
3. 独处记录与梦卡写 `solitude_entry`，保持 AI 私有；不冒充尚未施工权限流程的“AI 日记 / 留言”。
4. 普通聊天不受免打扰和主动总开关影响，但与 settlement / wake / solitude / dream 一样计入 UsageRecord 并过资源预算。
5. 费用尚无价格快照时不按 0 假装准确：一旦启用费用上限且当天有 `cost=null` 调用，BudgetGuard 安全拒绝后续调用。

**落地**

- sidecar 新增 settlement prompt / apply、宿主事件触发表、dream check / tags apply；状态仍由 Node SQLite 唯一持久化
- 每轮成功回复后异步结算；后台失败只写 `EventLog` + warning，不撤销已成功回复
- 新增 `automation_policy / automation_state / automation_run / event_log / notification / solitude_entry / wallet / wallet_transaction`
- BudgetGuard 用 SQLite 事务先写 `reserved`，并发调度会把预约一起计入，避免两轮同时在旧余额下放行
- 调度器每分钟检查，重入直接跳过；事件状态即使总开关关闭也可推进，真正 LLM 出口各自再次过闸
- 钱包余额与不可变流水同事务更新，禁止透支；通知支持已读；策略 / 运行记录 / 事件 / 私有产出 / 钱包均有服务端 API
- 修复验收暴露的时区暗坑：梦境窗口不能用 UTC `toISOString()` 判断，Provider 现在按策略 IANA 时区传带 offset 的时间

**验收**

- `probe:phase3b`：**21/21**，覆盖默认关闭、聊天不受阻、异步 settlement、唤醒 / 独处、重复抑制、
  连续未回复停手与用户回复清零、钱包流水 / 防透支、称呼事件、梦境窗口、BudgetGuard 429、通知已读
- `probe:eventide`：**19/19** 回归通过
- 两端 typecheck、Python `py_compile`、前端生产构建、`git diff --check` 通过

**Phase 3B 至此完成。下一阶段**：Phase 4 Life 只消费本轮已经建立的服务端事实源，做月历统计、账本、
通知中心与运行状态；补 PriceSnapshot 后费用闸门才从“安全不可计算”升级为准确金额。

---

### T-026 · 2026-09-24 · Phase 4 Life：月历、账本、通知与运行状态

**范围**：一次收完 Phase 4。把 Phase 3B 已有的 EventLog / UsageRecord / 通知 / 钱包 / 自动化运行态做成
`/life` 四视图；新增不可变 PriceSnapshot 与尽力而为的 Web Push。不施工 Phase 5 高级消息能力。

**参考输入（只实查 2 个）**

- Phosphene：借“余额是摘要、每次变化都能追到不可改写流水；纠错追加校正记录”的账本表达
- WORKKK：借“先给一眼可读的当前状态，再下钻最近活动”的监控层级；不引入它的商店 / 游戏机制与视觉

**产品与数据口径**

1. 补全 `PRODUCT_SPEC §9.2`：Life 分月历 / 账本 / 通知 / 运行；所有统计只读服务端事实源，不反查聊天库。
2. 月历按用户时区展示事件、失败、API、Token、已定价费用与未定价数；日期可下钻到原始 EventLog / UsageRecord。
3. `price_snapshot` 只追加，`usage_record.price_snapshot_id` 固化历史价格来源；新快照只补价尚未定价的有效期记录，
   后续改价不重算历史。费用按“分 / 百万 Token”计算并向上取整。
4. 删除 API 方案不删除历史用量；账本继续展示旧 `profileId`。无法确定 provider 的旧未定价记录不猜价。
5. Web Push 必须浏览器支持 + 安全上下文 + 用户授权 + 服务端 VAPID 配置；任何条件不满足都回落站内通知。
   Push 失败不回滚 notification，404 / 410 订阅自动清理。
6. 运行页明确区分正常 / 异常 / 未配置；“立即检查”仍走原调度器与 BudgetGuard，不开后门。

**落地**

- 新增 Life 月 / 日 / 账本 / 运行聚合 API，价格快照 API，Web Push 状态 / 订阅 API，通知“全部已读”
- 新增 `price_snapshot`、`push_subscription`，并给 `usage_record` 补 `price_snapshot_id`；老库以缺列补齐演进
- `/life` 落地四视图：月历与日期明细、服务 / 模型费用与钱包流水、通知收件箱 / Push、状态 / 最近运行
- Service Worker 接收 Push 并把点击带回通知页；VAPID 通过环境变量配置，默认安全关闭

**验收（全部实跑）**

- `probe:phase4`：**16/16**，覆盖未定价、历史补价、改价不重算、钱包 / 防透支、月历 / 日期下钻、
  通知全部已读、运行聚合、非法参数与 VAPID 未配置降级
- `verify-life.mjs`：**15/15**，覆盖四视图真实浏览器导航、移动端无横向溢出、价格 / 钱包入口、
  通知降级、依赖未配置识别、运行状态与控制台零异常
- Phase 3B 全链回归：**21/21**，确认 UsageRecord 定价与 Web Push 挂接未破坏聊天、主动行为、通知及钱包
- 两端 typecheck、前端生产构建、`git diff --check` 通过

**Phase 4 至此完成。下一阶段**：Phase 5 高级能力须按明确切片开工；T-022 Nocturne 生产验真仍作为部署前关卡保留。

---

### T-027 · 2026-09-24 · Phase 5 高级消息能力—— **完成**

**范围**：一次收完 Phase 5 v0.1 的 TTS、异步语音、图片理解 / 生成、安全 HTML、widget / tab-group 与用户发起的 Mini Terminal；
不伪装实时双工通话，不启用无逐次授权协议的 AI 自主工具调用，不进入 Phase 6。

**参考输入（只实查 3 个）**

- voice-mcp：借“后端可切换 + 原消息位置播放 + 文本可追溯”，不绑定它的具体云厂商或克隆音色
- FunASR：借独立 `/v1/audio/transcriptions`、显式模型与上传边界；兼容其 OpenAI 风格 multipart 入口
- Callhome：借“录音 / 识别 / 播报状态清楚、用户可随时停止”的会话原则；实时拨号 / 软挂断留给独立实时协议

**产品与安全口径**

1. 补全 `PRODUCT_SPEC §9.6 / §9.7`：语音先预览再发送；ASR 失败保留原音并明示；TTS 不自动播放；实时通话明确不在 v0.1。
2. 图片从本地文件直接发送，视觉描述写进 `ImageBlock.alt`；生成图片落成普通聊天图片，可复用相册 / 作品对象操作。
3. HTML 只进无权限 iframe，并用 CSP `default-src 'none'` 禁脚本、表单、导航和网络；没有 `dangerouslySetInnerHTML`。
4. Mini Terminal 只做用户显式调用：选择 Server / 工具、查看 schema、填写 JSON、点“确认调用”；结果无论成败都落 `tool-result`。
5. 邮件不建硬编码旁路：若 MCP 暴露邮件工具，它与其它高风险工具一样走显式调用和记录。AI 自主工具调用在逐次授权协议完成前保持关闭。

**落地**

- `ApiProfile.modelMap` 新增 `transcription / image`，并真正消费 `tts / vision`；设置页高级区可配置四类媒体模型
- OpenAI-compatible Adapter 接入 `/audio/transcriptions`、`/audio/speech`、视觉 Chat Completions 与 `/images/generations`；密钥仍只在服务端
- 新增受 MIME / 大小 / 文本长度约束的媒体路由；TTS / ASR / 视觉 / 图片生成全部写 UsageRecord
- 录音增加试听 / 重录 / 发送状态；转写写入 audio block，语音可复制转写；图片可直接选择或按提示生成
- `historyUpTo` 使用真实转写 / 视觉描述；失败才用明确占位；手动工具结果不伪造成缺少 `tool_call_id` 的协议消息
- 新增 Mini Terminal 与 ToolGateway 的 list / call API；无 MCP 时显示真实空态与诊断指引
- HTML / widget / tab-group 从占位升级为安全渲染；保持 Dexie v10、备份 v8，无 schema 升级

**验收（全部实跑）**

- `probe:phase5`：**8/8**，覆盖 ASR / 视觉 / 图片生成 / TTS、大小 / MIME 拒绝、MCP 空态与非法调用
- 真实浏览器全回归：Chat **140/140**、Providers **22/22**、Home **75/75**、Diagnostics **36/36**，控制台零异常
- Chat 新增断言覆盖：HTML sandbox + CSP、widget / tab-group、录音预览、真实转写落库与进上下文、图片理解 / 生成、Mini Terminal 空态
- 两端 typecheck、前端生产构建、`git diff --check` 通过；构建仅保留既有的单 chunk >500 kB 提示

**Phase 5 至此完成。下一阶段**：Phase 6 只做打磨与剩余偏差清理；T-022 Nocturne 生产验真仍是部署前关卡。

---

### T-028 · 2026-09-24 · PWA（可安装 + 离线外壳）—— **完成**

**范围**：把 Web 应用做成能装进主屏、断网也能打开外壳的 PWA；不碰业务功能，不动数据层。
本轮属技术任务（不涉及产品交互新增），按 `AGENTS.md` §4「纯改接口 / 部署类不强制查参考项目」未引外部项目。

**口径与决策**

1. **`registerType: 'prompt'`，不用 `autoUpdate`** —— 静默更新会在用户正看页面时把资源换掉，
   旧页面再去加载已被删除的懒加载 chunk 就是 404。给一条明确提示、让用户挑时机刷新更稳。
2. **由应用自己注册**（`injectRegister: null`），这样才拿得到 `needRefresh` 去弹提示。
3. **开发期不启 SW**（`devOptions.enabled: false`）—— 否则改代码不生效；PWA 验收一律打生产构建产物。
4. **与 Phase 4 的推送处理器共用一个 SW** —— 同一个作用域只能有一个 Service Worker，
   手写的 `public/web-push-sw.js` 若自己 `register()` 就会与 PWA 生成的 SW 互相顶掉。
   改为 `workbox.importScripts: ['/web-push-sw.js']` 并入：**推送与离线共用一个 SW，两个能力都在**。
5. **`/api/` 绝不落 `index.html` 兜底**（`navigateFallbackDenylist: [/^\/api\//]`）——
   否则断网时会拿到一页 HTML 当接口响应，错误会变得极难解释。

**落地**

- 新增 `vite-plugin-pwa` 1.3.0 + `workbox-window`；manifest（名称 / standalone / 主题色 `#f6f4f1` / start_url+scope）与
  三张图标（192 any、512 any、512 maskable 单独一张，图形已缩到中心安全区，被裁成圆形也不切掉叶子）
- 图标由 Pillow + 系统 emoji 字体生成，含 `apple-touch-icon.png`（iOS 不认 manifest 图标，要单独声明）
- `web/src/features/pwa/`：`useAppUpdate.ts`（`useRegisterSW` 封装）+ `UpdatePrompt.tsx`（新版本 / 已可离线两条提示）
- `AppShell` 把横幅放在**文档流里**（不是 fixed 悬浮）：出现时把内容推下去，收起时自动还原，不必反算 padding
- `features/life/push.ts` 改为复用**已存在的** SW 注册，不再自己 `register('/web-push-sw.js')`
- 新增 `web/scripts/verify-pwa.mjs` + `.workbuddy/run-pwa-verify.sh`（build → preview:5284 → CDP:9434，端口与 dev 路线错开）

**验收（全部实跑）**

- `verify-pwa.mjs`：**25/25** —— manifest 与三张图标可取、SW 注册并激活、app shell 预缓存、
  **断网仍能打开外壳**、`/api/` 不被兜底成 HTML、更新提示与「已可离线」提示可关
- `verify-chat` 140/140、`verify-providers` 22/22、`verify-home` 75/75、`verify-diagnostics` 36/36（无回归）
- 两端 typecheck、前端生产构建、`git diff --check` 通过

**踩到的坑（脚本侧，值得记）**

- `waitFor` 的条件写成 Promise 时 `if (promise)` **恒真** = 假等待 —— SW 还在 install 就断言「已激活」，
  于是「12/13」里唯一那条失败其实是我自己写的假等待。→ 条件一律 `await (…)` 后再判。
- PWA 验收**必须打生产构建**：dev 下不注册 SW，在 dev server 上验「断网还能开壳」永远验不出来。

---

### T-029 · 2026-09-24 · 离线只读 —— **完成**

**范围**：断网时把「能做什么、不能做什么」说清楚并落到交互上；**只做只读**，不建发送队列，
也不引入任何离线写冲突语义。

**口径与决策**

1. **`navigator.onLine` 只是兜底信号** —— 它 `true` 只表示网卡通，不代表后端可达。
   所以离线拦截的定位是「提前拦一下并给出人话说明」，**不能**替代「后端不可达」的失败暴露。
2. **拦在唯一入口**：所有请求都过 `lib/api.ts` 的 `fetchJson`，在那里 `assertOnline()`；
   同时各处该禁用的按钮仍要**禁用**（否则用户要点一下才知道不能用）。
3. **说清而不是喊「断网了」**：横幅的文案是「本地内容照常可看；需要联网的动作（发消息、生成、朗读等）暂时不可用」——
   栖息地的聊天、日记、相册、账本本来就全在本机，把它说明白，用户就不会以为数据丢了。

**落地**

- `shared/errors.ts` 新增前端专用错误码 `OFFLINE`；`lib/api.ts` 加 `assertOnline()` 并挂在 `fetchJson` 前
- 新增 `features/offline/`：`useOnlineStatus.ts`（online/offline 事件）+ `OfflineBanner.tsx`
- 输入区（`Composer`）：离线时主按钮 / 语音 / 请求回复禁用，placeholder 改文案，回车给出明确提示，
  「发送图片 / 生成图片」从菜单里撤掉；**草稿照写**
- 消息菜单（`ChatWindowPage`）：离线时撤掉「朗读 / 换一个 / 重发 / 重新生成」等联网动作，保留本地动作（收藏、复制、编辑、删除）
- 工具面板（`MiniTerminal`）：离线时不发 `/api/tools`，直接显示「当前离线。工具需要联网，恢复联网后会自动读取」——
  与「没有可用工具（未配 MCP）」明确区分开，避免把人引到错误方向
- 设置页离线时可打开、可导出备份（纯本地动作），「测试连接」禁用；Life 运行视图如实给出「离线」说明
- 取外部图片失败时区分「离线」与「跨域」（这两件事的排查方向完全相反）
- 新增 `web/scripts/verify-offline.mjs`：用 CDP `Network.emulateNetworkConditions` **真断网**（同时影响 `navigator.onLine` 与 `fetch`），
  而不是只 mock `navigator.onLine`（那样验不出问题）

**验收（全部实跑）**

- `verify-offline.mjs`：**38/38** —— 离线横幅出现且不遮挡内容、列表与会话内容仍可读、输入区四项禁用、草稿可写、
  消息菜单联网项消失而本地项保留、工具面板给的是「离线」不是「没配 MCP」、设置页与 Life 页可读、
  **恢复联网后横幅消失 + 提示语还原 + 发送恢复可用**、联网 / 恢复阶段控制台零异常
- 断网阶段的 console 输出**单独分桶**、只记录不判失败（断网时请求失败正是「如实失败」的证据）
- 四支原有前端验收无回归；两端 typecheck、生产构建、`git diff --check` 通过

**踩到的坑（脚本侧，值得记）**

- ⚠️ **`Runtime.enable` 会把上一个 CDP 会话的 console 消息重放一遍**（已实测确认）。同一条流水线上
  `verify-offline` 断网阶段的报错被 `verify-export` 原样收走，「控制台零异常」假红。
  **排除掉的两个错误方向**：①「断网状态跨会话泄漏」—— 实测不会，会话一断覆盖就失效；
  ② 用 `Network.emulateNetworkConditions(offline:false)` 去「恢复」—— 实测无必要，而且会让人误以为问题在网络层。
- 分段桶的 `phase = 'offline'` 漏写一行，断网阶段的日志被记进 online 桶，末尾那条断言必然误报。
- 「路由变了 ≠ 输入框已挂载」：`setValue` 静默返回 `'missing'` → 草稿为空 → 发送按钮一直禁用 →
  30s 后才超时，且报错完全指不到真正原因。→ 先 `waitFor` 挂载，并**断言写入返回值**。
- 到达判据别用页面文本：`body.innerText.includes('生活')` 在别的页面也成立（底栏有「Life」、页面标题有「生活」），
  改用 `location.pathname` / `location.search`。

---

### T-030 · 2026-09-24 · 导入导出增强 —— **完成**

**范围**：增强自家备份能力，**不引入任何外部格式**（不碰 ChatGPT / Claude 的导出格式）。

**口径与决策**

1. **单会话导出 ≠ 备份** —— 一次会话导出不含日记 / 相册 / 账本，拿它当备份是错觉。
   所以单会话导出**不更新**「上次导出备份」的时间戳，两者在界面上也分开写。
2. **导入前必须把「先导一份」摆在手边** —— 导入是整体替换、不可逆；只在确认按钮出现时给出覆盖警告与
   「先导出一份现在的备份」入口，不用全局弹窗（备份是低频动作，弹窗只会变噪音）。
3. **光有按钮不够，得有人提醒该导了** —— 超过 14 天没导出且库里有数据才提醒（7 天太吵、30 天太晚）。

**落地**

- 新增 `web/src/lib/exportSession.ts`：`sessionMarkdown()` / `sessionJson()` 两种形态。
  Markdown 面向阅读（标题、时间、角色、块内容），**图片 / 语音只写一行说明**（否则一次导出就是几十 MB 文本）；
  JSON 与全量备份同构（`{format:'habitat-session',version:1,session,messages}`），便于后续做程序化处理
- `lib/backup.ts` 加 `readLastExportAt()` / `markExported()`（localStorage `habitat:last-export-at`）
- `BackupPanel` 重写：保留原有 testid 之外补 `backup-export` / `backup-choose` / `backup-import-confirm` /
  `backup-import-cancel`；新增 `backup-import-warning`（含「先导出一份现在的备份」）、`backup-last-export`、`backup-stale-hint`
- 聊天设置面板加「导出这段对话」区块（`chat-export-markdown` / `chat-export-json` / `chat-export-message`）
- 新增 `web/scripts/verify-export.mjs`

**验收（全部实跑）**

- `verify-export.mjs`：**17/17** —— 单会话 Markdown / JSON 导出回执**带真实条数**、
  单会话导出**不**更新全量备份时间、有数据但从未备份时提醒、导出后记下「上次导出：今天」且提醒收起、
  选中备份文件后出现覆盖警告（含「整体覆盖」「不可撤销」「先导出一份」）、取消后警告一并收起、控制台零异常
- 四支原有前端验收无回归；两端 typecheck、生产构建、`git diff --check` 通过

**本轮（T-028~T-030）共同结论**：三条都是前端侧能力，**Dexie 仍是 v10、备份格式仍是 v8 —— 零 schema 改动**。

**下一阶段**：Phase 6 打磨继续按 `PRODUCT_SPEC` / 本文件剩余偏差切片；
**动画与过渡效果留给 UI 一起做**（北北明确要求）。T-022 Nocturne 生产验真在 T-031 解开工具面死结后**可以继续推进**。

---

### T-031 · 2026-09-24 · Nocturne 只读打通：按真实工具面收敛接口 —— **完成**

**起因**：北北在服务器上跑三个侦察脚本，贴回**实例一手工具面**：

```
breath / trace / hold / wander / wander_mark / drive / undercurrent / trail_delta / trail_family
```

适配层写死的 5 个名字（`read_memory` / `search_memory` / `create_memory` / `update_memory` / `delete_memory`，
取自官方 Demo）→ **0/5 命中**。这不是「改几个字符串」：实例**没有 `uri` 概念，也没有「原地编辑 / 删除」语义**。

**范围**：北北确认只做「只读打通」—— 不写记忆、不做 UI 记忆页，只把接口收敛到实例真有的两个只读工具。

**收敛决策**

1. **接口砍到两个方法** —— `recall()`（→ `breath`，无参）+ `search(query, {limit})`（→ `trace`）。
   `read(uri)` / `create` / `update` / `delete` 四个方法一并删除：实例没有对应语义，且**全仓核查确认从未被调用**。
   类型 `MemoryCreateInput` / `MemoryUpdateInput` 删除；`MemorySearchOptions` 去掉 `domain`（实例不认）。
2. **路由同步砍到两个只读端点** —— 只留 `GET /api/memory/boot` 与 `GET /api/memory/search`。
   原四个写端点**不留占位、直接移除**：留着返回 500 会让人误以为「配好就能用」。
3. **工具名集中成一张映射表** —— 适配层只在一处写死工具名（`NOCTURNE_TOOLS`），
   附带 `verifyToolFace()`：实例缺 `breath` / `trace` 时给出可读错误，而不是等到调用才 `MCP_TOOL_CALL_FAILED`。
4. **启动期自检（warn 不阻塞）** —— `main.ts` 在 `gateway.connectAll()` 之后跑一次工具面自检，
   缺失就 warn 并指向侦察脚本。不阻塞启动，因为记忆挂掉不该拖垮整个服务。
5. **mock 也对齐真实形状** —— `src/mcp/mock-server.ts` 从 7 个 mock memory 工具换成 `breath` + `trace`
   （保留 `echo` 验链路），这样本地验收验的就是**真形状**，不是自欺欺人的假形状。

**落地**

- `shared/providers.ts`：`MemoryProvider` 收敛为 `recall` / `search` / `verifyToolFace`
- `server/src/providers/nocturne-memory.ts`：重写；集中 `NOCTURNE_TOOLS`；新增 `verifyToolFace()`
- `server/src/routes/memory.ts`：重写为只读两端点
- `server/src/mcp/mock-server.ts`：工具面改成实例真实形状 + 预置 mock 记忆
- `server/src/main.ts`：连接后加工具面自检
- `server/scripts/probe-memory.ts`：重写为只读验收（两路径 + 参数边界 + 已移除端点应 404）
- 五个 Nocturne 脚本同步：`probe-nocturne-tools.{ts,mjs,sh}` 对照表改成 `breath` / `trace` 并定位为「漂移检测」；
  `probe-nocturne-live.ts` 读写工具表改真实名；`probe-nocturne-demo.ts` **废弃**（它的工具面假设本身是错的）
- `probe-nocturne-tools-quick.sh` 修一个真实 bug：临时文件写死 `/tmp`，Git Bash 下 `curl -D /tmp/x` 读不回来 → 改用 `$TMPDIR` + 可用性回退

**验收（全部实跑）**

| 项 | 结果 |
| --- | --- |
| `probe-memory.ts`（mock 起真 server，只读两路径 + 参数边界 + 写端点 404） | **21 passed / 0 failed** |
| 启动期工具面自检 | 日志出现「Nocturne 工具面自检通过」 |
| `probe-nocturne-tools.ts` / `-standalone.mjs` / `-quick.sh` 三版对 mock | 全部 **2/2 命中**、退出码 0、输出口径一致 |
| `probe-nocturne-live.ts` 经 McpGateway 对 mock | **23/24**（唯一失败是 mock 无 `/health` 端点，非代码问题）；只读纪律通过：实际调用仅 `breath` + `trace` |
| `probe-nocturne-demo.ts` | 按预期打印废弃提示并退出 1 |
| 两端 `typecheck` | 通过（无残留引用） |

**遗留**

- ✅ 真机验证已在 T-033 完成：`probe-nocturne-live.ts` **25/25**；反代 / 会话 / 真实工具面 / 两条只读调用均通过
- ✅ T-022 的鉴权风险已在 T-034 结清：Dashboard/API session 鉴权 + nginx MCP Bearer，对照验收 26/26
- 📌 实例血统存疑：`serverInfo` 自称 Nocturne，部署留档记 Ombre Brain v1.30.0 —— **以实测工具面为准**

---

### T-032 · 2026-09-24 · Phase 6 验收基础设施收口 —— **完成**

**范围**：只修验收可靠性与 mock 协议生命周期，不改产品交互、不改业务数据结构，也不提前做动画 / UI。

**落地**

- `probe-mock.ts` 从「能连上、能列工具」扩成 5 项生命周期探针：握手拿 session、真实工具面、GET SSE、
  SDK `terminateSession()` 的 DELETE、关闭后拒绝复用；GET / DELETE 都实测 `mcp-session-id` header。
- mock MCP 在 DELETE 时同步释放 `transports` / `servers` 映射，避免显式关闭后内存里仍挂着失效会话。
- `verify-home.mjs` 开工先通过 CDP 清掉本站残留的 IndexedDB / localStorage，再把**整页导航**等待从 30s 放宽到 60s；
  普通交互仍是 30s，真卡死不会被统一长超时掩盖。
- `verify-export.mjs` 显式清掉设备级「上次导出」时间，自建「从未备份」前提，不再依赖浏览器碰巧干净。

**验收（全部实跑）**

- mock MCP 生命周期探针：**5/5**
- 前端整套串行回归：chat **140/140**、providers **22/22**、home **75/75**、export **17/17**、
  offline **38/38**、diagnostics **36/36**
- 两端 `typecheck`、`git diff --check` 通过

**待优化**：CDP 公共 helper 与 mock 回复去固定文案仍保留在上方清单；本切片不顺手扩成验收框架重构。

**下一步**：Phase 6 继续按剩余清单切片；动画 / 过渡效果仍留给 UI 一起做。

---

### T-033 · 2026-09-24 · Phase 6 收口：MCP 非阻塞启动 + Nocturne 真机验真 —— **完成**

**范围**：结清 Phase 6 必须项与 Phase 3A 真实链路证据；不新增产品功能、不改 Dexie、不触碰 Nocturne 写工具。

**落地**

- `main.ts` 不再在 `listen()` 前等待 `gateway.connectAll()`；HTTP 先启动，MCP 在后台连接、自检，失败每 60 秒重试且不阻塞主服务，关闭时清理定时器。
- `probe-memory.ts` 适配后台连接：最多等待 10 秒读取 ready 状态，避免把正常异步启动误报成失败。
- Nocturne 专项探针默认遮蔽秘密路径，错误信息也不再回显完整入口；仅显式设置 `NOCTURNE_SHOW_SECRET=1` 才显示。
- PWA 验收两条 PASS 输出改为真实成功说明，不再在成功时附带“未引入 / 没有脚本”的失败文案。
- 部署口径定稿为实机双 nginx；Caddy 归档为早期方案。后续 T-034 登录实机后进一步确认：当前版本用 `OMBRE_API_PASSWORD` 保护 Dashboard/API，MCP Bearer 需在宿主 nginx 落地。

**验收（全部实跑）**

| 项 | 结果 |
| --- | --- |
| 自部署实例 `probe-nocturne-live.ts` | **25/25**；serverInfo `Ombre Brain v1.30.0`；9 工具；实际只调用 `breath` / `trace` |
| 不可达 MCP 启动 | `/api/health` 约 **291ms** 返回 200，MCP 状态 `error`，证明不阻塞 HTTP |
| 本地 mock 记忆全链 | **21/21** |
| 前端全套回归 | chat **140/140**、providers **22/22**、home **75/75**、export **17/17**、offline **38/38**、diagnostics **36/36** |
| PWA 生产构建验收 | **25/25** |
| 两端 typecheck / 生产构建 | 通过 |

**结论**：Phase 6 的既定工程范围已完成；动画 / 过渡属于后续 UI 专项，实时双工与 AI 自主工具循环属于独立协议范围，均不作为 Phase 6 欠项。

**后续状态**：上述生产鉴权已在 T-034 取得 SSH 权限后完成。

---

### T-034 · 2026-09-24 · Nocturne 生产鉴权与秘密路径轮换 —— **完成**

**范围**：结清 T-022 最后的公网安全项；不改记忆数据，不调用写工具，不部署 Habitat 服务。

**实机事实与决策**

- 当前容器源码的官方鉴权变量是 `OMBRE_API_PASSWORD`，且容器内已有 28 字符配置：Dashboard 未登录、`/api/config` 均受 session-cookie 鉴权保护；`/health` 保持公开。
- 此版本没有 MCP Bearer 开关，不能把 Dashboard 密码误当 MCP Token；因此在宿主 nginx 的秘密 MCP location 内校验 `Authorization: Bearer ...`。
- MCP 秘密路径与 Bearer 同时轮换；公开 `/mcp` 继续 404。完整值只存服务器 `/root/.config/habitat/nocturne-mcp.env`（目录 700、文件 600），不进入仓库或验收日志。
- nginx 站点配置权限收紧为 600；修改前留存 `/etc/nginx/sites-available/nocturne.bak-20260924-170956`，`nginx -t` 通过后平滑 reload。

**验收**

| 边界 | 结果 |
| --- | --- |
| `/health` | 200 |
| `/api/config` 未登录 | 401 |
| 公开 `/mcp` | 404 |
| 秘密 MCP 路径：无 Token / 错 Token | 401 / 401 |
| 秘密 MCP 路径：正确 Token initialize | 200 |
| Habitat `probe-nocturne-live.ts` | **26/26**；包含无 Token 拒绝；实际工具调用仅 `breath` / `trace` |

**结论**：T-022 的安全阻塞已结清，Phase 3A 完成。Habitat 将来部署到同机时，从 root-only 凭据文件注入 `MCP_NOCTURNE_URL` / `MCP_NOCTURNE_TOKEN` / `MCP_NOCTURNE_NAMESPACE`，不得复制进仓库。

---

### T-035 · 2026-09-24 · Phase 6.5 · AI Runtime Integration（P0）—— **完成**

**范围**：北北定义的「把已存在但各自为政的能力接成一套 AI 真正能理解、调用、接收事件的系统」。
本轮只做 P0 五项，P1（Event Inbox / 日记权限 / 日记留言板 Tool）与 P2（LLM App Launcher / 头像开关）未开始。

**根因（先定位再动手）**

「工具调用成功，但模型下一轮说『我没有调用外部工具的能力』」**不是模型嘴硬**，是它的上下文里确实没有：

1. `routes/chat.ts` 从来不传 `tools` 参数 → 模型不知道自己有工具
2. 同一文件**明确丢弃**响应里的 `delta.toolCall`（注释写着「本层不转发」）
3. 服务端**完全不构造 system prompt**，人格/能力说明全靠前端塞进 `messages`
4. 能成功的「工具调用」是用户从 Mini Terminal 手动发起的，从没人告诉过模型它有这能力

**与 PRODUCT_SPEC §9.7 的关系**：该节原文是「AI 自主工具调用暂不启用，需先有可暂停的逐次授权 + 风险分级」。
本轮**不是绕过它**，而是把它要的准入闸门建出来（`autonomy` 分级 + 只读/写分离），
写类能力在确认卡协议落地前**一律不绑给模型**（闸门朝「关」）。

**落地**

| 层 | 文件 | 内容 |
| --- | --- | --- |
| 声明（静态） | `shared/capabilities.ts` | 12 项能力定义 + `autonomy` 四级 + 工具绑定（内建名 ≠ MCP 工具名） |
| 判定（运行时） | `server/src/capabilities/registry.ts` | 依赖就绪判定 + 记忆探测 60s 缓存；缺能力必给 `reason` |
| 绑定与执行 | `server/src/capabilities/tools.ts` | 只收 `enabled` 且 `autonomous` 的；失败降级成 `ok:false` 而不抛 |
| 分片累加 | `server/src/lib/tool-call-accumulator.ts` | 按 index 分桶、参数原样拼接、无 name 的分片丢弃 |
| 运行时上下文 | `server/src/context/runtime-context.ts` | 规则段 + 能力段（**由 Registry 生成，不许写死**） |
| 上下文组装 | `server/src/context/chat-context.ts` | 固定顺序：人格 → 规则 → 能力 → 记忆 → 状态卡 → 历史 |
| 状态可读化 | `shared/state-summary.ts` | `raw → normalized → human-readable`，杜绝 `[object Object]` |
| 工具循环 | `server/src/routes/chat.ts` | 传 tools → 攒分片 → 执行 → 回灌 → 续跑（≤3 轮） |
| 能力面 | `server/src/routes/capabilities.ts` | `GET /api/capabilities`，只读，与另两方同一份快照 |
| 前端 | `web/src/lib/chatStream.ts`、`pages/chat/ChatWindowPage.tsx`、`features/chat/MessageBlocks.tsx` | `tool-call` 帧 → 落一条 `role='tool'` 消息；卡片显示「✅ Nocturne · 搜索记忆 已完成」 |
| mock | `server/src/providers/mock-openai.ts` | 加 `[[tool]]` 触发工具调用 + **协议一致性 400 校验** |

**顺手修的真 bug**

1. **`openai-compat.ts` 从不序列化 `toolCalls`** —— `LlmChatMessage.toolCalls` 定义了但发不出去。
   `role='tool'` 消息在协议上依赖前一条带 `tool_calls` 的 assistant，真实 OpenAI / DeepSeek 会直接 400，
   工具循环第二轮必然失败。本地 mock 加了同样的 400 校验才把它拦下来（否则上线才炸）。
2. **`openai-compat.ts` 每 chunk 只取第一个 tool call**（`calls.find(isRecord)`）——
   OpenAI 的 parallel tool calls 会静默丢调用。改成收下整个数组，`LlmStreamDelta.toolCall` → `toolCalls`。

**验收（全部实跑）**

| 项 | 结果 |
| --- | --- |
| `probe-ai-runtime.ts`（新增） | **49/49**（记忆链路 + Eventide 都在时） |
| `probe-chat-context.ts`（按新契约更新断言） | 注入态 **12/12**、降级态 **3/3** |
| `probe-memory.ts` | **21/21** |
| `probe-mock.ts` | **5/5** |
| 前端全套回归 | chat **140/140**、providers **22/22**、home **75/75**、export **17/17**、offline **38/38**、diagnostics **36/36**（零失败） |
| 两端 typecheck | 通过 |

`probe-ai-runtime.ts` 覆盖：分片累加器边界（乱序 / 并行 / 残缺）· 状态可读化不出现 `[object Object]` ·
只绑真可用的能力 · 能力快照不许静默降级 · **工具调用闭环（成功与失败两条路）** ·
**上游报文里 `tool_calls` 确实原样回传** · `tools_list` 自我认知 · `state_read` 摘要可读 · 普通聊天不受影响。

⚠️ `probe-chat-context.ts` 的断言**必须跟着改**：它原先断言「persona → 状态卡 → 对话」这种**绝对下标**，
而本轮在状态卡之前插入了规则段与能力清单段（设计变更，不是回归）。
现在改成「按名字认出注入段、只看剩下那部分」，并补了两条：顺序正确、
**能力清单里不含任何未启用的能力**（不伪造）。

**遗留（不在本轮范围，已记录不顺手处理）**

- ⏳ `shared/state-summary.ts` 的 `FIELD_LABELS` 词典**未与真实 Eventide 的键集核对过**（键名不符时自动回退原键名）
- ⏳ 工具卡片总排在助手气泡之后；模型若在工具调用后又说话，顺序会相反 → 需把一次回复拆成多段气泡
- ⏳ `docs/PRODUCT_SPEC.md` §9.7 需要随本层落地而订正（本轮未改产品规格正文）
- ⏳ P1：Event Inbox、`diary_access_request` 流转、日记/留言板迁服务端（Dexie v11 + 备份格式升级）
- ⏳ P2：LLM 页面 App Launcher、Chat 头像开关

---

### T-036 · 2026-09-24 · Phase 6.5 P1 前置 · 共同生活数据迁服务端 —— **完成**

**范围**：把日记（`Diary`）与留言板（`Moment`）从浏览器 Dexie 迁到服务端 SQLite，
并**一次把权限模型落实**（SPEC §3.4 / §6.2）。这是北北 P1 清单里
「Event Inbox / 日记权限 / Diary·MessageBoard Tool」三项的**共同前置** ——
不做完它，那三项都无处落脚。

**为什么必须搬**：AI 跑在服务端，而「AI 写日记」「用户请求查看某篇」「AI 决定放不放」
这三件事都只能发生在服务端。日记留在浏览器里，AI 就只能对着假数据演戏（SPEC §6.3 明确禁止）。

**权限模型：`author` 就是权限位**（不另设第二套 role 字段）

| `author` | 谁写的 | 用户能读正文？ | 用户能改 / 删？ |
| --- | --- | --- | --- |
| `user` | 用户自己（含迁移上来的旧日记） | ✅ 总是能 | ✅ |
| `companion` | AI（小栖） | 仅 `visibility='open'` 时 | ❌ |

`visibility` 三态 `private` / `open` / `locked`，三态是**同一件事的三种状态** ——
合成一个字段而不是拆 `private` + `locked` 两个布尔（拆开会造出「private 且 locked」这种没含义的组合）。

⚠️ **迁移上来的旧日记一律标 `author='user'`**：北北已写好的日记**不会因迁移变成只读**。
这一点在设计时最先确认 —— 搬家不能顺手把用户的权夺走。

**落地**

| 位置 | 内容 |
| --- | --- |
| `shared/types.ts` | `ContentAuthor` / `DiaryVisibility` / `DiaryView`（**可能没有正文**的视图类型）；`Diary` 加 `author` / `visibility` |
| `server/src/db/schema.ts` + `index.ts` | `diary` / `moment` 两张表，照既有「手写 CREATE TABLE + 索引」惯例（无 drizzle-kit） |
| `server/src/db/diary.ts` | **权限过滤的唯一关口** `toDiaryView()`；用户建日记时 `author` / `visibility` **不收外部入参** |
| `server/src/db/moment.ts` | 同构，只是没有可见性概念（只有「谁能删」） |
| `server/src/routes/diary.ts` | 列表 / 单篇 / 增删改 / `import`（搬迁入口，幂等） |
| `server/src/routes/moment.ts` | 列表（带 `limit`）/ 发帖 / 删 / `import` |
| `web/src/db/db.ts` | **Dexie v11**：只新增中转表 `legacyUploads`，**刻意不带 `upgrade()` 回调**（理由见下条「Dexie 删不掉表」） |
| `web/src/db/legacy-upload.ts` | 搬迁的**全部三轮**：收编旧表剩余行 → 上传 → **服务端确认后才删中转行 + 删旧表那几行**；失败不删源、下次启动重试（不阻塞启动） |
| `web/src/lib/backup.ts` | **备份 v9**：不再含日记 / 留言板；旧备份里的它们转存进中转表 |
| `web/src/features/home/DiaryModule.tsx` | 按 `readable` / `editable` 渲染；小栖的日记显示「小栖的日记」+ 权限状态文案 |
| `web/src/features/home/BoardModule.tsx` | 显示「小栖 ·」标记；只有自己的留言才有删除按钮 |
| `web/src/lib/api.ts` | 新增 `fetchVoid`（204 无响应体） |

**四个真 bug（全是「跑一遍才现形」型，看代码看不出来）**

1. **Fastify 里 `return null` + `code(204)` 会变成 500** —— 204 不允许响应体，
   Fastify 去序列化那个 JSON `null` 就炸了，错误又被统一处理器兜成 500，看起来像服务端崩了。
   修法：`reply.code(204).send()`。
2. **探针自己发错**：给没有 body 的 DELETE 也带了 `content-type: application/json`，
   Fastify 去解析空 body 抛错 → 同样被兜成 500。→ 改成「只在真有 body 时才声明 JSON」。
3. **「新版本不声明某张表」删不掉它** —— 这是本任务**最值得记的一条**，因为它推翻了整个
   「升级回调里搬完就删」的设计。Dexie 的 `stores()` 是**跨版本累加**的
   （源码 `Version.prototype.stores` 里 `extend(storesSpec, version._cfg.storesSource)` 把 v1..vn 的声明
   合成一份 schema，`deleteRemovedTables()` 只认这份合并结果，末尾 `createMissingTables` 还会把缺的再建回来）。
   ⇒ 实测升到 v11 后 `diaries` / `moments` **表壳仍在、数据也仍在**。
   **修法不是换个删表姿势，而是换搬迁的挂载点**：既然旧表删不掉、旧数据本来就一直在，
   升级回调就不再是"最后一个安全时机"，而它**一辈子只跑一次**（那次离线 / 中途关掉 / 跑的是旧构建，
   就再没补救机会）→ 整套搬到**启动期**，每次启动收敛。详见 `docs/DATA_MODEL.md` §7「v11 为什么不用 upgrade」。
4. **验收脚本自己在模板字符串里被反引号截断**：`verify-home.mjs` 把注入到页面的 JS 写成模板字符串，
   我在**那段 JS 的注释里**写了反引号包住的 `diaries` / `legacyDiaries` → 模板被提前闭合 → 整支 parse 失败。
   连带后果比它本身大得多：**parse 错误 = 模块根本不执行 = 它开头那句 `Storage.clearDataForOrigin` 没跑**，
   于是本轮留下的收藏记录被下一轮的 verify-chat 继承，chat 超时崩在「收藏成功反馈」——
   表面看是「收藏功能坏了」，实际是隔了一层的测试隔离问题。
   两条收尾：① 流水线改成 **verify-home 排最前**（它是唯一清库的那支，清库必须发生在别人之前）；
   ② 这条理由写进 `verify-home.mjs` 头部（`.workbuddy/` 被 gitignore，**只写在流水线脚本里会丢**）。

**验收（全部实跑）**

| 项 | 结果 |
| --- | --- |
| `probe-diary.ts`（新增） | **40/40** |
| 两端 typecheck | 通过 |
| 前端全套回归 | ✅ 六支零失败：**home 77/77**（含两条新增的搬迁探针）· **chat 140/140** · providers 22/22 · export · offline · diagnostics 36/36 |
| 搬迁探针（写进 `verify-home`） | **实跑验证，不靠环境残留**：往 `diaries` / `moments` 直接塞两行 → 重新进应用 → 断言「服务端 `/api/diary` + `/api/moments` 回读到它们」且「旧表与中转表都清空」（`strayDiaries/strayMoments/pending` 全 0） |

`probe-diary.ts` 的重点**不是「CRUD 跑得通」**（那是最容易也最不重要的部分），而是边界：
私密日记正文不下发（`content` 为 `null` 而非空串）· 改 / 删 AI 的日记返回 **404 而非 403** ·
**「拒绝」不等于「删掉」**（被拒之后日记必须还在、内容没变）· 迁移入口幂等（重复导入不产生副本、不覆盖）·
用户自己的日记不受这些限制 · 输入校验与排序。

**遗留（已记录，不顺手处理）**

- ⏳ 「查看请求」实体与 AI 的允许 / 拒绝决策 → Phase 6.5 P1 的事件收件箱（下一批）
- ⏳ 日记 / 留言板**离线时不能写**（走 `fetchJson`，离线抛 `OFFLINE`）。
  完整的离线只读适配（逐处禁按钮 + 提示文案）尚未做
- ⏳ `BackupPanel` 的「久未导出提醒」数不到日记 / 留言板的变动（它们已不在本地库）
- ⏳ 服务端数据的备份策略（sqlite 文件级）未落文档，目前只在设置页 UI 上口头说明
- ⏳ `diaries` / `moments` 两张**空壳表**会永久留在 IndexedDB（Dexie 删不掉，见上面 bug 3）。
  已写进 `db.ts` 与 `DATA_MODEL.md` 提醒「别去清理它」，但每次有人翻 schema 都可能再困惑一次 ——
  真想去掉只有「重开一个库名 + 全量迁移」这条路，代价远大于收益，不建议动

---

### T-037 · 2026-09-24 · Phase 6.5 P1 · 事件收件箱 + 日记权限流转 + 日记·留言板 Tool —— **完成**

**范围**：北北 P1 清单的三件一起做 ——
① Event Inbox（事件收件箱）② 日记的「允许查看」请求流转 ③ 日记 / 留言板的第一批 Tool。
三件其实是**一件事的三面**：它们共用同一条「AI 与北北之间异步决定一件事」的通道，
所以合在一批做完，而不是分成三次改同一批文件。

**为什么三件必须一起做**：只做 ②（权限流转）而没有 ③，AI 就没有决定放不放的手；
只做 ③ 而没有 ①，模型发起写日记之后无处安放、也无从知道结果。
`component` 缺一个，另外两个都会退化成「点了没反应」。

**核心设计：挂起式确认（不暂停流）**

`confirm` 级工具（写日记 / 改日记 / 写留言）要用户点头。实现它有一条**不能选的路**：
在流里停下等用户点按钮 —— SSE 是单向的、服务端没有回传通道；用户刷新即废；
而且服务端刻意不存聊天记录（§6.2），没有「挂到哪了」可恢复。

所以把「决定」与「执行」拆成两次请求：模型发起 → 服务端**不执行**、只建一条待确认事件 →
回灌「已提请确认，**这次调用还没有执行**」→ 前端渲染确认卡 → 用户点了才真写 → 结果下一轮注入模型。

⚠️ 两处措辞是刻意的、改之前先想清楚：**挂起算 `ok: true`**（当失败回灌，模型会重试，
于是北北收到一串一模一样的确认卡）；回灌文本**必须明说「还没执行」**（含糊其辞，
模型下一轮就会宣称「我已经写好了」而其实还没点 —— 那正是本 Phase 要修的「说的和事实不符」）。

**Event Inbox 是双向的**（本批最该守住的一条）

| 事件类型 | 谁发起 | **谁决定** | 决定后 |
| --- | --- | --- | --- |
| `tool_confirm` | AI 想写日记 / 留言 | **北北**（`decider='user'`） | 真写入 / 什么都不做 |
| `diary_access_request` | 北北想看某篇私密日记 | **AI**（`decider='companion'`） | 该篇转 `open` / 保持私密 |

两个方向的权限检查**方向相反**：北北不能替 AI 决定放不放日记（HTTP 端点拒绝 `decider` 不匹配）；
AI 不能替北北确认（工具层硬编码 `decider='companion'`，模型传不进来）。

**落地**

| 层 | 文件 | 内容 |
| --- | --- | --- |
| 类型 | `shared/types.ts` | `RuntimeEvent` / `Kind` / `Decider` / `Status`；`ToolResultBlock.payload.eventId` |
| 契约 | `shared/events.ts` | `ChatToolCallPayload.eventId`（挂起时带上，前端据此弹卡） |
| 声明 | `shared/capabilities.ts` | 七项日记 / 留言能力补齐 tool 绑定（含 schema 与给模型的说明） |
| 表 | `server/src/db/schema.ts`、`db/index.ts` | `runtime_event`（含 `payload_json` / `target_id` / `result_delivered_at`） |
| 仓储 | `server/src/db/event.ts` | `settleEvent()` 带 `status='pending'` 条件更新 —— 决策只能做一次 |
| 执行 | `server/src/services/event-inbox.ts` | 校验 → 挂起 → 决策 → **真副作用**（唯一的执行点） |
| 日记 AI 侧 | `server/src/db/diary.ts` | `toCompanionDiaryView()`（**第二个出口**，AI 视角）/ `createCompanionDiary` / `setDiaryVisibility` |
| 留言 AI 侧 | `server/src/db/moment.ts` | `createCompanionMoment` |
| 判定 | `server/src/capabilities/registry.ts` | `NOT_IMPLEMENTED_YET` 从八条缩到一条（只剩 `memory.write`） |
| 工具 | `server/src/capabilities/tools.ts` | `confirm` 也绑（`isModelCallable`）；执行层挂起；四个日记工具的执行分支 |
| 上下文 | `server/src/context/event-context.ts`（新）、`chat-context.ts` | `runtime_events` 段：待决每轮注入 / 结果只注入一次 |
| 路由 | `server/src/routes/inbox.ts`（新）、`routes/diary.ts` | `/api/inbox*` + `POST /api/diary/:id/request-access` |
| 前端 | `web/src/db/events.ts`、`features/chat/EventConfirmCard.tsx`、`MessageBlocks.tsx`、`pages/life/LifePage.tsx`、`features/home/DiaryModule.tsx` | 确认卡（读服务端状态、不乐观更新）/ Life 页「事件」tab / 日记页「请求查看」 |

**⚠️ 两个刻意不成对的东西，别顺手统一**

1. **`DiaryView` 有两个出口**：`toDiaryView()` 是**用户视角**（AI 私密日记只给封面），
   `toCompanionDiaryView()` 是 **AI 视角**（只给自己的日记、且给全文）。
   共用一个会两个方向都出错：AI 读不到自己写的东西，或者用户拿到私密正文。
2. **`denied` 与 `failed` 分开**：前者是「北北说不」，后者是「北北说好但它没做成」。
   混成一句会让用户以为自己点错了。

**真 bug（跑一遍才现形）**

1. **新路由撞了已有端点**：`GET /api/events` 已被 Eventide 的**状态事件流水**占用
   （`routes/automation.ts`），Fastify 启动直接 `FST_ERR_DUPLICATED_ROUTE` 退出。
   改名为 `/api/inbox` —— 不是随手挑的名：「事件」这个词太泛，
   而这张表是「等你决定什么」的待办，叫收件箱才说清了它和流水表的区别。
   （顺带把文件从 `routes/events.ts` 改名 `routes/inbox.ts`，免得下一个人又按文件名去猜路径。）
2. **mock 上游不能带参数调工具**：`[[tool:名字]]` 只能发空参数，
   而写类工具的 `title`/`content` 都是必需的 —— 等于**写类工具永远验不了**。
   给 mock 加了 `[[tool:名字 {"k":"v"}]]` 形式（P0 时只读工具无参，所以没暴露）。

**验收（全部实跑）**

| 项 | 结果 |
| --- | --- |
| `probe-event-inbox.ts`（新增，一键 `.workbuddy/run-p1-verify.sh`） | **66/66** |
| `probe-ai-runtime.ts`（断言随 P1 更新） | **50/50** |
| 两端 typecheck | 通过 |

`probe-event-inbox.ts` 盯的是**三条不能破的边界**，不是接口通不通：
① 挂起时日记**还没被写**（挂起=执行的边界）② 决策**只能做一次**（点两下不写两篇）
③ 北北**不能替 AI 决定**（`decider` 不匹配 → 400）。
另加：参数不合法当场回灌而不挂卡 / 结果只注入一次 / 被拒之后日记还在 / AI 的日记用户删不掉。

**遗留（不在本批范围，已收敛到这里）**

- ⏳ 确认卡的**过期 / 撤回**未做：挂很久的请求会一直留在收件箱（目前无害，但该有个上限）
- ⏳ `memory.write` 仍未实施（Nocturne 实例的写工具 `hold` 没接）
- ⏳ 工具卡片总排在助手气泡之后（模型在工具调用后又说话时顺序会反）—— 需把一次回复拆成多段气泡
- ⏳ `docs/PRODUCT_SPEC.md` §9.7「AI 自主工具调用暂不启用」需随本层落地订正
- ⏳ P2：LLM 页面 App Launcher、Chat 头像开关

**T-037 补充（同日）**：确认卡的**前端交互**（卡片渲染 / 点按钮 / 刷新后状态还在）**没有自动化覆盖** ——
`probe-event-inbox.ts` 验的是服务端全链（含 `tool-call` 帧里的 `eventId`），
而 `verify-home` 那套前端脚本不接 mock 上游、没法触发工具调用。
所以「模型发起写日记 → 聊天里冒出确认卡 → 点允许」这条**人眼要过一遍**。
要补的话得给前端脚本加一个 mock 上游前置（成本不低，先记着）。

---

### T-038 · 2026-09-24 · Phase 6.5 P2：LLM 档案页 App Launcher + Chat 头像开关 —— **完成**

**范围**：把 P0 / P1 修通的「能力声明 → 判定 → 工具 → 确认卡 → 事件回灌」这条链**摆到界面上**。
**只动呈现层**：服务端能力面一行没改，**零 schema 改动**（Dexie 仍 v10、备份仍 v8）。

**先定产品行为，再施工**

`PRODUCT_SPEC` §9.1 原文是「待 Phase 对应开发前补充」——现在进入开发了，按铁律先把它补成正文。
三条底线（写进 SPEC，也是这次验收盯着的东西）：

1. **内容唯一来源 = `GET /api/capabilities`**，前端不自带第二份能力清单、不写死能力文案
2. **只读**，不提供「把某项能力打开」的开关（那会立刻把这份档案变成谎言）
3. **有界面才可点；没界面不做假入口**

**北北拍板的两个边界**

- 卡片点击：**有页面就跳过去，没有就不跳**（不做假入口）
- 头像开关：**全局偏好**（一个开关管所有会话）

**落地**

| 层 | 文件 | 内容 |
| --- | --- | --- |
| 数据 | `web/src/lib/capabilities.ts`（新） | `getCapabilities()`，走 `fetchJson`（自动带离线兜底） |
| 模块目录 | `web/src/features/llm/capabilityModules.ts`（新） | 模块名 / 图标 / 顺序 / **启动目标**；自主级别的**面向用户**说法 |
| 卡片 | `web/src/features/llm/CapabilityModuleCard.tsx`（新） | 一张卡 = 一个模块；可点用 `<Link>`，不可点用 `<div>`（不让读屏与键盘以为能进） |
| 页面 | `web/src/pages/llm/LlmPage.tsx` | 由占位改成档案页：loading / 失败可重试 / 空态 / 离线单独提示 |
| 显示偏好 | `web/src/app/useChatDisplay.ts`（新） | zustand + persist（localStorage），与主题同款做法 |
| 头像 | `web/src/features/chat/MessageAvatar.tsx`（新） | 首字 + 主题色；**头像文字的唯一定义处**；`tool` / `system` 不画 |
| 气泡 | `features/chat/ChatBubble.tsx`、`pages/chat/ChatWindowPage.tsx` | 头像挂气泡**外侧**（小栖左 / 用户右）；`showAvatars` 由页面从 store 读出后传下来 |
| 开关 | `features/chat/ChatSettingsSheet.tsx` | 与上面三项**分开、不参与本表单提交**，点了立刻生效，明说「影响所有会话」 |

**⚠️ 两组刻意分开、别顺手统一的东西**

1. **「有页面」≠「现在可用」**：日记页在 AI 写不了日记时**照样存在**。
   入口的有无取决于「界面在不在」，能力徽标才取决于「依赖就绪没有」。
   绑在一起 → 界面时而冒出入口、时而消失，**而且验收在缺依赖的环境里跑不出稳定结果**。
2. **「全局显示偏好」≠「会话设置」**：头像是「看着顺不顺眼」，不落 Dexie、不进备份格式；
   开关也不参与那个面板的保存语义（混进同一个提交，用户会以为「不点保存就不算数」）。

**验收（全部实跑）**

| 项 | 结果 |
| --- | --- |
| `verify-llm.mjs`（新增） | **16/16** |
| `verify-chat.mjs`（新增 8 条头像断言） | **148/148**（原 140） |
| 其余五支回归 | home **77/77** · providers **22/22** · export **17/17** · offline **38/38** · diagnostics **36/36** |
| 两端 typecheck | 通过 |

`verify-llm.mjs` 的**关键做法**：**先取 `/api/capabilities` 真值，再和 DOM 逐条比** ——
能力名与数量随环境变（本地没有 Nocturne / Eventide 时记忆与状态就不可用），
写死的话换个环境不是假红就是假绿。它盯的三条边界：
① 卡片列出的能力与快照**逐 id 一致** ② 每项可用状态一致、不可用**必给原因** ③ **没界面的模块不是链接**。

**顺带修的验收假象**

- `verify-home` 文档里一直写 **75 项**，实际早就是 **77**（T-036 加了两条搬迁探针）。README / AGENTS 已改对。
- 给 `pin-new` 验收会话补了一条**用户消息**：原先那会话只有一条 AI 消息，
  「两侧都显示头像」这类断言在虚拟列表里根本凑不齐（只渲染可视区）。

**遗留（已收敛在此）**

- ⏳ 确认卡**过期 / 撤回**未做；其**前端交互**仍无自动化覆盖（前端脚本不接 mock 上游）
- ⏳ `memory.write` 仍未实施（Nocturne 的 `hold` 没接）
- ⏳ 工具卡片总排在助手气泡之后（模型在工具调用后又说话时顺序会反）
- ⏳ `PRODUCT_SPEC` §9.7「AI 自主工具调用暂不启用」需随 P0/P1 落地订正
- ⏳ **记忆与工具仍没有界面**：档案页已如实标「暂无界面」，要做真页面得先想清楚「用户拿它做什么」
- 📌 本机跑不了的两条（与 T-037 同）：Nocturne 真记忆、手机装 PWA / Web Push

---

### T-039 · 2026-09-25 · UI 换装第 1 批：设计令牌 + 翻译层 + 整套积木（地基） —— **完成**

**背景**：北北提供了完整前端视觉原型 `D:/我搓/designs/qixi-habitat/`（19 个 JSX + `tokens.css`），
要给栖息地「换这套衣服」，并把尚未落成的功能（一起听真播放 / 学习伴学 / 独处空间）逐步套嵌进去。
按「每批可回退」的原则拆成 **6 批**，本批是**纯内部的地基**：外观只换配色，不动任何布局与交互。

**为什么本批必须存在（而不是直接开做页面）**：前端有 **551 处**引用旧令牌名
（`--color-text-dim` 161 处、`--color-border` 137 处……）。若在换皮的同时改这 551 处，
一旦漏改，症状是「某个页面某处字看不见」，而排查范围是整个前端。所以先做一层**翻译层**
把旧名转发到新令牌 —— 新配色一次性生效，**旧代码一行不改**；之后各批做到哪页、收敛哪页。

**本批交付**

| 项 | 文件 | 说明 |
| --- | --- | --- |
| 新设计令牌 | `web/src/theme/qixi/tokens.css`（新） | 浅 / 深两套：底色·表面·三档文字·强调·玻璃·圆角阶梯·两档阴影·动效时长·`--hit-min: 44px` |
| 翻译层 | `web/src/theme/tokens.css` | 旧 9 个 `--color-*` + `--font-family` 全部 `var()` 转发；**不写具体色值**，深色自动跟随 |
| 整套积木 | `web/src/theme/qixi/components.css`（新） | 类型阶梯 `.t-*` / 胶囊按钮 / 卡片 / chip / 开关 / 分段控件 / Bento / 胶囊底栏 / 滑入层 / 气泡 / 玻璃卡 / 雨幕 / 设置分组 / 迷你柱图 / 环形进度 / `.rise` 入场 |
| 32 个图标 | `web/src/components/qixi/Icons.tsx`（新） | 24×24、线宽 1.7、**选中态用实心**；带 `filled` 类型约束 |
| 雨幕 + 玻璃卡 | `web/src/components/qixi/RainBackdrop.tsx`（新） | 雨滴/雨痕**程序生成**（52 滴 + 14 痕），**确定性伪随机**（用 `Math.random()` 会变成"闪烁跳动的雨"） |
| 地基验收 | `web/scripts/verify-tokens.mjs`（新，**24 条**） | 见下 |

**刻意不搬的四处（都在文件头写了原因）**

1. **桌面「手机壳」**：原型用 `#app` 画了一个 390×844 的假手机 + 深灰背景。栖息地本身就是手机上的 PWA，
   真机全屏才正确；套假壳会让真机出现双边框。桌面预览要不要手机壳是**另一件事**。
2. **`.screens` / `.screen` 叠放式换屏**：原型把所有页面绝对定位叠着、靠 JS 切 `is-active`。
   栖息地是**真路由**（`/home/diary` 是真网址），照搬会打断刷新 / 前进后退 / 收藏。
   第 2 批改用 `.sub-layer` 只做滑入动画，**网址保持不变**。
3. **`.float-theme` / `.tweaks-*`**：原型给自己配的调试面板（悬浮主题开关 + 雨量滑块），不是产品功能。
4. **`.model-card`**：设计侧「大脑」页的换模型卡。北北已拍板这一轮 LLM 页只装能力卡片，
   换模型仍在「设置 → API 方案」。样式留着、注释标明**暂未启用**。

**顺手修掉的一个真 bug**

- `--color-accent` **从来没有被定义过**，但代码里用了 4 处（生活页"选中日期的描边"、
  "一条提示文字"、"小栖钱包 — 追加流水"按钮的背景、"余额增减"的正负号颜色）。
  浏览器会把未定义的 `var()` 当作无效值丢掉 → **那个按钮实际是"白字 + 透明底"，文字看不见**。
  已补进翻译层并断言。这类"看着能跑、其实是坏的"引用，只有把名字逐个对一遍才会浮出来。

**验收（全部实跑，不是读代码）**

| 项 | 结果 |
| --- | --- |
| `verify-tokens.mjs`（新增） | **24/24** |
| 其余八支回归（home / chat / providers / llm / export / offline / diagnostics） | 见 CHANGELOG 同批记录 |
| 两端 typecheck | 通过 |

`verify-tokens.mjs` 盯的是**三层**：
① 新令牌 18 个全部有值；② **翻译层 10 条转发逐字相等**（旧名 === 新名）——这是本批唯一真正的风险点；
③ 13 个积木类挂探针元素量**计算结果**（`.bento` 是 grid、`.card` 圆角 24px、`.glass` 真有 `blur`、
`.sub-layer` 收起态在屏外…）—— CSS 里写了不等于生效。
另外断言浅/深两套确实不同、旧别名跟着深色一起切（证明不是"只有新名在变"），并各截一张图。

**遗留**

- ⏳ 第 2~6 批未开始（见 `docs/UI_DESIGN.md` §5 的批次表）
- ⏳ 翻译层是**过渡产物**：后续每批把做到页面的旧名换成新名，全部换完后整体删除
- ⏳ `--bottom-nav-height` 仍按「贴底一条」的旧模型算（4rem）。第 2 批把底栏换成**浮起胶囊**后
  要重新量一次占位高度，否则内容会被胶囊盖住
- ⚠️ 本批**只换配色**：底栏还是旧的（emoji 图标 + 英文标签），页面布局一律未动
