# 栖息地（habitat）

北北与小栖的个人 AI Companion 数字空间。个人自用、非商业。

> 🤖 **AI 动工请先读 [`AGENTS.md`](AGENTS.md)** —— 工作总入口（目录结构、文档地图、按任务速查表、工作铁律）。
> 当前进度以 `AGENTS.md` §6 为准。

## 环境要求

- Node.js ≥ 20
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

## 文档

全部文档的用途与阅读时机，见 **`AGENTS.md` §2 权威文档地图**。

- **施工依据（唯一权威）**：`栖息地初版技术方案分析.md`（v1.1）
- **外部参考项目库**：`docs/REFERENCES.md`
- **视觉语言**：`docs/UI_DESIGN.md`（待北北补充；**补充前一律只做简单 UI**）

## 备注

- `web` 已配置 `@shared` 别名指向 `shared/`；`server` 侧别名随首个共享类型落地时接通（tsx 支持 tsconfig paths）。
- 服务端生产构建与部署流程在部署阶段细化，见 `docs/DEPLOYMENT.md`（待补充）。
