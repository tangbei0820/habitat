/**
 * Capability Registry —— 能力定义（Phase 6.5 · AI Runtime Integration）
 *
 * 解决的问题：在引入本层之前，AI 对自己「有什么能力」是靠**硬编码文案**猜的 ——
 * 服务端从不给模型传工具、也从不声明能力，于是出现这种自相矛盾：
 * 「工具明明执行成功（Mini Terminal 手动发起），下一轮模型却说『我没有调用外部工具的能力』」。
 * 模型没有说谎 —— 是它的上下文里**确实没有**这条信息。
 *
 * 本文件是能力的**单一定义源**，三方共用：
 *   1. Runtime System Context —— 生成给模型的「当前可用能力」清单
 *   2. Tool schemas —— 由 `tool` 字段生成传给 LLM 的 function definitions
 *   3. LLM 页面能力卡片 —— 前端 `GET /api/capabilities` 拿到的就是同一份快照
 *
 * 分工（别把两者混起来）：
 *   · 本文件 = **声明**：有哪些能力、自主级别、绑什么工具。静态，不随运行环境变。
 *   · `server/src/capabilities/registry.ts` = **状态**：当前依赖是否就绪、能不能真用。
 *   声明里写着 `memory.read`，**不代表**这个实例真的能读（Nocturne 可能没配）——
 *   能不能用一律以运行时快照的 `enabled` 为准。这是「**不伪造能力**」原则的落点。
 *
 * ⚠️ 与 `docs/PRODUCT_SPEC.md` §9.7 的关系：该节原本写「AI 自主工具调用暂不启用」，
 * 并要求先有「可暂停的逐次授权 + 风险分级」。本层正是把那两样建出来，
 * 而不是绕过它 —— 所以 `autonomy` 字段不是装饰，是准入闸门（见下）。
 */

/** 能力归属模块 —— 用于 LLM 页面卡片分组与详情页归属 */
export type CapabilityModule = 'memory' | 'state' | 'diary' | 'board' | 'tools'

/**
 * 自主级别：回答「这项能力 AI 自己能不能调」。
 *
 * 引入它是因为「能调」不是二值的 —— 读记忆和写留言板的风险完全不同，
 * 用同一个开关管会把安全的那半也一起锁死。
 */
export type CapabilityAutonomy =
  /** AI 可自主调用，无需用户在旁 —— 只读、无副作用、不产生用户可见内容 */
  | 'autonomous'
  /** AI 可调用，但须先过用户确认（确认卡），点了才真执行 */
  | 'confirm'
  /** 仅用户可发起；AI 不得调用（如用户自己发消息） */
  | 'user-only'
  /** 已登记但依赖未就绪，当前不提供给 AI；`enabled` 必然为 false */
  | 'unavailable'

export type CapabilityId =
  /* —— 记忆（Nocturne）—— */
  | 'memory.read'
  | 'memory.search'
  | 'memory.write'
  /* —— 状态（Eventide）—— */
  | 'state.read'
  /* —— AI 私有日记 —— */
  | 'diary.create'
  | 'diary.update'
  | 'diary.list_own'
  | 'diary.read_own'
  | 'diary.allow_access'
  | 'diary.deny_access'
  | 'diary.set_fragment_visibility'
  /* —— 共享留言板 —— */
  | 'messageboard.write'
  | 'messageboard.update'
  /* —— 自我认知 —— */
  | 'tools.list'

/** 工具参数的 JSON Schema 子集 —— 够 openai-compat 的 function calling 用即可 */
export interface CapabilityToolSchema {
  type: 'object'
  properties: Record<string, { type: 'string' | 'number' | 'boolean'; description: string; enum?: readonly string[] }>
  required?: readonly string[]
  /** 一律 false：让模型只能传我们声明过的参数，避免幻觉字段悄悄流到执行层 */
  additionalProperties: false
}

/**
 * 绑定的工具。
 *
 * ⚠️ `name` 是**内建工具名**，不是 MCP 实例的工具名 —— 这层抽象是刻意的：
 * AI 说「读记忆」时不该知道后端用的是 `breath` 还是别的。具体映射留在
 * `server/src/providers/` 的适配层里，实例换工具面时 AI 那边零感知。
 */
export interface CapabilityToolBinding {
  name: string
  /** 面向模型的工具说明（会进 function definition） */
  description: string
  parameters: CapabilityToolSchema
}

export interface CapabilityDefinition {
  id: CapabilityId
  module: CapabilityModule
  /** 面向用户的短名（LLM 页面卡片标题） */
  label: string
  /** 面向用户的一句话说明 */
  summary: string
  /** 面向模型的说明：进 Runtime Context 的能力清单，措辞要能直接读 */
  modelHint: string
  /** 声明的自主级别；运行时可能因依赖缺失而实际不可用（此时 `enabled=false`） */
  autonomy: CapabilityAutonomy
  /** 绑定的工具；缺省 = 该项当前不经 tool call 暴露给 AI */
  tool?: CapabilityToolBinding
}

/* ------------------------------------------------------------------ 定义表 */

/**
 * 静态能力表。**只声明，不判断可用性。**
 *
 * 当前阶段的边界（2026-09-26 定，Phase 7B「自主生活决策链」起）：
 *   · 只读能力（记忆读 / 记忆搜 / 状态读 / 列日记 / 读自己日记 / 允许·拒绝对话）→ `autonomous`
 *   · 写类能力（写日记 / 改日记 / 写留言板 / 改留言板）→ **7B 起改为 `autonomous`**：
 *     它们写的都是「小栖自己的东西」（私有日记 / 自己署名的留言），不是用户的文件；
 *     主动行为链路（BudgetGuard + 决策契约 + 行动审计）就是它们的闸门。
 *     ⚠️ 历史：P1 时它们曾是 `confirm`（确认卡），7B 起自主化；确认协议本身保留，
 *     给未来真正需要人把关的写能力用（如 `memory.write`）。
 *   · 写记忆 → `confirm`（2026-09-26 记忆沉淀批起**已实施**，绑 `memory_write`）：
 *     长期记忆是两人共享的资产，小栖在对话里主动要写时，仍需北北点头 ——
 *     这是确认协议的现役使用者。后台的自主沉淀（Surf 记录升格）不走确认卡，
 *     它受自动化策略、预算与行动审计约束（SPEC §9.5.3）。
 *
 * ⚠️ `confirm` 级能力**也要绑工具**（P0 时它们一律不绑，因为那时确认协议还没落地）。
 * 不绑的后果是模型永远学不会「我可以请求写日记」—— 它会以为这件事根本做不到。
 * 绑了之后，闸门在执行层：见 `server/src/services/event-inbox.ts` 的挂起逻辑。
 */
export const CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = [
  {
    id: 'memory.read',
    module: 'memory',
    label: '读取记忆',
    summary: '把小栖的长期记忆整体取回来',
    modelHint: '读取长期记忆全文。不确定自己记得什么、或需要回顾与北北的过往时调用。',
    autonomy: 'autonomous',
    tool: {
      name: 'memory_read',
      description: '读取小栖的长期记忆全文。用于回顾与北北的过往、或在记忆不确定时重新取回。无参数。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    id: 'memory.search',
    module: 'memory',
    label: '搜索记忆',
    summary: '按关键词在长期记忆里检索',
    modelHint: '按关键词在长期记忆中检索。需要想起某个具体的人、事或片段时调用，比整篇读取更省。',
    autonomy: 'autonomous',
    tool: {
      name: 'memory_search',
      description: '按关键词在小栖的长期记忆中检索相关片段。需要想起某个具体的人、事或片段时用它。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索用的关键词，尽量具体' },
          limit: { type: 'number', description: '最多返回几条，省略则由记忆系统决定' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    id: 'memory.write',
    module: 'memory',
    label: '写入记忆',
    summary: '把一段新记忆存进长期记忆',
    modelHint: '把值得长期记住的事写进记忆。写入前会先请北北确认。',
    autonomy: 'confirm',
    tool: {
      name: 'memory_write',
      description:
        '把一段值得长期记住的事写进小栖的长期记忆（影响之后所有的对话）。写入前需要北北确认，确认后才会真正生效。适合记下重要的约定、偏好或一起经历的事。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '记忆正文：想长期记住的事，写清楚、能独立读懂，不超过 4000 字' },
          name: { type: 'string', description: '可选的短标题，不超过 120 字；不填就不起名' },
          kind: {
            type: 'string',
            enum: ['memory', 'feel', 'writing', 'unresolved'],
            description: '记忆种类：memory=发生过的事，feel=感受与印象，writing=想留下的句子，unresolved=还没了结的事；省略视为 memory',
          },
          tags: { type: 'string', description: '可选标签，多个用逗号分隔，不超过 200 字' },
        },
        required: ['content'],
        additionalProperties: false,
      },
    },
  },
  {
    id: 'state.read',
    module: 'state',
    label: '读取状态',
    summary: '读取小栖当前的身体状态',
    modelHint: '读取自己当前的状态（精力、情绪等）。每轮对话已会自动附带状态摘要，只有需要更完整信息时才单独调用。',
    autonomy: 'autonomous',
    tool: {
      name: 'state_read',
      description: '读取小栖当前的身体状态快照（结构化数值 + 可读摘要）。每轮对话已自动附带状态摘要，仅在需要完整数据时调用。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    id: 'diary.create',
    module: 'diary',
    label: '写日记',
    summary: '写一篇只有小栖自己能看的日记',
    modelHint: '写一篇自己的日记。日记默认私有，北北只能看到封面与基本信息，需要你允许才能读正文。',
    autonomy: 'autonomous',
    tool: {
      name: 'diary_create',
      description:
        '写一篇你自己的日记（默认私有，北北看不到正文）。写完立即生效。适合记下只有自己知道的心情与见闻。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '日记标题，不超过 120 字' },
          content: { type: 'string', description: '日记正文，不超过 10000 字' },
          entryDate: {
            type: 'string',
            description: '这篇日记算哪一天，格式 YYYY-MM-DD；省略表示今天',
          },
        },
        required: ['title', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    id: 'diary.update',
    module: 'diary',
    label: '修改日记',
    summary: '修改自己写过的日记',
    modelHint: '修改自己写过的日记正文。只有你能编辑日记。',
    autonomy: 'autonomous',
    tool: {
      name: 'diary_update',
      description:
        '修改你自己写过的一篇日记。只传要改的字段，没传的沿用原文。修改立即生效。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要修改的日记 id（先用 diary_list_own 查）' },
          title: { type: 'string', description: '新的标题；不传则不改标题' },
          content: { type: 'string', description: '新的正文；不传则不改正文' },
          entryDate: { type: 'string', description: '新的日期 YYYY-MM-DD；不传则不改日期' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    id: 'diary.list_own',
    module: 'diary',
    label: '列出日记',
    summary: '列出自己写过的日记',
    modelHint: '列出自己写过的日记（标题与时间）。需要回想写过什么时调用。',
    autonomy: 'autonomous',
    tool: {
      name: 'diary_list_own',
      description: '列出你自己写过的日记（标题、日期、是否已对北北开放）。需要回想写过什么、或要拿到某篇的 id 时用它。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '最多返回几篇，省略为 20' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    id: 'diary.read_own',
    module: 'diary',
    label: '读自己的日记',
    summary: '读取自己某篇日记的正文',
    modelHint: '读取自己某篇日记的正文。只有你自己的日记能这样读。',
    autonomy: 'autonomous',
    tool: {
      name: 'diary_read_own',
      description: '读取你自己某一篇日记的全文。只有你自己写的日记能这样读。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '日记 id（先用 diary_list_own 查）' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    id: 'diary.allow_access',
    module: 'diary',
    label: '允许查看',
    summary: '同意北北查看某篇日记',
    modelHint: '当北北请求查看某篇日记时，同意这次请求。',
    autonomy: 'autonomous',
    tool: {
      name: 'diary_allow_access',
      description:
        '同意北北查看你某篇日记的正文（该篇会转为对北北开放）。当待处理列表里有「北北想看看你写的……」时调用它。',
      parameters: {
        type: 'object',
        properties: {
          eventId: { type: 'string', description: '待处理请求的事件 id（见「等待你决定」列表）' },
        },
        required: ['eventId'],
        additionalProperties: false,
      },
    },
  },
  {
    id: 'diary.deny_access',
    module: 'diary',
    label: '拒绝查看',
    summary: '拒绝北北查看某篇日记',
    modelHint: '当北北请求查看某篇日记时，拒绝这次请求。拒绝不需要理由，但可以说明。',
    autonomy: 'autonomous',
    tool: {
      name: 'diary_deny_access',
      description:
        '拒绝北北查看某篇日记。日记保持私密。拒绝不需要理由，你可以照常对北北说话解释你的想法。',
      parameters: {
        type: 'object',
        properties: {
          eventId: { type: 'string', description: '待处理请求的事件 id（见「等待你决定」列表）' },
        },
        required: ['eventId'],
        additionalProperties: false,
      },
    },
  },
  {
    id: 'diary.set_fragment_visibility',
    module: 'diary',
    label: '管理日记片段',
    summary: '开放或锁回自己日记的一段',
    modelHint: '按自己的意愿开放或锁回某篇日记的某一段。整篇默认私密，片段开放不会自动公开其它段落。',
    autonomy: 'autonomous',
    tool: {
      name: 'diary_set_fragment_visibility',
      description: '开放或锁回你自己日记中的某一段。先用 diary_read_own 读取 fragment id；visibility=open 表示让北北看到，locked 表示重新锁住。只改变这一段，不会自动改变其它段落。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '日记 id' },
          fragmentId: { type: 'string', description: '片段 id，例如 fragment-0' },
          visibility: { type: 'string', enum: ['open', 'locked'], description: 'open=开放给北北，locked=锁回私密' },
        },
        required: ['id', 'fragmentId', 'visibility'],
        additionalProperties: false,
      },
    },
  },
  {
    id: 'messageboard.write',
    module: 'board',
    label: '写留言',
    summary: '在留言板上留一条话',
    modelHint: '在留言板上写一条留言。留言板是你和北北共用的，落笔前想想这条话值不值得占一个位置。',
    autonomy: 'autonomous',
    tool: {
      name: 'messageboard_write',
      description:
        '在留言板上留一条话（你和北北共用）。写完立即出现在留言板上，不会推送打扰他。适合留短句，不超过 500 字。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '留言内容，不超过 500 字' },
        },
        required: ['content'],
        additionalProperties: false,
      },
    },
  },
  {
    id: 'messageboard.update',
    module: 'board',
    label: '修改留言',
    summary: '修改自己已经写下的留言',
    modelHint: '如果你想修正或补充自己在留言板留下的话，可以修改自己的留言；不能改北北写的内容。',
    autonomy: 'autonomous',
    tool: {
      name: 'messageboard_update',
      description: '修改你自己写过的一条留言。先从留言板找到 id；不能修改北北的留言。只传需要修改的最终 content，不超过 500 字。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要修改的留言 id' },
          content: { type: 'string', description: '修改后的留言内容，不超过 500 字' },
        },
        required: ['id', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    id: 'tools.list',
    module: 'tools',
    label: '查看工具',
    summary: '列出当前真实可用的工具',
    modelHint: '列出你当前真实可用的全部能力与工具。对自己能做什么不确定时调用，而不是猜测。',
    autonomy: 'autonomous',
    tool: {
      name: 'tools_list',
      description: '列出你当前真实可用的全部能力与工具（含每项的自主级别）。对自己能做什么不确定时调用它，不要凭印象回答。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
]

/** 按 id 取定义；找不到返回 null（不抛 —— 上游可能是旧版本前端传来的 id）。 */
export function findCapability(id: string): CapabilityDefinition | null {
  return CAPABILITY_DEFINITIONS.find((item) => item.id === id) ?? null
}

/* ------------------------------------------------------------------ 运行时快照 */

/**
 * 运行时能力快照 —— **唯一可对外断言「AI 现在能不能做这件事」的形状**。
 * system context / tool schemas / LLM 页面卡片都消费它。
 */
export interface CapabilitySnapshot {
  id: CapabilityId
  module: CapabilityModule
  label: string
  summary: string
  modelHint: string
  /** 当前是否真的可用（依赖就绪）。false 时 `reason` 必填 */
  enabled: boolean
  /** 实际自主级别；依赖缺失时会被降级为 `unavailable` */
  autonomy: CapabilityAutonomy
  /** 不可用原因（面向人读，例如「Nocturne 未配置」） */
  reason?: string
  /** 提供给模型的工具名（仅当 `enabled` 且绑定了工具时存在） */
  toolName?: string
}
