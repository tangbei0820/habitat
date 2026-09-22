const GREETINGS: Array<{ from: number; to: number; text: string }> = [
  { from: 7, to: 10, text: '早上好呀，新的一天开始了' },
  { from: 10, to: 14, text: '中午好，吃了吗？' },
  { from: 14, to: 18, text: '下午好，今天过得怎么样？' },
  { from: 18, to: 24, text: '晚上好，辛苦一天啦' },
  { from: 0, to: 7, text: '夜深了，还没睡吗？' },
]

/** 分时欢迎语（静态语料；语料库扩展见 docs/栖息地_UI参考资料_v1.0.md §8） */
export function greetingByHour(hour: number): string {
  const hit = GREETINGS.find((g) => hour >= g.from && hour < g.to)
  return hit?.text ?? GREETINGS[1].text
}
