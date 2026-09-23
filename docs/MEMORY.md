# MEMORY · 记忆系统接入

状态：**Phase 3A 施工中**。本地 mock 全链探针 24/24；客户端代码已用官方只读 Demo 打真实 server 验真（25/25，见 `docs/TASKS.md` T-013），**自部署实例尚未接**。

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

⚠️ 前者依赖公网可达，属**专项验证**（换环境时当连通性体检用），不并入常规回归。
