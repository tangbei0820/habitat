# AI_RUNTIME · AI 运行时（能力 / 上下文 / 工具）

> 状态：**Phase 6.5 · P0 已落地**（能力注册 / 运行时上下文 / 工具绑定 / 工具认知闭环）。
> P1（Event Inbox、日记权限、留言板 Tool）与 P2（LLM 页面 App Launcher、头像开关）尚未开始。
>
> 这份文档回答一个问题：**AI 凭什么知道自己会什么、又凭什么真的做到。**
> 它存在的理由就是本 Phase 要修的那个现象 —— 工具明明执行成功，模型下一轮却说
> 「我没有调用外部工具的能力」。

---

## 0. 为什么会有这一层

在引入之前，服务端的行为是这样的：

| 环节 | 之前 | 后果 |
| --- | --- | --- |
| 传给模型的 `tools` | **从来不传** | 模型压根不知道存在工具 |
| 模型返回的 `tool_calls` | **明确丢弃**（`chat.ts` 注释写着「本层不转发」） | 即使传了也接不住 |
| system prompt | **服务端不构造** | 人格 / 能力说明全靠前端塞进 `messages` |
| 能成功的「工具调用」 | 用户从 Mini Terminal **手动**发起 | 模型只看到一条结果消息，从没人告诉它自己有这能力 |

所以模型否认自己有工具时，它是**诚实的** —— 它的上下文里确实没有这条信息。
这一层要做的是把「声明」与「事实」对齐，而不是劝模型相信自己会什么。

---

## 1. 三个概念，别混

| 层 | 位置 | 回答什么 | 变不变 |
| --- | --- | --- | --- |
| **声明** | `shared/capabilities.ts` | 有哪些能力、自主级别、绑什么工具名 | 静态，随版本走 |
| **判定** | `server/src/capabilities/registry.ts` | **此刻**能用哪几个（依赖就绪吗） | 运行时，带缓存 |
| **绑定与执行** | `server/src/capabilities/tools.ts` | 把能用的变成 function definition，并真的调 | 运行时 |

**只有「判定」的结果可以对外断言「AI 现在会不会做这件事」。** 声明里写着 `memory.search`
不代表这个实例真能搜 —— 实例没配时它 `enabled=false`，于是**根本不会**进 `tools` 参数。
模型看不到它，就不可能去调一个不存在的东西。这是「不伪造能力」的落点。

---

## 2. Capability Registry

### 2.1 自主级别（`autonomy`）

「能调」不是二值的 —— 读记忆和写留言板的风险完全不同，用一个开关管会把安全的那半也锁死。

| 级别 | 含义 | 本阶段实况 |
| --- | --- | --- |
| `autonomous` | AI 可自主调用，无需用户在旁 | 只读三能力 + `tools.list` |
| `confirm` | 须先过用户确认卡 | **已声明，但一律不绑**（协议未落地） |
| `user-only` | 仅用户可发起 | 保留语义 |
| `unavailable` | 依赖未就绪 / 阶段未实施 | 写类能力当前全在这个状态 |

### 2.2 当前能力表

| id | 模块 | 自主级别 | 绑定工具 | 状态 |
| --- | --- | --- | --- | --- |
| `memory.read` | memory | autonomous | `memory_read` | 可用（需 Nocturne ready） |
| `memory.search` | memory | autonomous | `memory_search` | 可用（需 Nocturne ready） |
| `memory.write` | memory | confirm | — | 未实施（本阶段只读接入） |
| `state.read` | state | autonomous | `state_read` | 可用（需 Eventide） |
| `diary.create/update/list_own/read_own` | diary | — | — | P1 |
| `diary.allow_access/deny_access` | diary | — | — | P1 |
| `messageboard.write` | board | confirm | — | P1 |
| `tools.list` | tools | autonomous | `tools_list` | 可用 |

### 2.3 工具名为什么不等于 MCP 工具名

AI 说「读记忆」时不该知道后端用的是 `breath` 还是别的。映射写在
`server/src/providers/nocturne-memory.ts` 的 `NOCTURNE_TOOLS` 表里 —— 实例换工具面时，
AI 那边**零感知**。这条在 T-031（工具面 0/5 命中）之后才变成硬约束。

---

## 3. Runtime System Context

每轮聊天送给模型的 system 段按**固定顺序**拼装（`context/chat-context.ts`）：

```
[前端带来的人格 / 世界书]        ← 最高优先级，原样保留
[runtime_rules]                  ← 恒定：规则三条
[runtime_capabilities]           ← 由 Registry 生成（**不许写死**）
[nocturne_memory]                ← 仅会话开头注入一次
[eventide_state]                 ← 每轮
[对话历史]
```

规则段（`RUNTIME_RULES_TEXT`）里三条直接对应本 Phase 的病灶：

- 以「当前可用能力」为准，不凭印象猜测自己的本事
- **已执行完的工具调用是既成事实**，不许否认
- 需要某项能力时**直接发起调用**，不要只说「我这就去查」

能力段只渲染 `enabled` 的项。一项都没有时也返回**非空文本**明确说「现在没有」——
什么都不说会让模型退回去用自己的先验猜。

各段都是**增强项**：任一环节失败降级为「少一段」，绝不阻塞回复。

---

## 4. 工具调用闭环

```
POST /api/chat
  → 能力快照（Registry）
  → 绑成 tools（只收 enabled + autonomous）
  → stream 一轮
      ├─ 无 tool_calls → 正常收口
      └─ 有 tool_calls → 执行 → 回灌 → 再 stream（最多 3 轮）
```

### 4.1 为什么不能把 `delta.toolCalls` 转发给前端

上游按 `index` 分片下发参数，任何中间时刻拿到的都是**半截 JSON**。
服务端负责攒齐（`lib/tool-call-accumulator.ts`），只把**执行结果**以 `tool-call` 帧发给前端。

### 4.2 传回上游时必须原样回传 `tool_calls`

`role='tool'` 消息在协议上依赖它前面那条带 `tool_calls` 的 assistant 消息。
少了它，OpenAI / DeepSeek 直接 400 —— 工具循环第二轮必然失败。
（这是 P0 施工时真实踩到的 bug：`openai-compat.ts` 的序列化只映射了 `tool_call_id`，
漏了 `tool_calls`。本地 mock 上游加了同样的 400 校验才把它拦住。）

### 4.3 失败也是信息

工具失败**不抛异常**，而是降级成一次 `ok:false` 的调用结果回灌给模型 ——
它得知道刚才那次没成功，才能决定重试还是换条路。抛异常只会让整轮变成一条错误，
模型永远学不到这件事。

### 4.4 轮次上限

`MAX_TOOL_ROUNDS = 3`。模型可能陷入「调工具 → 看结果 → 再调同样的工具」的打转，
每一轮都是真金白银。到顶后停止续跑并 warn —— 已有内容照常返回，只是不再给它机会。

---

## 5. 状态可读化（`shared/state-summary.ts`）

Eventide 下发的是**任意结构的 JSON**，只有 `stateCard` 是字符串且可能为 null。
谁直接渲染 `state` 谁就得到 `[object Object]`。所以有一层统一的
`raw → normalized → human-readable`：

- `describeValue()` 是**唯一**允许接触「值可能是对象」的地方，出了它就只有字符串
- `describeState()` 给出 `headline`（卡片标题）/ `text`（进上下文）/ `fields`（归一化字段表）
- `stateCard` 优先，结构化字段只做补充

放 `shared/` 是为了**服务端与前端口径一致**：AI 读到的和用户在界面上看到的是同一份事实。

---

## 6. 怎么复验

```bash
# 纯逻辑 + HTTP 全链（需 mock MCP :3333 + mock 上游 :3334 + server :3100）
cd server && npx tsx scripts/probe-ai-runtime.ts

# 上下文注入顺序（需 mock 上游 + server；加 EVENTIDE_URL 可验注入态）
cd server && EXPECT_EVENTIDE=injected npx tsx scripts/probe-chat-context.ts
```

`probe-ai-runtime.ts` 覆盖：分片累加器边界 / 状态可读化不出现 `[object Object]` / 工具绑定只收真可用的 /
能力快照不许静默 / 工具调用闭环（成功与失败两条路） / 上游报文里 `tool_calls` 确实回传 /
`tools_list` 自我认知 / `state_read` 摘要可读 / 普通聊天不受影响。

⚠️ 前两节**不需要服务**（纯逻辑），后面才打 HTTP —— server 没起也能先看纯逻辑过不过。

---

## 7. 待办（不在 P0 范围，已记 TASKS）

- `FIELD_LABELS` 词典**未与真实 Eventide 的键集核对过**（键名不符时自动回退原键名，不会显示错值）
- 工具卡片与助手气泡的时间顺序（见 `DATA_MODEL.md` §3.2 末）
- 确认卡（`confirm` 级别）与逐次授权协议 —— 落地前写类工具一律不绑
- `docs/PRODUCT_SPEC.md` §9.7「AI 自主工具调用暂不启用」需要随本层落地而订正
