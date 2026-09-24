/**
 * 工具调用增量累加器
 *
 * 上游（OpenAI 兼容协议）把一次工具调用**拆成一串分片**下发：先给 `id` 与 `name`，
 * 然后参数按 `index` 一路追加。所以「收到一个 toolCall 分片」不等于「拿到一次可执行的调用」——
 * 必须攒到流结束才成形。
 *
 * 单独成文件是为了**能单独测**：这段逻辑的输入是上游分片，边界情况（同名多调用、
 * 分片乱序到达、只给了半截 JSON）在真实链路里很难复现，靠单元/探针脚本覆盖更实际。
 *
 * 两条与实际踩坑对应的约定：
 * 1. **按 `index` 分桶，不按 `id`** —— 首个分片可能只带 index 与 name，`id` 要等下一个分片；
 *    按 id 分桶会把同一次调用拆成两条。
 * 2. **`arguments` 原样拼接，不做任何解析** —— 上游可能把 JSON 切成任意位置
 *    （连 `{"query":` 都能拆开），中途解析必失败。合法性与语义留给执行层判断。
 */
import type { LlmStreamDelta, LlmToolCall } from '@shared/providers.js'

/** 分片里与 `LlmStreamDelta.toolCalls` 的元素同形（单独写出来便于单测直接构造） */
export type ToolCallDelta = NonNullable<LlmStreamDelta['toolCalls']>[number]

interface Partial {
  id: string
  name: string
  args: string
}

export class ToolCallAccumulator {
  private readonly partials = new Map<number, Partial>()

  /** 收一批分片。可重复调用，顺序无关。 */
  push(deltas: readonly ToolCallDelta[]): void {
    for (const delta of deltas) {
      const current = this.partials.get(delta.index) ?? { id: '', name: '', args: '' }
      if (delta.id !== undefined && delta.id !== '') current.id = delta.id
      if (delta.name !== undefined && delta.name !== '') current.name = delta.name
      if (delta.argumentsDelta !== undefined) current.args += delta.argumentsDelta
      this.partials.set(delta.index, current)
    }
  }

  /**
   * 收口：返回按 `index` 升序的完整调用。
   *
   * **没有 name 的分片一律丢弃** —— 那多半是上游把不完整的东西送出来了，
   * 报给我们也执行不了；丢掉比抛一个「工具名为空」的执行错误更接近本意。
   */
  finish(): LlmToolCall[] {
    return [...this.partials.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, partial]) => partial)
      .filter((partial) => partial.name !== '')
      .map((partial) => ({ id: partial.id, name: partial.name, arguments: partial.args }))
  }

  /** 是否收到过任何分片（用于区分「模型没调工具」与「调了但没解析出来」） */
  get seen(): boolean {
    return this.partials.size > 0
  }
}
