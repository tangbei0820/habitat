# 栖息地 · Post-v1 续建方案

> 状态：规划草案  
> 基线：T-050 完成、Habitat 已部署至 VPS  
> 用途：记录 Post-v1 的真实现状、主要缺口与推荐施工顺序。  
> 约束：本文是规划文件，不代表对应功能已经完成；实际进度仍以 `AGENTS.md` 与 `docs/TASKS.md` 为准。

## 1. 当前真实状态

栖息地当前已经具备可用的 Chat 主链、消息对象操作、跨模块内容收录、基础媒体能力、长期记忆读取、Eventide 状态注入、Capability Registry、模型工具调用闭环、Event Inbox、主动行为调度、生活记录与 PWA 部署能力。

但目前仍有一批“后端链路已接通、用户侧产品页面未完成”或“已有真实 CRUD，但尚未达到共同生活应用目标”的模块：

- Nocturne 已接入模型上下文和只读工具，但没有面向用户的完整记忆页面。
- Eventide 已进入每轮模型上下文，但用户侧只有较原始的 Runtime 状态视图。
- Wake、Solitude 能运行，但还不是统一的“多行动或 no-op”自主决策系统。
- AI 日记权限链路已经存在，但 AI 自主创作仍受确认流程限制。
- 一起听已经是真播放器，但仍依赖直链，没有共享播放状态和 AI 参与。
- 共读目前仍是读书笔记 CRUD。
- Life 有系统事件、API 用量、账本、钱包和通知，但尚未形成统一的共同生活时间线。
- Provider 仅支持 OpenAI-compatible；Codex Subscription Provider 尚未实现。

## 2. 模块现状

### 2.1 Chat

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 消息发送 / 流式 | ✅ 已完成 | 支持 SSE 正文、usage、reasoning 与工具调用增量 |
| 编辑 | ✅ 已完成 | 双方消息可编辑，旧正文进入统一版本链 |
| 撤回 | ✅ 已完成 | 留痕、可恢复，撤回正文不再进入模型上下文 |
| 删除 | ✅ 已完成 | 支持单条及批量删除与确认 |
| 收藏 | ✅ 已完成 | 从原消息直接创建 Bookmark，保留来源并处理重复 |
| 收录作品 | ✅ 已完成 | 从消息或组件创建 Artwork 快照并保留来源 |
| 图片加入相册 | ✅ 已完成 | 仅图片消息显示，直接保存图片并处理重复 |
| 多选 | ✅ 已完成 | 支持批量选择和删除 |
| 候选回复 | ✅ 已完成 | 换一个、候选切换和编辑历史共用版本链 |
| 工具调用卡 | ✅ 已完成 | 支持自主工具结果卡与待确认事件卡 |
| AI / 用户头像 | ⚠️ 不完整 | 仅默认文字头像和统一开关，没有上传或独立配置 |
| 昵称 | ⛔ 未实现 | 没有昵称数据和显示开关 |
| 会话分组 | ✅ 已完成 | 支持创建、改名、删除回落、折叠与移动 |
| 会话置顶 | ✅ 已完成 | 置顶优先于分组，取消后回到原分组 |
| 聊天设置 | ⚠️ 不完整 | 入口和基础设置已有，个性化能力不足 |
| 思绪 / reasoning | ⚠️ 不完整 | 已存入消息 metadata，但 ChatBubble 尚未渲染折叠卡 |
| 表情包 | ⚠️ 不完整 | 只有普通 emoji，没有 Sticker 数据与 AI Tool |
| 语音 | ⚠️ 基础可用 | 录音、ASR、语音消息、播放与 TTS 已有，Provider 配置不完整 |
| 通话 | ⛔ 未实现 | 没有实时双工、Streaming TTS 与连续麦克风输入 |
| 通知 | ⚠️ 不完整 | 有站内通知和 Web Push，缺分类偏好与 Quiet Hours |

### 2.2 Home

| 模块 | 当前实现 | AI Runtime | 判断 |
| --- | --- | --- | --- |
| 留言板 | 服务端真实 CRUD、来源与 Widget | `messageboard.write` 已存在但需用户确认 | 半接入 |
| 倒数日 | 本地真实 CRUD 与单实例 Widget | 无 | 基础应用完成 |
| AI 日记 | 服务端权限模型、封面、数量、查看申请与允许/拒绝 | 日记工具已存在，但创建和修改需确认 | 权限模型完成，自主创作未完成 |
| 收藏 | 分类、备注、来源与跨模块收录 | 无 | 基础应用完成 |
| 作品 | CRUD、元信息、来源与聊天收录 | 无 | 基础应用完成 |
| 相册 | 上传、分类、来源与聊天图片收录 | 无 | 基础应用完成 |
| 共读 | 书名、作者、状态、笔记 CRUD | 无 | 占位应用 |
| 一起听 | 直链音频真播放、控制与时长落盘 | 无共享状态和 AI 参与 | 半成品 |
| 学习 | 学习记录、每日任务与周统计 | 无 | 增强 CRUD |
| Widget | 留言板和倒数日单实例 | 无 | 基础机制完成 |

倒数日的当前问题主要是信息重复：Home Bento 已有倒数日入口或摘要，同时又可渲染倒数日 Widget。数据库层已经限制同类 Widget 单实例，因此优先修正展示逻辑，不需要为此升级 Dexie。

### 2.3 AI Runtime

已经完成：

- Capability Registry 是能力声明的单一来源。
- Runtime 会根据实际依赖生成能力快照，并同步用于 System Context、Tool Schema 与小栖档案。
- Nocturne 在新会话开头注入长期记忆，模型也可主动读取和搜索记忆。
- Eventide 状态卡每轮进入模型上下文。
- Event Inbox 可向模型传递待处理事件和异步确认结果。
- 工具循环支持碎片累积、多工具调用、成功或失败结果回传与最多三轮执行。
- 工具结果按 OpenAI 工具协议回放，已修复“工具执行成功后模型却声称没有工具能力”的核心问题。

当前工具绑定包括：

- `memory_read`
- `memory_search`
- `state_read`
- `diary_create`
- `diary_update`
- `diary_list_own`
- `diary_read_own`
- `diary_allow_access`
- `diary_deny_access`
- `messageboard_write`
- `tools_list`

尚未完成：

- `memory.write` 只有能力登记，没有实际工具绑定。
- `messageboard.write` 仍需用户确认，不符合最新自主留言要求。
- AI 创建和修改自己的日记仍需用户确认。
- Wake 当前是“触发通过后必生成一条消息并推送”，不能选择留言、日记、其它行动或 no-op。
- Solitude 当前只生成私密整理记录，没有自主上网、选题、去重与记忆沉淀。
- 工具卡的视觉顺序可能与模型真实输出顺序不一致。
- 确认卡没有过期和撤销机制，前端确认交互的自动化覆盖不足。

### 2.4 小栖档案

当前页面是只读 Capability Launcher，不是完整档案管理台。

| 模块 | 状态 |
| --- | --- |
| Memory | 有真实能力状态，无页面 |
| State | 有真实数据并跳转 Life Runtime，展示较原始 |
| Diary | 有真实应用入口 |
| Message Board | 有真实应用入口 |
| Tools | 有真实能力卡，无工具管理或历史页面 |
| Wake | 未进入档案页 |
| Solitude | 未进入档案页 |
| Worldbook | 未实现 |
| Wallet | 位于 Life，未进入档案页 |

### 2.5 Life

- 月历当前聚合服务端事件日志与 API usage，点击日期可查看系统事件和调用明细。
- Token、调用次数、模型和估算成本来自服务端 usage records。
- 小栖钱包有独立余额与流水，可手动追加收入或支出。
- 通知中心支持未读、单条已读、全部已读。
- Web Push 已通过 PWA Service Worker 与 VAPID 接入。
- Runtime 页面展示服务健康、Eventide payload、自动化策略和最近运行。

主要缺口：

- 月历仍偏“系统事件与消费日历”，不是完整的共同生活 timeline。
- 聊天、主动消息、留言、日记、一起听、共读、通话等尚未统一投影成 Life Event。
- 系统账本与虚拟钱包虽有独立数据，但 UI 信息架构仍混在同一视图。
- Eventide 普通 UI 直接字符串化 payload，嵌套对象可能出现 `[object Object]`。
- 没有状态趋势、最近变化和独立 raw state 高级页。

### 2.6 Provider / TTS

已有：

- OpenAI-compatible Adapter。
- 多 API Profile。
- 自定义 Base URL、模型列表和连接测试。
- chat、tts、transcription、vision、image、embedding 模型槽。
- 后端自定义 Headers 支持；前端只读 header 名称，不泄露值。
- 服务端密钥存储。
- TTS、ASR、视觉与图片生成媒体路由。

缺失：

- 前端没有自定义 Headers 编辑界面。
- 没有独立 TTS Provider、Voice 列表、语速、稳定性与 Test UI。
- 没有 ElevenLabs 专用 Adapter。
- 没有 Codex Subscription Provider、app-server 适配或 thread/session 映射。

## 3. 与最新需求的主要偏差

- AI 写留言当前仍需用户确认，最新要求是不需确认。
- AI 写自己的私有日记当前仍需用户确认。
- Wake 仍是固定消息生产器，不是多行动/no-op 决策器。
- reasoning 已存储但没有用户界面。
- 世界书没有数据模型、编辑页与 Runtime 装配。
- Setting 无法查看、编辑或恢复完整内置 Prompt。
- 用户头像、AI 头像和昵称没有独立配置与显示开关。
- 一起听和共读没有达到目标产品形态。
- Eventide 页面仍可能显示 `[object Object]`。
- Life 月历尚未覆盖完整共同生活事件。
- 通知缺少分类开关、Quiet Hours 和 Push Provider 配置。
- TTS 尚未形成 ElevenLabs 的完整设置与测试体验。
- 当前 dock 固定方式仍需根据最终目标重新确认。

## 4. 缺口矩阵

| 功能 | 当前状态 | 目标状态 | 缺失部分 | Schema | 后端 | AI Runtime | 风险 | 推荐阶段 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 身份、头像、昵称 | 默认头像 | 双方独立配置与显示开关 | 文件存储、偏好设置 | 是 | 少量 | 否 | 中 | 7A |
| Reasoning 卡 | 已存未显示 | 每轮可折叠查看 | 展示、安全边界 | 否 | 否 | 少量 | 中 | 7A |
| Prompt / Worldbook | 未实现 | 可查看、编辑、恢复并进入上下文 | 版本、作用域、优先级 | 是 | 是 | 是 | 高 | 7A |
| Nocturne 页面 | 无 UI | 摘要、搜索、详情、来源、状态与健康 | 产品化适配 API | 可选 | 是 | 是 | 中 | 7A |
| Eventide 页面 | 原始状态格 | 摘要、维度、趋势、变化和 raw 高级页 | 历史快照与格式化 | 是 | 是 | 是 | 中 | 7A |
| Wake 决策 | 触发后必发消息 | 多行动或 no-op | Action Plan、幂等和审计 | 是 | 是 | 是 | 高 | 7B |
| Diary / 留言自主行为 | 确认执行 | 按权限自主执行 | 权限分级调整 | 少量 | 是 | 是 | 高 | 7B |
| Solitude Surf | 未实现 | 自主选题、浏览、记录、记忆 | Web Tool、去重和来源 | 是 | 是 | 是 | 高 | 7B |
| Sticker | 未实现 | 手选与 AI Tool 发送 | 资产、索引和 Tool | 是 | 是 | 是 | 中 | 7C |
| Voice / TTS | 通用基础能力 | ElevenLabs 与完整设置 | 专用配置、测试和缓存 | 是 | 是 | 少量 | 中 | 7C |
| 一起听 | 直链播放器 | 搜索、共享状态、AI DJ | 音乐源、同步和归档 | 是 | 是 | 是 | 高 | 7D |
| 共读 | 笔记 CRUD | 阅读器、批注、书签、AI 翻书 | 文档解析与锚点模型 | 是 | 是 | 是 | 高 | 7D |
| Life Timeline | usage/event 日历 | 共同生活日时间线 | 统一事件投影 | 是 | 是 | 是 | 高 | 7E |
| 通知偏好 | Web Push 基础能力 | 分类、静默时段和 Provider | 策略表与路由 | 是 | 是 | 是 | 中 | 7E |
| 钱包分层 | 数据独立、UI 混合 | 系统账本与虚拟钱包分层 | UI 与事件来源 | 少量 | 是 | 是 | 中 | 7E |
| Codex Subscription | 未实现 | app-server 模型后端 | Adapter、生命周期与恢复 | 是 | 是 | 是 | 很高 | 8A |

## 5. 推荐 Phase

### Phase 7A · Identity & Runtime Surfaces

**目标**

让现有 Runtime 能力真正看得见、配得动，并补齐 Chat 的基础个性化。

**范围**

- AI 与用户头像、昵称。
- AI 头像、用户头像、昵称三个独立显示开关。
- reasoning 折叠卡。
- Prompt 查看、编辑、保存、恢复默认。
- Worldbook 最小可用版。
- Nocturne 完整页面。
- Eventide 完整页面、趋势、最近变化与 raw 高级页。
- 修复普通页面的 `[object Object]`。

**前置依赖**

- 现有 Capability Registry。
- Nocturne MCP 只读链路。
- Eventide sidecar 与状态快照。

**数据结构变化**

- 身份与聊天显示偏好。
- Prompt 自定义版本。
- Worldbook entry。
- Eventide 趋势如需跨重启保存，应新增历史快照。

**API 变化**

- Identity/Profile。
- Prompt preview、save、restore。
- Worldbook CRUD。
- Nocturne 产品化读取接口。
- Eventide history/raw 接口。

**风险**

- Prompt、Worldbook、Runtime Context 的优先级冲突。
- Nocturne 记忆隐私暴露。
- reasoning 可能包含不适合直接展示的供应商原始内容。

**验收标准**

- 普通页面不再出现原始对象字符串。
- reasoning 存在时可折叠查看，不存在时不渲染空卡。
- 用户可以区分系统默认 Prompt 与自定义 Prompt。
- Nocturne 故障不会阻断 Chat。
- Worldbook 确实进入模型上下文，而不是只有管理 UI。

**推荐 commit 切分**

1. 身份与 Chat 显示偏好。
2. reasoning 折叠卡。
3. Prompt 与 Worldbook。
4. Nocturne 页面。
5. Eventide 页面与趋势。

### Phase 7B · Autonomous Life Runtime

**目标**

把主动行为从若干固定定时任务升级为统一的自主生活决策链。

**范围**

```text
trigger
→ context
→ decision
→ message / messageboard / diary / solitude / other tool / no-op
→ outcome
```

- AI 留言改为可自主执行。
- AI 创建自己的私有日记改为可自主执行。
- Wake 支持多行动或 no-op。
- Solitude Surf 第一版。
- 行动幂等、冷却、预算、去重和审计。

**前置依赖**

- Phase 7A 的 Prompt/Worldbook 规则稳定。
- Capability Registry 与 Event Inbox。

**数据结构变化**

- Decision Run。
- Action Run / Outcome。
- Surf record 与 topic fingerprint。
- 行动来源和去重键。

**API 变化**

- 自主运行详情与审计接口。
- 行动策略配置接口。
- Web/Browser Tool 只读接口。

**风险**

- 重复打扰和行动重放。
- 工具调用循环。
- 把最近聊天误读成用户任务。
- 外部网页内容污染 Runtime Prompt。

**验收标准**

- 主动运行可以稳定选择 no-op。
- 留言和日记会写入真实目标数据。
- 同一行动不会因重试重复执行。
- Surf 内容保留来源，网页内容不能成为系统指令。
- 最近聊天只作为弱兴趣线索。

**推荐 commit 切分**

1. Autonomous Decision Contract。
2. Action Executor 与 no-op。
3. Diary / Message Board 权限调整。
4. Surf Tool 与主题去重。
5. 审计、预算与端到端验收。

### Phase 7C · Chat Expression & Voice

**目标**

补齐 Companion 的表达、表情包和第一阶段高质量语音能力。

**范围**

- Sticker pack 与 item。
- 用户手动选 Sticker。
- AI 通过 MCP/Tool 自主选择是否发送。
- ElevenLabs Provider。
- Voice、Model、speed、stability 与 Test。
- Chat 文字朗读和语音条体验收口。

**数据结构变化**

- Sticker pack/item。
- TTS Profile。
- 可选的生成音频缓存。

**API 变化**

- Sticker search/send。
- ElevenLabs voices、test、synthesize。

**风险**

- 音频成本与缓存空间。
- 浏览器自动播放限制。
- Sticker 资产版权与来源。

**验收标准**

- 用户和 AI 使用同一种 Sticker 消息对象。
- AI 可以选择不发送 Sticker。
- ElevenLabs 测试和 Chat 朗读共用同一配置。
- TTS 失败不影响文字回复。

**推荐 commit 切分**

1. Sticker 数据与手选 UI。
2. Sticker Tool。
3. ElevenLabs Provider。
4. Chat Voice UX 与验收。

### Phase 7D · Living Apps

**目标**

把“一起听”和“共读”从增强 CRUD 重做成真正的共同活动应用。

**施工顺序**

先一起听，再共读，不并行展开。

**一起听范围**

- 音乐搜索、选择与队列。
- 播放、暂停、跳转和服务器权威共享状态。
- WebSocket 同步。
- AI 选歌、评论与 DJ Action。
- 共同听歌归档与 Life 时长事件。

**共读范围**

- 书架与上传。
- PDF、EPUB、TXT 阅读器。
- 稳定文本锚点。
- 用户与 AI 划线、批注、书签、生词和进度。
- MCP 工具让 AI 翻页、划线和评论。

**风险**

- 音乐服务接入与版权边界。
- 实时播放同步与后台播放。
- PDF/EPUB 文本锚点稳定性。
- 大文件存储、解析与备份体积。

**验收标准**

- 一起听不再要求用户手填直链才能使用主路径。
- 共享播放状态以服务器为权威并可恢复。
- AI 的选歌或评论基于真实当前曲目。
- 共读的批注在重新打开和不同端上仍指向正确文本。
- AI 只能通过受控工具操作书籍。

**推荐 commit 切分**

每个应用分别按 schema、API、基础 UI、AI Binding、E2E 五类提交。

### Phase 7E · Life Timeline & Notification

**目标**

统一共同生活记录、账本语义和通知偏好。

**范围**

- 统一 Life Event 投影。
- 月历每日 timeline。
- 聊天、主动消息、留言、日记、一起听、共读、通话、API 调用与纪念日事件接入。
- 系统账本和小栖钱包分栏。
- AI 可生成虚拟钱包流水，但不得默认扣除真实 API 费用。
- 通知总开关、分类开关、Quiet Hours 与 Push Provider。
- 修复倒数日视觉重复。
- dock 方案确认后再收口。

**数据结构变化**

- 统一 Life Event。
- Notification Policy。
- 虚拟钱包流水来源和关联字段。

**API 变化**

- Timeline 查询。
- Notification Policy CRUD。
- Wallet Tool 与审计接口。

**风险**

- 历史数据回填与事件重复。
- 跨时区和跨日统计。
- 系统成本与虚拟货币语义再次混淆。

**验收标准**

- 点击日期可查看真实共同生活事件时间线。
- API 消费不改变小栖钱包余额。
- Quiet Hours 对站内通知和 Push 均生效。
- 倒数日不会在同一首页形成重复主内容。

**推荐 commit 切分**

1. Life Event Contract。
2. 各模块事件适配。
3. Timeline UI。
4. Wallet / Ledger 分层。
5. Notification Policy。
6. Widget 与 dock 收口。

### Phase 8A · Codex Subscription Provider

**目标**

新增 Codex Subscription 作为可选模型后端，同时保留 Habitat 作为唯一 Companion Runtime。

**推荐架构**

```text
Habitat Runtime
→ Codex Adapter
→ codex app-server
→ stdio JSON-RPC / JSONL
→ ChatGPT 登录身份与 Codex 订阅额度
```

**核心设计**

- Habitat session 与 Codex thread 建立持久绑定。
- 新会话创建 thread；历史会话恢复原绑定，禁止每轮创建新 thread。
- app-server 重启后验证并恢复 thread；无法恢复时建立明确的 successor thread。
- 将 delta、reasoning、tool、usage、error 转换为 Habitat 现有 SSE 契约。
- 浏览器断开或用户停止生成时向 app-server 发 cancellation。
- 登录凭据只保存在 VPS 上 Codex CLI 官方目录，绝不下发前端。
- 人格、Nocturne、Eventide、Worldbook、Diary、Sticker、Wake 与 MCP 仍由 Habitat 管理。
- OpenAI-compatible 与 Codex Subscription 并存，由 Provider 类型显式选择。

**风险**

- app-server 协议演进。
- 订阅 usage 和额度语义。
- Codex thread 上下文与 Habitat 自有历史重复。
- VPS 登录态续期和服务隔离。
- Provider 中断后的恢复与幂等。

**验收标准**

- 两类 Provider 可独立选择且互不破坏。
- Codex Provider 输出遵守现有 Chat SSE 契约。
- Habitat Runtime 注入的身份、记忆和状态仍然生效。
- app-server 重启后已有会话有明确恢复结果。
- 前端和 Habitat 数据库不保存网页 Cookie 或伪造 API 凭据。

**推荐 commit 切分**

1. 独立协议 spike 与契约测试。
2. Codex process supervisor。
3. thread/session binding。
4. streaming、usage 与 cancellation 映射。
5. Setting Provider UI。
6. VPS 部署与恢复验收。

## 6. 优先级

### P0：影响核心 Companion 体验

- Runtime 自主决策与 no-op。
- AI 自主留言与私有日记。
- Prompt 与 Worldbook。
- reasoning 卡。
- Nocturne / Eventide 完整页面。
- 头像与昵称。
- Eventide 对象渲染修复。

### P1：明显提升长期使用体验

- Sticker。
- ElevenLabs TTS。
- Life Timeline。
- 通知偏好。
- 系统账本与钱包分层。
- 倒数日重复修复。

### P2：大应用增强

- 一起听重做。
- 共读重做。
- AI 伴学。
- 通话模式。

### P3：工程债与 Polish

- 工具卡时序。
- 确认卡过期与撤销。
- dock 调整。
- 移动端统一细节。
- Widget 拖拽编排。
- 历史 Life Event 回填工具。

## 7. 明确延期

- **Codex Subscription Provider 主实现**：先做独立协议 spike，等 Runtime 契约稳定后再接入。
- **实时通话、Streaming TTS、连续麦克风输入**：在 ElevenLabs 文字朗读稳定后再做。
- **Widget 拖拽编排**：先修重复展示，暂不增加排序 schema。
- **完整 AI 伴学系统**：依赖资料库、检索和学习状态模型，不与共读同时展开。
- **全面移动端 polish**：待主要信息架构稳定后统一处理。
- **Memory 写入**：随 Runtime 权限和自主行动统一设计，不单独补危险写工具。
- **dock 重做**：先确认最终交互目标，避免再次返工。

## 8. 参考项目映射

本轮规划只选取三个直接影响架构的参考项目：

### ghost-bf

- 借鉴：触发器只提供上下文，由 AI 决定发消息、做其它事或保持安静。
- 不采用：tmux 注字和固定高频轮询。
- Habitat 映射：Decision Contract、BudgetGuard、Action Executor 与 no-op。

### Duetto

- 借鉴：服务器权威播放状态、WebSocket 同步、歌曲上下文、AI DJ 与 Prompt 透明。
- 不采用：单房间假设和对特定音乐平台的强耦合。
- Habitat 映射：Together Listening 独立领域模型，通过 Capability Registry 暴露 AI 行动。

### Tasogare

- 借鉴：稳定文本锚点、双方作者标识、阅读活动事件与 MCP 翻书/批注工具。
- 不采用：一本书一个 JSON 作为 Habitat 长期主存储。
- Habitat 映射：书籍、文档、锚点、批注和阅读事件使用服务端权威数据模型。

思绪卡、Sticker、Surf 与 Eventide 的参考项目，应在对应 Phase 正式开工前再按 `AGENTS.md` 的限制单独查看。

## 9. 第一批建议施工内容

建议下一批只做 **Phase 7A 第一切片**：

1. AI 与用户头像、昵称数据。
2. AI 头像、用户头像、昵称三个独立显示开关。
3. reasoning 折叠卡。
4. 修复 Eventide `[object Object]`。

这批改动用户可见、依赖少，也不会提前锁死自主 Runtime、一起听或共读的后续架构。完成后应立即验收、更新 `docs/TASKS.md`、提交并停止，等待下一批确认。

