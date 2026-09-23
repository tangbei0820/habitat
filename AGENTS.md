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
> 最后更新：2026-09-23

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
| 部署   | 阿里云单机：Caddy 反代 + habitat-server + Nocturne + eventide-sidecar                                 |
| 当前阶段 | **UX 收口 P0 已收口**（14 项齐）｜**P1 全部 6 项落地**（T-019 输入区快捷栏 / T-020 主屏 Widget / T-021 收藏分类 + 相册分类；本地库升至 **Dexie v10**、备份格式 **v8**）｜Phase 3A 停在干净检查点：记忆链路本地探针 24/24 + 客户端代码用 Nocturne **官方只读 Demo** 验真 25/25，**自部署实例尚未接**（T-013） |
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
| `docs/API.md`             | 接口约定                                                                            | 加 / 改接口时同步（现：健康 2 + 聊天 1 + 方案 9 + 诊断 1 + 记忆 6） |
| `docs/DATA_MODEL.md`      | **落地口径**：归属 / 字段表 / 索引 / 迁移记录 + 改数据结构的标准顺序 | **改任何数据结构前必读**（§0 是顺序） |
| `docs/MCP.md`             | 工具层与 Gateway                                                                    | 动 MCP 时                              |
| `docs/MEMORY.md`          | 记忆系统接入                                                                          | Phase 3A 时                           |
| `docs/DEPLOYMENT.md`      | 部署                                                                              | 部署时（占位中）                             |
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
| UI 页面 / 布局 / Widget | `docs/PRODUCT_SPEC.md` 对应模块 + 技术方案 §8 + `docs/UI_DESIGN.md` + `docs/栖息地_UI参考资料_v1.0.md` | 有明确产品参考时再查对应项目；不要遍历整个参考库 |
| 长期记忆接入 | 技术方案 §7.1 / §9 风险1·5 + `docs/MEMORY.md` | Nocturne 为主；只有涉及实现取舍时再查 Paramecium / Ombre-Brain / kiwi-mem |
| 状态系统 / 情绪 | `docs/PRODUCT_SPEC.md` 后续对应章节 + 技术方案 §0.1-4 / §7.2③ | Eventide 为主；需要设计行为模式时再查 Drivesoid / Tidefall / jiwen |
| 主动唤醒 / 独处时光 | `docs/PRODUCT_SPEC.md` §9.5 + 技术方案 §7.2③ / §9 风险6 | 需要设计主动行为时实查 Headlong / AI Companion Runtime / WrenWen 等 |
| Life 统计 / 账本 / 通知 | `docs/PRODUCT_SPEC.md` §9.2（待补）+ 技术方案 §6.2 | Phosphene、WORKKK |
| 部署 / 反代 / SSE | 技术方案 §4 / §9 风险2·3 | 非产品交互任务，按需查：Ocean、AionsHome、Not Fade Away、cloud-and-island |
| 导入导出 / 数据主权 | 技术方案 §9 风险7 | 非产品交互任务，按需查：forge-reload、context-slim、chatgpt-exporter |
| 语音 / TTS（Phase 5） | `docs/PRODUCT_SPEC.md` §9.6（待补）+ 技术方案 §7.1 | voice-mcp、GPT-SoVITS、Callhome |
| 感知（Phase 5+） | — | Akari Pulse、gaze、cove-sensory-mcp |

---

## 5. 高风险清单（动手前必看）

| #  | 风险                       | 对策在哪                                           |
| -- | ------------------------ | ---------------------------------------------- |
| 1  | **MCP 握手 / 请求捕捉失败**（有前科） | 技术方案 §7.2②、§9-1。先用 Nocturne 公共 demo 验证客户端代码    |
| 2  | **SSE 过反代被缓冲** → 假死      | §9-2。Caddy 默认友好；nginx 必须 `proxy_buffering off` |
| 3  | 未备案限制公网形态                | §9-3。相对路径 + 环境变量 base URL，零改动切换                |
| 4  | Eventide 是库不是服务 + 非商业许可  | §9-4。sidecar 隔离；不随产物分发                         |
| 5  | Nocturne 升级 / 迁移         | §9-5。锁 commit；升级前备份 DB；不依赖其内部 schema           |
| 6  | **唤醒 / 独处费用失控**          | §9-6。BudgetGuard 硬闸门，所有出口统一过闸                  |
| 7  | 本地数据损坏 / 丢失              | §9-7。Dexie 版本化迁移 + 水合失败拦截                      |
| 8  | 长聊天性能                    | §9-8。虚拟滚动，Phase 1 就引入                          |
| 9  | iOS PWA 推送受限             | §9-9。通知中心为底座                                   |
| 10 | 范围蔓延                     | §9-10。严格按 Phase 交付                             |

---

## 6. 当前进度

### 当前状态

- Phase 0：✅ 完成
- Phase 1 Chat MVP：✅ 完成
- Phase 2 Home 基础数据链：✅ 完成
- Phase 3A 长期记忆：🚧 一半（客户端链路已验，自部署实例未接）｜**暂停中**，不阻塞 UX 收口
- Phase 3B Eventide：未开始
- Phase 4 Life：未开始
- Phase 5 高级能力：未开始
- Phase 6 打磨：未开始

**UX 收口横切（依 `PRODUCT_SPEC` §7）**：**P0 ✅ 全部收口（14 项）** —— 消息对象操作 + 跨模块内容流转 + 会话置顶 / 聊天设置 + 会话分组（T-015~T-018）
**P1（6 项）**：输入区快捷栏 ✅ + 请求回复拆开 ✅（T-019）｜留言板 Widget ✅ + 倒数日 Widget ✅（T-020，**Dexie 升 v9 / 备份升 v7**）｜收藏分类 ✅ + 相册分类 ✅（T-021，**Dexie 升 v10 / 备份升 v8**）｜**P1 全部完成**｜P2 未开始

### 当前施工点

**P1 全部落地，停下等确认**（停留在「下一步」之前）。

- ✅ **第一批「消息对象操作」**：编辑（保留原版本，与「换一个」共用一套版本导航）/ 撤回（留痕、不进模型上下文、可恢复）/ 删除 / 多选批量删 / 复制，统一进「长按 + 右键 + `⋯`」同一个菜单
- ✅ **第二批「跨模块内容流转」**：消息 → 收藏、消息 / 组件 → 作品、聊天图片 → 相册；三类条目保留来源与快照
- ✅ **第三批 A「会话置顶 + 聊天设置入口」**：列表置顶 / 取消置顶；窗口设置复用备注、背景、气泡模式
- ✅ **第三批 B「会话分组」**：创建 / 重命名 / 删除分组、会话移入移出、分区折叠（状态落库）、未分组兜底区；**Dexie 升到 v8**，备份格式升到 v6
  - 已定语义（`PRODUCT_SPEC` §2.1.2 / §2.1.3）：**置顶优先于分组**（置顶会话浮到最顶、脱离原分组，取消后回落）；**未分组区是兜底区**（也收 `groupId` 指向不存在分组的脏数据）
- ✅ **P1 第一批「输入区快捷操作栏 + 请求回复拆开」**（T-019）：输入框下方四项快捷栏（语音条录制 / 表情包 / 更多功能 / 请求回复）；主按钮默认仍是「发送并请求回复」，「只发送」在「更多功能」里；**零 schema 改动**（Dexie 保持 v8、备份保持 v6）
  - 已定语义（`PRODUCT_SPEC` §2.4.3 / §2.4.4）：**「待回复」由消息序列推导，不落字段**；**语音条走与文本完全相同的发送链路**，模型收到 `[语音条 0:03]` 占位（转写属 ASR，缺口已写在 SPEC 里）
  - 顺带修掉一个真 bug：**用户侧气泡原先只渲染纯文本投影**，语音条 / 图片会被画成空气泡 → 改为两侧都走块分发（见 `docs/CHANGELOG.md`）
- ✅ **P1 第二批「主屏 Widget」（T-020）**：留言板与倒数日可「钉」到 Home 主屏（问候语之下、功能入口之上）；**只存引用不复制数据**；**Dexie 升到 v9**（新增 `homeWidgets` 表，`&kind` 唯一索引），备份格式升到 v7
  - 已定语义（`PRODUCT_SPEC` §1.4 / §3.2.2 / §3.3.2）：**每种 Widget 主屏至多一张**（换对象 = 改引用）；**被引用的实体消失时卡片一并消失**（删实体同事务清引用 + 渲染层对脏引用兜底）；位置先按上主屏的时间，**v0.1 不做拖拽调序**
  - v0.1 范围：留言板 Widget 只做「最近 3 条 + 查看全部」，「指定分组 / 指定留言」依赖留言条自身尚未实现的分组能力，已写进 SPEC 留后续
- ✅ **P1 第三批「收藏分类 + 相册分类」（T-021）**：收藏可自定义分类、相册可建分类相册，两处共用**同一套顶部筛选条**形态；**Dexie 升到 v10**（`bookmarkCategories` / `photoCollections` 两张表 + `bookmarks.categoryId` / `photos.collectionId` 两个归属字段，老数据在 `upgrade()` 里补 `null`），备份格式升到 v8
  - 已定语义（`PRODUCT_SPEC` §3.5.4 / §3.7.3）：**单归属**（一条内容最多属于一个分类，多维度标记留给后续的「标签」，不让分类兼任）；**删分类不删内容**（同事务把类内归属置 `null`）；**未分类是兜底区**（也收指向不存在分类的脏数据）；相册的**「移出相册」与「删除照片」是两个动作**，措辞不混用
  - 顺带把 `GroupNameSheet` 提升为通用 `components/NameSheet.tsx`（会话分组 / 收藏分类 / 相册三处共用，testid 统一为 `name-sheet-*`），并给收藏 / 相册条目补上「⋯」菜单（与会话行同一套做法）

**Phase 3A（暂停中，未结清）**

- MemoryProvider → ToolGateway → Nocturne MCP 已落地；Nocturne 官方只读 Demo 已真实验通
- 自部署 Nocturne 实例仍需验证 Bearer Token / Namespace / Caddy / 内网回源

### 当前产品状态

已完成一次本地验房，完成 `PRODUCT_SPEC` 的 **P0 全部收口**（消息对象操作 / 跨模块内容流转 / 会话置顶与聊天设置 / 会话分组），并**做完 P1 全部 6 项**（输入区快捷栏与请求回复拆开、主屏 Widget、收藏分类与相册分类）。

**产品行为的权威是 `docs/PRODUCT_SPEC.md`**（不再是「实现即定义」）；
现有实现与产品定义之间的差异清单与进度见 **`docs/TASKS.md` → 「PRODUCT_SPEC 差异」**。

界面仍属 MVP 级简单 UI —— `docs/UI_DESIGN.md` 被补充前不堆视觉细节（铁律 6）。

### 下一步

1. **P2**（依赖主动行为 / Eventide 链路）：AI 自主写日记 / 留言｜「一起听」完整能力｜AI 伴学｜**主屏幕 Widget 编排**（Home 从入口列表变成可编排首页，`SPEC` §5.1 / §5.3）—— 后者是 P1 那两张卡片的自然延续
2. 已记为后续、尚未开工的尾巴：分组与分类的排序（拖拽调序）｜移动端长按会话行进菜单｜语音条转写（ASR）｜留言板 Widget 的「指定分组 / 指定留言」｜三个模块的分类实体是否合并（**要并就三个一起并**）—— 见 `TASKS.md` 待优化清单
3. 之后回 **Phase 3B**（自部署 Nocturne 的 Token / Namespace / Caddy / 回源验证）

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
