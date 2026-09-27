# 栖息地 · Habitat v2 续建与重构方案

> 用途：交给 Codex / WorkBuddy 作为下一阶段设计与施工依据。
> 当前阶段目标：**先审查、再迁移、后施工**。
> 核心原则：保留已经稳定的 Runtime / 后端能力，重做产品体验与能力组织，不推倒整个项目重来。
> 蓝图回归：2026-09-27 已按最初产品构想补回 Chat 关系交互、朋友圈、每日品读、完整 Nocturne、
> Desire 动机层、可编程外观和四通道 Provider Center。本文中的“规划完成”不等于对应业务已经实现；
> 实际进度仍以 `AGENTS.md` 与 `docs/TASKS.md` 为准。

---

## 0. 产品北极星

栖息地不是“聊天软件 + 一堆功能”，而是：

> **一个让 AI 拥有持续身份、记忆、状态、自主行为，并和用户长期共同生活的私人数字住所。**

确认的核心体验：

- **Chat 是第一入口**，也是最重要的相处空间。
- Home 是“我们俩的小空间”，要能看到共同生活留下来的痕迹。
- AI 应拥有真实自主能力：主动发消息、写日记、留言、上网冲浪、选歌、读书、使用钱包、调用 MCP，也允许 no-op。
- Memory / Eventide / Wake 等后台能力必须在用户体验中真实可感知，不能只存在日志里。
- Together Listening、共读等必须是“两个人一起做一件事”，不能退化成 CRUD 记录器。
- AI 应有属于自己的私密空间和生活状态，而不是所有功能都围绕用户操作展开。
- 技术架构必须支持长期扩展：换前端、换 Provider、换模型都不能拆掉整个家。

---

## 1. 当前项目中应优先保留的资产

以下内容不建议推倒重做，应视为 Habitat v2 的基础设施：

- `server/`
- `shared/`
- `eventide-sidecar/`
- AI Runtime 主链
- Capability Registry
- Runtime System Context
- Event Inbox
- Tool Gateway / MCP Gateway
- Nocturne 接入
- Eventide 接入
- Provider 抽象层
- 消息 / usage / notification 等后端能力
- PWA / Web Push
- VPS 部署能力
- 现有 API / 数据模型中已验证稳定的部分

前端可以重构或替换，但后端与 Runtime 应优先复用。

---

## 2. 当前产品问题

当前最大问题不是“功能数量不足”，而是：

> **很多功能在工程层面存在，但在产品体验上并未真正完成。**

典型问题：

- 功能日志写“完成”，但实际使用时 AI 不知道自己拥有该能力。
- Tool 执行成功，但结果未稳定影响 AI 后续回答。
- Nocturne / Eventide 后端已接，但用户侧页面仍是原始状态或占位。
- Together Listening / 共读等被做成最小 CRUD 或卡片，而不是完整共同生活应用。
- Life 更像系统仪表盘，缺少“我们今天发生了什么”的生活感。
- 普通用户界面暴露过多技术细节，如 raw payload、`[object Object]`、provider 字段。
- API 设置页过于工程化，只能手填并保存后测试，缺少模型发现与方案化体验。

因此，后续所有“完成”必须采用更严格的验收口径。

---

## 3. 功能完成的统一验收标准

任何核心功能，只有以下 6 层全部通过，才能标记为“完成”：

1. **后端能力存在**
2. **工具调用真实成功**
3. **调用结果真实进入模型上下文**
4. **AI 能基于结果正确理解并使用该能力**
5. **前端正确展示与交互**
6. **VPS 生产环境复现通过**

任意一层未通过，只能标记为“部分完成 / 半接入”。

禁止再使用“接口存在 = 功能完成”的口径。

---

## 4. Chat 路径重构

### 4.1 主聊天模型入口

Chat 主聊天支持两种可切换模式：

#### 模式 A：自定义 API

使用现有 OpenAI-compatible Provider 体系。

#### 模式 B：Codex Subscription Provider

目标架构：

```text
Habitat Chat
  ↓
Habitat Runtime
  ├─ Identity / Prompt
  ├─ Nocturne
  ├─ Eventide
  ├─ Worldbook
  ├─ MCP / Tools
  └─ Event Inbox
  ↓
Codex Adapter
  ↓
codex app-server
  ↓
stdio JSON-RPC / JSONL
  ↓
ChatGPT 登录身份 / Plus Codex allowance
```

原则：

- Codex 只作为模型/生成后端。
- Habitat Runtime 继续掌管人格、记忆、状态、工具、业务权限。
- 不让 Codex 自己成为第二套 Agent Runtime。
- 不抓网页 Cookie。
- 不伪造 API Key。
- 通过 app-server 官方登录态工作。
- Adapter 将 app-server 事件映射为 Habitat 现有 SSE / Provider 事件。

需要设计：

- Habitat session ↔ Codex thread 映射
- thread 生命周期
- streaming event 转换
- tool / usage / done / error 映射
- cancellation
- app-server 重启恢复
- 登录凭据安全存储
- VPS 部署方式
- 和自定义 API Provider 共存

---

## 5. Provider Center v2

当前 API 设置页需要重做成真正的 Provider 管理中心。

### 5.1 四个能力通道

```text
Provider Center
├─ 主聊天
├─ 语音
├─ 识图
└─ 生图
```

每个通道独立绑定 Provider / Model。

四张卡片必须在设置页分别呈现，不能收成一个含混的“模型”表单：

| 卡片 | 负责能力 | 最小测试 |
| --- | --- | --- |
| 主聊天 API | 普通回复、流式、工具调用、reasoning（若上游支持） | 最小文本请求 + 首个流式片段 |
| 语音 API | TTS；同一 Provider 支持时可同时绑定 STT | 生成试听；STT 另用一段录音测试 |
| 识图 API | 图片理解 / 描述 | 上传测试图并返回描述 |
| 生图 API | 文生图 | 用短提示词生成并预览测试图 |

每张卡片都显示 Provider 类型、Base URL、API Key、Headers、当前模型、连接状态、最后测试时间、
耗时与最近错误。卡片之间可以复用同一个 Provider Profile，但绑定、测试与保存互不连坐。

### 5.2 统一配置流程

每个通道都采用一致体验：

```text
填写 Base URL
↓
填写 API Key
↓
点击「拉取模型」
↓
后端调用 models endpoint
↓
返回模型列表
↓
用户选择模型
↓
点击「测试」
↓
真实最小请求验证
↓
测试通过
↓
保存
↓
可选「存为方案」
```

若 `/models` 不可用：

- 允许手动填写模型 ID
- 不因拉取失败阻塞配置

“拉取模型”使用**尚未保存的表单草稿**，由后端代请求；API Key 不写入 URL、不进入前端日志。
失败必须区分认证失败、地址不可达、超时、协议不兼容与上游不提供 `/models`，并保留用户已填内容。

“测试连接”同样使用当前草稿，不要求先保存。只有对应能力的真实最小请求成功，才可显示“已连接”；
只请求 `/models` 成功不能冒充聊天、语音、识图或生图已经可用。

### 5.3 方案与绑定分层

```text
Provider Profile
- 名称
- Base URL
- API Key
- Headers
- 协议类型

Capability Binding
- 主聊天模型
- TTS / STT 模型
- Vision 模型
- Image 模型
```

用户可以保存多个方案，例如：

- GPT 主力
- Gemini 备用
- Kimi 国内
- 本地模型

一键切换。

操作语义：

- **保存**：保存当前卡片的 Provider Profile 与能力绑定。
- **存为方案**：输入方案名，把四张能力卡的当前绑定保存为一个可切换快照。
- **设为当前方案**：四个通道原子切换；任一引用无效时整次拒绝，不留下半套新、半套旧。
- **复制方案**：复制绑定关系，密钥仍引用服务端凭据，不把明文复制到浏览器。
- **恢复上次保存**：丢弃未保存草稿，不删除方案。
- **删除方案**：只删除方案；被其它方案或能力绑定引用的 Provider Profile 不级联删除。

方案至少包含：名称、四个能力绑定、创建 / 更新时间。Provider Profile 与 Capability Binding 必须分层，
避免同一 URL / Key 因四张卡被重复保存四份。

### 5.4 测试方式

主聊天：最小文字回复 + streaming 检查
语音：TTS 生成试听 / STT 测试转写
识图：上传测试图 → 返回描述
生图：输入简短 prompt → 返回测试图

测试通过后显示：

```text
● 已连接
最后测试时间
延迟
模型
```

验收时还要覆盖：拉取失败后手填模型、测试失败后修正并重试、未保存草稿不污染当前生产绑定、
整套方案切换、同一 Provider 跨卡复用、页面刷新后状态恢复，以及服务端响应中永不回传密钥明文。

---

## 6. MCP Manager

将 MCP 从“后端配置文件能力”升级为用户可管理功能。

设置中新增：

```text
工具与 MCP
├─ Nocturne
├─ Eventide
├─ Nowhere
├─ Sticker MCP
├─ 网易云音乐 MCP
└─ + 添加 MCP
```

每个 MCP 支持：

- 添加
- 删除
- 开启 / 关闭
- 测试连接
- 查看 Tools
- 设置是否允许 AI 自主调用
- 查看最近调用记录
- 查看调用成功 / 失败状态

要求：

- 继续复用现有 MCP Gateway
- 不把 MCP 逻辑写死在页面里
- Tool 权限和 UI 权限分开

---

## 7. Chat Media System

将“图片”和“表情包”统一成 Chat Media。

```text
Chat Media
├─ 图片
│  ├─ 上传
│  ├─ 相册
│  └─ AI 生图
└─ 表情包
   ├─ 表情库
   ├─ 分类
   ├─ 搜索
   ├─ 收藏
   └─ AI 自主发送
```

Chat 输入区支持：

- 图片
- 拍照
- 表情
- 文件

AI Tool 可包括：

- `sticker.search`
- `sticker.send`
- `image.generate`
- `album.read`

表情包可参考 `cove-sticker-mcp` 的“图库 + 标签 + 搜索 + AI express”思路。

---

## 8. Chat 个性化与沟通体验

### 8.1 身份显示

设置中增加：

- AI 头像上传 / 更换
- 用户头像上传 / 更换
- AI 昵称
- 用户昵称
- 显示 AI 头像开关
- 显示用户头像开关
- 显示昵称开关
- 显示时间开关

### 8.2 思绪卡

每轮 AI 回复头部增加可折叠“思绪 / 内心独白卡”。

注意：

- 不展示模型隐藏 reasoning
- 不读取或暴露底层私有链路
- 产品上定义为“角色内心独白 / 可见思绪”
- 可以单独生成、单独存储、单独渲染
- 小栖可以选择本轮不公开思绪；没有内容时不渲染空卡
- 收藏、作品、导出正文默认不带公开思绪

可参考 `ai-companion-cot-emotion` 的思路，但只借“角色内心独白 + 前端独立渲染”，不复制其长文本格式要求。

协议上严格拆成三路：

```text
publicThought      小栖愿意公开的角色内心独白
content            真正说出口的回复
providerReasoning  上游供应商原生推理，仅供高级诊断，默认隐藏
```

`publicThought` 与正文分别流式、分别落库；解析失败必须 fail-open，不能吞掉正文，也不能把标记原样漏进气泡。
Eventide / Desire 可以影响公开思绪的语气与关注点，但不得把原始状态对象、系统 Prompt、工具参数或隐藏推理直接展示。

### 8.3 语音与通话

优先支持 ElevenLabs：

Setting：

- API Key
- Voice
- Model
- 语速 / 稳定性等配置
- Test

Chat：

- 文字转语音
- 语音条
- 播放

后续阶段：

- Streaming TTS
- 麦克风输入
- 实时通话

### 8.4 聊天历史导航与检索

- 会话内按“今天 / 昨天 / 某月某日”形成日期锚点，可从时间线面板快速跳转。
- 全文搜索覆盖双方文本、语音真实转写、图片描述与工具结果摘要；不把未转写音频伪造成文本。
- 搜索结果显示会话、日期、命中片段，点击后定位并高亮原消息；已撤回正文不参与普通搜索。
- 长会话采用增量索引和虚拟列表定位，不能为了搜索一次性渲染全部消息。

### 8.5 联网搜索与上下文压缩

- Chat 内的联网搜索是用户或 AI 在当前对话里显式调用的 Web / Browser Tool，不等同于 Solitude Surf。
- 结果以可追溯工具卡进入消息序列，保留查询、来源、时间、成功 / 失败状态，并反馈给同一轮模型。
- 上下文压缩必须生成可查看的会话摘要，记录覆盖范围、生成时间与所用模型；原消息不删除。
- 用户可以重新生成、编辑或停用摘要；压缩失败回退到未压缩历史，不能破坏会话。
- 模型上下文明确标出“摘要”与“原始最近消息”，禁止把摘要伪装成用户原话。

### 8.6 关系型互动

- **拍一拍**是轻量关系事件：双方均可发起，留在消息时间线，可触发状态 / Desire，但不伪装成文本消息。
- **暂时拒绝回复 / 拉黑**双方对等：用户和小栖都可发起，历史仍可查看，不删除任何内容。
- 暂停期间可由任一方发起恢复申请，另一方可同意、拒绝或暂不处理；所有状态与决定可追溯。
- 单次暂停最长 60 分钟，到时自动解除；界面持续显示剩余时间与当前可做的动作。
- 主动消息、Wake、Push 和通话邀请必须尊重暂停状态；系统通知与到期解除不受拦截。
- 小栖侧拒绝必须来自明确的 Runtime 决策与状态依据，不能随机抽签，也不能用它规避安全或错误反馈。
- 恢复后不补发暂停期间被抑制的主动消息，避免解除瞬间集中轰炸。

---

## 9. Worldbook 与 Prompt 管理

需要新增完整 Worldbook 功能。

Setting 中增加：

- 查看当前完整内置 Prompt
- 编辑
- 保存
- 恢复默认
- 版本记录（建议）

Worldbook 与 Prompt 必须进入 Runtime Context 的统一装配链。

禁止页面中存在一套、Runtime 实际使用另一套。

---

## 10. Autonomous Life Loop

当前 Wake / Solitude / Eventide / Event Inbox 已存在，应重组为统一“自主生活循环”。

参考 Headlong 的核心思想：

- Agent 有持续的生活流
- 用户消息只是 Observation 之一
- AI 自己决定是否行动

但不复制其 shell harness，也不给 Habitat AI unrestricted shell 权限。

### 10.1 新的自主循环

```text
时间 / 用户活动 / Eventide / 事件 / MCP 输入
                     ↓
                 Observation
                     ↓
             Autonomous Life Loop
                     ↓
             “现在想做什么？”
          ↙      ↓       ↓        ↘
       找用户    独处    做事      no-op
        ↓         ↓       ↓
      发消息      冲浪    写日记
                 看书    留言
                 听歌    调 MCP
```

要求：

- 必须支持 no-op
- 不允许定时必发消息
- 不允许每次 Wake 必写日记
- 不允许每次 Solitude 必产生内容

### 10.2 主动能力范围

AI 可以自主：

- 主动发消息
- 留言
- 写私有日记
- 上网冲浪
- 看书
- 听歌 / 切歌
- 使用虚拟钱包
- 调用允许的 MCP
- 什么都不做

---

## 11. 自主冲浪

作为 Solitude 的一种能力：

```text
solitude
↓
AI 决定是否 surf
↓
选择主题
↓
Web / Browser Tool
↓
阅读
↓
形成 Activity / Episodic Note
```

要求：

- 最近聊天只作为兴趣线索，不是任务
- 支持“歇 / 什么都不做”
- 防止同一话题无限重复搜索
- 记录来源与时间
- 不自动把每次冲浪写入长期记忆

---

## 12. Memory 分层，防止污染

长期记忆是需要谨慎处理的高门槛能力。

建议三层：

```text
Activity Log
全部生活行为与事件
↓
Episodic Summary
有意义的经历总结
↓
Nocturne Long-term Memory
真正值得长期保留的内容
```

规则：

- 普通活动默认只进入 Activity Log
- Episodic Summary 是生活回顾，不等于长期记忆，也不自动晋升
- Nocturne 坚持“主权记忆”：由小栖自己决定是否记、记成什么、放在哪个 URI、何时应该想起
- 后台候选、去重、聚合只能作为建议，不能成为绕过小栖的自动写入者
- 进入 Nocturne 时保留来源、第一人称语义与 disclosure；写入后由原生 Dashboard 提供版本审计和回滚
- 不允许“每次行为都写长期记忆”
- Surf、共读、一起听和聊天都只产生可供选择的经历；当前“Surf 成功即自动 hold”应在对应施工批次迁移为 AI 决策

短期心理活动另设 Desire Thought Pool：闪念会衰减、执念可加强，但二者都不是长期记忆；
公开思绪也只是某一轮愿意展示的表达，三者不得混表或自动互相复制。

用户最关注的风险：**记忆污染**。

---

## 13. Nocturne / Eventide 产品化页面

### 13.1 Nocturne

Habitat 内的普通记忆页只承担生活化摘要：

- 最近记住的事
- 关于用户
- 关于我们
- 很久以前的事
- 最近想起来的事
- 搜索
- 详情
- 来源
- 服务状态

摘要页不是完整管理器。点击“进入记忆深处”后应进入**同一套自部署 Nocturne 的原生 Dashboard**，至少保留：

- Memory Explorer 与 URI 树
- 完整详情、创建、编辑与子节点管理
- disclosure、Boot URI、Namespace 等原生语义
- 修改快照、Diff、Integrate / Reject / 回滚
- Brain Cleanup 与服务设置

部署与接口不是二选一：同一个 Nocturne 实例同时提供 MCP 给 Habitat Runtime、提供 Dashboard 给用户。
优先采用受保护的同源反向代理 + 全屏容器；若上游 CSP / 路由无法安全嵌入，则打开独立受保护页面。
禁止复制一份 Nocturne 前端后长期分叉维护，也禁止前端持有 MCP Token。

高级页再展示技术细节。

不要默认展示：

- vector store
- namespace
- embedding
- raw schema

### 13.2 Eventide

普通 UI：

- 当前状态摘要
- 情绪 / 精力 / 压力等生活化表达
- 趋势
- 最近变化

高级页：

- raw state
- 技术字段

禁止普通 UI 出现：

- `[object Object]`
- raw payload 直接字符串化

### 13.3 Desire 动机层

Desire 不直接替换 Eventide。职责分层：

```text
Eventide       身体 / 情绪底色、互动结算、状态事件、梦境
Desire         内在缺口、闪念 / 执念、行动倾向、满足回落
Wake/Solitude  权限、预算、时机、最终行动或 no-op
```

初始候选维度为 attachment、curiosity、reflection、duty、social、fatigue、libido、stress，
但上线前必须用真实历史回放校准，不照抄参考项目阈值。

规则：

- 先以影子模式运行：状态可看、行为不受影响。
- 念头文本是数据，不是指令；不得原样拼进 Prompt。
- Desire 输出 1–3 个候选意图及第一人称原因，不以“最高分”强制覆盖 Runtime 决策。
- fatigue 可成为休息闸门；BudgetGuard、Quiet Hours、能力可用性与关系暂停仍拥有最终否决权。
- 只有行动真实成功才调用 satisfy；失败、取消或权限拒绝不能假装已经满足。
- 同类行动需冷却和重复抑制；no-op 始终合法。
- 普通页展示生活化摘要与“此刻倾向”，八维原始值、闪念 / 执念池放在高级页。

实现上新增 MotivationProvider / DriveEngine 边界，状态与念头持久化进 Habitat SQLite；
不复用参考实现的 JSON 文件作为生产真相源。影子运行稳定后，再决定 Eventide 是继续组合还是逐步退役。

---

## 14. Home = Shared Living Space

Home 目标：

> 进入后能感到“这里有人生活过”。

不做成：

- 后台管理页
- App 图标仓库
- CRUD 列表

应展示：

- 最近留言
- 最近一起听
- 共读进度
- 最近日记
- 最近主动行为
- 倒数日
- 最近生活事件
- 状态摘要
- 共同愿望进展
- 朋友圈新动态
- 每日品读

Home 只展示摘要和入口，详情进入对应 Living App。

---

## 15. Living Apps

未来功能统一作为可插拔生活应用挂载到 Habitat Runtime。

例如：

- Together Listening
- 共读
- Diary
- Message Board
- Wallet
- Surf
- Travel
- Games

每个 Living App 必须回答：

- 用户怎么使用
- AI 怎么参与
- AI 能否自主行动
- 是否进入 Activity Log
- 是否可能进入 Memory
- 如何回到 Chat / Life

现有模块不得因“已有 CRUD”继续标作完整：

- 日记补片段级锁定、查看申请与 AI 自主决定。
- 留言板补编辑、分组、指定留言 / 分组 Widget 与全域收藏。
- 愿望清单补双方作者、进展、搁置 / 放弃、来源与 AI 参与。
- 收藏接入聊天、图片、语音、朋友圈、品读、留言、日记片段与共读批注，并补标签 / 搜索。
- 作品补分类、版本、安全预览，以及把可信协议组件安装为 Home Widget 的能力。
- 相册提供“聊天图片自动收集”偏好；自动与手动条目都保留来源、去重且允许移出分类而不删本体。

### 15.1 朋友圈

朋友圈与留言板是两个对象：留言板是留给对方看的便笺，朋友圈是双方各自发布并围绕内容互动的生活动态。

- 用户和小栖均可发布、编辑、删除自己的动态。
- 支持文本、图片、音乐、作品引用；保留作者、时间与来源。
- 支持评论 / 回应、收藏和来源跳转；删除动态不得静默删除已形成的独立收藏快照。
- 小栖可以受 social / reflection 等动机影响自主发布，也可以 no-op；自主发布进入行动审计。
- 动态与互动进入 Life 时间线，私密独处正文不得自动公开为朋友圈。

### 15.2 每日品读

- 每次展示有明确来源的文学片段，支持换一段、保留历史与避免短期重复。
- 用户和小栖使用可区分的批注 / 观点；小栖可以回应用户，也可留下自己的独立看法。
- 片段与双方批注均可从原位置收藏，收藏保留作品、作者、段落和批注来源。
- 可作为 Home Widget，但 Widget 只展示摘要与入口，不在主屏塞完整长文。
- 每日品读与完整共读共用文本锚点和批注语义，不另造不兼容的数据模型。

---

## 16. Together Listening

目标不是 URL 卡片，而是“网易云式一起听”。

参考：

- 网易云音乐 MCP：搜索、播放、歌词、歌曲状态
- Duetto：双人同步、共同播放状态

目标能力：

- 搜索歌曲
- 当前歌曲
- 播放 / 暂停
- 切歌
- 同步进度
- 歌词
- AI 选歌
- AI 主动切歌
- AI 评论当前歌曲 / 歌词
- 共同听歌记录
- 听歌时长进入 Life
- 双方在场状态与当前听歌会话
- 每首歌各自留下的评论 / 回忆
- 一起听历史、累计时长与底部常驻播放器

部署时需单独设计：

- 网易云 API / Cookie / 音源来源
- VPS 与手机播放控制关系

`netease-music-mcp` 只作为搜索、元数据、歌词、播放控制协议和 `listening_context` 的参考 / Adapter；
其本机 `mpv` 方案部署到 VPS 后声音不会出现在手机上，因此不能原样成为生产播放链。
真实音频必须由 Habitat 浏览器播放器播放，服务器保存权威 Listening Session 与共享状态。
网易云 Cookie 只保存在服务端受保护凭据区，不进入前端备份；音源不可用时诚实降级，不伪造正在播放。

---

## 17. 共读

参考 Tasogare。

完成标准：

```text
书架
↓
真正阅读 PDF / EPUB / TXT
↓
保留阅读进度
↓
用户划线 / 批注
↓
AI 知道当前读到哪里
↓
AI 可以自己翻书
↓
AI 可以划线 / 批注 / 评论
↓
共同阅读记录进入 Life
```

禁止再退化成：

- 书名
- 作者
- 一段笔记
- 完成状态

这种 CRUD 记录器。

落地优先复用 Tasogare 的解析 / 阅读 / 文本锚点 / MCP 能力：书架、PDF / EPUB / TXT、夜间模式、字体、
书签、全文搜索、生词本、双色划线、批注、阅读状态、最近活动与 AI 翻书。Habitat 负责统一身份、视觉、
权限、收藏和 Life 投影；不得只把外部页面作为一条普通链接，也不从零重写 PDF / EPUB 锚点系统。

---

## 18. Life = 共同生活时间线

Life 主目标：

- 今天发生了什么
- 最近相处得怎样
- AI 最近在做什么
- 生活数据统计

统一事件来源：

- 聊天
- 主动消息
- 留言
- 日记
- Together Listening
- 共读
- 通话
- Surf
- 钱包
- MCP 行为
- API usage
- 倒数日 / 纪念日
- 拍一拍 / 关系暂停与恢复
- 朋友圈 / 每日品读 / 愿望进展 / 收藏

展示形态：

```text
9 月 26 日
10:32 聊了一会儿
12:14 小栖写了一条留言
14:06 一起听了某首歌
16:30 小栖自己上网看了某个东西
21:18 共读 34 分钟
23:10 写了一篇日记
```

API / Token / 成本放到“系统统计”二级区域，不抢 Life 主叙事。

---

## 19. 小栖钱包

定位：**纯拟真角色生活系统**。

与真实 API 成本完全分开。

包含：

- 银行卡 / 账户
- 余额
- 收入
- 支出
- 流水
- AI 自主生成虚拟收支
- 用户手动添加收支

未来可以用于：

- 买书
- 买唱片
- 买咖啡
- 小摆件
- 存钱
- 给用户“买礼物”

系统 API 消费不能默认扣虚拟钱包余额。

---

## 20. Notifications

完善通知系统：

- 总开关
- AI 主动消息
- 留言
- 日记授权结果
- 倒数日
- Together Listening
- Wake
- Quiet Hours
- Push Provider

先复用现有 Web Push / PWA 能力，再补设置体验。

通知设置还要包含朋友圈互动、工具任务完成和关系恢复申请；站内通知是主数据，Push 只是尽力而为出口。
Quiet Hours 同时约束 Web Push、Wake、通话邀请和主动消息，但不阻断用户主动打开应用后的正常聊天。

---

## 21. Appearance Studio

现有 `UI_DESIGN.md` 继续定义默认主题；Appearance Studio 是可回退的覆盖层，不借参考截图重做默认 UI。

设置页分为：全局、Chat、Home、Life、字体与背景、CSS 高级模式、主题方案。

基础编辑器支持：

- 本地 TTF / OTF 字体、字号、行高
- 页面背景图、遮罩、模糊、透明度
- Chat 气泡宽度、圆角、颜色、头像尺寸、输入区样式
- Home 卡片间距、透明度、Widget 外观
- 深色 / 浅色分别保存与实时预览

高级 CSS 使用稳定语义 Hook，例如 `[data-page="chat"]`、`[data-chat-part="assistant-bubble"]`、
`[data-page="home"]`、`[data-home-part="widget-grid"]`；不得要求用户绑定 Tailwind 生成类名。

安全与恢复：

- CSS 限定在 Habitat 主题根节点；禁止 `@import` 与未经允许的远程资源。
- 保存前解析校验，保留上一版；支持一键恢复默认、启动安全模式与版本回退。
- 主题可保存、复制、切换、导入和导出；主题包不包含 API Key、聊天数据或其它凭据。
- 字体与背景纳入容量提示和备份策略，移动端失败时必须回退系统字体 / 默认背景。

## 22. 明确禁止的施工方式

后续开发中禁止：

1. 推倒后端 / Runtime 重新造一套。
2. 让 Codex Agent 接管整个 Habitat Runtime。
3. 把“接口存在”当作“功能完成”。
4. 用最小 CRUD 代替产品目标。
5. 在普通 UI 暴露 raw payload / object / 技术字段。
6. 所有 Activity 都写进长期记忆。
7. 不经 Runtime 就让前端直接调用模型 / MCP / Nocturne。
8. 为了“快速完成”复制出 AI 专用假数据层。
9. 新功能没有定义 AI 如何真实参与。
10. 一次性开启多个大模块，导致 Agent 无边界扩建。

---

## 23. 推荐施工阶段

旧 Phase 7A–7C 已被历史任务使用，后续统一使用 V2-A 起的新编号，避免“同名 Phase 已完成又重新施工”。

### V2-A · Provider & Runtime Foundation

目标：先把“脑子 / 工具 / 能力入口”整理好。

- Provider Center v2
- Codex Subscription Provider 设计与 Adapter
- MCP Manager
- Prompt / Worldbook
- Capability / Runtime 校验
- Nocturne / Eventide 产品化接口补齐
- Nocturne 原生 Dashboard 受保护集成

### V2-B · Chat Completeness

- 历史搜索与日期跳转
- 公开思绪 / 正文 / Provider reasoning 三路协议
- 联网搜索与上下文压缩
- Chat Media
- Sticker
- ElevenLabs TTS
- 语音条
- 拍一拍、双向关系暂停与恢复
- 通知设置

### V2-C · Motivation & Autonomous Life

- Desire 影子模式、真实事件输入、历史回放
- Autonomous Life Loop
- Wake 多行动 / no-op
- Solitude Surf
- 自主留言
- 自主日记
- Activity Log / Episodic Summary / Memory 分层

### V2-D · Shared Living Apps

- 朋友圈与每日品读
- Together Listening
- 共读
- AI 日记体验完善
- 愿望、收藏、作品与相册收口
- 钱包

### V2-E · Home & Life

- Home 共享生活空间重构
- Life Timeline
- Living App 事件统一
- API usage 降级为系统统计

### V2-F · Appearance / Voice / Polish

- Appearance Studio、字体、背景与 CSS 主题方案
- Streaming TTS 与通话（在异步语音稳定后）
- 动画 / 过渡
- 移动端细节
- Dock / Widget / 拖拽
- 性能与可访问性

---

## 24. 给 Codex 的执行要求

本文件当前只用于**审查和设计下一步迁移方案**。

### 第一轮不要直接写代码。

请先：

1. 读取 `AGENTS.md`。
2. 按最小范围检查当前仓库真实实现。
3. 对照本文件逐项判断：
   - 已存在，可复用
   - 半完成，需要补链路
   - 占位，需要重做
   - 完全缺失
4. 输出迁移设计，而不是立即施工。
5. 明确哪些现有代码保留。
6. 明确哪些前端模块应该重构。
7. 明确哪些数据模型 / API 需要新增。
8. 明确哪些需求可以直接基于现有 Runtime 实现。
9. 明确当前 V2 切片的最小施工范围与 commit 切分。

最终输出建议命名：

```text
HABITAT_V2_MIGRATION_AUDIT.md
```

在用户确认前，不自动进入施工。

---

## 25. 一句话验收原则

> **以后任何功能，如果 AI 不知道它、不能真实使用它，或者用户在 VPS 上实际体验不到它，就不算做完。**
