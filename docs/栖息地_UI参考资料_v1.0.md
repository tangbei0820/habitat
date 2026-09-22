# 栖息地 · ChatGPT App / Mobile UI 参考资料

版本：v1.0  
用途：供「栖息地」UI 设计与 Coding Agent（Kimi 等）参考

---

## 0. 使用原则

本资料用于研究 ChatGPT 移动端的视觉语言、页面结构、组件组织与交互思路。

**参考优先级：**

1. 栖息地自己的产品需求与 UI 设计
2. 用户在即时设计等工具中绘制的实际设计稿
3. 本资料中的 ChatGPT / Mobile UI 设计研究
4. 其他第三方 UI 案例

参考 ChatGPT 的设计语言，但**不直接复制 ChatGPT 页面**。

栖息地需要拥有自己的品牌、布局、信息架构和视觉识别。

---

# 1. OpenAI 官方设计资料

## OpenAI Apps SDK UI Guidelines

参考：  
https://developers.openai.ac.cn/apps-sdk/concepts/ui-guidelines

用途：

- OpenAI / ChatGPT 生态中的 UI 设计原则
- Design Tokens
- UI Components
- 卡片、Carousel、Fullscreen 等交互形式
- 基础布局与组件设计
- Figma Component Library
- Tailwind / CSS Variables 等实现思路

重点研究：

- 信息层级
- 间距
- 组件一致性
- 交互反馈
- 内容优先
- 移动端可读性

> 注意：该资料主要面向运行在 ChatGPT 内的 App，并不等同于「栖息地」完整的移动端设计规范。因此只提取适合本项目的设计语言和组件思路。

---

# 2. ChatGPT Mobile App UI 拆解

## ChatGPT Mobile App Design — 10 Screens Explained

参考：  
https://screensdesign.com/articles/chatgpt-mobile-app-design/

用途：研究真实 ChatGPT 移动端的页面与交互结构。

重点关注：

- 新建聊天
- 对话页面
- 输入框
- 附件
- AI 生成状态
- 历史记录
- 搜索
- 设置
- Voice
- 不同交互状态

### 对栖息地的意义

重点学习：

> 一个页面有哪些状态，以及用户在每个状态下下一步可以做什么。

Coding Agent 不应该只得到一张「静态漂亮的页面」，还应该知道：

- 空状态
- 加载状态
- 生成中
- 生成完成
- 中断
- 错误
- 重试
- 无网络
- 工具调用
- 文件 / 图片输入

---

# 3. ChatGPT UI Blueprint

## ChatGPT UI Blueprint

参考：  
https://www.spectr.to/gallery/chatgpt

用途：第三方 ChatGPT UI 设计拆解资料。

可以重点参考：

- Screen-by-screen 页面结构
- Design System
- Color
- Typography
- Spacing
- Component Library
- Navigation
- Implementation Notes

> 注意：这是第三方分析资料，不属于 OpenAI 官方规范。可用于研究 ChatGPT UI 的组成，但不应视为 OpenAI 官方设计参数，也不应直接复制其页面。

---

# 4. ChatGPT Mobile UX / UI Case Study

## ChatGPT Mobile Version UX Case Study

参考：  
https://www.behance.net/gallery/162668377/ChatGPT-Mobile-Version-UX-Case-Study

用途：

观察第三方设计师如何分析 ChatGPT 移动端：

- 页面结构
- 信息层级
- 导航
- 对话界面
- 用户操作路径
- 移动端布局

## ChatGPT App UX Case Study

参考：  
https://www.behance.net/gallery/177268477/ChatGPT-App-UX-Case-Study

用途：

补充第三方 UX 分析：

- Chat 页面
- Navigation
- Settings
- 交互流程
- 移动端信息组织

> Behance 案例属于设计师自己的设计 / 分析，不应作为 ChatGPT 官方规格。

---

# 5. Figma Mobile UI Kit

## Figma Mobile UI Kit

参考：  
https://www.figma.com/templates/mobile-ui-kit/

用途：建立移动端基础组件参考。

重点：

- Navigation
- Chat
- Calendar
- Cards
- Buttons
- Mobile UI
- 基础交互组件

对栖息地的意义：

可以用于解决「按钮、卡片、导航栏、列表应该怎么组织」这类基础问题，不必所有组件都从零研究。

---

# 6. 栖息地 UI 设计参考原则

## 6.1 内容优先

参考 ChatGPT 移动端的简洁思路：

- 减少无意义装饰
- 保证内容阅读空间
- 控制视觉噪音
- 操作入口明确

但栖息地可以拥有更强的「家」的感觉。

## 6.2 简洁 + 温度

ChatGPT 可以作为「克制、简洁、内容优先」的参考。

栖息地在此基础上增加：

- 家的感觉
- 日常感
- 陪伴感
- 留言
- 倒数日
- 愿望
- 日记
- 收藏
- 生活记录

## 6.3 组件统一

建议建立统一 Design Tokens：

```text
Color
Typography
Spacing
Radius
Shadow
Border
Icon
Animation
Transition
Z-index
```

具体数值由栖息地 UI_DESIGN.md 和设计稿最终确定。

---

# 7. 栖息地首页参考方向

当前规划：

```text
┌──────────────────────────────┐
│ 系统状态栏                   │
│                              │
│        ChatGPT Logo          │
│       分时欢迎语             │
│                              │
│ ┌──────────────────────────┐ │
│ │ 💌 留言板                │ │
│ └──────────────────────────┘ │
│                              │
│ ┌──────────────────────────┐ │
│ │ ⏳ 倒数日                │ │
│ └──────────────────────────┘ │
│                              │
│ ┌──────────────────────────┐ │
│ │ ♡ 愿望清单               │ │
│ └──────────────────────────┘ │
│                              │
├──────────────────────────────┤
│ Chat │ LLM │ Home │ Life │ ⚙│
└──────────────────────────────┘
```

### 欢迎界面

启动时：

```text
ChatGPT Logo
+
欢迎语
```

欢迎语由「小栖晨昏语料库」提供。

根据：

- 当前时间段
- 节假日
- 纪念日
- 特殊日期
- 语料标签

自动选择一条。

建议时间段：

```text
07:00–10:00  早晨
10:00–14:00  上午 / 午间
14:00–18:00  下午
18:00–24:00  晚间
00:00–07:00  深夜
```

特殊语料可覆盖普通时段。

---

# 8. 欢迎语料库建议

建议结构：

```json
{
  "time": ["14:00-18:00"],
  "mood": "lazy",
  "occasion": [],
  "text": "下午好呀，今天过得怎么样？"
}
```

未来可以扩展：

```text
time
mood
occasion
season
weather
relationship_state
event
text
```

V1 不需要一开始就实现复杂的动态生成，可以先使用静态 JSON / Markdown / 数据库中的语料，后续再加入 AI 自动生成与人工审核。

---

# 9. 给 Coding Agent 的实现要求

Kimi 在实现 UI 时：

1. 先阅读本资料。
2. 再阅读栖息地自己的 UI_DESIGN.md。
3. 再阅读对应页面的具体设计文档。
4. 用户设计稿优先于外部参考。
5. 不直接复制 ChatGPT UI。
6. 不擅自改变产品信息架构。
7. 不自行添加大型 UI 框架。
8. 不因为「看起来更漂亮」而修改功能结构。
9. 所有页面必须考虑移动端尺寸。
10. 所有交互状态都要有明确设计。

---

# 10. 设计资料的最终定位

这些资料的作用是：

> **告诉 Kimi「优秀的 AI 移动端 UI 可以怎么组织」。**

最终开发链路：

```text
ChatGPT / Mobile UI 研究
        ↓
设计原则与组件参考
        ↓
UI_DESIGN.md
        ↓
页面具体设计文档
        ↓
Kimi 实现
        ↓
实际运行
        ↓
北北验收 / 修改
```

---

# 11. 后续待补充

- [ ] 栖息地 Design Tokens
- [ ] Chat UI_DESIGN.md
- [ ] Home UI_DESIGN.md
- [ ] LLM UI_DESIGN.md
- [ ] Life UI_DESIGN.md
- [ ] Settings UI_DESIGN.md
- [ ] Welcome Screen 设计
- [ ] Mobile 响应式规范
- [ ] Dark / Light Theme
- [ ] 动画规范
- [ ] Icon 规范
- [ ] Empty / Loading / Error 状态规范
- [ ] Chat 输入框规范
- [ ] Message Bubble 规范
- [ ] Voice / Call UI
- [ ] MCP / Tool Calling UI
