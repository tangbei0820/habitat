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
| 当前阶段 | **Phase 3A 施工中**：记忆链路（`MemoryProvider` → `ToolGateway` → Nocturne MCP）本地全链探针 24/24，客户端代码已用 Nocturne **官方只读 Demo** 打真实 server 验真 25/25（T-013）；**自部署实例尚未接** |
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
| `docs/DATA_MODEL.md`      | 数据模型                                                                            | 建模时（占位中，以技术方案 §6 为准）                 |
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
- Phase 3A 长期记忆：🚧 一半（客户端链路已验，自部署实例未接）
- Phase 3B Eventide：未开始
- Phase 4 Life：未开始
- Phase 5 高级能力：未开始
- Phase 6 打磨：未开始

**UX 收口横切（依 `PRODUCT_SPEC` §7）**：P0 🚧 前两批完成（消息对象操作 + 跨模块内容流转）｜P1 未开始｜P2 未开始

### 当前施工点

**进行中：`PRODUCT_SPEC` 的 UX 收口（P0）** —— Phase 3A 停在一个干净检查点。

- ✅ **P0 第一批「消息对象操作」已完成**：编辑（保留原版本，与「换一个」共用一套版本导航）/ 撤回（留痕、不进模型上下文、可恢复）/ 删除（物理删 + 二次确认）/ 多选批量删 / 复制，统一进「长按 + 右键 + `···`」同一个菜单
- ✅ **P0 第二批「跨模块内容流转」已完成**：消息 → 收藏、消息 / 组件 → 作品、聊天图片 → 相册；三类条目均保留来源与快照，含重复 / 失败反馈
- 🚧 **P0 待续（本任务未施工）**：会话置顶 / 分组 / 聊天设置入口
  - ⚠️ **分组要动数据结构（Dexie v8）** —— 按 `docs/DATA_MODEL.md` §0 的顺序走

**Phase 3A（暂停中，未结清）**

- MemoryProvider → ToolGateway → Nocturne MCP 已落地；Nocturne 官方只读 Demo 已真实验通
- 自部署 Nocturne 实例仍需验证 Bearer Token / Namespace / Caddy / 内网回源

### 当前产品状态

已完成一次本地验房，并完成 `PRODUCT_SPEC` 的 **P0 前两批收口**（消息对象操作 + 跨模块内容流转）。

**产品行为的权威是 `docs/PRODUCT_SPEC.md`**（不再是「实现即定义」）；
现有实现与产品定义之间的差异清单与进度见 **`docs/TASKS.md` → 「PRODUCT_SPEC 差异」**。

界面仍属 MVP 级简单 UI —— `docs/UI_DESIGN.md` 被补充前不堆视觉细节（铁律 6）。

### 下一步

1. **P0 续**：会话置顶 / 分组 / 聊天设置入口（分组需 Dexie v8）
2. P0 走完再转 P1，之后回到 Phase 3B（自部署 Nocturne 的 Token / Namespace / Caddy / 回源验证）

动手前：先读 `PRODUCT_SPEC` 对应章节 + `TASKS.md` 待优化清单，再核对 `DATA_MODEL.md` 是否要升 Dexie 版本。

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
