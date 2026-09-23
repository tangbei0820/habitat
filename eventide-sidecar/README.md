# Eventide sidecar

栖息地对 [Eventide](https://github.com/chuli1122/Eventide) 的极薄 HTTP 包装。

- sidecar **不落用户数据**：每次由 habitat-server 传入旧状态并接回新状态。
- habitat-server 的 SQLite 是唯一持久化源；sidecar 重启不会丢进度。
- 当前只开放 `/health` 与 `/v1/tick`。事件、梦境、互动结算和主动调度留给后续切片。
- Eventide 固定在 `requirements.txt` 的 commit，避免上游内部结构静默变化。

本地启动：

```bash
python -m venv .workbuddy/eventide-venv
.workbuddy/eventide-venv/Scripts/python -m pip install -r eventide-sidecar/requirements.txt
.workbuddy/eventide-venv/Scripts/python -m uvicorn app:app --app-dir eventide-sidecar --host 127.0.0.1 --port 8234
```

随后给 habitat-server 配置 `EVENTIDE_URL=http://127.0.0.1:8234`。

Eventide 使用 PolyForm Noncommercial 1.0.0；栖息地是个人非商业项目。本目录没有复制 Eventide 源码。
