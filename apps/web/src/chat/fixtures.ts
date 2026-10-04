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
