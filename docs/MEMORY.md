# MEMORY · 记忆系统接入

状态：**Phase 3A 施工中**。本地 mock 全链探针 24/24；客户端代码已用官方只读 Demo 打真实 server 验真（25/25，见 `docs/TASKS.md` T-013）。

自部署实例（2026-09-24 更正）：
- ✅ 进程、证书、DNS 都好；**`/mcp` 的 404 不是故障，是当初有意加固**（T-022 误判为反代缺陷）→ 真正入口是**秘密路径**，见下「入口地址」。
- ⛔ 另有一个**比反代更前置**的拦路虎：适配层**写死**的工具名（取自官方 Demo）与该实例**实际工具面**可能完全对不上 → 见下「自部署实例的工具面」。
- 🔴 **鉴权缺失**仍未处理（`/health`、`/dashboard`、`/api/*` 无凭据 200），见 T-022 风险 1。

对接对象：已部署的 Nocturne（MCP，SSE / Streamable HTTP）。
职责边界：世界书 = 永远注入的设定；Nocturne = 按需召回的经历；AI 日记 = AI 自己的生活记录。

## 通道约定（铁律，不可绕）

- **MCP 是唯一通道**：`MemoryProvider` → `ToolGateway` → MCP。**不走 Nocturne 的 REST**（仅 Dashboard 直链与 `/health` 探测例外，见技术方案 §7.1 与 `AGENTS.md` §3 铁律 4）。
- 配置全在环境变量，**地址与凭据不进仓库**（`server/src/mcp/registry.ts`）：
  `MCP_NOCTURNE_URL` / `MCP_NOCTURNE_TOKEN` / `MCP_NOCTURNE_NAMESPACE`
  （多 AI 共用同一实例时用 namespace 隔离；单人格留空）。
- **前端永不直连 Nocturne** —— 只走 `server` 的 `/api/memory/*`。

## 入口地址：秘密路径（**不是** `/mcp`）

⚠️ **`https://beiyan.cc/mcp` 返回 404 是「设计如此」，不是反代坏了。**

部署时对 MCP 做了一层加固：公开的 `/mcp` 一律 404，**只有知道一串密钥的人才能进**。
访问控制就是「路径 = 密码」，所以这个实例**不需要** Bearer Token（`MCP_NOCTURNE_TOKEN` 留空）。

| 项 | 值 |
| --- | --- |
| 公开路径 | `https://beiyan.cc/mcp` → **404**（nginx：`location = /mcp { return 404; }`） |
| **实际入口** | `https://beiyan.cc/mcp-<32位十六进制密钥>` → nginx 改写成 `/mcp` 转给容器 |
| 配置证据 | 北北本机 `MCP接入说明_Nocturne.md` + `.mcp_hardening.json`（均为 2026-09-13，后者含 nginx 片段原文） |
| 密钥形态 | `mcp-` + 32 位小写十六进制；**完整值不进仓库**（写在 `server/.env`，该文件已被 .gitignore） |

所以服务端配置就一行：

```bash
# server/.env
MCP_NOCTURNE_URL=https://beiyan.cc/mcp-<密钥>
MCP_NOCTURNE_TOKEN=        # 留空 —— 访问控制走秘密路径，不走 Bearer
```

**在服务器上确认加固是否还在**：

```bash
sudo grep -rn "location.*mcp" /etc/nginx/sites-enabled/
```

- 看到 `location = /mcp { return 404; }` **且**有 `location = /mcp-<密钥>` → 加固还在，填秘密路径即可，**不用动服务器**。
- 只看到 `location /` → 加固被后来的配置覆盖了，按 `docs/DEPLOYMENT.md` §3 重新加回去。

**换密钥**：把 `location = /mcp-旧密钥 {` 改成新密钥（`proxy_pass` 那行不动）→ `sudo nginx -t && sudo systemctl reload nginx`，旧 URL 立刻 404。

> 为什么用秘密路径而不是 Bearer / Basic Auth：秘密路径对客户端**零要求**（只填 URL），兼容性最好；
> 部分客户端遇到 401 会误触发 OAuth 流程而连不上。两者可叠加，不冲突。

## 自部署实例的工具面 —— 比反代更前置的拦路虎（2026-09-24 发现）

**适配层假设的工具名源自「官方只读 Demo」，而北北部署的是另一个血统。**

| 来源 | serverInfo | 工具名 |
| --- | --- | --- |
| 官方只读 Demo（T-013 实测 · `misaligned.top`） | `Nocturne Memory Interface` v1.26.0 | `read_memory` / `search_memory` / `create_memory` / `update_memory` / `delete_memory` / `add_alias` / `manage_triggers` |
| **北北自部署实例**（部署记录 2026-09-13） | 自称 **Ombre Brain v1.30.0** | `breath` / `hold` / `trace` / `wander` / `wander_mark` / `drive` / `undercurrent` / `trail_delta` / `trail_family` |

`server/src/providers/nocturne-memory.ts` 把 5 个工具名**写死**在代码里。若实例工具面确如上表第二行：

- 链路修通之后，`recall()` / `search()` 会直接报 `MCP_TOOL_CALL_FAILED`（工具不存在）；
- **这不是「改几个字符串」** —— 数据模型都不一样：
  适配层假设的是 **URI 树**（`system://boot`、`parent_uri`、`old_string`/`new_string` 补丁、read-before-update），
  实例实际是 **记忆抽屉 + 关键词轨迹 + Trail 家族 + 九维驱动**（`hold` 用 `kind` 区分 memory/feel/writing/unresolved/window/letter）。

**先拿一手事实，再谈怎么改** —— 侦察脚本（**不假设任何工具名**，且**不调用任何工具**）：

```bash
# 【开发机】有仓库 + tsx
cd server
MCP_NOCTURNE_URL='https://beiyan.cc/mcp-<密钥>' npx tsx scripts/probe-nocturne-tools.ts

# 【服务器】仓库还没同步过去时用这个：零依赖单文件，Node 18+ 直接跑，什么都不用装
node probe-nocturne-tools-standalone.mjs http://127.0.0.1:8000/mcp
```

它会打印 serverInfo / 会话 id / 能力声明，以及**每个工具的名字 + 说明 + 参数 + 必填**，
并把「适配层写死的 5 个名字」与「实例真实有的名字」逐条对照。
（`NOCTURNE_SHOW_SECRET=1` 才会完整打印密钥路径，默认打码，防截图外泄。）

> **两个脚本输出口径一致**，随便用哪个；`.mjs` 那个只是为了在「没有仓库的机器」上也能跑。
> **在服务器上跑还有两个额外好处**：① 走**内网直连** `http://127.0.0.1:8000/mcp`
> —— 加固只做在 nginx 那层，容器里就是朴素的 `/mcp`，**连密钥路径都不用填**；
> ② 绕开「本机 Node 20 带 SNI 连 `beiyan.cc` 会 `ECONNRESET`」那个坑。

拿到输出后的**大致**映射（**待实例 schema 确认**）：

| 适配层方法 | 现在期望的工具 | 若是 Ombre Brain 血统，大概对应 |
| --- | --- | --- |
| `recall()` → `read('system://boot')` | `read_memory` | `breath`（「把记忆取回来」，语义最接近） |
| `search(query)` | `search_memory` | `trace`（关键词搜索） |
| `read(uri)` | `read_memory` | `wander`（按 `mode` 翻阅，**没有 URI 概念**） |
| `create(input)` | `create_memory` | `hold`（写记忆） |
| `update(input)` | `update_memory` | ❓ 可能无直接对应 |
| `delete(uri)` | `delete_memory` | ❓ 可能无直接对应 |

⚠️ 最后两行是**真问题**：若实例没有「原地编辑 / 删除」语义，那 `MemoryProvider` 接口本身
（`shared/providers.ts` 里的 `update` / `delete`）要不要保留就得**重新界定** ——
那是设计决策，不是适配层内部能自行消化的。→ 待侦察结果出来后再定。

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
| **自部署实例 · 工具面**（不假设工具名，只读） | `cd server && MCP_NOCTURNE_URL='https://beiyan.cc/mcp-<密钥>' npx tsx scripts/probe-nocturne-tools.ts` | ⏳ **待北北实跑**（本沙箱连不上外网） |
| **同上，但在服务器上跑**（推荐：内网直连、免密钥、免三件套） | `node probe-nocturne-tools-standalone.mjs http://127.0.0.1:8000/mcp` | ⏳ 同上（`.mjs` 零依赖版，无需仓库/tsx） |
| **自部署实例 · 全链**（反代 / Namespace / 工具调用） | `cd server && MCP_NOCTURNE_URL='https://beiyan.cc/mcp-<密钥>' MCP_NOCTURNE_NAMESPACE=habitat npx tsx scripts/probe-nocturne-live.ts` | ⛔ **受阻** —— 它假设的是**官方**工具名；实例对不上会从 §6 起整段失败。**先跑上一行拿真实工具面** |

⚠️ 后两条的地址是**加密钥的那条**（`/mcp-<密钥>`），不是公开的 `/mcp` —— 后者被 nginx 特意 404 掉了（见「入口地址」）。
⚠️ 第 1、4 条依赖公网可达，属**专项验证**（换环境时当连通性体检用），不并入常规回归。
⚠️ **本机 Node 20 带 SNI 连 `beiyan.cc` 会 `ECONNRESET`**（见文末 T-022 风险 2）—— 所以后两条在**本机**可能连不上，
   属已知的本地环境限制，不是配置错；端到端联调放服务器上做。

## 自部署实例体检（T-022 · 2026-09-23）

> ⚠️ **2026-09-24 更正**：本节原结论「卡在反代、需去服务器删掉挡住 `/mcp` 的那条规则」**是误判**。
> T-022 探的是**公开路径** `/mcp`，而那条 404 是当初**有意**加的加固（见上文「入口地址」）。
> 真正入口是秘密路径 `/mcp-<密钥>`。本节其余实测数据（DNS / TLS / 进程 / 两种 404 来源不同）
> **仍然有效且有价值**，只是「修法」要从「删规则」改成「改用秘密路径」。

**目标**：`https://beiyan.cc`（阿里云 ECS `120.27.247.75`）。原结论：进程都好，卡在反代。（见上方更正）

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

⭐ **2026-09-24 更正**：那条规则**不是 bug，是有意加固** ——
`location = /mcp { return 404; }` 配一条 `location = /mcp-<密钥> { proxy_pass .../mcp; }`。
所以**不需要去服务器删任何东西**，改用秘密路径即可（见上文「入口地址」）。
T-022 当时没看到那份加固记录（`.mcp_hardening.json`），才把「故意的 404」当成了「缺 location」。

⭐ 另一条重要事实：Nocturne **上游默认配置已经把 `/mcp` 配好了**（`frontend/nginx.conf` 里 `location /mcp`
→ `backend:8233/mcp`，且 `proxy_buffering off` / `proxy_http_version 1.1` / `proxy_read_timeout 86400s` /
`add_header X-Accel-Buffering no` 一应俱全）。**两层 nginx 里，容器那层是齐的，缺的是宿主那层。**
→ 完整拓扑与操作流程见 `docs/DEPLOYMENT.md`。

### 反代配置要点（待北北在服务器上补）

**别只加一行 `proxy_pass`** —— MCP 的 Streamable HTTP 是**流式**的，nginx 默认会把响应缓冲住，
表现为「握手过了但事件不推 / 连接假死」。location 里至少要带上 `proxy_buffering off`、`proxy_cache off`、
`proxy_http_version 1.1`、加大 `proxy_read_timeout`、`chunked_transfer_encoding off`、`add_header X-Accel-Buffering no`。
（上游 `frontend/nginx.conf` 里那一段可以**直接照抄**，见 `docs/DEPLOYMENT.md` §3。）

> ℹ️ 本节的「待北北在服务器上补」是 T-022 的错误前提。加固片段里那 11 行**已经带了**
> `proxy_buffering off` / `proxy_cache off` / `proxy_http_version 1.1` / `proxy_read_timeout 3600s` /
> `proxy_send_timeout 3600s`，即「补」这件事在 2026-09-13 就做完了；
> 仅缺 `chunked_transfer_encoding off` 与 `add_header X-Accel-Buffering no`（当前实测不缺，先不加）。
> 留着这段是因为**换密钥 / 重建实例**时仍要照这个标准写 location。

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
