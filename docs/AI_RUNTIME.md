# AI_RUNTIME · AI 运行时（能力 / 上下文 / 工具）

> 状态：**Phase 6.5 · P2 已落地**（LLM 页面 App Launcher 呈现能力面 + Chat 头像开关）。
> 此前 P0（能力注册 / 运行时上下文 / 工具绑定 / 工具认知闭环）与
> P1（Event Inbox / 日记权限流转 / 日记·留言板 Tool / **挂起式确认卡**）均已完成。
> **P2 只动呈现层，不动执行层。**
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
| `autonomous` | AI 可自主调用，无需用户在旁 | 记忆读 / 记忆搜 / 状态读 / 日记的读与列 / 允许·拒绝查看 / 留言板写入与修改 / `tools.list` |
| `confirm` | 须先过用户确认卡 | **已绑给模型**（P1）：调用不会执行，而是**挂起**成一条待确认事件 |
| `user-only` | 仅用户可发起 | 保留语义；**不绑** —— 连「怎么调」都不让模型知道 |
| `unavailable` | 依赖未就绪 / 阶段未实施 | `memory.write`（实例的写工具未接入） |

> ⚠️ P0 时 `confirm` 一律不绑（那时协议没落地，放给模型等于没闸门）。
> **P1 起要绑** —— 不绑模型就永远不知道「我可以请求写日记」，它会以为这件事根本做不到。
> 闸门从「不给它知道」移到了**执行层**：见 §4.5。

### 2.2 当前能力表

| id | 模块 | 自主级别 | 绑定工具 | 状态 |
| --- | --- | --- | --- | --- |
| `memory.read` | memory | autonomous | `memory_read` | 可用（需 Nocturne ready） |
| `memory.search` | memory | autonomous | `memory_search` | 可用（需 Nocturne ready） |
| `memory.write` | memory | confirm | — | 未实施（本阶段只读接入） |
| `state.read` | state | autonomous | `state_read` | 可用（需 Eventide） |
| `diary.create` | diary | autonomous | `diary_create` | 可用 · 立即写入小栖私密日记 |
| `diary.update` | diary | autonomous | `diary_update` | 可用 · 立即修改小栖私密日记 |
| `diary.list_own` | diary | autonomous | `diary_list_own` | 可用 |
| `diary.read_own` | diary | autonomous | `diary_read_own` | 可用 |
| `diary.allow_access` | diary | autonomous | `diary_allow_access` | 可用（AI 自己决定整篇或指定片段放不放） |
| `diary.deny_access` | diary | autonomous | `diary_deny_access` | 可用（整篇或指定片段） |
| `diary.set_fragment_visibility` | diary | autonomous | `diary_set_fragment_visibility` | 可用；只改变指定片段，默认私密 |
| `messageboard.write` | board | autonomous | `messageboard_write` | 可用 · 立即写入小栖留言 |
| `messageboard.update` | board | autonomous | `messageboard_update` | 可用 · 只能修改小栖自己的留言 |
| `web.search` | web | user-only（本轮授权后临时 autonomous） | `web_search` | 仅聊天显式联网搜索入口可用；普通聊天 / 后台自动化不开放 |
| `sticker.search` | tools | autonomous | `sticker_search` | 本轮有本地图库元数据时可用；只检索，不发送 |
| `sticker.send` | tools | autonomous | `sticker_send` | 本轮有本地图库元数据时可用；一次选择一张 |
| `tools.list` | tools | autonomous | `tools_list` | 可用 |

> 日记 / 留言板的能力**没有外部依赖**（权威存储就是本机 SQLite，见 `DATA_MODEL.md` §11），
> 所以它们只受「阶段是否实施」约束 —— 这也是 `registry.ts` 里 `NOT_IMPLEMENTED_YET`
> 从八条缩到一条的原因。

### 2.3 工具名为什么不等于 MCP 工具名

AI 说「读记忆」时不该知道后端用的是 `breath` 还是别的。映射写在
`server/src/providers/nocturne-memory.ts` 的 `NOCTURNE_TOOLS` 表里 —— 实例换工具面时，
AI 那边**零感知**。这条在 T-031（工具面 0/5 命中）之后才变成硬约束。

---

## 3. Runtime System Context

每轮聊天送给模型的 system 段按**固定顺序**拼装（`context/chat-context.ts`）：

```
[前端带来的人格 / 世界书]        ← 最高优先级，原样保留
[runtime_rules]                  ← 恒定：能力闭环规则 + 思绪三路分流规则
[runtime_capabilities]           ← 由 Registry 生成（**不许写死**）
[nocturne_memory]                ← 仅会话开头注入一次
[runtime_events]                 ← 待 AI 决策的请求 + 上次请求的结果（仅 P1 起，有事才注入）
[eventide_state]                 ← 每轮
[对话历史]
```

规则段（`RUNTIME_RULES_TEXT`）里的能力闭环与思绪分流规则直接对应当前运行边界：

- 以「当前可用能力」为准，不凭印象猜测自己的本事
- **已执行完的工具调用是既成事实**，不许否认
- 需要某项能力时**直接发起调用**，不要只说「我这就去查」
- 可选用 `[[思考：…]]` 输出角色内心；服务端将其独立为 `thought` SSE，不能把供应商原生 reasoning 当成公开心声

能力段只渲染 `enabled` 的项。一项都没有时也返回**非空文本**明确说「现在没有」——
什么都不说会让模型退回去用自己的先验猜。

各段都是**增强项**：任一环节失败降级为「少一段」，绝不阻塞回复。

### 3.1 显式联网搜索授权

`web.search` 是刻意保留的 `user-only` 能力：聊天输入区的“联网搜索”入口把原问题作为
`ChatStreamRequest.webSearch.query` 送入服务端，服务端只在这一轮把该能力临时提升为
`autonomous` 并注入一条授权 system 段。普通聊天、主动唤醒与 Solitude 不会因为注册表
存在该项而自行出网。搜索结果以不可信资料回灌 `role=tool`，前端同时落一张工具卡；
失败也必须回灌失败事实，不能让模型凭空编造搜索结论。

### 3.2 本地表情图库的按轮绑定

表情包图片属于浏览器本地数据，不上传服务端。聊天请求只带最多 100 项的名称 / 分类 / 标签元数据快照；服务端据此临时绑定 `sticker.search` 与 `sticker.send`，请求没有本地图库时两项工具完全不进入本轮工具列表。搜索结果只返回可读元数据和稳定 id，发送工具再次校验 id 必须来自本轮快照，并在成功帧中返回 `stickerId`。前端收到成功帧后从本地图库取图片，按发送时的名称 / 标签 / 图片快照写入独立 `sticker` 消息，因此图库条目后来删除也不会破坏历史消息。找不到条目、图库变更或发送失败时均返回 `ok:false` / 明确提示，不制造空白图片或“已发送”的假成功；模型可以选择 no-op，不能把表情包当成每轮必做动作。

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

### 4.5 确认卡：**挂起，而不是暂停流**

`confirm` 级工具（见 §2.1）要用户点头才能执行。实现它有一条**不能选的路**：
在流里停下来等用户点按钮。

不能选的理由是硬的：
- SSE 是**单向**的，服务端没有回传通道，等不到那个点击；
- 就算挂得住，用户刷新一下、关掉页面，这次生成就废了；
- 服务端**不存聊天记录**（§6.2），没有「上次挂到哪」可以恢复。

所以走的是**挂起式**，把「决定」与「执行」拆成两次独立请求：

```
模型调 diary_create
  → 服务端**不执行**，只建一条待确认事件（decider = user）
  → 回灌给模型：「已提请北北确认 …… 这次调用还没有执行」
  → 同时发 tool-call 帧（带 eventId）→ 前端渲染确认卡按钮
用户点「允许」
  → POST /api/inbox/:id/decide → 服务端**这时才写日记** → 事件转 approved
  → 卡片自己刷新成「你已允许」
下一轮对话
  → 结果经 [runtime_events] 段注入模型：「北北已确认，日记《…》已写入」
```

三个容易做错的地方：

1. **回灌文本必须明确说「还没执行」**。含糊其辞，模型下一轮就会宣称「我已经写好了」——
   而北北还没点。那正是本 Phase 要修的「说的和事实不符」。
2. **挂起算 `ok: true`**。它不是失败。回灌成失败，模型会以为要重试 ——
   于是北北收到一串一模一样的确认卡。
3. **参数不合法时不挂事件**，当场以 `ok: false` 回灌。挂一张注定失败的卡，
   只是让用户白点一次；模型自己改一个字就能过。

### 4.6 事件段（`context/event-context.ts`）

确认卡是异步的，模型发起之后那一轮就结束了。**得有渠道把结果带回来**，
否则它会顺着往下编（「我写的日记你看到了吗」）—— 它不是撒谎，是真的不知道。

两种段、两种送达策略：

| 段 | 内容 | 注入频率 |
| --- | --- | --- |
| `# 等待你决定的事` | `decider='companion'` 且 `pending` 的事件 | **每轮**（本来就是还没做的事，重复提醒是对的） |
| `# 你之前那些请求的结果` | 已决、且结果尚未送达的事件 | **只一次**，之后标记 `resultDeliveredAt` |

⚠️ 那个标记**不在组装上下文时打**，而是由 `routes/chat.ts` 在响应头真的发出之后调
`markResultsDelivered()`。在组装时打会漏掉一种情况：上游密钥没配 / 不可达时，
组装早就跑完了、标记也打了，但本轮根本没发出去 —— 模型永远失去那条信息。

### 4.7 两个决策方向（Event Inbox 是双向的）

| 事件类型 | 谁发起 | **谁决定** | 决定后发生什么 |
| --- | --- | --- | --- |
| `tool_confirm` | AI 想写日记 / 留言 | **北北**（`decider='user'`） | 真写入（允许）或什么都不做（拒绝） |
| `diary_access_request` | 北北想看某篇私密日记 | **AI**（`decider='companion'`） | 该篇转 `open`（允许）或保持私密（拒绝） |

两个方向**都有权限检查，且方向相反**：
- 北北不能替 AI 决定放不放日记（那等于自己给自己开门）——HTTP 端点会拒绝 `decider` 不匹配的请求；
- AI 不能替北北确认「北北同意写这篇日记」——工具层硬编码 `decider='companion'`，模型传不进来。

这条是 P1 最该守住的东西（`probe-event-inbox.ts` 里专门有一条断言盯着它）。

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

# P1：事件收件箱 / 日记权限流转 / 日记·留言板工具（一键：bash .workbuddy/run-p1-probe.sh）
cd server && npx tsx scripts/probe-event-inbox.ts

# P2 呈现层（LLM 档案页 / 头像开关）——前端，需 server + vite + 无头 Edge
node web/scripts/verify-llm.mjs          # 含在 bash .workbuddy/run-front-verify.sh 里
```

`probe-event-inbox.ts` 盯的是**三条不能破的边界**，而不是接口通不通：
挂起时日记**还没被写** · 决策**只能做一次** · 北北**不能替 AI 决定**放不放日记。
另加一条链路证明：模型真能从聊天流里调通这些工具（光有工具定义不算）。

⚠️ mock 上游的工具触发支持带参数：`[[tool:diary_create {"title":"…","content":"…"}]]`。
没有它写类工具永远验不了 —— 它们的参数是必需的。

`probe-ai-runtime.ts` 覆盖：分片累加器边界 / 状态可读化不出现 `[object Object]` / 工具绑定只收真可用的 /
能力快照不许静默 / 工具调用闭环（成功与失败两条路） / 上游报文里 `tool_calls` 确实回传 /
`tools_list` 自我认知 / `state_read` 摘要可读 / 普通聊天不受影响。

⚠️ 前两节**不需要服务**（纯逻辑），后面才打 HTTP —— server 没起也能先看纯逻辑过不过。

---

## 7. 界面呈现（P2）：LLM 页面 = 小栖档案

P0 / P1 把「声明 → 判定 → 工具 → 确认卡 → 事件回灌」这条链修通了，但**用户看不见**。
P2 负责把它摆到台面上 —— **只动呈现层，执行层一行没改**。

| 位置 | 做什么 | 数据来源 |
| --- | --- | --- |
| `/llm` 小栖档案 | 按模块分组的**能力卡片**（App Launcher）：卡内逐条列出能力、自主级别、绑定的工具名；不可用的**必须给原因** | `GET /api/capabilities`（与 system context / tool schemas **同一份**快照） |
| Chat 气泡 | 两侧头像（用户 / 小栖），可整体隐藏 | 全局显示偏好 `useChatDisplay`（localStorage） |

三条硬约束（`PRODUCT_SPEC` §9.1）：

1. **不自带第二份能力清单。** 页面上的每个字都来自服务端快照。前端一旦写死文案，
   「界面说会、实际不会」就会重新长出来 —— 那正是本 Phase 要修的病。
2. **只读。** 没有「把某项能力打开」的开关：可用性由依赖真实情况判定，
   给一个手动开关会立刻把这份档案变成谎言。
3. **不做假入口。** 有界面的模块（日记 / 留言板 / 状态）可点进去；
   记忆与工具前端还没有页面，卡片明说「暂无界面」并讲清它发生在哪儿，**整张卡不可点**。

> ⚠️ **「有页面」与「现在可用」是两个独立事实**，别把它们绑在一起：
> 日记页在 AI 写不了日记时**照样存在**。入口有没有取决于「界面在不在」，
> 能力徽标才取决于「依赖就绪没有」。绑在一起，界面就会时而冒出入口、时而消失 ——
> 那比固定可见更难理解，也让验收无法在缺依赖的环境里复跑。

**头像为什么是全局偏好**：它是「看着顺不顺眼」，不是数据。所以存 localStorage、
**不落 Dexie、不进备份格式** —— 进了备份只会让「恢复备份」多出与内容无关的差异。
开关放在聊天设置里，但**不参与那个面板的保存语义**（点了立刻生效），并明说「影响所有会话」；
否则用户会以为「不点保存就不算数」。

---

## 8. 待办（不在 P0/P1/P2 范围，已记 TASKS）

- `FIELD_LABELS` 词典**未与真实 Eventide 的键集核对过**（键名不符时自动回退原键名，不会显示错值）
- 工具卡片与助手气泡的时间顺序（见 `DATA_MODEL.md` §3.2 末）
- **`memory.write` 仍未接入** —— Nocturne 实例的写工具（`hold`）没接，所以写记忆还是 `unavailable`。
  真要写时按 `hold` 的 `kind` 设计入参（见 `docs/MEMORY.md`）
- 确认卡的**过期 / 撤回**未做：挂了很久的请求会一直留在收件箱里（目前无害，但该有个上限）
- `docs/PRODUCT_SPEC.md` §9.7「AI 自主工具调用暂不启用」需要随本层落地而订正
- **记忆与工具仍没有界面**（P2 起在档案页标注「暂无界面」）：记忆是只读的 `breath` / `trace`，
  工具是 Mini Terminal 与聊天里的工具卡片。要给它们做页面的话，得先想清楚「用户拿它做什么」
- 确认卡的**前端交互**仍无自动化覆盖（前端脚本不接 mock 上游，触发不了工具调用）
