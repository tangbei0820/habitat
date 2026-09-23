# 栖息地（habitat）· AI 工作入口

> **做任何任务前，先读本文件。** 本文件只负责告诉 Agent「当前项目状态、该读什么、该参考谁、做到哪里停止」，不复制其它文档正文。
>
> **上下文预算原则**：只读取当前任务直接相关的文档章节与代码，不得无目的通读整个项目、整个技术方案或整个参考库。
>
> **产品交互任务例外**：当任务涉及新增、重构或补全核心产品交互时，外部参考项目属于“设计输入”，不是只有遇到技术困难才查。
> 此类任务必须先查看 `docs/PRODUCT_SPEC.md` 对应章节，再按 §4 指定的参考项目中挑选 **1–3 个最直接相关项目**，检查其 README / 截图 / 对应功能实现，提炼可借鉴的交互后再施工。
>
> **纯修 bug、补测试、改接口、改部署等不涉及产品交互的任务，不强制查 GitHub 参考项目。**
>
> 任务完成后立即停止。不得自行扩展需求、重构无关代码、继续优化或执行下一阶段任务。超出当前范围的问题统一写入 `docs/TASKS.md`。
> 最后更新：2026-09-23

---

## 0. 怎么用这份文件

固定动作：

1. 读 **§1 项目速览** + **§3 工作铁律**
2. 到 **§4 按任务查**，确认本任务的：
   - 产品定义
   - 技术依据
   - UI 依据
   - 外部参考项目
3. 若任务涉及 **产品交互新增 / 重构**：
   - 先读 `docs/PRODUCT_SPEC.md` 对应章节
   - 再从 §4 命中的参考项目中选择 1–3 个最相关项目实查
   - 先总结“准备借鉴什么”，再开始实现
4. 动手前扫一眼 **§5 高风险清单**
5. 收尾：
   - 先追加 `docs/TASKS.md`
   - 更新本文件中的当前阶段
   - 完成整个 Phase 时再更新 `docs/CHANGELOG.md`

---

## 1. 项目一页速览

| 项    | 内容                                                                                            |
| ---- | --------------------------------------------------------------------------------------------- |
| 是什么  | 栖息地（habitat）—— 北北与「小栖」的个人 AI Companion 数字空间。**个人自用、非商业**                                      |
| 形态   | PWA 单页应用 + 常驻 Node 后端，单仓三目录                                                                   |
| 前端   | React 18 + TypeScript(strict) + Vite + Dexie(IndexedDB) + Zustand + Tailwind（Tokens 走 CSS 变量） |
| 后端   | Fastify(Node 20, TS strict) + better-sqlite3 + Drizzle + 官方 `@modelcontextprotocol/sdk`       |
| 外部件  | Nocturne（记忆，MCP，**已部署**）、Eventide（状态，Python 库 + sidecar，Phase 3B）、MCP Gateway 聚合              |
| 部署   | 阿里云单机：Caddy 反代 + habitat-server + Nocturne + eventide-sidecar                                 |
| 当前阶段 | **Phase 2 已完成**：十个 Home 生活模块、Dexie v7、备份 v5 与完整浏览器验收已收口；下一阶段 Phase 3A 长期记忆（Nocturne） |
| 关键判断 | **必须有常驻后端** —— 唤醒、独处时光、通知、账本、MCP 聚合在纯前端做不了                                                    |

**阶段路线**：P0 基座可视化 → **P1 Chat MVP（最优先）** → P2 Home 生活模块 → P3A 记忆（Nocturne）→ P3B 状态（Eventide）→ P4 Life → P5 高级能力 → P6 打磨

**目录结构**

```
habitat/
├── AGENTS.md                    ← 本文件（AI 工作入口）
├── 栖息地初版技术方案分析.md      ← ★ 施工依据（唯一权威，v1.1）
├── docs/                        ← 项目文档（PRODUCT_SPEC / UI_DESIGN / REFERENCES / 各专题）
├── shared/                      ← 前后端共享类型、Provider 接口、SSE 协议、错误码
├── web/                         ← React SPA（app/ pages/ features/ components/ db/ theme/ providers/ lib/）
└── server/                      ← Fastify（routes/ context/ providers/ mcp/ jobs/ db/ lib/）
```

**边界铁律**：后端是唯一对外出口 —— 前端不直连 LLM / 不参与 MCP 握手 / 不直连 Nocturne、Eventide。

**常用命令**（完整 SOP 与验收命令见 `README.md`）：
`setup` 安装依赖 ｜ `dev:server` → :3000 ｜ `dev:web` → :5173（/api 已代理）｜ `typecheck` 两端类型检查 ｜ `build` 前端构建

---

## 2. 权威文档地图

| 文档                        | 管什么                                                                             | 什么时候读                                |
| ------------------------- | ------------------------------------------------------------------------------- | ------------------------------------ |
| `栖息地初版技术方案分析.md`          | **★ 施工依据**：架构 / 技术选型 / 数据模型 / Provider 设计 / 部署拓扑 / 风险对策                         | 需要架构决策或具体设计时，**按章节读**（见 §4）          |
| `docs/PRODUCT_SPEC.md`    | **★ 产品行为权威**：功能定位 / 用户与 AI 权限 / 页面入口 / 操作路径 / 跨模块联动 / 已知偏差                      | 做任何产品交互、新功能、UX 重构前，**读对应章节**         |
| `docs/UI_DESIGN.md`       | 视觉语言（色彩 / 字体 / 圆角 / 间距 / 动效 / Safe Area）                                        | 做任何 UI 前。⚠️ **内容待北北补充，补充前一律只做简单 UI** |
| `docs/栖息地_UI参考资料_v1.0.md` | ChatGPT Mobile UI 参考 + 栖息地 UI 原则 / 首页方向 / 欢迎语料库 / **给 Coding Agent 的 10 条实现要求** | 做任何 UI 前，与 `UI_DESIGN.md` 一起读        |
| `docs/REFERENCES.md`      | 外部参考项目库（本项目之外的 GitHub 项目）                                                       | §4 命中任务时按需查                          |
| `docs/API.md`             | 接口约定                                                                            | 加 / 改接口时同步（现：健康 2 + 聊天 1 + 方案 9 + 诊断 1 + 记忆 6） |
| `docs/DATA_MODEL.md`      | 数据模型                                                                            | 建模时（占位中，以技术方案 §6 为准）                 |
| `docs/MCP.md`             | 工具层与 Gateway                                                                    | 动 MCP 时                              |
| `docs/MEMORY.md`          | 记忆系统接入                                                                          | Phase 3A 时                           |
| `docs/DEPLOYMENT.md`      | 部署                                                                              | 部署时（占位中）                             |
| `docs/CHANGELOG.md`       | 变更记录（按 Phase，面向版本）                                                             | **每完成一个 Phase 追加**                   |
| `docs/TASKS.md`           | **任务记录 + 待优化清单**（面向推进）｜所有「本次没做、以后要做」的问题都收敛在这 | **每次任务收尾必读必写**                      |
| `README.md`               | 对外说明 + 本地启动 SOP + **本地验收命令**                                                  | 首次搭环境 / 跑验收前                        |

> 原 `ARCHITECTURE.md` / `PROJECT_PLAN.md` / `UI.md` 三个纯占位文件已并入本表（内容均为「以技术方案为准」），不再单列。  
> **权威分工：**
>
> - `PRODUCT_SPEC.md`：管 **做成什么、怎么使用**
> - `栖息地初版技术方案分析.md`：管 **怎么实现**
> - `UI_DESIGN.md`：管 **长什么样**
> - `REFERENCES.md`：管 **外部项目有哪些值得借鉴**
> - `TASKS.md`：管 **现在做到哪、还欠什么**
> - `CHANGELOG.md`：管 **历史版本改过什么**
>
> **若产品交互定义与旧技术方案中的简化实现发生冲突，以 `PRODUCT_SPEC.md` 的产品行为为准**，再评估技术方案 / 数据结构需要如何同步调整；不允许为保留现有 CRUD 实现而反向缩减产品定义。
> PRODUCT_SPEC 只定义目标行为，**不维护「未完成 / 已完成 / 优先级」状态**（状态一律记在本表最后一行的 `TASKS.md`，避免双写）。



---

## 3. 工作铁律（不可违反）

1. **TypeScript 全链 strict，零类型豁免** —— 不设任何 `ignoreBuildErrors` 类开关（float-phone 前车之鉴）
2. **首阶段不引入 monorepo 工具链** —— 单仓三目录（`web/` `server/` `shared/`），Phase 3 再评估升级 workspace
3. **前端永不直连 LLM / Nocturne / Eventide** —— API Key 不出服务端；前端只走 `GET/POST /api/*` + SSE
4. **记忆通道唯一** —— Nocturne 只走 MCP（经 Gateway），不用它的 REST（除 Dashboard 直链与 `/health` 探测）
5. **本地数据层第一天就要版本化迁移 + 备份导出** —— Dexie 迁移机制，吸取 float-phone 丢数据教训
6. **UI 简单优先** —— `UI_DESIGN.md` 被补充前、或未被明确要求时，只做简单 UI，不堆砌视觉细节
7. **每个 Phase 独立验收 + 独立 git commit**
8. **不 fork 参考项目** —— 外部项目只读研究 / 作为外部服务接入
9. **引用第三方代码需标注原作者**
10. **产品交互不得仅以 CRUD 可用作为完成标准** —— “能新增 / 保存 / 删除 / 展示”只代表数据链路可用；若 PRODUCT_SPEC 定义了更完整的真实使用流程，必须按产品定义验收。
11. **参考项目只借鉴，不盲抄** —— 核心交互任务按 §4 实查 1–3 个项目，先提炼可借鉴点，再结合栖息地 PRODUCT_SPEC 实现；不得因为参考项目已有某设计就擅自改变本项目已确认的产品定义。

---

## 4. 按任务查（核心速查表）

| 我要做… | 产品 / 技术必读 | 外部参考规则 |
| ---------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| Chat 页面 / 消息交互 | `docs/PRODUCT_SPEC.md` §2 + 技术方案 §7.2① / §8 / §6.3 + `docs/API.md` | **核心交互新增或重构前必须实查 1–3 个**：chatnest、the-house、Pando、CC Companion App |
| 消息块渲染 / 消息版本（多候选） | 技术方案 §6.2 / §6.3 + `shared/types.ts`（`MessageBlock` 可辨识联合） | —（实现层，渲染分发见 `web/src/features/chat/MessageBlocks.tsx`，版本见 `web/src/db/chat.ts`） |
| 多 Provider / API 方案管理 | 技术方案 §7.1 / §7.2① / §6.2（ApiProfile）+ `docs/API.md` | OmniRouter、VCPToolBox |
| MCP Gateway / 诊断日志 | 技术方案 §7.2② / §9 风险1 + `docs/MCP.md` | amap-mcp-server、VCPToolBox |
| 世界书 / 角色设定 | `docs/PRODUCT_SPEC.md` §9.4 + 技术方案 §6.2 | character-card-spec-v2/v3、KI-CO |
| Home 生活模块 | `docs/PRODUCT_SPEC.md` §3–5 + 技术方案 §8 | **每次只查当前正在施工的模块**：Journal、shared-page、dwell-on-something、memex |
| 收藏 / 作品 / 相册跨模块联动 | `docs/PRODUCT_SPEC.md` §3.5–3.7 + §4 | 优先查看支持跨内容收纳、引用、归档的参考项目；只查与当前对象类型直接相关的项目 |
| UI 页面 / 布局 / Widget | `docs/PRODUCT_SPEC.md` 对应模块 + 技术方案 §8 + `docs/UI_DESIGN.md` + `docs/栖息地_UI参考资料_v1.0.md` | 有明确产品参考时再查对应项目；不要遍历整个参考库 |
| 长期记忆接入 | 技术方案 §7.1 / §9 风险1·5 + `docs/MEMORY.md` | Nocturne 为主；只有涉及实现取舍时再查 Paramecium / Ombre-Brain / kiwi-mem |
| 状态系统 / 情绪 | `docs/PRODUCT_SPEC.md` 后续对应章节 + 技术方案 §0.1-4 / §7.2③ | Eventide 为主；需要设计行为模式时再查 Drivesoid / Tidefall / jiwen |
| 主动唤醒 / 独处时光 | `docs/PRODUCT_SPEC.md` §9.5 + 技术方案 §7.2③ / §9 风险6 | 需要设计主动行为时实查 Headlong / AI Companion Runtime / WrenWen 等 |
| Life 统计 / 账本 / 通知 | `docs/PRODUCT_SPEC.md` §9.2（待补）+ 技术方案 §6.2 | Phosphene、WORKKK |
| 部署 / 反代 / SSE | 技术方案 §4 / §9 风险2·3 | 非产品交互任务，按需查：Ocean、AionsHome、Not Fade Away、cloud-and-island |
| 导入导出 / 数据主权 | 技术方案 §9 风险7 | 非产品交互任务，按需查：forge-reload、context-slim、chatgpt-exporter |
| 语音 / TTS（Phase 5） | `docs/PRODUCT_SPEC.md` §9.6（待补）+ 技术方案 §7.1 | voice-mcp、GPT-SoVITS、Callhome |
| 感知（Phase 5+） | — | Akari Pulse、gaze、cove-sensory-mcp |

---

## 5. 高风险清单（动手前必看）

| #  | 风险                       | 对策在哪                                           |
| -- | ------------------------ | ---------------------------------------------- |
| 1  | **MCP 握手 / 请求捕捉失败**（有前科） | 技术方案 §7.2②、§9-1。先用 Nocturne 公共 demo 验证客户端代码    |
| 2  | **SSE 过反代被缓冲** → 假死      | §9-2。Caddy 默认友好；nginx 必须 `proxy_buffering off` |
| 3  | 未备案限制公网形态                | §9-3。相对路径 + 环境变量 base URL，零改动切换                |
| 4  | Eventide 是库不是服务 + 非商业许可  | §9-4。sidecar 隔离；不随产物分发                         |
| 5  | Nocturne 升级 / 迁移         | §9-5。锁 commit；升级前备份 DB；不依赖其内部 schema           |
| 6  | **唤醒 / 独处费用失控**          | §9-6。BudgetGuard 硬闸门，所有出口统一过闸                  |
| 7  | 本地数据损坏 / 丢失              | §9-7。Dexie 版本化迁移 + 水合失败拦截                      |
| 8  | 长聊天性能                    | §9-8。虚拟滚动，Phase 1 就引入                          |
| 9  | iOS PWA 推送受限             | §9-9。通知中心为底座                                   |
| 10 | 范围蔓延                     | §9-10。严格按 Phase 交付                             |

---

## 6. 当前进度 & 维护约定

**已完成**

- **Phase 0 全部完成**（2026-09-22）
  - 骨架：`web/` `server/` `shared/` `docs/`、TS strict、`@shared` 别名、Vite proxy（`/api` → :3000）、本地 git
  - 可视化三件套：① Home 外壳（10 个生活模块入口 + 分时欢迎语）② Chat（会话列表 + 聊天窗口壳，真实导航、Dexie 落库）③ 主题系统（深浅 CSS 变量 + 切换即时生效 + 跨刷新保持）
  - 五 Tab 路由 + `AppShell` + 底部导航 + SafeArea（`viewport-fit=cover` / `interactive-widget=resizes-content`）
  - MCP Gateway 最小可用：官方 SDK Streamable HTTP + 每 server 状态机 + `mcp_diagnostic_log` 全量留痕；`GET /api/health`、`GET /api/health/mcp`；开发用 mock MCP server（`npm run dev:mock-mcp`）
  - 本地数据层 Dexie `version(1)`（`sessions` / `messages`）+ 启动水合失败拦截

- **Phase 1 · 切片一：通用 OpenAI 兼容层**（2026-09-22）
  - `shared`：`LLMProvider` 接口族落地（`streamChat` 流式事件 / `listModels`）、`ApiProfile` + 脱敏视图 `ApiProfilePublic`、Provider 四个错误码
  - `server`：`OpenAICompatProvider`（fetch + 自写 SSE 解析，含思维链、usage、tool_calls 透传、空闲超时、AbortSignal 取消）；`LlmRegistry` 方案注册表 + Adapter 工厂；`GET /api/providers`、`GET /api/providers/:id/models`、`POST /api/providers/:id/test`
  - 密钥模型：方案只存 `keyRef`（环境变量名），真值只在服务端进程环境里，**永不下发前端**
  - `server/.env` 现在真的会被读取（此前 `.env.example` 是摆设）
  - 开发用 mock OpenAI 上游（`:3334`）+ 验收脚本 `scripts/probe-llm.ts`（20 项断言全过）

- **Phase 1 · 切片二：本地存储的聊天链路（SSE 端到端）**（2026-09-22）
  - 契约：`shared/events.ts` 定义聊天流协议（`ChatStreamRequest` + `chat-delta` / `chat-usage` / `chat-done` / `chat-error`）
  - `server`：`POST /api/chat`（SSE）—— 校验 → 转发 → 记账；**先取上游首个 chunk 再写响应头**，于是配置/鉴权/连通性错误走结构化 4xx/5xx，只有流中途故障才走 `chat-error` 事件；客户端断开即 abort 上游
  - `server`：`usage_record` 表 + `db/usage.ts`（§6.2「每次调用强制落一条」，`day_key` 用本地时区）
  - `web`：自写 SSE 客户端 `lib/chatStream.ts`（`EventSource` 不支持 POST，故用 fetch + ReadableStream）、本地仓储层 `db/chat.ts`、Dexie `version(2)`（补 `[sessionId+createdAt]` 复合索引，支撑按时间分页）
  - `web`：聊天窗口真实发送 / 流式累加渲染 / 中止保留已收内容 / 错误提示 / 首条消息自动命名会话；流式中不写库，收尾才落一条
  - `web`：自写不定高虚拟列表 `components/VirtualList.tsx`（实测高度缓存 + 二分定位 + 贴底跟随，§9 风险8）
  - 会话窗口改为**沉浸式**：隐藏底部导航、自持滚动容器（否则 fixed 底栏会盖住输入区）；避让底栏改用 `--bottom-nav-height` token，去掉魔法数字 `pb-16`
  - 前端端到端验收脚本 `web/scripts/verify-chat.mjs`（无头 Edge + CDP，13 项断言全过）

- **Phase 1 · 切片三：API 方案管理 UI**（2026-09-23）
  - **方案权威源从环境变量换成服务端 SQLite**（`api_profile` / `api_secret` 两表；凭据独立成表，使「读方案」的路径不可能顺带读出密钥）。`HABITAT_LLM_PROFILES` 降级为**首次种子**（仅表为空时导入一次）
  - `LlmRegistry` 换成读 DB，**对外接口一字未改**；凭据优先级 **`stored` > `env`**（UI 可为环境变量方案补填密钥）
  - `db/profiles.ts` 仓储层：CRUD + 凭据 + `activate` 互斥 + 种子导入；删掉默认方案会自动顶上下一条
  - 五个新端点：`POST /api/providers`、`PATCH /:id`、`DELETE /:id`、`POST /:id/activate`、`PUT|DELETE /:id/secret`。**密钥只进不出**（没有任何端点回读它）
  - `shared`：`ApiProfilePublic` 加 `keySource`（`stored` / `env` / `missing` / `not-required`），消除 `hasKey` 的语义歧义
  - `web`：设置页「API 方案」区块（`features/providers/`）—— 列表 + 行内表单 + 测试连接 + 设为默认 + 两步删除；表单主路径只暴露四项，`keyRef` 收进「高级」
  - 验收：`server/scripts/probe-providers.ts`（46 项）+ `web/scripts/verify-providers.mjs`（22 项，连跑两次通过）

- **Phase 1 · 切片四：消息块分发 + 分页加载 + 重发 / 换一个**（2026-09-23）
  - `shared`：`MessageBlock` 从 `{ kind, payload: unknown }` 改成**可辨识联合**，8 种 kind 各定载荷契约（`text` / `html` / `image` / `audio` / `file` / `tool-result` / `widget` / `tab-group`），渲染器 switch 即收窄 payload
  - `web`：新增 `features/chat/MessageBlocks.tsx` —— 按 kind 分发；`text` / `image` / `audio` / `file` / `tool-result` 真渲染，`html` / `widget` / `tab-group` 明确占位（**html 不直接注入**，等沙箱方案），运行时未知 kind 降级占位不崩页
  - `web`：`VirtualList` 补 `onReachTop` 回调 + **向上插入的锚点补偿**（按 item key 定位锚点项还原 `scrollTop`，解决「prepend 后跳位」）；聊天页接 `listMessagesPage` 的 `before` 游标，滚到顶自动加载更早一页
  - `web`：`db/chat.ts` 补 `addVersion` / `selectCandidateVersion`（版本历史 + `blocks` 投影同步，超 `MAX_CANDIDATES` 淘汰最旧非展示项）；`ChatWindowPage` 抽出 `runGeneration` 供 发送 / 重发 / 换一个 复用，气泡下方给 `‹ n/N ›` 候选导航 + 「换一个」（末条 AI 回复）+「重发」（末条用户消息无回复时）
  - 验收：`verify-chat.mjs` 扩到 **35 项全过**（含块分发 8 种、分页 `3408 → 6934 → 7334` 且锚定后 `scrollTop=3840`、换一个记两个版本并可切回、重发新增一条回复）；`verify-providers.mjs` 回归 22 项通过

- **Phase 1 · 切片五（收尾）：诊断日志查询 + 设置页时间线**（2026-09-23）
  - `shared`：`McpDiagnosticEntry` / `McpDiagnosticQuery` / `McpDiagnosticPage`；`handshake` 筛选是**三态**（不传 / 仅握手 / 仅工具调用）
  - `server`：`GET /api/diagnostics/mcp`（`serverId` / `handshake` / `errorsOnly` / `limit` / `before`）—— 只读、字段**原样下发**；按 `id` 倒序、`limit+1` 判断 `hasMore`、`total` + `errorCount` 一次聚合；**游标不参与计数**，翻页时 `total` 不会越翻越小
  - `server`：补 `(server_id, id)` / `(handshake, id)` 索引 + `error IS NOT NULL` 部分索引；新增 `lib/errors.ts` 的 `RequestError`，让参数校验错误不再落成 500
  - `web`：设置页「诊断日志」时间线（`features/diagnostics/DiagnosticPanel.tsx`）—— 统计行 + 服务 / 阶段 / 只看错误三个筛选 + 「加载更早的记录」；筛选与翻页全交服务端
  - 验收：`server/scripts/probe-diagnostics.ts`（**48 项**，连跑两次通过）+ `web/scripts/verify-diagnostics.mjs`（**36 项**）

- **Phase 1 收尾补给：审查并修完一批未提交改动**（2026-09-23，T-008）
  - 审查抓到 **1 处阻断**（`main.ts` 导入不存在的 `pruneMcpDiagnostics` → 服务端启动即 `SyntaxError`）、**2 处编译错**（`toPublic` 缺 `streamOptions`；`addVersion(targetId)` 未收窄类型）、**2 处「看着做了、其实没做」**（`streamOptions` 只有列没人读、`app_kv` 表无生产者）
  - `streamOptions` **全链打通**（仓储四个读写点 + env 种子解析 + 脱敏视图 + 适配器按方案决定发不发 + 路由校验 + 表单开关）；验收断言的是**真实报文**（mock 上游新增 `GET /__last-body` 调试钩子）
  - `app_kv` 落地：`importProfiles` 判据换成持久标记，**删光方案重启不再让 env 种子复活**
  - 诊断保留策略补上实现：`pruneMcpDiagnostics`（保留最近 5000 条，走主键水位线），启动时裁一次
  - Node 版本约束机器化收尾：`.nvmrc` + `engines: "^20"` + `index.ts` 纯门禁（`main.ts` 装本体）；⚠️ 解析 `engines` **不能把 `<` 上界当允许值**（`>=20 <21` 会放行 Node 21）
  - `CORS_ORIGIN` 支持白名单（默认仍全开）、`.env.example` 补齐；`favicon` / Router future flags / 备份导出 / 流式草稿 / 撞毫秒漏条 / 删除确认 / 模块名单一来源 / 底栏高度实测 —— 这批待优化全部收口
  - 验收：`probe-diag-retention` **15/15**、`probe-llm` **32/32**、`probe-providers` **52/52**（空库与有方案各跑一次）、`probe-diagnostics` **48/48**、三条前端验收 **36 / 22 / 36** 全过
  - ⚠️ **编辑工具会偶发「报成功但没落盘」**：本轮有 4 次。改完关键处**必须 grep 回读**，别信返回消息

**Phase 1（Chat MVP）已完成**

- **Phase 2 · 第一批：留言板 / 愿望清单 / 倒数日**（2026-09-23）
  - `shared`：`Moment` / `WishlistItem` / `CountdownDay` 本地实体契约
  - `web`：Dexie v4 三表 + `db/home.ts` 仓储层；三个模块的新增 / 状态 / 二次确认删除 / 加载空态错误态
  - 备份升 v2 并保留 v1 导入兼容；`verify-home.mjs` 9/9
  - 交接复核同时修掉 `verify-chat.mjs` “新建会话路径”竞态，复验 36/36

- **Phase 2 · 第二批：日记 + 收藏**（2026-09-23）
  - `shared`：`Diary` + 统一 `Bookmark(targetType + targetId)` 契约；`web`：Dexie v5 两表与仓储层
  - 日记支持新增 / 编辑 / 二次确认删除；收藏先落外部链接入口，HTTP(S) 校验 + 复合唯一索引去重
  - 备份升 v3，保持 v1/v2 导入兼容并拒绝备份里的危险链接协议
  - 验收：`verify-home.mjs` 14/14，`verify-chat.mjs` 36/36

- **Phase 2 · 第三批：作品 + 相册**（2026-09-23）
  - `shared`：`Artwork` / `Photo` 契约；`web`：Dexie v6 两表与仓储层
  - 作品支持新增 / 编辑 / 二次确认删除与安全外链；相册保存真实图片，限 PNG / JPEG / WebP / GIF、单张 3 MB，并核对 base64 真实体积
  - 备份升 v4，保持 v1–v3 导入兼容；危险协议、非白名单 / 超限 / 体积不符图片在写库前拒绝
  - 验收：`verify-home.mjs` 18/18，`verify-chat.mjs` 36/36

- **Phase 2 · 第四批（收尾）：读书 + 音乐 + 学习**（2026-09-23）
  - `shared`：`ReadingNote` / `MusicTrack` / `StudyRecord`；`web`：Dexie v7 三表与仓储层
  - 三模块均支持新增 / 编辑 / 二次确认删除；音乐外链限 HTTP(S)，学习时长限 1–1440 分钟整数
  - 备份升 v5，十类 Home 数据原子恢复并保持 v1–v4 导入兼容
  - 验收：`verify-home.mjs` 23/23，`verify-chat.mjs` 36/36

**Phase 2（Home 生活模块）已完成**

**下一步**：Phase 3A 长期记忆接入（Nocturne，经 MCP Gateway 单通道）。

**本地验收方式**

- 三件套：`npm run dev:mock-mcp`（:3333）+ `npm run dev:server`（:3000）+ `npm run dev:web`（:5173）
- 验证 MCP 客户端链路：`npx tsx scripts/probe-mock.ts`（在 `server/` 下执行）
- 验证 LLM Adapter：`npm run dev:mock-openai`（:3334）+ `npx tsx scripts/probe-llm.ts`（32 项）
- 验证方案路由：起 mock 上游 + server 后 `npx tsx scripts/probe-providers.ts`（52 项断言）
- 验证诊断端点：起 server（自己指定 `HABITAT_DB_PATH`）后 `npx tsx scripts/probe-diagnostics.ts`（48 项断言）
- 验证诊断保留策略：`npx tsx scripts/probe-diag-retention.ts`（15 项断言，**自带一次性临时库，不需要 server**，也不碰真实记录）
- 端到端（前端）：`node web/scripts/verify-chat.mjs`（36 项）/ `node web/scripts/verify-providers.mjs`（22 项）/ `node web/scripts/verify-diagnostics.mjs`（36 项）/ `node web/scripts/verify-home.mjs`（23 项）（前置条件见各自文件头注释）
- ⚠️ **`verify-diagnostics.mjs` 要用 Node ≥ 22 跑**：它用内置 `WebSocket` 驱动 CDP、用内置 `node:sqlite` 写 fixture（刻意避开 `better-sqlite3` —— 那是 Node 20 的 ABI）
- ⚠️ **跑 `server` 必须用 Node 20**：`better-sqlite3` 原生模块的 ABI 与安装时的 Node 绑定，
  用其它版本会 `ERR_DLOPEN_FAILED`（详见 `README.md` 环境要求）
- ⚠️ **端到端验收务必换端口**（例如 server 3200 / vite 5274 / CDP 9333），别复用你正在跑的实例 ——
  验收会重建数据库文件，在跑的那个进程会握着一个「幽灵文件」，读写全对不上
- ⚠️ **起 vite 加 `--host 127.0.0.1`**：默认 `localhost` 在 Windows 上解析到 `::1`，脚本用 `127.0.0.1` 会连不上（症状：`curl` 返回 `000`，而 vite 日志写着 listening）
- ⚠️ **后台进程在同一终端命令结束后会被回收**：起 mock / server 与执行验收脚本要写在同一条命令里；
  整条流水线较长时用「后台任务 + 输出落日志文件」，再另开命令 tail，别硬塞进一条前台命令（会被超时杀掉且输出全丢）

**维护约定**

- **每完成一次任务 → 先按顺序追加 `docs/TASKS.md` 一条记录**（已完成 + 待优化），再进入下一进程
- 每完成一个 Phase → 更新本文档 §6 + 追加 `docs/CHANGELOG.md`
- 每新增一个外部参考项目 → 补进 `docs/REFERENCES.md`
- 新增 / 修改接口 → 同步 `docs/API.md`
- 架构有变更 → **先改技术方案**，再同步本文档
