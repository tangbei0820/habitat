# 栖息地（habitat）

北北与小栖的个人 AI Companion 数字空间。个人自用、非商业。

> 🤖 **AI 动工请先读 [`AGENTS.md`](AGENTS.md)** —— 工作总入口（目录结构、文档地图、按任务速查表、工作铁律）。
> 当前进度以 `AGENTS.md` §6 为准。

## 环境要求

- Node.js **20.x**
  > ⚠️ `server` 依赖 `better-sqlite3`（原生模块），其二进制与**安装时**的 Node ABI 绑定。
  > 本仓库依赖是在 Node 20 下安装的，换用其它 Node 版本启动会报
  > `ERR_DLOPEN_FAILED / NODE_MODULE_VERSION`。真要用别的版本，得
  > `npm --prefix server install` 重装原生模块。
  >
  > 现在有机器可读的约束了：仓库根有 `.nvmrc`（`nvm use` 即可），`server/package.json` 声明了
  > `engines.node: "^20"`，且 `server/src/index.ts` 会在加载任何原生模块**之前**校验版本，
  > 版本不符时直接给一句人话再退出，而不是让 `ERR_DLOPEN_FAILED` 炸出栈。
  > 注意 `web` 侧不挑版本（`vite` 纯 JS）；只有 `server` 必须 Node 20。
- npm

## 启动（开发）

```bash
npm run setup        # 首次：安装 web 与 server 依赖
npm run dev:server   # 终端 1 → http://localhost:3000（/api/health）
npm run dev:web      # 终端 2 → http://localhost:5173（/api 已代理到 server）
```

## 常用命令

```bash
npm run typecheck    # 两端 TypeScript 严格类型检查
npm run build        # 前端生产构建
```

`server` 侧另有两个**开发用 mock 上游**（不需要真实密钥 / 真实服务）：

```bash
npm --prefix server run dev:mock-mcp      # :3333  mock MCP server（验证 MCP 客户端链路）
npm --prefix server run dev:mock-openai   # :3334  mock OpenAI 兼容上游（验证 LLM Adapter）
```

服务端环境变量见 `server/.env.example`；把 `server/.env` 建起来即可（该文件已被 gitignore）。

## 本地验收

先起开发用的 mock 上游（不需要真实密钥 / 真实服务）：

```bash
npm --prefix server run dev:mock-mcp      # :3333  mock MCP server
npm --prefix server run dev:mock-openai   # :3334  mock OpenAI 兼容上游
```

### 服务端探针（在 `server/` 下执行）

| 脚本 | 前置 | 覆盖 |
| --- | --- | --- |
| `npx tsx scripts/probe-mock.ts` | mock MCP :3333 | MCP 客户端连通自检（握手 + `tools/list`） |
| `npx tsx scripts/probe-llm.ts` | mock 上游 :3334 | LLM 方案 / Adapter 全链（32 项） |
| `npx tsx scripts/probe-providers.ts` | mock 上游 + server（自定 `HABITAT_DB_PATH`） | 方案 CRUD / 密钥进出 / 参数校验（52 项） |
| `npx tsx scripts/probe-diagnostics.ts` | server（须与脚本用**同一个** `HABITAT_DB_PATH`） | 诊断查询端点（48 项） |
| `npx tsx scripts/probe-diag-retention.ts` | **不需要 server**（自带一次性临时库，跑完自删） | 诊断日志保留策略（15 项） |
| `npx tsx scripts/probe-memory.ts` | mock MCP + server | Phase 3A 记忆链路、read-before-write、诊断留痕（24 项） |
| `npx tsx scripts/probe-nocturne-demo.ts` | **公网**（Nocturne 官方只读 Demo） | 真实 Streamable HTTP 握手 / 工具清单 / `system://boot`（25 项） |

### 端到端（前端，无头 Edge + CDP）

| 脚本 | 覆盖 |
| --- | --- |
| `node web/scripts/verify-chat.mjs` | 聊天链路 / 消息对象操作 / 跨模块收录 / 会话置顶与设置 / 消息块分发 / 分页 / 候选版本（84 项） |
| `node web/scripts/verify-providers.mjs` | API 方案管理 UI（22 项） |
| `node web/scripts/verify-diagnostics.mjs` | 诊断日志面板（36 项） |
| `node web/scripts/verify-home.mjs` | Home 十模块 + 备份恢复（23 项） |

各脚本的**准确前置条件**写在**各自文件头的注释**里，跑之前先看一眼。

### ⚠️ 跑验收的硬前提

- **`server` 必须 Node 20**（`better-sqlite3` ABI 绑定）；而 **`verify-diagnostics.mjs` 反过来必须 Node ≥ 22**
  —— 它用内置 `WebSocket` 驱动 CDP、用内置 `node:sqlite` 写 fixture，刻意避开 `better-sqlite3`。
- **务必换端口**（例如 server 3200 / vite 5274 / CDP 9333），**别复用正在跑的实例** ——
  验收会重建数据库文件，在跑的进程会握着一个「幽灵文件」，读写全对不上。
- **起 vite 要加 `--host 127.0.0.1`**：Windows 上 `localhost` 会解析到 `::1`，脚本用 `127.0.0.1` 连不上
  （症状：`curl` 返回 `000`，而 vite 日志写着 listening）。
- **后台进程在同一终端命令结束后会被回收**：起 mock / server 与执行验收脚本要写在**同一条命令**里；
  整条流水线较长时用「后台任务 + 输出落日志文件」再另开命令 tail，别硬塞进一条前台命令（会被超时杀掉且输出全丢）。
- **`probe-nocturne-demo.ts` 依赖公网**，不并入常规回归 —— 它的定位是「风险 1 专项验证 + 换环境时的连通性体检」。

## 文档

全部文档的用途与阅读时机，见 **`AGENTS.md` §2 权威文档地图**。

- **施工依据（唯一权威）**：`栖息地初版技术方案分析.md`（v1.1）
- **外部参考项目库**：`docs/REFERENCES.md`
- **视觉语言**：`docs/UI_DESIGN.md`（待北北补充；**补充前一律只做简单 UI**）

## 备注

- `web` 已配置 `@shared` 别名指向 `shared/`；`server` 侧别名随首个共享类型落地时接通（tsx 支持 tsconfig paths）。
- 服务端生产构建与部署流程在部署阶段细化，见 `docs/DEPLOYMENT.md`（待补充）。
