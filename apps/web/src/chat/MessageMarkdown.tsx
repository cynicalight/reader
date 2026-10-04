import { CachedMarkdown, Streamdown } from "@lobehub/streamdown";
import {
  memo,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remend from "remend";
import { marked } from "marked";
import { Button } from "@reader/ui/components/button";
import { copyText } from "./clipboard";
import "./markdown.css";

const Code = lazy(() => import("./CodeBlock"));
const MathFormula = lazy(() => import("./MathFormula"));
const plugins = [remarkGfm, remarkMath];
export const safeMarkdownURL = (url: string) =>
  /^(https?:\/\/|mailto:|#)/i.test(url) ? url : "";
function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "props" in node)
    return textContent((node.props as { children?: ReactNode }).children);
  return "";
}
const components: Components = {
  img: ({ alt }) => (
    <span className="markdown-image">[图片：{alt || "未加载"}]</span>
  ),
  a: ({ href, children }) =>
    href?.startsWith("#") ? (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          // Resolve footnotes inside this message only; never navigate the reader.
          const root = event.currentTarget.closest(".message-markdown");
          const target = Array.from(root?.querySelectorAll("[id]") || []).find(
            (element) => element.id === href.slice(1),
          );
          const viewport = root?.closest('[data-slot="scroll-area-viewport"]');
          if (target && viewport)
            viewport.scrollTop +=
              target.getBoundingClientRect().top -
              viewport.getBoundingClientRect().top;
        }}
      >
        {children}
      </a>
    ) : href ? (
      <span className="markdown-link">
        {children}
        <Button
          variant="ghost"
          size="sm"
          title={href}
          aria-label={`复制链接 ${href}`}
          onClick={() => void copyText(href)}
        >
          复制链接
        </Button>
      </span>
    ) : (
      <span>{children}</span>
    ),
  pre: ({ children }) => <div className="markdown-pre">{children}</div>,
  code: ({ className, children, node }) => {
    const value = textContent(children);
    if (
      className?.includes("math-inline") ||
      className?.includes("math-display")
    ) {
      const display = className.includes("math-display");
      return (
        <Suspense fallback={<code>{value}</code>}>
          <MathFormula value={value} display={display} />
        </Suspense>
      );
    }
    // remark emits a trailing newline for fenced/indented code, including unlabelled fences.
    const block = Boolean(
      className?.startsWith("language-") ||
      value.endsWith("\n") ||
      (node?.position && node.position.start.line !== node.position.end.line),
    );
    return block ? (
      <Suspense
        fallback={
          <pre>
            <code>{value}</code>
          </pre>
        }
      >
        <Code
          content={value}
          language={className?.replace("language-", "") || "text"}
        />
      </Suspense>
    ) : (
      <code>{children}</code>
    );
  },
  table: ({ children }) => (
    <div className="markdown-table">
      <table>{children}</table>
    </div>
  ),
};
export function useMotionPreference() {
  const [reduced, setReduced] = useState(
    () =>
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}
const markdownOptions = {
  remarkPlugins: plugins,
  components,
  skipHtml: true,
  urlTransform: safeMarkdownURL,
};
const StaticBlock = memo(function StaticBlock({ text }: { text: string }) {
  return <CachedMarkdown {...markdownOptions}>{text}</CachedMarkdown>;
});
function StaticMarkdown({
  content,
  generating,
  global,
}: {
  content: string;
  generating: boolean;
  global: boolean;
}) {
  const blocks = useMemo(() => {
    const text = generating ? remend(content) : content;
    // Keep global definitions and math in one parser. Other long responses reuse
    // completed groups of top-level tokens, never splitting a fence/list/table.
    if (text.length <= 32_768 || global || text.includes("$")) return [text];
    const result: string[] = [];
    let group = "";
    for (const token of marked.lexer(text)) {
      group += token.raw;
      if (group.length >= 8192) {
        result.push(group);
        group = "";
      }
    }
    if (group) result.push(group);
    return result;
  }, [content, generating, global]);
  return (
    <>
      {blocks.map((text, index) => (
        <StaticBlock key={index} text={text} />
      ))}
    </>
  );
}
export const MessageMarkdown = memo(function MessageMarkdown({
  content,
  generating = false,
  reducedMotion = false,
  animated = true,
}: {
  content: string;
  generating?: boolean;
  reducedMotion?: boolean;
  animated?: boolean;
}) {
  const reduced = useMotionPreference();
  const [backgrounded, setBackgrounded] = useState(false);
  useEffect(() => {
    // Once backgrounded, this message stays immediate through completion: no backlog replay.
    const change = () => {
      if (document.hidden) setBackgrounded(true);
    };
    change();
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  // Bound DOM animation cost. Global references use one parser throughout the stream.
  const globalDefinitions =
    /^ {0,3}\[(?:\^)?[^\]]+\]:/m.test(content) ||
    /\[[^\]]+\]\[[^\]]*\]|\[\^/.test(content);
  const animate =
    generating &&
    animated &&
    !reducedMotion &&
    !reduced &&
    !backgrounded &&
    content.length <= 32_768 &&
    !globalDefinitions;
  return (
    <div className="message-markdown" data-animated={animate}>
      {animate ? (
        <Streamdown
          {...markdownOptions}
          content={content}
          smoothing="realtime"
          granularity="word"
        />
      ) : (
        <StaticMarkdown
          content={content}
          generating={generating}
          global={globalDefinitions}
        />
      )}
    </div>
  );
});
