# TASKS · 任务记录与待优化清单

> **用途**：每完成一次任务，**先按顺序追加一条记录**，写清「已完成什么 + 还剩什么待优化」，然后再进入下一进程。
> **与 `docs/CHANGELOG.md` 的分工**：CHANGELOG 记「改了什么」（面向版本，按 Phase 组织）；本文件记「做到哪、还欠什么」（面向推进与排期）。
> **两条硬规矩**：① 已完成只写要点，正文链到 CHANGELOG，**不复制**；② **所有待优化一律收敛到本文件**，不许散落在对话、代码注释或临时文件里。
> 最后更新：2026-09-22

---

## 待优化清单（汇总）

做完就勾掉，并在下方对应任务记录里注明。

### 高 —— 影响正确性，容易踩

- [ ] **服务端不读 `.env`** —— `server/` 全链没有 dotenv / `--env-file`，但仓库里有 `.env.example`、`.gitignore` 又忽略 `.env`，形同虚设。后果：照着说明填了 `.env` 也不生效，环境变量必须每次写在前置命令行里。→ `dev` 脚本加 `--env-file=.env`，或引入 dotenv。
- [ ] **`web` 缺备份导出** —— 铁律 5 要求「版本化迁移 **+ 备份导出**」。现在 Dexie `version(1)` 迁移有了，但导出 / 导入入口为零；水合失败只能引导用户「清理站点数据」= 数据直接丢。→ Phase 1 在设置页补导出 / 导入。
- [ ] **聊天窗口避让底栏用的是魔法数字** —— `AppShell` 用 `pb-16` 给底部导航让位，导航高度或 Safe Area 一变就错位。→ 把导航高度提成 CSS 变量统一引用。

### 中 —— 体验与一致性

- [ ] **Home 子模块标题显示原始 key** —— `/home/board` 的标题渲染成 `Board`（对英文 key 做 `capitalize`），而入口列表里是「留言板」。→ 用同一份模块表反查中文名。
- [ ] **`favicon.ico` 404** —— 每个页面控制台一条红字。→ 放个 favicon，或声明空 data URI 的 `<link rel="icon">`。
- [ ] **React Router v7 future flag 警告** —— 控制台噪音。→ 显式开 `v7_startTransition` / `v7_relativeSplatPath`。
- [ ] **服务端 CORS 全开** —— `origin: true` 会反射任意来源。本地开发可接受，**上线前必须收紧到具体域名**。

### 低 —— 开发工具

- [ ] **mock MCP 的 GET / DELETE 分支取错 session id** —— `mock-server.ts` 的 POST 分支正确地读 `req.headers['mcp-session-id']`，但 GET / DELETE 分支读的是 `url.searchParams.get('sessionId')`；官方 SDK 明确是**发 header**（见 `node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js:427`）。后果：SSE 流与显式关会话两条路径必然 400（目前 Gateway 没用到，所以没暴露）。→ 统一改读 header。

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
