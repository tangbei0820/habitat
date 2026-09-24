#!/usr/bin/env bash
# Nocturne MCP 工具面侦察 —— **超轻量版**（只要 curl + python3，不落任何文件）
#
# 场景：在**服务器**上、手边没有 habitat 仓库，也不想粘贴上百行的脚本。
#       这段直接整块粘贴就能跑，输出正好是「有哪些工具、各要什么参数」。
#
# 用法：
#   bash probe-nocturne-tools-quick.sh                          # 默认 http://127.0.0.1:8000/mcp
#   bash probe-nocturne-tools-quick.sh http://127.0.0.1:8000/mcp
#   bash probe-nocturne-tools-quick.sh 'https://beiyan.cc/mcp-<密钥>'   # 走公网才要密钥路径
#
# ★ 只做 initialize 握手 + tools/list。**不调用任何工具**，不会读写记忆。
#
# 三个侦察脚本的分工（输出口径一致，随便挑）：
#   probe-nocturne-tools.ts           开发机（要仓库 + tsx），输出最全（serverInfo / 对照表）
#   probe-nocturne-tools-standalone.mjs  任何有 Node 18+ 的机器，零依赖，输出同上
#   probe-nocturne-tools-quick.sh     本文件：只要 curl + python3，最短

set -u

URL="${1:-http://127.0.0.1:8000/mcp}"
RAW=/tmp/nocturne-tools-raw.txt
PY=$(command -v python3 || command -v python)
if [ -z "${PY}" ]; then
  echo "✖ 没找到 python3 —— 用同目录的 probe-nocturne-tools-standalone.mjs 代替（只要有 node）" >&2
  exit 1
fi

# ① 握手，从响应头取 mcp-session-id（Streamable HTTP 的会话标识）
SID=$(curl -si --max-time 20 -X POST "$URL" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"habitat-probe","version":"1"}}}' \
  | tr -d '\r' | awk 'tolower($1)=="mcp-session-id:"{print $2}')

if [ -z "${SID}" ]; then
  echo "✖ 没拿到 mcp-session-id —— 按这三步查：" >&2
  echo "   1) 容器活着吗 → docker ps | grep -i nocturne" >&2
  echo "   2) 端口通吗   → curl -i http://127.0.0.1:8000/dashboard" >&2
  echo "   3) 路径对吗   → 内网直连用 /mcp；走公网才用 /mcp-<密钥>" >&2
  exit 1
fi
echo "会话 ID: ${SID}"

# ② 发 initialized 通知（多数实现不强制，失败也不影响下面的 list）
curl -s --max-time 20 -X POST "$URL" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: ${SID}" -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  > /dev/null 2>&1 || true

# ③ 拉工具清单
curl -s --max-time 20 -X POST "$URL" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: ${SID}" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' > "$RAW"

# ④ 解析（兼容纯 JSON 与 SSE 分帧）
"$PY" - "$RAW" << 'PYEOF'
import json, sys

raw = open(sys.argv[1], encoding='utf-8').read()
data = None
try:
    data = json.loads(raw)
except Exception:
    for line in raw.splitlines():
        if line.startswith('data:'):
            try:
                j = json.loads(line[5:].strip())
                if isinstance(j, dict) and ('result' in j or 'error' in j):
                    data = j
                    break
            except Exception:
                pass

tools = ((data or {}).get('result') or {}).get('tools') or []
if not tools:
    print('没解析出工具。原始响应前 1500 字：')
    print(raw[:1500])
    raise SystemExit(0)

# 适配层 server/src/providers/nocturne-memory.ts 里写死的 5 个名字
expected = ['read_memory', 'search_memory', 'create_memory', 'update_memory', 'delete_memory']

print(f'\n共 {len(tools)} 个工具 ——\n')
for t in tools:
    sch = t.get('inputSchema') or {}
    req = set(sch.get('required') or [])
    print(f"- {t.get('name')}")
    desc = (t.get('description') or '').replace('\n', ' ').strip()
    if desc:
        print(f"    说明: {desc[:110]}")
    props = sch.get('properties') or {}
    if props:
        parts = [f"{k}{'*' if k in req else ''}({(v or {}).get('type') or '?'})" for k, v in props.items()]
        print(f"    参数: {', '.join(parts)}     （* = 必填）")
    print()

names = {t.get('name') for t in tools}
print('与适配层写死的 5 个名字对照：')
for n in expected:
    print(f"  {'OK  ' if n in names else '缺失'} {n}")
extra = [t.get('name') for t in tools if t.get('name') not in expected]
if extra:
    print(f"\n实例有、适配层不知道的 {len(extra)} 个：{'、'.join(extra)}")
hit = len([n for n in expected if n in names])
print(f'\n结果：{hit}/5 命中。' + ('工具面完全不同 —— 要重定映射，不是改字符串。' if hit == 0 else ''))
PYEOF
