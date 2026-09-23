# 栖息地（habitat）· AI 工作入口

> **做任何任务前，先读本文件。除非任务明确涉及，否则不得主动读取 §2 中其他文档。** 它只放「去哪找、该干嘛、参考谁」的指针，**不复制正文**。  
> 需要细节时再按文中指针去读对应文档 —— **不要一上来就通读技术方案**。
>只读取当前任务命中的章节，不得通读整个技术方案。
> 文件分工：**本文件 = 地图**（每次必读，短）｜`docs/REFERENCES.md` = 外部参考项目库（仅在当前任务需要借鉴具体实现时查阅；仅查与当前任务直接相关的项目。）  
> 任务完成后立即停止。不得自行扩展需求、重构无关代码、继续优化或执行下一阶段任务。若发现超出当前任务范围的问题，写进 `docs/TASKS.md` 的待优化清单，不擅自处理。
> 最后更新：2026-09-22

---

## 0. 怎么用这份文件

固定动作，四步：

1. 读 **§1 速览**（项目现状）+ **§3 铁律**（不可违反）
2. 到 **§4** 查你的任务 → 拿到「必读文档」+「参考项目」
3. 动手前扫一眼 **§5** 的坑
4. 收尾：**先按顺序追加 `docs/TASKS.md` 一条任务记录**（已完成 + 待优化），再回 **§6** 更新进度；干完一个 Phase 还要追加 `docs/CHANGELOG.md`

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
| 当前阶段 | **Phase 1 进行中**：Chat MVP 四切片（OpenAI 兼容层 / SSE 聊天链路 / API 方案管理 / 消息块分发·分页·重发换一个）已落地并验收；下一步诊断日志查看页 |
| 关键判断 | **必须有常驻后端** —— 唤醒、独处时光、通知、账本、MCP 聚合在纯前端做不了                                                    |

**阶段路线**：P0 基座可视化 → **P1 Chat MVP（最优先）** → P2 Home 生活模块 → P3A 记忆（Nocturne）→ P3B 状态（Eventide）→ P4 Life → P5 高级能力 → P6 打磨

**目录结构**

```
habitat/
├── AGENTS.md                    ← 本文件（AI 工作入口）
├── 栖息地初版技术方案分析.md      ← ★ 施工依据（唯一权威，v1.1）
├── docs/                        ← 项目文档（UI_DESIGN / REFERENCES / 各专题）
├── shared/                      ← 前后端共享类型、Provider 接口、SSE 协议、错误码
├── web/                         ← React SPA（app/ pages/ features/ components/ db/ theme/ providers/ lib/）
└── server/                      ← Fastify（routes/ context/ providers/ mcp/ jobs/ db/ lib/）
```

**边界铁律**：后端是唯一对外出口 —— 前端不直连 LLM / 不参与 MCP 握手 / 不直连 Nocturne、Eventide。

**常用命令**（完整 SOP 见 `README.md`）：  
`setup` 安装依赖 ｜ `dev:server` → :3000 ｜ `dev:web` → :5173（/api 已代理）｜ `typecheck` 两端类型检查 ｜ `build` 前端构建

---

## 2. 权威文档地图

| 文档                        | 管什么                                                                             | 什么时候读                                |
| ------------------------- | ------------------------------------------------------------------------------- | ------------------------------------ |
| `栖息地初版技术方案分析.md`          | **★ 施工依据**：架构 / 技术选型 / 数据模型 / Provider 设计 / 部署拓扑 / 风险对策                         | 需要架构决策或具体设计时，**按章节读**（见 §4）          |
| `docs/UI_DESIGN.md`       | 视觉语言（色彩 / 字体 / 圆角 / 间距 / 动效 / Safe Area）                                        | 做任何 UI 前。⚠️ **内容待北北补充，补充前一律只做简单 UI** |
| `docs/栖息地_UI参考资料_v1.0.md` | ChatGPT Mobile UI 参考 + 栖息地 UI 原则 / 首页方向 / 欢迎语料库 / **给 Coding Agent 的 10 条实现要求** | 做任何 UI 前，与 `UI_DESIGN.md` 一起读        |
| `docs/REFERENCES.md`      | 外部参考项目库（本项目之外的 GitHub 项目）                                                       | §4 命中任务时按需查                          |
| `docs/API.md`             | 接口约定                                                                            | 加 / 改接口时同步（现：健康 2 + 聊天 1 + 方案 9）          |
| `docs/DATA_MODEL.md`      | 数据模型                                                                            | 建模时（占位中，以技术方案 §6 为准）                 |
| `docs/MCP.md`             | 工具层与 Gateway                                                                    | 动 MCP 时                              |
| `docs/MEMORY.md`          | 记忆系统接入                                                                          | Phase 3A 时                           |
| `docs/DEPLOYMENT.md`      | 部署                                                                              | 部署时（占位中）                             |
| `docs/CHANGELOG.md`       | 变更记录（按 Phase，面向版本）                                                             | **每完成一个 Phase 追加**                   |
| `docs/TASKS.md`           | **任务记录 + 待优化清单**（面向推进）｜所有「本次没做、以后要做」的问题都收敛在这 | **每次任务收尾必读必写**                      |
| `README.md`               | 对外说明 + 本地启动 SOP                                                                 | 首次搭环境                                |

> 原 `ARCHITECTURE.md` / `PROJECT_PLAN.md` / `UI.md` 三个纯占位文件已并入本表（内容均为「以技术方案为准」），不再单列。  
> 其余多为占位，**真正的权威只有「技术方案」+「UI_DESIGN」两份**。



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

---

## 4. 按任务查（核心速查表）

| 我要做…                   | 必读                                                        | 参考项目（详见 `docs/REFERENCES.md`）                                       |
| ---------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| Chat 页面 / 消息模型 / 流式    | 技术方案 §7.2① / §8 / §6.3；接口契约见 `docs/API.md`                | chatnest、the-house、Pando、CC Companion App                           |
| 聊天消息建表（版本 / 多候选）       | 技术方案 §6.3 ✅ 已建好；「换一个 / 切回上一版」已接（`db/chat.ts` 的 `addVersion` / `selectCandidateVersion`） | —                                                                   |
| 消息块渲染（`MessageBlock.kind`） | 技术方案 §6.2；载荷契约见 `shared/types.ts`，渲染分发见 `web/src/features/chat/MessageBlocks.tsx` | —                                                                   |
| 多 Provider / API 方案管理  | 技术方案 §7.1 / §7.2① / §6.2（ApiProfile）                    | OmniRouter、VCPToolBox                                               |
| MCP Gateway / 诊断日志     | 技术方案 §7.2② / §9 风险1                                       | amap-mcp-server、VCPToolBox                                          |
| 长期记忆接入                 | 技术方案 §7.1 / §9 风险1·5                                      | nocturne_memory(已定)、Paramecium、Ombre-Brain、kiwi-mem                 |
| 世界书 / 角色设定             | 技术方案 §6.2                                                 | character-card-spec-v2/v3、KI-CO                                     |
| 状态系统 / 情绪              | 技术方案 §0.1-4 / §7.2③ / §9 风险4·6                            | Eventide(已定)、**Drivesoid**、Tidefall、jiwen                           |
| 主动唤醒 / 独处时光            | 技术方案 §7.2③ / §9 风险6                                       | Headlong、AI Companion Runtime、WrenWen、astrbot_plugin_proactive_chat |
| Home 生活模块              | 技术方案 §8                                                   | Journal、shared-page、dwell-on-something、memex                        |
| Life 统计 / 账本 / 通知      | 技术方案 §6.2                                                 | Phosphene、WORKKK                                                    |
| UI 页面 / 组件 / 主题 Tokens | 技术方案 §8 / `docs/UI_DESIGN.md` / `docs/栖息地_UI参考资料_v1.0.md` | —                                                                   |
| 部署 / 反代 / SSE          | 技术方案 §4 / §9 风险2·3                                        | Ocean、AionsHome、Not Fade Away、cloud-and-island                      |
| 导入导出 / 数据主权            | 技术方案 §9 风险7                                               | forge-reload、context-slim、chatgpt-exporter                          |
| 语音 / TTS（Phase 5）      | 技术方案 §7.1                                                 | voice-mcp、GPT-SoVITS、Callhome                                       |
| 感知（Phase 5+）           | —                                                         | Akari Pulse、gaze、cove-sensory-mcp                                   |

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

**Phase 1（Chat MVP）已完成**

**下一步**：Phase 2 · Home 生活模块（依据技术方案 §8）。动手前先扫一遍 `docs/TASKS.md` 的待优化清单。

**本地验收方式**

- 三件套：`npm run dev:mock-mcp`（:3333）+ `npm run dev:server`（:3000）+ `npm run dev:web`（:5173）
- 验证 MCP 客户端链路：`npx tsx scripts/probe-mock.ts`（在 `server/` 下执行）
- 验证 LLM Adapter：`npm run dev:mock-openai`（:3334）+ `npx tsx scripts/probe-llm.ts`
- 验证方案路由：起 mock 上游 + server 后 `npx tsx scripts/probe-providers.ts`（46 项断言）
- 验证诊断端点：起 server（自己指定 `HABITAT_DB_PATH`）后 `npx tsx scripts/probe-diagnostics.ts`（48 项断言）
- 端到端（前端）：`node web/scripts/verify-chat.mjs`（35 项）/ `node web/scripts/verify-providers.mjs`（22 项）/ `node web/scripts/verify-diagnostics.mjs`（36 项）（前置条件见各自文件头注释）
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
