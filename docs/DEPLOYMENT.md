# DEPLOYMENT · 部署

状态：**初稿**（2026-09-23，基于阿里云实机体检结果）。

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

> ⚠️ **两层都要转发才通**：容器内那层上游已经配好，宿主机那层是缺的那一层。

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

因此「补 `/mcp` 转发」的正确做法不是「新增一条 location」，而是**找到那条把 `/mcp` 挡在外面的规则，改掉它**（或在其上方补一条转发）。

### 🔴 同时发现：该实例当前**没有任何鉴权**

不带任何凭据即可 `200` 访问 `/dashboard`、`/health`、`/api/*`，且响应带 `access-control-allow-origin: *`。
dashboard 页面中可静态枚举出约 30 个接口（含 `/api/buckets`、`/api/search`、`/api/config`、`/api/import/upload`；后者的写语义**未实测**，仅按名称推断）。

**这意味着记忆库当前对公网敞开。** 开放 `/mcp` 之前必须先补鉴权 —— 否则等于把一个**含写工具**（7 个工具）的 MCP 端点直接挂上公网。

> Nocturne 的鉴权开关：`config.json` 里的 `api_token`（compose 中 `./config.json:/app/config.json` 挂载）。
> 启用后，**除 `/health` 外所有 `/api/` 与 `/mcp`、`/sse` 端点均需 `Authorization: Bearer <token>`**。
> 官方 `scripts/setup_docker.py` 会自动生成该 token。

---

## 3. 接入流程

> **先想清楚一个问题：`/mcp` 需不需要暴露到公网？**
> 生产形态下 habitat-server 与 Nocturne **同机**，走**内网直连**即可（见 §4）—— 那就**完全不必**开放公网 `/mcp`。
> 而公网暴露意味着把一个**含写工具（7 个）的 MCP 端点**挂上互联网，**不推荐**，除非确有跨机需求。
> 且本机 Node 20 连公网 `beiyan.cc` 会被 `ECONNRESET`（见 §4），**本地开发连远程这条路暂时也走不通** ——
> 开公网的实际收益有限。

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

### 3.2 路径 B：公网暴露 `/mcp`（**不推荐**，确有跨机需求才做）

需要动宿主机 nginx。目标不是「新增一条 location」，而是**先找出那条把 `/mcp` 单独挡在外面的规则，删掉或取代它**：

```bash
# 第一步：找出来（多半就在这一条命令的输出里）
sudo grep -rn -i "mcp" /etc/nginx/
```

若找到形如 `location ~ ^/mcp/?$ { return 404; }` 或内容为空的 `location /mcp { }` → **直接删掉它**，
`/mcp` 就会落回通配转发。**但通配那条没有反缓冲指令**，所以建议显式补上下面这段
（`proxy_pass` 的目标**与现有 `/api/` 那条保持一致**，即 Nocturne 在宿主侧实际可达的地址/端口，待实测填入）：

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

1. **开鉴权**：在服务器上给 `config.json` 配 `api_token` → `docker compose restart backend`。记下 token 值。
2. 再按 3.1 / 3.2 处理 `/mcp`。
3. **复验**：`cd server && MCP_NOCTURNE_URL=... MCP_NOCTURNE_TOKEN=... npx tsx scripts/probe-nocturne-live.ts`
   （在服务器上用 `http://127.0.0.1:<端口>/mcp`；在本机用公网地址会撞上 Node 20 的 TLS 问题，需换 Node 22 跑脚本）

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
- **结论**：本地开发连远程实例这条路暂时不通；本地开发请走 `probe-nocturne-demo.ts`（官方只读 Demo）或 `dev:mock-mcp`，端到端联调放服务器上做。

> 该现象疑似链路层 DPI 对 OpenSSL 3.0.x 的 ClientHello 特征做了处置，机制未最终证实，此处只记录可复现的**分界线**。

---

## 5. 待确认项

**路径 A（内网直连）需要的：**

- [ ] **`curl -i -X POST http://127.0.0.1:<NGINX_PORT>/mcp` 内网通不通** —— 这一条是**关键分水岭**：
  内网通 → 链路已通，`/mcp` 的公网 404 与 Phase 3B 无关，直接收口；
  内网也 404 → 说明**容器内那层 nginx 没有 `/mcp`**（可能版本较老；上游新版 `frontend/nginx.conf` 是有的）
  → 需在服务器上查容器内配置：`docker exec <nginx容器> cat /etc/nginx/conf.d/default.conf`
- [ ] `NGINX_PORT` 的实际取值（compose 默认 80）
- [ ] `config.json` 里 `api_token` 当前是空还是有值；启用后 dashboard 的输入体验

**路径 B（公网暴露，不推荐）才需要的：**

- [ ] 宿主机 nginx 里把 `/mcp` 挡住的那条规则**长什么样**（`sudo grep -rn -i "mcp" /etc/nginx/`）
- [ ] 宿主机 nginx 的 `proxy_pass` 目标是哪个地址/端口（照 `/api/` 那条抄）
