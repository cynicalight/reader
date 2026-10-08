import { lazy, Suspense, useSyncExternalStore, type ReactNode } from "react";
import { ArrowDown, Copy, LoaderCircle } from "lucide-react";
import { ProviderGlyph } from "../ProviderIdentity";
import type { Message } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import { ScrollArea } from "@reader/ui/components/scroll-area";
import {
  ChatSession,
  type ChatSnapshot,
  type PendingAnswer,
} from "./chat-session";
import { copyText } from "./clipboard";
const MessageMarkdown = lazy(() =>
  import("./MessageMarkdown").then((module) => ({
    default: module.MessageMarkdown,
  })),
);
import { useChatScroll } from "./useChatScroll";
const messageTimeFormat = new Intl.DateTimeFormat("en", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
export type ChatRow = {
  key: string;
  message?: Message;
  pending?: PendingAnswer;
};
export function chatRows(state: ChatSnapshot): ChatRow[] {
  const { pending } = state;
  const rows: ChatRow[] = state.messages.map((message) => ({
    key: state.messageKeys[message.id] || message.id,
    message,
    pending: pending?.savedId === message.id ? pending : undefined,
  }));
  for (const answer of state.archived) {
    const userIndex = rows.findIndex((row) => row.key === `${answer.key}-user`);
    rows.splice(userIndex < 0 ? rows.length : userIndex + 1, 0, {
      key: answer.key,
      pending: answer,
    });
  }
  if (pending && !pending.savedId) {
    if (!rows.some((row) => row.key === `${pending.key}-user`))
      rows.push({
        key: `${pending.key}-user`,
        message: {
          id: `${pending.key}-user`,
          documentId: "",
          role: "user",
          content: pending.input.prompt,
          context: pending.input.context,
          references: pending.input.references,
          attachments: pending.input.attachments,
          createdAt: "",
        },
      });
    rows.push({ key: pending.key, pending });
  }
  return rows;
}
export function AssistantPanel({
  session,
  empty,
  extras,
}: {
  session: ChatSession;
  empty: ReactNode;
  extras: (message: Message) => ReactNode;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const scroll = useChatScroll(state.pending?.key);
  const pending = state.pending;
  return (
    <div className="chat-thread">
      <ScrollArea className="chat-scroll" viewportRef={scroll.viewportRef}>
        <div className="chat-messages" ref={scroll.contentRef}>
          {!state.loaded && (
            <p className="chat-status">{state.loadError || "正在加载对话…"}</p>
          )}
          {!state.messages.length && !pending && state.loaded && empty}
          {chatRows(state).map(({ key, message, pending: answer }) => {
            const assistant = answer || message?.role === "assistant",
              content = answer?.content ?? message?.content ?? "";
            const timestamp = message?.createdAt
              ? new Date(message.createdAt)
              : undefined;
            return (
              <div
                key={key}
                data-message-id={message?.id}
                className={`chat-message ${assistant ? "assistant" : "user"}`}
              >
                {answer?.phase === "generating" && !content && (
                  <div
                    className="chat-waiting"
                    role="status"
                    aria-label="正在等待回答"
                  >
                    <span className="chat-waiting-icon" aria-hidden="true">
                      {answer.fallback ||
                      !["codex", "claude", "kimi"].includes(
                        answer.input.provider,
                      ) ? (
                        <LoaderCircle size={24} />
                      ) : (
                        <ProviderGlyph provider={answer.input.provider} />
                      )}
                    </span>
                  </div>
                )}
                {assistant ? (
                  <Suspense
                    fallback={
                      <div style={{ whiteSpace: "pre-wrap" }}>{content}</div>
                    }
                  >
                    <MessageMarkdown
                      content={content}
                      generating={answer?.phase === "generating"}
                    />
                  </Suspense>
                ) : (
                  <div>{content}</div>
                )}
                {answer?.fallback && (
                  <p className="chat-status">{answer.fallback}</p>
                )}
                {answer?.notice && (
                  <p role="status" className="chat-status">
                    {answer.notice}
                  </p>
                )}
                {assistant && !!content && (
                  <div className="chat-message-actions">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="复制回答"
                      title="复制回答"
                      onClick={() => void copyText(content)}
                    >
                      <Copy aria-hidden="true" />
                    </Button>
                    {timestamp && !Number.isNaN(timestamp.getTime()) && (
                      <time
                        dateTime={timestamp.toISOString()}
                        title={timestamp.toLocaleString()}
                      >
                        {messageTimeFormat.format(timestamp)}
                      </time>
                    )}
                  </div>
                )}
                {message && extras(message)}
              </div>
            );
          })}
          {(state.loadError ||
            (pending && !["generating", "saved"].includes(pending.phase))) && (
            <Button
              variant="ghost"
              size="sm"
              disabled={state.busy}
              onClick={() => void session.retry()}
            >
              重试同步
            </Button>
          )}
        </div>
      </ScrollArea>
      {!scroll.following && (
        <Button
          className="chat-follow"
          variant="outline"
          size="icon"
          aria-label="回到底部"
          title="回到底部"
          onClick={scroll.bottom}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
