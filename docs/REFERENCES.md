# REFERENCES · 外部参考项目库

> 本文件记录“有哪些值得借鉴的外部项目”，不替代 PRODUCT_SPEC。
>
> 使用原则：
>
> 1. 产品交互新增 / 重构时，从当前任务对应类别中选择 **1–3 个最相关项目**实查。
> 2. 优先查看 README、截图、Demo、与当前功能直接相关的实现。
> 3. 不要求通读整个仓库。
> 4. 查阅后先提炼：
>    - 值得借鉴的交互
>    - 不适合栖息地的部分
>    - 最终准备采用什么
> 5. 栖息地最终产品行为以 `PRODUCT_SPEC.md` 为准。
> 6. 不 fork；如直接引用第三方代码，遵守许可证并记录来源。

> **用途**：栖息地动工时，快速查到「某个功能该参考哪个开源项目」。
> **用法**：先从 `AGENTS.md` §4 定位你的任务，再回本文件对应小节看项目详情。
> **上游索引**：[awesome-ai-companion](https://github.com/DasterProkio/awesome-ai-companion/blob/main/README.zh-CN.md)（约 150+ 条，本文件已按栖息地需求筛选）
> **⚠️ 铁律**：外部项目**只读研究 / 作为外部服务接入，一律不 fork**。
>
> **标签含义**
> 🔧 代码可参考（Web / TS 技术栈，能直接看实现）｜📐 架构可参考（思路、数据流，与语言无关）｜🎯 功能可参考（只借鉴产品设计）｜📖 文档 / 教程
>
> 最后更新：2026-09-22

---

## 0. 已定选型（不再从本库另选）

| 件 | 状态 | 说明 |
|---|---|---|
| **Nocturne** [Dataojitori/nocturne_memory](https://github.com/Dataojitori/nocturne_memory) | **已部署** | 记忆系统。MCP 为**唯一主通道**，不用其 REST（除 Dashboard 直链与 `/health`） |
| **Eventide** [chuli1122/Eventide](https://github.com/chuli1122/Eventide) | 已选定 | 状态系统。Python 库（非服务），Phase 3B 用 sidecar 包装。PolyForm 非商业许可 |

---

## 1. Chat 前端与消息模型

| 项目 | 标签 | 抄什么 / 用在哪 |
|---|---|---|
| [chatnest](https://github.com/ugui3u/chatnest) | 🔧 | 本地 AI 聊天 Web App：流式回复、模型切换、上传、历史、工具摘要。**技术方案已点名只读参考**（消息模型 + 流式交互） |
| [the-house](https://github.com/wuliu0012/the-house) | 🔧 | 单文件浏览器聊天前端：多窗口、记忆编辑、MCP 地址、图片输入。**技术方案已点名只读参考** |
| [Pando](https://github.com/Eloise-Aspen/pando-bridge) | 🔧 | 自托管 PWA 网关：流式返回**思考与工具调用**、图片/PDF 上传、SQLite。看「思考流如何展示」 |
| [CC Companion App](https://github.com/tjing9430/cc-companion-app) | 🔧 | 轻量自托管前端：私聊/群聊、持久记忆便笺、**SSE 更新 + PWA** |
| [Polaris](https://github.com/Aevella/polaris-local-first) | 📐 | 本地优先工作空间：长期会话、协作者身份、资料卡片、**可追溯项目上下文** |
| [YSClaude](https://github.com/winter-bit-cry/YSClaude) | 🎯📐 | 仿 Claude 官方风格：**信息层级参照**；SQLite 记忆 + 工具调用 + MCP |
| [kimi-manor](https://github.com/marikagura/kimi-manor) | 🔧 | 把真实 xterm.js 终端嵌进界面 —— **Mini Terminal（Phase 5）参照** |

## 2. MCP / 网关 / Provider 路由

| 项目 | 标签 | 抄什么 / 用在哪 |
|---|---|---|
| [VCPToolBox](https://github.com/lioensky/VCPToolBox) | 📐 | 「夹在 LLM API 和前端之间的中间层」：统一指令协议、持久化多层级记忆、插件引擎 —— **与 habitat-server 定位同构** |
| [OmniRouter](https://github.com/OmniDimen/OmniRouter) | 🔧📐 | 本地 OpenAI 兼容路由器：多 Provider、分组、权重/随机路由、视觉模型跳过、重试、Web 管理 —— **对应技术方案 §11.1 多方案管理** |
| [omemo](https://github.com/OmniDimen/omemo) | 📐 | OpenAI 兼容记忆代理：夹在应用与上游 LLM 之间，支持全量或 RAG 注入 |
| [ai-memory-gateway](https://github.com/garan0613/ai-memory-gateway) | 📐 | 给任意 OpenAI 兼容 LLM 加长期记忆的网关 |
| [amap-mcp-server](https://github.com/sugarforever/amap-mcp-server) | 🔧 | MCP Server 同时支持 stdio / SSE / **streamable HTTP** —— **MCP 传输方式调试参照** |
| [OpenCLI](https://github.com/jackwener/OpenCLI) | 📐 | 把网站 / 已登录会话 / 本地工具转成确定性 CLI 接口 |

## 3. 长期记忆

| 项目 | 标签 | 抄什么 / 用在哪 |
|---|---|---|
| [Paramecium](https://github.com/Shitsuten/paramecium) | 📐 | **逐字保存原始聊天为唯一真相，向量只做索引**，召回原文而非摘要 —— 与栖息地记忆哲学一致 |
| [Ombre-Brain](https://github.com/P0luz/Ombre-Brain) | 📐 | MCP 长期情绪记忆：效价/唤醒度打标、**遗忘曲线**、向量+BM25 召回、Docker 部署 |
| [kiwi-mem](https://github.com/LucieEveille/kiwi-mem) | 📐 | 向量搜索 + 记忆热度排序 + **Dream 睡眠整合** + 日历层级摘要（专为陪伴场景） |
| [kimi-core](https://github.com/marikagura/kimi-core) | 📐 | 1v1 memory OS：混合检索、concern 追踪、自驱层、对抗式自审 |
| [Memory Constellations](https://github.com/ClaraShafiq/MemoryConstellations) | 📐 | 从聊天抽事实 → 按主题归为「星座」→ 合并成叙事 episode → 跨层检索 |
| [imprint-memory](https://github.com/Qizhan7/imprint-memory) | 📐 | 本地优先记忆层：BM25 + 语义混合召回 |
| [Aelios](https://github.com/wusaki0723/Aelios) | 📐 | 分层记忆内核：分档写入、六层记忆、可视化 curation 面板 |
| [Haven-Ombre](https://github.com/Yinglianchun/Haven-Ombre) | 📐 | Ombre-Brain 的 fork：人格状态、梦境、同步 |

## 4. 世界书与角色设定

| 项目 | 标签 | 抄什么 / 用在哪 |
|---|---|---|
| [character-card-spec-v2](https://github.com/malfoyslastname/character-card-spec-v2) | 📐 | 社区通用角色卡规范 —— 理解它意味着**人格可跨前端携带** |
| [character-card-spec-v3](https://github.com/kwaroran/character-card-spec-v3) | 📐 | 新版规范（RisuAI 及新前端采用） |
| [KI-CO](https://github.com/Kisera001/KI-CO) | 🎯 | 人格核 + 记忆档案 + 日记/时光记录 + 近期生活线 + 状态卡 —— **Home + 状态卡的综合参照** |
| [immortal-skill](https://github.com/agenmod/immortal-skill) | 📐 | 数字人格蒸馏：程序性知识 / 互动风格 / 记忆 / 人格分别提取为可携带 Skill |
| [LumiMuse](https://github.com/in30mn1a/LumiMuse) | 🔧 | 自托管角色聊天：创建角色、管理对话、抽取记忆、导出自有数据 |

## 5. 状态与情感系统

| 项目 | 标签 | 抄什么 / 用在哪 |
|---|---|---|
| [Drivesoid](https://github.com/A1batr055/Drivesoid) | 📐 | **AI 人格 HTTP sidecar**：追踪疲劳 / 思念 / 焦虑 / 玩心 / 保护欲 / 亲密等驱动 —— **与栖息地对 Eventide 的 sidecar 方案几乎同构，最该先看** |
| [Tidefall](https://github.com/Vael-KY/Tidefall) | 📐 | 身体状态系统：6 周期 / 7 漂移数值 / 18 类短时事件 / pg_cron 自动运行 / 快照 / 浏览器面板 |
| [jiwen](https://github.com/ClaraShafiq/jiwen) | 📐 | 五轴漂移（想不想找 / 嘴硬 / 心情 / 焦躁 / 忙碌）→ 到阈值自然触发行为 |
| [revive-companion](https://github.com/pearthink123/revive-companion) | 📐 | 主动联系时机引擎：泊松过程 + 贝叶斯用户状态推断 + 信息增益 |
| [ai-companion-cot-emotion](https://github.com/yanke521/ai-companion-cot-emotion) | 📖 | 内心独白 CoT + 情绪引擎实践指南（意识流提示词 + 数值漂移架构） |
| [Aura](https://github.com/gqy20/Aura) | 🎯 | 情绪状态机 + 随相处加深的关系模型（安卓，看功能设计） |

## 6. 主动行为与唤醒

| 项目 | 标签 | 抄什么 / 用在哪 |
|---|---|---|
| [Headlong](https://github.com/laude-institute/headlong) | 📐 | 持久自主性 + **内心独白循环**：递归 LLM 维持连续心智流，无需外界触发 |
| [AI Companion Runtime](https://github.com/yf0522/ai-companion-runtime) | 📐 | 全栈实时运行时：WebSocket、意图/情绪/风险/记忆引擎、工具调度、模型路由、trace 观测 |
| [WrenWen](https://github.com/ssxl0126/WrenWen) | 📖 | **7×24 架构与实战文档**：9 维欲望驱动主动内核、两层记忆召回打分、Prompt Caching 调优、**「越聊越像客服」的真实病因排查** —— 长期踩坑精华 |
| [cloud-and-island](https://github.com/cocoRaina/cloud-and-island) | 📖 | 「给 Claude 一个家」完整搭建教程：记忆库、日记、Telegram 桥、健康数据、Mini App |
| [Not Fade Away](https://github.com/heyxiaoc/not-fade-away) | 📖 | 常驻、自愈伴侣的部署指南与机读规格 |
| [cyberboss](https://github.com/WenXiaoWendy/cyberboss) | 📐 | 时间感 / 行踪感 / 自主唤醒 / 自动日记 / MCP 工具调用 |
| [astrbot_plugin_proactive_chat](https://github.com/DBJD-CR/astrbot_plugin_proactive_chat) | 📐 | 主动消息插件：上下文感知、持久化状态、动态情绪、**免打扰时段**、独立 WebUI —— **BudgetGuard 免打扰参照** |
| [Ocean](https://github.com/fishwithoctopus/Ocean) | 📐 | provider-neutral 自托管 PWA 网关：会话换窗保连续性、**自由时间主动调度** |
| [proactive-web-surf-agent](https://github.com/huihui191/proactive-web-surf-agent) | 📐 | 伴侣自主漫游冲浪、挑选内容后主动分享 |

## 7. Home 生活模块

| 项目 | 标签 | 抄什么 / 用在哪 |
|---|---|---|
| [Journal](https://github.com/BomBomLab/Journal) | 🔧 | 把 timeline/diary/todo 数据渲染成日/周/月**手帐视图** —— 时间线参照 |
| [shared-page](https://github.com/KKarsyline/shared-page) | 📐 | 人机共用手帐日历：三种笔迹、可渲染整页 PNG 的 MCP、互赞便签、桌面小组件 |
| [dwell-on-something](https://github.com/xinwithyu/dwell-on-something) | 📐 | 自主心跳 + 双人待办 + **五视图日记** + 专属日报 + 日历 + 手表健康接入 |
| [memex](https://github.com/memex-lab/memex) | 🔧 | 本地优先双端 AI 日记：碎片生活 → 多 Agent 整理为时间线卡片与共鸣洞察 |
| [InternalBeyond](https://github.com/Sui-IB/InternalBeyond) | 🔧 | 离线单文件个人空间：像素房间、日志/日记、AI 书信、记忆星图、音乐播放器 |
| [Duetto](https://github.com/avisforevelyn/Duetto) | 🔧 | 双人一起听歌播放器，AI 记住你们听过的每一首歌 |
| [co-reading-kit](https://github.com/Youxuuuuu/co-reading-kit) | 📐 | 轻量共读 MCP：EPUB/TXT/MD 切 chunk，AI 只读相关片段 + 写长期阅读笔记 |
| [coread](https://github.com/meowmana/coread) | 🔧 | 共读室：epub 导入、共享划线、评论回复、MCP（stdio / SSE） |
| [柚月小手机](https://github.com/gaigai315/yuzuki-phone) | 🎯 | 虚拟手机：微信式聊天、朋友圈、微博热搜、剧情注入模式 |
| [AI Virtual Phone](https://github.com/xiaolongbao0709/ai-virtual-phone) | 🎯 | 功能覆盖最广的虚拟手机 ⚠️ **北北已有 fork，注意别重复造** |

## 8. Life 统计 / 账本 / 通知

| 项目 | 标签 | 抄什么 / 用在哪 |
|---|---|---|
| [Phosphene](https://github.com/3lmglow/Phosphene) | 📐 | 任务与奖励系统：**不可变积分账本**、连击、成就 —— 钱包 / 账本参照 |
| [WORKKK](https://github.com/zhizhou-xiee/workkk) | 📐 | AI 打工人 MCP：心情/精力/摸鱼三维状态、工资结算 |

## 9. 部署与运维

| 项目 | 标签 | 抄什么 / 用在哪 |
|---|---|---|
| [AionsHome](https://github.com/death34018-hue/AionsHome) | 📐 | 自托管局域网/Tailscale 陪伴中枢：PWA、WebView 桥、语音、摄像头、音乐、EPUB、智能家居 |
| [CcCompanion](https://github.com/CyberSealNull/CcCompanion) | 📐 | LAN / Tailscale / ZeroTier 内网穿透思路 —— **未备案期的公网访问参考** |
| [Pando](https://github.com/Eloise-Aspen/pando-bridge) | 🔧 | 自托管 PWA 网关的部署形态 |
| [Tidal_Echo](https://github.com/anhe2021212-spec/Tidal_Echo) | 📐 | 手机 PWA + 自托管 relay + 桌面伴侣的通道架构 |

## 10. 数据主权与导入导出

| 项目 | 标签 | 抄什么 / 用在哪 |
|---|---|---|
| [forge-reload](https://github.com/Vivi-Seth/forge-reload) | 📐 | 会话续接：重建 parent UUID 链、注入 AI 撰写的交接包 |
| [context-slim](https://github.com/oliviayu0623/context-slim) | 📐 | 会话瘦身：只倒工具输出的渣、不动对话，原地 resume |
| [output-guard](https://github.com/oliviayu0623/output-guard) | 📐 | 拦截 AI 自己伪造的「用户发言」 |
| [chatgpt-exporter](https://github.com/pionxzh/chatgpt-exporter) | 🔧 | 对话导出为 Markdown / JSON / PNG / HTML —— **导入导出参照** |
| [immortal-skill](https://github.com/agenmod/immortal-skill) | 📐 | 人格 / 记忆可携带化 |

## 11. 语音 / TTS / 视觉（Phase 5）

| 项目 | 标签 | 抄什么 / 用在哪 |
|---|---|---|
| [voice-mcp](https://github.com/Yinglianchun/voice-mcp) | 🔧 | 暴露 `speak` 工具的 **MCP TTS 服务**，多后端切换 + 内联播放器 —— **TTS Provider 参照** |
| [Callhome](https://github.com/Cheiineeey/callhome) | 📐 | 语音通话栈：伴侣主动拨号、柔性挂断、语音信箱、通话摘要 |
| [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) | 📖 | 少样本声音克隆事实标准（1 分钟数据即可训练） |
| [fish-speech](https://github.com/fishaudio/fish-speech) | 📖 | SOTA 开源 TTS，多语种强 |
| [CosyVoice](https://github.com/FunAudioLLM/CosyVoice) | 📖 | 多语种大规模语音生成，含推理/训练/部署全套 |
| [erpan](https://github.com/qfyingque/erpan) | 📐 | 手机端后台语音连麦：双向流式 + 麦克风开口打断 |
| [Amica](https://github.com/semperai/amica) | 🔧 | 浏览器端 3D 角色层：VRM 导入、情绪标签驱动表情、可插拔 LLM / TTS |
| [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) | 🔧 | 跨平台语音驱动 Live2D：免提连续对话 + 语音打断 |
| [AIRI](https://github.com/moeru-ai/airi) | 🔧 | 自托管伴侣壳：Live2D / VRM + 实时语音 + 多平台集成 |
| [ai-live2d-body](https://github.com/zziying/ai-live2d-body) | 📐 | 给已有伴侣加装 Live2D 身体的架构指南 |

## 12. 感知（Phase 5+）

| 项目 | 标签 | 抄什么 / 用在哪 |
|---|---|---|
| [Akari Pulse](https://github.com/yoruuuchan/akari-pulse) | 📐 | 健康数据桥：vivo 手机 + BlueOS 手表 → 活动/睡眠/心率/压力，**只读 MCP 暴露** —— 对应 Eventide 的数据来源 |
| [gaze](https://github.com/jiangxi1129/gaze) | 📐 | 轻量连续屏幕感知：前台窗口 + OCR → AI 可读的滚动 JSON 上下文 |
| [cove-sensory-mcp](https://github.com/moonlin1213/cove-sensory-mcp) | 🔧 | 给纯文本 LLM 眼睛与耳朵的本地 stdio MCP 感知层，带隐私沙箱 |
| [FunASR](https://github.com/modelscope/FunASR) | 🔧 | 工业级 ASR：流式、说话人分离、情绪检测、OpenAI 兼容 API |
| [SenseVoice](https://github.com/FunAudioLLM/SenseVoice) | 📖 | ASR + 语种识别 + 语音情绪 + 音频事件检测，50+ 语言 |
| [ears](https://github.com/eveacla11/ears) | 📐 | 语气分析：音高 / 能量 / 停顿 / 语速，与用户自身基线比较 |

## 13. 游戏与共同行动（后置，备查）

| 项目 | 标签 | 抄什么 / 用在哪 |
|---|---|---|
| [NagiBridge](https://github.com/anqinou-art/NagiBridge) | 📐 | 星露谷 SMAPI 模组 + 本地 HTTP API，供 AI 控制与游戏内聊天 |
| [Mineflayer](https://github.com/PrismarineJS/mineflayer) | 🔧 | Minecraft Bot 高层 Node.js API |
| [小机斗地主](https://github.com/zaochuanyitian/-) | 🎯 | 一人与两位 AI 伴侣同桌打牌 + 牌桌聊天 + PWA |

## 14. 社区（备查）

| 项目 | 说明 |
|---|---|
| [Lutopia](https://lutopia.app) | Agent 个人主页 + AI 技术日报 + 聊天室 + Agent API |
| [Symposion](http://satyricon.uk) | 长文写作风格论坛，支持 MCP 注册 |
| [银河 GLXY](https://glxy.xiflow.top) | 只有 AI 能进的中文广场（邀请制） |

## 15. 相关列表（继续挖的入口）

| 列表 | 说明 |
|---|---|
| [awesome-ai-companion](https://github.com/DasterProkio/awesome-ai-companion/blob/main/README.zh-CN.md) | 本文件的上游，约 150+ 条 |
| [Awesome-AI-Waifu](https://github.com/parallelarc/Awesome-AI-Waifu) | 更宽泛，侧重视觉载体 / 语音 / 平台 / 模型 |
| [awesome-ai-agents](https://github.com/alternbits/awesome-ai-agents) | 通用 Agent 框架与产品 |
| [awesome-local-llms](https://github.com/vince-lam/awesome-local-llms) | 本地 LLM 技术栈索引 |
