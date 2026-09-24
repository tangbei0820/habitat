# MEMORY · 记忆系统接入

状态：**Phase 3A 只读链路完成**。本地 mock 全链探针 21/21，自部署实例专项验真 25/25；接口已按**自部署实例的真实工具面**收敛为**只读两方法**（2026-09-24，T-031 / T-033）。

- ✅ **工具面已查明并对齐**：实例真实 9 个工具，Habitat 只用其中 2 个只读工具（`breath` / `trace`）。旧适配层那 5 个名字（源自官方 Demo）**0/5 命中**，已整段重写。
- ✅ **写类端点已撤掉**：实例虽有写工具（`hold` / `wander_mark` / `drive`），但 Habitat 这一阶段**只读接入**，`/api/memory` 只留 `GET boot` + `GET search`。
- ✅ **真机只读验真完成**：Streamable HTTP session、9 工具工具面、`breath` / `trace` 两条实际调用均通过，**25/25**；未调用任何写工具。
- 🔴 **该实例仍没有服务端鉴权层**（`/health`、`/dashboard`、`/api/*` 无凭据可达），见文末 T-022 风险 1 —— 需服务器权限设置 `OMBRE_ADMIN_TOKEN` 后再做有 / 无凭据对照。

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
当前访问控制只有「路径 = 密码」。它解释了现网为什么能连通，**不能替代正式 Bearer Token**；
生产收口后还应设置 `OMBRE_ADMIN_TOKEN`，并在 Habitat 侧配置同值 `MCP_NOCTURNE_TOKEN`。

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
MCP_NOCTURNE_TOKEN=<与服务端 OMBRE_ADMIN_TOKEN 相同的值>
```

**在服务器上确认加固是否还在**：

```bash
sudo grep -rn "location.*mcp" /etc/nginx/sites-enabled/
```

- 看到 `location = /mcp { return 404; }` **且**有 `location = /mcp-<密钥>` → 加固还在，填秘密路径即可，**不用动服务器**。
- 只看到 `location /` → 加固被后来的配置覆盖了，按 `docs/DEPLOYMENT.md` §3 重新加回去。

**换密钥**：把 `location = /mcp-旧密钥 {` 改成新密钥（`proxy_pass` 那行不动）→ `sudo nginx -t && sudo systemctl reload nginx`，旧 URL 立刻 404。

> 秘密路径负责隐藏公网入口，Bearer Token 负责真正鉴权；两层应叠加。Habitat MCP 客户端支持 Bearer，
> 不需要为了兼容性放弃服务端鉴权。

## 自部署实例的工具面（2026-09-24 实测 · 已收敛）

### 一手事实：实例真实有 9 个工具

北北在服务器上**内网直连** `http://127.0.0.1:8000/mcp` 跑 `curl` 拿到（serverInfo 自称 **Nocturne**；
部署留档记 **Ombre Brain v1.30.0** —— 血统存疑，但**工具面是实测的，以实测为准**）：

| 工具 | 干什么 | Habitat 用不用 |
| --- | --- | --- |
| `breath` | 无参，把记忆整个取回来（新窗 / Compact 后读） | ✅ `recall()` 就用它 |
| `trace` | `query` + `limit`，按关键词搜记忆 | ✅ `search()` 就用它 |
| `hold` | 写记忆（`kind` 区分 memory / feel / writing / unresolved / window / letter …） | ❌ 本阶段只读 |
| `wander` | 按 `mode` 翻记忆抽屉 | ❌ |
| `wander_mark` | 给抽屉表态（认 / 不认 / 悬置） | ❌ |
| `drive` | 九维驱动模型（`drive_key`） | ❌ |
| `undercurrent` | 情绪天气 | ❌ |
| `trail_delta` / `trail_family` | 轨迹（Trail）家族 | ❌ |

对照旧适配层写死的 5 个名字 `read_memory` / `search_memory` / `create_memory` / `update_memory` / `delete_memory`
—— **0/5 命中**。

### 为什么当时不能只改字符串

数据模型根本不同：

- 旧适配层假设的是 **URI 树**：`system://boot`、`parent_uri`、`old_string`/`new_string` 补丁、update 前必须先 read；
- 实例实际是 **记忆抽屉 + 关键词轨迹 + 九维驱动**：`hold` 用 `kind` 分类，**没有 URI 概念，也没有「原地编辑」「删除」这两套语义**。

所以处理方式是**收敛接口**，不是替换工具名（结论见下）。

### 定稿映射（`server/src/providers/nocturne-memory.ts` 的 `NOCTURNE_TOOLS`）

| `MemoryProvider` 方法 | 实例工具 | 说明 |
| --- | --- | --- |
| `recall()` | `breath` | 无参数；新窗 / Compact 后读记忆全文 |
| `search(query, {limit})` | `trace` | 入参 `query`（必填）+ `limit`（可选） |
| `verifyToolFace()` | `tools/list` | 启动期自检：上面两个工具缺了就告警，只列清单不调用 |

**被撤掉的方法**：`read(uri)` / `create` / `update` / `delete` —— 一共 4 个。理由：
实例没有 URI，也没有「编辑 / 删除」语义；这 4 个方法**从未被任何调用方使用**（全仓核查过）。
`MemoryCreateInput` / `MemoryUpdateInput` 两个类型一并删除；`MemorySearchOptions` 去掉 `domain`（实例不认这个参数）。

> ⚠️ **只读是本阶段的刻意选择**，不是能力缺失：实例的 `hold` 完全能写。
> 等 Phase 4「Life / AI 日记」真需要写记忆时，再加写方法，届时按 `hold` 的 `kind` 设计入参。

### 侦察脚本 —— 现在是「漂移检测」，不是验收

三个脚本**输出口径一致，挑顺手的用**；它们**绝不调用任何工具**（只握手 + `tools/list`）：

| 脚本 | 在哪跑 | 要什么 |
| --- | --- | --- |
| `probe-nocturne-tools.ts` | 开发机 | 仓库 + tsx |
| `probe-nocturne-tools-standalone.mjs` | **任何机器** | 只要 Node 18+ |
| `probe-nocturne-tools-quick.sh` | **Linux 服务器 / Git Bash** | 只要 `curl` + `python3` |

```bash
# 【开发机】有仓库 + tsx
cd server
MCP_NOCTURNE_URL='https://beiyan.cc/mcp-<密钥>' npx tsx scripts/probe-nocturne-tools.ts

# 【服务器】仓库没同步过去时，两个零依赖版任选 ——
node probe-nocturne-tools-standalone.mjs http://127.0.0.1:8000/mcp   # 要 Node 18+
bash probe-nocturne-tools-quick.sh http://127.0.0.1:8000/mcp         # 只要 curl + python3
```

把「适配层依赖的 2 个名字」与「实例真实有的名字」逐条对照，并打印每个工具的名字 + 说明 + 参数 + 必填。
（`NOCTURNE_SHOW_SECRET=1` 才完整打印密钥路径，默认打码防截图外泄。）

**什么时候再跑它**：实例升级 / 换血统 / 改了工具名 → 先跑它拿一手事实，再决定动不动适配层。
**它不替代验收** —— 只读链路的端到端验收是 `scripts/probe-memory.ts`。

> **在服务器上跑还有两个额外好处**：① 走**内网直连** `http://127.0.0.1:8000/mcp`
> —— 加固只做在 nginx 那层，容器里就是朴素的 `/mcp`，**连密钥路径都不用填**；
> ② 绕开「本机 Node 20 带 SNI 连 `beiyan.cc` 会 `ECONNRESET`」那个坑。

## 历史留档：官方只读 Demo 的协议事实（T-013 · 2026-09-23）

> ⚠️ **2026-09-24 起本节仅为历史记录，不再是我们的对接对象。**
> 当时据它写死了适配层工具名，实测才发现自部署实例是另一套（见上节）——
> 「按官方 Demo 的工具名写适配层」这个前提本身是错的，对应脚本 `probe-nocturne-demo.ts` 已废弃。
> 下面这些**协议层**事实（传输形态 / 会话 id / 返回是面向模型的文本）仍然通用，**工具名那一栏已作废**。

来源：Nocturne 官方只读 Demo `https://misaligned.top/mcp`（`.env.example` 里那行）。当时经我们自己的 `McpGateway` 实跑。

| 项 | 实测值 |
| --- | --- |
| 传输 | **Streamable HTTP**，`initialize` 正常下发 `mcp-session-id`（确认不是 SSE 降级） |
| serverInfo | `Nocturne Memory Interface` v1.26.0 |
| 协商协议版本 | `2025-06-18` |
| 工具面 | 7 个（`read_memory` / `create_memory` / `update_memory` / `delete_memory` / `add_alias` / `manage_triggers` / `search_memory`）—— **❌ 已作废，见上节实测** |
| 握手耗时 | 公网 Demo 2.2–4.6s（同机自部署可忽略） |

⚠️ **不依赖实例的内部 schema**（对齐 §9 风险 5）：Nocturne 工具返回的是**面向模型的文本**，适配层只抽取 text 块（`textFromToolResult`），不解析其库结构。
⚠️ **文本型 `Error:` 会被识别成失败** —— 工具返回 `isError` 或正文以 `Error:` 开头时抛 `MCP_TOOL_CALL_FAILED`，不让错误伪装成成功。

## 复验方式

| 验什么 | 命令 | 结果 |
| --- | --- | --- |
| 本地全链（mock，**只读两路径**） | 起 `dev:mock-mcp` + `dev:server` 后 `cd server && npx tsx scripts/probe-memory.ts` | ✅ **21/21**（2026-09-24） |
| **自部署实例 · 全链**（反代 / Namespace / 工具面 / 只读纪律） | `cd server && MCP_NOCTURNE_URL='https://beiyan.cc/mcp-<密钥>' MCP_NOCTURNE_NAMESPACE=habitat npx tsx scripts/probe-nocturne-live.ts` | ✅ **25/25**（2026-09-24）；实际调用仅 `breath` + `trace` |
| **自部署实例 · 工具面**（只握手，不调用工具） | `cd server && MCP_NOCTURNE_URL='https://beiyan.cc/mcp-<密钥>' npx tsx scripts/probe-nocturne-tools.ts` | ✅ 真机 9 工具与适配层 2/2 命中 |
| **同上，但在服务器上跑**（推荐：内网直连、免密钥、免装东西） | `node probe-nocturne-tools-standalone.mjs http://127.0.0.1:8000/mcp`，或 `bash probe-nocturne-tools-quick.sh http://127.0.0.1:8000/mcp` | ✅ 两个零依赖版均已实跑通过 |
| ~~客户端代码对官方 Demo~~ | ~~`npx tsx scripts/probe-nocturne-demo.ts`~~ | ⛔ **已废弃**（工具面假设是错的，脚本已清空实现） |

⚠️ 实例侧那几条的地址是**加密钥的那条**（`/mcp-<密钥>`），不是公开的 `/mcp` —— 后者被 nginx 特意 404 掉了（见「入口地址」）。
⚠️ 这几条依赖公网可达，属**专项验证**（换环境时当连通性体检用），不并入常规回归。
⚠️ **本机 Node 20 带 SNI 连 `beiyan.cc` 会 `ECONNRESET`**（见文末 T-022 风险 2）。本次专项验真使用固定 IP 绕开 SNI
   并只读执行；生产仍应走同机内网地址，不把这一诊断绕法写进部署配置。
⚠️ 探针默认遮蔽秘密路径；只有显式设置 `NOCTURNE_SHOW_SECRET=1` 才打印完整 URL。

> 💡 **在服务器上跑 `probe-nocturne-live.ts`**：仓库要同步过去。若嫌麻烦，先在服务器上跑零依赖的
> `probe-nocturne-tools-standalone.mjs`，只验工具面（那通常是最需要确认的一环）。

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
   本地开发连远程实例这条路暂时不通 —— 本地一律走 `dev:mock-mcp` + `probe-memory.ts`，端到端联调放服务器上做。
