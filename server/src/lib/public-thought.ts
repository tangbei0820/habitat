/**
 * 把模型正文里的可选 `[[思考：...]]` 段分流成公开思绪与正文。
 *
 * 这是协议适配层，不是把供应商 reasoning 当成伴侣心声：模型原生 reasoning
 * 仍走 LlmStreamDelta.reasoning，只有明确使用角色标记的内容才会进入 thought 事件。
 * 标记可能跨上游 chunk，故必须保留未决前缀，不能按单个 chunk 正则替换。
 */
const OPEN = '[[思考：'
const CLOSE = ']]'

export interface PublicThoughtParts {
  content: string
  thought: string
}

export class PublicThoughtParser {
  private pending = ''
  private thought = ''
  private inThought = false

  feed(chunk: string): PublicThoughtParts {
    this.pending += chunk
    return this.drain(false)
  }

  finish(): PublicThoughtParts {
    const result = this.drain(true)
    this.pending = ''
    this.thought = ''
    this.inThought = false
    return result
  }

  private drain(final: boolean): PublicThoughtParts {
    let content = ''
    let thought = ''
    for (;;) {
      if (!this.inThought) {
        const start = this.pending.indexOf(OPEN)
        if (start >= 0) {
          content += this.pending.slice(0, start)
          this.pending = this.pending.slice(start + OPEN.length)
          this.inThought = true
          continue
        }
        if (final) {
          // 结尾停在半个起始标记时，舍弃这个内部协议前缀，保留其余正文。
          let partial = 0
          for (let length = Math.min(OPEN.length - 1, this.pending.length); length > 0; length -= 1) {
            if (OPEN.startsWith(this.pending.slice(-length))) {
              partial = length
              break
            }
          }
          content += this.pending.slice(0, this.pending.length - partial)
          this.pending = ''
          break
        }
        const keep = final ? 0 : Math.max(0, OPEN.length - 1)
        const safeLength = Math.max(0, this.pending.length - keep)
        content += this.pending.slice(0, safeLength)
        this.pending = this.pending.slice(safeLength)
        break
      }

      const end = this.pending.indexOf(CLOSE)
      if (end >= 0) {
        thought += this.thought + this.pending.slice(0, end)
        this.thought = ''
        this.pending = this.pending.slice(end + CLOSE.length)
        this.inThought = false
        continue
      }
      if (final) {
        // 标记不完整时不能吞掉回复，也不能把内部起始标记原样漏给用户。
        content += this.thought + this.pending
        this.thought = ''
        this.pending = ''
        this.inThought = false
        break
      }
      const safeLength = Math.max(0, this.pending.length - (CLOSE.length - 1))
      this.thought += this.pending.slice(0, safeLength)
      this.pending = this.pending.slice(safeLength)
      break
    }
    return { content, thought }
  }
}
