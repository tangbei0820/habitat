# CHANGELOG · 变更记录

## 2026-09-22

### Phase 0 · 骨架

- 建立空项目骨架：`web/`（React SPA / Vite / TS strict）、`server/`（Fastify / TS strict）、`shared/`、`docs/`（九件套 + UI_DESIGN.md 骨架）。
- 唯一端点 `GET /api/health`；`@shared` 别名已在 `web` 配置。
- 文档收口：新增 `AGENTS.md`（AI 工作入口）与 `docs/REFERENCES.md`（外部参考库）；删除 `ARCHITECTURE` / `PROJECT_PLAN` / `UI` 三个纯占位文件。

### Phase 0 · 可视化三件套 + MCP Gateway 最小可用

**shared**

- `types.ts`：统一基座 `BaseObject` + `ChatSession` / `ChatMessage`（含 `MessageBlock`、`MessageCandidate` 版本/多候选，§6.3 提前量）；后端健康类型。
- `errors.ts`：统一错误码与 `ApiError` 形状；`events.ts`：SSE 协议占位；`providers.ts`：`ToolGateway` 等 Provider 接口。

**web**

- 路由：`/chat`（列表 + `/chat/:sessionId` 窗口）、`/home`（+ `/home/:module`）、`/llm`、`/life`、`/setting`；`/` 与未知路径重定向到 `/chat`。
- `AppShell`（移动端优先 + SafeArea）+ `BottomNav`（五 Tab）。
- 本地数据层 `db.ts`：Dexie `version(1)` 建 `sessions` / `messages` 两表；启动 `HydrationGate`，水合失败即拦截用户（铁律 5）。
- 主题系统：`theme/tokens.css` 深浅两套 CSS 变量 + `useTheme`（zustand persist），切换即时生效并跨刷新保持。
- 设置页接通真实后端状态（`/api/health`、`/api/health/mcp`）。

**server**

- `GET /api/health`、`GET /api/health/mcp`；统一错误映射（业务错误 → `ApiError` 形状）。
- `McpGateway`：官方 SDK `StreamableHTTPClientTransport`，每 server 一个状态机（`disconnected → connecting → handshake → ready/error`）；启动连接失败不阻塞服务。
- SQLite（better-sqlite3 + Drizzle）+ `mcp_diagnostic_log` 表：握手与每次工具调用全量留痕。
- `src/mcp/mock-server.ts`：零额外依赖的 mock MCP server（:3333，`echo` 工具），用于先验证客户端代码再排真实链路（§9 风险 1）。

**修复**

- `useTheme`：原先裸读 `localStorage.getItem('habitat-theme')`，而 zustand `persist` 存的是 `{"state":{"mode":…}}` 包裹结构，导致**刷新后 `data-theme` 变成乱码字符串、深色模式静默失效**。改为 `onRehydrateStorage` + store 订阅单向同步 DOM，`mode` 与 DOM 属性永不脱钩。
- `.gitignore` 补 `server/data/*`（本地 SQLite 数据文件此前会被提交）。

**验收**

- `npm run typecheck` 两端通过；`npm run build` 通过。
- 无头浏览器实测（Edge + CDP）：五路由与 Home 子模块均正常渲染、底部导航高亮正确、深浅主题切换并刷新后保持、新建会话落库并在刷新后仍在列表、聊天窗口发送占位提示正常；控制台零异常（仅 favicon 404）。
