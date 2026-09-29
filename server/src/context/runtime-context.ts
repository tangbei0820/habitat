/**
 * Runtime System Context —— 规则段 + 能力段
 *
 * 单独一个文件，是因为这两段与「环境相关段」（Eventide 状态、长期记忆）性质不同：
 * 前两段**永远在**，后两段**看情况**。混在一个函数里会让「什么该永远注入」变模糊。
 *
 * ⚠️ 能力清单**必须**由 Capability Registry 生成，不许在这里写死文案 ——
 * 一旦写死，就回到了本 Phase 要修的病根：模型被告知的能力与真实可调用的能力脱钩，
 * 于是出现「工具明明调成功了，下一轮它却说『我没有调用外部工具的能力』」。
 */
import type { CapabilityAutonomy, CapabilitySnapshot } from '@shared/capabilities.js'

/**
 * 静态运行规则段。不随环境变，故写成常量而非函数。
 *
 * 其中三条直接对应本次要修的现象：
 *   · 「以能力清单为准」—— 治「凭印象说自己不会」
 *   · 「已执行完的调用是既成事实」—— 治「工具成功了却否认」
 *   · 「直接发起调用，不要只用文字说我去查」—— 治「嘴上说调、实际没调」
 */
export const RUNTIME_RULES_TEXT = `# 运行环境

你生活在「栖息地」中：这是北北与你共同生活的数字空间。你有持续的身份、状态与记忆。

- 你会什么、不会什么，**以本段下方「当前可用能力」为准** —— 不要凭印象猜测，也不要沿用别处的自我描述。
- 系统**已经真实执行完**的工具调用是既成事实。不要否认它发生过，也不要声称自己没有调用外部工具的能力。
- 本段未列出的能力，此刻就是不可用的。不要假设自己拥有，也不要承诺去做。
- 需要用到某项能力时**直接发起调用**，不要只用文字说「我这就去查」而实际什么都没调。
- 长期记忆不是活动流水：只有你判断值得留下时才调用 \`memory_write\`，不值得记时就 no-op；不要为了“看起来有行动”而每轮写入。
- \`memory_write\` 会自动保留聊天 / 独处等来源并做重复检测；需要修正旧记忆时使用 \`mode=correction\`，不要声称已经原地编辑或删除 Nocturne 记忆。

## 公开思绪与正文

你可以选择在回复最前面公开一小段角色内心，格式严格为 \`[[思考：……]]\`，结束标记后再写正文；也可以本轮不公开，直接写正文。公开思绪是第一人称、正在发生的感受或注意，不是任务分析、策略备忘录、系统提示、工具参数或隐藏推理。不要把 \`[[思考：\` 或 \`]]\` 标记写进正文；系统会把它们分流成独立的「思绪」卡。供应商原生 reasoning 由系统另行接收，不能把它当成公开思绪。`

/** 自主级别 → 给模型看的一句话。`unavailable` 不会被渲染（不进清单）。 */
const AUTONOMY_LABEL: Record<Exclude<CapabilityAutonomy, 'unavailable'>, string> = {
  autonomous: '可直接调用',
  confirm: '需北北确认',
  'user-only': '仅北北可发起',
}

/**
 * 把能力快照渲染成给模型的清单。**只渲染 `enabled` 的** —— 这是「不伪造能力」的最后一米。
 *
 * 没有可用能力时返回非空文本（而不是空串），因为「什么都不说」会让模型
 * 退回到自己的先验去猜；明确说「现在没有」才是它需要的信息。
 */
export function renderCapabilityBlock(snapshot: readonly CapabilitySnapshot[]): string {
  const usable = snapshot.filter((item) => item.enabled)
  if (usable.length === 0) {
    return [
      '# 当前可用能力',
      '',
      '此刻你**没有任何可调用的能力**（依赖未就绪或尚未实施）。',
      '如果需要某项能力，直接告诉北北，不要假设自己能做。',
    ].join('\n')
  }

  const lines = usable.map((item) => {
    const tool = item.toolName === undefined ? '' : `\`${item.toolName}\` `
    const level = AUTONOMY_LABEL[item.autonomy as Exclude<CapabilityAutonomy, 'unavailable'>] ?? '不可用'
    return `- ${tool}${item.label} —— ${item.modelHint}〔${level}〕`
  })

  return [
    '# 当前可用能力',
    '',
    '以下是你此刻**真实可用**的能力（由系统按依赖就绪情况生成，不是固定清单）：',
    '',
    ...lines,
    '',
    '标〔可直接调用〕的，你可以在需要时自行调用，不必先问；',
    '标〔需北北确认〕的，系统会先请北北点确认，确认后才真正执行。',
    '本清单之外的任何能力，此刻都不可用。',
  ].join('\n')
}
