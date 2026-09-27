# 栖息地 · Habitat v2 迁移审查

> 审查日期：2026-09-27
> 审查基线：T-056（T-051～T-055 已部署至 `https://habitat.beiyan.cc`）
> 输入：`HABITAT_V2_PLAN.md`、`AGENTS.md`、当前权威文档与相关实现
> 本文性质：迁移设计，不代表功能已经施工。实际进度仍以 `AGENTS.md` 与 `docs/TASKS.md` 为准。
>
> **后续修订说明（2026-09-27 / T-057）**：本文保留为 T-056 基线审查记录；原始蓝图回归后新增的
> Chat 关系交互、原生 Nocturne Dashboard、Desire、朋友圈、每日品读、Appearance Studio 与四通道
> Provider 细则，以新版 `HABITAT_V2_PLAN.md` 和 `docs/PRODUCT_SPEC.md` 为准。本文中 Surf 自动沉淀、
> Memory Candidate 等与新版“主权记忆”规则冲突的建议不再作为施工依据。

## 1. 审查结论

Habitat v2 不需要推倒重建。现有 `server/`、`shared/`、AI Runtime、Capability Registry、Event Inbox、MCP Gateway、Nocturne、Eventide、Provider 基础层、PWA、Web Push 与 VPS 部署链都应保留。

V2 方案撰写时使用的项目基线已经落后于当前仓库。以下能力在 T-051～T-055 中已经完成并部署，不应在 V2 中重新施工：

- AI / 用户身份配置与头像、昵称显示。
- AI 头像、用户头像、昵称三个独立开关。
- reasoning 折叠卡。
- Prompt 查看、编辑、保存与恢复。
- Worldbook 最小可用版及 Runtime 注入。
- Nocturne 记忆页面。
- Eventide 状态、趋势、变化与 raw 页面。
- Wake 多行动决策与 no-op。
- AI 自主留言和自主写私有日记。
- Solitude Surf v1。
- `memory.write` 确认链路。
- Surf 订阅源管理、行动幂等与生产部署。

V2 真正需要新增或重构的主线集中在：

1. Provider Center v2 与 Codex Subscription Adapter。
2. MCP Manager。
3. Chat Media / Sticker / ElevenLabs。
4. Memory 三层沉淀与污染控制。
5. Together Listening、共读等 Living Apps。
6. Home 共享生活空间与 Life Timeline。
7. 通知偏好、钱包产品化和最终 UI 收口。

## 2. 当前基线校验

### 2.1 仓库与部署

- 当前代码基线为 `382b168`，对应 T-056 生产站全量更新。
- T-051～T-055 已部署到 VPS。
- 本轮 `npm run typecheck` 前后端均通过。
- 当前工作树只有未跟踪的 `HABITAT_V2_PLAN.md`；审查前没有业务代码改动。
- T-056 仍留下浏览器 / 手机真机验收：实际模型聊天、PWA 安装、断网只读、备份往返、Android PWA。

### 2.2 文档漂移

当前代码进度快于部分专题文档：

- `docs/API.md` 的章节仍停在 Phase 5 / 6.5，没有完整登记 Prompt、Worldbook、Eventide History、Surf feeds、Automation actions 等 Post-v1 接口。
- `docs/DATA_MODEL.md` 的正式章节仍主要停在 T-037，没有完整登记 `worldbook_entry`、`eventide_history`、`automation_action` 等 Post-v1 服务端表。
- `docs/AI_RUNTIME.md` 的“待办”仍残留 `memory.write` 未实现等旧事实。
- `AGENTS.md` 已正确记录 T-051～T-056，但底部部分旧“下一步/遗留”段落仍混有过时内容。
- `docs/POST_V1_PLAN.md` 是旧路线规划，不应继续作为 V2 施工状态来源。

因此 V2 开工前应先做一次文档基线同步，但不应借此重构业务代码。

### 2.3 阶段编号冲突

现有项目已经使用并完成：

- Post-v1 Phase 7A：身份、思绪、Prompt、Worldbook、Nocturne、Eventide。
- Post-v1 Phase 7B：自主生活决策、no-op、自主日记/留言、Surf。
- Post-v1 Phase 7C：`memory.write` 与 Surf 记忆沉淀。

因此 `HABITAT_V2_PLAN.md` 中再次使用 Phase 7A～7E 会造成任务、提交、CHANGELOG 和部署记录歧义。

后续建议使用独立编号：

```text
V2-A · Provider Foundation
V2-B · MCP & Chat Media
V2-C · Memory Governance
V2-D · Living Apps
V2-E · Home & Life
V2-F · Polish
```

## 3. V2 需求迁移矩阵

| V2 需求 | 当前判断 | 可复用资产 | 仍需施工 |
| --- | --- | --- | --- |
| Codex Subscription Provider | 完全缺失 | `LLMProvider`、SSE、usage、Provider Registry | app-server supervisor、thread 绑定、事件映射、取消与恢复 |
| Provider Center v2 | 半完成 | Profile CRUD、密钥、模型列表、连接测试、多模型槽 | 通道绑定、拉取后选择、Headers UI、分能力真实测试、状态记录 |
| MCP Manager | 基础设施存在、产品层缺失 | MCP Gateway、健康检查、Tools list、调用日志 | Server 配置 CRUD、启停、权限策略、调用历史 UI |
| Chat Media | 图片/语音基础完成 | MessageBlock、相册、图片生成、ASR/TTS | 文件入口统一、媒体浏览、拍照、Sticker 对象 |
| Sticker | 完全缺失 | Tool Registry、Chat MessageBlock 扩展点 | Sticker 数据、标签搜索、选择器、AI Tool |
| 身份显示 | 已完成 | T-051 全链 | 可补“显示时间”，其余不重做 |
| 思绪卡 | 已完成但语义需复核 | ReasoningCard、message metadata | V2 若坚持“角色可见独白”，需和供应商 reasoning 分成两个字段 |
| ElevenLabs | 完全缺失 | TTS route、MediaProvider、Chat 朗读 | 专用 Adapter、Voice/Model/参数/Test UI |
| Prompt / Worldbook | 已完成最小版 | 服务端权威数据与注入 | 版本记录、高级导入导出可后置 |
| Autonomous Life Loop | 核心完成 | Decision Contract、Action Executor、no-op、审计 | 扩展看书/听歌/钱包/MCP 行动需等 Living App 工具成熟 |
| Surf | v1 已完成 | RSS、只读网页、SSRF 防护、去重、来源 | 主题级去重、显式“无事可做”、沉淀策略调整 |
| Memory 三层模型 | 半完成且有语义冲突 | EventLog、solitude entry、Nocturne hold | Episodic Summary、评分/去重/压缩、升格策略 |
| Nocturne 页面 | 已完成基础产品页 | 健康、全文、搜索 | 生活化分类、来源结构化需取决于实例能力 |
| Eventide 页面 | 已完成 | 当前、趋势、变化、raw、按天聚合 | 生活化命名映射可后置 |
| Home Shared Living Space | 半完成 | Bento、真实数据摘要、模块入口 | 统一近期生活流、主动行为与 Living App 摘要 |
| Together Listening | 半完成 | 真 `<audio>`、本地播放控制、听歌时长 | 搜索、音源、共享状态、歌词、AI DJ、归档 |
| 共读 | 占位 | 基础 reading note 数据只可作迁移来源 | 书架、文件、阅读器、锚点、批注、AI 工具 |
| Life Timeline | 未完成 | EventLog、usage、日历、各模块数据 | 统一 Life Event Contract 与模块投影 |
| 小栖钱包 | 数据基础完成 | 钱包余额和不可变流水 | 账户层、AI 工具、拟真用途与 Life 投影 |
| Notifications v2 | 半完成 | 通知表、Web Push、PWA SW | 分类偏好、Quiet Hours、Push Provider |

## 4. 现有代码保留清单

### 4.1 原样保留

- `server/src/context/chat-context.ts` 的 Context 装配骨架。
- `shared/capabilities.ts` 与运行时能力快照机制。
- `server/src/capabilities/registry.ts` / `tools.ts` 的工具白名单和自主级别。
- Event Inbox 的双向决策与异步结果回灌。
- `server/src/mcp/` Gateway、Registry 和诊断链。
- OpenAI-compatible Provider Adapter。
- Nocturne 与 Eventide Provider Adapter。
- BudgetGuard、Automation Run、Automation Action 和幂等键。
- PWA、Web Push、备份和 VPS 部署体系。
- 已有 MessageBlock 可辨识联合与消息对象操作。

### 4.2 保留数据，重构产品表面

- Provider Settings：保留服务端 Profile 与 Secret 存储，重做配置和能力绑定体验。
- Home：保留收藏、作品、相册、日记、留言、倒数日数据，重做首页摘要组织。
- Music：保留已有曲目与 listenSessions，作为 Together Listening 的迁移输入。
- Reading Notes：保留旧记录，未来导入书架或放入“旧读书记录”，不直接当成新阅读器数据。
- Life：保留 UsageRecord、EventLog、Notification、WalletTransaction，新增统一投影而非重建旧表。

### 4.3 不应继续扩建的旧形态

- 不继续给直链 MusicModule 堆共享功能，应新建服务端权威 Together Listening 领域层。
- 不继续给 ReadingNote 增字段假装阅读器，应建立 Book / Document / Anchor / Annotation 模型。
- 不把 MCP Server 和权限配置硬编码在 Setting 页面。
- 不在现有 `ApiProfile.modelMap` 上无限追加 UI 逻辑来模拟 Capability Binding。
- 不把所有新生活事件继续塞进无结构的 EventLog metadata 后再由前端猜。

## 5. 需要新增或调整的数据模型

以下只定义迁移方向，字段细节应在对应切片开工前写入 `docs/DATA_MODEL.md`。

### 5.1 Provider Center

```text
provider_profile
- id / name / protocol / base_url
- secret_ref
- headers
- enabled

capability_binding
- channel: chat | tts | stt | vision | image
- provider_profile_id
- model_id
- options_json
- last_test_status / tested_at / latency_ms
```

兼容迁移：现有 `ApiProfile.modelMap` 先作为默认绑定来源读取，迁移确认后再决定是否去除；第一批不得直接破坏旧聊天方案。

### 5.2 Codex Adapter

```text
codex_thread_binding
- habitat_session_id
- codex_thread_id
- status
- created_at / updated_at
- successor_thread_id

codex_runtime_state
- app_server_instance
- login_state
- last_health_at
- last_error
```

登录凭据不进入业务数据库，只使用 Codex CLI / app-server 官方存储位置。

### 5.3 MCP Manager

```text
mcp_server_config
- id / name / transport / endpoint
- credential_ref
- enabled
- health / last_checked_at

mcp_tool_policy
- server_id / tool_name
- ai_policy: autonomous | confirm | user_only | disabled

mcp_call_audit
- caller / server / tool / status / duration / summary / at
```

Tool 权限必须由服务端 Registry 合并判定，前端开关不能直接等于执行权限。

### 5.4 Memory Governance

```text
activity_record
→ episodic_summary
→ memory_promotion
→ Nocturne hold
```

需要记录 promotion 的来源、评分、去重键、压缩结果、结果状态与 Nocturne 引用。不能只保留“写成功/失败”一条日志。

### 5.5 Living Apps / Life

- Together Session / Queue / Playback State / Listen Event。
- Book / Document / Reading Position / Text Anchor / Annotation / Vocabulary。
- Life Event Projection：统一事件 id、来源、发生时间、参与者、目标引用、摘要与可见性。

## 6. 需要新增或调整的 API

### 6.1 Provider Center

- Provider Profile CRUD 保留现有接口并扩展协议类型。
- 新增 Capability Binding 查询与更新。
- 模型发现与配置保存解耦：拉取模型失败不阻止手填。
- 每个通道提供真实最小测试接口，不复用一个只测 `/models` 的结果冒充全能力可用。

### 6.2 Codex Adapter

- Adapter 对内实现现有 `LLMProvider` 契约。
- 增加 app-server 健康、登录状态与受控重启接口。
- thread 绑定不直接暴露给普通前端；高级诊断页只读展示脱敏状态。

### 6.3 MCP Manager

- Server 配置 CRUD、enable/disable、test、tools、audit。
- Credential 继续采用只写不回读接口。
- 工具策略更新必须经过服务端校验，不接受未知工具或越权级别。

### 6.4 Living Apps

- Together Listening 使用服务端权威播放状态与实时同步通道。
- 共读上传、解析、内容读取和锚点操作必须全部走后端。
- 各模块通过统一 Life Event writer 写入生活事件，不让前端跨库拼接。

## 7. 可直接基于现有 Runtime 实现的需求

无需重建 Runtime 即可接入：

- Sticker search/send：新增 Capability 和 MessageBlock 后绑定 Tool。
- ElevenLabs：实现 MediaProvider Adapter 后复用 `/api/media/tts` 与 Chat 朗读。
- Together Listening AI 行动：实现领域服务后绑定 play/pause/queue/comment 工具。
- 共读 AI 行动：实现书籍和锚点服务后绑定 read/highlight/comment 工具。
- 钱包 AI 行动：复用钱包事务服务，增加受控 capability。
- MCP Manager 权限：把用户配置合并到现有 Capability Snapshot 和 Tool Binding 判定。
- Codex Subscription：只实现 `LLMProvider` Adapter，不改变 Context、Capabilities 或业务工具执行权。

不能直接复用、必须先补领域模型的需求：

- 共享播放同步。
- PDF / EPUB / TXT 阅读器与稳定锚点。
- Life Timeline 的跨模块事件投影。
- Memory 的 Episodic Summary 与升格评分。

## 8. 关键风险与修正

### 8.1 Reasoning 语义

当前 `ReasoningCard` 展示的是上游 `reasoning_content`。V2 方案明确要求“不展示模型隐藏 reasoning”，而改为可见的角色内心独白。

两者不能继续共用一个字段。建议：

- 现有 `metadata.reasoning` 视为供应商可见 reasoning，仅在用户明确开启高级显示时使用，或后续停止保存。
- 新增 `inner_monologue` / `visible_thought` 作为产品层内容，由明确的生成契约产生。
- 收藏、导出、记忆和上下文是否包含该内容必须分别定义。

### 8.2 Memory 污染

当前每次成功 Surf 都会自动调用 Nocturne `hold`。这与 V2 的“Activity → Episodic Summary → Long-term Memory”三层方案冲突。

迁移时应先停止“每次 Surf 自动升格”的产品定义，改为：

1. Surf 记录只进入 Activity Log。
2. 定期或达到批量阈值后生成 Episodic Summary。
3. 经过去重、评分、压缩和相关性判断后，才进入 Nocturne。
4. 保留现有 `memory_write` confirm 路径，供对话中明确沉淀。

在新的 promotion pipeline 落地前，不应继续扩大自动写长期记忆的来源。

### 8.3 Provider 迁移兼容

现有所有聊天、媒体和 usage 都围绕 ApiProfile 工作。V2 第一批必须提供兼容读取层，不能一次迁移后让现有生产配置失效。

### 8.4 Codex 双 Runtime 风险

Codex app-server 只能是模型后端。Habitat 必须继续拥有：

- System Context 装配。
- Capability Snapshot。
- Tool 许可和执行。
- Event Inbox。
- 业务副作用与审计。

如果 app-server 自己执行 Habitat 业务工具，会形成第二套权限和状态真相，禁止采用。

### 8.5 大模块并发施工

Provider Center、Codex Adapter、MCP Manager、Together Listening、共读均属于架构级模块。不得同时开工；每一批应有独立数据迁移、API、验收和提交。

## 9. 推荐 V2 阶段

### V2-0 · Baseline & Production Acceptance

目标：固定真实生产基线，消除文档漂移。

范围：

- 完成 T-056 剩余真机验收。
- 同步 API、DATA_MODEL、AI_RUNTIME、AGENTS 的 Post-v1 事实。
- 将 `HABITAT_V2_PLAN.md` 和本审查纳入版本管理。
- 标记旧 `POST_V1_PLAN` 为历史规划。

不改业务代码。

### V2-A · Provider Foundation

目标：建立 Provider Profile 与 Capability Binding 的清晰边界。

范围：

- Provider Center v2 数据契约。
- 主聊天 / TTS / STT / Vision / Image 独立绑定。
- 模型发现、手填 fallback、真实最小测试。
- Headers 配置 UI。
- 旧 ApiProfile 兼容迁移。

本阶段不包含 Codex app-server 正式接入。

### V2-A2 · Codex Subscription Adapter

目标：以模型后端身份接入 Codex 官方 app-server。

先做协议 spike，再做 supervisor、thread binding、stream mapping、cancellation、usage 和恢复。完成前不得影响 OpenAI-compatible 主路径。

### V2-B · MCP Manager & Chat Media

目标：把已有 Gateway 产品化，并补齐 Sticker / ElevenLabs。

建议先 MCP Manager，再 Sticker，再 ElevenLabs；不要同一 commit 混做。

### V2-C · Memory Governance

目标：建立 Activity、Episodic Summary、Long-term Memory 三层治理，处理 Surf 自动升格冲突。

### V2-D · Living Apps

目标：先 Together Listening，完成后再做共读。两个大应用不得并行施工。

### V2-E · Home & Life

目标：基于成熟 Living Apps 和统一 Life Event Contract 重构 Home 与 Life，避免提前做两次投影。

### V2-F · Polish

通知偏好、钱包产品化、Dock/Widget、移动端、动画、性能与可访问性统一收口。

## 10. V2-A 最小施工范围

V2-A 第一批建议只做 Provider Foundation，不做 Codex、不做 MCP Manager。

### 10.1 目标

- 保留所有现有 OpenAI-compatible 配置可用。
- 建立 Profile 与 Capability Binding 的新契约。
- 让用户先测试连接、拉取模型、选择模型，再保存或更新绑定。
- 每种能力通道能做真实最小测试。

### 10.2 范围内

- 新增共享类型和服务端存储。
- 从现有 ApiProfile 生成默认绑定的兼容层。
- Provider Center 新 UI。
- Headers 单向编辑。
- Chat / TTS / STT / Vision / Image 测试接口。
- 完整 API、数据模型和端到端验收。

### 10.3 范围外

- Codex Subscription Provider。
- MCP Manager。
- Sticker。
- ElevenLabs 专用 Adapter。
- Living Apps。
- 现有聊天 Runtime 改写。

### 10.4 推荐 commit 切分

1. `docs: define provider profile and capability binding contracts`
2. `feat(server): add capability binding storage and compatibility layer`
3. `feat(server): add per-channel discovery and real probe endpoints`
4. `feat(web): rebuild Provider Center configuration flow`
5. `test: cover provider migration, probes and active bindings`
6. `docs: sync API, data model, tasks and changelog`

### 10.5 验收标准

- 旧生产 Profile 无需手工重建即可继续聊天。
- `/models` 不可用时仍能手填模型并执行真实测试。
- 主聊天测试验证 streaming，而不只验证模型列表。
- TTS / STT / Vision / Image 分别验证自己的真实端点。
- API Key 和 Header 值不从任何 GET 接口回传。
- 任一通道测试失败不会破坏已保存的其它通道。
- OpenAI-compatible 回归全部通过。
- VPS 生产环境能复现相同配置和测试结果。

## 11. 第一施工顺序建议

1. 先完成 V2-0 文档同步与真机验收。
2. 开始 V2-A Provider Foundation。
3. Provider 基础稳定后，单独做 Codex app-server 协议 spike。
4. Codex spike 给出明确可行性结论后，再决定 V2-A2 是否进入正式实现。

在用户确认前，不进入任何业务施工。
