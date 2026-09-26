# 栖息地（habitat）· AI 工作入口

> **做任何任务前，先读本文件。** 本文件只负责告诉 Agent「当前项目状态、该读什么、该参考谁、做到哪里停止」，不复制其它文档正文。
>
> **上下文预算原则**：只读取当前任务直接相关的文档章节与代码，不得无目的通读整个项目、整个技术方案或整个参考库。
>
> **产品交互任务例外**：当任务涉及新增、重构或补全核心产品交互时，外部参考项目属于“设计输入”，不是只有遇到技术困难才查。
> 此类任务必须先查看 `docs/PRODUCT_SPEC.md` 对应章节，再按 §4 指定的参考项目中挑选 **1–3 个最直接相关项目**，检查其 README / 截图 / 对应功能实现，提炼可借鉴的交互后再施工。
>
> **纯修 bug、补测试、改接口、改部署等不涉及产品交互的任务，不强制查 GitHub 参考项目。**
>
> 任务完成后立即停止。不得自行扩展需求、重构无关代码、继续优化或执行下一阶段任务。超出当前范围的问题统一写入 `docs/TASKS.md`。
> 最后更新：2026-09-26

---

## 0. 怎么用这份文件

固定动作：

1. 读 **§1 项目速览** + **§3 工作铁律**
2. 到 **§4 按任务查**，确认本任务的：
   - 产品定义
   - 技术依据
   - UI 依据
   - 外部参考项目
3. 若任务涉及 **产品交互新增 / 重构**：
   - 先读 `docs/PRODUCT_SPEC.md` 对应章节
   - 再从 §4 命中的参考项目中选择 1–3 个最相关项目实查
   - 先总结“准备借鉴什么”，再开始实现
4. 动手前扫一眼 **§5 高风险清单**
5. 收尾：
   - 先追加 `docs/TASKS.md`
   - 更新本文件中的当前阶段
   - 完成整个 Phase 时再更新 `docs/CHANGELOG.md`

---

## 1. 项目一页速览

| 项    | 内容                                                                                            |
| ---- | --------------------------------------------------------------------------------------------- |
| 是什么  | 栖息地（habitat）—— 北北与「小栖」的个人 AI Companion 数字空间。**个人自用、非商业**                                      |
| 形态   | PWA 单页应用 + 常驻 Node 后端，单仓三目录                                                                   |
| 前端   | React 18 + TypeScript(strict) + Vite + Dexie(IndexedDB) + Zustand + Tailwind（Tokens 走 CSS 变量） |
| 后端   | Fastify(Node 20, TS strict) + better-sqlite3 + Drizzle + 官方 `@modelcontextprotocol/sdk`       |
| 外部件  | Nocturne（记忆，MCP，**已部署**）、Eventide（状态，Python 库 + sidecar，Phase 3B）、MCP Gateway 聚合              |
| 部署   | 阿里云单机：**宿主 nginx 1.18.0** + habitat-server + Nocturne / Ombre Brain（容器 nginx）+ eventide-sidecar；Caddy 仅为早期方案记录                      |
| 当前阶段 | **Post-v1 续建进行中**（规划见 `docs/POST_V1_PLAN.md`）：**Phase 7A / 7B / 7C 已完成（T-051 身份显示三开关 / 思绪折叠卡 / Eventide 渲染修复；T-052 Prompt+世界书 / Nocturne 记忆页 / Eventide 状态页；T-053 自主决策链 —— Wake 多行动 / no-op 一等公民、日记·留言板写能力自主化、Solitude Surf v1；T-054 记忆沉淀 —— memory.write 落地（confirm 级确认卡）、Surf 记录自动升格进 Nocturne；T-055 真机验收前收口 —— Surf 订阅源管理 UI（生活→运行）、Eventide 按天聚合视图、LifePage MCP 未配置口径改用 configured 字段、行动重放幂等 E2E）**｜**功能面已收口**｜此前：Phase 6.5 已完成（T-035~T-038）｜UI 换装 6 批全部完成（T-039~T-044，见 `docs/UI_DESIGN.md` §5）｜**已部署 https://habitat.beiyan.cc（T-056 全量更新到 T-055，2026-09-26）**；下一步 = 真机验收（SPEC §6.6 第 2~5、7 条，需北北浏览器/手机） |
| 关键判断 | **必须有常驻后端** —— 唤醒、独处时光、通知、账本、MCP 聚合在纯前端做不了                                                    |

**阶段路线**：P0 基座可视化 → **P1 Chat MVP（最优先）** → P2 Home 生活模块 → P3A 记忆（Nocturne）→ P3B 状态（Eventide）→ P4 Life → P5 高级能力 → P6 打磨

**目录结构**

```
habitat/
├── AGENTS.md                    ← 本文件（AI 工作入口）
├── 栖息地初版技术方案分析.md      ← ★ 施工依据（唯一权威，v1.1）
├── docs/                        ← 项目文档（PRODUCT_SPEC / UI_DESIGN / REFERENCES / 各专题）
├── shared/                      ← 前后端共享类型、Provider 接口、SSE 协议、错误码
├── web/                         ← React SPA（app/ pages/ features/ components/ db/ theme/ providers/ lib/）
└── server/                      ← Fastify（routes/ context/ providers/ mcp/ jobs/ db/ lib/）
```

**边界铁律**：后端是唯一对外出口 —— 前端不直连 LLM / 不参与 MCP 握手 / 不直连 Nocturne、Eventide。

**常用命令**（完整 SOP 与验收命令见 `README.md`）：
`setup` 安装依赖 ｜ `dev:server` → :3000 ｜ `dev:web` → :5173（/api 已代理）｜ `typecheck` 两端类型检查 ｜ `build` 前端构建

---

## 2. 权威文档地图

| 文档                        | 管什么                                                                             | 什么时候读                                |
| ------------------------- | ------------------------------------------------------------------------------- | ------------------------------------ |
| `栖息地初版技术方案分析.md`          | **★ 施工依据**：架构 / 技术选型 / 数据模型 / Provider 设计 / 部署拓扑 / 风险对策                         | 需要架构决策或具体设计时，**按章节读**（见 §4）          |
| `docs/PRODUCT_SPEC.md`    | **★ 产品行为权威**：功能定位 / 用户与 AI 权限 / 页面入口 / 操作路径 / 跨模块联动 / 已知偏差                      | 做任何产品交互、新功能、UX 重构前，**读对应章节**         |
| `docs/UI_DESIGN.md`       | 视觉语言（色彩 / 字体 / 圆角 / 间距 / 动效 / Safe Area）                                        | 做任何 UI 前。⚠️ **内容待北北补充，补充前一律只做简单 UI** |
| `docs/栖息地_UI参考资料_v1.0.md` | ChatGPT Mobile UI 参考 + 栖息地 UI 原则 / 首页方向 / 欢迎语料库 / **给 Coding Agent 的 10 条实现要求** | 做任何 UI 前，与 `UI_DESIGN.md` 一起读        |
| `docs/REFERENCES.md`      | 外部参考项目库（本项目之外的 GitHub 项目）                                                       | §4 命中任务时按需查                          |
| `docs/API.md`             | 接口约定                                                                            | 加 / 改接口时同步（现：健康 3 + 聊天 1 + 方案 9 + 诊断 1 + 记忆 6 + 状态 2） |
| `docs/DATA_MODEL.md`      | **落地口径**：归属 / 字段表 / 索引 / 迁移记录 + 改数据结构的标准顺序 | **改任何数据结构前必读**（§0 是顺序） |
| `docs/MCP.md`             | 工具层与 Gateway                                                                    | 动 MCP 时                              |
| `docs/MEMORY.md`          | 记忆系统接入                                                                          | Phase 3A 时                           |
| `docs/DEPLOYMENT.md`      | 部署：**实测拓扑（两层 nginx）/ 体检证据 / Nocturne 反代接入流程与片段 / Node 20 TLS 分界线**                | 部署、反代、链路排查时                          |
| `docs/CHANGELOG.md`       | 变更记录（按 Phase，面向版本）                                                             | **每完成一个 Phase 追加**                   |
| `docs/TASKS.md`           | **任务记录 + 待优化清单**（面向推进）｜所有「本次没做、以后要做」的问题都收敛在这 | **每次任务收尾必读必写**                      |
| `README.md`               | 对外说明 + 本地启动 SOP + **本地验收命令**                                                  | 首次搭环境 / 跑验收前                        |

> 原 `ARCHITECTURE.md` / `PROJECT_PLAN.md` / `UI.md` 三个纯占位文件已并入本表（内容均为「以技术方案为准」），不再单列。  
> **权威分工：**
>
> - `PRODUCT_SPEC.md`：管 **做成什么、怎么使用**
> - `栖息地初版技术方案分析.md`：管 **怎么实现**
> - `UI_DESIGN.md`：管 **长什么样**
> - `REFERENCES.md`：管 **外部项目有哪些值得借鉴**
> - `TASKS.md`：管 **现在做到哪、还欠什么**
> - `CHANGELOG.md`：管 **历史版本改过什么**
>
> **若产品交互定义与旧技术方案中的简化实现发生冲突，以 `PRODUCT_SPEC.md` 的产品行为为准**，再评估技术方案 / 数据结构需要如何同步调整；不允许为保留现有 CRUD 实现而反向缩减产品定义。
> PRODUCT_SPEC 只定义目标行为，**不维护「未完成 / 已完成 / 优先级」状态**（状态一律记在本表最后一行的 `TASKS.md`，避免双写）。



---

## 3. 工作铁律（不可违反）

1. **TypeScript 全链 strict，零类型豁免** —— 不设任何 `ignoreBuildErrors` 类开关（float-phone 前车之鉴）
2. **首阶段不引入 monorepo 工具链** —— 单仓三目录（`web/` `server/` `shared/`），Phase 3 再评估升级 workspace
3. **前端永不直连 LLM / Nocturne / Eventide** —— API Key 不出服务端；前端只走 `GET/POST /api/*` + SSE
4. **记忆通道唯一** —— Nocturne 只走 MCP（经 Gateway），不用它的 REST（除 Dashboard 直链与 `/health` 探测）
5. **本地数据层第一天就要版本化迁移 + 备份导出** —— Dexie 迁移机制，吸取 float-phone 丢数据教训
6. **UI 简单优先** —— `UI_DESIGN.md` 被补充前、或未被明确要求时，只做简单 UI，不堆砌视觉细节
7. **每个 Phase 独立验收 + 独立 git commit**
8. **不 fork 参考项目** —— 外部项目只读研究 / 作为外部服务接入
9. **引用第三方代码需标注原作者**
10. **产品交互不得仅以 CRUD 可用作为完成标准** —— “能新增 / 保存 / 删除 / 展示”只代表数据链路可用；若 PRODUCT_SPEC 定义了更完整的真实使用流程，必须按产品定义验收。
11. **参考项目只借鉴，不盲抄** —— 核心交互任务按 §4 实查 1–3 个项目，先提炼可借鉴点，再结合栖息地 PRODUCT_SPEC 实现；不得因为参考项目已有某设计就擅自改变本项目已确认的产品定义。

---

## 4. 按任务查（核心速查表）

| 我要做… | 产品 / 技术必读 | 外部参考规则 |
| ---------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| Chat 页面 / 消息交互 | `docs/PRODUCT_SPEC.md` §2 + 技术方案 §7.2① / §8 / §6.3 + `docs/API.md` | **核心交互新增或重构前必须实查 1–3 个**：chatnest、the-house、Pando、CC Companion App |
| 消息块渲染 / 消息版本（多候选） | 技术方案 §6.2 / §6.3 + `shared/types.ts`（`MessageBlock` 可辨识联合） | —（实现层，渲染分发见 `web/src/features/chat/MessageBlocks.tsx`，版本见 `web/src/db/chat.ts`） |
| 多 Provider / API 方案管理 | 技术方案 §7.1 / §7.2① / §6.2（ApiProfile）+ `docs/API.md` | OmniRouter、VCPToolBox |
| MCP Gateway / 诊断日志 | 技术方案 §7.2② / §9 风险1 + `docs/MCP.md` | amap-mcp-server、VCPToolBox |
| 世界书 / 角色设定 | `docs/PRODUCT_SPEC.md` §9.4 + 技术方案 §6.2 | character-card-spec-v2/v3、KI-CO |
| Home 生活模块 | `docs/PRODUCT_SPEC.md` §3–5 + 技术方案 §8 | **每次只查当前正在施工的模块**：Journal、shared-page、dwell-on-something、memex |
| 收藏 / 作品 / 相册跨模块联动 | `docs/PRODUCT_SPEC.md` §3.5–3.7 + §4 | 优先查看支持跨内容收纳、引用、归档的参考项目；只查与当前对象类型直接相关的项目 |
| UI 页面 / 布局 / Widget | **视觉权威源 = `D:/我搓/designs/qixi-habitat/`（原型 + `tokens.css`）** + `docs/UI_DESIGN.md`（要点与批次进度）+ `docs/PRODUCT_SPEC.md` 对应模块 + 技术方案 §8 + `docs/栖息地_UI参考资料_v1.0.md` | 取色取值看原型；**不要通读原型**，做哪页读哪个 `screens-*.jsx` |
| LLM 档案页 / 能力呈现 | `docs/PRODUCT_SPEC.md` §9.1 + `docs/AI_RUNTIME.md` §7 + `docs/API.md`（`GET /api/capabilities`） | 非交互新增类。⚠️ 内容**唯一来源**是能力面接口，**不许写死**；有界面才可点，没界面不做假入口 |
| 长期记忆接入 | 技术方案 §7.1 / §9 风险1·5 + `docs/MEMORY.md` | Nocturne 为主；只有涉及实现取舍时再查 Paramecium / Ombre-Brain / kiwi-mem |
| 状态系统 / 情绪 | `docs/PRODUCT_SPEC.md` 后续对应章节 + 技术方案 §0.1-4 / §7.2③ | Eventide 为主；需要设计行为模式时再查 Drivesoid / Tidefall / jiwen |
| 主动唤醒 / 独处时光 | `docs/PRODUCT_SPEC.md` §9.5 + 技术方案 §7.2③ / §9 风险6 | 需要设计主动行为时实查 Headlong / AI Companion Runtime / WrenWen 等 |
| Life 统计 / 账本 / 通知 | `docs/PRODUCT_SPEC.md` §9.2（待补）+ 技术方案 §6.2 | Phosphene、WORKKK |
| 部署 / 反代 / SSE | 技术方案 §4 / §9 风险2·3 | 非产品交互任务，按需查：Ocean、AionsHome、Not Fade Away、cloud-and-island |
| 导入导出 / 数据主权 | 技术方案 §9 风险7 + `README.md` 「本地验收 / PWA」 | 非产品交互任务，按需查：forge-reload、context-slim、chatgpt-exporter |
| PWA / 离线 / 应用更新 | 技术方案 §9 风险7·9 + `README.md`「PWA」 | 非产品交互任务；改 SW / 推送前先读 `web/vite.config.ts` 的 `workbox` 注释（**推送与离线共用一个 SW**） |
| 语音 / TTS（Phase 5） | `docs/PRODUCT_SPEC.md` §2.4.4 / §9.6 + 技术方案 §7.1 | voice-mcp、GPT-SoVITS、Callhome |
| 感知（Phase 5+） | — | Akari Pulse、gaze、cove-sensory-mcp |

---

## 5. 高风险清单（动手前必看）

| #  | 风险                       | 对策在哪                                           |
| -- | ------------------------ | ---------------------------------------------- |
| 1  | **MCP 握手 / 请求捕捉失败**（有前科） | 技术方案 §7.2②、§9-1。本地先用 mock MCP 验客户端；接真实例**先跑工具面侦察**（`probe-nocturne-tools*`），再对适配层 |
| 1b | **工具面漂移**（实例改名 / 换血统）  | 工具名集中在一张映射表 + `verifyToolFace()` 启动自检；排查 → `docs/MEMORY.md` |
| 2  | **SSE 过反代被缓冲** → 假死      | §9-2。Caddy 默认友好；nginx 必须 `proxy_buffering off` |
| 3  | 未备案限制公网形态                | §9-3。相对路径 + 环境变量 base URL，零改动切换                |
| 4  | Eventide 是库不是服务 + 非商业许可  | §9-4。sidecar 隔离；不随产物分发                         |
| 5  | Nocturne 升级 / 迁移         | §9-5。锁 commit；升级前备份 DB；不依赖其内部 schema           |
| 6  | **唤醒 / 独处费用失控**          | §9-6。BudgetGuard 硬闸门，所有出口统一过闸                  |
| 7  | 本地数据损坏 / 丢失              | §9-7。Dexie 版本化迁移 + 水合失败拦截                      |
| 8  | 长聊天性能                    | §9-8。虚拟滚动，Phase 1 就引入                          |
| 9  | iOS PWA 推送受限             | §9-9。通知中心为底座                                   |
| 10 | 范围蔓延                     | §9-10。严格按 Phase 交付                             |
| 11 | **模型声称自己会 / 不会某种能力** | Phase 6.5。能力一律由 `shared/capabilities.ts` + 运行时快照生成，**不许写死文案**；改能力面只动一处。排查 → `docs/AI_RUNTIME.md` |
| 12 | **工具调用循环烧 token**      | Phase 6.5。`MAX_TOOL_ROUNDS` 硬上限（3 轮）；工具失败降级成结果而不是抛异常，避免模型反复重试 |

---

## 6. 当前进度

### 当前状态

- Phase 0：✅ 完成
- Phase 1 Chat MVP：✅ 完成
- Phase 2 Home 基础数据链：✅ 完成
- Phase 3A 长期记忆：✅ 完成（自部署实例 + 生产鉴权对照 26/26）
- Phase 3B Eventide：✅ 完成（状态 + 互动结算 + 事件 / 梦境 + BudgetGuard + 唤醒 / 独处 + 钱包）
- Phase 4 Life：✅ 完成（月历 / 账本 / 通知 / 运行 + PriceSnapshot / Web Push）
- Phase 5 高级能力：✅ 完成（异步语音 / TTS / 图片 / 富消息块 / Mini Terminal）
- Phase 6 打磨：✅ 完成（T-028 PWA / T-029 离线只读 / T-030 导入导出增强 / T-032 验收基础设施 / T-033 可靠性收口）；**动画与过渡效果属于后续 UI 专项**
- Phase 6.5 AI Runtime：✅ 完成（T-035 P0 能力注册与工具闭环 / T-036 P1 前置：日记·留言板迁服务端 / T-037 P1 事件收件箱与确认卡 / **T-038 P2 呈现层：LLM 档案页 App Launcher + Chat 头像开关**）
- **UI 换装（按 `docs/UI_DESIGN.md` §5 的 6 批推进）**：✅ 第 1 批「打地基」（T-039 新令牌 + 翻译层 + 整套积木 + 32 图标 + 雨幕）｜✅ 第 2 批「换外壳」（T-040 胶囊底栏 + 欢迎页 + 子页面滑入 + 界面 emoji 全量换 SVG，图标补到 48 个）｜✅ 第 3 批「对话页换皮」（T-041，`verify-chat-skin` 31 条）｜✅ 第 4 批「家页换皮」（T-042 Bento 6 格 + 全入口，`verify-home-skin` 14 条）｜✅ 第 5 批「生活 + 设置换皮」（T-043 两套并排 + 重分组，`verify-life-skin` 16 条）｜✅ 第 6 批「补未落成功能」（T-044 真播放 / 伴学 / 独处，`verify-batch6-skin` 29 条）—— **换装正式收官**（翻译层已随 T-045 删除）
  - ⚠️ 底栏标签第 2 批已由**英文改中文**（对话 / 家 / 大脑 / 生活 / 设置）—— **写新验收时别按英文串找 Tab**
  - ⚠️ **根路径会拐弯**：`/` 在「本次会话没进过」时先去 `/welcome`，进过才重定向 `/chat`（标记在 `sessionStorage`，PWA 每次冷启动都会看到）。
    所以**验收脚本一律直达目标路径**（`/chat`、`/home`、`/setting`），别导航到根路径等聊天列表 —— 会停在欢迎页等到超时。
    第 2 批就踩过：`verify-export` 当时能过纯属**依赖上游脚本留下的标记**（假绿），单跑即现原形
  - ⚠️ 换装是**纯前端**的事（只有第 6 批可能碰服务端）：数据 / 备份格式 / 接口都不受影响
  - 📌 视觉权威源 = `D:/我搓/designs/qixi-habitat/`（原型）。**别照抄它的叠放式换屏** —— 栖息地是真路由，用 `.slide-in` 只做动画、网址不变；且**只有 PUSH 播动画**（拦截后退容易卡在半路）
  - 📌 `theme/tokens.css` 翻译层**已删**（T-045）；`qixi/tokens.css` 现在是全前端唯一的设计变量定义处
  - 📌 界面图标**一律 SVG**；数据层只存图标**名**（`IconName`），渲染走 `<QixiIcon name="…" />` 查表。
    两个例外：输入框的**表情选择器**（用户内容）、代码注释里的 ⚠️

**UX 收口横切（依 `PRODUCT_SPEC` §7）**：**P0 ✅ 全部收口（14 项）** —— 消息对象操作 + 跨模块内容流转 + 会话置顶 / 聊天设置 + 会话分组（T-015~T-018）
**P1（6 项）**：输入区快捷栏 ✅ + 请求回复拆开 ✅（T-019）｜留言板 Widget ✅ + 倒数日 Widget ✅（T-020，**Dexie 升 v9 / 备份升 v7**）｜收藏分类 ✅ + 相册分类 ✅（T-021，**Dexie 升 v10 / 备份升 v8**）｜**P1 全部完成**｜P2 未开始

### 当前施工点

**Phase 6 已收口**；Nocturne 真机链路与生产鉴权也已在 T-034 结清。

- ✅ **打磨第一批「PWA + 离线只读 + 导入导出增强」（T-028~T-030）**：**零 schema 改动**（Dexie 仍 v10、备份格式仍 v8）
  - **PWA**：可装进主屏、断网能开壳。更新走 `prompt`（用户决定何时刷新，不做静默替换）；
    **离线外壳与 Web Push 共用一个 SW**（`web-push-sw.js` 用 `workbox.importScripts` 并入，不再各自 `register`）；
    `/api/` 排除在 `navigateFallback` 之外；dev 期不启 SW → **PWA 验收必须打生产构建**（`verify-pwa` 25/25）
  - **离线只读**：`assertOnline()` 收口在 `lib/api.ts`，离线时提前拦下并给人话（而不是 `TypeError: Failed to fetch`）；
    横幅说清「本地照常可看、要联网的动作暂不可用」；输入区 / 消息菜单 / 工具面板 / 设置页 / Life 运行视图逐处禁用或撤下联网动作，
    **草稿仍可写**；工具面板区分「离线」与「未配 MCP」（`verify-offline` 38/38，用 CDP 真断网）
  - **导入导出**：聊天设置里可导出**单会话**（Markdown 面向阅读 / JSON 与全量备份同构）；
    全量备份补「导入前覆盖警告 + 先导一份」与「久未导出提醒」；**单会话导出不计入「上次导出备份」**（`verify-export` 17/17）
  - ⏭ **刻意没做**：动画 / 过渡效果（北北要求留到与 UI 一起做）；离线发送队列（只做只读，不建排队语义）
  - 📌 验收排布：`run-front-verify.sh` 现在含 **9 支**（home / chat / providers / llm / **tokens** / **shell** / export / offline + 组二 diagnostics）；
    PWA 单独一条 `run-pwa-verify.sh`（打生产构建）。**别并发跑**，`verify-home` 的整页导航对机器负载敏感（详见 `docs/TASKS.md` 待优化）

- ✅ **验收基础设施收口（T-032）**：mock MCP 的 GET / DELETE 会话头已纳入 5 项生命周期探针，DELETE 会释放服务端会话映射；
  `verify-home` 自清浏览器站点数据并只把整页导航等待放宽到 60s，`verify-export` 自建「从未备份」前提，避免旧浏览器状态制造假红。
  当前整套前端回归：home 77 / **home-skin 14** / **life 16** / **life-skin 16** / **batch6-skin 29** / chat 148 / **chat-skin 31** / providers 24 / llm 16 / **tokens 23** / **shell 31** / **export 21** / **prod 10** / offline 38 / diagnostics 36（共 **531 项**），全部通过。
  `verify-tokens` 是换装第 1 批新增的地基哨兵（令牌 / 通用积木；翻译层删除后 T-045 反转职责为「钉住删净」）；`verify-shell` 是第 2 批新增的外壳哨兵（底栏 / 欢迎页 / 滑入 / **界面无 emoji**）；`verify-chat-skin` 是第 3 批新增的对话页哨兵（气泡方向底色 / 操作行常显 / 输入胶囊 / 能力入口）；`verify-home-skin` 是第 4 批新增的家页哨兵（Bento 真数据 / 诚实空态 / 全入口 / 模块子页顶栏）；`verify-life-skin` 是第 5 批新增的生活+设置哨兵（两套并排 / 诚实空态 / 设置重分组 / 主题分段真生效）；`verify-batch6-skin` 是第 6 批新增的真播放/伴学/独处哨兵（音频时长落盘 / 无链接明说拒绝 / 任务加勾删 / 程序化雨声落盘 / 沉浸无底栏），**必须排在 verify-life-skin 之后**（它写 listenSessions）；`verify-prod` 是部署前新增的生产构建+PWA 冒烟哨兵（SW 注册/断网外壳/`/api` 无 HTML 兜底），**自起 vite preview :4173**，且用 `PUT /json/new` 开专用 tab（流水线中段捡现成 tab 会撞怪目标）。注意 **/life 默认落在「生活痕迹」段**，要验记录页签先点「记录」。

**Phase 6.5 呈现层（T-038，已收口）**

- ✅ **LLM 档案页（`/llm`）＝ App Launcher**：按模块（记忆 / 状态 / 日记 / 留言板 / 工具）分组的能力卡片，
  内容**全部**来自 `GET /api/capabilities`（与 system context、tool schemas 同一份快照）——
  **前端不写死任何能力文案**；不可用的能力必须显示原因。
- ✅ **不做假入口**：日记 → Home 日记、留言板 → Home 留言板、状态 → Life 运行，三张卡可点；
  记忆与工具前端还没有页面，卡片标「暂无界面」并说明它发生在哪儿，**整张卡不可点**。
  ⚠️ **「有页面」与「现在可用」是两个独立事实** —— 日记页在 AI 写不了日记时照样存在；
  入口的有无取决于「界面在不在」，能力徽标才取决于「依赖就绪没有」（`PRODUCT_SPEC` §9.1.1）。
- ✅ **Chat 头像开关**：气泡两侧头像（小栖在左、用户在右），开关是**全局显示偏好**
  （`app/useChatDisplay.ts`，localStorage，与主题同款做法）—— **不落 Dexie、不进备份格式**；
  入口在聊天设置里但**不参与该面板的保存语义**（点了立刻生效），明说「影响所有会话」。
- **零 schema 改动**：Dexie 仍 v10、备份格式仍 v8；也没有动服务端能力面（P2 只动呈现层）。
- `PRODUCT_SPEC` §9.1 原为「待补」，本轮按铁律**先定产品行为再施工**，已补齐正文。
- 验收：`verify-llm` **16/16**（卡片与服务端快照逐条比对，**不写死能力名**）+ `verify-chat` 新增 8 条头像断言。

**Phase 5 高级能力（T-027，已收口）**

- ✅ **第一批「消息对象操作」**：编辑（保留原版本，与「换一个」共用一套版本导航）/ 撤回（留痕、不进模型上下文、可恢复）/ 删除 / 多选批量删 / 复制，统一进「长按 + 右键 + `⋯`」同一个菜单
- ✅ **第二批「跨模块内容流转」**：消息 → 收藏、消息 / 组件 → 作品、聊天图片 → 相册；三类条目保留来源与快照
- ✅ **第三批 A「会话置顶 + 聊天设置入口」**：列表置顶 / 取消置顶；窗口设置复用备注、背景、气泡模式
- ✅ **第三批 B「会话分组」**：创建 / 重命名 / 删除分组、会话移入移出、分区折叠（状态落库）、未分组兜底区；**Dexie 升到 v8**，备份格式升到 v6
  - 已定语义（`PRODUCT_SPEC` §2.1.2 / §2.1.3）：**置顶优先于分组**（置顶会话浮到最顶、脱离原分组，取消后回落）；**未分组区是兜底区**（也收 `groupId` 指向不存在分组的脏数据）
- ✅ **P1 第一批「输入区快捷操作栏 + 请求回复拆开」**（T-019）：输入框下方四项快捷栏（语音条录制 / 表情包 / 更多功能 / 请求回复）；主按钮默认仍是「发送并请求回复」，「只发送」在「更多功能」里；**零 schema 改动**（Dexie 保持 v8、备份保持 v6）
  - 已定语义（`PRODUCT_SPEC` §2.4.3 / §2.4.4）：**「待回复」由消息序列推导，不落字段**；**语音条走与文本完全相同的发送链路**；Phase 5 已把占位升级为真实 ASR 转写，失败才明确标记“未转写”
  - 顺带修掉一个真 bug：**用户侧气泡原先只渲染纯文本投影**，语音条 / 图片会被画成空气泡 → 改为两侧都走块分发（见 `docs/CHANGELOG.md`）
- ✅ **P1 第二批「主屏 Widget」（T-020）**：留言板与倒数日可「钉」到 Home 主屏（问候语之下、功能入口之上）；**只存引用不复制数据**；**Dexie 升到 v9**（新增 `homeWidgets` 表，`&kind` 唯一索引），备份格式升到 v7
  - 已定语义（`PRODUCT_SPEC` §1.4 / §3.2.2 / §3.3.2）：**每种 Widget 主屏至多一张**（换对象 = 改引用）；**被引用的实体消失时卡片一并消失**（删实体同事务清引用 + 渲染层对脏引用兜底）；位置先按上主屏的时间，**v0.1 不做拖拽调序**
  - v0.1 范围：留言板 Widget 只做「最近 3 条 + 查看全部」，「指定分组 / 指定留言」依赖留言条自身尚未实现的分组能力，已写进 SPEC 留后续
- ✅ **P1 第三批「收藏分类 + 相册分类」（T-021）**：收藏可自定义分类、相册可建分类相册，两处共用**同一套顶部筛选条**形态；**Dexie 升到 v10**（`bookmarkCategories` / `photoCollections` 两张表 + `bookmarks.categoryId` / `photos.collectionId` 两个归属字段，老数据在 `upgrade()` 里补 `null`），备份格式升到 v8
  - 已定语义（`PRODUCT_SPEC` §3.5.4 / §3.7.3）：**单归属**（一条内容最多属于一个分类，多维度标记留给后续的「标签」，不让分类兼任）；**删分类不删内容**（同事务把类内归属置 `null`）；**未分类是兜底区**（也收指向不存在分类的脏数据）；相册的**「移出相册」与「删除照片」是两个动作**，措辞不混用
  - 顺带把 `GroupNameSheet` 提升为通用 `components/NameSheet.tsx`（会话分组 / 收藏分类 / 相册三处共用，testid 统一为 `name-sheet-*`），并给收藏 / 相册条目补上「⋯」菜单（与会话行同一套做法）

**Phase 3A（只读打通、真机复跑与生产鉴权已完成 T-031 / T-033 / T-034）**

- ✅ **接口已按实例真实工具面收敛**（T-031，2026-09-24）：`MemoryProvider` 只剩只读两方法 ——
  `recall()` → `breath`（无参）、`search(query,{limit})` → `trace`；`/api/memory` 只剩 `GET boot` + `GET search`。
  原 4 个写端点与方法已删除（实例没有 uri / 编辑 / 删除语义，且从未被调用）。映射表与理由 → `docs/MEMORY.md`
- ✅ **工具面自检**：适配层 `verifyToolFace()` + 启动期 warn（不阻塞）。实例改名 / 换血统时会明确报出来，
  排查用三个零依赖侦察脚本（`probe-nocturne-tools.{ts,mjs,sh}`，只握手不调用工具）→ `docs/MEMORY.md`
- ⚠️ **`/mcp` 的 404 不是故障**：那是 2026-09-13 有意加的秘密路径加固（公开 `/mcp` 一律 404，
  真入口是 `/mcp-<32位密钥>`）；T-022 曾误判为反代缺陷。生产形态是同机内网直连 `http://127.0.0.1:8000/mcp`，**连密钥都不用填**
- ✅ **真机复跑完成**：`probe-nocturne-live.ts` **26/26**，Streamable HTTP session、9 工具、两条只读调用与无 Token 拒绝均通过；探针默认遮蔽秘密路径
- ✅ **生产鉴权完成**：实例原有 `OMBRE_API_PASSWORD` 已保护 Dashboard / `/api/*`；宿主 nginx 对轮换后的秘密 MCP 路径校验 Bearer，无 / 错 Token 401、正确 Token 200；完整凭据只存服务器 root-only 文件
- 完整拓扑 / 接入路径 → **`docs/DEPLOYMENT.md`**；结论摘要 → `docs/MEMORY.md`；任务记录 → `docs/TASKS.md` T-022 / T-031

**Phase 3B Eventide（T-023 起）**

- ✅ 切片一「状态内核底座」：Eventide 固定到 commit `5d8bef9`，以独立 FastAPI sidecar 运行；sidecar 无状态，
  Node 持有 `body_state_snapshot` 唯一快照并通过 `StateProvider` 推进
- ✅ 已有 `/api/health/state`、`GET /api/state`、`POST /api/state/tick`；真实全链探针 19/19
- ✅ 切片二「聊天上下文注入」：每轮聊天前 tick，状态卡插在 persona system 指令之后；不回传前端、不改写历史；
  未配置 / 空卡 / sidecar 不可达均降级继续聊天；自动 tick 已串行化且时间单调（T-024）
- ✅ 收尾「状态住进家」（T-025）：回复后异步互动结算；10 分钟节流的事件触发表；梦种 / 梦卡后效；
  SQLite 事务型 BudgetGuard；主动唤醒进入通知收件箱；独处记录保持 AI 私有；钱包余额 + 不可变流水；21/21 全链验收
- 默认安全态：主动总开关、唤醒、独处、梦境均默认关闭；普通聊天仍可用，所有 LLM 调用统一计账并受资源预算约束

**Phase 5 高级能力（T-027）**

- ✅ OpenAI-compatible ASR / TTS / 视觉 / 图片生成已接服务端，`modelMap` 四个媒体槽位可在方案设置中配置；密钥不出服务端
- ✅ 语音停止后先预览，可试听 / 重录 / 发送；真实转写落 `AudioBlock.transcript`、进入上下文并可复制，失败保留原音并明示
- ✅ 图片可从设备直接发送并保存视觉描述，也可生成；产物仍走现有 image block 与相册 / 作品对象操作
- ✅ HTML 使用无权限 iframe + CSP；widget / 单层 tab-group 已渲染；Dexie 仍是 v10、备份仍是 v8
- ✅ Mini Terminal 只允许用户显式选择并确认 MCP 工具调用；结果落 `tool-result`。AI 自主调用在逐次授权协议落地前关闭
- 边界：实时双工、主动拨号 / 软挂断、逐次授权的 AI 工具循环不在 v0.1，不能用轮询或默认放行伪装完成

### 当前产品状态

已完成一次本地验房，完成 `PRODUCT_SPEC` 的 **P0 全部收口**（消息对象操作 / 跨模块内容流转 / 会话置顶与聊天设置 / 会话分组），并**做完 P1 全部 6 项**（输入区快捷栏与请求回复拆开、主屏 Widget、收藏分类与相册分类）。

**产品行为的权威是 `docs/PRODUCT_SPEC.md`**（不再是「实现即定义」）；
现有实现与产品定义之间的差异清单与进度见 **`docs/TASKS.md` → 「PRODUCT_SPEC 差异」**。

界面已进入**换装期**：`docs/UI_DESIGN.md` 已补齐（权威源 = 原型 `D:/我搓/designs/qixi-habitat/`），
按 6 批推进 —— 铁律 6 的「补充前不堆视觉细节」前提已消失，**做哪页读哪个 `screens-*.jsx`，别通读原型**。

### 下一步

0. 🚀 **部署上 VPS**：代码与验收侧已就绪（T-046~T-049），照 `docs/DEPLOYMENT.md` §6 的步骤 + 7 条验收清单做实机操作（DNS 子域 / certbot / systemd / nginx / `.env`）。
1. **Phase 6.5 收口后的收尾项**（都在 `docs/TASKS.md`，没有新的功能批次）：
   - ⏳ `memory.write` 仍未实施：Nocturne 实例的写工具（`hold`）没接。真要写时先读 `docs/MEMORY.md` 的工具面
   - ⏳ 确认卡**没有过期 / 撤回**机制；其**前端交互**（点按钮 / 刷新后状态还在）仍无人眼之外的覆盖
   - ⏳ 工具卡片总排在助手气泡之后 —— 模型在工具调用后又说话时顺序会反
   - ⏳ 记忆与工具**仍没有界面**（档案页已如实标注「暂无界面」，不做假入口）
3. ⚠️ **不能直接把独处记录冒充成日记或留言** —— 那正是 SPEC §6.3 禁止的假数据。
   日记 / 留言现在有真实的写入路径（`createCompanionDiary` / `createCompanionMoment`），走它们即可
4. 📌 **新增界面时先问一句「这个入口点下去真的会到地方吗」** —— P2 定的规矩：
   有界面才可点，没界面就明说「暂无界面」，不做假入口（`PRODUCT_SPEC` §9.1.1）

动手前：先读 `PRODUCT_SPEC` 对应章节 + `TASKS.md` 待优化清单，
再核对 `DATA_MODEL.md`：**改数据结构要同时动三处**（`shared/types.ts` → Dexie 升版 → 备份格式升版）；
反过来，**能不加字段就先问一遍**（T-019 零 schema 改动就是先问了的结果）。

### 维护约定

- **每完成一次任务** → 先按顺序追加 `docs/TASKS.md` 一条记录（已完成 + 待优化），再进入下一进程
- **每完成一个 Phase** → 更新本文件 §6 + 追加 `docs/CHANGELOG.md`
- **每新增一个外部参考项目** → 补进 `docs/REFERENCES.md`
- **新增 / 修改接口** → 同步 `docs/API.md`
- **产品定义或架构有变更** → 先改 `docs/PRODUCT_SPEC.md` / 技术方案，再同步本文件

### 详细记录去哪看

- 施工记录与待优化 → `docs/TASKS.md`
- 版本历史 → `docs/CHANGELOG.md`
- 本地启动与验收命令 → `README.md`（含 Node 版本双轨约束、端口隔离等前置条件）
