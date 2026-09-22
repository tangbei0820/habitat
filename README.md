# 栖息地（habitat）

北北与小栖的个人 AI Companion 数字空间。

> 当前状态：**Phase 0 空项目骨架**——可启动、可类型检查，尚无业务功能。

## 目录结构

```
habitat/
├── web/      React SPA（Vite + TypeScript strict）
├── server/   Fastify 常驻服务（TypeScript strict）
├── shared/   前后端共享类型与 Provider 接口（待填充）
├── docs/     项目文档（九件套 + UI_DESIGN.md）
└── 栖息地初版技术方案分析.md   技术方案（v1.1）
```

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

- 技术方案分析：`栖息地初版技术方案分析.md`（仓库根，施工依据）
- 视觉语言：`docs/UI_DESIGN.md`（待北北补充；**补充前一律只做简单 UI**）

## 备注

- `web` 已配置 `@shared` 别名指向 `shared/`；`server` 侧别名随首个共享类型落地时接通（tsx 支持 tsconfig paths）。
- 服务端生产构建与部署流程在部署阶段细化，见 `docs/DEPLOYMENT.md`（待补充）。
