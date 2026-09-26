/**
 * 人格 Prompt（Phase 7A · SPEC §9.4.1）。
 *
 * 单值数据，走 app_kv 而不是单行表：没有字段会演化，没有第二条记录。
 * 空串 = 未自定义 = 不注入（恢复默认就是清空，栖息地没有出厂人格）。
 */
import { getKv, setKv } from './kv.js'

const PERSONA_KEY = 'persona_prompt'

export function getPersonaPrompt(): string {
  return getKv(PERSONA_KEY) ?? ''
}

export function setPersonaPrompt(content: string): void {
  setKv(PERSONA_KEY, content.trim())
}

export function personaCustomized(): boolean {
  return getPersonaPrompt() !== ''
}
