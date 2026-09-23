# MEMORY · 记忆系统接入

状态：**Phase 3A 施工中**。本地 mock 全链探针 24/24；客户端代码已用官方只读 Demo 打真实 server 验真（25/25，见 `docs/TASKS.md` T-013）；
**自部署实例已体检但未接**（T-022，2026-09-23）—— 进程活着、443 证书正常，但 **`/mcp` 被最外层 nginx 单独挡在门外**，链路仍不通，另有**鉴权缺失**待处理。

对接对象：已部署的 Nocturne（MCP，SSE / Streamable HTTP）。
职责边界：世界书 = 永远注入的设定；Nocturne = 按需召回的经历；AI 日记 = AI 自己的生活记录。

## 通道约定（铁律，不可绕）

- **MCP 是唯一通道**：`MemoryProvider` → `ToolGateway` → MCP。**不走 Nocturne 的 REST**（仅 Dashboard 直链与 `/health` 探测例外，见技术方案 §7.1 与 `AGENTS.md` §3 铁律 4）。
- 配置全在环境变量，**地址与凭据不进仓库**（`server/src/mcp/registry.ts`）：
  `MCP_NOCTURNE_URL` / `MCP_NOCTURNE_TOKEN` / `MCP_NOCTURNE_NAMESPACE`
  （多 AI 共用同一实例时用 namespace 隔离；单人格留空）。
- **前端永不直连 Nocturne** —— 只走 `server` 的 `/api/memory/*`。

## 已验证的真实协议事实（T-013 · 2026-09-23）

来源：Nocturne 官方只读 Demo `https://misaligned.top/mcp` —— 官方声明为**只读模式，仅开放 `read_memory` 与 `search_memory`**，所以「不写入外部数据」由服务端物理保证。全部经我们自己的 `McpGateway` 实跑。

| 项 | 实测值 |
| --- | --- |
| 传输 | **Streamable HTTP**，`initialize` 正常下发 `mcp-session-id`（确认不是 SSE 降级） |
| serverInfo | `Nocturne Memory Interface` v1.26.0 |
| 协商协议版本 | `2025-06-18` |
| 官方工具全量 | 7 个：`read_memory` / `create_memory` / `update_memory` / `delete_memory` / `add_alias` / `manage_triggers` / `search_memory` |
| `read_memory` 入参 | `uri` |
| `search_memory` 入参 | `query`、`domain`、`limit` —— 与 `MemorySearchOptions` **逐字对上** |
| 握手耗时 | 公网 Demo 2.2–4.6s（同机自部署可忽略） |

**只读视图**（走 `read_memory` 的 uri）：`system://boot`（启动身份）/ `system://index/<domain>` / `system://recent` / `system://glossary` / `system://diagnostic/<domain>`。

⚠️ **`update_memory` 刻意没有全量替换**（只有 Patch / Append），且更新与删除都要求**先读全文**。适配层 `NocturneMemoryProvider` 已在 `update()` / `delete()` 里强制先 `read()` —— 调用方不必自己记这条前置条件。
⚠️ **不依赖它的内部 schema**（对齐 §9 风险 5）：Nocturne 工具返回的是**面向模型的文本**，适配层只抽取 text 块（`textFromToolResult`），不解析其库结构。
⚠️ **文本型 `Error:` 会被识别成失败** —— 工具返回 `isError` 或正文以 `Error:` 开头时抛 `MCP_TOOL_CALL_FAILED`，不让错误伪装成成功。

## 复验方式

| 验什么 | 命令 | 结果 |
| --- | --- | --- |
| 客户端代码（打**真实** server，只读） | `cd server && npx tsx scripts/probe-nocturne-demo.ts` | 25/25 |
| 本地全链（mock，**含写路径**） | 起 `dev:mock-mcp` + `dev:server` 后 `npx tsx scripts/probe-memory.ts` | 24/24 |
| **自部署实例**（Token / Namespace / 反代） | `cd server && MCP_NOCTURNE_URL=https://beiyan.cc/mcp MCP_NOCTURNE_TOKEN=… npx tsx scripts/probe-nocturne-live.ts` | ⛔ **受阻**（见下） |

⚠️ 第 1、3 条依赖公网可达，属**专项验证**（换环境时当连通性体检用），不并入常规回归。
⚠️ 第 3 条**必须先修好反代**（见下），否则它只会如实报一个 404 加一句「反代缺 location」。

## 自部署实例体检（T-022 · 2026-09-23）

**目标**：`https://beiyan.cc`（阿里云 ECS `120.27.247.75`）。**结论：进程都好，卡在反代。**

| 段 | 结论 |
| --- | --- |
| DNS | ✅ 直连 origin（Cloudflare 代理未启用或灰云） |
| 443 TLS | ✅ 握手正常，证书链完整（`beiyan.cc ← LE YR1 ← Root YR ← ISRG Root X1`） |
| 80 HTTP | ❌ **阿里云按 Host 头拦未备案域名**（返回 `Non-compliance ICP Filing`）；裸 IP 时 nginx 正常 301 |
| Nocturne 进程 | ✅ `/health` = `{"status":"ok","buckets":12,"decay_engine":"running"}`；`/dashboard` = 夜曲面板 200 |
| MCP 路径 | ❌ **`/mcp` 被单独拦下**：`GET` / `POST initialize` 均得 **nginx 默认 404 HTML**（署名 `nginx/1.18.0 (Ubuntu)`） |

### 定位依据（两种 404 不是同一个东西回的）

| 路径 | 结果 | 含义 |
| --- | --- | --- |
| `/health/`、`/dashboard/` | **307** | FastAPI 的 `redirect_slashes` —— 请求已**穿透到 Python 后端** |
| `/zzz-*`、`/index.html`、`/favicon.ico`、`/assets/`、`/docs` | 404 **纯文本 9 字节** `Not Found` | Starlette 默认 404 —— **同样来自后端** |
| `/mcp`、`/mcp/` | 404 **HTML 162 字节** | **nginx 默认 404 页** —— 与上面**不是同一个东西**在回话 |

结论：最外层 nginx 对绝大多数路径是**通配转发到后端**的，**唯独 `/mcp` 被单独拦下**，连后端都没碰到。
所以「补 `/mcp` 转发」的正确做法不是新增一条 location，而是**找到那条把它挡在外面的规则并删掉/取代**。

⭐ 另一条重要事实：Nocturne **上游默认配置已经把 `/mcp` 配好了**（`frontend/nginx.conf` 里 `location /mcp`
→ `backend:8233/mcp`，且 `proxy_buffering off` / `proxy_http_version 1.1` / `proxy_read_timeout 86400s` /
`add_header X-Accel-Buffering no` 一应俱全）。**两层 nginx 里，容器那层是齐的，缺的是宿主那层。**
→ 完整拓扑与操作流程见 `docs/DEPLOYMENT.md`。

### 反代配置要点（待北北在服务器上补）

**别只加一行 `proxy_pass`** —— MCP 的 Streamable HTTP 是**流式**的，nginx 默认会把响应缓冲住，
表现为「握手过了但事件不推 / 连接假死」。location 里至少要带上 `proxy_buffering off`、`proxy_cache off`、
`proxy_http_version 1.1`、加大 `proxy_read_timeout`、`chunked_transfer_encoding off`、`add_header X-Accel-Buffering no`。
（上游 `frontend/nginx.conf` 里那一段可以**直接照抄**，见 `docs/DEPLOYMENT.md` §3。）

### 两个未结风险

1. 🔴 **该实例没有任何鉴权层** —— `/health`、`/dashboard`、`/api/*` 全部**无凭据 200**，且带 `access-control-allow-origin: *`。
   dashboard 页面里可枚举约 30 个接口，含 `/api/buckets`、`/api/search`、`/api/config`、`/api/import/upload`
   （最后这个**从路径名看是写操作，没有实测**）。
   → 记忆库当前对公网开放，需加一层鉴权（反代 basic auth / Cloudflare Access / 限制来源）。
   ⚠️ 体检只做到**状态码级**，没有读取任何记忆内容。
2. ⚠️ **TLS 客户端分界线**：带 `SNI=beiyan.cc` 时 **Node 20 连续 6/6 `ECONNRESET`**，Node 22 与 openssl 3.5.7 均 6/6 通过；
   不带 SNI（裸 IP）时两个版本都通；换 9 组 TLS 参数全无效。
   ✅ **已由北北在沙箱外的终端复核确认**（同报 `ERR ECONNRESET`），排除本地出口代理干扰，是真实现象。
   机制疑似链路层 DPI 针对 OpenSSL 3.0.x 的 ClientHello，未最终证实。
   **影响面**：仅「在**本机**用 Node 20 的 server 连**公网** beiyan.cc」；生产为同机内网直连，**不受影响**。
   本地开发连远程实例这条路暂时不通 —— 走 `probe-nocturne-demo.ts` 或 `dev:mock-mcp`，端到端联调放服务器上做。
