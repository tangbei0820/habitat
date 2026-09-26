/**
 * Prompt 端点（Phase 7A · SPEC §9.4.1 / §9.4.3）。
 *
 * 「查看」返回的是**当前会真实注入**的各 system 块：内置块给全文或明确的动态说明，
 * 绝不编造一段假装是本轮内容的文字 —— 透明性的前提是内容真实。
 */
import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors.js'
import type { PromptView, PromptViewBlock } from '@shared/types.js'
import type { CapabilityService } from '../capabilities/registry.js'
import { getPersonaPrompt, personaCustomized, setPersonaPrompt } from '../db/prompt.js'
import { listEnabledWorldbookEntries } from '../db/worldbook.js'
import { RequestError } from '../lib/errors.js'
import { RUNTIME_RULES_TEXT, renderCapabilityBlock } from '../context/runtime-context.js'

const PERSONA_MAX = 8_000

export function registerPromptRoutes(app: FastifyInstance, capabilities: CapabilityService): void {
  app.get('/api/prompt/view', async (): Promise<PromptView> => {
    const persona = getPersonaPrompt()
    const snapshot = await capabilities.snapshot(new Date())

    const blocks: PromptViewBlock[] = []
    if (persona !== '') {
      blocks.push({ name: 'persona', label: '角色设定（你写的）', source: 'custom', content: persona })
    }
    const worldbook = listEnabledWorldbookEntries()
    if (worldbook.length > 0) {
      const always = worldbook.filter((entry) => entry.mode === 'always')
      const keyword = worldbook.length - always.length
      const detail = worldbook
        .map((entry) => `【${entry.title}】（${entry.mode === 'always' ? '恒定注入' : `关键词：${entry.keys.join('、')}`}）\n${entry.content}`)
        .join('\n\n')
      blocks.push({
        name: 'worldbook',
        label: `世界书（${always.length} 条恒定注入，${keyword} 条按最近对话关键词命中注入）`,
        source: 'custom',
        content: detail,
      })
    }
    blocks.push(
      { name: 'runtime_rules', label: '运行规则（内置）', source: 'builtin', content: RUNTIME_RULES_TEXT },
      { name: 'runtime_capabilities', label: '能力清单（内置 · 随依赖就绪情况生成）', source: 'builtin', content: renderCapabilityBlock(snapshot) },
      { name: 'nocturne_memory', label: '长期记忆（内置 · 每轮动态）', source: 'builtin', content: '仅新会话开头注入一次，内容为记忆实例返回的记忆全文；本块内容按轮次动态生成，这里不预览正文。' },
      { name: 'runtime_events', label: '待决事件（内置 · 每轮动态）', source: 'builtin', content: '有待 AI 决策的请求或上次请求的结果时注入；本块内容按轮次动态生成，这里不预览正文。' },
      { name: 'eventide_state', label: '状态卡（内置 · 每轮动态）', source: 'builtin', content: '每轮注入 Eventide 当前状态卡；本块内容按轮次动态生成，这里不预览正文。' },
    )
    return { persona: { content: persona, customized: personaCustomized() }, blocks }
  })

  /** 保存人格 Prompt；空串 = 清空（恢复默认）。 */
  app.put<{ Body: unknown }>('/api/prompt/persona', async (request) => {
    const body = typeof request.body === 'object' && request.body !== null ? (request.body as Record<string, unknown>) : {}
    if (typeof body.content !== 'string') {
      throw new RequestError(ErrorCodes.BadRequest, 'content 必须是字符串')
    }
    if (body.content.length > PERSONA_MAX) {
      throw new RequestError(ErrorCodes.BadRequest, `content 最长 ${PERSONA_MAX} 字`)
    }
    setPersonaPrompt(body.content)
    const saved = getPersonaPrompt()
    return { content: saved, customized: saved !== '' }
  })

  /** 恢复默认 = 清空（SPEC §9.4.1：没有出厂人格）。 */
  app.delete('/api/prompt/persona', async () => {
    setPersonaPrompt('')
    return { content: '', customized: false }
  })
}
