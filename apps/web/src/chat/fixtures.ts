// Keep the visual replay free of cross-block definitions, which intentionally
// select the static full-document parser. Boundary fixtures remain below.
export const markdownDemo = `# HTTP 流式响应阅读笔记

## 先看结论

**流式响应让正文逐段出现。** 阅读时可以向上查看已生成的内容，也可以选择、复制其中一句话。新的内容继续接收，视口只有在跟随状态下才会移动。这里同时展示 *斜体*、~~删除线~~ 和行内代码 \`Content-Type\`。

> 首段到达与回答完成是两个不同的时间点。收到正文后即可开始阅读；只有收到成功终态，才表示这次回答已经完成。

## 三种常见返回方式

| 方式 | 内容到达方式 | 前端处理 |
| :--- | :--- | :--- |
| 普通 JSON | 等待完整响应 | 一次展示 |
| SSE | 多次收到事件 | 追加正文并更新状态 |
| WebSocket | 双向消息 | 根据消息类型更新 |

### 实现时需要区分的状态

1. **等待首段**：连接已建立，正文还没有到达。
   - 可以显示等待状态。
   - 不要提前生成空的助手回答。
2. **正在生成**：把每次收到的文字追加到同一条回答。
   - 中文、English、数字和标点保持原样。
   - 表格、列表和代码围栏可能跨越多个分片。
3. **已经完成**：显示完整正文，并核对保存后的消息。

## TypeScript 示例

下面的示例展示文字追加与完成状态。代码使用语法高亮，工具栏可以复制原文。

\`\`\`typescript
type Event =
  | { event: "delta"; data: { text: string } }
  | { event: "done"; data: { ok: true } };

let content = "";
let generating = true;

function receive(message: Event) {
  if (message.event === "delta") {
    content += message.data.text;
  } else {
    generating = false;
  }
}
\`\`\`

## Go 示例

每个 SSE 事件以空行结束。数据写出后需要刷新缓冲区，浏览器才能及时收到当前片段。

\`\`\`go
func sendDelta(w http.ResponseWriter, text string) error {
    payload, err := json.Marshal(map[string]string{"text": text})
    if err != nil {
        return err
    }
    if _, err := fmt.Fprintf(w, "event: delta\\ndata: %s\\n\\n", payload); err != nil {
        return err
    }
    return http.NewResponseController(w).Flush()
}
\`\`\`

## 公式与检查清单

首段延迟可以记作 $T_{first}=t_{first}-t_{request}$，总耗时则是：

$$
T_{total} = T_{first} + T_{generation}
$$

- [x] 支持标题、粗体、引用与嵌套列表
- [x] 支持表格、代码高亮和数学公式
- [ ] 生成中向上滚动，检查视口是否停留
- [ ] 点击“回到底部”，检查是否恢复跟随

---

### 阅读与交互

这一段用于观察连续文字的出现过程。你可以在生成中选中前面的内容，检查新片段到达时选区是否稳定；也可以调整侧栏宽度，查看表格和代码块是否保持在各自的滚动区域内。模型输出的 Markdown 结构决定最终格式，渲染器负责把这些结构显示出来。

带有网址的内容显示为[示例链接](https://example.com)，可以复制链接。代码和正文都可以单独复制。回答完成后，全部已接收内容立即显示，历史消息保持静态。
`;

export const markdownFixture = `# 流式阅读 Streaming

中文长段落与 English 混排。网络分片并不是字符边界：👩🏽‍💻、é、中文都应保持完整。${" 阅读过程中可以向上滚动并选择文字。".repeat(12)}

## 列表与引用

1. 第一项 **重要**
   - 嵌套项 *斜体*
   - 行内代码 \`const value = 1\`
2. 第二项

> 引用文字只表示模型输出。

| 术语 | 含义 |
| --- | --- |
| SSE | 增量事件 |
| UTF-8 | 字节编码 |

\`\`\`typescript
const greeting: string = "你好 👩🏽‍💻";
console.log(greeting);
\`\`\`

\`\`\`python
for i in range(3):
    print(i)
\`\`\`

\`\`\`go
fmt.Println("hello")
\`\`\`

行内公式 $E=mc^2$。

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

脚注说明[^note]，以及[引用式链接][ref]。

[^note]: 脚注在全文范围内解析。
[ref]: https://example.com

![不请求远程图片](https://example.com/image.png)

<script>alert("never")</script>
`;
export type SplitMode = "character" | "word" | "random" | "whole";
export function splitFixture(text: string, mode: SplitMode): string[] {
  if (mode === "whole") return [text];
  if (mode === "character") return Array.from(text);
  if (mode === "word") return text.match(/\S+\s*|\s+/gu) || [];
  const chars = Array.from(text),
    chunks: string[] = [];
  let seed = 42;
  for (let i = 0; i < chars.length;) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const size = 1 + (seed % 47);
    chunks.push(chars.slice(i, i + size).join(""));
    i += size;
  }
  return chunks;
}
export function sizedFixture(bytes: number) {
  const paragraph =
    "Streaming 中文 👩🏽‍💻 é **Markdown**. 可选择复制的长回答。\n\n";
  let result = paragraph.repeat(
    Math.ceil(bytes / new TextEncoder().encode(paragraph).length),
  );
  while (new TextEncoder().encode(result).length > bytes)
    result = result.slice(0, -1);
  return result;
}
