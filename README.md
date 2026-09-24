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
- Python **3.9+**（仅 Phase 3B 的 Eventide sidecar；主前端/Node 后端仍可独立启动）

## 启动（开发）

```bash
npm run setup        # 首次：安装 web 与 server 依赖
npm run dev:server   # 终端 1 → http://localhost:3000（/api/health）
npm run dev:web      # 终端 2 → http://localhost:5173（/api 已代理到 server）
```

Phase 3B 状态内核另起一个无状态 Python sidecar（首次安装）：

```bash
python -m venv .workbuddy/eventide-venv
.workbuddy/eventide-venv/Scripts/python -m pip install -r eventide-sidecar/requirements.txt
.workbuddy/eventide-venv/Scripts/python -m uvicorn app:app --app-dir eventide-sidecar --host 127.0.0.1 --port 8234
```

然后在 `server/.env` 设置 `EVENTIDE_URL=http://127.0.0.1:8234`。Linux/macOS 的虚拟环境解释器路径改为
`.workbuddy/eventide-venv/bin/python`。

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
| `npx tsx scripts/probe-mock.ts` | mock MCP :3333 | MCP 会话生命周期（握手 + `tools/list` + GET SSE + DELETE，共 5 项） |
| `npx tsx scripts/probe-llm.ts` | mock 上游 :3334 | LLM 方案 / Adapter 全链（32 项） |
| `npx tsx scripts/probe-providers.ts` | mock 上游 + server（自定 `HABITAT_DB_PATH`） | 方案 CRUD / 密钥进出 / 参数校验（52 项） |
| `npx tsx scripts/probe-diagnostics.ts` | server（须与脚本用**同一个** `HABITAT_DB_PATH`） | 诊断查询端点（48 项） |
| `npx tsx scripts/probe-diag-retention.ts` | **不需要 server**（自带一次性临时库，跑完自删） | 诊断日志保留策略（15 项） |
| `npx tsx scripts/probe-memory.ts` | mock MCP + server | Phase 3A 记忆**只读**链路：`breath`(boot) / `trace`(search) 两路径、参数边界、已移除的写端点应 404、诊断留痕（21 项） |
| `npx tsx scripts/probe-nocturne-tools.ts` | **任何** Nocturne 实例（`MCP_NOCTURNE_URL`） | 工具面事实采集 / **漂移检测**：只握手 + `tools/list`，**不调用任何工具**；另有零依赖版 `.mjs` 与只要 `curl+python3` 的 `.sh` |
| `MCP_NOCTURNE_URL=… npx tsx scripts/probe-nocturne-live.ts` | **自己部署的实例** + 反代已转发 `/mcp-<密钥>` | 反向代理 / Bearer Token（含无凭据对照）/ `X-Namespace` / 工具面 / 只读纪律（真机 **26/26**；默认遮蔽秘密路径） |
| ~~`npx tsx scripts/probe-nocturne-demo.ts`~~ | ~~**公网**（Nocturne 官方只读 Demo）~~ | ⛔ **已废弃**（其工具面假设与自部署实例 0/2 命中，脚本已清空实现） |
| `npm run probe:eventide` | Eventide sidecar :8234；可选 `PROBE_SERVER` | 真实 Eventide revision / 建态 / 时间推进 / 并发串行 / SQLite 恢复 / 故障降级；配置 server 时共 19 项 |
| `npm run probe:chat-context` | mock OpenAI + server；注入态另需 Eventide | 读取 mock 收到的真实报文，验证状态卡顺序 / 历史不变 / 持久化；注入 7 项、降级 3 项 |
| `npm run probe:phase3b` | Eventide + mock OpenAI + 使用隔离 DB 的 server | Phase 3B 全链：结算 / 事件 / 梦境 / BudgetGuard / 唤醒 / 独处 / 通知 / 钱包（21 项） |
| `npm run probe:phase4` | mock OpenAI + 使用隔离 DB 的 server | Phase 4 全链：月历 / 补价 / 历史价格 / 钱包 / 通知 / 运行 / Push 降级（16 项） |
| `npm run probe:phase5` | mock OpenAI + 使用隔离 DB 的 server | Phase 5 媒体 / 工具 API：ASR、视觉描述、图片生成、TTS 音频流、上传大小与 MIME 拒绝、无 MCP 空态与非法工具调用（8 项） |
| `npm run probe:ai-runtime` | mock MCP + mock OpenAI + 使用隔离 DB 的 server | **Phase 6.5 AI 运行时**：能力快照 / 工具绑定白名单 / **工具调用闭环（成功与失败）** / `tool_calls` 协议回传 / `tools_list` 自我认知 / 状态摘要可读 / 不出现 `[object Object]`（50 项） |
| `npm run probe:diary` | 使用隔离 DB 的 server | **Phase 6.5 共同生活数据**：日记 / 留言板的**权限边界** —— 私密日记不下发正文、改删 AI 内容返回 404、拒绝 ≠ 删除、迁移入口幂等、排序与输入校验（40 项） |
| `npm run probe:event-inbox` | mock MCP + mock OpenAI + 使用隔离 DB 的 server | **Phase 6.5 事件收件箱 / 日记权限 / 日记·留言板工具**：confirm 工具**挂起不执行**、决策只能做一次、**用户不能替 AI 决定**、参数不合法不挂卡、结果只注入一次（66 项）。一键：`bash .workbuddy/run-p1-verify.sh` |

> `probe-ai-runtime.ts` 的前两节**不需要服务**（分片累加器、状态可读化、绑定白名单是纯逻辑），
> 后面才打 HTTP —— 所以哪怕 server 没起，也能先看纯逻辑那部分过不过。
> 它的 mock 上游场景由消息里的 `[[tool]]` / `[[tool:名字]]` / `[[tool:名字 {"k":"v"}]]` 触发，
> **不写标记就是普通聊天**，所以既有脚本不受影响。
> 带参数那种形式是 Phase 6.5 P1 加的 —— 写类工具（写日记 / 留言）的参数是必需的，
> 不能带参数就等于永远验不了它们。

> `probe-nocturne-live.ts` 读 `MCP_NOCTURNE_URL` / `MCP_NOCTURNE_TOKEN` / `MCP_NOCTURNE_NAMESPACE`（也可写进 `server/.env`），
> 默认**不打印**记忆正文（那是本人记忆），要看加 `NOCTURNE_PROBE_PREVIEW=1`。
> 默认也不打印完整 MCP 秘密路径；仅排障且确认终端输出安全时才设置 `NOCTURNE_SHOW_SECRET=1`。
> 握手失败时它会**先把报错翻译成「卡在哪一层」**（404 → 秘密路径没带对；401/403 → Token；`ECONNRESET` → 链路；证书 → 链不完整）。

### 端到端（前端，无头 Edge + CDP）

| 脚本 | 覆盖 |
| --- | --- |
| `node web/scripts/verify-chat.mjs` | 聊天链路 / 消息对象操作 / 跨模块收录 / 会话置顶与设置 / 会话分组 / 消息块分发 / 分页 / 候选版本 / 输入区快捷栏与请求回复拆开 / **安全 HTML（sandbox + CSP）· widget · tab-group** / **录音预览与真实转写** / **图片理解与生成** / **Mini Terminal 空态** / **气泡头像开关（全局偏好、刷新后仍记住）**（148 项） |
| `node web/scripts/verify-providers.mjs` | API 方案管理 UI（22 项） |
| `node web/scripts/verify-llm.mjs` | **Phase 6.5 P2 · 小栖档案（App Launcher）**：卡片与服务端能力快照**逐条比对**（不写死能力名）、可用状态一致、不可用必给原因、有界面的模块真能启动、没界面的不做假入口（16 项） |
| `node web/scripts/verify-diagnostics.mjs` | 诊断日志面板（36 项） |
| `node web/scripts/verify-home.mjs` | Home 十模块 + **主屏 Widget** + **收藏分类 / 相册分类** + 备份恢复（77 项，含备份 v8 的分类归属与旧版兼容） |
| `node web/scripts/verify-life.mjs` | Life 四视图、移动端布局、价格 / 钱包入口、Push 降级、运行状态（15 项） |
| `node web/scripts/verify-export.mjs` | 单会话导出（Markdown / JSON 回执带条数、不更新全量备份时间）、久未导出提醒、导入前覆盖警告（17 项） |
| `node web/scripts/verify-offline.mjs` | **真断网**下的只读边界：横幅、本地数据可读、联网动作禁用 / 撤下、工具面板区分「离线」与「未配 MCP」、恢复联网后还原（38 项） |
| `node web/scripts/verify-pwa.mjs` | PWA：manifest 与图标、SW 注册并激活、app shell 预缓存、断网开壳、`/api/` 不被兜底成 HTML（25 项，**须打生产构建**） |

各脚本的**准确前置条件**写在**各自文件头的注释**里，跑之前先看一眼。

组一六支（`home` / `chat` / `providers` / `llm` / `export` / `offline`）共用一套前置
（server:3100 + vite:5174 + CDP:9222），组二 `diagnostics` 另起一套（会重建库文件，端口错开），一键跑：

```bash
bash .workbuddy/run-front-verify.sh    # 日志 /tmp/front-verify.log
```

> ⚠️ **顺序有讲究**：`verify-home` **必须排最前**（它是唯一会清浏览器站点数据的那支），
> `verify-offline`（唯一会真断网的）**必须排最后**。改流水线顺序前先看脚本头部的注释。

> ⚠️ **别把两条流水线并发跑**。`verify-home` 每换一个 Home 子模块都做一次**整页导航**；
> 导航等待已单独放宽到 60s，但并行占用同一台机器仍会制造无意义的慢测与噪音。

### PWA

应用可装进主屏、断网也能打开外壳；**开发期不注册 Service Worker**（改了代码不生效），
所以 PWA 验收打的是**生产构建产物**，单独一条流水线：

```bash
bash .workbuddy/run-pwa-verify.sh      # build → vite preview:5284 → 无头 Edge CDP:9434；日志 /tmp/pwa-verify.log
```

端口刻意与上面那条错开（5284 / 9434 vs 5174 / 9222），两条可以并存。

- 更新策略是 **`prompt`**：新版本就绪时顶部弹一条提示，由用户决定何时刷新（静默更新会让正看页面的用户撞上已删除的懒加载 chunk）。
- 离线外壳与 Web Push **共用一个 Service Worker**：手写的 `public/web-push-sw.js` 通过 `workbox.importScripts` 并入 PWA 生成的 SW，
  不会互相顶掉。新增推送逻辑仍写在那一个文件里。
- 手机安装：用浏览器打开站点 →「添加到主屏幕」。iOS 走 `apple-touch-icon`（Safari 不认 manifest 图标）。

### ⚠️ 跑验收的硬前提

- **`server` 必须 Node 20**（`better-sqlite3` ABI 绑定）；而 **`verify-diagnostics.mjs` 反过来必须 Node ≥ 22**
  —— 它用内置 `WebSocket` 驱动 CDP、用内置 `node:sqlite` 写 fixture，刻意避开 `better-sqlite3`。
- **务必换端口**（例如 server 3200 / vite 5274 / CDP 9333），**别复用正在跑的实例** ——
  验收会重建数据库文件，在跑的进程会握着一个「幽灵文件」，读写全对不上。
- **起 vite 要加 `--host 127.0.0.1`**：Windows 上 `localhost` 会解析到 `::1`，脚本用 `127.0.0.1` 连不上
  （症状：`curl` 返回 `000`，而 vite 日志写着 listening）。
- **后台进程在同一终端命令结束后会被回收**：起 mock / server 与执行验收脚本要写在**同一条命令**里；
  整条流水线较长时用「后台任务 + 输出落日志文件」再另开命令 tail，别硬塞进一条前台命令（会被超时杀掉且输出全丢）。
- **`probe-nocturne-live.ts` 依赖公网可达**，不并入常规回归 —— 它的定位是「风险 1 专项验证 + 换环境时的连通性体检」。
  `probe-nocturne-demo.ts` **已废弃**（工具面假设是错的，脚本已清空实现）。
- **`verify-chat.mjs` 的语音条断言要求无头 Edge 带假麦克风**：起浏览器时须加
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`（`.workbuddy/run-front-verify.sh` 已带）。
  缺了这两个开关，`getUserMedia` 拿不到流，录音相关的断言会全线失败 —— 那是环境问题，不是功能坏了。
- **PWA 相关验收必须打生产构建产物**（`vite build` + `vite preview`）。dev 下不注册 Service Worker，
  在 dev server 上验「断网还能开壳」永远验不出来 —— 那不是功能坏了，是走错了路线。

服务端不会再等待 MCP 连通后才监听 HTTP：MCP 在后台连接、自检并重试。外部记忆服务故障时，健康接口与其它功能仍应先可用；
`/api/health/mcp` 会明确报告对应连接状态。

## 文档

全部文档的用途与阅读时机，见 **`AGENTS.md` §2 权威文档地图**。

- **施工依据（唯一权威）**：`栖息地初版技术方案分析.md`（v1.1）
- **外部参考项目库**：`docs/REFERENCES.md`
- **视觉语言**：`docs/UI_DESIGN.md`（待北北补充；**补充前一律只做简单 UI**）

## 备注

- `web` 已配置 `@shared` 别名指向 `shared/`；`server` 侧别名随首个共享类型落地时接通（tsx 支持 tsconfig paths）。
- 服务端生产构建与部署流程见 `docs/DEPLOYMENT.md`（已含实测拓扑：宿主 nginx + Nocturne 容器 nginx 两层、Nocturne 反代接入流程与现成片段、Node 20 TLS 分界线）。
