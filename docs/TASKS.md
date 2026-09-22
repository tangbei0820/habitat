# TASKS · 任务记录与待优化清单

> **用途**：每完成一次任务，**先按顺序追加一条记录**，写清「已完成什么 + 还剩什么待优化」，然后再进入下一进程。
> **与 `docs/CHANGELOG.md` 的分工**：CHANGELOG 记「改了什么」（面向版本，按 Phase 组织）；本文件记「做到哪、还欠什么」（面向推进与排期）。
> **两条硬规矩**：① 已完成只写要点，正文链到 CHANGELOG，**不复制**；② **所有待优化一律收敛到本文件**，不许散落在对话、代码注释或临时文件里。
> 最后更新：2026-09-22

---

## 待优化清单（汇总）

做完就勾掉，并在下方对应任务记录里注明。

### 高 —— 影响正确性，容易踩

- [x] ~~**服务端不读 `.env`**~~ —— 已修（T-003）：新增 `server/src/lib/env.ts`，作为 `src/index.ts` 的**第一个 import** 把 `server/.env` 灌进 `process.env`。刻意不引 dotenv（它可用的 `process.loadEnvFile` 会覆盖既有变量），手写极简解析保证优先级为「**真实环境变量 > .env**」，路径按模块位置解析所以从哪启动都能找到。
- [ ] **`web` 缺备份导出** —— 铁律 5 要求「版本化迁移 **+ 备份导出**」。现在 Dexie `version(1)` 迁移有了，但导出 / 导入入口为零；水合失败只能引导用户「清理站点数据」= 数据直接丢。→ Phase 1 在设置页补导出 / 导入。
- [ ] **聊天窗口避让底栏用的是魔法数字** —— `AppShell` 用 `pb-16` 给底部导航让位，导航高度或 Safe Area 一变就错位。→ 把导航高度提成 CSS 变量统一引用。

### 中 —— 体验与一致性

- [ ] **Home 子模块标题显示原始 key** —— `/home/board` 的标题渲染成 `Board`（对英文 key 做 `capitalize`），而入口列表里是「留言板」。→ 用同一份模块表反查中文名。
- [ ] **原生模块 ABI 与 Node 版本绑定** —— `better-sqlite3` 的二进制绑定**安装时**的 Node 版本；本仓库是在 Node 20 下装的，用 Node 22 启动会 `ERR_DLOPEN_FAILED`。已在 `README.md` 环境要求里写明，但还没做机器可读的约束。→ 加 `.nvmrc`（或 `package.json` 的 `engines`）+ 启动时校验版本并给一句人话提示。
- [ ] **`stream_options` 可能被上游拒绝** —— 兼容层无条件发 `stream_options: { include_usage: true }` 以换取末包 usage（账本要用）。极少数自建上游（老版 vLLM、部分代理）会回 400。→ 按方案加开关，默认开。
- [ ] **`.env` 里的 JSON 必须写成单行** —— 极简解析器逐行读，把 `HABITAT_LLM_PROFILES` 的 JSON 换行美化会被截断成非法 JSON。不会静默：启动日志与 `/api/providers` 都会暴露。→ 或支持续行，或在报错文案里点明「请写成一行」。
- [ ] **`favicon.ico` 404** —— 每个页面控制台一条红字。→ 放个 favicon，或声明空 data URI 的 `<link rel="icon">`。
- [ ] **React Router v7 future flag 警告** —— 控制台噪音。→ 显式开 `v7_startTransition` / `v7_relativeSplatPath`。
- [ ] **服务端 CORS 全开** —— `origin: true` 会反射任意来源。本地开发可接受，**上线前必须收紧到具体域名**。

### 低 —— 开发工具与体验毛刺

- [ ] **`ApiProfilePublic.hasKey` 语义有歧义** —— `keyRef` 为空串（上游不需要鉴权）时它也恒为 `true`，含义其实是「凭证已就绪、可直接用」。→ 方案管理 UI 的文案别写成「密钥已配置」。
- [ ] **`modelMap` 的 tts / vision / embedding 槽位暂时无人消费** —— 已按 §6.2 预留，等 Phase 5 接语音 / 视觉时用。
- [ ] **mock MCP 的 GET / DELETE 分支取错 session id** —— `mock-server.ts` 的 POST 分支正确地读 `req.headers['mcp-session-id']`，但 GET / DELETE 分支读的是 `url.searchParams.get('sessionId')`；官方 SDK 明确是**发 header**（见 `node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js:427`）。后果：SSE 流与显式关会话两条路径必然 400（目前 Gateway 没用到，所以没暴露）。→ 统一改读 header。
- [ ] **`ApiProfile` 的权威存储还在环境变量** —— 按 §6.2 它应「本地（前端 Dexie）+ 服务端同步副本」。切片一先用 `HABITAT_LLM_PROFILES` 把链路跑通是刻意的临时方案；等「API 方案管理 UI」落地后换数据源（`LlmRegistry` 对外接口不变）。

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
