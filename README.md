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

## 文档

全部文档的用途与阅读时机，见 **`AGENTS.md` §2 权威文档地图**。

- **施工依据（唯一权威）**：`栖息地初版技术方案分析.md`（v1.1）
- **外部参考项目库**：`docs/REFERENCES.md`
- **视觉语言**：`docs/UI_DESIGN.md`（待北北补充；**补充前一律只做简单 UI**）

## 备注

- `web` 已配置 `@shared` 别名指向 `shared/`；`server` 侧别名随首个共享类型落地时接通（tsx 支持 tsconfig paths）。
- 服务端生产构建与部署流程在部署阶段细化，见 `docs/DEPLOYMENT.md`（待补充）。
