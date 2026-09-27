# MCP · 工具层与 Gateway

状态：**V2-A MCP Manager 基础切片已落地（T-059）**。

原则：前端不承担 MCP 协议握手；统一走 `server/src/mcp/` Gateway 聚合，诊断日志落库（参见技术方案分析 §7.2②）。

## 1. 连接配置的权威源

MCP Manager 的配置由服务端 SQLite 权威保存：

- `mcp_server`：名称、Streamable HTTP URL、自定义 headers、启用开关、自主策略和时间戳。
- `mcp_server_secret`：Bearer token 单独存放；列表、编辑回执和测试回执只返回 `hasToken`，不回传 token。
- 启动时 `loadMcpRegistry()` 只提供环境变量种子（当前为 Nocturne）；`seedMcpServers()` 只在对应 id 不存在时写入，之后以设置页 / 数据库为准。

这样既保留服务器本地部署的 Nocturne 入口，也允许在设置页注册其它远程 MCP；浏览器永远不直接连接 MCP server。

## 2. MCP Manager 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/mcp/servers` | 脱敏列表：状态、工具数量、URL、header 名称、是否有 token |
| `POST` | `/api/mcp/servers` | 注册一个 Streamable HTTP server；新连接默认关闭 |
| `PATCH` | `/api/mcp/servers/:id` | 修改名称、URL、token、headers、启用与自主策略 |
| `DELETE` | `/api/mcp/servers/:id` | 删除配置与对应 secret，并热加载 Gateway |
| `POST` | `/api/mcp/servers/:id/test` | 对保存的配置执行真实握手 + `tools/list`；关闭的 server 也可测试，结束后恢复关闭状态 |
| `GET` | `/api/mcp/servers/:id/tools` | 读取 ready server 的工具摘要；普通设置页只展示名称 / 描述，不渲染原始 schema |

保存、启停、删除都会先更新 SQLite，再通过 `McpGateway.replaceServers()` 关闭旧连接、重建注册表并重新诊断。单个外部 server 失败不会拖住主 HTTP 服务。

握手与首次 `tools/list` 有 15 秒上限；失联地址会进入 `error` 并返回可读原因，不会让设置页一直等 SDK 默认网络超时。

## 3. Gateway 状态与安全边界

每个 server 使用 `disconnected → connecting → handshake → ready / error` 状态机。`enabled=false` 时不握手、不进入工具面；未配置 URL 与连接异常分别显示为“未配置”和“异常”。

当前 `allowAutonomous` 是服务端保存的权限策略元数据，用于后续 Capability / Tool Binding 切片；**T-059 不把任意 MCP 原始工具自动暴露给模型**。用户显式工具调用仍沿用既有 `/api/tools` 与 `/api/tools/call`，后续接入自主工具时必须再经过能力白名单、确认级别与审计规则。

当前只支持官方 SDK 的 Streamable HTTP transport；stdio / 本地进程托管、工具参数编辑、OAuth、自动重试策略和细粒度工具级授权留在后续切片。

## 4. 诊断

握手和 `tools/list` / `tools/call` 继续写入 `mcp_diagnostic_log`。诊断页可查看失败原因和延迟；SDK 当前不提供可靠 HTTP 状态码，因此 `httpStatus` 允许为空。凭据不进入诊断内容，也不打印到前端。
