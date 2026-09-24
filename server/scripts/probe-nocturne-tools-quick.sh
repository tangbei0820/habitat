#!/usr/bin/env bash
# Nocturne MCP 工具面事实采集 —— **超轻量版**（只要 curl + python3，不落任何代码文件）
#
# 场景：在**服务器**上、手边没有 habitat 仓库，也不想粘贴上百行的脚本。
#       这段直接整块粘贴就能跑，输出：服务端自报的名字/版本 + 全部工具及其参数 + 对照表。
#
# 用法：
#   bash probe-nocturne-tools-quick.sh                          # 默认 http://127.0.0.1:8000/mcp
#   bash probe-nocturne-tools-quick.sh http://127.0.0.1:8000/mcp
#   bash probe-nocturne-tools-quick.sh 'https://beiyan.cc/mcp-<密钥>'   # 走公网才要密钥路径
#
# ★ 只做 initialize 握手 + tools/list。**不调用任何工具**，不会读写记忆。
#
# 用途 = **工具面漂移检测**（2026-09-24 那次侦察已收敛）：
#   实例真实工具面 9 个：breath / trace / hold / wander / wander_mark / drive /
#   undercurrent / trail_delta / trail_family；Habitat 只依赖 breath + trace。
#   ⚠️ 本脚本不替代验收 —— 只读链路端到端验收是 scripts/probe-memory.ts。
#
# 三个脚本的分工（输出口径一致，随便挑）：
#   probe-nocturne-tools.ts              开发机（要仓库 + tsx），输出最全
#   probe-nocturne-tools-standalone.mjs  任何有 Node 18+ 的机器，零依赖
#   probe-nocturne-tools-quick.sh        本文件：只要 curl + python3，最短

set -u

URL="${1:-http://127.0.0.1:8000/mcp}"

# 临时文件目录：优先 TMPDIR，且必须已存在（Git Bash 下 /tmp 未必可写，
# 直接用 `-D /tmp/x` 会被 MSYS 路径转换坑到，导致后面重定向读不到文件）。
TMPD="${TMPDIR:-/tmp}"
if [ ! -d "$TMPD" ] || [ ! -w "$TMPD" ]; then
  TMPD=$(mktemp -d 2>/dev/null || echo ".")
fi
HDR="$TMPD/nocturne-init-hdr.txt"
BODY="$TMPD/nocturne-init-body.txt"
RAW="$TMPD/nocturne-tools-raw.txt"

PY=$(command -v python3 || command -v python)
if [ -z "${PY}" ]; then
  echo "✖ 没找到 python3 —— 改用同目录的 probe-nocturne-tools-standalone.mjs（只要有 node）" >&2
  exit 1
fi

hint() {
  echo "   1) 容器活着吗 → docker ps | grep -i nocturne" >&2
  echo "   2) 端口通吗   → curl -i http://127.0.0.1:8000/dashboard" >&2
  echo "   3) 路径对吗   → 内网直连用 /mcp；走公网才用 /mcp-<密钥>" >&2
}

# ① 握手：header 存一份（取会话 id），body 存一份（取 serverInfo）
if ! curl -s --max-time 20 -D "$HDR" -o "$BODY" -X POST "$URL" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"habitat-probe","version":"1"}}}'
then
  echo "✖ 连不上 ${URL} —— 按这三步查：" >&2
  hint
  exit 1
fi

SID=$(tr -d '\r' < "$HDR" | awk 'tolower($1)=="mcp-session-id:"{print $2}')
if [ -z "${SID}" ]; then
  echo "✖ 没拿到 mcp-session-id（HTTP 层面通了，但服务端没给会话）" >&2
  echo "   常见原因：反代 502（后端没起）、路径不对、或对面不是 MCP 端点。" >&2
  echo "   原始响应前 400 字：" >&2
  head -c 400 "$BODY" >&2
  echo >&2
  hint
  exit 1
fi

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
"$PY" - "$BODY" "$RAW" << 'PYEOF'
import json, sys


def parse(raw):
    """响应可能是纯 JSON，也可能是 SSE（若干行 `data: {...}`）。"""
    raw = raw.strip()
    if raw == '':
        return None
    try:
        return json.loads(raw)
    except Exception:
        pass
    for line in raw.splitlines():
        if line.startswith('data:'):
            try:
                j = json.loads(line[5:].strip())
                if isinstance(j, dict) and ('result' in j or 'error' in j):
                    return j
            except Exception:
                pass
    return None


init = parse(open(sys.argv[1], encoding='utf-8').read()) or {}
res = init.get('result') or {}
si = res.get('serverInfo') or {}
print(f"\n服务端    : {si.get('name', '?')} v{si.get('version', '?')}")
print(f"协议版本  : {res.get('protocolVersion', '?')}")

tools_raw = open(sys.argv[2], encoding='utf-8').read()
tools = ((parse(tools_raw) or {}).get('result') or {}).get('tools') or []
if not tools:
    print('\n没解析出工具。原始响应前 1500 字：')
    print(tools_raw[:1500])
    raise SystemExit(0)

# 适配层 server/src/providers/nocturne-memory.ts 的 NOCTURNE_TOOLS 映射表
expected = ['breath', 'trace']

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
print('与适配层依赖的 2 个名字对照：')
for n in expected:
    print(f"  {'OK  ' if n in names else '缺失'} {n}")
extra = [t.get('name') for t in tools if t.get('name') not in expected]
if extra:
    print(f"\n实例有、适配层不用的 {len(extra)} 个：{'、'.join(extra)}")

hit = len([n for n in expected if n in names])
if hit == len(expected):
    print(f'\n结果：{hit}/{len(expected)} 全对上 —— 工具面无漂移。')
    print('端到端验收请跑 scripts/probe-memory.ts（本脚本只做事实采集）。')
else:
    print(f'\n结果：{hit}/{len(expected)} 命中 —— 工具面漂移，要重定映射，不是改字符串。')
    print('请把上面这份完整输出贴回 habitat 仓库。')
PYEOF
