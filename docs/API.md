# API · 接口约定

> 施工依据：`栖息地初版技术方案分析.md` §7.2②（MCP Gateway 与诊断）、§8（页面）。  
> 本文件只记「面向前端的实际契约」；新增 / 修改接口必须同步此处。

所有响应：成功直接返回数据体；失败统一为 `ApiError` 形状（见 `shared/errors.ts`）：

```json
{ "error": { "code": "MCP_HANDSHAKE_FAILED", "message": "…", "detail": "…" } }
```

## Phase 0 已实现

### `GET /api/health`

服务存活探测。设置页「系统状态」数据源。

```json
{ "ok": true, "service": "habitat-server", "time": "2026-09-22T14:53:23.907Z" }
```

### `GET /api/health/mcp`

MCP Gateway 聚合健康。设置页「MCP 工具网关」数据源。

```json
{
  "ok": true,
  "servers": [
    { "serverId": "nocturne", "state": "ready", "toolCount": 1, "lastError": null, "lastCheckedAt": 1790085236155 }
  ]
}
```

- `state` 取值：`disconnected` / `connecting` / `handshake` / `ready` / `error`（状态机见 `server/src/mcp/gateway.ts`）
- 单 server 握手失败**不阻塞**服务启动，只把 `state` 置 `error` 并落诊断表
- 每次握手与工具调用全量写入 SQLite `mcp_diagnostic_log`（原因可逐请求回放）

## 待实现（按阶段）

- Phase 1：Chat 会话 / 消息 / SSE 流式
- Phase 3A：记忆检索与写入（经 MCP）
- Phase 4：Life 统计 / 账本 / 通知
