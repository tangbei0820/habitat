# DEPLOYMENT · 部署

状态：**按实机定稿**（2026-09-24；生产反代采用 nginx，Caddy 仅保留为早期方案记录）。

拓扑构想的原文见《栖息地初版技术方案分析.md》§4。本文件记录**实测到的真实拓扑**与接入流程。
本地开发环境：`npm run dev:server` + `npm run dev:web`。

---

## 1. 实测拓扑（与方案的差异）

方案设想是「Caddy 反代」，**实机跑的是 nginx**。且 Nocturne 自身还带一层 nginx，所以链路上**有两个 nginx**：

```
浏览器 / MCP 客户端
   │  HTTPS 443
   ▼
[宿主机 nginx 1.18.0 (Ubuntu, apt 安装)]   ← 证书：Let's Encrypt（beiyan.cc）
   │  HTTP 内网
   ▼
[Nocturne 容器 nginx（frontend/ 自行 build，nginx:alpine）]
   │  proxy_pass → backend:8233
   ▼
[Nocturne backend（FastAPI，run_sse.py，:8233）] ──→ postgres:16-alpine
```

要点：

| 项 | 实测 |
| --- | --- |
| 反代软件 | 宿主机 **nginx 1.18.0 (Ubuntu)**（非 Caddy） |
| Nocturne 部署 | Docker Compose，三服务：`postgres` / `backend` / `nginx` |
| backend 端口 | **8233**（容器内） |
| Nocturne 自己的 nginx | 由 `frontend/` build（`nginx:alpine`），配置在 `frontend/nginx.conf` |
| 域名解析 | `beiyan.cc` → `120.27.247.75`（阿里云 ECS 直连，**未经 Cloudflare 代理**） |
| 80 端口 | ⚠️ **被阿里云按域名拦截**（未备案）—— 带域名访问返回 ICP 备案拦截页；裸 IP 正常 301。**443 可正常使用**。方案里「备案后启用域名」一条已坐实 |

### Nocturne 上游默认暴露的路径

`frontend/nginx.conf`（官方）里**已经把 MCP 配好了**，且反缓冲指令齐全：

| 路径 | 上游配置 |
| --- | --- |
| `/` | 静态 SPA（`try_files ... /index.html`） |
| `/health` | → `backend:8233/health`（免鉴权） |
| `/api/` | → `backend:8233/api/` |
| `/mcp` | → `backend:8233/mcp`（**Streamable HTTP**，带 `proxy_buffering off` / `proxy_http_version 1.1` / `proxy_read_timeout 86400s` / `add X-Accel-Buffering no`） |
| `/sse` | → `backend:8233/sse`（传统 SSE 客户端） |
| `/messages/` | → `backend:8233/messages/` |

> ⚠️ 公网访问需要两层都转发；现网已用「公开 `/mcp` 返回 404 + 秘密路径转发」完成宿主层加固。生产 Habitat 与 Nocturne 同机时优先走内网，不经过宿主层。

---

## 2. 实机体检结论（2026-09-23）

以 `https://beiyan.cc` 为目标的只读探测结果：

| 路径 | 结果 | 说明 |
| --- | --- | --- |
| `/` | 200 `application/json` | Nocturne 自述 JSON，其中声明 `"mcp":"/mcp"` |
| `/health` | 200 | `{"status":"ok","buckets":12,"decay_engine":"running"}` |
| `/dashboard` | 200 | 面板正常 |
| `/health/`、`/dashboard/` | **307** | ⭐ **FastAPI 的 redirect_slashes 行为 —— 铁证：请求已穿透到 Python 后端** |
| `/zzz-*`、`/index.html`、`/favicon.ico`、`/assets/`、`/docs` | 404 **纯文本 9 字节** `Not Found` | ⭐ Starlette 默认 404 —— **同样来自后端** |
| `/mcp`、`/mcp/` | 404 **HTML 162 字节** | ⭐ **nginx 默认 404 页**（署名 `nginx/1.18.0 (Ubuntu)`）—— 与上面**不是同一个东西**在回话 |

**结论**：最外层 nginx 对绝大多数路径是**通配转发到后端**的；唯独 `/mcp`（含尾斜杠）被**单独拦下**，连后端都没碰到。

⚠️ **2026-09-24 更正 —— 「单独拦下」这件事是对的，但原因判错了。**
那条规则**不是别人误加的，是 2026-09-13 部署时自己加的**：当时对 MCP 做了加固，
`location = /mcp { return 404; }` 封锁公开路径，另开一条**秘密路径**转发到容器：

```nginx
location = /mcp { return 404; }

location = /mcp-<32位十六进制密钥> {
    proxy_pass http://127.0.0.1:8000/mcp;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

证据在北北本机：`MCP接入说明_Nocturne.md` 与本仓库以外那份 `.mcp_hardening.json`（均 2026-09-13）。

→ **所以修法不是「改掉那条规则」，而是「用秘密路径访问」**：
`MCP_NOCTURNE_URL=https://beiyan.cc/mcp-<密钥>`。**不需要动服务器任何配置。**
（本节下面的 §3.2 路径 B 只在「换密钥 / 重建实例」时才需要照着改。）

### 🔴 同时发现：该实例当前**没有任何鉴权**

不带任何凭据即可 `200` 访问 `/dashboard`、`/health`、`/api/*`，且响应带 `access-control-allow-origin: *`。
dashboard 页面中可静态枚举出约 30 个接口（含 `/api/buckets`、`/api/search`、`/api/config`、`/api/import/upload`；后者的写语义**未实测**，仅按名称推断）。

**这意味着记忆库当前对公网敞开。** 而且 MCP 那条**秘密路径本身就在公网上**（见 §2 更正框）——
它只提供「知道密钥才能进」这一层保护，**没有第二道鉴权**。所以在补上服务端 Bearer Token 之前，
相当于把一个**含写工具**的 MCP 端点挂在公网上，仅靠路径保密。

> 2026-09-24 登录实机并按**当前部署源码**复核：`OMBRE_API_PASSWORD` 只负责 Dashboard 登录与 `/api/*`
> 的 session-cookie 鉴权，现网早已配置并生效；这个版本没有 MCP Bearer 开关。因此 MCP 的 Bearer 校验落在宿主 nginx，
> Habitat 侧把同一 Bearer 值放在 `MCP_NOCTURNE_TOKEN`。两类凭据都只留在服务器 root-only 配置，不进仓库。

---

## 3. 接入流程

> **先想清楚一个问题：`/mcp` 需不需要暴露到公网？**
> 生产形态下 habitat-server 与 Nocturne **同机**，走**内网直连**即可（见 §4）—— 那就**完全不必**开放公网 `/mcp`。
> 而公网暴露意味着把一个**含写工具（7 个）的 MCP 端点**挂上互联网，**不推荐**，除非确有跨机需求。
> 且本机 Node 20 连公网 `beiyan.cc` 会被 `ECONNRESET`（见 §4），**本地开发连远程这条路暂时也走不通** ——
> 开公网的实际收益有限。

> ℹ️ **2026-09-24 更正**：公网 `/mcp` **早就按「秘密路径」的方式开好了**（2026-09-13 加固，见 §2 更正框），
> 既有的入口是 `https://beiyan.cc/mcp-<密钥>`，**不需要再动 nginx**。
> 下面 **3.1（内网直连）仍是生产形态的推荐做法**；**3.2（公网暴露）改为备查** ——
> 只在「重建实例 / 换密钥 / 加固丢失」时才照着做，且**目标是加回秘密路径，不是敞开 `/mcp`**。

### 3.1 路径 A：内网直连（**推荐 · 生产形态**）

**不需要改宿主机 nginx。** 因为 Nocturne **容器内那层 nginx 已经把 `/mcp` 配好了**（上游默认，含全套反缓冲指令），
宿主那层只管公网入口，内网直连根本不经过它。

要做的只有两件：

1. **开鉴权**（见 §3.3）—— 即使只走内网也建议开，顺手解决「记忆库裸奔」。
2. 在服务器上**验内网可达**：

```bash
# <NGINX_PORT> = compose 里的 NGINX_PORT（默认 80）
curl -i -X POST http://127.0.0.1:<NGINX_PORT>/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'

# 或直接打 backend（绕过容器 nginx），端口 8233；backend 可能只监听容器网络，故宿主机上不一定可达
curl -i -X POST http://127.0.0.1:8233/mcp -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' -d '{...同上...}'
```

拿到 `200` + `mcp-session-id` 响应头 = **链路通，Phase 3B 的记忆侧即可收口**，把该地址填进 habitat-server 的 `MCP_NOCTURNE_URL`。

### 3.2 路径 B：公网暴露 —— **改为「秘密路径」而不是敞开 `/mcp`**（备查）

> ⚠️ **2026-09-24 更正**：这段原先写的是「找出那条挡住 `/mcp` 的规则并**删掉它**」。**那是错的** ——
> 那条规则是 2026-09-13 **有意**加的加固，删掉等于把**含写工具的 MCP 端点**敞开给公网。
> **正确目标是「加回 / 维持秘密路径」**，公开的 `/mcp` 应该继续 404。
> 现网已经就是这样（见 §2 更正框），本节仅在**重建实例 / 换密钥 / 加固丢失**时使用。

```bash
# 第一步：看清现状
sudo grep -rn -i "mcp" /etc/nginx/
```

判读方式：

| 看到什么 | 含义 | 怎么做 |
| --- | --- | --- |
| `location = /mcp { return 404; }` **且**有 `location = /mcp-<密钥>` | ✅ 加固完好 | **什么都不用做**，客户端用秘密路径 |
| 只有 `return 404;`，没有秘密路径那条 | 加固只剩一半 | 按下面第二段补上秘密路径 |
| 什么都没有（`/mcp` 落回通配 `location /`） | 加固丢了 | **先补 `return 404;`，再补秘密路径** |
| 形如 `location /mcp { }` 且内容为空 | 半吊子配置 | 用下面第二段**整段取代** |

**换密钥 / 新建秘密路径**（密钥形态：`mcp-` + 32 位小写十六进制）：

```nginx
location = /mcp { return 404; }

location = /mcp-<新密钥> {
    proxy_pass http://127.0.0.1:<NOCTURNE_宿主端口>/mcp;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # Streamable HTTP（MCP）—— 反缓冲指令缺一不可，否则「握手能过、事件不推」
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

改完 `sudo nginx -t && sudo systemctl reload nginx`（reload 不断流，别用 restart）。
`<NOCTURNE_宿主端口>` 与现有 `/api/` 那条保持一致（当前是 `8000`）。

```nginx
    # Streamable HTTP（MCP）—— 反缓冲指令缺一不可，否则「握手能过、事件不推」
    location /mcp {
        proxy_pass http://127.0.0.1:<NOCTURNE_宿主端口>/mcp;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_cache off;
        proxy_http_version 1.1;
        proxy_read_timeout 86400s;
        proxy_set_header Connection '';
        chunked_transfer_encoding off;
        add_header X-Accel-Buffering no;
    }
```

改完 **`sudo nginx -t` 先校验配置**（会指出语法错误在第几行），通过后再 `sudo systemctl reload nginx`（reload 不断流，别用 restart）。

### 3.3 无论走哪条路：**先锁门，再开门**

1. **Dashboard/API**：在实例 `.env` 配置强密码 `OMBRE_API_PASSWORD` 并重建容器；未登录请求 `/api/config` 必须返回 401。现网已完成。
2. **MCP**：当前 v1.30 部署没有 Bearer 开关，故在宿主 nginx 的秘密 MCP location 内校验
   `Authorization: Bearer <token>`；配置文件须为 root-only，修改前备份，且必须 `nginx -t` 后再 reload。现网已完成。
3. Habitat 部署环境设置对应 `MCP_NOCTURNE_TOKEN`，再复验：
   `cd server && MCP_NOCTURNE_URL=... MCP_NOCTURNE_TOKEN=... npx tsx scripts/probe-nocturne-live.ts`
   （在服务器上用 `http://127.0.0.1:<端口>/mcp`；在本机用公网地址会撞上 Node 20 的 TLS 问题，需换 Node 22 跑脚本）
4. 做一次**有 / 无凭据对照**：无 Token 的 MCP 握手必须得到 401/403，带 Token 的探针必须全绿；Dashboard 首次设置另行完成。

---

## 4. 生产形态下的记忆链路（重要）

技术方案 §4 的拓扑是**单机部署**：habitat-server 与 Nocturne 同机。

因此生产环境里，`MCP_NOCTURNE_URL` 应指向**内网地址**（如 `http://127.0.0.1:<端口>/mcp` 或容器网络内的地址），**不经过公网 TLS**。好处有二：

1. 少一层暴露面 —— 公网可以完全不开 `/mcp`；
2. **绕开下面这个 TLS 兼容问题**。

### ⚠️ 已知问题：Node 20 带 SNI 打 `beiyan.cc` 会被 ECONNRESET

| 客户端 | OpenSSL | 结果 |
| --- | --- | --- |
| Node 20（系统 `/c/Program Files/nodejs`） | 3.0.15 | **连续 6/6 ECONNRESET** |
| Node 22（managed） | 3.5.5 | 连续 6/6 成功 |
| Git Bash openssl 3.5.7 | 3.5.7 | 成功 |
| 裸 IP（不带 SNI） | — | 两个 Node 版本都成功 |

- 仅在「**Node 20 × SNI=beiyan.cc**」这一组合下复现；Node 20 打其它站点正常。
- 试过 9 组 TLS 参数组合（版本/密码套件等）**均无效**，无法在客户端绕过。
- **影响面**：只影响「在**本机**用 Node 20 的 server 去连**公网** beiyan.cc」。生产部署是同机内网，不经过此链路，**不受影响**。
- **结论**：域名链路仍不适合本机 Node 20；本地常规开发走 `dev:mock-mcp`。专项验真可用 Node 20 + 固定 IP 绕开 SNI（仅作为诊断手段，不写入生产配置），或直接在服务器内网执行。

> 该现象疑似链路层 DPI 对 OpenSSL 3.0.x 的 ClientHello 特征做了处置，机制未最终证实，此处只记录可复现的**分界线**。

---

## 5. 验证状态（2026-09-24）

**① 公网只读链路与鉴权 —— 已完成：**

- [x] 使用轮换后的秘密路径、Bearer 与 `X-Namespace: habitat` 完成 `probe-nocturne-live.ts`：**26/26**，
      Streamable HTTP session、9 工具工具面、`breath` / `trace` 两条只读调用均通过；实际调用未触碰写工具。
- [x] serverInfo 实测为 **Ombre Brain v1.30.0**；以后以实测工具面为准，不再按旧 Demo 猜测。
- [x] 探针默认遮蔽秘密路径，只有显式 `NOCTURNE_SHOW_SECRET=1` 才显示完整 URL。

**② 工具面对不对得上 —— 已于 2026-09-24 查明并对齐（T-031）：**

- [x] ~~自部署实例实际暴露哪些工具~~ → **实测 9 个**：`breath` / `trace` / `hold` / `wander` / `wander_mark` /
      `drive` / `undercurrent` / `trail_delta` / `trail_family`（与旧假设的 5 个名字**0/5 命中**）。
- [x] 适配层已按真实工具面**重写为只读两方法**（`recall()` → `breath`、`search()` → `trace`）；
      `MemoryProvider` 的 `update` / `delete` 已**删除**（实例没有对应语义，且从未被调用）。见 `docs/MEMORY.md`「定稿映射」。
- [x] 全链验真已完成：**26/26**；反代 / 会话 / 工具面 / 只读两路径 / 无 Token 拒绝均通过。
- 🔁 以后实例**升级 / 换工具名**时：先跑 `probe-nocturne-tools*` 拿一手事实，再看适配层要不要动。

**③ 鉴权 —— 已完成（T-034）：**

- [x] `OMBRE_API_PASSWORD` 已配置：`/api/config` 未登录返回 401，`/health` 保持 200。
- [x] MCP 秘密路径已轮换，并在宿主 nginx 增加 Bearer 校验：无 Token / 错 Token 均 401，正确 Token initialize 200。
- [x] 完整 URL / Token 只存 `/root/.config/habitat/nocturne-mcp.env`（目录 700、文件 600）；nginx 站点配置收紧为 600。
- [x] 修改前备份：`/etc/nginx/sites-available/nocturne.bak-20260924-170956`；`nginx -t` 通过后使用 reload，无服务中断。

**④ 生产形态（真正部署时才需要）：**

- [ ] `NGINX_PORT` 的实际取值（compose 默认 80）
- [ ] 内网直连地址（`http://127.0.0.1:<端口>/mcp`）—— 生产 `MCP_NOCTURNE_URL` 指向它，不走公网 TLS
